// Inserts time-limit checks into Java source so code running in the browser's
// Java runtime (which cannot be interrupted from outside) can stop itself.
//
//   while (cond)          ->  while (__ca.t() && (cond))
//   for (init; cond; up)  ->  for (init; __ca.t() && (cond); up)
//   while (true) { ... }  ->  while (true) { __ca.t(); ... }   (keeps flow analysis)
//   do { ... }            ->  do { __ca.t(); ... }
//   method body { ... }   ->  { __ca.t(); ... }                 (catches deep recursion)
//
// Nothing is inserted on new lines, so compiler line numbers stay correct.
// `insertions` lets callers map columns back to the original source.

const TICK = '__ca.t()';
const KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
  'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if',
  'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private',
  'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
  'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null', 'record',
  'yield', 'var', 'sealed', 'permits',
]);
const TYPE_DECL = new Set(['class', 'interface', 'enum', 'record']);

function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === '"' && src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      let j = end === -1 ? n : end + 3;
      // a text block may end with escaped quotes (\""") — extend past them
      while (end !== -1 && src[j - 4] === '\\') {
        const next = src.indexOf('"""', j);
        if (next === -1) { j = n; break; }
        j = next + 3;
      }
      toks.push({ t: 'str', s: i, e: j });
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      toks.push({ t: 'str', s: i, e: j + 1 });
      i = j + 1;
    } else if (/[A-Za-z_$\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$\u0080-￿]/.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j), s: i, e: j });
      i = j;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) {
        if ((src[j] === 'e' || src[j] === 'E' || src[j] === 'p' || src[j] === 'P') && (src[j + 1] === '+' || src[j + 1] === '-')) j++;
        j++;
      }
      toks.push({ t: 'num', s: i, e: j });
      i = j;
    } else if (c === '-' && src[i + 1] === '>') {
      toks.push({ t: 'op', v: '->', s: i, e: i + 2 });
      i += 2;
    } else {
      toks.push({ t: 'op', v: c, s: i, e: i + 1 });
      i++;
    }
  }
  return toks;
}

const isWord = (tok, word) => tok && tok.t === 'id' && tok.v === word;
const isOp = (tok, op) => tok && tok.t === 'op' && tok.v === op;

