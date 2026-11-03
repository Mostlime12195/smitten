-- graphics3d.shaders: the GLSL (ES 3.00 compatible) for the renderer, built
-- on LÖVE's shader conventions: position()/effect() entry points, LÖVE's
-- TransformMatrix (the model matrix: graphics3d draws with an identity 2D
-- transform) and ProjectionMatrix (projection * view, set with
-- setProjection). Normals come in at vertex location 3.
--
-- Lighting happens in linear space. With gammacorrect on, LÖVE's sRGB
-- textures and render targets do the conversions; without it the shader
-- converts texture colors in and the result out itself.

local S = {}

S.MAX_LIGHTS = 12

local COMMON = [[
#ifdef LOVE_GAMMA_CORRECT
#define G3D_TO_LINEAR(c) (c)
#define G3D_OUTPUT(c) (c)
#else
#define G3D_TO_LINEAR(c) gammaToLinearFast(c)
#define G3D_OUTPUT(c) linearToGammaFast(c)
#endif

#ifdef PIXEL
uniform highp vec3 u_skyTop;
uniform highp vec3 u_skyHorizon;
uniform highp vec3 u_skyBottom;

highp vec3 g3d_sky(highp vec3 d) {
	highp float y = clamp(d.y, -1.0, 1.0);
	if (y >= 0.0) {
		highp float t = 1.0 - pow(1.0 - y, 3.0);
		return mix(u_skyHorizon, u_skyTop, t);
	}
	highp float t = 1.0 - pow(1.0 + y, 12.0);
	return mix(u_skyHorizon, u_skyBottom, t);
}
#endif
]]

local STANDARD = [[
varying highp vec3 vWorldPos;
varying highp vec3 vNormal;
varying mediump vec4 vColor;

#ifdef VERTEX
layout (location = 3) in vec3 VertexNormal;

vec4 position(mat4 clipFromLocal, vec4 localPosition) {
	highp vec4 world = TransformMatrix * localPosition;
	vWorldPos = world.xyz;
	// The cofactor matrix is the inverse transpose times the determinant:
	// right for non-uniform scale without inverting anything.
	highp mat3 m = mat3(TransformMatrix);
	highp mat3 cof = mat3(cross(m[1], m[2]), cross(m[2], m[0]), cross(m[0], m[1]));
	highp float handedness = dot(m[0], cof[0]) < 0.0 ? -1.0 : 1.0;
	vNormal = cof * VertexNormal * handedness;
	// Raw vertex colors: they are linear (glTF, and newMesh converts its own).
	vColor = VertexColor;
	return ProjectionMatrix * world;
}
#endif

#ifdef PIXEL
uniform highp vec4 u_color;        // linear rgb, alpha
uniform highp vec4 u_material;     // roughness, metallic, alpha cutoff, keep alpha (1 = blended)
uniform highp vec4 u_emission;     // linear rgb, unshaded
uniform highp vec4 u_uvTransform;  // scale xy, offset zw
uniform Image u_albedo;

uniform highp vec3 u_cameraPos;
uniform int u_lightCount;
uniform highp vec4 u_lightPos[MAX_LIGHTS];    // position, type (0 directional, 1 point, 2 spot)
uniform highp vec4 u_lightColor[MAX_LIGHTS];  // linear color * energy, 1 / range
uniform highp vec4 u_lightDir[MAX_LIGHTS];    // direction the light travels, cos(spot angle)

uniform highp vec3 u_ambientUp;
uniform highp vec3 u_ambientDown;
uniform highp vec4 u_env;          // sky reflections (0/1), sky energy
uniform highp vec4 u_fog;          // start, 1 / (end - start), enabled
uniform highp vec3 u_fogColor;

#ifdef SHADOWS
uniform DepthImage u_shadowMap;
uniform highp mat4 u_shadowMatrix;
uniform highp vec4 u_shadowParams; // texel size (uv), depth bias, normal offset (m)
uniform highp vec4 u_shadowFade;   // start, 1 / (end - start)

float g3d_shadow(highp vec3 worldPos, highp vec3 normal, highp float dist) {
	highp vec4 sp = u_shadowMatrix * vec4(worldPos + normal * u_shadowParams.z, 1.0);
	highp vec3 p = sp.xyz / sp.w;
	// Rendering into a canvas flips y in LÖVE, so v runs down.
	highp vec2 uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
	highp float z = p.z * 0.5 + 0.5 - u_shadowParams.y;
	if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0 || z >= 1.0)
		return 1.0;
	highp float t = u_shadowParams.x;
	float s = 0.0;
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++)
			s += texture(u_shadowMap, vec3(uv + vec2(float(x), float(y)) * t, z));
	}
	s *= 1.0 / 9.0;
	float fade = clamp((dist - u_shadowFade.x) * u_shadowFade.y, 0.0, 1.0);
	return mix(s, 1.0, fade);
}
#endif

