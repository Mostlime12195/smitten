/**
 * Smitten: love.physics3d. Character3D, a Jolt CharacterVirtual: a shape
 * moved by collision queries instead of the solver, for player characters.
 **/

#include "Physics3D.h"

#include <Jolt/Physics/Body/BodyFilter.h>
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseLayer.h>
#include <Jolt/Physics/Collision/ObjectLayer.h>
#include <Jolt/Physics/Collision/ShapeFilter.h>

#include <algorithm>
#include <cmath>
#include <cstring>

namespace love
{
namespace physics3d
{

Character3D *checkCharacter(lua_State *L, int idx)
{
	Character3D *c = (Character3D *) luaL_checkudata(L, idx, CHARACTER3D);
	if (c->world == nullptr)
		luaL_error(L, "Character3D has been destroyed");
	return c;
}

struct CharacterParams
{
	const JPH::Shape *shape;
	float position[3];
	float maxSlope, stepHeight, mass, maxStrength;
};

static const char *const FN_NEWCHARACTER = "World3D:newCharacter";

static JPH::CharacterVirtual *createJoltCharacter(World3D *w, Character3D *c, const CharacterParams &p)
{
	JPH::Ref<JPH::CharacterVirtualSettings> settings = new JPH::CharacterVirtualSettings();
	settings->mShape = p.shape;
	settings->mUp = JPH::Vec3::sAxisY();
	settings->mMaxSlopeAngle = p.maxSlope;
	settings->mMass = p.mass;
	settings->mMaxStrength = p.maxStrength;

	// Contacts below this plane (in the character's space) can support it:
	// the bottom of the shape, e.g. a capsule's lower half-sphere.
	JPH::AABox bounds = p.shape->GetLocalBounds();
	JPH::Vec3 com = p.shape->GetCenterOfMass();
	JPH::Vec3 extent = bounds.GetExtent();
	float bottom = bounds.mMin.GetY() + com.GetY();
	float supportY = std::min(bottom + std::min(extent.GetX(), extent.GetZ()), bottom + extent.GetY());
	settings->mSupportingVolume = JPH::Plane(JPH::Vec3::sAxisY(), -supportY);

	JPH::CharacterVirtual *cv = new JPH::CharacterVirtual(settings,
		JPH::RVec3(p.position[0], p.position[1], p.position[2]), JPH::Quat::sIdentity(),
		(JPH::uint64) (uintptr_t) c, w->system);
	cv->AddRef();
	cv->SetListener(&w->characterListener);
	cv->SetCharacterVsCharacterCollision(&w->characterVsCharacter);
	w->characterVsCharacter.Add(cv);
	return cv;
}

int newCharacter(lua_State *L, World3D *w)
{
	luaL_checktype(L, 2, LUA_TTABLE);
	CharacterParams p;

	lua_getfield(L, 2, "shape");
	Shape3D *shape = toShape(L, -1);
	if (shape == nullptr)
		return luaL_error(L, "%s: field 'shape' must be a Shape3D (usually a capsule)", FN_NEWCHARACTER);
	if (shape->shape == nullptr)
		return luaL_error(L, "%s: the shape has been released", FN_NEWCHARACTER);
	if (shape->shape->MustBeStatic())
		return luaL_error(L, "%s: a character can't use a mesh shape", FN_NEWCHARACTER);
	p.shape = shape->shape;
	lua_pop(L, 1);

	p.position[0] = fieldFloat(L, 2, "x", 0.0f, FN_NEWCHARACTER);
	p.position[1] = fieldFloat(L, 2, "y", 0.0f, FN_NEWCHARACTER);
	p.position[2] = fieldFloat(L, 2, "z", 0.0f, FN_NEWCHARACTER);
	p.maxSlope = fieldFloat(L, 2, "maxSlope", JPH::DegreesToRadians(50.0f), FN_NEWCHARACTER);
	p.stepHeight = fieldFloat(L, 2, "stepHeight", 0.3f, FN_NEWCHARACTER);
	p.mass = fieldFloat(L, 2, "mass", 70.0f, FN_NEWCHARACTER);
	p.maxStrength = fieldFloat(L, 2, "maxStrength", 100.0f, FN_NEWCHARACTER);
	uint16_t layer = fieldBits(L, 2, "layer", 1, FN_NEWCHARACTER);
	uint16_t mask = fieldBits(L, 2, "mask", 0xFFFF, FN_NEWCHARACTER);
	if (!(p.stepHeight >= 0.0f))
		return luaL_error(L, "%s: stepHeight must be >= 0", FN_NEWCHARACTER);
	if (!(p.mass >= 0.0f) || !(p.maxStrength >= 0.0f))
		return luaL_error(L, "%s: mass and maxStrength must be >= 0", FN_NEWCHARACTER);
	JPH::ObjectLayer objectLayer = internObjectLayer(layer, mask, true);
	if (objectLayer == JPH::cObjectLayerInvalid)
		return luaL_error(L, "%s: too many different layer/mask combinations", FN_NEWCHARACTER);

	Character3D *c = (Character3D *) lua_newuserdata(L, sizeof(Character3D));
	std::memset(c, 0, sizeof(Character3D));
	c->selfRef = LUA_NOREF;
	c->userRef = LUA_NOREF;
	c->layer = layer;
	c->mask = mask;
	c->objectLayer = objectLayer;
	c->stepHeight = p.stepHeight;
	luaL_getmetatable(L, CHARACTER3D);
	lua_setmetatable(L, -2);

	lua_pushvalue(L, -1);
	c->selfRef = luaL_ref(L, LUA_REGISTRYINDEX);
	c->cv = createJoltCharacter(w, c, p);
	c->world = w;
	c->index = (int) w->characters.size();
	w->characters.push_back(c);
	return 1;
}

void destroyCharacter(lua_State *L, Character3D *c)
{
	World3D *w = c->world;
	if (w == nullptr)
		return;
	w->characterVsCharacter.Remove(c->cv);
	w->forgetCharacterPairsOf(characterKey(c->cv));
	c->cv->Release();
	c->cv = nullptr;

	Character3D *last = w->characters.back();
	w->characters[c->index] = last;
	last->index = c->index;
	w->characters.pop_back();

	c->world = nullptr;
	clearRef(L, &c->userRef);
	clearRef(L, &c->selfRef);
}

static void updateCharacter(Character3D *c, float dt)
{
	World3D *w = c->world;
	JPH::CharacterVirtual *cv = c->cv;
	JPH::Vec3 gravity = w->system->GetGravity();
	JPH::Vec3 up = cv->GetUp();

	// Standing on the ground: the vertical velocity is the ground's, unless
	// the game set a velocity away from it (a jump). Then add gravity.
	JPH::Vec3 v = cv->GetLinearVelocity();
	if (cv->GetGroundState() == JPH::CharacterBase::EGroundState::OnGround)
	{
		float groundUp = cv->GetGroundVelocity().Dot(up);
		float vUp = v.Dot(up);
		if (vUp - groundUp < 0.1f)
			v += (groundUp - vUp) * up;
	}
	v += gravity * dt;
	cv->SetLinearVelocity(v);

	JPH::CharacterVirtual::ExtendedUpdateSettings settings;
	settings.mWalkStairsStepUp = up * c->stepHeight;
	settings.mStickToFloorStepDown = -up * std::max(0.5f, c->stepHeight);
	JPH::DefaultBroadPhaseLayerFilter broadPhaseFilter(objectVsBroadPhaseFilter(), c->objectLayer);
	JPH::DefaultObjectLayerFilter layerFilter(objectLayerPairFilter(), c->objectLayer);
	JPH::BodyFilter bodyFilter;
	JPH::ShapeFilter shapeFilter;
	cv->ExtendedUpdate(dt, gravity, settings, broadPhaseFilter, layerFilter, bodyFilter, shapeFilter, tempAllocator());

	// Landed: stop falling (so getLinearVelocity reads 0 vertically).
	if (cv->GetGroundState() == JPH::CharacterBase::EGroundState::OnGround)
	{
		v = cv->GetLinearVelocity();
		float groundUp = cv->GetGroundVelocity().Dot(up);
		float vUp = v.Dot(up);
		if (vUp < groundUp)
			cv->SetLinearVelocity(v + (groundUp - vUp) * up);
	}
}

static int w_Character_update(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	double dt = luaL_checknumber(L, 2);
	if (!(dt >= 0.0) || !std::isfinite(dt))
		return luaL_error(L, "Character3D:update: dt must be a number >= 0 (got %f)", dt);
	World3D *w = c->world;
	if (dt > 0.0)
		updateCharacter(c, (float) dt);
	// Contacts the character started or ended. Keep the world alive while
	// the callbacks run.
	pushWorld(L, w);
	dispatchEvents(L, w);
	return 0;
}

static int push3(lua_State *L, JPH::Vec3Arg v)
{
	lua_pushnumber(L, v.GetX());
	lua_pushnumber(L, v.GetY());
	lua_pushnumber(L, v.GetZ());
	return 3;
}

static int w_Character_getPosition(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	return push3(L, c->cv->GetPosition());
}

static int w_Character_setPosition(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	float x = checkFloat(L, 2), y = checkFloat(L, 3), z = checkFloat(L, 4);
	c->cv->SetPosition(JPH::RVec3(x, y, z));
	return 0;
}

static int w_Character_getLinearVelocity(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	return push3(L, c->cv->GetLinearVelocity());
}

static int w_Character_setLinearVelocity(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	float x = checkFloat(L, 2), y = checkFloat(L, 3), z = checkFloat(L, 4);
	c->cv->SetLinearVelocity(JPH::Vec3(x, y, z));
	return 0;
}

static int w_Character_isOnGround(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	lua_pushboolean(L, c->cv->GetGroundState() == JPH::CharacterBase::EGroundState::OnGround);
	return 1;
}

static int w_Character_getGroundState(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	switch (c->cv->GetGroundState())
	{
	case JPH::CharacterBase::EGroundState::OnGround: lua_pushliteral(L, "onground"); break;
	case JPH::CharacterBase::EGroundState::OnSteepGround: lua_pushliteral(L, "onsteepground"); break;
	case JPH::CharacterBase::EGroundState::NotSupported: lua_pushliteral(L, "notsupported"); break;
	default: lua_pushliteral(L, "inair"); break;
	}
	return 1;
}

static int w_Character_getGroundNormal(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	return push3(L, c->cv->GetGroundNormal());
}

static int w_Character_getGroundVelocity(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	return push3(L, c->cv->GetGroundVelocity());
}

static int w_Character_getUserData(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	return pushRef(L, c->userRef);
}

static int w_Character_setUserData(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	lua_settop(L, 2);
	setRef(L, &c->userRef, 2);
	return 0;
}

static int w_Character_setLayer(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	uint16_t layer = checkBits(L, 2, "Layer");
	uint16_t mask = optBits(L, 3, c->mask, "Mask");
	JPH::ObjectLayer ol = internObjectLayer(layer, mask, true);
	if (ol == JPH::cObjectLayerInvalid)
		return luaL_error(L, "Character3D:setLayer: too many different layer/mask combinations");
	c->layer = layer;
	c->mask = mask;
	c->objectLayer = ol;
	return 0;
}

static int w_Character_getLayer(lua_State *L)
{
	Character3D *c = checkCharacter(L, 1);
	lua_pushinteger(L, c->layer);
	lua_pushinteger(L, c->mask);
	return 2;
}

static int w_Character_destroy(lua_State *L)
{
	Character3D *c = (Character3D *) luaL_checkudata(L, 1, CHARACTER3D);
	destroyCharacter(L, c);
	return 0;
}

static int w_Character_isDestroyed(lua_State *L)
{
	Character3D *c = (Character3D *) luaL_checkudata(L, 1, CHARACTER3D);
	lua_pushboolean(L, c->world == nullptr);
	return 1;
}

static int w_Character_typeOf(lua_State *L)
{
	luaL_checkudata(L, 1, CHARACTER3D);
	return typeOf(L, CHARACTER3D);
}

// Like bodies, a character lives until it or its world is destroyed.
static int w_Character_gc(lua_State *)
{
	return 0;
}

static const luaL_Reg characterMethods[] = {
	{"update", w_Character_update},
	{"getPosition", w_Character_getPosition},
	{"setPosition", w_Character_setPosition},
	{"getLinearVelocity", w_Character_getLinearVelocity},
	{"setLinearVelocity", w_Character_setLinearVelocity},
	{"isOnGround", w_Character_isOnGround},
	{"getGroundState", w_Character_getGroundState},
	{"getGroundNormal", w_Character_getGroundNormal},
	{"getGroundVelocity", w_Character_getGroundVelocity},
	{"getUserData", w_Character_getUserData},
	{"setUserData", w_Character_setUserData},
	{"setLayer", w_Character_setLayer},
	{"getLayer", w_Character_getLayer},
	{"destroy", w_Character_destroy},
	{"release", w_Character_destroy},
	{"isDestroyed", w_Character_isDestroyed},
	{"typeOf", w_Character_typeOf},
	{nullptr, nullptr}
};

void registerCharacter3D(lua_State *L)
{
	newMetatable(L, CHARACTER3D, characterMethods, w_Character_gc);
}

} // physics3d
} // love
