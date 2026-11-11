// Code generation from a problem's function signature: starter code shown in
// the editor, and the driver ("harness") that reads test inputs, calls the
// user's function and records results for the judge.
//
// Driver protocol (identical in every language):
//   argv: <input file> <results file> <marker>
//   input file: line-based encoding produced by encodeTests()
//   before each test the driver prints "\n<marker><index>\n" to stdout (and
//   flushes), so the judge can time each test and attribute user prints;
//   after each test it appends "<index>\t<milliseconds>\t<json result>\n" to
//   the results file.

import { SUPPORTED_TYPES } from '../shared/judging.js';

const PY_TYPES = {
  int: 'int', long: 'int', double: 'float', boolean: 'bool', string: 'str',
};
const JS_TYPES = {
  int: 'number', long: 'number', double: 'number', boolean: 'boolean', string: 'string',
};
const CPP_TYPES = {
  int: 'int', long: 'long long', double: 'double', boolean: 'bool', string: 'string',
};
const JAVA_TYPES = {
  int: 'int', long: 'long', double: 'double', boolean: 'boolean', string: 'String',
};

function depth(type) {
  let base = type;
  let d = 0;
  while (base.endsWith('[]')) {
    base = base.slice(0, -2);
    d++;
  }
  return { base, d };
}

const pyType = (t) => {
  const { base, d } = depth(t);
  let s = PY_TYPES[base];
  for (let i = 0; i < d; i++) s = `List[${s}]`;
  return s;
};
const jsType = (t) => {
  const { base, d } = depth(t);
  return JS_TYPES[base] + '[]'.repeat(d);
};
const cppType = (t) => {
  const { base, d } = depth(t);
  let s = CPP_TYPES[base];
  for (let i = 0; i < d; i++) s = `vector<${s}>`;
  return s;
};
const javaType = (t) => {
  const { base, d } = depth(t);
  return JAVA_TYPES[base] + '[]'.repeat(d);
};

export function assertSupported(fn) {
  for (const t of [...fn.params.map((p) => p.type), fn.returns]) {
    if (!SUPPORTED_TYPES.includes(t)) throw new Error(`unsupported type "${t}" in ${fn.name}`);
  }
}

// ---------------------------------------------------------------- starter code

