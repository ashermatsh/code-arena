// Runs a Python submission with Pyodide (CPython compiled to WebAssembly).
// The worker is kept between runs because loading Pyodide takes a few seconds;
// each run still gets a fresh namespace.

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';

const HARNESS = `
import json as _json, time as _time, traceback as _tb

_PRELUDE = """
from typing import *
from collections import *
from functools import *
from itertools import *
from heapq import *
from bisect import *
import collections, functools, itertools, heapq, bisect, math, string, re, random, sys
"""

def _ca_format(e):
    tb = _tb.TracebackException.from_exception(e)
    tb.stack = _tb.StackSummary.from_list([f for f in tb.stack if f.filename == "solution.py"])
    return "".join(tb.format())

class _CaRunner:
    ns = None

    def load(self, code):
        try:
            compiled = compile(code, "solution.py", "exec")
        except SyntaxError as e:
            return "C" + "".join(_tb.format_exception_only(type(e), e))
        ns = {"__name__": "solution"}
        try:
            exec(_PRELUDE, ns)
            exec(compiled, ns)
            if "Solution" not in ns:
                raise NameError("class Solution is not defined")
        except BaseException as e:
            return "E" + _ca_format(e)
        self.ns = ns
        return ""

    def call(self, fn_name, args_json):
        try:
            args = _json.loads(args_json)
            method = getattr(self.ns["Solution"](), fn_name)
            t0 = _time.perf_counter()
            res = method(*args)
            ms = (_time.perf_counter() - t0) * 1000
            return "R" + _json.dumps([ms, res], separators=(",", ":"))
        except BaseException as e:
            return "E" + _ca_format(e)

_ca_runner = _CaRunner()
`;

let ready = null;
let buffer = [];

function boot() {
  if (!ready) {
    postMessage({ type: 'status', text: 'Loading the Python runtime (the first run downloads about 10 MB)…' });
    ready = (async () => {
      importScripts(`${PYODIDE}pyodide.js`);
      const py = await self.loadPyodide({ indexURL: PYODIDE });
      py.setStdout({ batched: (line) => buffer.push(line) });
      py.setStderr({ batched: (line) => buffer.push(line) });
      py.runPython(HARNESS);
      return py;
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

self.onmessage = async ({ data }) => {
  const { code, fnName, tests } = data;
  let py;
  try {
    py = await boot();
  } catch (err) {
    postMessage({ type: 'fatal', message: `Could not load Python in the browser: ${err.message}` });
    return;
  }
  const runner = py.globals.get('_ca_runner');
  try {
    buffer = [];
    const loaded = runner.load(code);
    if (loaded.startsWith('C')) {
      postMessage({ type: 'compile_error', message: loaded.slice(1) });
      return;
    }
    if (loaded.startsWith('E')) {
      postMessage({ type: 'error', index: 0, message: loaded.slice(1), stdout: buffer.join('\n') });
      return;
    }
    for (let i = 0; i < tests.length; i++) {
      buffer = [];
      postMessage({ type: 'start', index: i });
      const out = runner.call(fnName, JSON.stringify(tests[i]));
      if (out.startsWith('E')) {
        postMessage({ type: 'error', index: i, message: out.slice(1), stdout: buffer.join('\n') });
        return;
      }
      const [ms, result] = JSON.parse(out.slice(1));
      postMessage({ type: 'result', index: i, ms, output: JSON.stringify(result), stdout: buffer.join('\n') });
    }
    postMessage({ type: 'done' });
  } finally {
    runner.destroy();
  }
};
