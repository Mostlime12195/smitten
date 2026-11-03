/**
 * Smitten: the table of native functions (require("smitten.native")).
 *
 * Licensed under the zlib license, like LÖVE (see love/license.txt).
 **/

#include "wrap_Smitten.h"

namespace love
{
namespace smitten
{

const luaL_Reg native_functions[] =
{
	// wrap_Synth.cpp
	{ "synthRenderSfx", w_synthRenderSfx },
	{ "synthRenderSong", w_synthRenderSong },
	{ "synthNewLoopDecoder", w_synthNewLoopDecoder },

	{ nullptr, nullptr }
};

} // smitten
} // love
