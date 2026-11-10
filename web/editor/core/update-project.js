// Old projects, and bringing one up to date.
//
// A project's smitten.json carries "version". Version 3 changed four things
// scripts see (docs/older-projects.md): angles are degrees, a Button's event
// is clicked(), assigning a name a script never declared is an error, and a
// Body's gravity multiplier is gravityScale. The engine runs a project of
// version 2 or less with the old rules (love/src/modules/engine/compat.lua),
// so it plays as it always did until its maker chooses to update it.
//
// Scene files say which rules they were saved with (their own "version").
// The editor only works in the new ones: upgradeScene() turns an old scene
// into a new one when it's opened, and it's saved as version 3 if it's
// edited (the engine reads either kind in either project).
//
// updateProject() does the whole project: the scenes, the event functions
// of scripts on Buttons and the like, the version number; and it reports
// what a person has to look at (angle maths, names never declared), which
// no program can change safely. It only works out the new files: the
// caller keeps a copy of the project and writes them.
//
// Keep upgradeScene() in step with compat.lua's scene conversion.

export const PROJECT_VERSION = 3;

/** Defaults that changed with the unit: what version 2 had (in its units). */
export const OLD_DEFAULTS = {
  Particles: { direction: -1.5708, spread: 0.5 },
  Body: { slope: 0.7854 },
  Joint: { minAngle: -0.7854, maxAngle: 0.7854, motorSpeed: 2 },
};

const TURNING_JOINT = new Set(['pin', 'wheel']);

/** Events that were renamed: type -> { old name: new name }. */
export const EVENT_RENAMES = {
  Button: { pressed: 'clicked' },
  Panel: { pressed: 'clicked' },
  Picture: { pressed: 'clicked' },
  TouchButton: { pressed: 'touched', released: 'untouched' },
  TouchStick: { pressed: 'touched', released: 'untouched' },
};

/** True for a project (its settings) that still plays by the old rules. */
export function isOldProject(settings) {
  return !(typeof settings?.version === 'number' && settings.version >= PROJECT_VERSION);
}

/**
 * Radians as degrees: 1.5708 is 90, not 90.0002 (a round number of
 * hundredths within half a thousandth is what was meant).
 */
export function toDegrees(v) {
  const d = (v * 180) / Math.PI;
  const nice = Math.floor(d * 100 + 0.5) / 100;
  if (Math.abs(d - nice) < 0.0005) return nice;
  return Math.floor(d * 1e6 + 0.5) / 1e6;
}

function lineageOf(schema, type) {
  const out = [];
  for (let t = type; t && schema.types[t]; t = schema.types[t].extends) out.push(t);
  return out;
}

function angleProps(schema, type) {
  const out = [];
  for (const t of lineageOf(schema, type)) {
    for (const [name, def] of Object.entries(schema.types[t].properties || {})) {
      if (def.type === 'angle') out.push(name);
    }
  }
  return out;
}

function defaultIn(schema, type, prop) {
  for (const t of lineageOf(schema, type)) {
    const def = schema.types[t].properties?.[prop];
    if (def) return def.default;
  }
  return undefined;
}

/** The type of the root of a scene (following scenes whose root is another scene). */
function rootType(path, readScene, seen = new Set()) {
  if (seen.has(path) || !readScene) return 'Group';
  seen.add(path);
  let data = null;
  try {
    data = readScene(path);
  } catch {
    data = null;
  }
  if (!data?.root) return 'Group';
  if (data.root.scene) return rootType(data.root.scene, readScene, seen);
  return data.root.type || 'Group';
}

/** The type of the piece at a path ("Menu/Play") inside a piece that has a script, or null. */
function childType(use, path, scenes, readScene) {
  let e = use.entry;
  for (const part of path.split('/')) {
    // A placed scene's pieces are its file's.
    let guard = 0;
    while (e && e.scene && guard++ < 16) {
      const own = (e.children || []).find((c) => c.name === part);
      if (own) break;
      e = scenes[e.scene]?.root;
    }
    e = (e?.children || []).find((c) => c.name === part);
    if (!e) return null;
  }
  return e.scene ? rootType(e.scene, readScene) : e.type || 'Group';
}

