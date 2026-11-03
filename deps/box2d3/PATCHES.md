# Smitten's changes to Box2D 3.1.1

This is our fork: change it freely, and list every change here (search the
sources for "Smitten" to find them). Built into the `physics2d` side module
by build.py; the Lua binding is love/src/modules/physics2d/wrap_box2d.c.

## Character mover of any convex shape (world.c, shape.c, shape.h, box2d.h)

Box2D's mover (`b2World_CastMover`, `b2World_CollideMover`) is a capsule.
Scripted Bodies are boxes, circles, capsules or polygons, so:

- `b2World_CastMoverProxy(world, proxy, translation, filter, accept, context)`
  and `b2World_CollideMoverProxy(world, proxy, filter, accept, fcn, context)`
  take a `b2ShapeProxy` (a rounded polygon: points plus a radius, which must
  be more than twice the linear slop) in world space.
- `accept` (`b2MoverFilterFcn`, optional) can skip shapes: the binding uses
  it for the mover's own body, sensors, tags it passes through and one-way
  platforms it's below.
- `b2CollideMoverProxy` (shape.c) is `b2CollideMover` for a proxy: the
  distance between the shape's core and the mover's, against their radii.

## Pre-solve on chains (types.h, shape.c)

`b2ChainDef.enablePreSolveEvents` (false by default) is passed on to the
chain's segments, so one-way tiles can use a pre-solve callback.

## No sched_yield on the web (timer.c)

`b2Yield` does nothing under Emscripten: the game runs on one thread, and
the engine's core doesn't export `sched_yield` to side modules.

## Build settings (build.py, not source changes)

- Compiled as C17 (`-std=gnu17`) with `deps/box2d3/include` ahead of LÖVE's
  Box2D 2.4 headers (`box2d/Box2D.h` would otherwise match on
  case-insensitive disks).
- `-msse2`: Box2D's SSE2 solver path, which Emscripten maps onto WebAssembly
  SIMD. It gives the same results as the scalar build
  (`-DBOX2D_DISABLE_SIMD`); on the stress cases the two are within noise.
- `b2SetLengthUnitsPerMeter(64)`: pixels are the length unit.
