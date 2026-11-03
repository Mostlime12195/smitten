/*
 * love.box2d: a small Lua binding of Box2D 3 (deps/box2d3) for the scene's
 * physics (love/src/modules/scene/physics2d.lua). It's the physics2d side
 * module, loaded the first time a scene has a Body, Zone or Joint.
 *
 * Ids are plain Lua numbers (index, world and generation packed into 53
 * bits), so nothing is allocated per body or shape. Lengths are pixels:
 * Box2D is told there are 64 of them to a meter, which scales its
 * tolerances. Collision bits (see physics2d.lua):
 *
 *   categoryBits = what the shape is (KIND_*) | the bits of its tags
 *   maskBits     = everything but the bits of the tags it passes through
 *
 * A custom filter turns those into "a body passes through bodies with a tag in
 * its passThrough". A Zone's sensor uses maskBits for the tags it detects.
 *
 * Scripted bodies are kinematic and move with the character mover
 * (b2World_CastMoverProxy / b2World_CollideMoverProxy / b2SolvePlanes, see
 * deps/box2d3/PATCHES.md): move() here does a whole move in one call.
 */

#include "box2d/box2d.h"
#include "box2d/math_functions.h"

#include "lauxlib.h"
#include "lua.h"

#include <float.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define PIXELS_PER_METER 64.0f
#define SLOP ( 0.005f * PIXELS_PER_METER ) // Box2D's linear slop
#define HUGE_LENGTH ( 100000.0f * PIXELS_PER_METER )

// Collision bits (keep in step with physics2d.lua).
#define KIND_STILL 0x01ull
#define KIND_SCRIPTED 0x02ull
#define KIND_PHYSICS 0x04ull
#define KIND_ZONE 0x08ull
#define KIND_TILES 0x10ull
#define KIND_ONEWAY 0x20ull
#define KIND_ANCHOR 0x40ull
#define KIND_QUERY 0x80ull
#define KIND_BITS 0xFFull
#define TAG_BITS ( ( ( 1ull << 53 ) - 1 ) & ~KIND_BITS )

// ---------------------------------------------------------------------------
// Ids as numbers

static double packId( int32_t index1, uint16_t world0, uint16_t generation )
{
	return (double)index1 * 4294967296.0 + (double)world0 * 65536.0 + (double)generation;
}

static void unpackId( double v, int32_t* index1, uint16_t* world0, uint16_t* generation )
{
	uint64_t u = (uint64_t)v;
	*index1 = (int32_t)( u >> 32 );
	*world0 = (uint16_t)( ( u >> 16 ) & 0xFFFF );
	*generation = (uint16_t)( u & 0xFFFF );
}

static b2BodyId toBody( lua_State* L, int i )
{
	b2BodyId id;
	unpackId( luaL_checknumber( L, i ), &id.index1, &id.world0, &id.generation );
	if ( b2Body_IsValid( id ) == false )
		luaL_error( L, "physics: that body no longer exists" );
	return id;
}

static b2ShapeId shapeFromNumber( double v )
{
	b2ShapeId id;
	unpackId( v, &id.index1, &id.world0, &id.generation );
	return id;
}

static b2ShapeId toShape( lua_State* L, int i )
{
	b2ShapeId id = shapeFromNumber( luaL_checknumber( L, i ) );
	if ( b2Shape_IsValid( id ) == false )
		luaL_error( L, "physics: that shape no longer exists" );
	return id;
}

static b2JointId toJoint( lua_State* L, int i )
{
	b2JointId id;
	unpackId( luaL_checknumber( L, i ), &id.index1, &id.world0, &id.generation );
	if ( b2Joint_IsValid( id ) == false )
		luaL_error( L, "physics: that joint no longer exists" );
	return id;
}

static b2ChainId chainFromNumber( double v )
{
	b2ChainId id;
	unpackId( v, &id.index1, &id.world0, &id.generation );
	return id;
}

static double bodyNumber( b2BodyId id ) { return packId( id.index1, id.world0, id.generation ); }
static double shapeNumber( b2ShapeId id ) { return packId( id.index1, id.world0, id.generation ); }

static b2WorldId toWorld( lua_State* L, int i )
{
	uint32_t v = (uint32_t)luaL_checknumber( L, i );
	b2WorldId id = { (uint16_t)( v >> 16 ), (uint16_t)( v & 0xFFFF ) };
	if ( b2World_IsValid( id ) == false )
		luaL_error( L, "physics: the world no longer exists" );
	return id;
}

static uint64_t toBits( lua_State* L, int i ) { return (uint64_t)luaL_checknumber( L, i ); }

// Every piece with a Box2D body has a slot (physics2d.lua): its body's and shapes' user data.
static int slotOf( b2BodyId body ) { return (int)(intptr_t)b2Body_GetUserData( body ); }
static int shapeSlot( b2ShapeId shape ) { return (int)(intptr_t)b2Shape_GetUserData( shape ); }

static float angleOf( b2Rot q ) { return b2Rot_GetAngle( q ); }

// ---------------------------------------------------------------------------
// The world

// What a world needs in its callbacks: the direction of "up" (against gravity).
typedef struct WorldInfo
{
	b2Vec2 up;
} WorldInfo;

static WorldInfo worldInfos[128]; // B2_MAX_WORLDS

static bool customFilter( b2ShapeId a, b2ShapeId b, void* context )
{
	(void)context;
	b2Filter fa = b2Shape_GetFilter( a );
	b2Filter fb = b2Shape_GetFilter( b );
	// A body passes through bodies with a tag in its passThrough, and the other way round.
	return ( fa.categoryBits & TAG_BITS & ~fb.maskBits ) == 0 && ( fb.categoryBits & TAG_BITS & ~fa.maskBits ) == 0;
}

// One-way platforms (chain segments): things only land on them from above.
static bool preSolve( b2ShapeId a, b2ShapeId b, b2Manifold* manifold, void* context )
{
	(void)context;
	float sign;
	b2ShapeId platform;
	if ( b2Shape_GetFilter( a ).categoryBits & KIND_ONEWAY )
	{
		platform = a;
		sign = 1.0f;
	}
	else if ( b2Shape_GetFilter( b ).categoryBits & KIND_ONEWAY )
	{
		platform = b;
		sign = -1.0f;
	}
	else
	{
		return true;
	}
	if ( b2Shape_GetType( platform ) != b2_chainSegmentShape )
		return true;
	b2ChainSegment seg = b2Shape_GetChainSegment( platform );
	b2Transform xf = b2Body_GetTransform( b2Shape_GetBody( platform ) );
	b2Vec2 e = b2RotateVector( xf.q, b2Sub( seg.segment.point2, seg.segment.point1 ) );
	b2Vec2 up = b2Normalize( b2RightPerp( e ) );
	// The manifold's normal points from shape a to shape b.
	if ( sign * b2Dot( manifold->normal, up ) < 0.7f )
		return false;
	// Coming up from below (deep inside the platform's line): pass through.
	for ( int i = 0; i < manifold->pointCount; ++i )
	{
		if ( manifold->points[i].separation < -4.0f * SLOP )
			return false;
	}
	return true;
}

static int w_newWorld( lua_State* L )
{
	b2SetLengthUnitsPerMeter( PIXELS_PER_METER );
	b2WorldDef def = b2DefaultWorldDef();
	def.gravity = (b2Vec2){ (float)luaL_optnumber( L, 1, 0.0 ), (float)luaL_optnumber( L, 2, 980.0 ) };
	b2WorldId id = b2CreateWorld( &def );
	b2World_SetCustomFilterCallback( id, customFilter, NULL );
	b2World_SetPreSolveCallback( id, preSolve, NULL );
	WorldInfo* info = worldInfos + ( id.index1 - 1 );
	info->up = b2LengthSquared( def.gravity ) > 0.0f ? b2Neg( b2Normalize( def.gravity ) ) : (b2Vec2){ 0.0f, -1.0f };
	lua_pushnumber( L, (double)id.index1 * 65536.0 + id.generation );
	return 1;
}

static int w_destroyWorld( lua_State* L )
{
	uint32_t v = (uint32_t)luaL_checknumber( L, 1 );
	b2WorldId id = { (uint16_t)( v >> 16 ), (uint16_t)( v & 0xFFFF ) };
	if ( b2World_IsValid( id ) )
		b2DestroyWorld( id );
	return 0;
}

static int w_step( lua_State* L )
{
	b2WorldId w = toWorld( L, 1 );
	b2World_Step( w, (float)luaL_checknumber( L, 2 ), (int)luaL_optinteger( L, 3, 4 ) );
	return 0;
}

static int w_setGravity( lua_State* L )
{
	b2WorldId w = toWorld( L, 1 );
	b2Vec2 g = { (float)luaL_checknumber( L, 2 ), (float)luaL_checknumber( L, 3 ) };
	b2World_SetGravity( w, g );
	worldInfos[w.index1 - 1].up = b2LengthSquared( g ) > 0.0f ? b2Neg( b2Normalize( g ) ) : (b2Vec2){ 0.0f, -1.0f };
	return 0;
}

static int w_getGravity( lua_State* L )
{
	b2Vec2 g = b2World_GetGravity( toWorld( L, 1 ) );
	lua_pushnumber( L, g.x );
	lua_pushnumber( L, g.y );
	return 2;
}

static int w_awakeCount( lua_State* L )
{
	lua_pushinteger( L, b2World_GetAwakeBodyCount( toWorld( L, 1 ) ) );
	return 1;
}

// Writes numbers into a reused Lua table (no garbage per step).
#define PUT( v ) ( lua_pushnumber( L, ( v ) ), lua_rawseti( L, buf, ++k ) )

// The dynamic bodies that moved in the last step: slot, x, y, angle, vx, vy,
// spin, asleep (1 or 0) for each, into buf. Returns how many.
static int w_moves( lua_State* L )
{
	b2WorldId w = toWorld( L, 1 );
	int buf = 2;
	luaL_checktype( L, buf, LUA_TTABLE );
	b2BodyEvents events = b2World_GetBodyEvents( w );
	int k = 0, n = 0;
	for ( int i = 0; i < events.moveCount; ++i )
	{
		const b2BodyMoveEvent* e = events.moveEvents + i;
		if ( b2Body_GetType( e->bodyId ) != b2_dynamicBody )
			continue;
		b2Vec2 v = b2Body_GetLinearVelocity( e->bodyId );
		float spin = b2Body_GetAngularVelocity( e->bodyId );
		PUT( (int)(intptr_t)e->userData );
		PUT( e->transform.p.x );
		PUT( e->transform.p.y );
		PUT( angleOf( e->transform.q ) );
		PUT( e->fellAsleep ? 0.0f : v.x );
		PUT( e->fellAsleep ? 0.0f : v.y );
		PUT( e->fellAsleep ? 0.0f : spin );
		PUT( e->fellAsleep ? 1 : 0 );
		n++;
	}
	lua_pushinteger( L, n );
	return 1;
}

