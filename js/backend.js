// Two ways to execute code, behind one interface:
//  - ServerBackend: the judge server (hidden tests stay private)
//  - BrowserBackend: no server (e.g. GitHub Pages). Everything runs in the
//    browser: JavaScript in a Web Worker, Python in Pyodide, C++ with Clang
//    compiled to WebAssembly, and Java in CheerpJ. Same grading as the server.

import { instrumentJava, originalColumn } from '../shared/java-instrument.js';
import { encodeTests, summarize } from '../shared/judging.js';
import { USER_CODE_PLACEHOLDER } from '../shared/toolchains.js';

const referenceCache = new Map();

export function loadReference(slug) {
  if (!referenceCache.has(slug)) {
    const url = new URL(`data/problems/${slug}/reference.mjs`, document.baseURI).href;
    referenceCache.set(slug, import(url).catch((err) => {
      referenceCache.delete(slug);
      throw err;
    }));
  }
  return referenceCache.get(slug);
}

export async function detectBackend() {
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    if (res.ok) {
      const health = await res.json();
      if (health.mode === 'server') return new ServerBackend(health.languages);
    }
  } catch {
    // no server: fall through to browser mode
  }
  return new BrowserBackend();
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The judge returned HTTP ${res.status}`);
  return data;
}

class ServerBackend {
  constructor(languages) {
    this.mode = 'server';
    this.languages = languages;
  }

  run(problem, language, code, cases) {
    return post('api/run', { slug: problem.slug, language, code, cases });
  }

  submit(problem, language, code) {
    return post('api/submit', { slug: problem.slug, language, code });
  }
}

// ------------------------------------------------------------------ browser

const BROWSER_LANGUAGES = [
  { id: 'cpp', name: 'C++17', monaco: 'cpp', timeMultiplier: 2, available: true },
  { id: 'java', name: 'Java', monaco: 'java', timeMultiplier: 3, available: true },
  { id: 'python', name: 'Python 3', monaco: 'python', timeMultiplier: 6, available: true },
  { id: 'javascript', name: 'JavaScript', monaco: 'javascript', timeMultiplier: 2, available: true },
];
const WATCHDOG_SLACK_MS = 1000;
const newMark = () => `@@CA-${Math.random().toString(36).slice(2, 10)}@@`;

// Runs code in a Web Worker that reports per-test progress
// (start / result / error / done), and terminates it on a time-out.
class WorkerRunner {
  constructor(file, { reuse = false, module = false } = {}) {
    this.url = new URL(`runners/${file}`, import.meta.url);
    this.reuse = reuse;
    this.options = module ? { type: 'module' } : undefined;
    this.worker = null;
  }

  reset() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }

  execute({ payload, tests, perTestMs, onStatus }) {
    if (!this.reuse) this.reset();
    if (!this.worker) this.worker = new Worker(this.url, this.options);
    const worker = this.worker;
    const outcomes = tests.map(() => ({ state: 'skipped' }));
    let current = -1;
    let timer = null;

    return new Promise((resolve) => {
      const finish = (extra = {}) => {
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        resolve({ outcomes, perTestMs, ...extra });
      };
      worker.onmessage = ({ data: m }) => {
        switch (m.type) {
          case 'status':
            onStatus?.(m.text);
            break;
          case 'compile_error':
            finish({ compileError: m.message });
            break;
          case 'start':
            current = m.index;
            onStatus?.(`Running test ${m.index + 1} of ${tests.length}…`);
            clearTimeout(timer);
            timer = setTimeout(() => {
              outcomes[m.index] = { state: 'tle', stdout: '' };
              this.reset();
              finish();
            }, perTestMs + WATCHDOG_SLACK_MS);
            break;
          case 'result':
            clearTimeout(timer);
            outcomes[m.index] = { state: 'done', ms: m.ms, output: JSON.parse(m.output), stdout: m.stdout };
            break;
          case 'error':
            clearTimeout(timer);
            outcomes[m.index] = { state: 'error', stdout: m.stdout || '' };
            finish({ errorText: m.message });
            break;
          case 'fatal':
            this.reset();
            finish({ fatal: m.message });
            break;
          case 'done':
            finish();
            break;
          default:
            break;
        }
      };
      worker.onerror = (e) => {
        e.preventDefault();
        if (current >= 0) outcomes[current] = { state: 'error', stdout: '' };
        this.reset();
        finish({ errorText: e.message || 'The worker crashed.' });
      };
      worker.postMessage(payload);
    });
  }
}

// C++: a long-lived worker holds the compiler; each run executes the program
// in a fresh worker so a runaway test can be terminated.
class CppRunner {
  constructor() {
    this.compiler = null;
    this.waiting = new Map();
    this.nextId = 0;
    this.warm = false;
    this.programs = new WorkerRunner('wasi-worker.js', { module: true });
  }

  compilerWorker() {
    if (!this.compiler) {
      this.compiler = new Worker(new URL('runners/cpp-worker.js', import.meta.url), { type: 'module' });
      this.compiler.onmessage = ({ data }) => {
        const waiter = this.waiting.get(data.id);
        if (!waiter) return;
        if (data.type === 'status') {
          waiter.onStatus?.(data.text);
        } else {
          this.waiting.delete(data.id);
          waiter.resolve(data);
        }
      };
      this.compiler.onerror = (e) => {
        e.preventDefault();
        for (const w of this.waiting.values()) w.resolve({ type: 'fatal', message: e.message || 'The C++ compiler crashed.' });
        this.waiting.clear();
        this.compiler.terminate();
        this.compiler = null;
      };
    }
    return this.compiler;
  }

  // Start downloading the compiler as soon as C++ is selected.
  prepare() {
    if (this.prepared) return;
    this.prepared = true;
    const id = ++this.nextId;
    this.waiting.set(id, {
      resolve: (m) => {
        if (m.type === 'ready') this.warm = true;
        else this.prepared = false;
      },
    });
    this.compilerWorker().postMessage({ id, warmup: true });
  }

  compile(source, onStatus) {
    const id = ++this.nextId;
    return new Promise((resolve) => {
      this.waiting.set(id, { resolve, onStatus });
      this.compilerWorker().postMessage({ id, source });
    });
  }

  async execute({ problem, code, tests, perTestMs, onStatus }) {
    onStatus?.(this.warm ? 'Compiling…' : 'Loading the C++ compiler…');
    const source = problem.browser.cpp.replace(USER_CODE_PLACEHOLDER, () => code);
    const compiled = await this.compile(source, onStatus);
    if (compiled.type === 'fatal') throw new Error(compiled.message);
    if (compiled.type === 'compile_error') return { compileError: compiled.message, outcomes: [], perTestMs };
    this.warm = true;
    onStatus?.('Running…');
    return this.programs.execute({
      payload: { wasm: compiled.wasm, input: encodeTests(problem.function, tests), mark: newMark(), count: tests.length },
      tests,
      perTestMs,
      onStatus,
    });
  }
}

// javac output refers to the instrumented source; show the user's own lines
// and move the caret back to the matching column.
function cleanJavacOutput(text, srcDir, original, insertions) {
  const lines = text.split(`${srcDir}/`).join('').replace(/\s+$/, '').split('\n');
  const origLines = original.split('\n');
  const starts = [];
  let offset = 0;
  for (const l of origLines) {
    starts.push(offset);
    offset += l.length + 1;
  }
  const out = [];
  for (let k = 0; k < lines.length; k++) {
    out.push(lines[k]);
    const m = lines[k].match(/^Solution\.java:(\d+): /);
    if (m && /^\s*\^\s*$/.test(lines[k + 2] || '')) {
      const n = Number(m[1]) - 1;
      if (n >= 0 && n < origLines.length) {
        const caret = lines[k + 2].indexOf('^') + 1;
        const col = originalColumn(insertions, starts[n], starts[n] + origLines[n].length, caret);
        out.push(origLines[n], `${' '.repeat(Math.max(0, col - 1))}^`);
        k += 2;
      }
    }
  }
  return out.join('\n');
}

// Splits the Java console (stdout + stderr) and results file into per-test outcomes.
function parseJavaRun({ console: text, results, exitCode }, tests, mark) {
  const outcomes = tests.map(() => ({ state: 'skipped' }));
  for (const line of results.split('\n')) {
    if (!line) continue;
    const [i, ms, ...json] = line.split('\t');
    let output = null;
    try {
      output = JSON.parse(json.join('\t'));
    } catch {
      // unparseable output counts as wrong
    }
    outcomes[Number(i)] = { state: 'done', ms: Number(ms), output };
  }
  const stdout = tests.map(() => '');
  const parts = text.split(`\n${mark}`);
  let current = -1;
  let tle = false;
  for (const part of parts.slice(1)) {
    const eol = part.indexOf('\n');
    const tag = eol === -1 ? part : part.slice(0, eol);
    const body = eol === -1 ? '' : part.slice(eol + 1);
    if (tag === 'TLE') tle = true;
    else if (/^\d+$/.test(tag) && Number(tag) < tests.length) {
      current = Number(tag);
      stdout[current] = body;
    }
  }
  let errorText = '';
  if (current >= 0) {
    const at = stdout[current].indexOf('Exception in thread "main"');
    if (at !== -1) {
      errorText = stdout[current].slice(at).trim();
      stdout[current] = stdout[current].slice(0, at);
    }
  } else {
    // failed before the first test (e.g. in a static initializer)
    errorText = parts[0].trim();
  }
  if (tests.length && current < 1) stdout[0] = (current < 0 ? '' : parts[0]) + stdout[0];
  tests.forEach((_, i) => {
    if (outcomes[i].state === 'done') outcomes[i].stdout = stdout[i];
  });
  const failedAt = Math.max(current, 0);
  if (tests.length && outcomes[failedAt].state !== 'done') {
    outcomes[failedAt] = { state: tle ? 'tle' : 'error', stdout: stdout[failedAt] };
    if (!tle && !errorText) {
      errorText = exitCode ? `The program exited with code ${exitCode}.` : 'The program stopped before returning a result.';
    }
  }
  return { outcomes, errorText };
}

// Java: CheerpJ runs in a hidden frame. It blocks the page while Java code
// runs, so the user's code is instrumented to stop itself at the time limit.
class JavaRunner {
  constructor() {
    this.frame = null;
    this.ready = null;
    this.runs = 0;
    this.warm = false;
    this.queue = Promise.resolve(); // CheerpJ runs one program at a time
  }

  reset() {
    this.frame?.remove();
    this.frame = null;
    this.ready = null;
    this.warm = false;
  }

  enqueue(task) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  // Start the JVM and warm up javac (its first compile is slow) as soon as
  // Java is selected, while the user is still writing code.
  prepare() {
    if (this.warm || this.warming) return;
    this.warming = true;
    this.enqueue(async () => {
      try {
        const win = await this.start();
        await win.javaWarmUp();
        this.warm = true;
      } catch {
        // the real run will report the problem
      } finally {
        this.warming = false;
      }
    });
  }

  start() {
    if (!this.ready) {
      const frame = document.createElement('iframe');
      frame.title = 'Java runtime';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:10px;height:10px;border:0;visibility:hidden';
      frame.src = new URL('runners/java-frame.html', import.meta.url).href;
      this.frame = frame;
      this.ready = new Promise((resolve, reject) => {
        frame.onload = () => frame.contentWindow.javaReady.then(() => resolve(frame.contentWindow), reject);
        frame.onerror = () => reject(new Error('Could not load the Java runtime frame.'));
      });
      this.ready.catch(() => this.reset());
      document.body.appendChild(frame);
    }
    return this.ready;
  }

  execute(args) {
    if (this.warming) args.onStatus?.('Starting Java (the first run downloads the Java runtime)…');
    return this.enqueue(() => this.run(args));
  }

  async run({ problem, code, tests, perTestMs, onStatus }) {
    if (!this.ready) onStatus?.('Starting Java (the first run downloads the Java runtime)…');
    let win;
    try {
      win = await this.start();
    } catch (err) {
      throw new Error(`Could not start Java in the browser: ${err.message || err}`);
    }
    const { code: instrumented, insertions } = instrumentJava(code);
    const prefix = problem.browser.javaImports;
    const mark = newMark();
    const firstCompile = !this.warm;
    const job = {
      main: problem.browser.java,
      solution: prefix + instrumented,
      input: encodeTests(problem.function, tests),
      mark,
      limitMs: perTestMs,
      runId: ++this.runs,
      onStatus: (text) => onStatus?.(text === 'Compiling…' && firstCompile
        ? 'Compiling… (the first Java compile takes about 15 seconds while the compiler warms up)'
        : text),
    };
    // Last resort if the JVM gets stuck somewhere the instrumentation can't
    // reach: when the page regains control, discard the frame.
    const budget = 120_000 + tests.length * (perTestMs + 1000);
    let timer;
    const stuck = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ stuck: true }), budget);
    });
    const r = await Promise.race([win.javaJob(job), stuck]);
    clearTimeout(timer);
    if (r.stuck) {
      const consoleText = this.frame?.contentDocument?.getElementById('console')?.textContent || '';
      this.reset();
      const parsed = parseJavaRun({ console: consoleText, results: '', exitCode: 0 }, tests, mark);
      const failedAt = Math.max(0, parsed.outcomes.findIndex((o) => o.state !== 'done'));
      parsed.outcomes[failedAt] = { state: 'tle', stdout: '' };
      return { outcomes: parsed.outcomes, perTestMs };
    }
    this.warm = true;
    if (r.compileError != null) {
      const all = [{ pos: 0, text: prefix }, ...insertions];
      return { compileError: cleanJavacOutput(r.compileError, r.srcDir, code, all), outcomes: [], perTestMs };
    }
    return { ...parseJavaRun(r, tests, mark), perTestMs };
  }
}

class BrowserBackend {
  constructor() {
    this.mode = 'browser';
    this.languages = BROWSER_LANGUAGES;
    this.runners = {
      javascript: new WorkerRunner('js-worker.js'),
      python: new WorkerRunner('py-worker.js', { reuse: true }),
      cpp: new CppRunner(),
      java: new JavaRunner(),
    };
  }

  // Called when a language is selected, so slow toolchains load in the background.
  prepare(language) {
    this.runners[language]?.prepare?.();
  }

  async execute(problem, language, code, tests, onStatus) {
    const lang = BROWSER_LANGUAGES.find((l) => l.id === language);
    if (!lang) throw new Error(`Unknown language: ${language}`);
    const perTestMs = Math.round(problem.timeLimitMs * lang.timeMultiplier);
    const runner = this.runners[language];
    let raw;
    if (language === 'cpp' || language === 'java') {
      if (!problem.browser) throw new Error(`${lang.name} needs files from the static build (npm run build:static).`);
      raw = await runner.execute({ problem, code, tests, perTestMs, onStatus });
    } else {
      raw = await runner.execute({
        payload: { code, fnName: problem.function.name, tests: tests.map((t) => t.args) },
        tests,
        perTestMs,
        onStatus,
      });
    }
    if (raw.fatal) throw new Error(raw.fatal);
    return raw;
  }

  async run(problem, language, code, cases, onStatus) {
    const reference = await loadReference(problem.slug);
    const tests = cases.map((c) => ({ args: c.args, expected: reference.solve(...c.args) }));
    const raw = await this.execute(problem, language, code, tests, onStatus);
    return summarize({ problem, tests, mode: 'run', limitMs: raw.perTestMs, ...raw });
  }

  async submit(problem, language, code, onStatus) {
    onStatus?.('Loading test cases…');
    const res = await fetch(`data/problems/${problem.slug}/hidden.json`);
    if (!res.ok) throw new Error('Could not load the hidden test cases.');
    const tests = [...problem.samples, ...(await res.json())];
    const raw = await this.execute(problem, language, code, tests, onStatus);
    return summarize({
      problem, tests, mode: 'submit', limitMs: raw.perTestMs, sampleCount: problem.samples.length, ...raw,
    });
  }
}