vec4 effect(vec4 vcolor, Image tex, vec2 texcoord, vec2 pixcoord) {
	highp vec2 uv = VaryingTexCoord.xy * u_uvTransform.xy + u_uvTransform.zw;
	vec4 texel = Texel(u_albedo, uv);
	texel.rgb = G3D_TO_LINEAR(texel.rgb);
	vec4 base = u_color * texel * vColor;
	if (base.a < u_material.z)
		discard;
	float alpha = u_material.w > 0.5 ? base.a : 1.0;

	highp vec3 toCamera = u_cameraPos - vWorldPos;
	highp float dist = length(toCamera);
	vec3 color;

	if (u_emission.w > 0.5) {
		color = base.rgb + u_emission.rgb;
	} else {
		highp vec3 N = normalize(vNormal);
		if (!gl_FrontFacing)
			N = -N;
		highp vec3 V = toCamera / max(dist, 1e-5);
		vec3 albedo = base.rgb;
		float rough = clamp(u_material.x, 0.03, 1.0);
		float metal = clamp(u_material.y, 0.0, 1.0);
		vec3 diffuseColor = albedo * (1.0 - metal);
		vec3 specColor = mix(vec3(0.04), albedo, metal);
		// Blinn-Phong exponent and normalization from roughness.
		highp float a = rough * rough;
		highp float shininess = clamp(2.0 / (a * a) - 2.0, 1.0, 4096.0);
		highp float specNorm = (shininess + 8.0) * 0.125;

		float shadow = 1.0;
#ifdef SHADOWS
		shadow = g3d_shadow(vWorldPos, N, dist);
#endif

		vec3 direct = vec3(0.0);
		for (int i = 0; i < MAX_LIGHTS; i++) {
			if (i >= u_lightCount)
				break;
			highp vec4 lp = u_lightPos[i];
			highp vec4 lc = u_lightColor[i];
			highp vec4 ld = u_lightDir[i];
			highp vec3 L;
			float atten = 1.0;
			if (lp.w < 0.5) {
				L = -ld.xyz;
				if (i == 0)
					atten = shadow;
			} else {
				highp vec3 d = lp.xyz - vWorldPos;
				highp float len = length(d);
				L = d / max(len, 1e-5);
				highp float x = clamp(len * lc.w, 0.0, 1.0);
				atten = 1.0 - x * x;
				atten *= atten;
				if (lp.w > 1.5)
					atten *= smoothstep(ld.w, mix(ld.w, 1.0, 0.25), dot(-L, ld.xyz));
			}
			highp float NdotL = dot(N, L);
			if (NdotL <= 0.0 || atten <= 0.0)
				continue;
			highp vec3 H = normalize(L + V);
			highp float NdotH = max(dot(N, H), 0.0);
			float VdotH = max(dot(V, H), 0.0);
			vec3 F = specColor + (1.0 - specColor) * pow(1.0 - VdotH, 5.0);
			highp float spec = specNorm * pow(NdotH, shininess);
			direct += (diffuseColor + F * spec) * lc.rgb * (NdotL * atten);
		}

		// Ambient: a sky/ground hemisphere, and reflections of the sky.
		float NdotV = clamp(dot(N, V), 0.0, 1.0);
		vec3 ambient = mix(u_ambientDown, u_ambientUp, N.y * 0.5 + 0.5);
		vec3 env = ambient;
		if (u_env.x > 0.5) {
			highp vec3 R = reflect(-V, N);
			env = mix(g3d_sky(R) * u_env.y, ambient, rough);
		}
		float fresnel = pow(1.0 - NdotV, 5.0);
		vec3 envF = specColor + (max(vec3(1.0 - rough), specColor) - specColor) * fresnel;
		color = diffuseColor * ambient + envF * env + direct + u_emission.rgb;
	}

	if (u_fog.z > 0.5)
		color = mix(color, u_fogColor, clamp((dist - u_fog.x) * u_fog.y, 0.0, 1.0));

	return vec4(G3D_OUTPUT(color), alpha);
}
#endif
]]