// The total normal impulse between two shapes in the last step.
static float impulseBetween( b2ShapeId a, b2ShapeId b )
{
	if ( b2Shape_IsValid( a ) == false || b2Shape_IsValid( b ) == false )
		return 0.0f;
	b2ContactData data[16];
	int n = b2Shape_GetContactData( a, data, 16 );
	for ( int i = 0; i < n; ++i )
	{
		if ( B2_ID_EQUALS( data[i].shapeIdA, b ) || B2_ID_EQUALS( data[i].shapeIdB, b ) )
		{
			float sum = 0.0f;
			for ( int j = 0; j < data[i].manifold.pointCount; ++j )
				sum += data[i].manifold.points[j].totalNormalImpulse;
			return sum;
		}
	}
	return 0.0f;
}

// Contacts that began in the last step: slotA, slotB, x, y, nx, ny (from a
// to b), impulse for each, into buf. Returns how many.
static int w_contacts( lua_State* L )
{
	b2WorldId w = toWorld( L, 1 );
	int buf = 2;
	luaL_checktype( L, buf, LUA_TTABLE );
	b2ContactEvents events = b2World_GetContactEvents( w );
	int k = 0;
	for ( int i = 0; i < events.beginCount; ++i )
	{
		const b2ContactBeginTouchEvent* e = events.beginEvents + i;
		const b2Manifold* m = &e->manifold;
		b2Vec2 p = { 0.0f, 0.0f };
		for ( int j = 0; j < m->pointCount; ++j )
			p = b2Add( p, m->points[j].point );
		if ( m->pointCount > 0 )
			p = b2MulSV( 1.0f / m->pointCount, p );
		PUT( shapeSlot( e->shapeIdA ) );
		PUT( shapeSlot( e->shapeIdB ) );
		PUT( p.x );
		PUT( p.y );
		PUT( m->normal.x );
		PUT( m->normal.y );
		PUT( impulseBetween( e->shapeIdA, e->shapeIdB ) );
	}
	lua_pushinteger( L, events.beginCount );
	return 1;
}

// Sensor overlaps that began (into begins) and ended (into ends) in the last
// step: the sensor's slot, the visitor's slot (0 if its shape is gone) and
// the visitor shape. Returns both counts.
static int w_sensors( lua_State* L )
{
	b2WorldId w = toWorld( L, 1 );
	luaL_checktype( L, 2, LUA_TTABLE );
	luaL_checktype( L, 3, LUA_TTABLE );
	b2SensorEvents events = b2World_GetSensorEvents( w );
	int buf = 2, k = 0;
	for ( int i = 0; i < events.beginCount; ++i )
	{
		b2ShapeId s = events.beginEvents[i].sensorShapeId, v = events.beginEvents[i].visitorShapeId;
		PUT( b2Shape_IsValid( s ) ? shapeSlot( s ) : 0 );
		PUT( b2Shape_IsValid( v ) ? shapeSlot( v ) : 0 );
		PUT( shapeNumber( v ) );
	}
	buf = 3;
	k = 0;
	for ( int i = 0; i < events.endCount; ++i )
	{
		b2ShapeId s = events.endEvents[i].sensorShapeId, v = events.endEvents[i].visitorShapeId;
		PUT( b2Shape_IsValid( s ) ? shapeSlot( s ) : 0 );
		PUT( b2Shape_IsValid( v ) ? shapeSlot( v ) : 0 );
		PUT( shapeNumber( v ) );
	}
	lua_pushinteger( L, events.beginCount );
	lua_pushinteger( L, events.endCount );
	return 2;
}

// ---------------------------------------------------------------------------
// Bodies

static const b2BodyType bodyTypes[] = { b2_staticBody, b2_kinematicBody, b2_dynamicBody };

static b2BodyType toType( lua_State* L, int i )
{
	int t = (int)luaL_checkinteger( L, i );
	if ( t < 0 || t > 2 )
		luaL_error( L, "physics: bad body type" );
	return bodyTypes[t];
}

// createBody(world, type 0 static | 1 kinematic | 2 dynamic, x, y, angle, slot)
static int w_createBody( lua_State* L )
{
	b2WorldId w = toWorld( L, 1 );
	b2BodyDef def = b2DefaultBodyDef();
	def.type = toType( L, 2 );
	def.position = (b2Vec2){ (float)luaL_checknumber( L, 3 ), (float)luaL_checknumber( L, 4 ) };
	def.rotation = b2MakeRot( (float)luaL_optnumber( L, 5, 0.0 ) );
	def.userData = (void*)(intptr_t)luaL_optinteger( L, 6, 0 );
	b2BodyId id = b2CreateBody( w, &def );
	lua_pushnumber( L, bodyNumber( id ) );
	return 1;
}

static int w_destroyBody( lua_State* L )
{
	b2BodyId id;
	unpackId( luaL_checknumber( L, 1 ), &id.index1, &id.world0, &id.generation );
	if ( b2Body_IsValid( id ) )
		b2DestroyBody( id );
	return 0;
}

static int w_isValid( lua_State* L )
{
	b2BodyId id;
	unpackId( luaL_checknumber( L, 1 ), &id.index1, &id.world0, &id.generation );
	lua_pushboolean( L, b2Body_IsValid( id ) );
	return 1;
}

static int w_setType( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	b2BodyType t = toType( L, 2 );
	if ( b2Body_GetType( b ) != t )
		b2Body_SetType( b, t );
	return 0;
}

static int w_setTransform( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	b2Body_SetTransform( b, (b2Vec2){ (float)luaL_checknumber( L, 2 ), (float)luaL_checknumber( L, 3 ) },
						 b2MakeRot( (float)luaL_checknumber( L, 4 ) ) );
	if ( lua_toboolean( L, 5 ) )
		b2Body_SetAwake( b, true );
	return 0;
}

static int w_getTransform( lua_State* L )
{
	b2Transform xf = b2Body_GetTransform( toBody( L, 1 ) );
	lua_pushnumber( L, xf.p.x );
	lua_pushnumber( L, xf.p.y );
	lua_pushnumber( L, angleOf( xf.q ) );
	return 3;
}

// driveTo(body, fromX, fromY, fromAngle, toX, toY, toAngle, h): puts a
// kinematic body at the "from" pose with the velocity that takes it to the
// "to" pose in one step of h seconds (so it pushes what's in its way).
static int w_driveTo( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	float x0 = (float)luaL_checknumber( L, 2 ), y0 = (float)luaL_checknumber( L, 3 ), a0 = (float)luaL_checknumber( L, 4 );
	float x1 = (float)luaL_checknumber( L, 5 ), y1 = (float)luaL_checknumber( L, 6 ), a1 = (float)luaL_checknumber( L, 7 );
	float h = (float)luaL_checknumber( L, 8 );
	b2Body_SetTransform( b, (b2Vec2){ x0, y0 }, b2MakeRot( a0 ) );
	float da = remainderf( a1 - a0, 2.0f * B2_PI );
	b2Body_SetLinearVelocity( b, (b2Vec2){ ( x1 - x0 ) / h, ( y1 - y0 ) / h } );
	b2Body_SetAngularVelocity( b, da / h );
	return 0;
}

static int w_setVelocity( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	b2Body_SetLinearVelocity( b, (b2Vec2){ (float)luaL_checknumber( L, 2 ), (float)luaL_checknumber( L, 3 ) } );
	if ( !lua_isnoneornil( L, 4 ) )
		b2Body_SetAngularVelocity( b, (float)luaL_checknumber( L, 4 ) );
	return 0;
}

static int w_getVelocity( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	b2Vec2 v = b2Body_GetLinearVelocity( b );
	lua_pushnumber( L, v.x );
	lua_pushnumber( L, v.y );
	lua_pushnumber( L, b2Body_GetAngularVelocity( b ) );
	return 3;
}

// setBodyProps(body, gravityScale, linearDamping, angularDamping, fixedRotation, bullet)
static int w_setBodyProps( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	b2Body_SetGravityScale( b, (float)luaL_checknumber( L, 2 ) );
	b2Body_SetLinearDamping( b, (float)luaL_checknumber( L, 3 ) );
	b2Body_SetAngularDamping( b, (float)luaL_checknumber( L, 4 ) );
	bool fixed = lua_toboolean( L, 5 );
	if ( b2Body_IsFixedRotation( b ) != fixed )
		b2Body_SetFixedRotation( b, fixed );
	b2Body_SetBullet( b, lua_toboolean( L, 6 ) );
	return 0;
}

// setMass(body, mass): the mass from its shapes, scaled to weigh this much.
static int w_setMass( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	float mass = (float)luaL_checknumber( L, 2 );
	b2Body_ApplyMassFromShapes( b );
	if ( b2Body_GetType( b ) != b2_dynamicBody )
		return 0;
	b2MassData md = b2Body_GetMassData( b );
	if ( md.mass > 0.0f && mass > 0.0f )
	{
		float scale = mass / md.mass;
		md.mass = mass;
		md.rotationalInertia *= scale;
		b2Body_SetMassData( b, md );
	}
	return 0;
}

static int w_getMass( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	lua_pushnumber( L, b2Body_GetMass( b ) );
	lua_pushnumber( L, b2Body_GetRotationalInertia( b ) );
	return 2;
}

static int w_applyForce( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	b2Vec2 f = { (float)luaL_checknumber( L, 2 ), (float)luaL_checknumber( L, 3 ) };
	if ( lua_isnoneornil( L, 4 ) )
		b2Body_ApplyForceToCenter( b, f, true );
	else
		b2Body_ApplyForce( b, f, (b2Vec2){ (float)luaL_checknumber( L, 4 ), (float)luaL_checknumber( L, 5 ) }, true );
	return 0;
}

static int w_applyImpulse( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	b2Vec2 j = { (float)luaL_checknumber( L, 2 ), (float)luaL_checknumber( L, 3 ) };
	if ( lua_isnoneornil( L, 4 ) )
		b2Body_ApplyLinearImpulseToCenter( b, j, true );
	else
		b2Body_ApplyLinearImpulse( b, j, (b2Vec2){ (float)luaL_checknumber( L, 4 ), (float)luaL_checknumber( L, 5 ) }, true );
	return 0;
}

static int w_applyTorque( lua_State* L )
{
	b2Body_ApplyTorque( toBody( L, 1 ), (float)luaL_checknumber( L, 2 ), true );
	return 0;
}

static int w_applyAngularImpulse( lua_State* L )
{
	b2Body_ApplyAngularImpulse( toBody( L, 1 ), (float)luaL_checknumber( L, 2 ), true );
	return 0;
}