export function instrumentJava(src) {
  const toks = tokenize(src);
  const inserts = [];
  const add = (pos, text) => inserts.push({ pos, text });

  // Matching brackets: open index -> close index and back.
  const match = new Map();
  const stack = [];
  const PAIRS = { ')': '(', ']': '[', '}': '{' };
  toks.forEach((tok, k) => {
    if (tok.t !== 'op') return;
    if (tok.v === '(' || tok.v === '[' || tok.v === '{') stack.push(k);
    else if (PAIRS[tok.v]) {
      // skip unmatched closers rather than corrupting the map (code with syntax errors)
      for (let d = stack.length - 1; d >= 0; d--) {
        if (toks[stack[d]].v === PAIRS[tok.v]) {
          const open = stack[d];
          stack.length = d;
          match.set(open, k);
          match.set(k, open);
          break;
        }
      }
    }
  });

  // Inserts a tick at the start of the statement at toks[k] (a loop body).
  const tickBody = (k) => {
    const tok = toks[k];
    if (!tok) return;
    if (isOp(tok, '{')) {
      add(tok.e, ` ${TICK};`);
      return;
    }
    // Single-statement body: wrap simple statements; leave compound ones alone
    // (their own loops get instrumented).
    if (tok.t === 'id' && ['if', 'for', 'while', 'do', 'switch', 'try', 'synchronized'].includes(tok.v)) return;
    let j = k;
    while (j < toks.length && !isOp(toks[j], ';')) {
      if (match.has(j) && ['(', '[', '{'].includes(toks[j].v)) j = match.get(j);
      j++;
    }
    if (j >= toks.length) return;
    add(tok.s, `{ ${TICK}; `);
    add(toks[j].e, ' }');
  };

  const isTrueCond = (from, to) => to - from === 1 && isWord(toks[from], 'true');

  toks.forEach((tok, k) => {
    if (tok.t !== 'id') return;
    if ((tok.v === 'while' || tok.v === 'for') && isOp(toks[k + 1], '(') && match.has(k + 1)) {
      const open = k + 1;
      const close = match.get(open);
      const doWhileTail = tok.v === 'while' && isOp(toks[close + 1], ';') && isOp(toks[k - 1], '}');
      if (tok.v === 'while') {
        if (isTrueCond(open + 1, close)) {
          if (!doWhileTail) tickBody(close + 1);
        } else {
          add(toks[open].e, `${TICK} && (`);
          add(toks[close].s, ')');
        }
        return;
      }
      // for: find the two top-level semicolons of a classic for header
      const semis = [];
      for (let j = open + 1; j < close; j++) {
        if (match.has(j) && ['(', '[', '{'].includes(toks[j].v)) j = match.get(j);
        else if (isOp(toks[j], ';')) semis.push(j);
      }
      if (semis.length !== 2) return; // enhanced for: iterates a finite collection
      const [s1, s2] = semis;
      if (s2 === s1 + 1 || isTrueCond(s1 + 1, s2)) {
        tickBody(close + 1);
      } else {
        add(toks[s1].e, ` ${TICK} && (`);
        add(toks[s2].s, ')');
      }
    } else if (tok.v === 'do' && isOp(toks[k + 1], '{')) {
      tickBody(k + 1);
    }
  });

  // Method bodies (not constructors: their first statement may be super(...)).
  const contexts = []; // for each open '{': { kind: 'type' | 'other', name }
  const typeName = (k) => {
    // `{` at k: is this a class/interface/enum/record body? Look back for the keyword.
    for (let j = k - 1, depth = 0; j >= 0 && k - j < 200; j--) {
      const t = toks[j];
      if (t.t === 'op' && (t.v === '>' || t.v === ')')) depth++;
      else if (t.t === 'op' && (t.v === '<' || t.v === '(')) depth--;
      else if (depth === 0 && t.t === 'op' && (t.v === ';' || t.v === '{' || t.v === '}' || t.v === '=')) return null;
      else if (depth === 0 && t.t === 'id' && TYPE_DECL.has(t.v) && toks[j + 1] && toks[j + 1].t === 'id') {
        if (t.v === 'record' && !(isOp(toks[j + 2], '(') || isOp(toks[j + 2], '<'))) continue;
        return toks[j + 1].v;
      }
    }
    return null;
  };
  const isAnonymousClassBody = (k) => {
    if (!isOp(toks[k - 1], ')') || !match.has(k - 1)) return false;
    let j = match.get(k - 1) - 1;
    if (isOp(toks[j], '>')) {
      // skip type arguments: new Comparator<Integer>() { ... }
      for (let depth = 0; j > 0; j--) {
        if (isOp(toks[j], '>')) depth++;
        else if (isOp(toks[j], '<') && --depth === 0) break;
      }
      j--;
    }
    while (j > 0 && toks[j].t === 'id' && isOp(toks[j - 1], '.')) j -= 2;
    return toks[j] && toks[j].t === 'id' && isWord(toks[j - 1], 'new');
  };
  const methodName = (k) => {
    // `{` at k preceded by `name(...)` or `name(...) throws A, B.C`
    let j = k - 1;
    if (toks[j] && toks[j].t === 'id' && !KEYWORDS.has(toks[j].v)) {
      while (j > 0 && !isWord(toks[j], 'throws')) {
        if (toks[j].t === 'id' || isOp(toks[j], '.') || isOp(toks[j], ',') || isOp(toks[j], '<') || isOp(toks[j], '>')) j--;
        else return null;
      }
      j--;
    }
    if (!isOp(toks[j], ')') || !match.has(j)) return null;
    const nameTok = toks[match.get(j) - 1];
    if (!nameTok || nameTok.t !== 'id' || KEYWORDS.has(nameTok.v)) return null;
    const before = toks[match.get(j) - 2];
    if (isWord(before, 'new') || isOp(before, '.')) return null;
    return nameTok.v;
  };

  toks.forEach((tok, k) => {
    if (isOp(tok, '{')) {
      const parent = contexts[contexts.length - 1];
      const name = typeName(k);
      if (name || isAnonymousClassBody(k)) {
        contexts.push({ kind: 'type', name });
        return;
      }
      if (parent && parent.kind === 'type') {
        const m = methodName(k);
        if (m && m !== parent.name) add(tok.e, ` ${TICK};`);
      }
      contexts.push({ kind: 'other' });
    } else if (isOp(tok, '}')) {
      contexts.pop();
    }
  });

  inserts.sort((a, b) => a.pos - b.pos);
  let out = '';
  let last = 0;
  for (const ins of inserts) {
    out += src.slice(last, ins.pos) + ins.text;
    last = ins.pos;
  }
  out += src.slice(last);
  return { code: out, insertions: inserts };
}

// Maps a 1-based column on a line of the instrumented code back to the
// original column. `lineStart` is the offset of that line in the original.
export function originalColumn(insertions, lineStart, lineEnd, column) {
  let shift = 0;
  let col = column - 1;
  for (const ins of insertions) {
    if (ins.pos < lineStart || ins.pos > lineEnd) continue;
    const at = ins.pos - lineStart + shift;
    if (col < at) break;
    if (col < at + ins.text.length) return ins.pos - lineStart + 1;
    shift += ins.text.length;
  }
  return col - shift + 1;
}
