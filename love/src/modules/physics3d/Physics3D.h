/**
 * Smitten: love.physics3d, a Lua binding for Jolt Physics.
 *
 * Built as an optional WebAssembly side module: it uses only the plain Lua 5.1
 * C API (full userdata + metatables), Jolt and the C/C++ standard libraries,
 * none of LÖVE's C++ runtime. See README.md in this folder.
 *
 * Rules that keep it safe with Lua errors (longjmp):
 * - Lua is never called while Jolt is stepping; contacts are queued by the
 *   listeners and dispatched afterwards (dispatchEvents).
 * - luaL_error is only raised when no C++ object with a destructor is alive
 *   in the current frame: arguments are read first, Jolt work happens in
 *   helper functions that return, and errors are raised after them.
 **/

#ifndef LOVE_PHYSICS3D_PHYSICS3D_H
#define LOVE_PHYSICS3D_PHYSICS3D_H

#include <Jolt/Jolt.h>
#include <Jolt/Core/JobSystemSingleThreaded.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Body/BodyInterface.h>
#include <Jolt/Physics/Character/CharacterVirtual.h>
#include <Jolt/Physics/Collision/ContactListener.h>
#include <Jolt/Physics/PhysicsSystem.h>

extern "C" {
#include "lua.h"
#include "lauxlib.h"
}

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace love
{
namespace physics3d
{

struct World3D;

// Lua type names (metatable names in the registry).
extern const char *const WORLD3D;
extern const char *const BODY3D;
extern const char *const CHARACTER3D;
extern const char *const SHAPE3D;

// Shape3D userdata: one reference to a Jolt shape. Bodies and compound shapes
// hold their own references, so a shape can be shared and released early.
struct Shape3D
{
	const JPH::Shape *shape; // nullptr once released
	const char *type; // "box", "sphere", ... (a static string)
};

// Body3D userdata. The memory belongs to Lua; while the body is alive the
// world keeps the userdata reachable through selfRef, so pointers to it
// (Jolt user data, World3D::bodies) stay valid.
struct Body3D
{
	World3D *world; // nullptr once destroyed
	JPH::BodyID id;
	int selfRef;
	int userRef;
	int index; // in world->bodies
	uint16_t layer, mask;
	bool sensor;
	bool forced; // in world->forced: has a force or torque for the next update
	JPH::EMotionType motion;
	float force[3], torque[3];
};

// Character3D userdata (a Jolt CharacterVirtual).
struct Character3D
{
	World3D *world; // nullptr once destroyed
	JPH::CharacterVirtual *cv; // holds one reference
	int selfRef;
	int userRef;
	int index; // in world->characters
	uint16_t layer, mask;
	JPH::ObjectLayer objectLayer;
	float stepHeight;
};

// A contact that started (begin) or ended. a and b are object keys: a body's
// BodyID, or CHARACTER_KEY | the character's ID.
struct ContactEvent
{
	bool begin;
	uint32_t a, b;
	float nx, ny, nz; // from a to b (begin only)
};

static const uint32_t CHARACTER_KEY = 0x80000000u;

class ContactListener3D final : public JPH::ContactListener
{
public:
	World3D *world = nullptr;
	void OnContactAdded(const JPH::Body &body1, const JPH::Body &body2, const JPH::ContactManifold &manifold, JPH::ContactSettings &settings) override;
	void OnContactRemoved(const JPH::SubShapeIDPair &pair) override;
};

class CharacterListener3D final : public JPH::CharacterContactListener
{
public:
	World3D *world = nullptr;
	void OnContactAdded(const JPH::CharacterVirtual *character, const JPH::CharacterContact &contact, JPH::CharacterContactSettings &settings) override;
	void OnContactRemoved(const JPH::CharacterVirtual *character, const JPH::BodyID &body, const JPH::SubShapeID &subShape) override;
	void OnCharacterContactAdded(const JPH::CharacterVirtual *character, const JPH::CharacterContact &contact, JPH::CharacterContactSettings &settings) override;
	void OnCharacterContactRemoved(const JPH::CharacterVirtual *character, const JPH::CharacterID &other, const JPH::SubShapeID &subShape) override;
};

// The C++ side of a World3D. The World3D userdata holds a pointer to it; it
// is deleted by the userdata's __gc, so it outlives destroy() (which frees
// the Jolt system and sets system to nullptr).
struct World3D
{
	JPH::PhysicsSystem *system = nullptr;
	ContactListener3D contactListener;
	CharacterListener3D characterListener;
	JPH::CharacterVsCharacterCollisionSimple characterVsCharacter;

	std::vector<Body3D *> bodies;
	std::vector<Character3D *> characters;
	std::vector<Body3D *> forced;

	// Body/body contacts, by pair key. Jolt reports sub-shape contacts while
	// it steps; reconcileContacts() turns them into begin/finish events after
	// each step. Jolt also removes the contacts of bodies that fall asleep:
	// those pairs stay touching (in sleepingPairs) until a body wakes up and
	// is no longer in contact.
	struct BodyPair
	{
		int count = 0; // sub-shape contacts Jolt has now
		bool touching = false; // begin was sent, finish wasn't
		bool dirty = false; // in dirtyPairs
		bool sleeping = false; // in sleepingPairs
		uint8_t awakeChecks = 0;
		uint32_t a = 0, b = 0;
		float normal[3] = {0.0f, 0.0f, 0.0f};
	};
	std::unordered_map<uint64_t, BodyPair> bodyPairs;
	std::vector<uint64_t> dirtyPairs;
	std::vector<uint64_t> sleepingPairs;

	// Contacts of characters (with bodies or characters), by pair key: how
	// many sub-shape contacts are touching. Characters don't sleep, so begin
	// is sent when it becomes 1 and finish when it drops to 0.
	std::unordered_map<uint64_t, int> characterPairs;

	std::vector<ContactEvent> events;
	size_t eventHead = 0;

	double accumulator = 0.0;
	bool stepped = false; // has run a step yet
	int addedSinceStep = 0; // bodies added since the last step
	int beginRef = LUA_NOREF;
	int endRef = LUA_NOREF;

	void bodyContactAdded(uint32_t a, uint32_t b, JPH::Vec3Arg normal);
	void bodyContactRemoved(uint32_t a, uint32_t b);
	void reconcileContacts();
	void characterContactAdded(uint32_t a, uint32_t b, JPH::Vec3Arg normal);
	void characterContactRemoved(uint32_t a, uint32_t b);
	void forgetCharacterPairsOf(uint32_t key);
};

// Fixed physics step and the most steps one World3D:update runs.
static const double FIXED_STEP = 1.0 / 60.0;
static const int MAX_STEPS = 4;

// Physics3D.cpp
void initJolt();
JPH::TempAllocator &tempAllocator();
JPH::JobSystem &jobSystem();

const JPH::BroadPhaseLayerInterface &broadPhaseLayers();
const JPH::ObjectVsBroadPhaseLayerFilter &objectVsBroadPhaseFilter();
const JPH::ObjectLayerPairFilter &objectLayerPairFilter();
// Returns the object layer for this layer/mask/moving combination, or
// JPH::cObjectLayerInvalid when there are too many distinct combinations.
JPH::ObjectLayer internObjectLayer(uint16_t layer, uint16_t mask, bool moving);
uint16_t objectLayerBits(JPH::ObjectLayer l);
uint16_t objectLayerMask(JPH::ObjectLayer l);

inline uint32_t bodyKey(const JPH::BodyID &id) { return id.GetIndexAndSequenceNumber(); }
inline uint32_t characterKey(const JPH::CharacterVirtual *cv) { return CHARACTER_KEY | (cv->GetID().GetValue() & ~CHARACTER_KEY); }

// Lua helpers.
float checkFloat(lua_State *L, int idx);
float optFloat(lua_State *L, int idx, float def);
uint16_t checkBits(lua_State *L, int idx, const char *what);
uint16_t optBits(lua_State *L, int idx, uint16_t def, const char *what);
// Table fields: idx is the table; errors name the field and the function.
bool fieldExists(lua_State *L, int idx, const char *name);
float fieldFloat(lua_State *L, int idx, const char *name, float def, const char *fn);
bool fieldBool(lua_State *L, int idx, const char *name, bool def, const char *fn);
uint16_t fieldBits(lua_State *L, int idx, const char *name, uint16_t def, const char *fn);
// Reads an optional quaternion from fields qx, qy, qz, qw (normalized).
JPH::Quat fieldQuat(lua_State *L, int idx, const char *fn);
// Reads a quaternion from four stack values (normalized).
JPH::Quat checkQuat(lua_State *L, int idx);

void newMetatable(lua_State *L, const char *name, const luaL_Reg *methods, lua_CFunction gc);
int typeOf(lua_State *L, const char *name);
int pushRef(lua_State *L, int ref); // pushes the value (or nil) and returns 1
void setRef(lua_State *L, int *ref, int idx); // replaces *ref with a ref to idx (nil clears)
void clearRef(lua_State *L, int *ref);

// wrap_Shape3D.cpp
Shape3D *checkShape(lua_State *L, int idx);
Shape3D *toShape(lua_State *L, int idx); // nullptr if not a Shape3D
void registerShape3D(lua_State *L);
extern const luaL_Reg shapeFunctions[];

// wrap_World3D.cpp
World3D *checkWorld(lua_State *L, int idx);
void destroyWorld(lua_State *L, World3D *w);
void dispatchEvents(lua_State *L, World3D *w);
void pushWorld(lua_State *L, World3D *w); // its World3D userdata
void registerWorld3D(lua_State *L);
int w_newWorld(lua_State *L);

// wrap_Body3D.cpp
Body3D *checkBody(lua_State *L, int idx);
int newBody(lua_State *L, World3D *w); // World3D:newBody, table at index 2
void destroyBody(lua_State *L, Body3D *b);
void registerBody3D(lua_State *L);

// wrap_Character3D.cpp
Character3D *checkCharacter(lua_State *L, int idx);
int newCharacter(lua_State *L, World3D *w); // World3D:newCharacter, table at index 2
void destroyCharacter(lua_State *L, Character3D *c);
void registerCharacter3D(lua_State *L);

} // physics3d
} // love

#endif // LOVE_PHYSICS3D_PHYSICS3D_H
