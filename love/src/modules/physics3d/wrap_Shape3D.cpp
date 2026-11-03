/**
 * Smitten: love.physics3d. Shape3D and the shape constructors.
 **/

#include "Physics3D.h"

#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/ConvexHullShape.h>
#include <Jolt/Physics/Collision/Shape/CylinderShape.h>
#include <Jolt/Physics/Collision/Shape/MeshShape.h>
#include <Jolt/Physics/Collision/Shape/RotatedTranslatedShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/Collision/Shape/StaticCompoundShape.h>

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace love
{
namespace physics3d
{

// The last shape creation error (set by create(), raised by finish()).
static char gShapeError[256];

Shape3D *toShape(lua_State *L, int idx)
{
	void *p = lua_touserdata(L, idx);
	if (p == nullptr || !lua_getmetatable(L, idx))
		return nullptr;
	luaL_getmetatable(L, SHAPE3D);
	bool same = lua_rawequal(L, -1, -2) != 0;
	lua_pop(L, 2);
	return same ? (Shape3D *) p : nullptr;
}

Shape3D *checkShape(lua_State *L, int idx)
{
	Shape3D *s = (Shape3D *) luaL_checkudata(L, idx, SHAPE3D);
	if (s->shape == nullptr)
		luaL_error(L, "Shape3D has been released");
	return s;
}

// Pushes an empty Shape3D; the constructor fills it in once the Jolt shape
// exists, so a Lua memory error can't leak a shape.
static Shape3D *newShapeUserdata(lua_State *L, const char *type)
{
	Shape3D *s = (Shape3D *) lua_newuserdata(L, sizeof(Shape3D));
	s->shape = nullptr;
	s->type = type;
	luaL_getmetatable(L, SHAPE3D);
	lua_setmetatable(L, -2);
	return s;
}

// Creates the shape and returns it with one reference, or nullptr with the
// error in gShapeError. The Jolt result object is gone when this returns.
static const JPH::Shape *create(const JPH::ShapeSettings &settings)
{
	JPH::ShapeSettings::ShapeResult result = settings.Create();
	if (result.HasError())
	{
		std::snprintf(gShapeError, sizeof(gShapeError), "%s", result.GetError().c_str());
		return nullptr;
	}
	const JPH::Shape *shape = result.Get().GetPtr();
	shape->AddRef();
	return shape;
}

static int finish(lua_State *L, Shape3D *s, const JPH::Shape *shape, const char *fn)
{
	if (shape == nullptr)
		return luaL_error(L, "%s: %s", fn, gShapeError);
	s->shape = shape;
	return 1;
}

static float checkPositive(lua_State *L, int idx, const char *what)
{
	float v = checkFloat(L, idx);
	if (!(v > 0.0f) || !std::isfinite(v))
		luaL_error(L, "%s must be greater than 0 (got %f)", what, (double) v);
	return v;
}

// Jolt rounds convex shapes by this radius; it must fit inside the shape.
static float convexRadius(float smallestHalfSize)
{
	return std::min(JPH::cDefaultConvexRadius, 0.5f * smallestHalfSize);
}

static int w_newBoxShape(lua_State *L)
{
	float hx = checkPositive(L, 1, "Half width (hx)");
	float hy = checkPositive(L, 2, "Half height (hy)");
	float hz = checkPositive(L, 3, "Half depth (hz)");
	Shape3D *s = newShapeUserdata(L, "box");
	const JPH::Shape *shape = create(JPH::BoxShapeSettings(JPH::Vec3(hx, hy, hz), convexRadius(std::min({hx, hy, hz}))));
	return finish(L, s, shape, "newBoxShape");
}

static int w_newSphereShape(lua_State *L)
{
	float r = checkPositive(L, 1, "Radius");
	Shape3D *s = newShapeUserdata(L, "sphere");
	const JPH::Shape *shape = create(JPH::SphereShapeSettings(r));
	return finish(L, s, shape, "newSphereShape");
}

static int w_newCapsuleShape(lua_State *L)
{
	float halfHeight = checkPositive(L, 1, "Half height");
	float r = checkPositive(L, 2, "Radius");
	Shape3D *s = newShapeUserdata(L, "capsule");
	const JPH::Shape *shape = create(JPH::CapsuleShapeSettings(halfHeight, r));
	return finish(L, s, shape, "newCapsuleShape");
}

static int w_newCylinderShape(lua_State *L)
{
	float halfHeight = checkPositive(L, 1, "Half height");
	float r = checkPositive(L, 2, "Radius");
	Shape3D *s = newShapeUserdata(L, "cylinder");
	const JPH::Shape *shape = create(JPH::CylinderShapeSettings(halfHeight, r, convexRadius(std::min(halfHeight, r))));
	return finish(L, s, shape, "newCylinderShape");
}

// Checks that t[1..n] are all numbers (n = #t) and returns n.
static int checkNumberArray(lua_State *L, int idx, const char *fn, const char *what)
{
	luaL_checktype(L, idx, LUA_TTABLE);
	int n = (int) lua_objlen(L, idx);
	for (int i = 1; i <= n; i++)
	{
		lua_rawgeti(L, idx, i);
		if (lua_type(L, -1) != LUA_TNUMBER)
			luaL_error(L, "%s: %s[%d] must be a number, not %s", fn, what, i, luaL_typename(L, -1));
		lua_pop(L, 1);
	}
	return n;
}

static float rawFloat(lua_State *L, int idx, int i)
{
	lua_rawgeti(L, idx, i);
	float v = (float) lua_tonumber(L, -1);
	lua_pop(L, 1);
	return v;
}

static const JPH::Shape *createConvexHull(lua_State *L, int idx, int n)
{
	JPH::Array<JPH::Vec3> points;
	points.reserve(n / 3);
	for (int i = 1; i <= n; i += 3)
		points.push_back(JPH::Vec3(rawFloat(L, idx, i), rawFloat(L, idx, i + 1), rawFloat(L, idx, i + 2)));
	return create(JPH::ConvexHullShapeSettings(points));
}

static int w_newConvexHullShape(lua_State *L)
{
	int n = checkNumberArray(L, 1, "newConvexHullShape", "points");
	if (n % 3 != 0)
		return luaL_error(L, "newConvexHullShape: points must be a flat list {x1, y1, z1, x2, ...} (got %d numbers)", n);
	if (n < 12)
		return luaL_error(L, "newConvexHullShape: a convex hull needs at least 4 points (got %d)", n / 3);
	Shape3D *s = newShapeUserdata(L, "convexhull");
	const JPH::Shape *shape = createConvexHull(L, 1, n);
	return finish(L, s, shape, "newConvexHullShape");
}

static const JPH::Shape *createMesh(lua_State *L, int nv, int ni)
{
	JPH::VertexList vertices;
	vertices.reserve(nv / 3);
	for (int i = 1; i <= nv; i += 3)
		vertices.push_back(JPH::Float3(rawFloat(L, 1, i), rawFloat(L, 1, i + 1), rawFloat(L, 1, i + 2)));
	JPH::IndexedTriangleList triangles;
	triangles.reserve(ni / 3);
	for (int i = 1; i <= ni; i += 3)
		triangles.push_back(JPH::IndexedTriangle((JPH::uint32) rawFloat(L, 2, i) - 1, (JPH::uint32) rawFloat(L, 2, i + 1) - 1, (JPH::uint32) rawFloat(L, 2, i + 2) - 1));
	return create(JPH::MeshShapeSettings(std::move(vertices), std::move(triangles)));
}

static int w_newMeshShape(lua_State *L)
{
	int nv = checkNumberArray(L, 1, "newMeshShape", "vertices");
	int ni = checkNumberArray(L, 2, "newMeshShape", "indices");
	if (nv % 3 != 0 || nv == 0)
		return luaL_error(L, "newMeshShape: vertices must be a flat list {x1, y1, z1, x2, ...} (got %d numbers)", nv);
	if (ni % 3 != 0 || ni == 0)
		return luaL_error(L, "newMeshShape: indices must list triangles, 3 indices each (got %d indices)", ni);
	int count = nv / 3;
	for (int i = 1; i <= ni; i++)
	{
		lua_rawgeti(L, 2, i);
		lua_Number v = lua_tonumber(L, -1);
		lua_pop(L, 1);
		if (v < 1 || v > count || std::floor(v) != v)
			return luaL_error(L, "newMeshShape: indices[%d] is %f, which isn't a vertex (indices are 1-based, from 1 to %d)", i, (double) v, count);
	}
	Shape3D *s = newShapeUserdata(L, "mesh");
	const JPH::Shape *shape = createMesh(L, nv, ni);
	return finish(L, s, shape, "newMeshShape");
}

struct CompoundPart
{
	const JPH::Shape *shape;
	float x, y, z;
	float q[4]; // normalized (not a JPH::Quat: Lua userdata is only 8-byte aligned)
};

static float partFloat(lua_State *L, int part, int i, float def, int index)
{
	lua_rawgeti(L, part, i);
	float v = def;
	if (!lua_isnil(L, -1))
	{
		if (lua_type(L, -1) != LUA_TNUMBER)
			luaL_error(L, "newCompoundShape: part %d, value %d must be a number, not %s", index, i, luaL_typename(L, -1));
		v = (float) lua_tonumber(L, -1);
	}
	lua_pop(L, 1);
	return v;
}

static const JPH::Shape *createCompound(const CompoundPart *parts, int n)
{
	if (n == 1)
	{
		// Jolt's compound shapes need two or more parts.
		const CompoundPart &p = parts[0];
		return create(JPH::RotatedTranslatedShapeSettings(JPH::Vec3(p.x, p.y, p.z), JPH::Quat(p.q[0], p.q[1], p.q[2], p.q[3]), p.shape));
	}
	JPH::StaticCompoundShapeSettings settings;
	for (int i = 0; i < n; i++)
		settings.AddShape(JPH::Vec3(parts[i].x, parts[i].y, parts[i].z), JPH::Quat(parts[i].q[0], parts[i].q[1], parts[i].q[2], parts[i].q[3]), parts[i].shape);
	return create(settings);
}

static int w_newCompoundShape(lua_State *L)
{
	luaL_checktype(L, 1, LUA_TTABLE);
	int n = (int) lua_objlen(L, 1);
	if (n == 0)
		return luaL_error(L, "newCompoundShape: needs at least one part: { {shape, x, y, z, qx, qy, qz, qw}, ... }");

	// Parts live in a Lua userdata so an error while reading them leaks nothing.
	CompoundPart *parts = (CompoundPart *) lua_newuserdata(L, sizeof(CompoundPart) * n);
	int partsIdx = lua_gettop(L);
	for (int i = 1; i <= n; i++)
	{
		lua_rawgeti(L, 1, i);
		int part = lua_gettop(L);
		if (!lua_istable(L, part))
			return luaL_error(L, "newCompoundShape: part %d must be a table {shape, x, y, z, qx, qy, qz, qw}", i);
		lua_rawgeti(L, part, 1);
		Shape3D *s = toShape(L, -1);
		if (s == nullptr)
			return luaL_error(L, "newCompoundShape: part %d must start with a Shape3D", i);
		if (s->shape == nullptr)
			return luaL_error(L, "newCompoundShape: the Shape3D in part %d has been released", i);
		lua_pop(L, 1);
		CompoundPart &p = parts[i - 1];
		p.shape = s->shape;
		p.x = partFloat(L, part, 2, 0.0f, i);
		p.y = partFloat(L, part, 3, 0.0f, i);
		p.z = partFloat(L, part, 4, 0.0f, i);
		float qx = partFloat(L, part, 5, 0.0f, i), qy = partFloat(L, part, 6, 0.0f, i);
		float qz = partFloat(L, part, 7, 0.0f, i), qw = partFloat(L, part, 8, 1.0f, i);
		float len = std::sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
		if (!(len > 1.0e-12f))
			return luaL_error(L, "newCompoundShape: part %d has a rotation with no length", i);
		p.q[0] = qx / len;
		p.q[1] = qy / len;
		p.q[2] = qz / len;
		p.q[3] = qw / len;
		lua_pop(L, 1);
	}
	Shape3D *s = newShapeUserdata(L, "compound");
	const JPH::Shape *shape = createCompound(parts, n);
	finish(L, s, shape, "newCompoundShape");
	lua_remove(L, partsIdx);
	return 1;
}

static int w_Shape_getType(lua_State *L)
{
	Shape3D *s = (Shape3D *) luaL_checkudata(L, 1, SHAPE3D);
	lua_pushstring(L, s->type);
	return 1;
}

static int w_Shape_typeOf(lua_State *L)
{
	luaL_checkudata(L, 1, SHAPE3D);
	return typeOf(L, SHAPE3D);
}

static int w_Shape_release(lua_State *L)
{
	Shape3D *s = (Shape3D *) luaL_checkudata(L, 1, SHAPE3D);
	bool had = s->shape != nullptr;
	if (had)
		s->shape->Release();
	s->shape = nullptr;
	lua_pushboolean(L, had);
	return 1;
}

static int w_Shape_isReleased(lua_State *L)
{
	Shape3D *s = (Shape3D *) luaL_checkudata(L, 1, SHAPE3D);
	lua_pushboolean(L, s->shape == nullptr);
	return 1;
}

static int w_Shape_gc(lua_State *L)
{
	Shape3D *s = (Shape3D *) lua_touserdata(L, 1);
	if (s->shape != nullptr)
		s->shape->Release();
	s->shape = nullptr;
	return 0;
}

static const luaL_Reg shapeMethods[] = {
	{"getType", w_Shape_getType},
	{"typeOf", w_Shape_typeOf},
	{"release", w_Shape_release},
	{"destroy", w_Shape_release},
	{"isReleased", w_Shape_isReleased},
	{nullptr, nullptr}
};

const luaL_Reg shapeFunctions[] = {
	{"newBoxShape", w_newBoxShape},
	{"newSphereShape", w_newSphereShape},
	{"newCapsuleShape", w_newCapsuleShape},
	{"newCylinderShape", w_newCylinderShape},
	{"newConvexHullShape", w_newConvexHullShape},
	{"newMeshShape", w_newMeshShape},
	{"newCompoundShape", w_newCompoundShape},
	{nullptr, nullptr}
};

void registerShape3D(lua_State *L)
{
	newMetatable(L, SHAPE3D, shapeMethods, w_Shape_gc);
}

} // physics3d
} // love