static int w_setAwake( lua_State* L )
{
	b2Body_SetAwake( toBody( L, 1 ), lua_toboolean( L, 2 ) );
	return 0;
}

static int w_isAwake( lua_State* L )
{
	lua_pushboolean( L, b2Body_IsAwake( toBody( L, 1 ) ) );
	return 1;
}

static int w_bodyAABB( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	// Exactly around the shapes (Box2D's own boxes have a margin).
	b2ShapeId shapes[64];
	int n = b2Body_GetShapes( b, shapes, 64 );
	if ( n == 0 )
		return 0;
	b2Transform xf = b2Body_GetTransform( b );
	b2AABB box = { { FLT_MAX, FLT_MAX }, { -FLT_MAX, -FLT_MAX } };
	for ( int i = 0; i < n; ++i )
	{
		b2AABB s;
		switch ( b2Shape_GetType( shapes[i] ) )
		{
			case b2_circleShape:
			{
				b2Circle c = b2Shape_GetCircle( shapes[i] );
				s = b2ComputeCircleAABB( &c, xf );
				break;
			}
			case b2_capsuleShape:
			{
				b2Capsule c = b2Shape_GetCapsule( shapes[i] );
				s = b2ComputeCapsuleAABB( &c, xf );
				break;
			}
			case b2_polygonShape:
			{
				b2Polygon p = b2Shape_GetPolygon( shapes[i] );
				s = b2ComputePolygonAABB( &p, xf );
				break;
			}
			default:
				s = b2Shape_GetAABB( shapes[i] );
		}
		box.lowerBound = b2Min( box.lowerBound, s.lowerBound );
		box.upperBound = b2Max( box.upperBound, s.upperBound );
	}
	lua_pushnumber( L, box.lowerBound.x );
	lua_pushnumber( L, box.lowerBound.y );
	lua_pushnumber( L, box.upperBound.x );
	lua_pushnumber( L, box.upperBound.y );
	return 4;
}

// ---------------------------------------------------------------------------
// Shapes

// Flags for addShape.
#define SHAPE_SENSOR 1
#define SHAPE_SENSOR_EVENTS 2
#define SHAPE_CONTACT_EVENTS 4

// Removes every shape from a body.
static int w_clearShapes( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	b2ShapeId shapes[64];
	for ( ;; )
	{
		int n = b2Body_GetShapes( b, shapes, 64 );
		if ( n == 0 )
			break;
		for ( int i = 0; i < n; ++i )
			b2DestroyShape( shapes[i], false );
	}
	return 0;
}

static b2Polygon polygonFromTable( lua_State* L, int t, float radius )
{
	luaL_checktype( L, t, LUA_TTABLE );
	b2Vec2 points[B2_MAX_POLYGON_VERTICES];
	int n = (int)lua_objlen( L, t ) / 2;
	if ( n > B2_MAX_POLYGON_VERTICES )
		n = B2_MAX_POLYGON_VERTICES;
	for ( int i = 0; i < n; ++i )
	{
		lua_rawgeti( L, t, 2 * i + 1 );
		lua_rawgeti( L, t, 2 * i + 2 );
		points[i] = (b2Vec2){ (float)lua_tonumber( L, -2 ), (float)lua_tonumber( L, -1 ) };
		lua_pop( L, 2 );
	}
	b2Hull hull = b2ComputeHull( points, n );
	if ( hull.count < 3 )
	{
		b2Polygon empty = { 0 };
		return empty;
	}
	return b2MakePolygon( &hull, radius );
}

// addShape(body, slot, category, mask, friction, bounce, flags, kind, ...):
//   "box", cx, cy, halfWidth, halfHeight, angle
//   "circle", cx, cy, radius
//   "capsule", x1, y1, x2, y2, radius
//   "polygon", {x1, y1, x2, y2, ...}
// Returns the shape, or nil if it's too small to make.
static int w_addShape( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	b2ShapeDef def = b2DefaultShapeDef();
	def.userData = (void*)(intptr_t)luaL_checkinteger( L, 2 );
	def.filter.categoryBits = toBits( L, 3 );
	def.filter.maskBits = toBits( L, 4 );
	def.material.friction = (float)luaL_checknumber( L, 5 );
	def.material.restitution = (float)luaL_checknumber( L, 6 );
	int flags = (int)luaL_checkinteger( L, 7 );
	def.isSensor = ( flags & SHAPE_SENSOR ) != 0;
	def.enableSensorEvents = ( flags & SHAPE_SENSOR_EVENTS ) != 0;
	def.enableContactEvents = ( flags & SHAPE_CONTACT_EVENTS ) != 0;
	def.updateBodyMass = false;
	def.density = 1.0f;
	const char* kind = luaL_checkstring( L, 8 );
	b2ShapeId id;
	if ( strcmp( kind, "box" ) == 0 )
	{
		float hw = (float)luaL_checknumber( L, 11 ), hh = (float)luaL_checknumber( L, 12 );
		if ( hw < 0.05f || hh < 0.05f )
			return 0;
		b2Polygon box = b2MakeOffsetBox( hw, hh, (b2Vec2){ (float)luaL_checknumber( L, 9 ), (float)luaL_checknumber( L, 10 ) },
										 b2MakeRot( (float)luaL_optnumber( L, 13, 0.0 ) ) );
		id = b2CreatePolygonShape( b, &def, &box );
	}
	else if ( strcmp( kind, "circle" ) == 0 )
	{
		b2Circle c = { { (float)luaL_checknumber( L, 9 ), (float)luaL_checknumber( L, 10 ) }, (float)luaL_checknumber( L, 11 ) };
		if ( c.radius < 0.05f )
			return 0;
		id = b2CreateCircleShape( b, &def, &c );
	}
	else if ( strcmp( kind, "capsule" ) == 0 )
	{
		b2Capsule c = { { (float)luaL_checknumber( L, 9 ), (float)luaL_checknumber( L, 10 ) },
						{ (float)luaL_checknumber( L, 11 ), (float)luaL_checknumber( L, 12 ) },
						(float)luaL_checknumber( L, 13 ) };
		if ( c.radius < 0.05f )
			return 0;
		if ( b2DistanceSquared( c.center1, c.center2 ) < 0.01f )
		{
			b2Circle circle = { c.center1, c.radius };
			id = b2CreateCircleShape( b, &def, &circle );
		}
		else
		{
			id = b2CreateCapsuleShape( b, &def, &c );
		}
	}
	else if ( strcmp( kind, "polygon" ) == 0 )
	{
		b2Polygon p = polygonFromTable( L, 9, 0.0f );
		if ( p.count < 3 )
			return 0;
		id = b2CreatePolygonShape( b, &def, &p );
	}
	else
	{
		return luaL_error( L, "physics: no shape kind %s", kind );
	}
	lua_pushnumber( L, shapeNumber( id ) );
	return 1;
}

static int w_destroyShape( lua_State* L )
{
	b2ShapeId id = shapeFromNumber( luaL_checknumber( L, 1 ) );
	if ( b2Shape_IsValid( id ) )
		b2DestroyShape( id, lua_toboolean( L, 2 ) );
	return 0;
}

static int w_setFilter( lua_State* L )
{
	b2ShapeId s = toShape( L, 1 );
	b2Filter f = b2Shape_GetFilter( s );
	uint64_t cat = toBits( L, 2 ), mask = toBits( L, 3 );
	if ( f.categoryBits != cat || f.maskBits != mask )
	{
		f.categoryBits = cat;
		f.maskBits = mask;
		b2Shape_SetFilter( s, f );
	}
	return 0;
}

static int w_setMaterial( lua_State* L )
{
	b2ShapeId s = toShape( L, 1 );
	b2Shape_SetFriction( s, (float)luaL_checknumber( L, 2 ) );
	b2Shape_SetRestitution( s, (float)luaL_checknumber( L, 3 ) );
	return 0;
}

static int w_enableSensorEvents( lua_State* L )
{
	b2ShapeId s = toShape( L, 1 );
	bool on = lua_toboolean( L, 2 );
	if ( b2Shape_AreSensorEventsEnabled( s ) != on )
		b2Shape_EnableSensorEvents( s, on );
	return 0;
}

static int w_shapeSlot( lua_State* L )
{
	b2ShapeId s = shapeFromNumber( luaL_checknumber( L, 1 ) );
	if ( b2Shape_IsValid( s ) == false )
		return 0;
	lua_pushinteger( L, (int)(intptr_t)b2Shape_GetUserData( s ) );
	return 1;
}

// ---------------------------------------------------------------------------
// Tiles: the solid cells of a chunk of a Tiles piece become one-sided chain
// segments along their outline, with ghost vertices from the cells around
// them, so bodies slide over the seams between tiles without catching.

// A chain of one segment: the ghosts tell Box2D what's on either side.
static double addSegment( b2BodyId body, const b2ChainDef* base, b2Vec2 g1, b2Vec2 p1, b2Vec2 p2, b2Vec2 g2 )
{
	b2Vec2 points[4] = { g1, p1, p2, g2 };
	b2ChainDef def = *base;
	def.points = points;
	def.count = 4;
	b2ChainId id = b2CreateChain( body, &def );
	return packId( id.index1, id.world0, id.generation );
}

typedef struct TileGrid
{
	lua_State* L;
	int grid;  // grid[row][column] = tile
	int kinds; // kinds[tile] = 1 solid, 2 one-way
	int rowIndex;
	int cachedRow;
	bool hasRow;
} TileGrid;

// 0 empty (or decoration), 1 solid, 2 one-way.
static int tileKind( TileGrid* g, int cx, int cy )
{
	lua_State* L = g->L;
	lua_rawgeti( L, g->grid, cy );
	if ( lua_type( L, -1 ) != LUA_TTABLE )
	{
		lua_pop( L, 1 );
		return 0;
	}
	lua_rawgeti( L, -1, cx );
	if ( lua_type( L, -1 ) != LUA_TNUMBER )
	{
		lua_pop( L, 2 );
		return 0;
	}
	int tile = (int)lua_tointeger( L, -1 );
	lua_pop( L, 2 );
	lua_rawgeti( L, g->kinds, tile );
	int kind = (int)lua_tointeger( L, -1 );
	lua_pop( L, 1 );
	return kind;
}

static bool solidAt( TileGrid* g, int cx, int cy ) { return tileKind( g, cx, cy ) == 1; }

// Whether the cell beyond corner v in direction d, on side s, is solid.
static bool solidBeyond( TileGrid* g, int vx, int vy, int dx, int dy, int sx, int sy )
{
	// The cell's center is v + d/2 + s/2.
	int cx = (int)floorf( vx + 0.5f * dx + 0.5f * sx );
	int cy = (int)floorf( vy + 0.5f * dy + 0.5f * sy );
	return solidAt( g, cx, cy );
}

