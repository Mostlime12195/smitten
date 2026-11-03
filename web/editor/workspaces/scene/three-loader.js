// Loads three.js and the addons the 3D viewport uses from a pinned CDN, once.
// Only the 3D viewport calls it, so 2D projects never download three.js.
//
// The addons import three with a bare specifier ('three') and each other with
// relative paths. The editor's import map doesn't (and shouldn't have to) know
// about three, so each addon's source is fetched and its imports are rewritten
// to absolute URLs: 'three' becomes the same three.module.js URL loaded here,
// so there is exactly one copy of three (instanceof checks across addons hold).

export const THREE_VERSION = '0.170.0';
const ROOT = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`;

export const THREE_URL = `${ROOT}build/three.module.js`;
export const ADDON_URLS = {
  OrbitControls: `${ROOT}examples/jsm/controls/OrbitControls.js`,
  TransformControls: `${ROOT}examples/jsm/controls/TransformControls.js`,
  GLTFLoader: `${ROOT}examples/jsm/loaders/GLTFLoader.js`,
  SkeletonUtils: `${ROOT}examples/jsm/utils/SkeletonUtils.js`,
};

// import ... from '...', export ... from '...', import '...'
const IMPORT_RE = /\b(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?(['"])([^'"\n]+)\1/g;

const rewritten = new Map(); // addon url -> Promise<blob url>

function addonModule(url) {
  if (!rewritten.has(url)) {
    const p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const src = await res.text();
      const deps = new Map();
      for (const m of src.matchAll(IMPORT_RE)) {
        const spec = m[2];
        if (deps.has(spec)) continue;
        if (spec === 'three') deps.set(spec, THREE_URL);
        else if (spec.startsWith('./') || spec.startsWith('../')) deps.set(spec, await addonModule(new URL(spec, url).href));
      }
      const out = src.replace(IMPORT_RE, (whole, q, spec) => {
        const to = deps.get(spec);
        return to ? whole.slice(0, whole.length - spec.length - 1) + to + q : whole;
      });
      return URL.createObjectURL(new Blob([`${out}\n//# sourceURL=${url}\n`], { type: 'text/javascript' }));
    })();
    p.catch(() => rewritten.delete(url));
    rewritten.set(url, p);
  }
  return rewritten.get(url);
}

let loading = null;

/**
 * Resolves to { THREE, OrbitControls, TransformControls, GLTFLoader,
 * SkeletonUtils }. Cached; a failed load (offline) can be retried.
 */
export function loadThree() {
  if (!loading) {
    loading = (async () => {
      try {
        const [THREE, orbit, transform, gltf, skeleton] = await Promise.all([
          import(THREE_URL),
          addonModule(ADDON_URLS.OrbitControls).then((u) => import(u)),
          addonModule(ADDON_URLS.TransformControls).then((u) => import(u)),
          addonModule(ADDON_URLS.GLTFLoader).then((u) => import(u)),
          addonModule(ADDON_URLS.SkeletonUtils).then((u) => import(u)),
        ]);
        return {
          THREE,
          OrbitControls: orbit.OrbitControls,
          TransformControls: transform.TransformControls,
          GLTFLoader: gltf.GLTFLoader,
          SkeletonUtils: skeleton,
        };
      } catch (e) {
        loading = null;
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const err = new Error(
          `The 3D view needs three.js ${THREE_VERSION}, downloaded from cdn.jsdelivr.net, and it couldn't be loaded` +
          (offline ? ' because this computer is offline' : '') +
          `. Check your internet connection, then open the scene again. (${e.message || e})`,
        );
        err.cause = e;
        throw err;
      }
    })();
  }
  return loading;
}
