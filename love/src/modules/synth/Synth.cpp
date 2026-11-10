/**
 * Smitten: the sound synthesizer. See Synth.h.
 *
 * Licensed under the zlib license, like LÖVE (see love/license.txt).
 **/

#include "Synth.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>
#include <utility>

namespace love
{
namespace smitten
{
namespace synth
{

namespace
{

constexpr double PI = 3.14159265358979323846;
constexpr double TWO_PI = 2.0 * PI;
constexpr double SR = (double) SAMPLE_RATE;

// Fades that keep sounds from clicking where they start or stop abruptly.
constexpr int FADE_IN_SAMPLES = 44;   // 1 ms
constexpr int FADE_OUT_SAMPLES = 88;  // 2 ms

// Above this level, output is gently compressed towards 1 instead of
// clipping hard.
constexpr double SOFT_CLIP_KNEE = 0.75;

// Noise changes value this many times per period of its frequency (as in
// sfxr), so its pitch still means something.
constexpr double NOISE_STEPS_PER_PERIOD = 32.0;

constexpr uint32_t NOISE_SEED = 0x6d2b79f5u;

const char *WAVE_NAMES[WAVE_MAX_ENUM] = { "square", "sawtooth", "triangle", "sine", "noise" };

double clampd(double x, double lo, double hi)
{
	return x < lo ? lo : (x > hi ? hi : x);
}

double finiteOr(double x, double fallback)
{
	return std::isfinite(x) ? x : fallback;
}

int64_t roundToInt(double x)
{
	return (int64_t) std::floor(x + 0.5);
}

int64_t secondsToSamples(double s)
{
	return roundToInt(s * SR);
}

double softClip(double x)
{
	double a = std::fabs(x);
	if (a <= SOFT_CLIP_KNEE)
		return x;
	double range = 1.0 - SOFT_CLIP_KNEE;
	double y = SOFT_CLIP_KNEE + range * std::tanh((a - SOFT_CLIP_KNEE) / range);
	return x < 0.0 ? -y : y;
}

// sin(2 pi p) for p in [0, 1). A Taylor polynomial on [-pi/2, pi/2] after
// folding; error below 4e-6, and much faster than std::sin in WebAssembly.
double sinCycle(double p)
{
	double x = p < 0.5 ? p : p - 1.0; // [-0.5, 0.5)
	if (x > 0.25)
		x = 0.5 - x;
	else if (x < -0.25)
		x = -0.5 - x;
	double z = x * TWO_PI;
	double z2 = z * z;
	return z * (1.0 - z2 / 6.0 * (1.0 - z2 / 20.0 * (1.0 - z2 / 42.0 * (1.0 - z2 / 72.0))));
}

// Correction for the discontinuity of a naive oscillator at phase 0
// (PolyBLEP), so square and sawtooth waves don't alias badly.
double polyBlep(double t, double dt)
{
	if (t < dt)
	{
		t /= dt;
		return t + t - t * t - 1.0;
	}
	if (t > 1.0 - dt)
	{
		t = (t - 1.0) / dt;
		return t * t + t + t + 1.0;
	}
	return 0.0;
}

struct Random
{
	uint32_t state = NOISE_SEED;

	// Uniform in [-1, 1).
	double next()
	{
		state ^= state << 13;
		state ^= state >> 17;
		state ^= state << 5;
		return (double) state / 2147483648.0 - 1.0;
	}
};

struct Oscillator
{
	Wave wave = WAVE_SQUARE;
	double phase = 0.0;
	double noisePhase = 0.0;
	double noiseValue = 0.0;
	Random random;

	void reset()
	{
		phase = 0.0;
		noisePhase = 0.0;
		random = Random();
		noiseValue = random.next();
	}

