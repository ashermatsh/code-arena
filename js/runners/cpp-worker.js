// Compiles C++ in the browser with Clang/LLD compiled to WebAssembly.
// Long-lived (module) worker: the compiler is downloaded once (about 18 MB,
// cached by the browser) and reused for every compile.
//
// in:  { id, source } or { id, warmup: true }
// out: { id, type: 'ready' } (warm-up done) | { id, type: 'status', text } | { id, type: 'compiled', wasm }
//      | { id, type: 'compile_error', message } | { id, type: 'fatal', message }

import {
  CLANG_URL, CPP_COMPILE_FLAGS, CPP_LINK_FLAGS, STDCPP_HEADER,
} from '../../shared/toolchains.js';

let clangPromise = null;
let pch = null; // precompiled <bits/stdc++.h>, once downloaded
let pchState = 'idle'; // idle | loading | ready | unavailable

function loadClang() {
  if (!clangPromise) {
    clangPromise = import(CLANG_URL).then((m) => m.commands['clang++']).catch((err) => {
      clangPromise = null;
      throw err;
    });
  }
  return clangPromise;
}

// The precompiled header is optional (the static build only ships it when it
// could build it). It downloads in the background; compiles use it once ready.
async function loadPch() {
  if (pchState !== 'idle') return;
  pchState = 'loading';
  try {
    const res = await fetch(new URL('../../cpp/stdc++.pch.gz', import.meta.url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    pch = bytes;
    pchState = 'ready';
  } catch {
    pchState = 'unavailable';
  }
}

function cleanDiagnostics(text) {
  return text
    .replace(/\/tmp\/[\w.-]+\.o/g, 'main.o')
    .replace(/^clang\+\+: error: linker command failed.*$/m, '')
    .trim();
}

async function compile(id, source) {
  const post = (msg) => postMessage({ id, ...msg });
  let firstLoad = clangPromise === null;
  const clangxx = await loadClang();
  loadPch();

  const run = async (usePch) => {
    const files = { 'main.cpp': source, bits: { 'stdc++.h': STDCPP_HEADER } };
    const args = [...CPP_COMPILE_FLAGS];
    if (usePch) {
      files['stdc++.pch'] = pch.slice();
      args.push('-include-pch', 'stdc++.pch');
    }
    args.push(...CPP_LINK_FLAGS, 'main.cpp', '-o', 'main.wasm');
    let stderr = '';
    const decoder = new TextDecoder();
    try {
      const out = await clangxx(args, files, {
        stderr: (bytes) => {
          if (bytes) stderr += decoder.decode(bytes, { stream: true });
        },
        fetchProgress: ({ totalLength, doneLength }) => {
          if (!firstLoad || !totalLength) return;
          const pct = Math.floor((doneLength / totalLength) * 100);
          post({ type: 'status', text: `Downloading the C++ compiler… ${pct}% of ${Math.round(totalLength / 1e6)} MB (only the first time)` });
          if (doneLength >= totalLength) {
            firstLoad = false;
            post({ type: 'status', text: 'Compiling…' });
          }
        },
      });
      return { wasm: out['main.wasm'] };
    } catch (err) {
      if (typeof err.code === 'number') return { error: stderr || `clang exited with code ${err.code}` };
      throw err;
    }
  };

  const usePch = pchState === 'ready';
  let result = await run(usePch);
  if (result.error && usePch && /precompiled|PCH file/i.test(result.error)) {
    pchState = 'unavailable'; // built by a different compiler version: stop using it
    result = await run(false);
  }
  if (result.error) post({ type: 'compile_error', message: cleanDiagnostics(result.error) });
  else post({ type: 'compiled', wasm: result.wasm }, [result.wasm.buffer]);
}

// Downloads the compiler (and the precompiled header) ahead of the first compile.
async function warmUp(id) {
  const clangxx = await loadClang();
  loadPch();
  await clangxx(['--version'], {}, { stdout: () => {}, stderr: () => {} });
  postMessage({ id, type: 'ready' });
}

self.onmessage = ({ data }) => {
  const task = data.warmup ? warmUp(data.id) : compile(data.id, data.source);
  task.catch((err) => {
    postMessage({ id: data.id, type: 'fatal', message: `The C++ compiler could not run: ${err && err.message ? err.message : err}` });
  });
};