-- Shadow map pass: depth only, honoring alpha cutoff.
local DEPTH = [[
#ifdef VERTEX
vec4 position(mat4 clipFromLocal, vec4 localPosition) {
	return ProjectionMatrix * (TransformMatrix * localPosition);
}
#endif

#ifdef PIXEL
uniform highp vec4 u_color;
uniform highp vec4 u_material;
uniform highp vec4 u_uvTransform;
uniform Image u_albedo;

vec4 effect(vec4 vcolor, Image tex, vec2 texcoord, vec2 pixcoord) {
	if (u_material.z > 0.0) {
		highp vec2 uv = VaryingTexCoord.xy * u_uvTransform.xy + u_uvTransform.zw;
		if (Texel(u_albedo, uv).a * u_color.a < u_material.z)
			discard;
	}
	return vec4(1.0);
}
#endif
]]

-- Sky background: a full-screen rectangle in LÖVE's 2D projection.
local SKY = [[
varying highp vec2 vNdc;

#ifdef VERTEX
vec4 position(mat4 clipFromLocal, vec4 localPosition) {
	vec4 p = clipFromLocal * localPosition;
	vNdc = p.xy / p.w;
	return p;
}
#endif

#ifdef PIXEL
uniform highp mat4 u_invViewProj; // inverse(projection * rotation-only view)
uniform highp vec4 u_fog;
uniform highp vec3 u_fogColor;

vec4 effect(vec4 vcolor, Image tex, vec2 texcoord, vec2 pixcoord) {
	highp vec4 a = u_invViewProj * vec4(vNdc, -1.0, 1.0);
	highp vec4 b = u_invViewProj * vec4(vNdc, 0.0, 1.0);
	highp vec3 dir = normalize(b.xyz / b.w - a.xyz / a.w);
	vec3 c = g3d_sky(dir);
	if (u_fog.z > 0.5)
		c = mix(c, u_fogColor, pow(1.0 - abs(dir.y), 8.0));
	return vec4(G3D_OUTPUT(c), 1.0);
}
#endif
]]

local cache = {}

local function build(key, source, defines)
	local shader = cache[key]
	if shader then return shader end
	defines = defines or {}
	defines.MAX_LIGHTS = S.MAX_LIGHTS
	local ok, result = pcall(love.graphics.newShader, COMMON .. source, { defines = defines, debugname = "graphics3d " .. key })
	if not ok then
		error("graphics3d: the " .. key .. " shader doesn't compile on this system:\n" .. tostring(result), 0)
	end
	shader = result
	cache[key] = shader
	return shader
end

---The lit shader, with or without the directional shadow map.
function S.standard(shadows)
	if shadows then return build("standard+shadows", STANDARD, { SHADOWS = 1 }) end
	return build("standard", STANDARD)
end

function S.depth()
	return build("depth", DEPTH)
end

function S.sky()
	return build("sky", SKY)
end

-- Uniforms the GLSL compiler optimized away can't be sent; remember which exist.
local has = setmetatable({}, { __mode = "k" })

---Sends a uniform if the shader uses it.
function S.send(shader, name, ...)
	local names = has[shader]
	if not names then
		names = {}
		has[shader] = names
	end
	local exists = names[name]
	if exists == nil then
		exists = shader:hasUniform(name)
		names[name] = exists
	end
	if exists then shader:send(name, ...) end
end

return S
