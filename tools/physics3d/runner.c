/*
** Runs a Lua script with love.physics3d available through require, for the
** physics3d test harness (see build.sh): node build/p3test.js script.lua [args]
**
** Built with -DPHYSICS3D_DLOPEN="path", require("love.physics3d") loads the
** side module from that path with dlopen instead (build/p3dyn.js).
*/

#include <stdio.h>

#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"

#ifdef PHYSICS3D_DLOPEN
#include <dlfcn.h>

static int luaopen_love_physics3d (lua_State *L) {
  lua_CFunction open;
  void *lib = dlopen(PHYSICS3D_DLOPEN, RTLD_NOW | RTLD_GLOBAL);
  if (lib == NULL)
    return luaL_error(L, "can't load %s: %s", PHYSICS3D_DLOPEN, dlerror());
  open = (lua_CFunction) dlsym(lib, "luaopen_love_physics3d");
  if (open == NULL)
    return luaL_error(L, "%s has no luaopen_love_physics3d", PHYSICS3D_DLOPEN);
  return open(L);
}
#else
int luaopen_love_physics3d (lua_State *L);
#endif

static int traceback (lua_State *L) {
  lua_getglobal(L, "debug");
  lua_getfield(L, -1, "traceback");
  lua_pushvalue(L, 1);
  lua_pushinteger(L, 2);
  lua_call(L, 2, 1);
  return 1;
}

int main (int argc, char **argv) {
  lua_State *L;
  int i, status;
  if (argc < 2) {
    fprintf(stderr, "usage: node p3test.js script.lua [args]\n");
    return 2;
  }
  L = luaL_newstate();
  luaL_openlibs(L);

  lua_getglobal(L, "package");
  lua_getfield(L, -1, "preload");
  lua_pushcfunction(L, luaopen_love_physics3d);
  lua_setfield(L, -2, "love.physics3d");
  lua_pop(L, 2);

  lua_newtable(L);
  for (i = 1; i < argc; i++) {
    lua_pushstring(L, argv[i]);
    lua_rawseti(L, -2, i - 1);
  }
  lua_setglobal(L, "arg");

  lua_pushcfunction(L, traceback);
  status = luaL_loadfile(L, argv[1]);
  if (status == 0) {
    for (i = 2; i < argc; i++)
      lua_pushstring(L, argv[i]);
    status = lua_pcall(L, argc - 2, 0, 1);
  }
  if (status != 0) {
    fprintf(stderr, "%s\n", lua_tostring(L, -1));
    lua_close(L);
    return 1;
  }
  lua_close(L);
  return 0;
}