// buildTiles(body, grid, kinds, cx0, cy0, cx1, cy1, tileWidth, tileHeight,
//            slot, category, mask, oneWayCategory, friction, out)
// Makes the outline segments of the cells cx0..cx1, cy0..cy1 and puts the
// chains in out (a list). Returns how many.
static int w_buildTiles( lua_State* L )
{
	b2BodyId body = toBody( L, 1 );
	luaL_checktype( L, 2, LUA_TTABLE );
	luaL_checktype( L, 3, LUA_TTABLE );
	int cx0 = (int)luaL_checkinteger( L, 4 ), cy0 = (int)luaL_checkinteger( L, 5 );
	int cx1 = (int)luaL_checkinteger( L, 6 ), cy1 = (int)luaL_checkinteger( L, 7 );
	float tw = (float)luaL_checknumber( L, 8 ), th = (float)luaL_checknumber( L, 9 );
	int slot = (int)luaL_checkinteger( L, 10 );
	uint64_t cat = toBits( L, 11 ), mask = toBits( L, 12 ), oneWayCat = toBits( L, 13 );
	float friction = (float)luaL_checknumber( L, 14 );
	luaL_checktype( L, 15, LUA_TTABLE );
	int out = 15;
	int count = (int)lua_objlen( L, out );

	TileGrid g = { L, 2, 3, 0, 0, false };
	b2SurfaceMaterial material = b2DefaultSurfaceMaterial();
	material.friction = friction;
	b2ChainDef def = b2DefaultChainDef();
	def.materials = &material;
	def.materialCount = 1;
	def.userData = (void*)(intptr_t)slot;
	def.filter.categoryBits = cat;
	def.filter.maskBits = mask;
	def.isLoop = false;

#define CORNER( x, y ) ( (b2Vec2){ ( x ) * tw, ( y ) * th } )

	// The four sides: direction d along the side (solid on its right, so the
	// segment's normal points out of the solid) and the outward normal n.
	// top: d = (1, 0), n = (0, -1); right: d = (0, 1), n = (1, 0);
	// bottom: d = (-1, 0), n = (0, 1); left: d = (0, -1), n = (-1, 0).
	static const int sides[4][4] = { { 1, 0, 0, -1 }, { 0, 1, 1, 0 }, { -1, 0, 0, 1 }, { 0, -1, -1, 0 } };

	for ( int side = 0; side < 4; ++side )
	{
		int dx = sides[side][0], dy = sides[side][1], nx = sides[side][2], ny = sides[side][3];
		bool horizontal = dy == 0;
		// Runs go along rows (top and bottom sides) or columns (left and right).
		int outer0 = horizontal ? cy0 : cx0, outer1 = horizontal ? cy1 : cx1;
		int inner0 = horizontal ? cx0 : cy0, inner1 = horizontal ? cx1 : cy1;
		for ( int o = outer0; o <= outer1; ++o )
		{
			int runStart = 0;
			bool inRun = false;
			for ( int i = inner0; i <= inner1 + 1; ++i )
			{
				bool edge = false;
				if ( i <= inner1 )
				{
					int cx = horizontal ? i : o, cy = horizontal ? o : i;
					edge = solidAt( &g, cx, cy ) && !solidAt( &g, cx + nx, cy + ny );
				}
				if ( edge && !inRun )
				{
					inRun = true;
					runStart = i;
				}
				else if ( !edge && inRun )
				{
					inRun = false;
					// Cells runStart..i-1 along this row or column. Corners of a cell
					// (cx, cy): it spans [cx, cx + 1] x [cy, cy + 1].
					int first = dx + dy > 0 ? runStart : i - 1, last = dx + dy > 0 ? i - 1 : runStart;
					int fcx = horizontal ? first : o, fcy = horizontal ? o : first;
					int lcx = horizontal ? last : o, lcy = horizontal ? o : last;
					// The start corner of the first cell's side and the end corner of the last's.
					// A side's corners, going along d: the cell's corner on the outer side.
					float ox = 0.5f + 0.5f * nx, oy = 0.5f + 0.5f * ny; // offset to the outer edge
					float ax = fcx + ox - 0.5f * dx, ay = fcy + oy - 0.5f * dy;
					float bx = lcx + ox + 0.5f * dx, by = lcy + oy + 0.5f * dy;
					int sx = (int)lroundf( ax ), sy = (int)lroundf( ay ), ex = (int)lroundf( bx ), ey = (int)lroundf( by );
					// Ghost after the end: turn up (concave), go straight, or turn down (convex).
					b2Vec2 g2, g1;
					if ( solidBeyond( &g, ex, ey, dx, dy, nx, ny ) )
						g2 = CORNER( ex + nx, ey + ny );
					else if ( solidBeyond( &g, ex, ey, dx, dy, -nx, -ny ) )
						g2 = CORNER( ex + dx, ey + dy );
					else
						g2 = CORNER( ex - nx, ey - ny );
					if ( solidBeyond( &g, sx, sy, -dx, -dy, nx, ny ) )
						g1 = CORNER( sx + nx, sy + ny );
					else if ( solidBeyond( &g, sx, sy, -dx, -dy, -nx, -ny ) )
						g1 = CORNER( sx - dx, sy - dy );
					else
						g1 = CORNER( sx - nx, sy - ny );
					double id = addSegment( body, &def, g1, CORNER( sx, sy ), CORNER( ex, ey ), g2 );
					lua_pushnumber( L, id );
					lua_rawseti( L, out, ++count );
				}
			}
		}
	}

	// One-way tiles: the tops of the ones with nothing solid above, landed on from above.
	def.filter.categoryBits = oneWayCat;
	def.enablePreSolveEvents = true;
	for ( int cy = cy0; cy <= cy1; ++cy )
	{
		int runStart = 0;
		bool inRun = false;
		for ( int cx = cx0; cx <= cx1 + 1; ++cx )
		{
			bool edge = cx <= cx1 && tileKind( &g, cx, cy ) == 2 && tileKind( &g, cx, cy - 1 ) != 1;
			if ( edge && !inRun )
			{
				inRun = true;
				runStart = cx;
			}
			else if ( !edge && inRun )
			{
				inRun = false;
				double id = addSegment( body, &def, CORNER( runStart - 1, cy ), CORNER( runStart, cy ), CORNER( cx, cy ),
										CORNER( cx + 1, cy ) );
				lua_pushnumber( L, id );
				lua_rawseti( L, out, ++count );
			}
		}
	}
#undef CORNER

	lua_pushinteger( L, count );
	return 1;
}

static int w_destroyChains( lua_State* L )
{
	luaL_checktype( L, 1, LUA_TTABLE );
	int n = (int)lua_objlen( L, 1 );
	for ( int i = 1; i <= n; ++i )
	{
		lua_rawgeti( L, 1, i );
		b2ChainId id = chainFromNumber( lua_tonumber( L, -1 ) );
		lua_pop( L, 1 );
		if ( b2Chain_IsValid( id ) )
			b2DestroyChain( id );
	}
	return 0;
}

// The tiles' chains carry the Tiles piece's tags like any shape.
static int w_setChainFilters( lua_State* L )
{
	luaL_checktype( L, 1, LUA_TTABLE );
	uint64_t cat = toBits( L, 2 ), mask = toBits( L, 3 ), oneWayCat = toBits( L, 4 );
	int n = (int)lua_objlen( L, 1 );
	b2ShapeId shapes[64];
	for ( int i = 1; i <= n; ++i )
	{
		lua_rawgeti( L, 1, i );
		b2ChainId id = chainFromNumber( lua_tonumber( L, -1 ) );
		lua_pop( L, 1 );
		if ( b2Chain_IsValid( id ) == false )
			continue;
		int count = b2Chain_GetSegments( id, shapes, 64 );
		for ( int j = 0; j < count; ++j )
		{
			b2Filter f = b2Shape_GetFilter( shapes[j] );
			b2Filter g = f;
			g.categoryBits = ( f.categoryBits & KIND_ONEWAY ) ? oneWayCat : cat;
			g.maskBits = mask;
			if ( g.categoryBits != f.categoryBits || g.maskBits != f.maskBits )
				b2Shape_SetFilter( shapes[j], g );
		}
	}
	return 0;
}

// ---------------------------------------------------------------------------
// The character mover

#define MAX_PLANES 32

typedef struct MoverContext
{
	b2BodyId self;
	uint64_t category, mask;
	b2ShapeProxy proxy; // where the mover is now, in the scene
	b2Vec2 delta;       // which way it's going (casts only)
	bool casting;
	b2CollisionPlane planes[MAX_PLANES];
	b2ShapeId shapes[MAX_PLANES];
	b2Vec2 points[MAX_PLANES];
	int count;
} MoverContext;

// Whether the mover collides with a shape.
static bool moverAccepts( b2ShapeId shapeId, void* context )
{
	MoverContext* m = context;
	if ( b2Shape_IsSensor( shapeId ) )
		return false;
	b2BodyId body = b2Shape_GetBody( shapeId );
	if ( B2_ID_EQUALS( body, m->self ) )
		return false;
	b2Filter f = b2Shape_GetFilter( shapeId );
	if ( ( m->category & TAG_BITS & ~f.maskBits ) != 0 || ( f.categoryBits & TAG_BITS & ~m->mask ) != 0 )
		return false;
	if ( f.categoryBits & KIND_ONEWAY )
	{
		// Only from above: every point of the mover on the platform's open side.
		b2ChainSegment seg = b2Shape_GetChainSegment( shapeId );
		b2Transform xf = b2Body_GetTransform( body );
		b2Vec2 p1 = b2TransformPoint( xf, seg.segment.point1 ), p2 = b2TransformPoint( xf, seg.segment.point2 );
		b2Vec2 n = b2Normalize( b2RightPerp( b2Sub( p2, p1 ) ) );
		float lowest = FLT_MAX;
		for ( int i = 0; i < m->proxy.count; ++i )
			lowest = b2MinFloat( lowest, b2Dot( n, b2Sub( m->proxy.points[i], p1 ) ) );
		lowest -= m->proxy.radius;
		if ( lowest < -2.0f * SLOP )
			return false;
		if ( m->casting && b2Dot( m->delta, n ) > 0.0f )
			return false;
	}
	return true;
}

static bool collectPlane( b2ShapeId shapeId, const b2PlaneResult* plane, void* context )
{
	MoverContext* m = context;
	if ( m->count < MAX_PLANES )
	{
		m->planes[m->count] = (b2CollisionPlane){ plane->plane, FLT_MAX, 0.0f, true };
		m->shapes[m->count] = shapeId;
		m->points[m->count] = plane->point;
		m->count += 1;
	}
	return true;
}

