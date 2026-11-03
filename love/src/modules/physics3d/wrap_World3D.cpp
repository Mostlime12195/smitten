/**
 * Smitten: love.physics3d. World3D.
 **/

#include "Physics3D.h"

#include <Jolt/Physics/Body/BodyLockInterface.h>
#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/Shape/SubShapeID.h>

#include <algorithm>
#include <cfloat>
#include <cmath>

namespace love
{
namespace physics3d
{

// The World3D userdata. The C++ world is deleted by __gc only, so code that
// keeps the userdata on the Lua stack can keep using it after destroy().
struct WorldUserdata
{
	World3D *world;
};

// registry[WORLDS_KEY] maps lightuserdata(World3D *) to its userdata, weakly,
// so Character3D:update can keep the world alive while it calls Lua.
static const char *const WORLDS_KEY = "love.physics3d.worlds";

World3D *checkWorld(lua_State *L, int idx)
{
	WorldUserdata *u = (WorldUserdata *) luaL_checkudata(L, idx, WORLD3D);
	if (u->world == nullptr || u->world->system == nullptr)
		luaL_error(L, "World3D has been destroyed");
	return u->world;
}

static int pushObject(lua_State *L, World3D *w, uint32_t key)
{
	if (key & CHARACTER_KEY)
	{
		for (Character3D *c : w->characters)
			if (characterKey(c->cv) == key)
				return pushRef(L, c->selfRef), 1;
		return 0;
	}
	Body3D *b = (Body3D *) (uintptr_t) w->system->GetBodyInterfaceNoLock().GetUserData(JPH::BodyID(key));
	if (b == nullptr)
		return 0;
	pushRef(L, b->selfRef);
	return 1;
}

void dispatchEvents(lua_State *L, World3D *w)
{
	// Events are taken one at a time from the shared queue, so a callback can
	// destroy objects, step the world or raise an error safely.
	while (w->system != nullptr && w->eventHead < w->events.size())
	{
		ContactEvent e = w->events[w->eventHead++];
		int ref = e.begin ? w->beginRef : w->endRef;
		if (ref == LUA_NOREF)
			continue;
		int top = lua_gettop(L);
		pushRef(L, ref);
		if (!pushObject(L, w, e.a) || !pushObject(L, w, e.b))
		{
			lua_settop(L, top);
			continue;
		}
		if (e.begin)
		{
			lua_pushnumber(L, e.nx);
			lua_pushnumber(L, e.ny);
			lua_pushnumber(L, e.nz);
		}
		lua_call(L, e.begin ? 5 : 2, 0);
	}
	w->events.clear();
	w->eventHead = 0;
}

static void applyForces(World3D *w)
{
	JPH::BodyInterface &bi = w->system->GetBodyInterfaceNoLock();
	for (Body3D *b : w->forced)
		bi.AddForceAndTorque(b->id, JPH::Vec3(b->force[0], b->force[1], b->force[2]), JPH::Vec3(b->torque[0], b->torque[1], b->torque[2]));
}

static void clearForces(World3D *w)
{
	for (Body3D *b : w->forced)
	{
		b->forced = false;
		b->force[0] = b->force[1] = b->force[2] = 0.0f;
		b->torque[0] = b->torque[1] = b->torque[2] = 0.0f;
	}
	w->forced.clear();
}

static void step(World3D *w, double dt)
{
	w->accumulator += dt;
	int steps = (int) std::floor(w->accumulator / FIXED_STEP + 1.0e-6);
	if (steps > MAX_STEPS)
	{
		// Too far behind (a slow frame): drop the time we can't catch up on.
		steps = MAX_STEPS;
		w->accumulator = FIXED_STEP * MAX_STEPS;
	}
	w->accumulator = std::max(0.0, w->accumulator - steps * FIXED_STEP);

	for (int i = 0; i < steps; i++)
	{
		// Jolt's broad phase tree is built incrementally; after adding many
		// bodies at once (loading a level) rebuilding it is faster.
		if (w->addedSinceStep > 0 && (!w->stepped || w->addedSinceStep >= 64))
			w->system->OptimizeBroadPhase();
		w->stepped = true;
		w->addedSinceStep = 0;
		// Forces apply for the whole update: Jolt clears them after each step.
		applyForces(w);
		w->system->Update((float) FIXED_STEP, 1, &tempAllocator(), &jobSystem());
		w->reconcileContacts();
	}
	clearForces(w);
}

static int w_World_update(lua_State *L)
{
	World3D *w = checkWorld(L, 1);
	double dt = luaL_checknumber(L, 2);
	if (!(dt >= 0.0) || !std::isfinite(dt))
		return luaL_error(L, "World3D:update: dt must be a number >= 0 (got %f)", dt);
	step(w, dt);
	dispatchEvents(L, w);
	return 0;
}

static int w_World_setGravity(lua_State *L)
{
	World3D *w = checkWorld(L, 1);
	float x = checkFloat(L, 2), y = checkFloat(L, 3), z = checkFloat(L, 4);
	w->system->SetGravity(JPH::Vec3(x, y, z));
	// Sleeping bodies don't notice the change on their own.
	JPH::BodyInterface &bi = w->system->GetBodyInterfaceNoLock();
	for (Body3D *b : w->bodies)
		if (b->motion == JPH::EMotionType::Dynamic)
			bi.ActivateBody(b->id);
	return 0;
}

static int w_World_getGravity(lua_State *L)
{
	World3D *w = checkWorld(L, 1);
	JPH::Vec3 g = w->system->GetGravity();
	lua_pushnumber(L, g.GetX());
	lua_pushnumber(L, g.GetY());
	lua_pushnumber(L, g.GetZ());
	return 3;
}

static int w_World_newBody(lua_State *L)
{
	return newBody(L, checkWorld(L, 1));
}

static int w_World_newCharacter(lua_State *L)
{
	return newCharacter(L, checkWorld(L, 1));
}

namespace
{

class LayerMaskFilter final : public JPH::ObjectLayerFilter
{
public:
	explicit LayerMaskFilter(uint16_t mask) : mask(mask) {}
	bool ShouldCollide(JPH::ObjectLayer l) const override { return (objectLayerBits(l) & mask) != 0; }
	uint16_t mask;
};

class NoSensorsFilter final : public JPH::BodyFilter
{
public:
	bool ShouldCollideLocked(const JPH::Body &body) const override { return !body.IsSensor(); }
};

struct RayHit
{
	int ref; // selfRef of the body or character hit
	float fraction;
	float point[3], normal[3];
};

} // anonymous namespace

static bool raycast(World3D *w, JPH::Vec3 origin, JPH::Vec3 direction, uint16_t mask, RayHit *hit)
{
	JPH::RRayCast ray(origin, direction);
	JPH::RayCastResult result;
	JPH::Vec3 normal = JPH::Vec3::sZero();
	bool found = false;

	LayerMaskFilter layers(mask);
	NoSensorsFilter noSensors;
	if (w->system->GetNarrowPhaseQueryNoLock().CastRay(ray, result, {}, layers, noSensors))
	{
		const JPH::Body *body = w->system->GetBodyLockInterfaceNoLock().TryGetBody(result.mBodyID);
		if (body != nullptr)
		{
			found = true;
			hit->ref = ((Body3D *) (uintptr_t) body->GetUserData())->selfRef;
			normal = body->GetWorldSpaceSurfaceNormal(result.mSubShapeID2, ray.GetPointOnRay(result.mFraction));
		}
	}

	// Characters aren't in Jolt's broad phase: test their shapes directly.
	for (Character3D *c : w->characters)
	{
		if ((c->layer & mask) == 0)
			continue;
		JPH::RMat44 transform = c->cv->GetCenterOfMassTransform();
		JPH::RayCast local(ray.Transformed(transform.InversedRotationTranslation()));
		JPH::RayCastResult r;
		r.mFraction = found ? result.mFraction : 1.0f + FLT_EPSILON;
		if (c->cv->GetShape()->CastRay(local, JPH::SubShapeIDCreator(), r))
		{
			found = true;
			result.mFraction = r.mFraction;
			hit->ref = c->selfRef;
			normal = transform.Multiply3x3(c->cv->GetShape()->GetSurfaceNormal(r.mSubShapeID2, local.GetPointOnRay(r.mFraction)));
		}
	}

	if (found)
	{
		JPH::Vec3 p = ray.GetPointOnRay(result.mFraction);
		hit->fraction = result.mFraction;
		hit->point[0] = p.GetX();
		hit->point[1] = p.GetY();
		hit->point[2] = p.GetZ();
		hit->normal[0] = normal.GetX();
		hit->normal[1] = normal.GetY();
		hit->normal[2] = normal.GetZ();
	}
	return found;
}

static int w_World_raycast(lua_State *L)
{
	World3D *w = checkWorld(L, 1);
	JPH::Vec3 origin(checkFloat(L, 2), checkFloat(L, 3), checkFloat(L, 4));
	JPH::Vec3 direction(checkFloat(L, 5), checkFloat(L, 6), checkFloat(L, 7));
	uint16_t mask = optBits(L, 8, 0xFFFF, "Raycast mask");
	RayHit hit;
	if (!raycast(w, origin, direction, mask, &hit))
	{
		lua_pushnil(L);
		return 1;
	}
	pushRef(L, hit.ref);
	for (float v : hit.point)
		lua_pushnumber(L, v);
	for (float v : hit.normal)
		lua_pushnumber(L, v);
	lua_pushnumber(L, hit.fraction);
	return 8;
}

static int w_World_setCallbacks(lua_State *L)
{
	World3D *w = checkWorld(L, 1);
	if (!lua_isnoneornil(L, 2))
		luaL_checktype(L, 2, LUA_TFUNCTION);
	if (!lua_isnoneornil(L, 3))
		luaL_checktype(L, 3, LUA_TFUNCTION);
	lua_settop(L, 3);
	setRef(L, &w->beginRef, 2);
	setRef(L, &w->endRef, 3);
	return 0;
}

static int w_World_getCallbacks(lua_State *L)
{
	World3D *w = checkWorld(L, 1);
	pushRef(L, w->beginRef);
	pushRef(L, w->endRef);
	return 2;
}

static int w_World_getBodies(lua_State *L)
{
	World3D *w = checkWorld(L, 1);
	lua_createtable(L, (int) w->bodies.size(), 0);
	int i = 1;
	for (Body3D *b : w->bodies)
	{
		pushRef(L, b->selfRef);
		lua_rawseti(L, -2, i++);
	}
	return 1;
}

static int w_World_getBodyCount(lua_State *L)
{
	World3D *w = checkWorld(L, 1);
	lua_pushinteger(L, (lua_Integer) w->bodies.size());
	return 1;
}

static int w_World_getCharacters(lua_State *L)
{
	World3D *w = checkWorld(L, 1);
	lua_createtable(L, (int) w->characters.size(), 0);
	int i = 1;
	for (Character3D *c : w->characters)
	{
		pushRef(L, c->selfRef);
		lua_rawseti(L, -2, i++);
	}
	return 1;
}

void destroyWorld(lua_State *L, World3D *w)
{
	if (w->system == nullptr)
		return;
	while (!w->characters.empty())
		destroyCharacter(L, w->characters.back());
	// Deleting the system deletes its bodies; only the Lua side is left.
	for (Body3D *b : w->bodies)
	{
		b->world = nullptr;
		b->forced = false;
		clearRef(L, &b->userRef);
		clearRef(L, &b->selfRef);
	}
	w->bodies.clear();
	w->forced.clear();
	delete w->system;
	w->system = nullptr;
	w->bodyPairs.clear();
	w->dirtyPairs.clear();
	w->sleepingPairs.clear();
	w->characterPairs.clear();
	w->events.clear();
	w->eventHead = 0;
	clearRef(L, &w->beginRef);
	clearRef(L, &w->endRef);
}

static int w_World_destroy(lua_State *L)
{
	WorldUserdata *u = (WorldUserdata *) luaL_checkudata(L, 1, WORLD3D);
	if (u->world != nullptr)
		destroyWorld(L, u->world);
	return 0;
}

static int w_World_isDestroyed(lua_State *L)
{
	WorldUserdata *u = (WorldUserdata *) luaL_checkudata(L, 1, WORLD3D);
	lua_pushboolean(L, u->world == nullptr || u->world->system == nullptr);
	return 1;
}

static int w_World_typeOf(lua_State *L)
{
	luaL_checkudata(L, 1, WORLD3D);
	return typeOf(L, WORLD3D);
}

static int w_World_gc(lua_State *L)
{
	WorldUserdata *u = (WorldUserdata *) lua_touserdata(L, 1);
	if (u->world != nullptr)
	{
		destroyWorld(L, u->world);
		delete u->world;
		u->world = nullptr;
	}
	return 0;
}

struct WorldParams
{
	float gravity[3];
	int maxBodies, maxBodyPairs, maxContactConstraints;
};

static int fieldInt(lua_State *L, int idx, const char *name, int def, int min, int max)
{
	float v = fieldFloat(L, idx, name, (float) def, "newWorld");
	if (!(v >= min && v <= max) || std::floor(v) != v)
		luaL_error(L, "newWorld: field '%s' must be an integer from %d to %d", name, min, max);
	return (int) v;
}

static World3D *createWorld(const WorldParams &p)
{
	World3D *w = new World3D();
	w->system = new JPH::PhysicsSystem();
	w->system->Init(p.maxBodies, 0, p.maxBodyPairs, p.maxContactConstraints, broadPhaseLayers(), objectVsBroadPhaseFilter(), objectLayerPairFilter());
	w->system->SetGravity(JPH::Vec3(p.gravity[0], p.gravity[1], p.gravity[2]));
	w->contactListener.world = w;
	w->characterListener.world = w;
	w->system->SetContactListener(&w->contactListener);
	return w;
}

int w_newWorld(lua_State *L)
{
	WorldParams p = {{0.0f, -9.81f, 0.0f}, 4096, 0, 0};
	if (!lua_isnoneornil(L, 1))
	{
		luaL_checktype(L, 1, LUA_TTABLE);
		lua_getfield(L, 1, "gravity");
		if (!lua_isnil(L, -1))
		{
			if (!lua_istable(L, -1))
				return luaL_error(L, "newWorld: field 'gravity' must be a table {x, y, z}");
			for (int i = 0; i < 3; i++)
			{
				lua_rawgeti(L, -1, i + 1);
				if (lua_type(L, -1) != LUA_TNUMBER)
					return luaL_error(L, "newWorld: gravity[%d] must be a number", i + 1);
				p.gravity[i] = (float) lua_tonumber(L, -1);
				lua_pop(L, 1);
			}
		}
		lua_pop(L, 1);
		p.maxBodies = fieldInt(L, 1, "maxBodies", p.maxBodies, 1, (int) JPH::BodyID::cMaxBodyIndex);
		p.maxBodyPairs = fieldInt(L, 1, "maxBodyPairs", 0, 0, 1 << 24);
		p.maxContactConstraints = fieldInt(L, 1, "maxContactConstraints", 0, 0, 1 << 24);
	}
	if (p.maxBodyPairs == 0)
		p.maxBodyPairs = std::max(1024, p.maxBodies * 4);
	if (p.maxContactConstraints == 0)
		p.maxContactConstraints = std::max(1024, p.maxBodies * 2);

	WorldUserdata *u = (WorldUserdata *) lua_newuserdata(L, sizeof(WorldUserdata));
	u->world = nullptr;
	luaL_getmetatable(L, WORLD3D);
	lua_setmetatable(L, -2);

	lua_getfield(L, LUA_REGISTRYINDEX, WORLDS_KEY);
	u->world = createWorld(p);
	lua_pushlightuserdata(L, u->world);
	lua_pushvalue(L, -3);
	lua_rawset(L, -3);
	lua_pop(L, 1);
	return 1;
}

// Pushes the World3D userdata of w (used to keep it alive while calling Lua).
void pushWorld(lua_State *L, World3D *w)
{
	lua_getfield(L, LUA_REGISTRYINDEX, WORLDS_KEY);
	lua_pushlightuserdata(L, w);
	lua_rawget(L, -2);
	lua_remove(L, -2);
}

static const luaL_Reg worldMethods[] = {
	{"update", w_World_update},
	{"setGravity", w_World_setGravity},
	{"getGravity", w_World_getGravity},
	{"newBody", w_World_newBody},
	{"newCharacter", w_World_newCharacter},
	{"raycast", w_World_raycast},
	{"setCallbacks", w_World_setCallbacks},
	{"getCallbacks", w_World_getCallbacks},
	{"getBodies", w_World_getBodies},
	{"getBodyCount", w_World_getBodyCount},
	{"getCharacters", w_World_getCharacters},
	{"destroy", w_World_destroy},
	{"release", w_World_destroy},
	{"isDestroyed", w_World_isDestroyed},
	{"typeOf", w_World_typeOf},
	{nullptr, nullptr}
};

void registerWorld3D(lua_State *L)
{
	newMetatable(L, WORLD3D, worldMethods, w_World_gc);

	lua_getfield(L, LUA_REGISTRYINDEX, WORLDS_KEY);
	bool exists = lua_istable(L, -1);
	lua_pop(L, 1);
	if (exists)
		return;
	lua_newtable(L);
	lua_newtable(L);
	lua_pushstring(L, "v");
	lua_setfield(L, -2, "__mode");
	lua_setmetatable(L, -2);
	lua_setfield(L, LUA_REGISTRYINDEX, WORLDS_KEY);
}

} // physics3d
} // love
