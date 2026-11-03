/**
 * Smitten: a Decoder that plays a SoundData with a loop point.
 *
 * Not part of upstream LÖVE. Plays 16-bit mono SoundData from the start
 * and, on reaching its end, continues from the loop point, forever. A
 * streaming Source made from it (love.audio.newSource(decoder)) so plays a
 * song's intro once and then its loop section without gaps, and is refilled
 * like any streaming Source, which keeps it playing in background tabs.
 * The Source itself should not loop.
 *
 * Licensed under the zlib license, like LÖVE (see love/license.txt).
 **/

#pragma once

#include "common/int.h"
#include "sound/Decoder.h"
#include "sound/SoundData.h"

namespace love
{
namespace smitten
{

class LoopDecoder : public love::sound::Decoder
{
public:

	// loopPoint in samples; at or beyond the end of the data, the decoder
	// plays it once.
	LoopDecoder(love::sound::SoundData *data, int64 loopPoint, int bufferSize = DEFAULT_BUFFER_SIZE);
	virtual ~LoopDecoder();

	love::sound::Decoder *clone() override;
	int decode() override;
	bool seek(double s) override;
	bool rewind() override;
	bool isSeekable() override;
	int getChannelCount() const override;
	int getBitDepth() const override;
	double getDuration() override;

private:

	bool isLooping() const;

	StrongRef<love::sound::SoundData> data;
	int64 count;
	int64 loopPoint;
	int64 position;

}; // LoopDecoder

} // smitten
} // love