	// One sample at `dt` cycles per sample; `duty` for square waves.
	double next(double dt, double duty)
	{
		double v = 0.0;
		switch (wave)
		{
		case WAVE_SQUARE:
		{
			v = phase < duty ? 1.0 : -1.0;
			v += polyBlep(phase, dt);
			double fall = phase - duty;
			if (fall < 0.0)
				fall += 1.0;
			v -= polyBlep(fall, dt);
			// Center the pulse, so narrow ones don't add a DC offset.
			v -= 2.0 * duty - 1.0;
			break;
		}
		case WAVE_SAWTOOTH:
			v = 2.0 * phase - 1.0 - polyBlep(phase, dt);
			break;
		case WAVE_TRIANGLE:
			v = 4.0 * std::fabs(phase - 0.5) - 1.0;
			break;
		case WAVE_SINE:
			v = sinCycle(phase);
			break;
		case WAVE_NOISE:
		{
			double steps = dt * NOISE_STEPS_PER_PERIOD;
			if (steps >= 1.0)
				noiseValue = random.next();
			else
			{
				noisePhase += steps;
				if (noisePhase >= 1.0)
				{
					noisePhase -= 1.0;
					noiseValue = random.next();
				}
			}
			v = noiseValue;
			break;
		}
		default:
			break;
		}

		phase += dt;
		if (phase >= 1.0)
			phase -= std::floor(phase);
		return v;
	}
};

// Two cascaded one-pole low-pass filters (12 dB/octave), topology-preserving
// transform so they stay stable at any cutoff.
struct LowPass
{
	bool enabled = false;
	double g = 0.0;
	double s1 = 0.0;
	double s2 = 0.0;

	void setCutoff(double hz)
	{
		hz = clampd(hz, 10.0, SR * 0.45);
		double t = std::tan(PI * hz / SR);
		g = t / (1.0 + t);
		enabled = true;
	}

	double process(double x)
	{
		double v = (x - s1) * g;
		double y = v + s1;
		s1 = y + v;
		v = (y - s2) * g;
		double y2 = v + s2;
		s2 = y2 + v;
		return y2;
	}
};

struct HighPass
{
	bool enabled = false;
	LowPass lp1;
	LowPass lp2;

	void setCutoff(double hz)
	{
		lp1.setCutoff(hz);
		lp2.setCutoff(hz);
		enabled = true;
	}

