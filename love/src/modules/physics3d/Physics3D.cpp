/**
 * Smitten: love.physics3d. Jolt setup, collision layers, shared Lua helpers
 * and the module entry point.
 **/

#include "Physics3D.h"

#include <Jolt/Core/Factory.h>
#include <Jolt/Physics/Body/BodyLockInterface.h>
#include <Jolt/Physics/Collision/CollisionDispatch.h>
#include <Jolt/Physics/Collision/PhysicsMaterialSimple.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/ConvexHullShape.h>
#include <Jolt/Physics/Collision/Shape/CylinderShape.h>
#include <Jolt/Physics/Collision/Shape/EmptyShape.h>
#include <Jolt/Physics/Collision/Shape/MeshShape.h>
#include <Jolt/Physics/Collision/Shape/OffsetCenterOfMassShape.h>
#include <Jolt/Physics/Collision/Shape/RotatedTranslatedShape.h>
#include <Jolt/Physics/Collision/Shape/ScaledShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/Collision/Shape/StaticCompoundShape.h>
#include <Jolt/Physics/Collision/Shape/TriangleShape.h>
#include <Jolt/RegisterTypes.h>

#include <cmath>
#include <cstring>

namespace love
{
namespace physics3d
{

const char *const WORLD3D = "World3D";
const char *const BODY3D = "Body3D";
const char *const CHARACTER3D = "Character3D";
const char *const SHAPE3D = "Shape3D";

// ---------------------------------------------------------------------------
// Jolt setup (once per process)
// ---------------------------------------------------------------------------

static JPH::TempAllocator *gTempAllocator = nullptr;
static JPH::JobSystem *gJobSystem = nullptr;

void initJolt()
{
	if (gJobSystem != nullptr)
		return;

	JPH::RegisterDefaultAllocator();

#ifdef PHYSICS3D_REGISTER_ALL_TYPES
	JPH::Factory::sInstance = new JPH::Factory();
	JPH::RegisterTypes();
#else
	// JPH::RegisterTypes() registers every shape, constraint, vehicle,
	// ragdoll, soft body and hair type with the serialization factory, which
	// keeps all of their code in the module. Only the collision functions of
	// the shapes this module creates are needed (the factory is only used to
	// restore saved shapes, which this module doesn't do). Add a shape's
	// sRegister() here when the Lua API gains it.
	JPH::CollisionDispatch::sInit();
	JPH::CompoundShape::sRegister();
	JPH::ConvexShape::sRegister();
	JPH::StaticCompoundShape::sRegister();
	JPH::TriangleShape::sRegister();
	JPH::SphereShape::sRegister();
	JPH::BoxShape::sRegister();
	JPH::CapsuleShape::sRegister();
	JPH::CylinderShape::sRegister();
	JPH::MeshShape::sRegister();
	JPH::ConvexHullShape::sRegister();
	JPH::RotatedTranslatedShape::sRegister();
	JPH::OffsetCenterOfMassShape::sRegister();
	JPH::ScaledShape::sRegister();
	JPH::EmptyShape::sRegister();
	if (JPH::PhysicsMaterial::sDefault == nullptr)
		JPH::PhysicsMaterial::sDefault = new JPH::PhysicsMaterialSimple("Default", JPH::Color::sGrey);
#endif

	// Single-threaded: the web build has no threads. The temp allocator falls
	// back to malloc when a step needs more than its buffer.
	gTempAllocator = new JPH::TempAllocatorImplWithMallocFallback(2 * 1024 * 1024);
	gJobSystem = new JPH::JobSystemSingleThreaded(JPH::cMaxPhysicsJobs);
}

JPH::TempAllocator &tempAllocator()
{
	return *gTempAllocator;
}

JPH::JobSystem &jobSystem()
{
	return *gJobSystem;
}

// ---------------------------------------------------------------------------
// Collision layers
//
// Each body and character has a 16-bit layer (the layers it is on) and a
// 16-bit mask (the layers it collides with); two objects collide when
// (a.layer & b.mask) ~= 0 and (b.layer & a.mask) ~= 0. Jolt's ObjectLayer is
// an index into a table of the distinct (layer, mask, moving) combinations in
// use, so filtering is one table lookup per object and static bodies still go
// to their own broad phase layer.
// ---------------------------------------------------------------------------

namespace
{

struct LayerInfo
{
	uint16_t bits, mask;
	bool moving;
};

std::vector<LayerInfo> gLayers;
std::unordered_map<uint64_t, JPH::ObjectLayer> gLayerIndex;

const JPH::BroadPhaseLayer BP_NON_MOVING(0);
const JPH::BroadPhaseLayer BP_MOVING(1);

class BroadPhaseLayers final : public JPH::BroadPhaseLayerInterface
{
public:
	JPH::uint GetNumBroadPhaseLayers() const override { return 2; }

	JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer l) const override
	{
		return gLayers[l].moving ? BP_MOVING : BP_NON_MOVING;
	}

#if defined(JPH_EXTERNAL_PROFILE) || defined(JPH_PROFILE_ENABLED)
	const char *GetBroadPhaseLayerName(JPH::BroadPhaseLayer l) const override
	{
		return l == BP_MOVING ? "MOVING" : "NON_MOVING";
	}
#endif
};

class ObjectVsBroadPhase final : public JPH::ObjectVsBroadPhaseLayerFilter
{
public:
	bool ShouldCollide(JPH::ObjectLayer l, JPH::BroadPhaseLayer bp) const override
	{
		// Static objects only need to be tested against moving ones.
		return gLayers[l].moving || bp == BP_MOVING;
	}
};

class ObjectLayerPairs final : public JPH::ObjectLayerPairFilter
{
public:
	bool ShouldCollide(JPH::ObjectLayer l1, JPH::ObjectLayer l2) const override
	{
		const LayerInfo &a = gLayers[l1];
		const LayerInfo &b = gLayers[l2];
		return (a.bits & b.mask) != 0 && (b.bits & a.mask) != 0;
	}
};

BroadPhaseLayers gBroadPhaseLayers;
ObjectVsBroadPhase gObjectVsBroadPhase;
ObjectLayerPairs gObjectLayerPairs;

} // anonymous namespace

const JPH::BroadPhaseLayerInterface &broadPhaseLayers() { return gBroadPhaseLayers; }
const JPH::ObjectVsBroadPhaseLayerFilter &objectVsBroadPhaseFilter() { return gObjectVsBroadPhase; }
const JPH::ObjectLayerPairFilter &objectLayerPairFilter() { return gObjectLayerPairs; }

JPH::ObjectLayer internObjectLayer(uint16_t layer, uint16_t mask, bool moving)
{
	uint64_t key = (uint64_t) layer | ((uint64_t) mask << 16) | ((uint64_t) moving << 32);
	auto it = gLayerIndex.find(key);
	if (it != gLayerIndex.end())
		return it->second;
	if (gLayers.size() >= JPH::cObjectLayerInvalid)
		return JPH::cObjectLayerInvalid;
	JPH::ObjectLayer l = (JPH::ObjectLayer) gLayers.size();
	gLayers.push_back({layer, mask, moving});
	gLayerIndex.emplace(key, l);
	return l;
}

uint16_t objectLayerBits(JPH::ObjectLayer l) { return gLayers[l].bits; }
uint16_t objectLayerMask(JPH::ObjectLayer l) { return gLayers[l].mask; }

// ---------------------------------------------------------------------------
// Contact bookkeeping (called by the listeners while Jolt steps: no Lua here)
// ---------------------------------------------------------------------------

static uint64_t pairKey(uint32_t a, uint32_t b)
{
	return a < b ? ((uint64_t) a << 32) | b : ((uint64_t) b << 32) | a;
}

void World3D::bodyContactAdded(uint32_t a, uint32_t b, JPH::Vec3Arg n)
{
	uint64_t key = pairKey(a, b);
	BodyPair &p = bodyPairs[key];
	if (p.count == 0 && !p.touching)
	{
		p.a = a;
		p.b = b;
		p.normal[0] = n.GetX();
		p.normal[1] = n.GetY();
		p.normal[2] = n.GetZ();
	}
	p.count++;
	if (!p.dirty)
	{
		p.dirty = true;
		dirtyPairs.push_back(key);
	}
}

void World3D::bodyContactRemoved(uint32_t a, uint32_t b)
{
	uint64_t key = pairKey(a, b);
	auto it = bodyPairs.find(key);
	if (it == bodyPairs.end())
		return;
	BodyPair &p = it->second;
	if (p.count > 0)
		p.count--;
	if (!p.dirty)
	{
		p.dirty = true;
		dirtyPairs.push_back(key);
	}
}

// 0: a body is gone, 1: every moving body of the pair is asleep, 2: awake.
static int pairActivity(JPH::PhysicsSystem *system, const World3D::BodyPair &p)
{
	const JPH::BodyLockInterfaceNoLock &locks = system->GetBodyLockInterfaceNoLock();
	const JPH::Body *a = locks.TryGetBody(JPH::BodyID(p.a));
	const JPH::Body *b = locks.TryGetBody(JPH::BodyID(p.b));
	if (a == nullptr || b == nullptr)
		return 0;
	return a->IsActive() || b->IsActive() ? 2 : 1;
}

void World3D::reconcileContacts()
{
	for (uint64_t key : dirtyPairs)
	{
		auto it = bodyPairs.find(key);
		if (it == bodyPairs.end())
			continue;
		BodyPair &p = it->second;
		p.dirty = false;
		if (p.count > 0)
		{
			if (!p.touching)
			{
				p.touching = true;
				if (beginRef != LUA_NOREF)
					events.push_back({true, p.a, p.b, p.normal[0], p.normal[1], p.normal[2]});
			}
			p.awakeChecks = 0;
			continue;
		}
		if (p.touching && pairActivity(system, p) == 1)
		{
			// Jolt dropped the contact because the bodies fell asleep.
			if (!p.sleeping)
			{
				p.sleeping = true;
				p.awakeChecks = 0;
				sleepingPairs.push_back(key);
			}
			continue;
		}
		if (p.sleeping)
			continue; // sleepingPairs decides
		if (p.touching && endRef != LUA_NOREF)
			events.push_back({false, p.a, p.b, 0.0f, 0.0f, 0.0f});
		bodyPairs.erase(it);
	}
	dirtyPairs.clear();

	for (size_t i = 0; i < sleepingPairs.size();)
	{
		auto it = bodyPairs.find(sleepingPairs[i]);
		bool keep = false;
		if (it != bodyPairs.end())
		{
			BodyPair &p = it->second;
			int activity = pairActivity(system, p);
			if (p.count > 0)
				p.sleeping = false; // awake and still touching
			else if (activity == 0)
				bodyPairs.erase(it); // a body was destroyed
			else if (activity == 1)
			{
				p.awakeChecks = 0;
				keep = true;
			}
			else if (++p.awakeChecks < 2)
				keep = true; // woke up: give Jolt a step to find the contact again
			else
			{
				if (endRef != LUA_NOREF)
					events.push_back({false, p.a, p.b, 0.0f, 0.0f, 0.0f});
				bodyPairs.erase(it);
			}
		}
		if (keep)
			i++;
		else
		{
			sleepingPairs[i] = sleepingPairs.back();
			sleepingPairs.pop_back();
		}
	}
}

void World3D::characterContactAdded(uint32_t a, uint32_t b, JPH::Vec3Arg n)
{
	int &count = characterPairs[pairKey(a, b)];
	if (++count == 1 && beginRef != LUA_NOREF)
		events.push_back({true, a, b, n.GetX(), n.GetY(), n.GetZ()});
}

void World3D::characterContactRemoved(uint32_t a, uint32_t b)
{
	auto it = characterPairs.find(pairKey(a, b));
	if (it == characterPairs.end())
		return;
	if (--it->second <= 0)
	{
		characterPairs.erase(it);
		if (endRef != LUA_NOREF)
			events.push_back({false, a, b, 0.0f, 0.0f, 0.0f});
	}
}

void World3D::forgetCharacterPairsOf(uint32_t key)
{
	for (auto it = characterPairs.begin(); it != characterPairs.end();)
	{
		if ((uint32_t) (it->first >> 32) == key || (uint32_t) it->first == key)
			it = characterPairs.erase(it);
		else
			++it;
	}
}

void ContactListener3D::OnContactAdded(const JPH::Body &body1, const JPH::Body &body2, const JPH::ContactManifold &manifold, JPH::ContactSettings &)
{
	world->bodyContactAdded(bodyKey(body1.GetID()), bodyKey(body2.GetID()), manifold.mWorldSpaceNormal);
}

void ContactListener3D::OnContactRemoved(const JPH::SubShapeIDPair &pair)
{
	world->bodyContactRemoved(bodyKey(pair.GetBody1ID()), bodyKey(pair.GetBody2ID()));
}

// The contact normal points from the other object towards the character;
// begin's normal points from a (the character) to b.
void CharacterListener3D::OnContactAdded(const JPH::CharacterVirtual *character, const JPH::CharacterContact &contact, JPH::CharacterContactSettings &)
{
	world->characterContactAdded(characterKey(character), bodyKey(contact.mBodyB), -contact.mContactNormal);
}

void CharacterListener3D::OnContactRemoved(const JPH::CharacterVirtual *character, const JPH::BodyID &body, const JPH::SubShapeID &)
{
	world->characterContactRemoved(characterKey(character), bodyKey(body));
}

void CharacterListener3D::OnCharacterContactAdded(const JPH::CharacterVirtual *character, const JPH::CharacterContact &contact, JPH::CharacterContactSettings &)
{
	uint32_t other = CHARACTER_KEY | (contact.mCharacterIDB.GetValue() & ~CHARACTER_KEY);
	world->characterContactAdded(characterKey(character), other, -contact.mContactNormal);
}

void CharacterListener3D::OnCharacterContactRemoved(const JPH::CharacterVirtual *character, const JPH::CharacterID &other, const JPH::SubShapeID &)
{
	world->characterContactRemoved(characterKey(character), CHARACTER_KEY | (other.GetValue() & ~CHARACTER_KEY));
}

// ---------------------------------------------------------------------------
// Lua helpers
// ---------------------------------------------------------------------------

float checkFloat(lua_State *L, int idx)
{
	return (float) luaL_checknumber(L, idx);
}

float optFloat(lua_State *L, int idx, float def)
{
	return (float) luaL_optnumber(L, idx, def);
}

static bool toBits(lua_Number n, uint16_t *out)
{
	if (!(n >= 0 && n <= 0xFFFF) || std::floor(n) != n)
		return false;
	*out = (uint16_t) n;
	return true;
}

uint16_t checkBits(lua_State *L, int idx, const char *what)
{
	uint16_t bits = 0;
	if (!toBits(luaL_checknumber(L, idx), &bits))
		luaL_error(L, "%s must be a 16-bit mask (an integer from 0 to 65535)", what);
	return bits;
}

uint16_t optBits(lua_State *L, int idx, uint16_t def, const char *what)
{
	return lua_isnoneornil(L, idx) ? def : checkBits(L, idx, what);
}

bool fieldExists(lua_State *L, int idx, const char *name)
{
	lua_getfield(L, idx, name);
	bool exists = !lua_isnil(L, -1);
	lua_pop(L, 1);
	return exists;
}

float fieldFloat(lua_State *L, int idx, const char *name, float def, const char *fn)
{
	lua_getfield(L, idx, name);
	float v = def;
	if (!lua_isnil(L, -1))
	{
		if (lua_type(L, -1) != LUA_TNUMBER)
			luaL_error(L, "%s: field '%s' must be a number, not %s", fn, name, luaL_typename(L, -1));
		v = (float) lua_tonumber(L, -1);
	}
	lua_pop(L, 1);
	return v;
}

bool fieldBool(lua_State *L, int idx, const char *name, bool def, const char *fn)
{
	lua_getfield(L, idx, name);
	bool v = def;
	if (!lua_isnil(L, -1))
	{
		if (lua_type(L, -1) != LUA_TBOOLEAN)
			luaL_error(L, "%s: field '%s' must be a boolean, not %s", fn, name, luaL_typename(L, -1));
		v = lua_toboolean(L, -1) != 0;
	}
	lua_pop(L, 1);
	return v;
}

uint16_t fieldBits(lua_State *L, int idx, const char *name, uint16_t def, const char *fn)
{
	lua_getfield(L, idx, name);
	uint16_t v = def;
	if (!lua_isnil(L, -1))
	{
		if (lua_type(L, -1) != LUA_TNUMBER || !toBits(lua_tonumber(L, -1), &v))
			luaL_error(L, "%s: field '%s' must be a 16-bit mask (an integer from 0 to 65535)", fn, name);
	}
	lua_pop(L, 1);
	return v;
}

static JPH::Quat normalizedQuat(lua_State *L, float x, float y, float z, float w)
{
	float len = std::sqrt(x * x + y * y + z * z + w * w);
	if (!(len > 1.0e-12f) || !std::isfinite(len))
		luaL_error(L, "Invalid rotation: the quaternion (%f, %f, %f, %f) has no length", x, y, z, w);
	return JPH::Quat(x / len, y / len, z / len, w / len);
}

JPH::Quat fieldQuat(lua_State *L, int idx, const char *fn)
{
	float x = fieldFloat(L, idx, "qx", 0.0f, fn);
	float y = fieldFloat(L, idx, "qy", 0.0f, fn);
	float z = fieldFloat(L, idx, "qz", 0.0f, fn);
	float w = fieldFloat(L, idx, "qw", 1.0f, fn);
	return normalizedQuat(L, x, y, z, w);
}

JPH::Quat checkQuat(lua_State *L, int idx)
{
	float x = checkFloat(L, idx), y = checkFloat(L, idx + 1), z = checkFloat(L, idx + 2), w = checkFloat(L, idx + 3);
	return normalizedQuat(L, x, y, z, w);
}

static int w_tostring(lua_State *L)
{
	lua_getmetatable(L, 1);
	lua_getfield(L, -1, "__name");
	lua_pushfstring(L, "%s: %p", lua_tostring(L, -1), lua_touserdata(L, 1));
	return 1;
}

static int w_type(lua_State *L)
{
	lua_getmetatable(L, 1);
	lua_getfield(L, -1, "__name");
	return 1;
}

int typeOf(lua_State *L, const char *name)
{
	const char *query = luaL_checkstring(L, 2);
	lua_pushboolean(L, std::strcmp(query, name) == 0 || std::strcmp(query, "Object") == 0);
	return 1;
}

void newMetatable(lua_State *L, const char *name, const luaL_Reg *methods, lua_CFunction gc)
{
	luaL_newmetatable(L, name);
	lua_pushstring(L, name);
	lua_setfield(L, -2, "__name");
	lua_newtable(L);
	luaL_register(L, nullptr, methods);
	lua_pushcfunction(L, w_type);
	lua_setfield(L, -2, "type");
	lua_setfield(L, -2, "__index");
	lua_pushcfunction(L, gc);
	lua_setfield(L, -2, "__gc");
	lua_pushcfunction(L, w_tostring);
	lua_setfield(L, -2, "__tostring");
	lua_pop(L, 1);
}

int pushRef(lua_State *L, int ref)
{
	if (ref == LUA_NOREF || ref == LUA_REFNIL)
		lua_pushnil(L);
	else
		lua_rawgeti(L, LUA_REGISTRYINDEX, ref);
	return 1;
}

void setRef(lua_State *L, int *ref, int idx)
{
	lua_pushvalue(L, idx);
	int newRef = lua_isnil(L, -1) ? (lua_pop(L, 1), LUA_NOREF) : luaL_ref(L, LUA_REGISTRYINDEX);
	clearRef(L, ref);
	*ref = newRef;
}

void clearRef(lua_State *L, int *ref)
{
	if (*ref != LUA_NOREF && *ref != LUA_REFNIL)
		luaL_unref(L, LUA_REGISTRYINDEX, *ref);
	*ref = LUA_NOREF;
}

} // physics3d
} // love

using namespace love::physics3d;

extern "C" int luaopen_love_physics3d(lua_State *L)
{
	initJolt();

	registerShape3D(L);
	registerWorld3D(L);
	registerBody3D(L);
	registerCharacter3D(L);

	lua_newtable(L);
	lua_pushcfunction(L, w_newWorld);
	lua_setfield(L, -2, "newWorld");
	luaL_register(L, nullptr, shapeFunctions);

	// Like LÖVE's modules, also install it as love.physics3d.
	lua_getglobal(L, "love");
	if (lua_istable(L, -1))
	{
		lua_pushvalue(L, -2);
		lua_setfield(L, -2, "physics3d");
	}
	lua_pop(L, 1);
	return 1;
}
