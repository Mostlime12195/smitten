/**
 * Smitten: love.physics3d. Body3D.
 **/

#include "Physics3D.h"

#include <Jolt/Physics/Body/BodyLockInterface.h>

#include <algorithm>
#include <cmath>
#include <cstring>

namespace love
{
namespace physics3d
{

Body3D *checkBody(lua_State *L, int idx)
{
	Body3D *b = (Body3D *) luaL_checkudata(L, idx, BODY3D);
	if (b->world == nullptr)
		luaL_error(L, "Body3D has been destroyed");
	return b;
}

static inline JPH::BodyInterface &bodies(Body3D *b)
{
	return b->world->system->GetBodyInterfaceNoLock();
}

static inline const JPH::Body *joltBody(Body3D *b)
{
	return b->world->system->GetBodyLockInterfaceNoLock().TryGetBody(b->id);
}

static int push3(lua_State *L, JPH::Vec3Arg v)
{
	lua_pushnumber(L, v.GetX());
	lua_pushnumber(L, v.GetY());
	lua_pushnumber(L, v.GetZ());
	return 3;
}

static int push4(lua_State *L, JPH::QuatArg q)
{
	lua_pushnumber(L, q.GetX());
	lua_pushnumber(L, q.GetY());
	lua_pushnumber(L, q.GetZ());
	lua_pushnumber(L, q.GetW());
	return 4;
}

static JPH::Vec3 check3(lua_State *L, int idx)
{
	float x = checkFloat(L, idx), y = checkFloat(L, idx + 1), z = checkFloat(L, idx + 2);
	return JPH::Vec3(x, y, z);
}

static JPH::EActivation activation(Body3D *b)
{
	return b->motion == JPH::EMotionType::Static ? JPH::EActivation::DontActivate : JPH::EActivation::Activate;
}

// --- creation ---------------------------------------------------------------

struct BodyParams
{
	const JPH::Shape *shape;
	JPH::EMotionType motion;
	float position[3];
	float rotation[4];
	bool hasMass;
	float mass;
	float friction, restitution, linearDamping, angularDamping, gravityScale;
	bool sensor, lockRotation, allowSleep;
	JPH::ObjectLayer objectLayer;
};

static bool createJoltBody(World3D *w, Body3D *b, const BodyParams &p)
{
	JPH::BodyCreationSettings s(p.shape,
		JPH::RVec3(p.position[0], p.position[1], p.position[2]),
		JPH::Quat(p.rotation[0], p.rotation[1], p.rotation[2], p.rotation[3]),
		p.motion, p.objectLayer);
	s.mFriction = p.friction;
	s.mRestitution = p.restitution;
	s.mLinearDamping = p.linearDamping;
	s.mAngularDamping = p.angularDamping;
	s.mGravityFactor = p.gravityScale;
	s.mIsSensor = p.sensor;
	s.mAllowSleeping = p.allowSleep;
	// Kinematic sensors also detect static bodies.
	s.mCollideKinematicVsNonDynamic = p.sensor && p.motion == JPH::EMotionType::Kinematic;
	if (p.lockRotation)
		s.mAllowedDOFs = JPH::EAllowedDOFs::TranslationX | JPH::EAllowedDOFs::TranslationY | JPH::EAllowedDOFs::TranslationZ;
	if (p.hasMass && p.motion == JPH::EMotionType::Dynamic)
	{
		s.mOverrideMassProperties = JPH::EOverrideMassProperties::CalculateInertia;
		s.mMassPropertiesOverride.mMass = p.mass;
	}
	s.mUserData = (JPH::uint64) (uintptr_t) b;

	JPH::BodyInterface &bi = w->system->GetBodyInterfaceNoLock();
	JPH::Body *body = bi.CreateBody(s);
	if (body == nullptr)
		return false;
	b->id = body->GetID();
	bi.AddBody(b->id, p.motion == JPH::EMotionType::Static ? JPH::EActivation::DontActivate : JPH::EActivation::Activate);
	return true;
}

static const char *const FN_NEWBODY = "World3D:newBody";

int newBody(lua_State *L, World3D *w)
{
	luaL_checktype(L, 2, LUA_TTABLE);
	BodyParams p;

	lua_getfield(L, 2, "shape");
	Shape3D *shape = toShape(L, -1);
	if (shape == nullptr)
		return luaL_error(L, "%s: field 'shape' must be a Shape3D", FN_NEWBODY);
	if (shape->shape == nullptr)
		return luaL_error(L, "%s: the shape has been released", FN_NEWBODY);
	p.shape = shape->shape;
	lua_pop(L, 1);

	lua_getfield(L, 2, "type");
	const char *type = lua_isnil(L, -1) ? "dynamic" : lua_tostring(L, -1);
	if (type == nullptr)
		return luaL_error(L, "%s: field 'type' must be \"static\", \"dynamic\" or \"kinematic\"", FN_NEWBODY);
	if (std::strcmp(type, "static") == 0)
		p.motion = JPH::EMotionType::Static;
	else if (std::strcmp(type, "dynamic") == 0)
		p.motion = JPH::EMotionType::Dynamic;
	else if (std::strcmp(type, "kinematic") == 0)
		p.motion = JPH::EMotionType::Kinematic;
	else
		return luaL_error(L, "%s: invalid body type '%s' (expected \"static\", \"dynamic\" or \"kinematic\")", FN_NEWBODY, type);
	lua_pop(L, 1);

	if (p.motion != JPH::EMotionType::Static && p.shape->MustBeStatic())
		return luaL_error(L, "%s: mesh shapes can only be used by static bodies (use a convex hull or a compound shape)", FN_NEWBODY);

	p.position[0] = fieldFloat(L, 2, "x", 0.0f, FN_NEWBODY);
	p.position[1] = fieldFloat(L, 2, "y", 0.0f, FN_NEWBODY);
	p.position[2] = fieldFloat(L, 2, "z", 0.0f, FN_NEWBODY);
	JPH::Quat q = fieldQuat(L, 2, FN_NEWBODY);
	p.rotation[0] = q.GetX();
	p.rotation[1] = q.GetY();
	p.rotation[2] = q.GetZ();
	p.rotation[3] = q.GetW();
	p.hasMass = fieldExists(L, 2, "mass");
	p.mass = fieldFloat(L, 2, "mass", 0.0f, FN_NEWBODY);
	if (p.hasMass && !(p.mass > 0.0f))
		return luaL_error(L, "%s: mass must be greater than 0", FN_NEWBODY);
	p.friction = fieldFloat(L, 2, "friction", 0.5f, FN_NEWBODY);
	p.restitution = fieldFloat(L, 2, "restitution", 0.0f, FN_NEWBODY);
	p.linearDamping = fieldFloat(L, 2, "linearDamping", 0.05f, FN_NEWBODY);
	p.angularDamping = fieldFloat(L, 2, "angularDamping", 0.05f, FN_NEWBODY);
	p.gravityScale = fieldFloat(L, 2, "gravityScale", 1.0f, FN_NEWBODY);
	uint16_t layer = fieldBits(L, 2, "layer", 1, FN_NEWBODY);
	uint16_t mask = fieldBits(L, 2, "mask", 0xFFFF, FN_NEWBODY);
	p.sensor = fieldBool(L, 2, "sensor", false, FN_NEWBODY);
	p.lockRotation = fieldBool(L, 2, "lockRotation", false, FN_NEWBODY);
	p.allowSleep = fieldBool(L, 2, "allowSleep", true, FN_NEWBODY);
	p.objectLayer = internObjectLayer(layer, mask, p.motion != JPH::EMotionType::Static);
	if (p.objectLayer == JPH::cObjectLayerInvalid)
		return luaL_error(L, "%s: too many different layer/mask combinations", FN_NEWBODY);

	Body3D *b = (Body3D *) lua_newuserdata(L, sizeof(Body3D));
	std::memset(b, 0, sizeof(Body3D));
	b->world = nullptr;
	b->selfRef = LUA_NOREF;
	b->userRef = LUA_NOREF;
	b->layer = layer;
	b->mask = mask;
	b->sensor = p.sensor;
	b->motion = p.motion;
	luaL_getmetatable(L, BODY3D);
	lua_setmetatable(L, -2);

	lua_pushvalue(L, -1);
	b->selfRef = luaL_ref(L, LUA_REGISTRYINDEX);
	if (!createJoltBody(w, b, p))
	{
		clearRef(L, &b->selfRef);
		return luaL_error(L, "%s: too many bodies (this world's maxBodies is %d)", FN_NEWBODY, (int) w->system->GetMaxBodies());
	}
	b->world = w;
	b->index = (int) w->bodies.size();
	w->bodies.push_back(b);
	w->addedSinceStep++;
	return 1;
}

void destroyBody(lua_State *L, Body3D *b)
{
	World3D *w = b->world;
	if (w == nullptr)
		return;
	JPH::BodyInterface &bi = w->system->GetBodyInterfaceNoLock();
	bi.RemoveBody(b->id);
	bi.DestroyBody(b->id);

	Body3D *last = w->bodies.back();
	w->bodies[b->index] = last;
	last->index = b->index;
	w->bodies.pop_back();
	if (b->forced)
		w->forced.erase(std::find(w->forced.begin(), w->forced.end(), b));

	b->world = nullptr;
	b->forced = false;
	clearRef(L, &b->userRef);
	clearRef(L, &b->selfRef);
}

// --- methods ----------------------------------------------------------------

static int w_Body_getPosition(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	return push3(L, bodies(b).GetPosition(b->id));
}

static int w_Body_setPosition(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::Vec3 p = check3(L, 2);
	bodies(b).SetPosition(b->id, p, activation(b));
	return 0;
}

static int w_Body_getRotation(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	return push4(L, bodies(b).GetRotation(b->id));
}

static int w_Body_setRotation(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::Quat q = checkQuat(L, 2);
	bodies(b).SetRotation(b->id, q, activation(b));
	return 0;
}

static int w_Body_getTransform(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::RVec3 p;
	JPH::Quat q;
	bodies(b).GetPositionAndRotation(b->id, p, q);
	push3(L, p);
	return 3 + push4(L, q);
}

static int w_Body_setTransform(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::Vec3 p = check3(L, 2);
	JPH::Quat q = checkQuat(L, 5);
	bodies(b).SetPositionAndRotation(b->id, p, q, activation(b));
	return 0;
}

static int w_Body_getLinearVelocity(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	return push3(L, bodies(b).GetLinearVelocity(b->id));
}

static int w_Body_setLinearVelocity(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::Vec3 v = check3(L, 2);
	if (b->motion != JPH::EMotionType::Static)
		bodies(b).SetLinearVelocity(b->id, v);
	return 0;
}

static int w_Body_getAngularVelocity(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	return push3(L, bodies(b).GetAngularVelocity(b->id));
}

static int w_Body_setAngularVelocity(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::Vec3 v = check3(L, 2);
	if (b->motion != JPH::EMotionType::Static)
		bodies(b).SetAngularVelocity(b->id, v);
	return 0;
}

// Forces and torques are kept until the next World3D:update and applied
// during each of its fixed steps, so they don't depend on the frame rate.
static void addForce(Body3D *b, JPH::Vec3Arg force, JPH::Vec3Arg torque)
{
	if (b->motion != JPH::EMotionType::Dynamic)
		return;
	b->force[0] += force.GetX();
	b->force[1] += force.GetY();
	b->force[2] += force.GetZ();
	b->torque[0] += torque.GetX();
	b->torque[1] += torque.GetY();
	b->torque[2] += torque.GetZ();
	if (!b->forced)
	{
		b->forced = true;
		b->world->forced.push_back(b);
	}
}

static int w_Body_applyForce(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::Vec3 f = check3(L, 2);
	JPH::Vec3 torque = JPH::Vec3::sZero();
	if (!lua_isnoneornil(L, 5))
	{
		JPH::Vec3 p = check3(L, 5);
		torque = (p - bodies(b).GetCenterOfMassPosition(b->id)).Cross(f);
	}
	addForce(b, f, torque);
	return 0;
}

static int w_Body_applyTorque(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::Vec3 t = check3(L, 2);
	addForce(b, JPH::Vec3::sZero(), t);
	return 0;
}

static int w_Body_applyImpulse(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::Vec3 impulse = check3(L, 2);
	bool atPoint = !lua_isnoneornil(L, 5);
	JPH::Vec3 p = atPoint ? check3(L, 5) : JPH::Vec3::sZero();
	if (b->motion != JPH::EMotionType::Dynamic)
		return 0;
	if (atPoint)
		bodies(b).AddImpulse(b->id, impulse, p);
	else
		bodies(b).AddImpulse(b->id, impulse);
	return 0;
}

static int w_Body_applyAngularImpulse(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::Vec3 impulse = check3(L, 2);
	if (b->motion == JPH::EMotionType::Dynamic)
		bodies(b).AddAngularImpulse(b->id, impulse);
	return 0;
}

static int w_Body_moveKinematic(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	JPH::Vec3 p = check3(L, 2);
	JPH::Quat q = checkQuat(L, 5);
	float dt = checkFloat(L, 9);
	if (b->motion == JPH::EMotionType::Static)
		return luaL_error(L, "Body3D:moveKinematic: a static body can't move (make it \"kinematic\")");
	if (!(dt > 0.0f))
		return luaL_error(L, "Body3D:moveKinematic: dt must be greater than 0");
	bodies(b).MoveKinematic(b->id, p, q, dt);
	return 0;
}

static int w_Body_getType(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	switch (b->motion)
	{
	case JPH::EMotionType::Static: lua_pushliteral(L, "static"); break;
	case JPH::EMotionType::Kinematic: lua_pushliteral(L, "kinematic"); break;
	default: lua_pushliteral(L, "dynamic"); break;
	}
	return 1;
}

static int w_Body_setGravityScale(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	float s = checkFloat(L, 2);
	if (b->motion != JPH::EMotionType::Static)
	{
		bodies(b).SetGravityFactor(b->id, s);
		bodies(b).ActivateBody(b->id);
	}
	return 0;
}

static int w_Body_getGravityScale(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	lua_pushnumber(L, b->motion == JPH::EMotionType::Static ? 1.0f : bodies(b).GetGravityFactor(b->id));
	return 1;
}

static int w_Body_isAwake(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	lua_pushboolean(L, bodies(b).IsActive(b->id));
	return 1;
}

static int w_Body_wake(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	if (b->motion != JPH::EMotionType::Static)
		bodies(b).ActivateBody(b->id);
	return 0;
}

static int w_Body_setFriction(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	bodies(b).SetFriction(b->id, checkFloat(L, 2));
	return 0;
}

static int w_Body_getFriction(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	lua_pushnumber(L, bodies(b).GetFriction(b->id));
	return 1;
}

static int w_Body_setRestitution(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	bodies(b).SetRestitution(b->id, checkFloat(L, 2));
	return 0;
}

static int w_Body_getRestitution(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	lua_pushnumber(L, bodies(b).GetRestitution(b->id));
	return 1;
}

static int w_Body_getMass(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	float mass = 0.0f;
	const JPH::Body *body = joltBody(b);
	if (body != nullptr && body->IsDynamic())
	{
		float inv = body->GetMotionProperties()->GetInverseMass();
		mass = inv > 0.0f ? 1.0f / inv : 0.0f;
	}
	lua_pushnumber(L, mass);
	return 1;
}

static int w_Body_setLayer(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	uint16_t layer = checkBits(L, 2, "Layer");
	uint16_t mask = optBits(L, 3, b->mask, "Mask");
	JPH::ObjectLayer ol = internObjectLayer(layer, mask, b->motion != JPH::EMotionType::Static);
	if (ol == JPH::cObjectLayerInvalid)
		return luaL_error(L, "Body3D:setLayer: too many different layer/mask combinations");
	b->layer = layer;
	b->mask = mask;
	bodies(b).SetObjectLayer(b->id, ol);
	if (b->motion != JPH::EMotionType::Static)
		bodies(b).ActivateBody(b->id);
	return 0;
}

static int w_Body_getLayer(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	lua_pushinteger(L, b->layer);
	lua_pushinteger(L, b->mask);
	return 2;
}

static int w_Body_isSensor(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	lua_pushboolean(L, b->sensor);
	return 1;
}

static int w_Body_getUserData(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	return pushRef(L, b->userRef);
}

static int w_Body_setUserData(lua_State *L)
{
	Body3D *b = checkBody(L, 1);
	lua_settop(L, 2);
	setRef(L, &b->userRef, 2);
	return 0;
}

static int w_Body_destroy(lua_State *L)
{
	Body3D *b = (Body3D *) luaL_checkudata(L, 1, BODY3D);
	destroyBody(L, b);
	return 0;
}

static int w_Body_isDestroyed(lua_State *L)
{
	Body3D *b = (Body3D *) luaL_checkudata(L, 1, BODY3D);
	lua_pushboolean(L, b->world == nullptr);
	return 1;
}

static int w_Body_typeOf(lua_State *L)
{
	luaL_checkudata(L, 1, BODY3D);
	return typeOf(L, BODY3D);
}

// A body lives until it (or its world) is destroyed: the world keeps the
// userdata alive meanwhile, so there's nothing to do when it's collected.
static int w_Body_gc(lua_State *)
{
	return 0;
}

static const luaL_Reg bodyMethods[] = {
	{"getPosition", w_Body_getPosition},
	{"setPosition", w_Body_setPosition},
	{"getRotation", w_Body_getRotation},
	{"setRotation", w_Body_setRotation},
	{"getTransform", w_Body_getTransform},
	{"setTransform", w_Body_setTransform},
	{"getLinearVelocity", w_Body_getLinearVelocity},
	{"setLinearVelocity", w_Body_setLinearVelocity},
	{"getAngularVelocity", w_Body_getAngularVelocity},
	{"setAngularVelocity", w_Body_setAngularVelocity},
	{"applyForce", w_Body_applyForce},
	{"applyTorque", w_Body_applyTorque},
	{"applyImpulse", w_Body_applyImpulse},
	{"applyAngularImpulse", w_Body_applyAngularImpulse},
	{"moveKinematic", w_Body_moveKinematic},
	{"getType", w_Body_getType},
	{"setGravityScale", w_Body_setGravityScale},
	{"getGravityScale", w_Body_getGravityScale},
	{"isAwake", w_Body_isAwake},
	{"wake", w_Body_wake},
	{"setFriction", w_Body_setFriction},
	{"getFriction", w_Body_getFriction},
	{"setRestitution", w_Body_setRestitution},
	{"getRestitution", w_Body_getRestitution},
	{"getMass", w_Body_getMass},
	{"setLayer", w_Body_setLayer},
	{"getLayer", w_Body_getLayer},
	{"isSensor", w_Body_isSensor},
	{"getUserData", w_Body_getUserData},
	{"setUserData", w_Body_setUserData},
	{"destroy", w_Body_destroy},
	{"release", w_Body_destroy},
	{"isDestroyed", w_Body_isDestroyed},
	{"typeOf", w_Body_typeOf},
	{nullptr, nullptr}
};

void registerBody3D(lua_State *L)
{
	newMetatable(L, BODY3D, bodyMethods, w_Body_gc);
}

} // physics3d
} // love