// The mover's shape in its body's frame: the body's one shape, or the box
// around all of them, with rounded corners (the mover needs a radius).
static bool moverShape( b2BodyId body, b2ShapeProxy* out )
{
	b2ShapeId shapes[16];
	int n = b2Body_GetShapes( body, shapes, 16 );
	int solid = 0;
	b2ShapeId only = b2_nullShapeId;
	b2AABB box = { { FLT_MAX, FLT_MAX }, { -FLT_MAX, -FLT_MAX } };
	for ( int i = 0; i < n; ++i )
	{
		if ( b2Shape_IsSensor( shapes[i] ) )
			continue;
		solid++;
		only = shapes[i];
		b2ShapeProxy p;
		switch ( b2Shape_GetType( shapes[i] ) )
		{
			case b2_circleShape:
			{
				b2Circle c = b2Shape_GetCircle( shapes[i] );
				p = b2MakeProxy( &c.center, 1, c.radius );
				break;
			}
			case b2_capsuleShape:
			{
				b2Capsule c = b2Shape_GetCapsule( shapes[i] );
				p = b2MakeProxy( &c.center1, 2, c.radius );
				break;
			}
			case b2_polygonShape:
			{
				b2Polygon poly = b2Shape_GetPolygon( shapes[i] );
				p = b2MakeProxy( poly.vertices, poly.count, poly.radius );
				break;
			}
			default:
				continue;
		}
		for ( int j = 0; j < p.count; ++j )
		{
			b2Vec2 r = { p.radius, p.radius };
			box.lowerBound = b2Min( box.lowerBound, b2Sub( p.points[j], r ) );
			box.upperBound = b2Max( box.upperBound, b2Add( p.points[j], r ) );
		}
	}
	if ( solid == 0 )
		return false;

	b2Vec2 verts[B2_MAX_POLYGON_VERTICES];
	int count;
	if ( solid == 1 && b2Shape_GetType( only ) == b2_circleShape )
	{
		b2Circle c = b2Shape_GetCircle( only );
		*out = b2MakeProxy( &c.center, 1, b2MaxFloat( c.radius, 3.0f * SLOP ) );
		return true;
	}
	if ( solid == 1 && b2Shape_GetType( only ) == b2_capsuleShape )
	{
		b2Capsule c = b2Shape_GetCapsule( only );
		*out = b2MakeProxy( &c.center1, 2, b2MaxFloat( c.radius, 3.0f * SLOP ) );
		return true;
	}
	if ( solid == 1 && b2Shape_GetType( only ) == b2_polygonShape )
	{
		b2Polygon poly = b2Shape_GetPolygon( only );
		count = poly.count;
		memcpy( verts, poly.vertices, sizeof( b2Vec2 ) * count );
	}
	else
	{
		count = 4;
		verts[0] = box.lowerBound;
		verts[1] = (b2Vec2){ box.upperBound.x, box.lowerBound.y };
		verts[2] = box.upperBound;
		verts[3] = (b2Vec2){ box.lowerBound.x, box.upperBound.y };
	}
	// Rounded corners: move each corner in by r along both its edges' normals
	// (exact for any convex polygon), then add r all round.
	b2Vec2 centroid = { 0.0f, 0.0f };
	for ( int i = 0; i < count; ++i )
		centroid = b2Add( centroid, verts[i] );
	centroid = b2MulSV( 1.0f / count, centroid );
	float inradius = FLT_MAX;
	b2Vec2 normals[B2_MAX_POLYGON_VERTICES];
	for ( int i = 0; i < count; ++i )
	{
		b2Vec2 e = b2Sub( verts[( i + 1 ) % count], verts[i] );
		b2Vec2 nrm = b2Normalize( b2RightPerp( e ) );
		// Outward whatever the winding.
		if ( b2Dot( nrm, b2Sub( verts[i], centroid ) ) < 0.0f )
			nrm = b2Neg( nrm );
		normals[i] = nrm;
		inradius = b2MinFloat( inradius, b2Dot( nrm, b2Sub( verts[i], centroid ) ) );
	}
	float r = b2ClampFloat( 0.25f * inradius, 3.0f * SLOP, 3.0f );
	if ( r >= inradius )
		r = 0.9f * inradius;
	b2Vec2 inset[B2_MAX_POLYGON_VERTICES];
	for ( int i = 0; i < count; ++i )
	{
		b2Vec2 n1 = normals[( i + count - 1 ) % count], n2 = normals[i];
		float d = 1.0f + b2Dot( n1, n2 );
		b2Vec2 shift = d > 0.1f ? b2MulSV( r / d, b2Add( n1, n2 ) ) : b2MulSV( r, b2Normalize( b2Sub( verts[i], centroid ) ) );
		inset[i] = b2Sub( verts[i], shift );
	}
	*out = b2MakeProxy( inset, count, r );
	return true;
}

static void placeProxy( const b2ShapeProxy* local, b2Transform xf, b2ShapeProxy* out )
{
	out->count = local->count;
	out->radius = local->radius;
	for ( int i = 0; i < local->count; ++i )
		out->points[i] = b2TransformPoint( xf, local->points[i] );
}

static void collide( b2WorldId world, MoverContext* m, b2QueryFilter filter, float skin )
{
	m->count = 0;
	m->casting = false;
	b2ShapeProxy p = m->proxy;
	p.radius += skin;
	b2World_CollideMoverProxy( world, &p, filter, moverAccepts, collectPlane, m );
}

static float cast( b2WorldId world, MoverContext* m, b2QueryFilter filter, b2Vec2 delta )
{
	if ( b2LengthSquared( delta ) == 0.0f )
		return 1.0f;
	m->casting = true;
	m->delta = delta;
	return b2World_CastMoverProxy( world, &m->proxy, delta, filter, moverAccepts, m );
}

// move(body, x, y, angle, dx, dy, vx, vy, slope, wasOnGround, groundShape, mass, h, hits)
// Moves a kinematic body's shape from (x, y) by (dx, dy), sliding along what
// it touches, climbing walkable slopes and staying on the ground going down
// them; pushes physics bodies in its way. The body itself isn't moved (that
// happens in the world's step, see driveTo). Returns x, y, vx, vy (with the
// speed into what it touches taken off), flags (1 ground, 2 wall, 4
// ceiling), the ground shape (or 0), and the number of shapes it touches
// afterwards, listed in hits as slot, x, y, nx, ny (normal towards the mover),
// speed (how fast it was going into it). The body is put at the new place
// (physics2d.lua's step gives it the velocity to get there).
static int w_move( lua_State* L )
{
	b2BodyId self = toBody( L, 1 );
	b2Vec2 pos = { (float)luaL_checknumber( L, 2 ), (float)luaL_checknumber( L, 3 ) };
	b2Rot rot = b2MakeRot( (float)luaL_checknumber( L, 4 ) );
	b2Vec2 delta = { (float)luaL_checknumber( L, 5 ), (float)luaL_checknumber( L, 6 ) };
	b2Vec2 v = { (float)luaL_checknumber( L, 7 ), (float)luaL_checknumber( L, 8 ) };
	float slopeCos = cosf( (float)luaL_checknumber( L, 9 ) );
	bool wasOnGround = lua_toboolean( L, 10 );
	double groundNumber = luaL_optnumber( L, 11, 0.0 );
	float mass = (float)luaL_optnumber( L, 12, 1.0 );
	float h = (float)luaL_checknumber( L, 13 );
	int buf = 14;
	luaL_checktype( L, buf, LUA_TTABLE );

	b2WorldId world = b2Body_GetWorld( self );
	b2Vec2 up = worldInfos[world.index1 - 1].up;

	MoverContext m;
	memset( &m, 0, sizeof( m ) );
	m.self = self;
	b2ShapeProxy local;
	if ( moverShape( self, &local ) == false )
	{
		// Nothing to collide with: just go.
		lua_pushnumber( L, pos.x + delta.x );
		lua_pushnumber( L, pos.y + delta.y );
		lua_pushnumber( L, v.x );
		lua_pushnumber( L, v.y );
		lua_pushinteger( L, 0 );
		lua_pushnumber( L, 0 );
		lua_pushinteger( L, 0 );
		return 7;
	}
	{
		b2ShapeId first;
		b2Body_GetShapes( self, &first, 1 );
		b2Filter f = b2Shape_GetFilter( first );
		m.category = f.categoryBits;
		m.mask = f.maskBits;
	}
	b2QueryFilter filter = { KIND_QUERY, ~KIND_ZONE };
	b2Transform xf = { pos, rot };
	placeProxy( &local, xf, &m.proxy );

	// Ride what it stands on.
	if ( groundNumber != 0.0 )
	{
		b2ShapeId ground = shapeFromNumber( groundNumber );
		if ( b2Shape_IsValid( ground ) )
		{
			b2BodyId gb = b2Shape_GetBody( ground );
			if ( b2Body_GetType( gb ) != b2_staticBody )
			{
				b2Vec2 gv = b2Body_GetWorldPointVelocity( gb, pos );
				delta = b2MulAdd( delta, h, gv );
			}
		}
	}
	b2Vec2 wanted = delta;
	b2Vec2 v0 = v;

	// On walkable ground and not going up: move along the ground instead of
	// into it, at the same speed sideways (no sliding down slopes, no hops
	// going down them).
	float skin = 2.0f * SLOP;
	collide( world, &m, filter, skin );
	b2Vec2 groundNormal = up;
	bool standing = false;
	for ( int i = 0; i < m.count; ++i )
	{
		b2Vec2 n = m.planes[i].plane.normal;
		if ( b2Dot( n, up ) >= slopeCos && ( !standing || b2Dot( n, up ) > b2Dot( groundNormal, up ) ) )
		{
			groundNormal = n;
			standing = true;
		}
	}
	if ( standing && b2Dot( delta, up ) <= 0.0f )
	{
		b2Vec2 side = b2RightPerp( up );
		float along = b2Dot( delta, side );
		b2Vec2 tangent = b2RightPerp( groundNormal );
		float t = b2Dot( tangent, side );
		delta = fabsf( t ) > 0.01f ? b2MulSV( along / t, tangent ) : b2Vec2_zero;
	}

	b2Vec2 target = b2Add( pos, delta );
	for ( int iteration = 0; iteration < 5; ++iteration )
	{
		collide( world, &m, filter, 0.0f );
		b2PlaneSolverResult result = b2SolvePlanes( b2Sub( target, pos ), m.planes, m.count );
		float fraction = cast( world, &m, filter, result.translation );
		b2Vec2 step = b2MulSV( fraction, result.translation );
		pos = b2Add( pos, step );
		xf.p = pos;
		placeProxy( &local, xf, &m.proxy );
		if ( b2LengthSquared( step ) < 0.0001f )
			break;
	}

	// What it touches now: ground, walls, ceilings.
	collide( world, &m, filter, skin );
	int flags = 0;
	double groundShape = 0.0;
	float best = -2.0f;
	for ( int i = 0; i < m.count; ++i )
	{
		b2Vec2 n = m.planes[i].plane.normal;
		float upness = b2Dot( n, up );
		bool into = b2Dot( wanted, n ) < -1e-4f;
		if ( upness >= slopeCos )
		{
			if ( b2Dot( wanted, up ) <= 1e-4f && upness > best )
			{
				flags |= 1;
				best = upness;
				groundShape = shapeNumber( m.shapes[i] );
			}
		}
		else if ( -upness >= slopeCos )
		{
			if ( into )
				flags |= 4;
		}
		else if ( into )
		{
			flags |= 2;
		}
	}

	// Walking off a small step or down a slope: keep to the ground.
	if ( ( flags & 1 ) == 0 && wasOnGround && b2Dot( wanted, up ) <= 0.0f )
	{
		float sideways = fabsf( b2Dot( wanted, b2RightPerp( up ) ) );
		float tanSlope = b2MinFloat( sqrtf( b2MaxFloat( 1.0f - slopeCos * slopeCos, 0.0f ) ) / b2MaxFloat( slopeCos, 0.1f ), 3.0f );
		b2Vec2 down = b2MulSV( -( 2.0f + sideways * tanSlope ), up );
		float fraction = cast( world, &m, filter, down );
		if ( fraction < 1.0f )
		{
			b2Vec2 at = b2Add( pos, b2MulSV( fraction, down ) );
			b2Transform xf2 = { at, rot };
			MoverContext probe = m;
			placeProxy( &local, xf2, &probe.proxy );
			collide( world, &probe, filter, skin );
			for ( int i = 0; i < probe.count; ++i )
			{
				if ( b2Dot( probe.planes[i].plane.normal, up ) >= slopeCos )
				{
					pos = at;
					m = probe;
					flags |= 1;
					groundShape = shapeNumber( probe.shapes[i] );
					break;
				}
			}
		}
	}

	// Speed into what it touches goes; on walkable ground only the speed down.
	for ( int i = 0; i < m.count; ++i )
	{
		b2Vec2 n = m.planes[i].plane.normal;
		if ( b2Dot( n, up ) >= slopeCos )
			n = up;
		float into = b2Dot( v, n );
		if ( into < 0.0f && b2Dot( wanted, m.planes[i].plane.normal ) < 1e-4f )
			v = b2MulSub( v, into, n );
	}

	// Push physics bodies it walks into (or stands on), as hard as its mass
	// against theirs allows.
	b2Vec2 wantedV = b2MulSV( 1.0f / h, wanted );
	int k = 0, touched = 0;
	for ( int i = 0; i < m.count; ++i )
	{
		b2ShapeId s = m.shapes[i];
		bool seen = false;
		for ( int j = 0; j < i; ++j )
		{
			if ( B2_ID_EQUALS( m.shapes[j], s ) )
			{
				seen = true;
				break;
			}
		}
		if ( seen )
			continue;
		b2Vec2 n = m.planes[i].plane.normal;
		b2BodyId other = b2Shape_GetBody( s );
		if ( b2Body_GetType( other ) == b2_dynamicBody )
		{
			b2Vec2 into = b2Neg( n );
			float want = b2Dot( wantedV, into );
			float have = b2Dot( b2Body_GetWorldPointVelocity( other, m.points[i] ), into );
			if ( want > have )
			{
				float otherMass = b2Body_GetMass( other );
				float share = mass / ( mass + otherMass );
				b2Body_ApplyLinearImpulse( other, b2MulSV( otherMass * ( want - have ) * share, into ), m.points[i], true );
			}
		}
		lua_pushnumber( L, shapeSlot( s ) );
		lua_rawseti( L, buf, ++k );
		lua_pushnumber( L, m.points[i].x );
		lua_rawseti( L, buf, ++k );
		lua_pushnumber( L, m.points[i].y );
		lua_rawseti( L, buf, ++k );
		lua_pushnumber( L, n.x );
		lua_rawseti( L, buf, ++k );
		lua_pushnumber( L, n.y );
		lua_rawseti( L, buf, ++k );
		lua_pushnumber( L, b2MaxFloat( 0.0f, -b2Dot( v0, n ) ) );
		lua_rawseti( L, buf, ++k );
		touched++;
	}

	b2Body_SetTransform( self, pos, rot );
	lua_pushnumber( L, pos.x );
	lua_pushnumber( L, pos.y );
	lua_pushnumber( L, v.x );
	lua_pushnumber( L, v.y );
	lua_pushinteger( L, flags );
	lua_pushnumber( L, groundShape );
	lua_pushinteger( L, touched );
	return 7;
}

