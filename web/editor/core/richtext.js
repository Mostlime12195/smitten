// Rich text for the scene view: reads the same tags as the engine's
// smitten.text (love/src/modules/text/init.lua) so a Text or Label with
// `rich` on looks close to the running game. Colors, sizes, bold, italic,
// underline, strike-through, fonts, per-line alignment and line breaks are
// drawn; effects stand still; pictures leave a square gap.

const COLORS = {
  white: [1, 1, 1, 1], black: [0, 0, 0, 1], gray: [0.5, 0.5, 0.5, 1], grey: [0.5, 0.5, 0.5, 1],
  silver: [0.75, 0.75, 0.78, 1], red: [0.94, 0.27, 0.27, 1], orange: [0.98, 0.57, 0.2, 1],
  yellow: [0.98, 0.84, 0.25, 1], gold: [1, 0.8, 0.2, 1], green: [0.3, 0.8, 0.4, 1],
  lime: [0.64, 0.9, 0.21, 1], teal: [0.18, 0.72, 0.68, 1], cyan: [0.3, 0.85, 0.95, 1],
  blue: [0.25, 0.47, 0.95, 1], navy: [0.12, 0.16, 0.4, 1], purple: [0.62, 0.36, 0.9, 1],
  pink: [0.96, 0.5, 0.75, 1], brown: [0.55, 0.36, 0.22, 1], clear: [0, 0, 0, 0],
};

/** The tags smitten.text knows; anything else is an effect a script may add. */
export const RICH_TAGS = ['b', 'i', 'u', 's', 'color', 'size', 'font', 'outline', 'shadow', 'center', 'right', 'left', 'link', 'speed', 'img', 'pause'];
export const RICH_EFFECTS = ['wave', 'shake', 'rainbow', 'fade', 'pulse'];

/** "#f80", "#ff8800", "#ff8800cc" or a name: [r, g, b, a], or null. */
export function parseColor(v) {
  if (typeof v !== 'string') return null;
  const named = COLORS[v.toLowerCase()];
  if (named) return named;
  const m = /^#([0-9a-f]+)$/i.exec(v);
  if (!m) return null;
  const hex = m[1];
  let out = null;
  if (hex.length === 3 || hex.length === 4) out = [...hex].map((c) => parseInt(c, 16) / 15);
  else if (hex.length === 6 || hex.length === 8) out = hex.match(/../g).map((c) => parseInt(c, 16) / 255);
  if (!out) return null;
  if (out.length === 3) out.push(1);
  return out;
}

function tagStyle(name, value, text, from) {
  switch (name) {
    case 'b': return { bold: true };
    case 'i': return { italic: true };
    case 'u': return { underline: true };
    case 's': return { strike: true };
    case 'center': case 'right': case 'left': return { align: name };
    case 'color': {
      const c = parseColor(value);
      return c ? { color: c } : null;
    }
    case 'size': {
      if (value === undefined || value === '' || Number.isNaN(Number(value))) return null;
      if (/^[+-]/.test(value)) return { sizeAdd: Number(value) };
      return Number(value) > 0 ? { size: Number(value) } : null;
    }
    case 'font': return value ? { font: value } : null;
    case 'outline': case 'shadow': case 'speed': return {};
    case 'link': return value !== undefined ? { link: value } : null;
    default:
      if (RICH_EFFECTS.includes(name)) return {};
      // An effect a script adds with smitten.text.effect(): taken as one
      // when the text closes it again, shown as written otherwise.
      return text.toLowerCase().includes(`[/${name}]`, from) ? {} : null;
  }
}

function fold(stack) {
  const s = {};
  for (const e of stack) {
    for (const [k, v] of Object.entries(e.set)) {
      if (k === 'size') { s.size = v; delete s.sizeAdd; } else if (k === 'sizeAdd') {
        if (s.size !== undefined) s.size += v;
        else s.sizeAdd = (s.sizeAdd || 0) + v;
      } else s[k] = v;
    }
  }
  return s;
}

/**
 * Rich text as spans: [{ text, style }], where text may hold "\n" and a
 * style has color, size, sizeAdd, bold, italic, underline, strike, font,
 * align, link, picture. With rich off, one span of the text as it is.
 */
export function parseRich(text, rich = true) {
  text = String(text ?? '').replace(/\r/g, '');
  if (!rich) return [{ text, style: {} }];
  const spans = [];
  const stack = [];
  let style = {};
  const put = (t, st = style) => {
    if (!t) return;
    const last = spans[spans.length - 1];
    if (last && last.style === st) last.text += t;
    else spans.push({ text: t, style: st });
  };
  let pos = 0;
  while (pos < text.length) {
    const s = text.indexOf('[', pos);
    if (s < 0) {
      put(text.slice(pos));
      break;
    }
    put(text.slice(pos, s));
    if (text[s + 1] === '[') {
      put('[');
      pos = s + 2;
      continue;
    }
    const e = text.indexOf(']', s + 1);
    const nextOpen = text.indexOf('[', s + 1);
    let ok = false;
    if (e >= 0 && (nextOpen < 0 || nextOpen > e)) {
      const body = text.slice(s + 1, e);
      if (body[0] === '/') {
        const name = body.slice(1).toLowerCase();
        let at = -1;
        if (name === '') at = stack.length - 1;
        else for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === name) { at = i; break; }
        if (at >= 0) {
          stack.splice(at, 1);
          style = fold(stack);
          ok = true;
        }
      } else {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(?:"([^"]*)"|(\S*)))?((?:\s+[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|\S+))*)\s*$/.exec(body);
        if (m) {
          const name = m[1].toLowerCase();
          const value = m[2] ?? m[3];
          if (name === 'img') {
            if (value) {
              put('￼', { ...style, picture: value });
              ok = true;
            }
          } else if (name === 'pause') {
            ok = value !== undefined && !Number.isNaN(Number(value));
          } else {
            const set = tagStyle(name, value, text, e);
            if (set) {
              stack.push({ name, set });
              style = fold(stack);
              ok = true;
            }
          }
        }
      }
    }
    if (ok) pos = e + 1;
    else {
      put('[');
      pos = s + 1;
    }
  }
  return spans;
}

