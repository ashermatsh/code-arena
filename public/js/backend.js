// Two ways to execute code, behind one interface:
//  - ServerBackend: the judge server (all languages, hidden tests stay private)
//  - BrowserBackend: no server (e.g. GitHub Pages); JavaScript runs in a Web
//    Worker and Python runs in Pyodide. Same grading code as the server.

import { summarize } from '../shared/judging.js';

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
  { id: 'cpp', name: 'C++17', monaco: 'cpp', available: false },
  { id: 'java', name: 'Java', monaco: 'java', available: false },
  { id: 'python', name: 'Python 3', monaco: 'python', timeMultiplier: 6, available: true, worker: 'py-worker.js', reuse: true },
  { id: 'javascript', name: 'JavaScript', monaco: 'javascript', timeMultiplier: 2, available: true, worker: 'js-worker.js', reuse: false },
];
const WATCHDOG_SLACK_MS = 1000;

class WorkerRunner {
  constructor(file, reuse) {
    this.url = new URL(`runners/${file}`, import.meta.url);
    this.reuse = reuse;
    this.worker = null;
  }

  reset() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }

  execute({ code, fnName, tests, perTestMs, onStatus }) {
    if (!this.reuse) this.reset();
    if (!this.worker) this.worker = new Worker(this.url);
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
      worker.postMessage({ code, fnName, tests: tests.map((t) => t.args) });
    });
  }
}

class BrowserBackend {
  constructor() {
    this.mode = 'browser';
    this.languages = BROWSER_LANGUAGES.map(({ worker, reuse, ...rest }) => rest);
    this.runners = Object.fromEntries(
      BROWSER_LANGUAGES.filter((l) => l.available).map((l) => [l.id, new WorkerRunner(l.worker, l.reuse)]),
    );
  }

  async execute(problem, language, code, tests, onStatus) {
    const lang = BROWSER_LANGUAGES.find((l) => l.id === language);
    if (!lang || !lang.available) throw new Error(`${lang ? lang.name : language} needs the judge server.`);
    const perTestMs = Math.round(problem.timeLimitMs * lang.timeMultiplier);
    const raw = await this.runners[language].execute({
      code, fnName: problem.function.name, tests, perTestMs, onStatus,
    });
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