// moveBy(body, x, y, angle, dx, dy): goes straight until something is in the
// way. Returns x, y, fraction.
static int w_moveBy( lua_State* L )
{
	b2BodyId self = toBody( L, 1 );
	b2Vec2 pos = { (float)luaL_checknumber( L, 2 ), (float)luaL_checknumber( L, 3 ) };
	b2Rot rot = b2MakeRot( (float)luaL_checknumber( L, 4 ) );
	b2Vec2 delta = { (float)luaL_checknumber( L, 5 ), (float)luaL_checknumber( L, 6 ) };
	MoverContext m;
	memset( &m, 0, sizeof( m ) );
	m.self = self;
	b2ShapeProxy local;
	float fraction = 1.0f;
	if ( moverShape( self, &local ) )
	{
		b2ShapeId first;
		b2Body_GetShapes( self, &first, 1 );
		b2Filter f = b2Shape_GetFilter( first );
		m.category = f.categoryBits;
		m.mask = f.maskBits;
		placeProxy( &local, (b2Transform){ pos, rot }, &m.proxy );
		b2QueryFilter filter = { KIND_QUERY, ~KIND_ZONE };
		fraction = cast( b2Body_GetWorld( self ), &m, filter, delta );
	}
	lua_pushnumber( L, pos.x + fraction * delta.x );
	lua_pushnumber( L, pos.y + fraction * delta.y );
	lua_pushnumber( L, fraction );
	return 3;
}

// ---------------------------------------------------------------------------
// Queries

typedef struct RayHit
{
	b2ShapeId shape;
	b2Vec2 point, normal;
	float fraction;
} RayHit;

typedef struct RayContext
{
	RayHit hits[64];
	int count;
	bool sensors;
} RayContext;

static float rayCallback( b2ShapeId shapeId, b2Vec2 point, b2Vec2 normal, float fraction, void* context )
{
	RayContext* r = context;
	if ( !r->sensors && b2Shape_IsSensor( shapeId ) )
		return -1.0f;
	if ( r->count < 64 )
		r->hits[r->count++] = (RayHit){ shapeId, point, normal, fraction };
	return 1.0f;
}

static int compareHits( const void* a, const void* b )
{
	float fa = ( (const RayHit*)a )->fraction, fb = ( (const RayHit*)b )->fraction;
	return fa < fb ? -1 : fa > fb ? 1 : 0;
}

// raycast(world, x1, y1, x2, y2, out, sensors): every shape along the line,
// nearest first, as slot, x, y, nx, ny, fraction into out. Returns how many.
static int w_raycast( lua_State* L )
{
	b2WorldId w = toWorld( L, 1 );
	b2Vec2 a = { (float)luaL_checknumber( L, 2 ), (float)luaL_checknumber( L, 3 ) };
	b2Vec2 b = { (float)luaL_checknumber( L, 4 ), (float)luaL_checknumber( L, 5 ) };
	int buf = 6;
	luaL_checktype( L, buf, LUA_TTABLE );
	RayContext r;
	r.count = 0;
	r.sensors = lua_toboolean( L, 7 );
	b2QueryFilter filter = { KIND_QUERY, ~0ull };
	b2World_CastRay( w, a, b2Sub( b, a ), filter, rayCallback, &r );
	qsort( r.hits, r.count, sizeof( RayHit ), compareHits );
	int k = 0;
	for ( int i = 0; i < r.count; ++i )
	{
		PUT( shapeSlot( r.hits[i].shape ) );
		PUT( r.hits[i].point.x );
		PUT( r.hits[i].point.y );
		PUT( r.hits[i].normal.x );
		PUT( r.hits[i].normal.y );
		PUT( r.hits[i].fraction );
	}
	lua_pushinteger( L, r.count );
	return 1;
}

typedef struct OverlapContext
{
	lua_State* L;
	int buf, k;
	b2Vec2 point;
	bool testPoint;
} OverlapContext;

static bool overlapCallback( b2ShapeId shapeId, void* context )
{
	OverlapContext* o = context;
	if ( o->testPoint && b2Shape_TestPoint( shapeId, o->point ) == false )
		return true;
	lua_State* L = o->L;
	lua_pushnumber( L, shapeSlot( shapeId ) );
	lua_rawseti( L, o->buf, ++o->k );
	return o->k < 4096;
}

// pointQuery(world, x, y, out): the slots of the shapes containing a point into out.
static int w_pointQuery( lua_State* L )
{
	b2WorldId w = toWorld( L, 1 );
	b2Vec2 p = { (float)luaL_checknumber( L, 2 ), (float)luaL_checknumber( L, 3 ) };
	luaL_checktype( L, 4, LUA_TTABLE );
	OverlapContext o = { L, 4, 0, p, true };
	b2AABB box = { { p.x - 0.01f, p.y - 0.01f }, { p.x + 0.01f, p.y + 0.01f } };
	b2QueryFilter filter = { KIND_QUERY, ~0ull };
	b2World_OverlapAABB( w, box, filter, overlapCallback, &o );
	lua_pushinteger( L, o.k );
	return 1;
}

// overlapShape(world, out, "circle", x, y, r) or (world, out, "rect", x, y, halfWidth, halfHeight, angle):
// the slots of the shapes touching it into out.
static int w_overlapShape( lua_State* L )
{
	b2WorldId w = toWorld( L, 1 );
	luaL_checktype( L, 2, LUA_TTABLE );
	const char* kind = luaL_checkstring( L, 3 );
	b2Vec2 c = { (float)luaL_checknumber( L, 4 ), (float)luaL_checknumber( L, 5 ) };
	b2ShapeProxy proxy;
	if ( strcmp( kind, "circle" ) == 0 )
	{
		proxy = b2MakeProxy( &c, 1, (float)luaL_checknumber( L, 6 ) );
	}
	else
	{
		b2Polygon box = b2MakeOffsetBox( (float)luaL_checknumber( L, 6 ), (float)luaL_checknumber( L, 7 ), c,
										 b2MakeRot( (float)luaL_optnumber( L, 8, 0.0 ) ) );
		proxy = b2MakeProxy( box.vertices, box.count, 0.0f );
	}
	OverlapContext o = { L, 2, 0, c, false };
	b2QueryFilter filter = { KIND_QUERY, ~0ull };
	b2World_OverlapShape( w, &proxy, filter, overlapCallback, &o );
	lua_pushinteger( L, o.k );
	return 1;
}