	double process(double x)
	{
		// Two one-pole high-passes: x - lowpass(x), twice. LowPass is two poles,
		// so use only its first stage.
		double v = (x - lp1.s1) * lp1.g;
		double y = v + lp1.s1;
		lp1.s1 = y + v;
		x -= y;
		v = (x - lp2.s1) * lp2.g;
		y = v + lp2.s1;
		lp2.s1 = y + v;
		return x - y;
	}
};

// lowpass 0-1 (1 = off) -> cutoff from 100 Hz to 20 kHz, exponentially.
double lowpassCutoff(double amount)
{
	return 100.0 * std::pow(200.0, amount);
}

// highpass 0-1 (0 = off) -> cutoff from 10 Hz to 5 kHz.
double highpassCutoff(double amount)
{
	return 10.0 * std::pow(500.0, amount);
}

SfxParams sanitize(const SfxParams &in)
{
	const SfxParams defaults;
	SfxParams p = in;
	for (int i = 0; i < SFX_FIELD_COUNT; i++)
	{
		double SfxParams::*m = SFX_FIELDS[i].member;
		p.*m = finiteOr(p.*m, defaults.*m);
	}
	if (p.wave < 0 || p.wave >= WAVE_MAX_ENUM)
		p.wave = defaults.wave;
	p.volume = clampd(p.volume, 0.0, 1.0);
	p.attack = std::max(p.attack, 0.0);
	p.sustain = std::max(p.sustain, 0.0);
	p.decay = std::max(p.decay, 0.0);
	p.punch = clampd(p.punch, 0.0, 1.0);
	p.frequency = clampd(p.frequency, 1.0, 20000.0);
	p.minFrequency = std::max(p.minFrequency, 0.0);
	p.duty = clampd(p.duty, 0.0, 1.0);
	p.repeat = std::max(p.repeat, 0.0);
	p.arpeggioTime = std::max(p.arpeggioTime, 0.0);
	p.lowpass = clampd(p.lowpass, 0.0, 1.0);
	p.highpass = clampd(p.highpass, 0.0, 1.0);
	p.bitcrush = clampd(p.bitcrush, 0.0, 1.0);
	return p;
}

Instrument sanitize(const Instrument &in)
{
	const Instrument defaults = in.type == INSTRUMENT_SAMPLE ? sampleDefaults() : Instrument();
	Instrument inst = in;
	for (int i = 0; i < INSTRUMENT_FIELD_COUNT; i++)
	{
		double Instrument::*m = INSTRUMENT_FIELDS[i].member;
		inst.*m = finiteOr(inst.*m, defaults.*m);
	}
	if (inst.wave < 0 || inst.wave >= WAVE_MAX_ENUM)
		inst.wave = defaults.wave;
	inst.volume = std::max(inst.volume, 0.0);
	inst.attack = std::max(inst.attack, 0.0);
	inst.decay = std::max(inst.decay, 0.0);
	inst.sustain = clampd(inst.sustain, 0.0, 1.0);
	inst.release = std::max(inst.release, 0.0);
	inst.duty = clampd(inst.duty, 0.0, 1.0);
	inst.lowpass = clampd(inst.lowpass, 0.0, 1.0);
	inst.baseNote = clampd(finiteOr(inst.baseNote, 60.0), 0.0, 127.0);
	return inst;
}

double dutyLimit(double duty)
{
	return clampd(duty, 0.02, 0.98);
}

void applyFades(float *samples, size_t count)
{
	size_t in = std::min<size_t>(FADE_IN_SAMPLES, count);
	for (size_t i = 0; i < in; i++)
		samples[i] *= (float) ((double) i / FADE_IN_SAMPLES);
	size_t out = std::min<size_t>(FADE_OUT_SAMPLES, count);
	for (size_t i = 0; i < out; i++)
		samples[count - 1 - i] *= (float) ((double) i / FADE_OUT_SAMPLES);
}

// A note of a synth instrument, added into `mix` from `start`.
void renderSynthNote(const Instrument &inst, double frequency, double gain,
                     int64_t length, float *mix)
{
	int64_t attackN = std::max<int64_t>(secondsToSamples(inst.attack), FADE_IN_SAMPLES);
	int64_t decayN = secondsToSamples(inst.decay);
	int64_t releaseN = std::max<int64_t>(secondsToSamples(inst.release), FADE_OUT_SAMPLES);

	auto heldLevel = [&](int64_t i) -> double
	{
		if (i < attackN)
			return (double) i / (double) attackN;
		if (i < attackN + decayN)
			return 1.0 + (inst.sustain - 1.0) * (double) (i - attackN) / (double) decayN;
		return inst.sustain;
	};

	double releaseLevel = heldLevel(length);
	int64_t total = length + releaseN;

	Oscillator osc;
	osc.wave = inst.wave;
	osc.reset();

	LowPass lp;
	if (inst.lowpass < 1.0)
		lp.setCutoff(lowpassCutoff(inst.lowpass));

	double duty = dutyLimit(inst.duty);
	double baseDt = frequency / SR;
	double dt = baseDt;
	bool vibrato = inst.vibratoDepth != 0.0 && inst.vibratoSpeed > 0.0;
	double vibPhase = 0.0;
	double vibDt = inst.vibratoSpeed / SR;

	// Vibrato is computed every few samples; it changes slowly.
	constexpr int CONTROL_RATE = 16;

	for (int64_t i = 0; i < total; i++)
	{
		if (vibrato && (i % CONTROL_RATE) == 0)
		{
			double semis = inst.vibratoDepth * sinCycle(vibPhase);
			dt = std::min(baseDt * std::exp2(semis / 12.0), 0.45);
			vibPhase += vibDt * CONTROL_RATE;
			vibPhase -= std::floor(vibPhase);
		}

		double env;
		if (i < length)
			env = heldLevel(i);
		else
			env = releaseLevel * (1.0 - (double) (i - length) / (double) releaseN);

		double v = osc.next(dt, duty);
		if (lp.enabled)
			v = lp.process(v);
		mix[i] += (float) (v * env * gain);
	}
}

// A note of a sample instrument, added into `mix` (which has room for
// `total` samples). `step` is how far the read position moves in the sound
// file for each output sample (before vibrato); `held` is the length of the
// note in samples (without playToEnd, the release starts there).
void renderSampleNote(const Instrument &inst, double step, double gain,
                      int64_t held, int64_t total, float *mix)
{
	const std::vector<float> &src = inst.sample->samples;
	const double count = (double) src.size();

	int64_t attackN = std::max<int64_t>(secondsToSamples(inst.attack), FADE_IN_SAMPLES);
	int64_t decayN = secondsToSamples(inst.decay);
	int64_t releaseN = std::max<int64_t>(secondsToSamples(inst.release), FADE_OUT_SAMPLES);

	auto heldLevel = [&](int64_t i) -> double
	{
		if (i < attackN)
			return (double) i / (double) attackN;
		if (i < attackN + decayN)
			return 1.0 + (inst.sustain - 1.0) * (double) (i - attackN) / (double) decayN;
		return inst.sustain;
	};
	double releaseLevel = heldLevel(held);

	LowPass lp;
	if (inst.lowpass < 1.0)
		lp.setCutoff(lowpassCutoff(inst.lowpass));

	bool vibrato = inst.vibratoDepth != 0.0 && inst.vibratoSpeed > 0.0;
	double vibPhase = 0.0;
	double vibDt = inst.vibratoSpeed / SR;
	constexpr int CONTROL_RATE = 16;
	double dt = step;

	double pos = 0.0;
	for (int64_t i = 0; i < total; i++)
	{
		if (pos >= count)
			break;
		if (vibrato && (i % CONTROL_RATE) == 0)
		{
			double semis = inst.vibratoDepth * sinCycle(vibPhase);
			dt = step * std::exp2(semis / 12.0);
			vibPhase += vibDt * CONTROL_RATE;
			vibPhase -= std::floor(vibPhase);
		}

		// Linear interpolation between the two nearest samples of the file.
		size_t k = (size_t) pos;
		double frac = pos - (double) k;
		double a = src[k];
		double b = k + 1 < src.size() ? src[k + 1] : 0.0;
		double v = a + (b - a) * frac;

		double env;
		if (inst.playToEnd || i < held)
			env = heldLevel(i);
		else
			env = releaseLevel * (1.0 - (double) (i - held) / (double) releaseN);

		// A short fade at the end of the file, so a cut sound doesn't click.
		double left = (count - pos) / dt;
		if (left < FADE_OUT_SAMPLES)
			env *= left / FADE_OUT_SAMPLES;

		if (lp.enabled)
			v = lp.process(v);
		mix[i] += (float) (v * env * gain);
		pos += dt;
	}
}

struct Voice
{
	int64_t start;
	int64_t end;
	int instrument;
	double frequency; // synth notes; sample notes: the read step
	int64_t length;   // synth and sample notes: held samples
	double gain;
	const std::vector<float> *sfx; // sfx notes
};

} // anonymous namespace

const SfxField SFX_FIELDS[] =
{
	{ "volume", &SfxParams::volume },
	{ "attack", &SfxParams::attack },
	{ "sustain", &SfxParams::sustain },
	{ "punch", &SfxParams::punch },
	{ "decay", &SfxParams::decay },
	{ "frequency", &SfxParams::frequency },
	{ "minFrequency", &SfxParams::minFrequency },
	{ "slide", &SfxParams::slide },
	{ "deltaSlide", &SfxParams::deltaSlide },
	{ "vibratoDepth", &SfxParams::vibratoDepth },
	{ "vibratoSpeed", &SfxParams::vibratoSpeed },
	{ "arpeggio", &SfxParams::arpeggio },
	{ "arpeggioTime", &SfxParams::arpeggioTime },
	{ "duty", &SfxParams::duty },
	{ "dutySweep", &SfxParams::dutySweep },
	{ "repeat", &SfxParams::repeat },
	{ "lowpass", &SfxParams::lowpass },
	{ "highpass", &SfxParams::highpass },
	{ "bitcrush", &SfxParams::bitcrush },
};
const int SFX_FIELD_COUNT = (int) (sizeof(SFX_FIELDS) / sizeof(SFX_FIELDS[0]));

const InstrumentField INSTRUMENT_FIELDS[] =
{
	{ "volume", &Instrument::volume },
	{ "attack", &Instrument::attack },
	{ "decay", &Instrument::decay },
	{ "sustain", &Instrument::sustain },
	{ "release", &Instrument::release },
	{ "duty", &Instrument::duty },
	{ "vibratoDepth", &Instrument::vibratoDepth },
	{ "vibratoSpeed", &Instrument::vibratoSpeed },
	{ "lowpass", &Instrument::lowpass },
};
const int INSTRUMENT_FIELD_COUNT = (int) (sizeof(INSTRUMENT_FIELDS) / sizeof(INSTRUMENT_FIELDS[0]));

Instrument sampleDefaults()
{
	Instrument d;
	d.type = INSTRUMENT_SAMPLE;
	d.volume = 1.0;
	d.attack = 0.0;
	d.decay = 0.0;
	d.sustain = 1.0;
	d.release = 0.05;
	d.pitched = true;
	return d;
}

bool getWave(const char *name, Wave &wave)
{
	for (int i = 0; i < WAVE_MAX_ENUM; i++)
	{
		if (strcmp(name, WAVE_NAMES[i]) == 0)
		{
			wave = (Wave) i;
			return true;
		}
	}
	return false;
}

const char *getWaveName(Wave wave)
{
	return wave >= 0 && wave < WAVE_MAX_ENUM ? WAVE_NAMES[wave] : nullptr;
}

std::vector<float> renderSfx(const SfxParams &params, double semitones)
{
	SfxParams p = sanitize(params);
	semitones = finiteOr(semitones, 0.0);

	double ratio = std::exp2(semitones / 12.0);
	double baseFrequency = p.frequency * ratio;
	double minFrequency = p.minFrequency * ratio;

	int64_t attackN = secondsToSamples(std::min(p.attack, MAX_SFX_SECONDS));
	int64_t sustainN = secondsToSamples(std::min(p.sustain, MAX_SFX_SECONDS));
	int64_t decayN = secondsToSamples(std::min(p.decay, MAX_SFX_SECONDS));
	int64_t total = std::min<int64_t>(attackN + sustainN + decayN, secondsToSamples(MAX_SFX_SECONDS));

	if (total <= 0)
		return std::vector<float>(1, 0.0f);

	std::vector<float> out((size_t) total, 0.0f);

	Oscillator osc;
	osc.wave = p.wave;
	osc.reset();

	LowPass lp;
	if (p.lowpass < 1.0)
		lp.setCutoff(lowpassCutoff(p.lowpass));
	HighPass hp;
	if (p.highpass > 0.0)
		hp.setCutoff(highpassCutoff(p.highpass));

	// Pitch effects; `repeat` restarts them.
	double octaves = 0.0;
	double slide = p.slide;
	double duty = p.duty;
	int64_t sinceRepeat = 0;
	int64_t repeatN = p.repeat > 0.0 ? std::max<int64_t>(secondsToSamples(p.repeat), 1) : 0;
	int64_t arpN = p.arpeggioTime > 0.0 ? secondsToSamples(p.arpeggioTime) : -1;
	double arpSemis = p.arpeggio;

	double vibPhase = 0.0;
	double vibDt = p.vibratoSpeed / SR;
	bool vibrato = p.vibratoDepth != 0.0 && p.vibratoSpeed > 0.0;

	// Bitcrush: hold each sample for a while (down to ~2.6 kHz) and quantize
	// (down to 4 bits).
	bool crush = p.bitcrush > 0.0;
	double crushStep = 1.0 - 0.94 * p.bitcrush;
	double crushLevels = std::exp2(15.0 - 12.0 * p.bitcrush);
	double crushPhase = 1.0;
	double crushHeld = 0.0;

	int64_t length = total;
	for (int64_t i = 0; i < total; i++)
	{
		if (repeatN > 0 && sinceRepeat >= repeatN)
		{
			octaves = 0.0;
			slide = p.slide;
			duty = p.duty;
			sinceRepeat = 0;
		}

		double pitch = baseFrequency * std::exp2(octaves);
		if (minFrequency > 0.0 && octaves < 0.0 && pitch < minFrequency)
		{
			length = i;
			break;
		}

		double semis = 0.0;
		if (arpN >= 0 && sinceRepeat >= arpN)
			semis += arpSemis;
		if (vibrato)
		{
			semis += p.vibratoDepth * sinCycle(vibPhase);
			vibPhase += vibDt;
			vibPhase -= std::floor(vibPhase);
		}
		double frequency = semis != 0.0 ? pitch * std::exp2(semis / 12.0) : pitch;
		double dt = clampd(frequency, 1.0, 20000.0) / SR;

		double v = osc.next(dt, dutyLimit(duty));

		double env;
		if (i < attackN)
			env = (double) i / (double) attackN;
		else if (i < attackN + sustainN)
			env = 1.0 + p.punch * (1.0 - (double) (i - attackN) / (double) sustainN);
		else
			env = 1.0 - (double) (i - attackN - sustainN) / (double) decayN;

		v *= env;
		if (lp.enabled)
			v = lp.process(v);
		if (hp.enabled)
			v = hp.process(v);
		if (crush)
		{
			crushPhase += crushStep;
			if (crushPhase >= 1.0)
			{
				crushPhase -= 1.0;
				crushHeld = std::floor(v * crushLevels + 0.5) / crushLevels;
			}
			v = crushHeld;
		}

		out[(size_t) i] = (float) softClip(v * p.volume);

		octaves += slide / SR;
		slide += p.deltaSlide / SR;
		duty += p.dutySweep / SR;
		sinceRepeat++;
	}

	if (length <= 0)
		return std::vector<float>(1, 0.0f);
	out.resize((size_t) length);
	applyFades(out.data(), out.size());
	return out;
}

double getSongDuration(const Song &song)
{
	double bpm = finiteOr(song.bpm, 120.0);
	double spb = finiteOr(song.stepsPerBeat, 4.0);
	if (bpm <= 0.0 || spb <= 0.0 || song.patternLength <= 0)
		return 0.0;
	double seconds = (double) song.order.size() * song.patternLength * 60.0 / (bpm * spb);
	return std::min(seconds, MAX_SONG_SECONDS);
}

SongRender renderSong(const Song &song, bool loopLayout)
{
	SongRender result;

	double bpm = finiteOr(song.bpm, 120.0);
	double spb = finiteOr(song.stepsPerBeat, 4.0);
	int patternLength = song.patternLength;
	if (bpm <= 0.0 || spb <= 0.0 || patternLength <= 0)
	{
		result.samples.assign(1, 0.0f);
		return result;
	}

	double stepSamples = 60.0 * SR / (bpm * spb);
	auto stepToSample = [&](double step) -> int64_t { return roundToInt(step * stepSamples); };

	int64_t passLength = std::min(stepToSample((double) song.order.size() * patternLength),
	                              secondsToSamples(MAX_SONG_SECONDS));

	std::vector<Instrument> instruments;
	instruments.reserve(song.instruments.size());
	for (const Instrument &inst : song.instruments)
	{
		Instrument s = sanitize(inst);
		if (s.type == INSTRUMENT_SFX && !std::isfinite(inst.volume))
			s.volume = 1.0;
		instruments.push_back(s);
	}

	// Sound effects per instrument and pitch, rendered once.
	std::map<std::pair<int, double>, std::vector<float>> sfxCache;

	std::vector<Voice> voices;
	int64_t end = passLength;

	for (size_t o = 0; o < song.order.size(); o++)
	{
		int pi = song.order[o];
		if (pi < 0 || pi >= (int) song.patterns.size())
			continue;
		double patternStart = (double) o * patternLength;
		for (const Note &note : song.patterns[pi].notes)
		{
			if (note.channel < 0 || note.channel >= (int) song.channels.size())
				continue;
			const Channel &channel = song.channels[note.channel];
			if (channel.instrument < 0 || channel.instrument >= (int) instruments.size())
				continue;
			const Instrument &inst = instruments[channel.instrument];

			double step = finiteOr(note.step, 0.0);
			double length = std::max(finiteOr(note.length, 1.0), 0.0);
			double pitch = finiteOr(note.note, 60.0);
			double gain = std::max(finiteOr(note.volume, 1.0), 0.0)
				* std::max(finiteOr(channel.volume, 1.0), 0.0) * inst.volume;

			Voice v = {};
			v.start = stepToSample(patternStart + step);
			if (v.start < 0 || v.start >= passLength || gain <= 0.0)
				continue;
			v.instrument = channel.instrument;
			v.gain = gain;

			if (inst.type == INSTRUMENT_SFX)
			{
				if (!inst.hasSfx)
					continue;
				double semis = inst.pitched ? pitch - 60.0 : 0.0;
				auto key = std::make_pair(channel.instrument, semis);
				auto it = sfxCache.find(key);
				if (it == sfxCache.end())
					it = sfxCache.emplace(key, renderSfx(inst.sfx, semis)).first;
				v.sfx = &it->second;
				v.end = v.start + (int64_t) v.sfx->size();
			}
			else if (inst.type == INSTRUMENT_SAMPLE)
			{
				if (!inst.sample || inst.sample->samples.empty())
					continue;
				double semis = inst.pitched ? pitch - inst.baseNote : 0.0;
				double readStep = inst.sample->rate / SR * std::exp2(semis / 12.0);
				if (!(readStep > 1e-4) || readStep > 256.0)
					continue;
				// The slowest the file can be read (vibrato lowers the pitch by up
				// to its depth) gives the longest the note can last.
				double slowest = readStep * std::exp2(-std::fabs(inst.vibratoDepth) / 12.0);
				int64_t whole = (int64_t) std::ceil((double) inst.sample->samples.size() / slowest) + 1;
				v.frequency = readStep;
				v.length = std::max<int64_t>(stepToSample(patternStart + step + length) - v.start, 1);
				int64_t releaseN = std::max<int64_t>(secondsToSamples(inst.release), FADE_OUT_SAMPLES);
				v.end = v.start + (inst.playToEnd ? whole : std::min(whole, v.length + releaseN));
			}
			else
			{
				v.frequency = 440.0 * std::exp2((pitch - 69.0) / 12.0);
				if (!(v.frequency > 0.0) || v.frequency > SR * 0.45)
					continue;
				v.length = std::max<int64_t>(stepToSample(patternStart + step + length) - v.start, 1);
				int64_t releaseN = std::max<int64_t>(secondsToSamples(inst.release), FADE_OUT_SAMPLES);
				v.end = v.start + v.length + releaseN;
			}
			end = std::max(end, v.end);
			voices.push_back(v);
		}
	}

	std::vector<float> mix((size_t) std::max<int64_t>(end, 1), 0.0f);
	for (const Voice &v : voices)
	{
		float *dst = mix.data() + v.start;
		if (v.sfx != nullptr)
		{
			float g = (float) v.gain;
			const float *src = v.sfx->data();
			size_t n = v.sfx->size();
			for (size_t i = 0; i < n; i++)
				dst[i] += src[i] * g;
		}
		else if (instruments[v.instrument].type == INSTRUMENT_SAMPLE)
			renderSampleNote(instruments[v.instrument], v.frequency, v.gain, v.length, v.end - v.start, dst);
		else
			renderSynthNote(instruments[v.instrument], v.frequency, v.gain, v.length, dst);
	}

	result.passLength = (size_t) passLength;

	int64_t loopStart = std::max<int64_t>(stepToSample((double) song.loopStart * patternLength), 0);
	int64_t body = passLength - loopStart;
	if (loopLayout && song.loop && song.loopStart >= 0 && body > 0)
	{
		// The first pass, then the loop's start with the tails that ring past
		// the end mixed in (wrapped around shorter loops).
		int64_t tail = end - passLength;
		int64_t wrap = std::min(tail, body);
		result.samples.resize((size_t) (passLength + wrap));
		for (int64_t i = 0; i < passLength; i++)
			result.samples[(size_t) i] = (float) softClip(mix[(size_t) i]);
		for (int64_t i = 0; i < wrap; i++)
		{
			double v = mix[(size_t) (loopStart + i)];
			for (int64_t t = i; t < tail; t += body)
				v += mix[(size_t) (passLength + t)];
			result.samples[(size_t) (passLength + i)] = (float) softClip(v);
		}
		result.loopPoint = loopStart + wrap;
	}
	else
	{
		result.samples.resize(mix.size());
		for (size_t i = 0; i < mix.size(); i++)
			result.samples[i] = (float) softClip(mix[i]);
	}

	return result;
}

uint32_t checksum(const float *samples, size_t count)
{
	uint32_t h = 2166136261u;
	for (size_t i = 0; i < count; i++)
	{
		uint32_t bits;
		memcpy(&bits, &samples[i], sizeof(bits));
		for (int b = 0; b < 4; b++)
		{
			h ^= (bits >> (b * 8)) & 0xFF;
			h *= 16777619u;
		}
	}
	return h;
}

} // synth
} // smitten
} // love
