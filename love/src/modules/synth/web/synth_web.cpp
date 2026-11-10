/**
 * Smitten: the sound synthesizer's C API for the editor (dist/synth.mjs).
 *
 * Not part of upstream LÖVE. web/editor/synth.js encodes sound effects and
 * songs as flat arrays of doubles (so values reach the synthesizer exactly as
 * the engine's Lua tables do) and reads the rendered float samples back.
 * NaN in any slot means "missing": the documented default applies.
 *
 * Sound effect (SFX_SIZE doubles):
 *   wave index (Synth.h, Wave), then SFX_FIELDS in order.
 *
 * Song:
 *   bpm, stepsPerBeat, patternLength, loop (0/1), loopStart,
 *   channelCount, instrumentCount, patternCount, orderCount,
 *   per channel: instrument, volume
 *   per instrument (INSTRUMENT_SIZE doubles): type (0 synth, 1 sfx,
 *     2 sample), wave, INSTRUMENT_FIELDS in order, pitched (0/1), hasSfx
 *     (0/1), a sound effect, baseNote, playToEnd (0/1), sampleRate,
 *     sampleCount; then sampleCount samples (mono, -1 to 1)
 *   per pattern: noteCount, then per note: channel, step, length, note, volume
 *   order entries
 *
 * Licensed under the zlib license, like LÖVE (see love/license.txt).
 **/

#include "Synth.h"

#include <emscripten.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <vector>

using namespace love::smitten::synth;

namespace
{

std::vector<float> output;
double outputLoopPoint = -1.0;
double outputPassSeconds = 0.0;

struct Reader
{
	const double *data;
	int count;
	int pos = 0;

	bool ok() const { return pos <= count; }

	double next()
	{
		double v = pos < count ? data[pos] : NAN;
		pos++;
		return v;
	}

	int nextInt(int fallback)
	{
		double v = next();
		return std::isfinite(v) && std::fabs(v) < 1e9 ? (int) std::floor(v) : fallback;
	}

	bool nextBool(bool fallback)
	{
		double v = next();
		return std::isfinite(v) ? v != 0.0 : fallback;
	}

	Wave nextWave(Wave fallback)
	{
		int w = nextInt(-1);
		return w >= 0 && w < WAVE_MAX_ENUM ? (Wave) w : fallback;
	}

	SfxParams sfx()
	{
		SfxParams p;
		p.wave = nextWave(p.wave);
		for (int i = 0; i < SFX_FIELD_COUNT; i++)
			p.*SFX_FIELDS[i].member = next();
		return p;
	}
};

int finish(std::vector<float> &&samples, double loopPoint, double passSeconds)
{
	output = std::move(samples);
	outputLoopPoint = loopPoint;
	outputPassSeconds = passSeconds;
	return (int) output.size();
}

} // anonymous namespace

extern "C" {

// Doubles per encoded sound effect and per instrument, so the encoder can
// check its layout.
EMSCRIPTEN_KEEPALIVE int synth_sfx_size()
{
	return 1 + SFX_FIELD_COUNT;
}

EMSCRIPTEN_KEEPALIVE int synth_instrument_size()
{
	return 2 + INSTRUMENT_FIELD_COUNT + 2 + 1 + SFX_FIELD_COUNT + 4;
}

// Render a sound effect; returns the number of samples (see synth_samples),
// or -1 if the encoding is short.
EMSCRIPTEN_KEEPALIVE int synth_render_sfx(const double *data, int count)
{
	Reader r { data, count };
	SfxParams p = r.sfx();
	if (!r.ok())
		return -1;
	std::vector<float> samples = renderSfx(p);
	double seconds = (double) samples.size() / SAMPLE_RATE;
	return finish(std::move(samples), -1.0, seconds);
}

// Render a song (Synth.h, renderSong); returns the number of samples, or -1
// if the encoding is short.
EMSCRIPTEN_KEEPALIVE int synth_render_song(const double *data, int count, int loopLayout)
{
	Reader r { data, count };
	Song song;
	song.bpm = r.next();
	song.stepsPerBeat = r.next();
	song.patternLength = r.nextInt(song.patternLength);
	song.loop = r.nextBool(song.loop);
	song.loopStart = r.nextInt(song.loopStart);
	int channels = r.nextInt(0);
	int instruments = r.nextInt(0);
	int patterns = r.nextInt(0);
	int order = r.nextInt(0);
	if (channels < 0 || instruments < 0 || patterns < 0 || order < 0 || !r.ok())
		return -1;

	for (int i = 0; i < channels && r.ok(); i++)
	{
		Channel c;
		c.instrument = r.nextInt(i);
		c.volume = r.next();
		song.channels.push_back(c);
	}

	for (int i = 0; i < instruments && r.ok(); i++)
	{
		Instrument inst;
		int type = r.nextInt(0);
		inst.type = type == 1 ? INSTRUMENT_SFX : type == 2 ? INSTRUMENT_SAMPLE : INSTRUMENT_SYNTH;
		inst.wave = r.nextWave(inst.wave);
		for (int f = 0; f < INSTRUMENT_FIELD_COUNT; f++)
			inst.*INSTRUMENT_FIELDS[f].member = r.next();
		inst.pitched = r.nextBool(inst.type == INSTRUMENT_SAMPLE);
		inst.hasSfx = r.nextBool(false);
		inst.sfx = r.sfx();
		inst.baseNote = r.next();
		inst.playToEnd = r.nextBool(true);
		double rate = r.next();
		int count = r.nextInt(0);
		if (count < 0 || count > r.count - r.pos)
			return -1;
		if (inst.type == INSTRUMENT_SAMPLE && rate > 0.0 && count > 0)
		{
			auto sample = std::make_shared<Sample>();
			sample->rate = rate;
			size_t keep = std::min((size_t) count, (size_t) (rate * MAX_SAMPLE_SECONDS));
			sample->samples.resize(keep);
			for (size_t k = 0; k < keep; k++)
				sample->samples[k] = (float) r.data[r.pos + k];
			inst.sample = sample;
		}
		r.pos += count;
		song.instruments.push_back(inst);
	}

	for (int i = 0; i < patterns && r.ok(); i++)
	{
		Pattern pattern;
		int notes = r.nextInt(0);
		for (int n = 0; n < notes && r.ok(); n++)
		{
			Note note;
			note.channel = r.nextInt(note.channel);
			note.step = r.next();
			note.length = r.next();
			note.note = r.next();
			note.volume = r.next();
			pattern.notes.push_back(note);
		}
		song.patterns.push_back(std::move(pattern));
	}

	for (int i = 0; i < order && r.ok(); i++)
		song.order.push_back(r.nextInt(-1));

	if (!r.ok())
		return -1;

	SongRender render = renderSong(song, loopLayout != 0);
	return finish(std::move(render.samples), (double) render.loopPoint,
	              (double) render.passLength / SAMPLE_RATE);
}

// The samples of the last render (valid until the next one).
EMSCRIPTEN_KEEPALIVE float *synth_samples()
{
	return output.data();
}

// The last song's loop point in samples (loop layout), or -1.
EMSCRIPTEN_KEEPALIVE double synth_loop_point()
{
	return outputLoopPoint;
}

// The last song's length of one pass, in seconds.
EMSCRIPTEN_KEEPALIVE double synth_pass_seconds()
{
	return outputPassSeconds;
}

// Checksum of the last render's samples (Synth.h, checksum).
EMSCRIPTEN_KEEPALIVE unsigned int synth_checksum()
{
	return checksum(output.data(), output.size());
}

} // extern "C"