/** True if a parsed scene was saved with the old rules. */
export function isOldScene(data) {
  return !(typeof data?.version === 'number' && data.version >= 3);
}

/**
 * Turns a parsed scene saved with the old rules into a version 3 one, in
 * place: angles to degrees, a Body's gravity to gravityScale, and defaults
 * that changed written out so nothing moves. readScene(path) gives another
 * scene's parsed JSON (for the type of a scene placed in this one).
 * Returns { angles, renamed }: how many values it converted and renamed.
 */
export function upgradeScene(data, schema, readScene) {
  const count = { angles: 0, renamed: 0 };
  if (!isOldScene(data)) return count;
  const convert = (e) => {
    if (!e || typeof e !== 'object') return;
    const placed = Boolean(e.scene);
    const type = placed ? rootType(e.scene, readScene) : e.type || 'Group';
    if (schema.types[type]) {
      let props = e.properties;
      const lineage = lineageOf(schema, type);
      const turning = lineage.includes('Joint') && TURNING_JOINT.has(props?.kind ?? defaultIn(schema, type, 'kind'));
      if (props) {
        for (const prop of angleProps(schema, type)) {
          if (typeof props[prop] === 'number') {
            props[prop] = toDegrees(props[prop]);
            count.angles++;
          }
        }
        if (turning && typeof props.motorSpeed === 'number') {
          props.motorSpeed = toDegrees(props.motorSpeed);
          count.angles++;
        }
      }
      if (!placed) {
        for (const [base, olds] of Object.entries(OLD_DEFAULTS)) {
          if (!lineage.includes(base)) continue;
          for (const [prop, was] of Object.entries(olds)) {
            if (props && props[prop] !== undefined && props[prop] !== null) continue;
            const angle = prop !== 'motorSpeed' || turning;
            const saved = angle ? toDegrees(was) : was;
            const now = defaultIn(schema, base, prop);
            if (typeof now === 'number' && Math.abs(saved - now) > 0.005) {
              props = props || {};
              e.properties = props;
              props[prop] = saved;
            }
          }
        }
      }
      if (lineage.includes('Body') && props && typeof props.gravity === 'number' && props.gravity <= 50
        && props.gravityScale === undefined) {
        // A big gravity was a script's own variable (the engine's jumpSpeed
        // took it for one too).
        props.gravityScale = props.gravity;
        delete props.gravity;
        count.renamed++;
      }
    }
    for (const c of e.children || []) convert(c);
  };
  convert(data.root);
  data.version = 3;
  return count;
}

// ---------------------------------------------------------------------------
// Reading Lua (and Smitten's additions to it) well enough to find where
// names are assigned.

const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local',
  'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while', 'continue']);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '^=', '..=']);

