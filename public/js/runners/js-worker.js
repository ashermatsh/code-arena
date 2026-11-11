// Runs a JavaScript submission inside a Web Worker. A fresh worker is used for
// every run, and the page terminates it if a test exceeds the time limit.

let logs = [];

function show(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
  console[method] = (...args) => {
    logs.push(args.map(show).join(' '));
  };
}

function describe(err) {
  if (!(err instanceof Error)) return String(err);
  const frames = (err.stack || '').split('\n').filter((l) => l.includes('solution.js'));
  return [`${err.name}: ${err.message}`, ...frames.map((l) => `    ${l.trim()}`)].join('\n');
}

self.onmessage = ({ data }) => {
  const { code, fnName, tests } = data;
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
  } catch (err) {
    if (err instanceof SyntaxError) {
      postMessage({ type: 'compile_error', message: `SyntaxError: ${err.message}` });
      return;
    }
  }

  let fn;
  try {
    // Indirect eval runs the code as a global script, like the server driver does.
    fn = (0, eval)(`${code}\n;(typeof ${fnName} === 'function' ? ${fnName} : undefined)\n//# sourceURL=solution.js`);
    if (typeof fn !== 'function') throw new ReferenceError(`function ${fnName} is not defined`);
  } catch (err) {
    postMessage({ type: 'error', index: 0, message: describe(err), stdout: logs.join('\n') });
    return;
  }

  for (let i = 0; i < tests.length; i++) {
    logs = [];
    postMessage({ type: 'start', index: i });
    let result;
    let ms;
    try {
      const t0 = performance.now();
      result = fn(...tests[i]);
      ms = performance.now() - t0;
    } catch (err) {
      postMessage({ type: 'error', index: i, message: describe(err), stdout: logs.join('\n') });
      return;
    }
    let output;
    try {
      output = JSON.stringify(result);
    } catch (err) {
      postMessage({ type: 'error', index: i, message: `Could not serialize the return value: ${err.message}`, stdout: logs.join('\n') });
      return;
    }
    postMessage({ type: 'result', index: i, ms, output: output === undefined ? 'null' : output, stdout: logs.join('\n') });
  }
  postMessage({ type: 'done' });
};