// The distance between two bodies' shapes (0 if they overlap), or nil if
// either has none. Sensors count.
static int w_bodyDistance( lua_State* L )
{
	b2BodyId a = toBody( L, 1 ), b = toBody( L, 2 );
	b2ShapeId sa[16], sb[16];
	int na = b2Body_GetShapes( a, sa, 16 ), nb = b2Body_GetShapes( b, sb, 16 );
	b2Transform xa = b2Body_GetTransform( a ), xb = b2Body_GetTransform( b );
	if ( lua_gettop( L ) >= 5 )
	{
		xa.p = (b2Vec2){ (float)luaL_checknumber( L, 3 ), (float)luaL_checknumber( L, 4 ) };
		xa.q = b2MakeRot( (float)luaL_checknumber( L, 5 ) );
	}
	if ( lua_gettop( L ) >= 8 )
	{
		xb.p = (b2Vec2){ (float)luaL_checknumber( L, 6 ), (float)luaL_checknumber( L, 7 ) };
		xb.q = b2MakeRot( (float)luaL_checknumber( L, 8 ) );
	}
	float best = FLT_MAX;
	for ( int i = 0; i < na; ++i )
	{
		for ( int j = 0; j < nb; ++j )
		{
			b2DistanceInput in;
			b2ShapeType ta = b2Shape_GetType( sa[i] ), tb = b2Shape_GetType( sb[j] );
			if ( ta == b2_chainSegmentShape || tb == b2_chainSegmentShape )
				continue;
			// Proxies from the shapes' geometry.
			b2ShapeProxy pa, pb;
			b2ShapeId ids[2] = { sa[i], sb[j] };
			b2ShapeProxy* ps[2] = { &pa, &pb };
			for ( int q = 0; q < 2; ++q )
			{
				switch ( b2Shape_GetType( ids[q] ) )
				{
					case b2_circleShape:
					{
						b2Circle c = b2Shape_GetCircle( ids[q] );
						*ps[q] = b2MakeProxy( &c.center, 1, c.radius );
						break;
					}
					case b2_capsuleShape:
					{
						b2Capsule c = b2Shape_GetCapsule( ids[q] );
						*ps[q] = b2MakeProxy( &c.center1, 2, c.radius );
						break;
					}
					case b2_polygonShape:
					{
						b2Polygon p = b2Shape_GetPolygon( ids[q] );
						*ps[q] = b2MakeProxy( p.vertices, p.count, p.radius );
						break;
					}
					default:
						ps[q]->count = 0;
				}
			}
			if ( pa.count == 0 || pb.count == 0 )
				continue;
			in.proxyA = pa;
			in.proxyB = pb;
			in.transformA = xa;
			in.transformB = xb;
			in.useRadii = true;
			b2SimplexCache cache = { 0 };
			b2DistanceOutput out = b2ShapeDistance( &in, &cache, NULL, 0 );
			best = b2MinFloat( best, out.distance );
		}
	}
	if ( best == FLT_MAX )
		return 0;
	lua_pushnumber( L, best );
	return 1;
}

// bodyContacts(body, out): the body's touching contacts as the other's slot, x, y,
// nx, ny (towards the body), impulse into out. Returns how many.
static int w_bodyContacts( lua_State* L )
{
	b2BodyId b = toBody( L, 1 );
	int buf = 2;
	luaL_checktype( L, buf, LUA_TTABLE );
	b2ContactData data[64];
	int n = b2Body_GetContactData( b, data, 64 );
	int k = 0, count = 0;
	for ( int i = 0; i < n; ++i )
	{
		const b2Manifold* m = &data[i].manifold;
		if ( m->pointCount == 0 )
			continue;
		bool isA = B2_ID_EQUALS( b2Shape_GetBody( data[i].shapeIdA ), b );
		b2ShapeId other = isA ? data[i].shapeIdB : data[i].shapeIdA;
		b2Vec2 nrm = isA ? b2Neg( m->normal ) : m->normal;
		b2Vec2 p = { 0.0f, 0.0f };
		float impulse = 0.0f;
		for ( int j = 0; j < m->pointCount; ++j )
		{
			p = b2Add( p, m->points[j].point );
			impulse += m->points[j].totalNormalImpulse;
		}
		p = b2MulSV( 1.0f / m->pointCount, p );
		PUT( shapeSlot( other ) );
		PUT( p.x );
		PUT( p.y );
		PUT( nrm.x );
		PUT( nrm.y );
		PUT( impulse );
		count++;
	}
	lua_pushinteger( L, count );
	return 1;
}

// ---------------------------------------------------------------------------
// Joints

static float optField( lua_State* L, int t, const char* name, float def )
{
	lua_getfield( L, t, name );
	float v = lua_isnumber( L, -1 ) ? (float)lua_tonumber( L, -1 ) : def;
	lua_pop( L, 1 );
	return v;
}

static bool boolField( lua_State* L, int t, const char* name )
{
	lua_getfield( L, t, name );
	bool v = lua_toboolean( L, -1 );
	lua_pop( L, 1 );
	return v;
}

// createJoint(kind, bodyA, bodyB, x, y, opts): opts has ax, ay (the axis),
// bx, by (a second anchor, distance joints), length, minLength, maxLength,
// spring, hertz, damping, limit, lower, upper, motor, motorSpeed, maxMotor,
// maxForce, collide.
static int w_createJoint( lua_State* L )
{
	const char* kind = luaL_checkstring( L, 1 );
	b2BodyId a = toBody( L, 2 ), b = toBody( L, 3 );
	b2Vec2 anchor = { (float)luaL_checknumber( L, 4 ), (float)luaL_checknumber( L, 5 ) };
	luaL_checktype( L, 6, LUA_TTABLE );
	int t = 6;
	b2Vec2 axis = { optField( L, t, "ax", 1.0f ), optField( L, t, "ay", 0.0f ) };
	b2Vec2 anchorB = { optField( L, t, "bx", anchor.x ), optField( L, t, "by", anchor.y ) };
	bool collide = boolField( L, t, "collide" );
	float hertz = optField( L, t, "hertz", 0.0f ), damping = optField( L, t, "damping", 0.7f );
	bool spring = boolField( L, t, "spring" ), limit = boolField( L, t, "limit" ), motor = boolField( L, t, "motor" );
	float lower = optField( L, t, "lower", 0.0f ), upper = optField( L, t, "upper", 0.0f );
	float motorSpeed = optField( L, t, "motorSpeed", 0.0f ), maxMotor = optField( L, t, "maxMotor", 0.0f );
	b2WorldId w = b2Body_GetWorld( a );
	b2JointId id;
	if ( strcmp( kind, "pin" ) == 0 )
	{
		b2RevoluteJointDef d = b2DefaultRevoluteJointDef();
		d.bodyIdA = a;
		d.bodyIdB = b;
		d.localAnchorA = b2Body_GetLocalPoint( a, anchor );
		d.localAnchorB = b2Body_GetLocalPoint( b, anchor );
		d.referenceAngle = b2RelativeAngle( b2Body_GetRotation( b ), b2Body_GetRotation( a ) );
		d.enableSpring = spring;
		d.hertz = hertz;
		d.dampingRatio = damping;
		d.enableLimit = limit;
		d.lowerAngle = lower;
		d.upperAngle = upper;
		d.enableMotor = motor;
		d.motorSpeed = motorSpeed;
		d.maxMotorTorque = maxMotor;
		d.collideConnected = collide;
		id = b2CreateRevoluteJoint( w, &d );
	}
	else if ( strcmp( kind, "weld" ) == 0 )
	{
		b2WeldJointDef d = b2DefaultWeldJointDef();
		d.bodyIdA = a;
		d.bodyIdB = b;
		d.localAnchorA = b2Body_GetLocalPoint( a, anchor );
		d.localAnchorB = b2Body_GetLocalPoint( b, anchor );
		d.referenceAngle = b2RelativeAngle( b2Body_GetRotation( b ), b2Body_GetRotation( a ) );
		d.linearHertz = spring ? hertz : 0.0f;
		d.angularHertz = spring ? hertz : 0.0f;
		d.linearDampingRatio = damping;
		d.angularDampingRatio = damping;
		d.collideConnected = collide;
		id = b2CreateWeldJoint( w, &d );
	}
	else if ( strcmp( kind, "distance" ) == 0 )
	{
		b2DistanceJointDef d = b2DefaultDistanceJointDef();
		d.bodyIdA = a;
		d.bodyIdB = b;
		d.localAnchorA = b2Body_GetLocalPoint( a, anchor );
		d.localAnchorB = b2Body_GetLocalPoint( b, anchorB );
		float length = optField( L, t, "length", 0.0f );
		d.length = length > 0.0f ? length : b2Distance( anchor, anchorB );
		d.enableSpring = spring;
		d.hertz = hertz;
		d.dampingRatio = damping;
		d.enableLimit = limit;
		d.minLength = optField( L, t, "minLength", 0.0f );
		d.maxLength = optField( L, t, "maxLength", HUGE_LENGTH );
		d.enableMotor = motor;
		d.motorSpeed = motorSpeed;
		d.maxMotorForce = maxMotor;
		d.collideConnected = collide;
		id = b2CreateDistanceJoint( w, &d );
	}
	else if ( strcmp( kind, "slider" ) == 0 || strcmp( kind, "wheel" ) == 0 )
	{
		b2Vec2 localAxis = b2InvRotateVector( b2Body_GetRotation( a ), b2Normalize( axis ) );
		if ( kind[0] == 's' )
		{
			b2PrismaticJointDef d = b2DefaultPrismaticJointDef();
			d.bodyIdA = a;
			d.bodyIdB = b;
			d.localAnchorA = b2Body_GetLocalPoint( a, anchor );
			d.localAnchorB = b2Body_GetLocalPoint( b, anchor );
			d.localAxisA = localAxis;
			d.referenceAngle = b2RelativeAngle( b2Body_GetRotation( b ), b2Body_GetRotation( a ) );
			d.enableSpring = spring;
			d.hertz = hertz;
			d.dampingRatio = damping;
			d.enableLimit = limit;
			d.lowerTranslation = lower;
			d.upperTranslation = upper;
			d.enableMotor = motor;
			d.motorSpeed = motorSpeed;
			d.maxMotorForce = maxMotor;
			d.collideConnected = collide;
			id = b2CreatePrismaticJoint( w, &d );
		}
		else
		{
			b2WheelJointDef d = b2DefaultWheelJointDef();
			d.bodyIdA = a;
			d.bodyIdB = b;
			d.localAnchorA = b2Body_GetLocalPoint( a, anchor );
			d.localAnchorB = b2Body_GetLocalPoint( b, anchor );
			d.localAxisA = localAxis;
			d.enableSpring = spring;
			d.hertz = hertz;
			d.dampingRatio = damping;
			d.enableLimit = limit;
			d.lowerTranslation = lower;
			d.upperTranslation = upper;
			d.enableMotor = motor;
			d.motorSpeed = motorSpeed;
			d.maxMotorTorque = maxMotor;
			d.collideConnected = collide;
			id = b2CreateWheelJoint( w, &d );
		}
	}
	else if ( strcmp( kind, "mouse" ) == 0 )
	{
		b2MouseJointDef d = b2DefaultMouseJointDef();
		d.bodyIdA = a;
		d.bodyIdB = b;
		d.target = anchor;
		d.hertz = hertz > 0.0f ? hertz : 5.0f;
		d.dampingRatio = damping;
		d.maxForce = optField( L, t, "maxForce", 1000.0f * b2Body_GetMass( b ) * 10.0f * PIXELS_PER_METER );
		d.collideConnected = true;
		id = b2CreateMouseJoint( w, &d );
		b2Body_SetAwake( b, true );
	}
	else
	{
		return luaL_error( L, "physics: no joint kind %s", kind );
	}
	lua_pushnumber( L, packId( id.index1, id.world0, id.generation ) );
	return 1;
}