/** A script's tokens: [{ t: 'name' | 'key' | 'op' | 'str' | 'num', v, line }]. Comments are left out. */
export function luaTokens(source) {
  const out = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  const longBracket = (at) => {
    // [[ or [==[ at `at`: the index after its closing bracket, else -1.
    const m = /^\[(=*)\[/.exec(source.slice(at, at + 64));
    if (!m) return -1;
    const close = `]${m[1]}]`;
    const end = source.indexOf(close, at + m[0].length);
    return end < 0 ? n : end + close.length;
  };
  const countLines = (from, to) => {
    for (let k = from; k < to; k++) if (source[k] === '\n') line++;
  };
  while (i < n) {
    const c = source[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '-' && source[i + 1] === '-') {
      const end = source[i + 2] === '[' ? longBracket(i + 2) : -1;
      if (end >= 0) {
        countLines(i, end);
        i = end;
      } else {
        while (i < n && source[i] !== '\n') i++;
      }
    } else if (c === '[' && longBracket(i) >= 0) {
      const end = longBracket(i);
      out.push({ t: 'str', v: source.slice(i, end), line });
      countLines(i, end);
      i = end;
    } else if (c === '"' || c === '\'' || c === '`') {
      const start = i;
      const startLine = line;
      i++;
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') i++;
        if (source[i] === '\n') {
          if (c !== '`') break;
          line++;
        }
        i++;
      }
      i++;
      out.push({ t: 'str', v: source.slice(start, i), line: startLine });
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i, i + 256));
      out.push({ t: KEYWORDS.has(m[0]) ? 'key' : 'name', v: m[0], line });
      i += m[0].length;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F.]+|[0-9]*\.?[0-9]*([eE][+-]?[0-9]+)?)/.exec(source.slice(i, i + 64));
      out.push({ t: 'num', v: m[0], line });
      i += Math.max(1, m[0].length);
    } else {
      const three = source.slice(i, i + 3);
      const two = source.slice(i, i + 2);
      let op = c;
      if (three === '...' || three === '..=') op = three;
      else if (['==', '~=', '!=', '<=', '>=', '..', '+=', '-=', '*=', '/=', '%=', '^=', '::'].includes(two)) op = two;
      out.push({ t: 'op', v: op, line });
      i += op.length;
    }
  }
  return out;
}

/**
 * Where a script assigns plain names (not locals, not fields):
 *   declared: Map name -> line    assigned outside any function (the script's
 *                                 variables), and its top-level functions
 *   inside:   Map name -> [lines] assigned inside a function
 */
