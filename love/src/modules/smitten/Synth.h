/**
 * Smitten: the sound synthesizer.
 *
 * Not part of upstream LÖVE. Renders sound effects (.sfx.json) and songs
 * (.song.json) to 44100 Hz mono float samples; see docs/reference.md,
 * "Sound effects" and "Songs". Plain C++ with no LÖVE dependencies, so the
 * same code builds into the engine (wrap_Synth.cpp) and into the editor's
 * synth.mjs (web/synth_web.cpp): the same parameters render the same samples
 * in both.
 *
 * Licensed under the zlib license, like LÖVE (see love/license.txt).
 **/

#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace love
{
namespace smitten
{
namespace synth
{

constexpr int SAMPLE_RATE = 44100;

// The longest sound effect rendered, in seconds. Longer envelopes are cut.
constexpr double MAX_SFX_SECONDS = 60.0;

// The longest song rendered (one pass through `order`), in seconds.
constexpr double MAX_SONG_SECONDS = 30.0 * 60.0;

enum Wave
{
	WAVE_SQUARE,
	WAVE_SAWTOOTH,
	WAVE_TRIANGLE,
	WAVE_SINE,
	WAVE_NOISE,
	WAVE_MAX_ENUM
};

// Name <-> Wave ("square", ...). getWave returns false for unknown names.
bool getWave(const char *name, Wave &wave);
const char *getWaveName(Wave wave);

// A sound effect. Field defaults are the documented defaults of .sfx.json.
struct SfxParams
{
	Wave wave = WAVE_SQUARE;
	double volume = 0.5;
	double attack = 0.0;
	double sustain = 0.08;
	double punch = 0.3;
	double decay = 0.25;
	double frequency = 440.0;
	double minFrequency = 30.0;
	double slide = 1.5;
	double deltaSlide = 0.0;
	double vibratoDepth = 0.0;
	double vibratoSpeed = 0.0;
	double arpeggio = 0.0;
	double arpeggioTime = 0.0;
	double duty = 0.5;
	double dutySweep = 0.0;
	double repeat = 0.0;
	double lowpass = 1.0;
	double highpass = 0.0;
	double bitcrush = 0.0;
};

// Numeric fields of SfxParams in a fixed order, for bindings that read them
// by name (Lua tables) or by index (the editor's flat arrays). `wave` is
// not in this list.
struct SfxField
{
	const char *name;
	double SfxParams::*member;
};
extern const SfxField SFX_FIELDS[];
extern const int SFX_FIELD_COUNT;

enum InstrumentType
{
	INSTRUMENT_SYNTH,
	INSTRUMENT_SFX,
	INSTRUMENT_MAX_ENUM
};

struct Instrument
{
	InstrumentType type = INSTRUMENT_SYNTH;

	// Synth instruments. `sustain` is a level (0-1), unlike in SfxParams.
	Wave wave = WAVE_SQUARE;
	double volume = 0.5;
	double attack = 0.01;
	double decay = 0.1;
	double sustain = 0.6;
	double release = 0.1;
	double duty = 0.5;
	double vibratoDepth = 0.0;
	double vibratoSpeed = 5.0;
	double lowpass = 1.0;

	// Sound-effect instruments (`volume` scales them too; 1 by default, set
	// by the bindings). hasSfx is false when the file couldn't be found: the
	// instrument is then silent.
	bool hasSfx = false;
	SfxParams sfx;
	bool pitched = false;
};

// Numeric fields of a synth Instrument, as SFX_FIELDS.
struct InstrumentField
{
	const char *name;
	double Instrument::*member;
};
extern const InstrumentField INSTRUMENT_FIELDS[];
extern const int INSTRUMENT_FIELD_COUNT;

struct Channel
{
	int instrument = 0;
	double volume = 1.0;
};

struct Note
{
	int channel = 0;
	double step = 0.0;
	double length = 1.0;
	double note = 60.0;
	double volume = 1.0;
};

struct Pattern
{
	std::vector<Note> notes;
};

struct Song
{
	double bpm = 120.0;
	double stepsPerBeat = 4.0;
	int patternLength = 32;
	bool loop = true;
	int loopStart = 0;
	std::vector<Channel> channels;
	std::vector<Instrument> instruments;
	std::vector<Pattern> patterns;
	std::vector<int> order;
};

struct SongRender
{
	std::vector<float> samples;

	// One pass through `order`, in samples (without release tails).
	size_t passLength = 0;

	// With loop layout: where playback jumps back to once it reaches the end
	// of `samples`. -1 when the song doesn't loop (then `samples` is one pass
	// plus the release tails).
	int64_t loopPoint = -1;
};

// Render a sound effect. pitch shifts it by that many semitones (used for
// pitched sound-effect instruments). Returns at least one sample.
std::vector<float> renderSfx(const SfxParams &params, double semitones = 0.0);

// Render a song.
//
// Without loopLayout, the result is one pass through `order` followed by
// whatever still rings (release tails, long sound effects).
//
// With loopLayout and a looping song, the result is laid out for gapless
// looping by a player that plays it from the start and, on reaching the end,
// continues from loopPoint (forever): the first pass, then the start of the
// loop section again with the previous pass's tails mixed in. Tails that
// ring past the end of the song are so heard over the loop's start, and the
// first pass has none over it.
SongRender renderSong(const Song &song, bool loopLayout = false);

// Length of one pass of a song in seconds.
double getSongDuration(const Song &song);

// A checksum of samples (FNV-1a over their 32-bit float representation), for
// checking that two builds render the same thing.
uint32_t checksum(const float *samples, size_t count);

} // synth
} // smitten
} // love
