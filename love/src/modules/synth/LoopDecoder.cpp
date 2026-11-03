/**
 * Smitten: a Decoder that plays a SoundData with a loop point. See
 * LoopDecoder.h.
 *
 * Licensed under the zlib license, like LÖVE (see love/license.txt).
 **/

#include "LoopDecoder.h"

#include "common/Exception.h"
#include "data/DataStream.h"

#include <algorithm>
#include <cstring>

namespace love
{
namespace smitten
{

static Stream *newStream(love::sound::SoundData *data)
{
	if (data->getBitDepth() != 16 || data->getChannelCount() != 1)
		throw love::Exception("LoopDecoder needs 16-bit mono SoundData.");
	return new love::data::DataStream(data);
}

LoopDecoder::LoopDecoder(love::sound::SoundData *data, int64 loopPoint, int bufferSize)
	: Decoder(newStream(data), bufferSize)
	, data(data)
	, count((int64) data->getSampleCount())
	, loopPoint(std::max<int64>(loopPoint, 0))
	, position(0)
{
	// Decoder retained the stream; drop the reference newStream returned.
	stream->release();
	sampleRate = data->getSampleRate();
}

LoopDecoder::~LoopDecoder()
{
}

love::sound::Decoder *LoopDecoder::clone()
{
	return new LoopDecoder(data.get(), loopPoint, bufferSize);
}

bool LoopDecoder::isLooping() const
{
	return loopPoint < count;
}

int LoopDecoder::decode()
{
	int16 *out = (int16 *) buffer;
	const int16 *src = (const int16 *) data->getData();
	int64 want = bufferSize / (int64) sizeof(int16);
	int64 n = 0;

	while (n < want)
	{
		if (position >= count)
		{
			if (!isLooping())
				break;
			position = loopPoint;
		}
		int64 chunk = std::min(want - n, count - position);
		memcpy(out + n, src + position, (size_t) chunk * sizeof(int16));
		n += chunk;
		position += chunk;
	}

	if (!isLooping() && position >= count)
		eof = true;

	return (int) (n * (int64) sizeof(int16));
}

bool LoopDecoder::seek(double s)
{
	int64 target = (int64) (std::max(s, 0.0) * sampleRate);
	if (target >= count && isLooping())
		target = loopPoint + (target - loopPoint) % (count - loopPoint);
	position = std::min(target, count);
	eof = !isLooping() && position >= count;
	return true;
}

bool LoopDecoder::rewind()
{
	position = 0;
	eof = false;
	return true;
}

bool LoopDecoder::isSeekable()
{
	return true;
}

int LoopDecoder::getChannelCount() const
{
	return 1;
}

int LoopDecoder::getBitDepth() const
{
	return 16;
}

double LoopDecoder::getDuration()
{
	return (double) count / (double) sampleRate;
}

} // smitten
} // love