static int w_destroyJoint( lua_State* L )
{
	b2JointId id;
	unpackId( luaL_checknumber( L, 1 ), &id.index1, &id.world0, &id.generation );
	if ( b2Joint_IsValid( id ) )
		b2DestroyJoint( id );
	return 0;
}

// updateJoint(joint, opts): applies the settings a joint can change while it runs.
static int w_updateJoint( lua_State* L )
{
	b2JointId j = toJoint( L, 1 );
	luaL_checktype( L, 2, LUA_TTABLE );
	int t = 2;
	bool spring = boolField( L, t, "spring" ), limit = boolField( L, t, "limit" ), motor = boolField( L, t, "motor" );
	float hertz = optField( L, t, "hertz", 0.0f ), damping = optField( L, t, "damping", 0.7f );
	float lower = optField( L, t, "lower", 0.0f ), upper = optField( L, t, "upper", 0.0f );
	float motorSpeed = optField( L, t, "motorSpeed", 0.0f ), maxMotor = optField( L, t, "maxMotor", 0.0f );
	switch ( b2Joint_GetType( j ) )
	{
		case b2_revoluteJoint:
			b2RevoluteJoint_EnableSpring( j, spring );
			b2RevoluteJoint_SetSpringHertz( j, hertz );
			b2RevoluteJoint_SetSpringDampingRatio( j, damping );
			b2RevoluteJoint_EnableLimit( j, limit );
			b2RevoluteJoint_SetLimits( j, lower, b2MaxFloat( lower, upper ) );
			b2RevoluteJoint_EnableMotor( j, motor );
			b2RevoluteJoint_SetMotorSpeed( j, motorSpeed );
			b2RevoluteJoint_SetMaxMotorTorque( j, maxMotor );
			break;
		case b2_prismaticJoint:
			b2PrismaticJoint_EnableSpring( j, spring );
			b2PrismaticJoint_SetSpringHertz( j, hertz );
			b2PrismaticJoint_SetSpringDampingRatio( j, damping );
			b2PrismaticJoint_EnableLimit( j, limit );
			b2PrismaticJoint_SetLimits( j, lower, b2MaxFloat( lower, upper ) );
			b2PrismaticJoint_EnableMotor( j, motor );
			b2PrismaticJoint_SetMotorSpeed( j, motorSpeed );
			b2PrismaticJoint_SetMaxMotorForce( j, maxMotor );
			break;
		case b2_wheelJoint:
			b2WheelJoint_EnableSpring( j, spring );
			b2WheelJoint_SetSpringHertz( j, hertz );
			b2WheelJoint_SetSpringDampingRatio( j, damping );
			b2WheelJoint_EnableLimit( j, limit );
			b2WheelJoint_SetLimits( j, lower, b2MaxFloat( lower, upper ) );
			b2WheelJoint_EnableMotor( j, motor );
			b2WheelJoint_SetMotorSpeed( j, motorSpeed );
			b2WheelJoint_SetMaxMotorTorque( j, maxMotor );
			break;
		case b2_distanceJoint:
		{
			float length = optField( L, t, "length", 0.0f );
			if ( length > 0.0f )
				b2DistanceJoint_SetLength( j, length );
			b2DistanceJoint_EnableSpring( j, spring );
			b2DistanceJoint_SetSpringHertz( j, hertz );
			b2DistanceJoint_SetSpringDampingRatio( j, damping );
			b2DistanceJoint_EnableLimit( j, limit );
			b2DistanceJoint_SetLengthRange( j, optField( L, t, "minLength", 0.0f ), optField( L, t, "maxLength", HUGE_LENGTH ) );
			b2DistanceJoint_EnableMotor( j, motor );
			b2DistanceJoint_SetMotorSpeed( j, motorSpeed );
			b2DistanceJoint_SetMaxMotorForce( j, maxMotor );
			break;
		}
		case b2_weldJoint:
			b2WeldJoint_SetLinearHertz( j, spring ? hertz : 0.0f );
			b2WeldJoint_SetAngularHertz( j, spring ? hertz : 0.0f );
			b2WeldJoint_SetLinearDampingRatio( j, damping );
			b2WeldJoint_SetAngularDampingRatio( j, damping );
			break;
		case b2_mouseJoint:
		{
			b2MouseJoint_SetSpringHertz( j, hertz > 0.0f ? hertz : 5.0f );
			b2MouseJoint_SetSpringDampingRatio( j, damping );
			float maxForce = optField( L, t, "maxForce", -1.0f );
			if ( maxForce >= 0.0f )
				b2MouseJoint_SetMaxForce( j, maxForce );
			break;
		}
		default:
			break;
	}
	b2Joint_WakeBodies( j );
	return 0;
}

static int w_setJointTarget( lua_State* L )
{
	b2JointId j = toJoint( L, 1 );
	if ( b2Joint_GetType( j ) == b2_mouseJoint )
	{
		b2MouseJoint_SetTarget( j, (b2Vec2){ (float)luaL_checknumber( L, 2 ), (float)luaL_checknumber( L, 3 ) } );
		b2Body_SetAwake( b2Joint_GetBodyB( j ), true );
	}
	return 0;
}

// jointState(joint): angle (or translation, or length), speed, force, torque.
static int w_jointState( lua_State* L )
{
	b2JointId j = toJoint( L, 1 );
	float value = 0.0f, speed = 0.0f;
	switch ( b2Joint_GetType( j ) )
	{
		case b2_revoluteJoint:
			value = b2RevoluteJoint_GetAngle( j );
			speed = b2Body_GetAngularVelocity( b2Joint_GetBodyB( j ) ) - b2Body_GetAngularVelocity( b2Joint_GetBodyA( j ) );
			break;
		case b2_prismaticJoint:
			value = b2PrismaticJoint_GetTranslation( j );
			speed = b2PrismaticJoint_GetSpeed( j );
			break;
		case b2_wheelJoint:
			value = b2Body_GetAngularVelocity( b2Joint_GetBodyB( j ) );
			speed = value;
			break;
		case b2_distanceJoint:
			value = b2DistanceJoint_GetCurrentLength( j );
			break;
		default:
			break;
	}
	b2Vec2 f = b2Joint_GetConstraintForce( j );
	lua_pushnumber( L, value );
	lua_pushnumber( L, speed );
	lua_pushnumber( L, b2Length( f ) );
	lua_pushnumber( L, b2Joint_GetConstraintTorque( j ) );
	return 4;
}

// ---------------------------------------------------------------------------

static const luaL_Reg functions[] = {
	{ "newWorld", w_newWorld },
	{ "destroyWorld", w_destroyWorld },
	{ "step", w_step },
	{ "setGravity", w_setGravity },
	{ "getGravity", w_getGravity },
	{ "awakeCount", w_awakeCount },
	{ "moves", w_moves },
	{ "contacts", w_contacts },
	{ "sensors", w_sensors },
	{ "createBody", w_createBody },
	{ "destroyBody", w_destroyBody },
	{ "isValid", w_isValid },
	{ "setType", w_setType },
	{ "setTransform", w_setTransform },
	{ "getTransform", w_getTransform },
	{ "driveTo", w_driveTo },
	{ "setVelocity", w_setVelocity },
	{ "getVelocity", w_getVelocity },
	{ "setBodyProps", w_setBodyProps },
	{ "setMass", w_setMass },
	{ "getMass", w_getMass },
	{ "applyForce", w_applyForce },
	{ "applyImpulse", w_applyImpulse },
	{ "applyTorque", w_applyTorque },
	{ "applyAngularImpulse", w_applyAngularImpulse },
	{ "setAwake", w_setAwake },
	{ "isAwake", w_isAwake },
	{ "bodyAABB", w_bodyAABB },
	{ "clearShapes", w_clearShapes },
	{ "addShape", w_addShape },
	{ "destroyShape", w_destroyShape },
	{ "setFilter", w_setFilter },
	{ "setMaterial", w_setMaterial },
	{ "enableSensorEvents", w_enableSensorEvents },
	{ "shapeSlot", w_shapeSlot },
	{ "buildTiles", w_buildTiles },
	{ "destroyChains", w_destroyChains },
	{ "setChainFilters", w_setChainFilters },
	{ "move", w_move },
	{ "moveBy", w_moveBy },
	{ "raycast", w_raycast },
	{ "pointQuery", w_pointQuery },
	{ "overlapShape", w_overlapShape },
	{ "bodyDistance", w_bodyDistance },
	{ "bodyContacts", w_bodyContacts },
	{ "createJoint", w_createJoint },
	{ "destroyJoint", w_destroyJoint },
	{ "updateJoint", w_updateJoint },
	{ "setJointTarget", w_setJointTarget },
	{ "jointState", w_jointState },
	{ NULL, NULL },
};

__attribute__( ( visibility( "default" ) ) ) int luaopen_love_box2d( lua_State* L )
{
	lua_newtable( L );
	luaL_register( L, NULL, functions );
	b2Version v = b2GetVersion();
	lua_pushfstring( L, "%d.%d.%d", v.major, v.minor, v.revision );
	lua_setfield( L, -2, "version" );
	lua_pushnumber( L, PIXELS_PER_METER );
	lua_setfield( L, -2, "pixelsPerMeter" );
	return 1;
}
