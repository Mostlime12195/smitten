// Finds uses of Smitten's Luau-like syntax in Lua source (README: "Smitten
// syntax"), to tell whether a project still runs on plain LÖVE. A small
// tokenizer, not a parser: it skips comments and strings (long ones too),
// follows backtick strings into their `{}` expressions, and uses the previous
// token to tell `continue` and `if` statements from names and expressions.

const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const SPACE = /[ \t\r\f\v]+/y;
const COMPOUND = new Set(['+=', '-=', '*=', '/=', '%=', '^=', '..=']);
// tokens after which an expression comes (`if` there is an if-expression)
const BEFORE_EXPR = new Set([
  '=', '(', '[', '{', ',', '+', '-', '*', '/', '%', '^', '#', '..', '==', '~=',
  '<', '>', '<=', '>=', 'and', 'or', 'not', 'return', 'in', 'while', 'until',
  'if', 'elseif', ...COMPOUND,
]);
// tokens that can end a statement, so a `continue` after them starts one
const AFTER_CONTINUE = new Set(['end', 'else', 'elseif', 'until', ';', '']);

/**
 * Every use of compound assignment, `continue`, string interpolation and
 * if-expressions, in order: [{ line, feature }], `feature` being one of
 * 'compound-assignment', 'continue', 'interpolation', 'if-expression'.
 */
export function findSmittenSyntax(text) {
  const found = [];
  const tokens = tokenize(text, found);
  // blocks and brackets: '(' '[' '{' 'do' 'function' 'repeat' 'if' (statement), 'ifx' (expression)
  const stack = [];
  let exprAfter = false;  // the previous token is followed by an expression
  for (let i = 0; i < tokens.length; i++) {
    const { s, line } = tokens[i];
    const prev = i > 0 ? tokens[i - 1].s : '';
    let expr = BEFORE_EXPR.has(s);
    switch (s) {
      case 'if':
        if (exprAfter) found.push({ line, feature: 'if-expression' });
        stack.push(exprAfter ? 'ifx' : 'if');
        break;
      case 'then': case 'else': {
        const top = stack[stack.length - 1];
        expr = top === 'ifx';  // in an if-expression a value follows
        if (s === 'else' && top === 'ifx') stack.pop();  // its last part
        break;
      }
      case 'do': case 'function': case 'repeat': case '(': case '[': case '{':
        stack.push(s);
        break;
      case 'end': case 'until':
        while (stack.length && stack.pop() === 'ifx');
        break;
      case ')': case ']': case '}':
        while (stack.length && !'([{'.includes(stack.pop()));
        break;
      case ';':
        expr = stack[stack.length - 1] === '{';  // in a table constructor
        break;
      case 'continue': {
        const next = i + 1 < tokens.length ? tokens[i + 1].s : '';
        if (!exprAfter && !['.', ':', 'goto', 'local', 'function'].includes(prev) &&
            AFTER_CONTINUE.has(next)) {
          found.push({ line, feature: 'continue' });
        }
        break;
      }
      default:
        if (COMPOUND.has(s)) found.push({ line, feature: 'compound-assignment' });
    }
    exprAfter = expr;
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * Lua tokens as { s, line }: names, keywords and operators as themselves,
 * other literals as '<value>'. Backtick strings are recorded in `found` and
 * become '<value>' too, with their `{}` expressions tokenized between `{` and
 * `}` tokens.
 */
function tokenize(text, found) {
  const tokens = [];
  const interp = [];  // per open backtick string: depth of `{` in its current expression
  let i = 0, line = 1;
  const push = (s) => tokens.push({ s, line });
  const newlines = (from, to) => {
    for (let k = from; k < to; k++) if (text[k] === '\n') line++;
  };
  // long bracket at `at` (`[[`, `[==[`): returns its end, or -1 if there is none
  const longBracket = (at) => {
    const open = /\[(=*)\[/y;
    open.lastIndex = at;
    const m = open.exec(text);
    if (!m) return -1;
    const close = `]${m[1]}]`;
    const end = text.indexOf(close, open.lastIndex);
    return end < 0 ? text.length : end + close.length;
  };
  // quoted string (', ", or the text part of `...`) from just after its opening
  // character: returns where it ends and, for backticks, how ('`' or '{')
  const quoted = (from, quote) => {
    let k = from;
    while (k < text.length) {
      const c = text[k];
      if (c === '\\') { k += 2; continue; }
      if (c === quote || c === '\n') return { end: k + 1, how: c };
      if (quote === '`' && c === '{') return { end: k + 1, how: '{' };
      k++;
    }
    return { end: k, how: '' };
  };
  const backtickText = (from) => {
    const { end, how } = quoted(from, '`');
    newlines(from, end);
    i = end;
    if (how === '{') {
      interp[interp.length - 1] = 0;
      push('{');
    }
    else interp.pop();  // closed (or unfinished)
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    SPACE.lastIndex = i;
    if (SPACE.test(text)) { i = SPACE.lastIndex; continue; }
    if (c === '-' && text[i + 1] === '-') {  // comment
      const end = text[i + 2] === '[' ? longBracket(i + 2) : -1;
      if (end >= 0) {
        newlines(i, end);
        i = end;
      }
      else {
        const eol = text.indexOf('\n', i);
        i = eol < 0 ? text.length : eol;
      }
      continue;
    }
    if (c === '[' && (text[i + 1] === '[' || text[i + 1] === '=')) {
      const end = longBracket(i);
      if (end >= 0) { push('<value>'); newlines(i, end); i = end; continue; }
    }
    if (c === '"' || c === "'") {
      push('<value>');
      const { end } = quoted(i + 1, c);
      newlines(i, end);
      i = end;
      continue;
    }
    if (c === '`') {
      found.push({ line, feature: 'interpolation' });
      push('<value>');
      interp.push(-1);
      backtickText(i + 1);
      continue;
    }
    if (interp.length && (c === '{' || c === '}')) {
      const top = interp.length - 1;
      if (c === '{') interp[top]++;
      else if (interp[top]-- === 0) {  // end of the expression: back to the text
        push('}');
        backtickText(i + 1);
        continue;
      }
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      const m = /[0-9.]*(?:[eE][+-]?)?[A-Za-z0-9_]*/y;
      m.lastIndex = i;
      m.exec(text);
      push('<value>');
      i = m.lastIndex;
      continue;
    }
    NAME.lastIndex = i;
    const name = NAME.exec(text);
    if (name) { push(name[0]); i = NAME.lastIndex; continue; }
    const op = ['...', '..=', '..', '==', '~=', '<=', '>=', '::',
      '+=', '-=', '*=', '/=', '%=', '^='].find((o) => text.startsWith(o, i));
    push(op === '...' ? '<value>' : (op ?? c));
    i += op ? op.length : 1;
  }
  return tokens;
}
