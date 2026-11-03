/**
 * Smitten: native functions of the `smitten` engine module.
 *
 * Each feature that needs C++ adds its functions to native_functions in its
 * own wrap_*.cpp file and lists them here. The Lua side reaches them through
 * require("smitten.native").
 *
 * Licensed under the zlib license, like LÖVE (see love/license.txt).
 **/

#pragma once

#include "common/runtime.h"

namespace love
{
namespace smitten
{

// Defined in wrap_Native.cpp.
extern const luaL_Reg native_functions[];

// wrap_Synth.cpp
int w_synthRenderSfx(lua_State *L);
int w_synthRenderSong(lua_State *L);
int w_synthNewLoopDecoder(lua_State *L);

} // smitten
} // love

extern "C" int luaopen_smitten(lua_State *L);