/** The text without its tags, as smitten.text.strip() gives it. */
export function stripRich(text) {
  return parseRich(text, true).map((s) => s.text.replace(/￼/g, '')).join('');
}

/**
 * Lays spans out into lines of fragments. `metrics(style)` gives a font's
 * { height, spacing, base } and `width(m, text)` a text's width with it.
 * options: limit (px, 0 for none), align, lineHeight, letterSpacing, by
 * ("word" | "character" | "none").
 * Returns { lines: [{ y, height, base, width, x, frags: [{ text, x, m, style, width }] }], width, height }.
 */
export function layoutRich(spans, metrics, width, options = {}) {
  const limit = options.by === 'none' ? 0 : options.limit || 0;
  const spacing = options.letterSpacing || 0;
  const lineMul = options.lineHeight || 1;
  const byChar = options.by === 'character';
  const measure = (m, t) => (m.picture ? (t ? m.base : 0) : width(m, t)) + spacing * [...t].length;
  const baseM = metrics({});
  const lines = [];
  let line = null;
  const open = () => {
    line = { frags: [], width: 0, pen: 0, soft: false };
    lines.push(line);
  };
  open();
  for (const span of spans) {
    const m = span.style.picture ? { ...metrics(span.style), picture: true } : metrics(span.style);
    const paragraphs = span.text.split('\n');
    paragraphs.forEach((para, pi) => {
      if (pi > 0) open();
      // Words and the spaces between them; by character, every letter.
      const tokens = byChar || span.style.picture ? [...para] : para.match(/ +|[^ ]+/g) || [];
      for (let token of tokens) {
        const space = token[0] === ' ';
        let w = measure(m, token);
        if (limit > 0 && !space && line.pen + w > limit) {
          if (line.frags.some((f) => f.text.trim() !== '')) {
            line.soft = true;
            open();
          }
          // A word longer than a whole line is cut.
          while (measure(m, token) > limit && [...token].length > 1) {
            const chars = [...token];
            let n = chars.length - 1;
            while (n > 1 && measure(m, chars.slice(0, n).join('')) > limit) n--;
            const head = chars.slice(0, n).join('');
            line.frags.push({ text: head, x: line.pen, m, style: span.style, width: measure(m, head) });
            line.width = line.pen + measure(m, head);
            line.soft = true;
            open();
            token = chars.slice(n).join('');
          }
          w = measure(m, token);
        }
        const last = line.frags[line.frags.length - 1];
        if (last && last.style === span.style && !spacing) {
          last.text += token;
          last.width = measure(m, last.text);
          line.pen = last.x + last.width;
        } else {
          line.frags.push({ text: token, x: line.pen, m, style: span.style, width: w });
          line.pen += w;
        }
        if (!space) line.width = line.pen;
      }
    });
  }
  let y = 0;
  let maxWidth = 0;
  let lastHeight = baseM.height;
  for (const l of lines) {
    let height = 0;
    let base = 0;
    let font = 0;
    for (const f of l.frags) {
      height = Math.max(height, f.m.spacing);
      base = Math.max(base, f.m.base);
      font = Math.max(font, f.m.height);
    }
    if (!l.frags.length) { height = baseM.spacing; base = baseM.base; font = baseM.height; }
    l.y = y;
    l.height = height * lineMul;
    l.base = base;
    lastHeight = font;
    y += l.height;
    maxWidth = Math.max(maxWidth, l.width);
  }
  const box = options.limit > 0 ? options.limit : maxWidth;
  for (const l of lines) {
    const align = l.frags[0]?.style.align || (options.blockAlign && !(options.limit > 0) ? 'left' : options.align) || 'left';
    l.x = align === 'center' ? Math.floor((box - l.width) / 2) : align === 'right' ? Math.floor(box - l.width) : 0;
    if (align === 'justify' && l.soft && limit > 0) {
      const gaps = l.frags.filter((f, i) => f.text[0] === ' ' && i > 0 && i < l.frags.length - 1 && l.frags.slice(i + 1).some((g) => g.text.trim() !== ''));
      if (gaps.length) {
        const extra = (limit - l.width) / gaps.length;
        let shift = 0;
        for (const f of l.frags) {
          f.x += shift;
          if (gaps.includes(f)) shift += extra;
        }
        l.width = limit;
      }
    }
  }
  const lastLine = lines[lines.length - 1];
  return { lines, width: maxWidth, height: lastLine.y + lastHeight, count: lines.length };
}