export function luaAssignments(source) {
  const toks = luaTokens(source);
  const declared = new Map();
  const inside = new Map();
  // Blocks: { locals, fn (starts a function), brackets (open ( { [ in it), wantsDo }.
  const stack = [{ locals: new Set(), fn: false, brackets: 0 }];
  let fnDepth = 0;
  let exprIf = 0; // if-expressions (x = if a then b else c) still waiting for their else
  const top = () => stack[stack.length - 1];
  const isLocal = (name) => stack.some((b) => b.locals.has(name));
  const push = (b) => stack.push({ locals: new Set(), fn: false, brackets: 0, ...b });
  const pop = () => {
    if (stack.length > 1) {
      const b = stack.pop();
      if (b.fn) {
        fnDepth--;
        exprIf = b.exprIf || 0;
      }
    }
  };
  const prevOf = (i) => toks[i - 1];
  // An `if` right after one of these is an expression, with no `end`.
  const EXPR_BEFORE_IF = new Set(['=', '(', ',', '{', '[', '+', '-', '*', '/', '%', '^', '..', '==', '~=', '!=', '<', '>', '<=', '>=',
    'return', 'and', 'or', 'not', '+=', '-=', '*=', '/=', '%=', '^=', '..=']);
  let elseOfExprIf = false;
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    const wasElseOfExprIf = elseOfExprIf;
    elseOfExprIf = false;
    if (tok.t === 'op') {
      if (tok.v === '(' || tok.v === '{' || tok.v === '[') top().brackets++;
      else if (tok.v === ')' || tok.v === '}' || tok.v === ']') top().brackets = Math.max(0, top().brackets - 1);
      else if (ASSIGN_OPS.has(tok.v) && top().brackets === 0) {
        // The names being assigned: a, b = ... (walking back from the =).
        let j = i - 1;
        let lead = null; // the token before the first name
        const names = [];
        while (j >= 0 && toks[j].t === 'name') {
          const before = toks[j - 1];
          if (before && before.t === 'op' && (before.v === '.' || before.v === ':')) break;
          names.push(toks[j]);
          lead = before;
          if (before && before.t === 'op' && before.v === ',') j -= 2;
          else break;
        }
        const isFor = lead && lead.t === 'key' && lead.v === 'for';
        if (!isFor) {
          for (const nm of names) {
            if (isLocal(nm.v)) continue;
            if (fnDepth === 0) {
              if (!declared.has(nm.v)) declared.set(nm.v, nm.line);
            } else {
              if (!inside.has(nm.v)) inside.set(nm.v, []);
              inside.get(nm.v).push(nm.line);
            }
          }
        }
      }
      continue;
    }
    if (tok.t !== 'key') continue;
    switch (tok.v) {
      case 'local': {
        const next = toks[i + 1];
        if (next && next.t === 'key' && next.v === 'function') {
          if (toks[i + 2]?.t === 'name') top().locals.add(toks[i + 2].v);
        } else {
          let j = i + 1;
          while (toks[j]?.t === 'name') {
            top().locals.add(toks[j].v);
            // Lua 5.4-style attribs don't occur; a comma carries on the list.
            if (toks[j + 1]?.t === 'op' && toks[j + 1].v === ',') j += 2;
            else break;
          }
        }
        break;
      }
      case 'function': {
        // function name(...), function a.b:c(...), or function(...).
        let j = i + 1;
        let method = false;
        const nameToks = [];
        while (toks[j] && !(toks[j].t === 'op' && toks[j].v === '(')) {
          if (toks[j].t === 'op' && toks[j].v === ':') method = true;
          if (toks[j].t === 'name') nameToks.push(toks[j]);
          j++;
        }
        const prev = prevOf(i);
        const isLocalFn = prev && prev.t === 'key' && prev.v === 'local';
        if (nameToks.length === 1 && !isLocalFn && !method && toks[i + 2]?.v === '(') {
          const nm = nameToks[0];
          if (!isLocal(nm.v)) {
            if (fnDepth === 0) {
              if (!declared.has(nm.v)) declared.set(nm.v, nm.line);
            }
            // A function made inside another one is a script function too:
            // assigning functions is always allowed.
          }
        }
        const locals = new Set(method ? ['self'] : []);
        let k = j + 1;
        while (toks[k] && !(toks[k].t === 'op' && toks[k].v === ')')) {
          if (toks[k].t === 'name') locals.add(toks[k].v);
          k++;
        }
        push({ locals, fn: true, exprIf });
        exprIf = 0;
        fnDepth++;
        i = k; // past the parameter list
        break;
      }
      case 'if': {
        const prev = prevOf(i);
        const expr = wasElseOfExprIf || (prev && ((prev.t === 'op' && EXPR_BEFORE_IF.has(prev.v)) || (prev.t === 'key' && EXPR_BEFORE_IF.has(prev.v))));
        if (expr) exprIf++;
        else push({ kind: 'if' });
        break;
      }
      case 'else':
        // An if-expression is whole before the statement around it goes on,
        // so an else belongs to the innermost one still open. It ends that
        // one (an `if` straight after carries it on).
        if (exprIf > 0) {
          exprIf--;
          elseOfExprIf = true;
        }
        break;
      case 'for':
      case 'while': {
        const locals = new Set();
        if (tok.v === 'for') {
          let j = i + 1;
          while (toks[j]?.t === 'name') {
            locals.add(toks[j].v);
            if (toks[j + 1]?.t === 'op' && toks[j + 1].v === ',') j += 2;
            else break;
          }
        }
        push({ locals, wantsDo: true });
        break;
      }
      case 'do':
        if (top().wantsDo) top().wantsDo = false;
        else push({});
        break;
      case 'repeat':
        push({ kind: 'repeat' });
        break;
      case 'until':
        pop();
        break;
      case 'end':
        pop();
        break;
      default:
    }
  }
  return { declared, inside };
}

/** A line of code without its comment (strings kept). */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === '\'' || c === '`') {
      quote = c;
    } else if (c === '-' && line[i + 1] === '-') {
      return line.slice(0, i);
    }
  }
  return line;
}

