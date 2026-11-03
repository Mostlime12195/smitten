# love.physics3d

3D physics for Smitten: a Lua binding for [Jolt Physics](https://github.com/jrouwe/JoltPhysics)
(v5.6.0, vendored in `deps/jolt/`). It is built as the optional `physics3d`
WebAssembly side module. The binding uses only the Lua 5.1 C API (full
userdata and metatables), Jolt and libc/libc++, none of LÖVE's C++ runtime.
The entry point is `extern "C" int luaopen_love_physics3d(lua_State *L)`. It
returns the module table and also sets `love.physics3d` if a global `love`
table exists.

| File | What's in it |
| --- | --- |
| `Physics3D.h` | Shared types: `World3D`, `Body3D`, `Character3D`, `Shape3D`, the contact listeners |
| `Physics3D.cpp` | Jolt setup, collision layers, contact bookkeeping, Lua helpers, `luaopen_love_physics3d` |
| `wrap_World3D.cpp`, `wrap_Body3D.cpp`, `wrap_Character3D.cpp`, `wrap_Shape3D.cpp` | The Lua types |

## Building

Sources:

- `love/src/modules/physics3d/*.cpp`
- `deps/jolt/Jolt/**/*.cpp`, minus `Compute/*/**`, `Shaders/**`,
  `ObjectStream/ObjectStream*.cpp` and `ObjectStream/TypeDeclarations.cpp`.
  That leaves 130 files, the same list as Jolt.cmake. The excluded files are
  `#ifdef`'d out or unused here, so compiling all of them also works; it's
  just slower. Keep `ObjectStream/SerializableObject.cpp`: it's needed.

Compile flags. Use them for both Jolt and the binding: the `JPH_*` defines
must match, or Jolt's layout changes.

```
-fwasm-exceptions -sSUPPORT_LONGJMP=wasm -msimd128 -O3 -fPIC -flto -std=c++20
-msse4.2 -DNDEBUG -DJPH_NO_DEBUG
-Ideps/jolt -Ideps/lua-5.1.5
```

- `-msse4.2` is required. Jolt's SIMD code is written with SSE intrinsics,
  which Emscripten turns into wasm SIMD. Without it, Jolt fails on
  `_mm_set_ss` / `__m128`. It's a header switch with no ABI change.
- Leave these undefined: `JPH_DEBUG_RENDERER`, `JPH_PROFILE_ENABLED`,
  `JPH_OBJECT_STREAM`, `JPH_ENABLE_ASSERTS`, `JPH_DOUBLE_PRECISION`,
  `JPH_FLOATING_POINT_EXCEPTIONS_ENABLED`, `JPH_USE_*`. That gives single
  precision with no debug renderer, profiler or serialization.
  `JPH_OBJECT_LAYER_BITS` stays at its default of 16.
- `deps/jolt` holds `VERSION.txt` instead of `VERSION`. On a
  case-insensitive file system, a file named `VERSION` in an include
  directory hides C++20's `<version>` header.
- `-Wall -Wextra -Wno-unused-parameter` builds the binding without warnings.

Linking the side module:

```
em++ <objects> -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -msimd128 -O3 -fPIC -flto \
  -sSIDE_MODULE=2 -sEXPORTED_FUNCTIONS=_luaopen_love_physics3d -o physics3d.wasm
```

Its size is 876,030 bytes (855 KiB), or 244,275 bytes (238 KiB) after
`gzip -9`. Building with `-Os` instead of `-O3` gives 709 KiB / 214 KiB.

physics3d.wasm imports about 78 functions from the main module:

- Lua C API functions
- `malloc`, `free`, `realloc`, `posix_memalign`, `snprintf`, `vsnprintf`,
  `strlen`, `strcmp`, `lrintf`, `sched_yield`, `abort`
- libc++ functions: `operator new`/`delete`, `std::mutex`,
  `std::__shared_mutex_base`, `std::condition_variable::~condition_variable`,
  `std::thread::hardware_concurrency`, `std::__next_prime`,
  `std::__hash_memory`, `__cxa_*`, `std::terminate`
- a few typeinfo/vtable GOT entries

A `MAIN_MODULE=2` core has to export all of these. The simplest way is to
put the side module on the core's link line with
`-sMAIN_MODULE=2 -sAUTOLOAD_DYLIBS=0 path/to/physics3d.wasm`. Emscripten then
exports exactly what the side module imports, but doesn't load it at
startup. Load it later with `dlopen` and call `luaopen_love_physics3d`; in
the browser, the file must be in the filesystem (preloaded) before you call
`dlopen`. `tools/physics3d/build.sh dyn` builds this setup and runs the
whole test suite through it.

## Test harness

```
zsh -ic 'tools/physics3d/build.sh'        # everything (about 1 min clean, seconds when cached)
zsh -ic 'tools/physics3d/build.sh test'   # build/p3test.js (statically linked), runs test.lua
zsh -ic 'tools/physics3d/build.sh side'   # build/physics3d.wasm, prints its size
zsh -ic 'tools/physics3d/build.sh dyn'    # build/p3dyn.js (MAIN_MODULE=2 + dlopen), runs test.lua
node tools/physics3d/build/p3test.js some.lua   # run any script (from the repo root)
```

Objects are cached in `tools/physics3d/build/`. The harness runs Lua with the
JIT enabled (`web/native/library_ljit.js`), as the engine does.
`tools/physics3d/test.lua` prints a PASS/FAIL line for each check and exits
non-zero if any check fails.

## Lua API

Units are meters, kilograms and seconds. y is up. Rotations are quaternions
`qx, qy, qz, qw`; they're normalized for you and default to the identity.
Every object has `:type()`, `:typeOf(name)` (also true for `"Object"`),
`:destroy()` / `:release()` and `:isDestroyed()` (on shapes,
`:isReleased()`). Using a destroyed object raises "Body3D has been
destroyed" (or the same message for the other types).

```lua
local p3 = require("love.physics3d")

p3.newWorld{gravity = {0, -9.81, 0}, maxBodies = 4096,
            maxBodyPairs = 4 * maxBodies, maxContactConstraints = 2 * maxBodies} -> World3D

World3D:update(dt)              -- fixed 1/60 s steps (accumulator, at most 4 per call), then callbacks
World3D:setGravity(x, y, z) / getGravity() -> x, y, z
World3D:newBody{type = "dynamic" | "static" | "kinematic", shape = Shape3D,
                x, y, z, qx, qy, qz, qw, mass = nil (from the shape: 1000 kg/m^3),
                friction = 0.5, restitution = 0, linearDamping = 0.05, angularDamping = 0.05,
                gravityScale = 1, layer = 1, mask = 0xFFFF, sensor = false,
                lockRotation = false, allowSleep = true} -> Body3D
World3D:newCharacter{shape = Shape3D, x, y, z, maxSlope = math.rad(50), stepHeight = 0.3,
                     layer = 1, mask = 0xFFFF, mass = 70, maxStrength = 100} -> Character3D
World3D:raycast(x, y, z, dx, dy, dz, mask = 0xFFFF)
  -> object, hitX, hitY, hitZ, normalX, normalY, normalZ, fraction   (or nil)
World3D:setCallbacks(begin, finish) / getCallbacks()
  -- begin(a, b, nx, ny, nz), finish(a, b); the normal points from a to b
World3D:getBodies() -> {Body3D...}; getBodyCount(); getCharacters() -> {Character3D...}
World3D:destroy()               -- also destroys its bodies and characters

p3.newBoxShape(hx, hy, hz)                  -- half extents
p3.newSphereShape(r)
p3.newCapsuleShape(halfHeight, r)           -- halfHeight of the cylinder part; y axis
p3.newCylinderShape(halfHeight, r)          -- y axis
p3.newConvexHullShape{x1, y1, z1, x2, ...}
p3.newMeshShape(vertices, indices)          -- flat lists; 1-based triangles; static bodies only
p3.newCompoundShape{{shape, x, y, z, qx, qy, qz, qw}, ...}
Shape3D:getType() -> "box" | "sphere" | "capsule" | "cylinder" | "convexhull" | "mesh" | "compound"

Body3D:getPosition() / setPosition(x, y, z)
Body3D:getRotation() / setRotation(qx, qy, qz, qw)
Body3D:getTransform() -> x, y, z, qx, qy, qz, qw;  setTransform(x, y, z, qx, qy, qz, qw)
Body3D:getLinearVelocity() / setLinearVelocity(x, y, z)
Body3D:getAngularVelocity() / setAngularVelocity(x, y, z)
Body3D:applyForce(fx, fy, fz [, px, py, pz]); applyTorque(x, y, z)
Body3D:applyImpulse(ix, iy, iz [, px, py, pz]); applyAngularImpulse(x, y, z)
Body3D:moveKinematic(x, y, z, qx, qy, qz, qw, dt)
Body3D:getType(); getMass(); isSensor(); isAwake(); wake()
Body3D:setGravityScale(s) / getGravityScale()
Body3D:setFriction(f) / getFriction(); setRestitution(r) / getRestitution()
Body3D:setLayer(layer [, mask]) / getLayer() -> layer, mask
Body3D:setUserData(value) / getUserData()

Character3D:update(dt)
Character3D:getPosition() / setPosition(x, y, z)
Character3D:getLinearVelocity() / setLinearVelocity(x, y, z)
Character3D:isOnGround(); getGroundState() -> "onground" | "onsteepground" | "notsupported" | "inair"
Character3D:getGroundNormal() -> x, y, z; getGroundVelocity() -> x, y, z
Character3D:setLayer(layer [, mask]) / getLayer()
Character3D:setUserData(value) / getUserData()
```

How it behaves:

- **Layers.** Two objects collide when `(a.layer & b.mask) ~= 0` and
  `(b.layer & a.mask) ~= 0`. Layers and masks are 16-bit. Static bodies use
  Jolt's non-moving broad phase layer.
- **Forces.** `applyForce` and `applyTorque` act during every fixed step of
  the next `World3D:update`, so the effect doesn't depend on the frame
  rate; call them every frame. Impulses change the velocity at once.
  Only dynamic bodies react to forces and impulses.
- **Callbacks.** They run inside `update` once the steps are done, never
  while Jolt is stepping. You can destroy bodies, or the world, inside a
  callback. There's one begin and one finish per pair of objects, not per
  sub-shape. A body falling asleep doesn't end its contacts. Sensors report
  overlaps. Contacts that involve a character are reported from
  `Character3D:update`, with the character as `a`.
- **Characters.** A character is a Jolt `CharacterVirtual`: a shape moved by
  collision queries. Its position is the shape's origin, which for a
  capsule is its center. `update(dt)`:
  1. Adds the world's gravity to the vertical velocity.
  2. While the character stands on the ground, keeps its vertical velocity
     at the ground's, unless you set an upward velocity (a jump).
  3. Moves with stair stepping (`stepHeight`) and stick-to-floor.

  Slopes steeper than `maxSlope` act as walls. Characters push dynamic
  bodies with up to `maxStrength` newtons. To ride a moving platform, add
  `getGroundVelocity()` to the velocity you set.
- **Raycasts.** They don't hit sensors. They do hit characters.
- **Resting depth.** Jolt lets resting bodies sink up to 2 cm into each
  other (its penetration slop).

Known limits:

- Rigid bodies don't see characters. A box falling onto a character that
  stands still passes through it. Fixing this needs a Jolt inner body for
  the character.
- Mesh shapes only work on static bodies.
- There are no joints or constraints yet.
