// Script variables (DESIGN.md, section 4): fields a script declares at its
// top level, shown in the inspector so each node can use its own value.

/** Script variables: top-level `Name.field = literal` lines of a script. */
export function scriptVariables(source) {
  const out = [];
  if (!source) return out;
  const table = source.match(/^\s*local\s+([A-Za-z_]\w*)\s*=\s*\{\s*\}/m)?.[1];
  if (!table) return out;
  const re = new RegExp(`^${table}\\.([A-Za-z]\\w*)\\s*=\\s*(.+?)\\s*(?:--\\s*(.*))?$`, 'gm');
  for (const m of source.matchAll(re)) {
    const [, name, raw, comment] = m;
    let value;
    let type;
    if (/^-?\d+(\.\d+)?$/.test(raw)) { value = Number(raw); type = 'number'; }
    else if (/^(true|false)$/.test(raw)) { value = raw === 'true'; type = 'bool'; }
    else if (/^(["']).*\1$/.test(raw)) { value = raw.slice(1, -1); type = 'string'; }
    else if (/^\{\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*(,\s*-?[\d.]+\s*)?\}$/.test(raw)) {
      value = raw.slice(1, -1).split(',').map(Number);
      if (value.length === 3) value.push(1);
      type = 'color';
    } else continue;
    out.push({ name, type, value, description: comment || '' });
  }
  return out;
}
