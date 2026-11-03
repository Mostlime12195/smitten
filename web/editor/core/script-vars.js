// Script variables (DESIGN.md, section 5): values a script sets at its top
// level, shown in the inspector so each piece can use its own value.
//
// A script is the piece's own code, so its variables are top-level
// `name = value` lines (not indented, not local). Old-style scripts (a table
// they return) declare them as `Name.field = value` lines.

const LINE = '\\s*=\\s*(.+?)\\s*(?:--\\s*(.*))?$';

function literal(raw) {
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { value: Number(raw), type: 'number' };
  if (/^(true|false)$/.test(raw)) return { value: raw === 'true', type: 'bool' };
  if (/^(["']).*\1$/.test(raw)) return { value: raw.slice(1, -1), type: 'string' };
  if (/^\{\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*(,\s*-?[\d.]+\s*)?\}$/.test(raw)) {
    const value = raw.slice(1, -1).split(',').map(Number);
    if (value.length === 3) value.push(1);
    return { value, type: 'color' };
  }
  return null;
}

/** True if a script is in the old style: its last line of code is a top-level return. */
export function isOldStyleScript(source) {
  const lines = (source || '').split('\n').map((l) => l.replace(/--.*$/, '')).filter((l) => /\S/.test(l));
  return /^return[\s{]/.test(lines[lines.length - 1] || '');
}

/** Script variables: [{name, type, value, description}]. */
export function scriptVariables(source) {
  const out = [];
  if (!source) return out;
  let re;
  if (isOldStyleScript(source)) {
    const table = source.match(/^\s*local\s+([A-Za-z_]\w*)\s*=\s*\{\s*\}/m)?.[1];
    if (!table) return out;
    re = new RegExp(`^${table}\\.([A-Za-z]\\w*)${LINE}`, 'gm');
  } else {
    re = new RegExp(`^([A-Za-z]\\w*)${LINE}`, 'gm');
  }
  const seen = new Set();
  for (const m of source.matchAll(re)) {
    const [, name, raw, comment] = m;
    if (seen.has(name)) continue;
    const v = literal(raw);
    if (!v) continue;
    seen.add(name);
    out.push({ name, ...v, description: comment || '' });
  }
  return out;
}