const ANGLE_WORDS = /\b(rotation|spin|angleTo|lookAt|minAngle|maxAngle|motorSpeed|getAngle|math\.pi|math\.rad|math\.deg|math\.atan2?|math\.cos|math\.sin|math\.tan)\b|\.(direction|spread|slope)\b|\bsmitten\.math\.angle\b/;

/** Lines of a script that work with angles: [{ line, text }]. */
export function angleLines(source) {
  const out = [];
  source.split('\n').forEach((text, i) => {
    if (ANGLE_WORDS.test(stripComment(text))) out.push({ line: i + 1, text: text.trim() });
  });
  return out;
}

/** True if a script is in the old style (it returns a table): its names are fields of self. */
function isOldStyle(source) {
  const lines = source.split('\n').map((l) => l.replace(/--.*$/, '')).filter((l) => /\S/.test(l));
  return /^return[\s{]/.test(lines[lines.length - 1] || '');
}

/**
 * Adds `name = nil` lines for names a script only makes inside functions,
 * after the comment at its top. nil is what they were before their first
 * assignment, so the script does what it did.
 */
export function insertDeclarations(source, names) {
  if (!names.length) return source;
  const lines = source.split('\n');
  let at = 0;
  while (at < lines.length && /^\s*--/.test(lines[at])) at++;
  const block = ['-- Variables the script makes later on (added when the project was updated).',
    ...names.map((n) => `${n} = nil`)];
  const before = at > 0 ? [''] : [];
  const after = lines[at] !== undefined && lines[at].trim() !== '' ? [''] : [];
  lines.splice(at, 0, ...before, ...block, ...after);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The whole project

const text = (data) => (typeof data === 'string' ? data : new TextDecoder().decode(data));

/**
 * Works out what updating a project to version 3 changes.
 *   files: { path: string | Uint8Array }   schema: pieces.json
 *   options.declare: also add the missing declarations to scripts
 * Returns { files: { path: new text }, report }, changing nothing itself.
 * report:
 *   old           false if the project is already version 3 (nothing to do)
 *   scenes        [{ path, angles, renamed }]         scene files converted
 *   events        [{ path, line, from, to }]          event functions and on() calls renamed
 *   look          [{ path, line, text, why }]         lines for a person: 'angle' or 'event'
 *   undeclared    [{ path, names: [{ name, line }] }] names only made inside functions
 *   declared      true if the declarations were added
 */
export function updateProject(files, schema, options = {}) {
  const out = {};
  const report = { old: true, scenes: [], events: [], look: [], undeclared: [], declared: Boolean(options.declare) };
  let settings = {};
  try {
    settings = JSON.parse(text(files['smitten.json'] ?? '{}'));
  } catch {
    settings = {};
  }
  if (!isOldProject(settings)) {
    report.old = false;
    return { files: out, report };
  }

  // Scenes: every one parsed (old ones converted), to know where scripts go.
  const scenes = {};
  for (const path of Object.keys(files).filter((p) => p.endsWith('.scene')).sort()) {
    try {
      const data = JSON.parse(text(files[path]));
      if (data && data.format === 'smitten.scene' && data.root) scenes[path] = data;
    } catch { /* not a scene the editor can read: left alone */ }
  }
  const readScene = (p) => scenes[p] || null;
  // Types first (they don't change), then convert.
  const uses = new Map(); // script path -> [{ type, entry, props }]
  const noteUses = (e) => {
    if (!e || typeof e !== 'object') return;
    const type = e.scene ? rootType(e.scene, readScene) : e.type || 'Group';
    const script = e.script || (e.scene ? scenes[e.scene]?.root?.script : null);
    if (e.script) {
      if (!uses.has(e.script)) uses.set(e.script, []);
      uses.get(e.script).push({ type, entry: e });
    } else if (script && e.scene) {
      // A placed scene runs its root's script with this entry's values.
      if (!uses.has(script)) uses.set(script, []);
      uses.get(script).push({ type, entry: e, placed: true });
    }
    for (const c of e.children || []) noteUses(c);
  };
  for (const data of Object.values(scenes)) noteUses(data.root);
  for (const [path, data] of Object.entries(scenes)) {
    if (!isOldScene(data)) continue;
    const count = upgradeScene(data, schema, readScene);
    out[path] = `${JSON.stringify(data, null, 2)}\n`;
    report.scenes.push({ path, ...count });
  }

  const allProps = new Set();
  const allMethods = new Set();
  for (const def of Object.values(schema.types)) {
    for (const k of Object.keys(def.properties || {})) allProps.add(k);
    for (const k of Object.keys(def.methods || {})) allMethods.add(k);
  }
  const propsOf = (type) => {
    const s = new Set();
    for (const t of lineageOf(schema, type)) {
      for (const k of Object.keys(schema.types[t].properties || {})) s.add(k);
    }
    return s;
  };

  for (const path of Object.keys(files).filter((p) => p.endsWith('.lua')).sort()) {
    let source = text(files[path]);
    const original = source;
    if (isOldStyle(source)) {
      for (const l of angleLines(source)) report.look.push({ path, ...l, why: 'angle' });
      continue;
    }
    const used = uses.get(path) || [];
    const types = [...new Set(used.map((u) => u.type))];

    // 1. Event functions: pressed() on a Button is clicked().
    const renameFor = (type) => lineageOf(schema, type).map((x) => EVENT_RENAMES[x]).find(Boolean) || null;
    // The one new name every one of these types gives an old event, else null.
    const agreed = (list, event) => {
      const names = list.map((t) => renameFor(t)?.[event] || null);
      return names.length > 0 && names.every((x) => x && x === names[0]) ? names[0] : null;
    };
    const lines = source.split('\n');
    lines.forEach((ln, i) => {
      const code = stripComment(ln);
      const fn = /^function\s+(pressed|released)\s*\(/.exec(code);
      if (fn) {
        const to = agreed(types, fn[1]);
        if (to) {
          lines[i] = ln.replace(/^function\s+(pressed|released)/, `function ${to}`);
          report.events.push({ path, line: i + 1, from: `function ${fn[1]}()`, to: `function ${to}()` });
        } else if (types.some((t) => renameFor(t)?.[fn[1]])) {
          report.look.push({ path, line: i + 1, text: ln.trim(), why: 'event' });
        }
        return;
      }
      const on = /\bon\s*\(\s*(["'])(pressed|released)\1/.exec(code);
      if (!on) return;
      const pre = code.slice(0, on.index).trimEnd();
      if (pre.endsWith('.')) return; // some table's own on()
      // Whose event: this piece's (on(...), self:on(...)), a child's
      // (Name:on(...), find("Name"):on(...)), or one only the game knows.
      let listTypes = null;
      if (!pre.endsWith(':')) {
        listTypes = types;
      } else {
        const who = pre.slice(0, -1).trimEnd();
        const child = /(?:^|[^\w.:)\]])([A-Z]\w*)$/.exec(who)?.[1] ?? /(?:^|[^\w.:)\]])find\(\s*["']([^"']+)["']\s*\)$/.exec(who)?.[1];
        if (/(?:^|[^\w.])self$/.test(who)) listTypes = types;
        else if (child && used.length) {
          listTypes = used.map((u) => childType(u, child, scenes, readScene));
          if (listTypes.some((t) => !t)) listTypes = null;
        }
      }
      const to = listTypes && agreed(listTypes, on[2]);
      if (to) {
        lines[i] = ln.replace(/(\bon\s*\(\s*)(["'])(pressed|released)\2/, `$1$2${to}$2`);
        report.events.push({ path, line: i + 1, from: `on("${on[2]}")`, to: `on("${to}")` });
      } else if (!listTypes || listTypes.some((t) => renameFor(t)?.[on[2]])) {
        report.look.push({ path, line: i + 1, text: ln.trim(), why: 'event' });
      }
    });
    source = lines.join('\n');

    // 2. Angles: for a person to look at.
    for (const l of angleLines(source)) report.look.push({ path, ...l, why: 'angle' });

    // 3. Names only made inside functions.
    const { declared, inside } = luaAssignments(source);
    const known = types.length ? new Set(types.flatMap((t) => [...propsOf(t)])) : allProps;
    const names = [];
    for (const [name, where] of inside) {
      if (declared.has(name) || known.has(name) || allMethods.has(name) || name === 'self') continue;
      // Set for every piece that has the script (in the Inspector): fine.
      if (used.length && used.every((u) => u.entry.properties && u.entry.properties[name] !== undefined && u.entry.properties[name] !== null)) continue;
      names.push({ name, line: where[0] });
    }
    if (names.length) {
      report.undeclared.push({ path, names });
      if (options.declare) source = insertDeclarations(source, names.map((x) => x.name));
    }
    if (source !== original) out[path] = source;
  }

  out['smitten.json'] = `${JSON.stringify({ ...settings, version: PROJECT_VERSION }, null, 2)}\n`;
  return { files: out, report };
}

/**
 * Updates an open project (core/project.js): keeps a copy first, then
 * writes what updateProject() worked out. duplicate(id, name) makes the
 * copy (fs-store.js's duplicateProject) and resolves with it; if it can't,
 * this throws and the project is left as it was.
 * Resolves with { report, backup }.
 */
export async function applyUpdate(project, schema, { declare = false, backupName, duplicate }) {
  await project.flush();
  const plan = updateProject(project.snapshot(), schema, { declare });
  if (!plan.report.old) return { report: plan.report, backup: null };
  const backup = await duplicate(project.id, backupName);
  for (const [path, data] of Object.entries(plan.files)) project.write(path, data);
  await project.flush();
  return { report: plan.report, backup };
}

/**
 * The report as plain text: what was done (for the Output panel), or with
 * preview, what would be (for the dialog that asks).
 */
export function reportText(report, { preview = false } = {}) {
  const out = [];
  if (!report.old) return 'This project already uses the newest rules.';
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  if (report.scenes.length) out.push(`${n(report.scenes.length, 'scene', 'scenes')} ${preview ? 'will be ' : ''}converted (angles to degrees, gravity to gravityScale).`);
  for (const e of report.events) out.push(`${e.path}:${e.line}: ${e.from} ${preview ? 'becomes' : 'is now'} ${e.to}`);
  const angles = report.look.filter((l) => l.why === 'angle');
  const events = report.look.filter((l) => l.why === 'event');
  if (events.length) {
    out.push('', 'Events to check (a Button\'s, Panel\'s or Picture\'s pressed is now clicked; a TouchButton\'s or TouchStick\'s pressed and released are touched and untouched):');
    for (const l of events) out.push(`  ${l.path}:${l.line}: ${l.text}`);
  }
  if (angles.length) {
    out.push('', 'Angles to check (they are degrees now: 90, not math.pi / 2; use math.rad(angle) for math.cos and math.sin):');
    for (const l of angles) out.push(`  ${l.path}:${l.line}: ${l.text}`);
  }
  if (report.undeclared.length) {
    out.push('', preview
      ? 'Variables only made inside functions (each needs a line at the top of its script, like name = nil, or the game stops there):'
      : report.declared
        ? 'Variables that were only made inside functions (a line for each was added at the top of its script):'
        : 'Variables only made inside functions (add name = nil at the top of the script, or the game stops there):');
    for (const s of report.undeclared) {
      for (const v of s.names) out.push(`  ${s.path}:${v.line}: ${v.name}`);
    }
  }
  return out.join('\n').trim();
}
