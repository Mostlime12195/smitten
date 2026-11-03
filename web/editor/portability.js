// What stops a project from running on plain desktop LÖVE: uses of the
// smitten module and of Smitten's Lua syntax.

const SMITTEN_USE = /\bsmitten\s*[.:[]|require\s*\(?\s*["']smitten/;

/** [{path, line, feature}] for every Smitten-only feature in the project's Lua files. */
export async function smittenOnlyFeatures(files) {
  let findSyntax = null;
  try {
    ({ findSmittenSyntax: findSyntax } = await import('./smitten-syntax.js'));
  } catch { /* not available */ }
  const out = [];
  for (const [path, data] of Object.entries(files)) {
    if (!/\.lua$/i.test(path) || typeof data !== 'string') continue;
    data.split('\n').forEach((text, i) => {
      if (SMITTEN_USE.test(text.replace(/--.*$/, ''))) out.push({ path, line: i + 1, feature: 'the smitten module' });
    });
    if (findSyntax) for (const u of findSyntax(data)) out.push({ path, line: u.line, feature: u.feature });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}
