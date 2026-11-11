// Runs a compiled C++ program (WebAssembly + WASI) on the test cases.
// A fresh worker is used for every run; the page terminates it when a test
// exceeds the time limit. Speaks the same protocol as js-worker.js.
//
// in:  { wasm, input, mark, count }

import { WASI_SHIM_URL } from '../../shared/toolchains.js';

const TRAPS = [
  [/unreachable/, 'Aborted: abort() was called (for example by a failed assert or an out-of-range .at()).'],
  [/out of bounds/, 'Segmentation fault: invalid memory access.'],
  [/Maximum call stack size exceeded|call stack exhausted/i, 'Stack overflow: the recursion is too deep for the browser.'],
  [/divide by zero/, 'Floating point exception: integer division by zero.'],
  [/integer overflow/, 'Floating point exception: integer overflow in division.'],
  [/memory|allocation failed|Out of memory/i, 'Out of memory.'],
];

function describeTrap(err) {
  const text = `${err && err.message ? err.message : err}`;
  for (const [re, msg] of TRAPS) if (re.test(text)) return msg;
  return text;
}

self.onmessage = async ({ data }) => {
  const { wasm, input, mark, count } = data;
  let shim;
  try {
    shim = await import(WASI_SHIM_URL);
  } catch (err) {
    postMessage({ type: 'fatal', message: `Could not load the WebAssembly runtime: ${err.message}` });
    return;
  }
  const { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory } = shim;
  const encoder = new TextEncoder();
  const outDecoder = new TextDecoder();
  const errDecoder = new TextDecoder();
  const resDecoder = new TextDecoder();

  const needle = `\n${mark}`;
  let current = -1;
  let buffer = ''; // stdout not yet scanned for markers
  let chunk = ''; // stdout of the current test
  let stderr = '';
  let resultText = '';
  let pending = null; // finished result waiting for the rest of its stdout
  const done = new Set();

  const flushPending = () => {
    if (pending) {
      postMessage({ ...pending, stdout: chunk });
      done.add(pending.index);
      pending = null;
    }
  };
  const onStdout = (bytes) => {
    buffer += outDecoder.decode(bytes, { stream: true });
    for (;;) {
      const at = buffer.indexOf(needle);
      if (at === -1) {
        // keep a possible partial marker at the end
        const keep = Math.min(buffer.length, needle.length);
        chunk += buffer.slice(0, buffer.length - keep);
        buffer = buffer.slice(buffer.length - keep);
        return;
      }
      const eol = buffer.indexOf('\n', at + needle.length);
      if (eol === -1) {
        chunk += buffer.slice(0, at);
        buffer = buffer.slice(at);
        return;
      }
      chunk += buffer.slice(0, at);
      flushPending();
      current = Number(buffer.slice(at + needle.length, eol));
      buffer = buffer.slice(eol + 1);
      chunk = '';
      postMessage({ type: 'start', index: current });
    }
  };
  const onResult = (bytes) => {
    resultText += resDecoder.decode(bytes, { stream: true });
    let nl;
    while ((nl = resultText.indexOf('\n')) !== -1) {
      const line = resultText.slice(0, nl);
      resultText = resultText.slice(nl + 1);
      const [i, ms, ...json] = line.split('\t');
      flushPending();
      pending = { type: 'result', index: Number(i), ms: Number(ms), output: json.join('\t') };
    }
  };

  // A file whose writes are reported as they happen, so results stream out
  // test by test (and survive if a later test is stopped for time).
  class StreamFile extends File {
    path_open(...args) {
      const r = super.path_open(...args);
      if (r.fd_obj) {
        const write = r.fd_obj.fd_write.bind(r.fd_obj);
        r.fd_obj.fd_write = (bytes) => {
          onResult(bytes);
          return write(bytes);
        };
      }
      return r;
    }
  }

  const fds = [
    new OpenFile(new File(new Uint8Array(0))),
    new ConsoleStdout(onStdout),
    new ConsoleStdout((bytes) => {
      if (stderr.length < 65536) stderr += errDecoder.decode(bytes, { stream: true });
    }),
    new PreopenDirectory('/', new Map([
      ['input.txt', new File(encoder.encode(input))],
      ['results.txt', new StreamFile(new Uint8Array(0))],
    ])),
  ];
  const wasi = new WASI(['main', 'input.txt', 'results.txt', mark], [], fds, { debug: false });

  let exitCode = 0;
  let trap = null;
  try {
    const { instance } = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: wasi.wasiImport });
    exitCode = wasi.start(instance);
  } catch (err) {
    trap = err;
  }
  chunk += buffer;
  buffer = '';
  flushPending();

  if (trap || exitCode !== 0) {
    const index = current >= 0 && !done.has(current) ? current : Math.min(done.size, count - 1);
    const reason = trap ? describeTrap(trap) : `The program exited with code ${exitCode}.`;
    postMessage({ type: 'error', index, message: [stderr.trim(), reason].filter(Boolean).join('\n'), stdout: chunk });
    return;
  }
  postMessage({ type: 'done' });
};