export function starterCode(fn) {
  const { name, params, returns } = fn;
  return {
    python: [
      'class Solution:',
      `    def ${name}(self, ${params.map((p) => `${p.name}: ${pyType(p.type)}`).join(', ')}) -> ${pyType(returns)}:`,
      '        pass',
      '',
    ].join('\n'),
    javascript: [
      '/**',
      ...params.map((p) => ` * @param {${jsType(p.type)}} ${p.name}`),
      ` * @return {${jsType(returns)}}`,
      ' */',
      `var ${name} = function(${params.map((p) => p.name).join(', ')}) {`,
      '    ',
      '};',
      '',
    ].join('\n'),
    cpp: [
      'class Solution {',
      'public:',
      `    ${cppType(returns)} ${name}(${params
        .map((p) => (p.type.endsWith('[]') ? `${cppType(p.type)}& ${p.name}` : `${cppType(p.type)} ${p.name}`))
        .join(', ')}) {`,
      '        ',
      '    }',
      '};',
      '',
    ].join('\n'),
    java: [
      'class Solution {',
      `    public ${javaType(returns)} ${name}(${params.map((p) => `${javaType(p.type)} ${p.name}`).join(', ')}) {`,
      '        ',
      '    }',
      '}',
      '',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------- input encoding

function encodeValue(type, value, out) {
  if (type === 'string[]') {
    out.push(String(value.length), ...value);
  } else if (type.endsWith('[][]')) {
    out.push(String(value.length));
    for (const row of value) encodeValue(type.slice(0, -2), row, out);
  } else if (type.endsWith('[]')) {
    out.push(String(value.length), value.map((v) => String(v)).join(' '));
  } else {
    out.push(String(value));
  }
}

export function encodeTests(fn, tests) {
  const out = [String(tests.length)];
  for (const t of tests) fn.params.forEach((p, i) => encodeValue(p.type, t.args[i], out));
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------- python

const PY_PRELUDE = [
  'from typing import *',
  'from collections import *',
  'from functools import *',
  'from itertools import *',
  'from heapq import *',
  'from bisect import *',
  'import collections, functools, itertools, heapq, bisect, math, string, re, random, sys',
].join('\n');

export const PY_CHECK = `import sys, traceback
src = open("solution.py", encoding="utf-8").read()
try:
    compile(src, "solution.py", "exec")
except SyntaxError as e:
    sys.stderr.write("".join(traceback.format_exception_only(type(e), e)))
    sys.exit(1)
`;

export function pythonDriver(fn) {
  return `import json, os, sys, threading, time, traceback

PARAM_TYPES = ${JSON.stringify(fn.params.map((p) => p.type))}
FN_NAME = ${JSON.stringify(fn.name)}
PRELUDE = ${JSON.stringify(PY_PRELUDE)}


class _Reader:
    def __init__(self, path):
        with open(path, encoding="utf-8") as f:
            self.lines = f.read().split("\\n")
        self.i = 0

    def line(self):
        self.i += 1
        return self.lines[self.i - 1]


def _scalar(t, tok):
    if t in ("int", "long"):
        return int(tok)
    if t == "double":
        return float(tok)
    if t == "boolean":
        return tok == "true"
    return tok


def _read(r, t):
    if t == "string[]":
        return [r.line() for _ in range(int(r.line()))]
    if t.endswith("[][]"):
        return [_read(r, t[:-2]) for _ in range(int(r.line()))]
    if t.endswith("[]"):
        n = int(r.line())
        toks = r.line().split()
        return [_scalar(t[:-2], toks[k]) for k in range(n)]
    return _scalar(t, r.line())


def _main():
    in_path, out_path, mark = sys.argv[1], sys.argv[2], sys.argv[3]
    ns = {"__name__": "solution"}
    exec(compile(PRELUDE, "<prelude>", "exec"), ns)
    with open("solution.py", encoding="utf-8") as f:
        exec(compile(f.read(), "solution.py", "exec"), ns)
    if "Solution" not in ns:
        raise NameError("class Solution is not defined")
    r = _Reader(in_path)
    with open(out_path, "w", encoding="utf-8") as out:
        for i in range(int(r.line())):
            args = [_read(r, t) for t in PARAM_TYPES]
            sys.stdout.write("\\n" + mark + str(i) + "\\n")
            sys.stdout.flush()
            method = getattr(ns["Solution"](), FN_NAME)
            t0 = time.perf_counter()
            res = method(*args)
            ms = (time.perf_counter() - t0) * 1000
            out.write("%d\\t%.3f\\t%s\\n" % (i, ms, json.dumps(res, separators=(",", ":"))))
            out.flush()


def _entry():
    try:
        _main()
    except BaseException as e:
        sys.stdout.flush()
        tb = traceback.TracebackException.from_exception(e)
        tb.stack = traceback.StackSummary.from_list(
            [f for f in tb.stack if f.filename == "solution.py"])
        sys.stderr.write("".join(tb.format()))
        sys.stderr.flush()
        os._exit(1)
    sys.stdout.flush()
    os._exit(0)


sys.setrecursionlimit(1_000_000)
threading.stack_size(256 * 1024 * 1024)
_t = threading.Thread(target=_entry)
_t.start()
_t.join()
`;
}

// ---------------------------------------------------------------- javascript

export function javascriptDriver(fn) {
  return `'use strict';
const fs = require('fs');
const vm = require('vm');
const { performance } = require('perf_hooks');

const PARAM_TYPES = ${JSON.stringify(fn.params.map((p) => p.type))};
const FN_NAME = ${JSON.stringify(fn.name)};
const [inPath, outPath, mark] = process.argv.slice(2);

function cleanStack(err) {
  if (!(err instanceof Error) || !err.stack) return String(err);
  return err.stack.split('\\n')
    .filter((l) => !/^\\s+at /.test(l) || l.includes('solution.js'))
    .join('\\n');
}

process.on('uncaughtException', (err) => {
  process.stderr.write(cleanStack(err) + '\\n');
  process.exit(1);
});

globalThis.require = require;
vm.runInThisContext(fs.readFileSync('solution.js', 'utf8'), { filename: 'solution.js' });
const fn = vm.runInThisContext('typeof ' + FN_NAME + " === 'function' ? " + FN_NAME + ' : undefined');
if (typeof fn !== 'function') throw new ReferenceError('function ' + FN_NAME + ' is not defined');

const lines = fs.readFileSync(inPath, 'utf8').split('\\n');
let p = 0;
const scalar = (t, tok) => (t === 'string' ? tok : t === 'boolean' ? tok === 'true' : Number(tok));
function read(t) {
  if (t === 'string[]') {
    const n = Number(lines[p++]);
    return lines.slice(p, (p += n));
  }
  if (t.endsWith('[][]')) {
    const n = Number(lines[p++]);
    const rows = [];
    for (let k = 0; k < n; k++) rows.push(read(t.slice(0, -2)));
    return rows;
  }
  if (t.endsWith('[]')) {
    const n = Number(lines[p++]);
    const line = lines[p++];
    const toks = n ? line.split(' ') : [];
    return toks.map((tok) => scalar(t.slice(0, -2), tok));
  }
  return scalar(t, lines[p++]);
}

const out = fs.openSync(outPath, 'w');
const total = Number(lines[p++]);
for (let i = 0; i < total; i++) {
  const args = PARAM_TYPES.map(read);
  process.stdout.write('\\n' + mark + i + '\\n');
  const t0 = performance.now();
  const res = fn(...args);
  const ms = performance.now() - t0;
  const json = JSON.stringify(res);
  fs.writeSync(out, i + '\\t' + ms.toFixed(3) + '\\t' + (json === undefined ? 'null' : json) + '\\n');
}
fs.closeSync(out);
`;
}

// ---------------------------------------------------------------- c++

export function cppSource(fn, userCode) {
  const decls = fn.params
    .map((p, i) => `    ${cppType(p.type)} a${i}; ca_driver::rd(in, a${i});`)
    .join('\n');
  const call = `sol->${fn.name}(${fn.params.map((_, i) => `a${i}`).join(', ')})`;
  return `#include <bits/stdc++.h>
using namespace std;
#line 1 "solution.cpp"
${userCode}
#line 1 "driver.cpp"
namespace ca_driver {
struct In {
  vector<string> lines;
  size_t p = 0;
  explicit In(const char* path) {
    ifstream f(path, ios::binary);
    string s;
    while (getline(f, s)) lines.push_back(s);
  }
  const string& next() { return lines.at(p++); }
};
template <class T> struct is_vec : false_type {};
template <class T, class A> struct is_vec<vector<T, A>> : true_type {};
inline void parse(const string& s, int& v) { v = stoi(s); }
inline void parse(const string& s, long long& v) { v = stoll(s); }
inline void parse(const string& s, double& v) { v = stod(s); }
inline void parse(const string& s, bool& v) { v = (s == "true"); }
inline void parse(const string& s, string& v) { v = s; }
template <class T> void rd(In& in, T& v) {
  if constexpr (is_vec<T>::value) {
    using E = typename T::value_type;
    size_t n = stoul(in.next());
    v.assign(n, E());
    if constexpr (is_vec<E>::value || is_same_v<E, string>) {
      for (size_t i = 0; i < n; i++) { E e; rd(in, e); v[i] = e; }
    } else {
      istringstream ss(in.next());
      for (size_t i = 0; i < n; i++) { string tok; ss >> tok; E e; parse(tok, e); v[i] = e; }
    }
  } else {
    parse(in.next(), v);
  }
}
inline void wr(string& o, bool v) { o += v ? "true" : "false"; }
inline void wr(string& o, char v) { o += '"'; o += v; o += '"'; }
template <class T> enable_if_t<is_integral_v<T>> wr(string& o, T v) { o += to_string(v); }
template <class T> enable_if_t<is_floating_point_v<T>> wr(string& o, T v) {
  if (!isfinite(v)) { o += "null"; return; }
  char buf[64]; snprintf(buf, sizeof buf, "%.17g", (double)v); o += buf;
}
inline void wr(string& o, const string& s) {
  o += '"';
  for (unsigned char c : s) {
    if (c == '"' || c == '\\\\') { o += '\\\\'; o += (char)c; }
    else if (c < 0x20) { char buf[8]; snprintf(buf, sizeof buf, "\\\\u%04x", c); o += buf; }
    else o += (char)c;
  }
  o += '"';
}
inline void wr(string& o, const char* s) { wr(o, string(s)); }
template <class T, class A> void wr(string& o, const vector<T, A>& v) {
  o += '[';
  for (size_t i = 0; i < v.size(); i++) { if (i) o += ','; wr(o, static_cast<T>(v[i])); }
  o += ']';
}
}  // namespace ca_driver

int main(int argc, char** argv) {
  if (argc < 4) return 2;
  ca_driver::In in(argv[1]);
  FILE* out = fopen(argv[2], "w");
  const string mark = argv[3];
  const int total = stoi(in.next());
  for (int i = 0; i < total; i++) {
${decls}
    fflush(stdout);
    cout << "\\n" << mark << i << "\\n" << flush;
    Solution* sol = new Solution();
    auto t0 = chrono::steady_clock::now();
    auto res = ${call};
    auto t1 = chrono::steady_clock::now();
    string js;
    ca_driver::wr(js, res);
    fprintf(out, "%d\\t%.3f\\t%s\\n", i, chrono::duration<double, milli>(t1 - t0).count(), js.c_str());
    fflush(out);
  }
  fflush(stdout);
  cout << flush;
  fclose(out);
  return 0;
}
`;
}

// ---------------------------------------------------------------- java

const JAVA_READERS = {
  int: 'Integer.parseInt(next())',
  long: 'Long.parseLong(next())',
  double: 'Double.parseDouble(next())',
  boolean: 'next().equals("true")',
  string: 'next()',
  'int[]': 'readIntArray()',
  'long[]': 'readLongArray()',
  'double[]': 'readDoubleArray()',
  'boolean[]': 'readBooleanArray()',
  'string[]': 'readStringArray()',
  'int[][]': 'readIntMatrix()',
};

// Imports are prepended on the user's first line so compiler line numbers match the editor.
export const JAVA_IMPORTS = 'import java.util.*; import java.util.function.*; import java.util.stream.*; import java.math.*; ';

export function javaDriver(fn) {
  const decls = fn.params
    .map((p, i) => `            ${javaType(p.type)} a${i} = ${JAVA_READERS[p.type]};`)
    .join('\n');
  const call = `sol.${fn.name}(${fn.params.map((_, i) => `a${i}`).join(', ')})`;
  return `import java.io.*;
import java.lang.reflect.Array;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class Main {
    static String[] lines;
    static int p = 0;

    static String next() { return lines[p++]; }
    static String[] tokens(int n) { String line = next(); return n == 0 ? new String[0] : line.split(" "); }
    static int[] readIntArray() { int n = Integer.parseInt(next()); String[] t = tokens(n); int[] a = new int[n]; for (int i = 0; i < n; i++) a[i] = Integer.parseInt(t[i]); return a; }
    static long[] readLongArray() { int n = Integer.parseInt(next()); String[] t = tokens(n); long[] a = new long[n]; for (int i = 0; i < n; i++) a[i] = Long.parseLong(t[i]); return a; }
    static double[] readDoubleArray() { int n = Integer.parseInt(next()); String[] t = tokens(n); double[] a = new double[n]; for (int i = 0; i < n; i++) a[i] = Double.parseDouble(t[i]); return a; }
    static boolean[] readBooleanArray() { int n = Integer.parseInt(next()); String[] t = tokens(n); boolean[] a = new boolean[n]; for (int i = 0; i < n; i++) a[i] = t[i].equals("true"); return a; }
    static String[] readStringArray() { int n = Integer.parseInt(next()); String[] a = new String[n]; for (int i = 0; i < n; i++) a[i] = next(); return a; }
    static int[][] readIntMatrix() { int n = Integer.parseInt(next()); int[][] a = new int[n][]; for (int i = 0; i < n; i++) a[i] = readIntArray(); return a; }

    static void write(StringBuilder sb, Object o) {
        if (o == null) { sb.append("null"); return; }
        if (o instanceof Double || o instanceof Float) {
            double d = ((Number) o).doubleValue();
            sb.append(Double.isFinite(d) ? Double.toString(d) : "null");
        } else if (o instanceof Number || o instanceof Boolean) {
            sb.append(o);
        } else if (o instanceof CharSequence || o instanceof Character) {
            sb.append('"');
            for (char c : o.toString().toCharArray()) {
                if (c == '"' || c == '\\\\') sb.append('\\\\').append(c);
                else if (c < 0x20) sb.append(String.format("\\\\u%04x", (int) c));
                else sb.append(c);
            }
            sb.append('"');
        } else if (o.getClass().isArray()) {
            sb.append('[');
            int n = Array.getLength(o);
            for (int i = 0; i < n; i++) { if (i > 0) sb.append(','); write(sb, Array.get(o, i)); }
            sb.append(']');
        } else if (o instanceof Iterable) {
            sb.append('[');
            boolean first = true;
            for (Object x : (Iterable<?>) o) { if (!first) sb.append(','); first = false; write(sb, x); }
            sb.append(']');
        } else {
            sb.append('"').append(o).append('"');
        }
    }

    static void printTrace(Throwable e) {
        System.err.println("Exception in thread \\"main\\" " + e);
        int shown = 0;
        for (StackTraceElement el : e.getStackTrace()) {
            if (el.getClassName().equals("Main")) break;
            if (shown++ == 40) { System.err.println("\\t..."); break; }
            System.err.println("\\tat " + el);
        }
    }

    static void run(String[] argv) throws Exception {
        lines = new String(Files.readAllBytes(Paths.get(argv[0])), StandardCharsets.UTF_8).split("\\n", -1);
        PrintStream out = new PrintStream(new FileOutputStream(argv[1]), false, "UTF-8");
        String mark = argv[2];
        int total = Integer.parseInt(next());
        for (int i = 0; i < total; i++) {
${decls}
            System.out.print("\\n" + mark + i + "\\n");
            System.out.flush();
            Solution sol = new Solution();
            long t0 = System.nanoTime();
            Object res = ${call};
            long t1 = System.nanoTime();
            StringBuilder sb = new StringBuilder();
            write(sb, res);
            out.print(i + "\\t" + String.format(Locale.ROOT, "%.3f", (t1 - t0) / 1e6) + "\\t" + sb + "\\n");
            out.flush();
        }
        out.close();
    }

    public static void main(String[] args) throws Exception {
        Thread t = new Thread(null, () -> {
            try {
                run(args);
            } catch (Throwable e) {
                System.out.flush();
                printTrace(e);
                System.err.flush();
                Runtime.getRuntime().halt(1);
            }
        }, "main", 512L << 20);
        t.start();
        t.join();
        System.out.flush();
        System.exit(0);
    }
}
`;
}
