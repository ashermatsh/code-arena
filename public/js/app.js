import { parseCaseInput } from '../shared/judging.js';
import { detectBackend, loadReference } from './backend.js';
import { createEditor } from './editor.js';
import { escapeHtml, renderMarkdown } from './markdown.js';

// ------------------------------------------------------------------ storage

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`ca:${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`ca:${key}`, JSON.stringify(value));
    } catch {
      // storage unavailable: keep working without persistence
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(`ca:${key}`);
    } catch {
      // ignore
    }
  },
};

const view = document.getElementById('view');
const LANGUAGE_ORDER = ['cpp', 'java', 'python', 'javascript'];
const STATUS_LABEL = {
  passed: 'Passed', failed: 'Wrong answer', tle: 'Time limit exceeded', error: 'Runtime error',
  ole: 'Output limit exceeded', skipped: 'Not run',
};
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

let backend;
let workspace = null;
let indexCache = null;
const problemCache = new Map();

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function getProblem(slug) {
  if (!problemCache.has(slug)) {
    problemCache.set(slug, getJSON(`data/problems/${slug}/problem.json`).catch((err) => {
      problemCache.delete(slug);
      throw err;
    }));
  }
  return problemCache.get(slug);
}

const h = escapeHtml;

function icon(name) {
  const paths = {
    play: '<path d="M7 5.5v13l11-6.5z" fill="currentColor"/>',
    upload: '<path d="M12 16V5m0 0-4.5 4.5M12 5l4.5 4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    x: '<path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    back: '<path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

// ------------------------------------------------------------------ theme

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function setupTheme() {
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
    workspace?.editor?.setTheme(next);
  });
}

function renderModePill() {
  const pill = document.getElementById('mode-pill');
  const langs = backend.languages.filter((l) => l.available).map((l) => l.name);
  if (backend.mode === 'server') {
    pill.className = 'mode-pill mode-server';
    pill.textContent = 'Judge server';
    pill.title = `Code runs on the judge server. Languages: ${langs.join(', ')}.`;
  } else {
    pill.className = 'mode-pill mode-browser';
    pill.textContent = 'In-browser mode';
    pill.title = 'No judge server found, so JavaScript and Python run inside your browser. '
      + 'Start the server (npm start) to use C++ and Java.';
  }
}

// ------------------------------------------------------------------ list view

function problemStatus(slug) {
  if (store.get(`solved:${slug}`, false)) return 'solved';
  if (store.get(`subs:${slug}`, []).length) return 'attempted';
  return 'todo';
}

async function showList() {
  document.title = 'Problems · Code Arena';
  view.className = 'view view-list';
  view.innerHTML = '<div class="page-loading">Loading problems…</div>';
  try {
    indexCache ??= await getJSON('data/index.json');
  } catch (err) {
    view.innerHTML = `<div class="page-error">Could not load the problem list.<br><small>${h(err.message)}</small></div>`;
    return;
  }
  const rows = indexCache.problems.map((p, i) => {
    const status = problemStatus(p.slug);
    const mark = status === 'solved'
      ? `<span class="status-mark solved" title="Solved">${icon('check')}</span>`
      : status === 'attempted' ? '<span class="status-mark attempted" title="Attempted"></span>' : '';
    return `<tr data-slug="${h(p.slug)}" tabindex="0">
      <td class="col-status">${mark}</td>
      <td class="col-title"><a href="#/problems/${h(p.slug)}">${i + 1}. ${h(p.title)}</a></td>
      <td><span class="difficulty ${h(p.difficulty.toLowerCase())}">${h(p.difficulty)}</span></td>
      <td class="col-tags">${p.tags.map((t) => `<span class="tag">${h(t)}</span>`).join('')}</td>
    </tr>`;
  }).join('');
  const solved = indexCache.problems.filter((p) => problemStatus(p.slug) === 'solved').length;
  view.innerHTML = `
    <section class="list-page">
      <div class="list-head">
        <div>
          <h1>Problems</h1>
          <p class="muted">Pick a problem, write a solution, and run it against the sample and hidden test cases.</p>
        </div>
        <div class="progress-card">
          <span class="progress-num">${solved}<span class="muted">/${indexCache.problems.length}</span></span>
          <span class="muted">solved</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="problem-table">
          <thead><tr><th class="col-status">Status</th><th>Title</th><th>Difficulty</th><th class="col-tags">Tags</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
  view.querySelectorAll('tr[data-slug]').forEach((tr) => {
    const go = () => {
      location.hash = `#/problems/${tr.dataset.slug}`;
    };
    tr.addEventListener('click', (e) => {
      if (!e.target.closest('a')) go();
    });
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
  });
}

// ------------------------------------------------------------------ workspace

function renderExamples(problem) {
  return problem.samples.map((s, i) => {
    const input = problem.function.params.map((p, k) => `${p.name} = ${JSON.stringify(s.args[k])}`).join(', ');
    return `<div class="example">
      <div class="example-title">Example ${i + 1}</div>
      <div class="example-body">
        <div><strong>Input:</strong> <code>${h(input)}</code></div>
        <div><strong>Output:</strong> <code>${h(JSON.stringify(s.expected))}</code></div>
        ${s.explanation ? `<div class="example-expl"><strong>Explanation:</strong> ${h(s.explanation)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderStatement(problem) {
  const [before, after = ''] = problem.statement.split('{{examples}}');
  return renderMarkdown(before) + renderExamples(problem) + renderMarkdown(after);
}

class Workspace {
  constructor(problem) {
    this.problem = problem;
    this.params = problem.function.params;
    this.busy = false;
    this.editor = null;
    this.cleanups = [];
    this.lastResult = null;
    this.selectedCase = 0;
    this.selectedResultCase = 0;
    const available = backend.languages.filter((l) => l.available).map((l) => l.id);
    const saved = store.get('language', null);
    this.language = available.includes(saved) ? saved : (available.includes('python') ? 'python' : available[0]);
    this.cases = store.get(`cases:${problem.slug}`, null) || this.sampleCases();
  }

  sampleCases() {
    return this.problem.samples.map((s) => s.args.map((a) => JSON.stringify(a)));
  }

  codeKey(lang = this.language) {
    return `code:${this.problem.slug}:${lang}`;
  }

  savedCode(lang = this.language) {
    return store.get(this.codeKey(lang), null) ?? this.problem.starterCode[lang] ?? '';
  }

  mount() {
    const p = this.problem;
    document.title = `${p.title} · Code Arena`;
    view.className = 'view view-workspace';
    const langOptions = LANGUAGE_ORDER.map((id) => backend.languages.find((l) => l.id === id)).filter(Boolean)
      .map((l) => `<option value="${l.id}" ${l.available ? '' : 'disabled'} ${l.id === this.language ? 'selected' : ''}>${h(l.name)}${l.available ? '' : backend.mode === 'browser' ? ' (needs server)' : ' (not installed)'}</option>`)
      .join('');
    view.innerHTML = `
      <div class="workspace" style="--left:${store.get('split:x', 0.44)};--console:${store.get('split:y', 0.36)}">
        <section class="panel panel-left">
          <nav class="tabs" role="tablist">
            <button class="tab active" data-left="description" role="tab">Description</button>
            ${p.editorial ? '<button class="tab" data-left="editorial" role="tab">Editorial</button>' : ''}
            <button class="tab" data-left="submissions" role="tab">Submissions</button>
          </nav>
          <div class="panel-body scroll" id="left-body"></div>
        </section>
        <div class="gutter gutter-x" id="gutter-x" role="separator" aria-orientation="vertical" title="Drag to resize"></div>
        <section class="right-col" id="right-col">
          <div class="panel panel-editor">
            <div class="toolbar">
              <select id="lang-select" class="select" aria-label="Language">${langOptions}</select>
              <button class="btn btn-ghost btn-icon" id="reset-code" title="Reset to the starter code">${icon('reset')}</button>
              <span class="spacer"></span>
              <button class="btn btn-secondary" id="run-btn" title="Run the test cases below (${MOD} + ')">${icon('play')}<span>Run</span></button>
              <button class="btn btn-primary" id="submit-btn" title="Submit against all test cases (${MOD} + Enter)">${icon('upload')}<span>Submit</span></button>
            </div>
            <div class="editor-host" id="editor-host"><div class="editor-loading">Loading editor…</div></div>
          </div>
          <div class="gutter gutter-y" id="gutter-y" role="separator" aria-orientation="horizontal" title="Drag to resize"></div>
          <div class="panel panel-console">
            <nav class="tabs" role="tablist">
              <button class="tab active" data-console="cases" role="tab">Testcase</button>
              <button class="tab" data-console="result" role="tab">Test Result</button>
              <span class="spacer"></span>
              <span class="kbd-hint muted">${MOD}+' run · ${MOD}+Enter submit</span>
            </nav>
            <div class="panel-body scroll" id="console-body"></div>
          </div>
        </section>
      </div>`;

    this.$ = (sel) => view.querySelector(sel);
    this.leftBody = this.$('#left-body');
    this.consoleBody = this.$('#console-body');
    this.showLeft('description');
    this.showConsole('cases');

    view.querySelectorAll('[data-left]').forEach((b) => b.addEventListener('click', () => this.showLeft(b.dataset.left)));
    view.querySelectorAll('[data-console]').forEach((b) => b.addEventListener('click', () => this.showConsole(b.dataset.console)));
    this.$('#lang-select').addEventListener('change', (e) => this.switchLanguage(e.target.value));
    this.$('#reset-code').addEventListener('click', () => this.resetCode());
    this.$('#run-btn').addEventListener('click', () => this.run());
    this.$('#submit-btn').addEventListener('click', () => this.submit());

    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === "'") {
        e.preventDefault();
        this.run();
      }
    };
    document.addEventListener('keydown', onKey);
    this.cleanups.push(() => document.removeEventListener('keydown', onKey));

    this.setupSplitters();
    this.mountEditor();
  }

  async mountEditor() {
    const host = this.$('#editor-host');
    const editor = await createEditor(host, {
      value: this.savedCode(),
      language: backend.languages.find((l) => l.id === this.language)?.monaco || this.language,
      theme: currentTheme(),
      onChange: (code) => store.set(this.codeKey(), code),
      commands: { run: () => this.run(), submit: () => this.submit() },
    });
    if (!editor) return;
    if (this.destroyed) {
      editor.dispose();
      return;
    }
    host.querySelector('.editor-loading')?.remove();
    this.editor = editor;
  }

  destroy() {
    this.destroyed = true;
    this.cleanups.forEach((fn) => fn());
    this.editor?.dispose();
  }

  // ---------------------------------------------------------------- left panel

  showLeft(tab) {
    view.querySelectorAll('[data-left]').forEach((b) => b.classList.toggle('active', b.dataset.left === tab));
    const p = this.problem;
    if (tab === 'description') {
      this.leftBody.innerHTML = `
        <article class="statement">
          <h1 class="problem-title">${h(p.title)}</h1>
          <div class="problem-meta">
            <span class="difficulty ${h(p.difficulty.toLowerCase())}">${h(p.difficulty)}</span>
            ${p.tags.map((t) => `<span class="tag">${h(t)}</span>`).join('')}
            ${problemStatus(p.slug) === 'solved' ? `<span class="solved-badge">${icon('check')} Solved</span>` : ''}
          </div>
          ${renderStatement(p)}
          <p class="limits muted">Time limit per test: ${backend.languages.filter((l) => l.available)
    .map((l) => `${h(l.name)} ${Math.round(p.timeLimitMs * (l.timeMultiplier || 1))} ms`).join(' · ')}</p>
        </article>`;
    } else if (tab === 'editorial') {
      const revealed = store.get(`editorial:${p.slug}`, false);
      this.leftBody.innerHTML = revealed
        ? `<article class="statement"><h1 class="problem-title">Editorial</h1>${renderMarkdown(p.editorial)}</article>`
        : `<div class="spoiler">
            <h2>Spoiler ahead</h2>
            <p class="muted">The editorial walks through the full solution. Try the problem first. Even a brute force is a good start.</p>
            <button class="btn btn-secondary" id="reveal-editorial">Show the editorial</button>
          </div>`;
      this.leftBody.querySelector('#reveal-editorial')?.addEventListener('click', () => {
        store.set(`editorial:${p.slug}`, true);
        this.showLeft('editorial');
      });
    } else {
      this.renderSubmissions();
    }
    this.leftBody.scrollTop = 0;
  }

  renderSubmissions() {
    const subs = store.get(`subs:${this.problem.slug}`, []);
    if (!subs.length) {
      this.leftBody.innerHTML = '<div class="empty">No submissions yet. Your submissions are stored in this browser.</div>';
      return;
    }
    const langName = (id) => backend.languages.find((l) => l.id === id)?.name || id;
    this.leftBody.innerHTML = `
      <table class="subs-table">
        <thead><tr><th>Status</th><th>Language</th><th>Runtime</th><th>When</th><th></th></tr></thead>
        <tbody>${subs.map((s, i) => `
          <tr>
            <td><span class="verdict-text ${verdictClass(s.verdict)}">${h(s.verdict)}</span>
              <div class="muted small">${s.passed}/${s.total} passed</div></td>
            <td>${h(langName(s.language))}</td>
            <td>${s.runtimeMs != null && s.verdict === 'Accepted' ? `${s.runtimeMs} ms` : '—'}</td>
            <td class="muted small">${h(new Date(s.at).toLocaleString())}</td>
            <td><button class="btn btn-ghost btn-small" data-load="${i}">Load code</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    this.leftBody.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
      const s = subs[Number(b.dataset.load)];
      const lang = backend.languages.find((l) => l.id === s.language);
      if (!lang?.available) {
        alert(`${lang?.name || s.language} is not available in this mode.`);
        return;
      }
      if (s.language !== this.language) {
        this.$('#lang-select').value = s.language;
        this.switchLanguage(s.language);
      }
      this.editor?.setValue(s.code);
      store.set(this.codeKey(), s.code);
    }));
  }

  // ---------------------------------------------------------------- editor actions

  switchLanguage(lang) {
    if (this.editor) store.set(this.codeKey(), this.editor.getValue());
    this.language = lang;
    store.set('language', lang);
    const meta = backend.languages.find((l) => l.id === lang);
    this.editor?.setValue(this.savedCode(lang));
    this.editor?.setLanguage(meta?.monaco || lang);
  }

  resetCode() {
    if (!confirm('Replace your code with the starter code for this language?')) return;
    store.remove(this.codeKey());
    this.editor?.setValue(this.problem.starterCode[this.language]);
  }

  // ---------------------------------------------------------------- console: cases

  showConsole(tab) {
    view.querySelectorAll('[data-console]').forEach((b) => b.classList.toggle('active', b.dataset.console === tab));
    this.consoleTab = tab;
    if (tab === 'cases') this.renderCases();
    else this.renderResult();
  }

  saveCases() {
    store.set(`cases:${this.problem.slug}`, this.cases);
  }

  renderCases(error) {
    if (this.selectedCase >= this.cases.length) this.selectedCase = this.cases.length - 1;
    const chips = this.cases.map((_, i) => `
      <span class="chip ${i === this.selectedCase ? 'active' : ''}" data-case="${i}">
        Case ${i + 1}${this.cases.length > 1 ? `<button class="chip-x" data-remove="${i}" title="Remove case" aria-label="Remove case ${i + 1}">${icon('x')}</button>` : ''}
      </span>`).join('');
    const fields = this.cases[this.selectedCase] || [];
    this.consoleBody.innerHTML = `
      <div class="chips">
        ${chips}
        ${this.cases.length < 10 ? `<button class="chip chip-add" id="add-case" title="Add a test case">${icon('plus')}</button>` : ''}
        <span class="spacer"></span>
        <button class="link-btn" id="reset-cases">Reset to examples</button>
      </div>
      ${error ? `<div class="inline-error">${h(error)}</div>` : ''}
      ${this.params.map((p, k) => `
        <label class="field">
          <span class="field-label">${h(p.name)} <span class="muted">(${h(p.type)})</span> =</span>
          <textarea class="field-input" rows="1" spellcheck="false" data-field="${k}">${h(fields[k] ?? '')}</textarea>
        </label>`).join('')}
      <p class="muted small">Enter each value as JSON, e.g. <code>"RRL"</code>. The expected output is computed by the reference solution.</p>`;

    this.consoleBody.querySelectorAll('[data-case]').forEach((c) => c.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove]')) return;
      this.selectedCase = Number(c.dataset.case);
      this.renderCases();
    }));
    this.consoleBody.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      this.cases.splice(Number(b.dataset.remove), 1);
      this.saveCases();
      this.renderCases();
    }));
    this.consoleBody.querySelector('#add-case')?.addEventListener('click', () => {
      this.cases.push([...(this.cases[this.selectedCase] || this.params.map(() => ''))]);
      this.selectedCase = this.cases.length - 1;
      this.saveCases();
      this.renderCases();
    });
    this.consoleBody.querySelector('#reset-cases').addEventListener('click', () => {
      this.cases = this.sampleCases();
      this.selectedCase = 0;
      store.remove(`cases:${this.problem.slug}`);
      this.renderCases();
    });
    this.consoleBody.querySelectorAll('[data-field]').forEach((ta) => {
      const fit = () => {
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
      };
      fit();
      ta.addEventListener('input', () => {
        this.cases[this.selectedCase][Number(ta.dataset.field)] = ta.value;
        this.saveCases();
        fit();
      });
    });
  }

  addCase(args) {
    if (this.cases.length >= 10) this.cases.shift();
    this.cases.push(args.map((a) => JSON.stringify(a)));
    this.selectedCase = this.cases.length - 1;
    this.saveCases();
    this.showConsole('cases');
  }

  // ---------------------------------------------------------------- run / submit

  setBusy(kind) {
    this.busy = Boolean(kind);
    const run = this.$('#run-btn');
    const submit = this.$('#submit-btn');
    run.disabled = this.busy;
    submit.disabled = this.busy;
    run.classList.toggle('loading', kind === 'run');
    submit.classList.toggle('loading', kind === 'submit');
  }

  setStatus(text) {
    const el = this.consoleBody.querySelector('.running-text');
    if (el) el.textContent = text;
  }

  async run() {
    if (this.busy || !this.editor) return;
    let reference = null;
    try {
      reference = await loadReference(this.problem.slug);
    } catch {
      // the server validates anyway
    }
    const cases = [];
    for (const [i, fields] of this.cases.entries()) {
      const parsed = parseCaseInput(this.params, fields, reference?.validate);
      if (parsed.error) {
        this.selectedCase = i;
        this.showConsole('cases');
        this.renderCases(`Case ${i + 1}: ${parsed.error}`);
        return;
      }
      cases.push({ args: parsed.args });
    }
    await this.execute('run', () => backend.run(this.problem, this.language, this.editor.getValue(), cases, (t) => this.setStatus(t)));
  }

  async submit() {
    if (this.busy || !this.editor) return;
    const code = this.editor.getValue();
    const result = await this.execute('submit', () => backend.submit(this.problem, this.language, code, (t) => this.setStatus(t)));
    if (!result || result.verdict === 'Error') return;
    const subs = store.get(`subs:${this.problem.slug}`, []);
    subs.unshift({
      at: Date.now(), language: this.language, verdict: result.verdict, passed: result.passed,
      total: result.total, runtimeMs: result.runtimeMs, code,
    });
    store.set(`subs:${this.problem.slug}`, subs.slice(0, 50));
    if (result.verdict === 'Accepted') store.set(`solved:${this.problem.slug}`, true);
    const activeLeft = view.querySelector('[data-left].active')?.dataset.left;
    if (activeLeft === 'submissions' || activeLeft === 'description') this.showLeft(activeLeft);
  }

  async execute(kind, action) {
    this.setBusy(kind);
    this.lastResult = { kind, running: true };
    this.showConsole('result');
    let result;
    try {
      result = await action();
    } catch (err) {
      result = { verdict: 'Error', message: err.message };
    }
    if (this.destroyed) return null;
    this.lastResult = { kind, result };
    this.selectedResultCase = Math.max(0, (result.cases || []).findIndex((c) => c.status !== 'passed'));
    this.setBusy(null);
    this.showConsole('result');
    return result;
  }

  // ---------------------------------------------------------------- console: results

  renderResult() {
    const last = this.lastResult;
    if (!last) {
      this.consoleBody.innerHTML = '<div class="empty">Run your code to see the results here.</div>';
      return;
    }
    if (last.running) {
      this.consoleBody.innerHTML = `<div class="running"><span class="spinner"></span><span class="running-text">${last.kind === 'submit' ? 'Judging against all test cases…' : 'Running…'}</span></div>`;
      return;
    }
    const r = last.result;
    if (r.verdict === 'Error') {
      this.consoleBody.innerHTML = `<div class="verdict bad">Something went wrong</div><pre class="out out-error">${h(r.message)}</pre>`;
      return;
    }
    if (r.verdict === 'Compilation Error') {
      this.consoleBody.innerHTML = `<div class="verdict bad">Compilation Error</div><pre class="out out-error">${h(r.compileOutput)}</pre>`;
      return;
    }
    if (last.kind === 'run') this.renderRunResult(r);
    else this.renderSubmitResult(r);
  }

  renderRunResult(r) {
    const c = r.cases[this.selectedResultCase] || r.cases[0];
    const chips = r.cases.map((cs, i) => `
      <button class="chip ${i === this.selectedResultCase ? 'active' : ''}" data-rcase="${i}">
        <span class="dot ${cs.status}"></span>Case ${i + 1}
      </button>`).join('');
    this.consoleBody.innerHTML = `
      <div class="verdict-row">
        <span class="verdict ${verdictClass(r.verdict)}">${h(r.verdict)}</span>
        ${r.runtimeMs != null ? `<span class="muted">Runtime: ${r.runtimeMs} ms</span>` : ''}
      </div>
      <div class="chips">${chips}</div>
      ${this.caseDetail(c, r)}`;
    this.consoleBody.querySelectorAll('[data-rcase]').forEach((b) => b.addEventListener('click', () => {
      this.selectedResultCase = Number(b.dataset.rcase);
      this.renderRunResult(r);
    }));
  }

  caseDetail(c, r) {
    const block = (label, text, cls = '') => `
      <div class="io"><div class="io-label">${label}</div><pre class="out ${cls}">${h(text)}</pre></div>`;
    let html = '';
    if (c.status === 'tle') {
      html += `<div class="inline-error">Time limit exceeded: this test took longer than ${r.limitMs} ms.</div>`;
    } else if (c.status === 'ole') {
      html += '<div class="inline-error">Output limit exceeded: the program printed too much.</div>';
    } else if (c.status === 'skipped') {
      html += '<div class="inline-note">Not run, because an earlier test case stopped the program.</div>';
    }
    if (c.status === 'error' && r.error) html += block('Error', r.error, 'out-error');
    html += block('Input', c.input);
    if (c.actual != null) html += block('Output', c.actual, c.status === 'failed' ? 'out-bad' : '');
    html += block('Expected', c.expected);
    if (c.stdout) html += block('Stdout', c.stdout.replace(/\n$/, ''));
    if (c.timeMs != null) html += `<div class="muted small">Took ${c.timeMs} ms</div>`;
    return html;
  }

  renderSubmitResult(r) {
    const grid = r.cases.map((cs, i) => `<span class="cell ${cs.status}" title="Test ${i + 1}: ${STATUS_LABEL[cs.status]}${cs.timeMs != null ? ` · ${cs.timeMs} ms` : ''}"></span>`).join('');
    const f = r.failure;
    let failure = '';
    if (f) {
      failure = `
        <div class="failure-head">
          <span>Failed on test ${f.index + 1}</span>
          ${f.hidden ? '<span class="tag">hidden test</span>' : '<span class="tag">example</span>'}
          ${f.args ? '<span class="spacer"></span><button class="btn btn-ghost btn-small" id="use-case">Add to test cases</button>' : ''}
        </div>
        ${this.caseDetail(f, r)}`;
    }
    this.consoleBody.innerHTML = `
      <div class="verdict-row">
        <span class="verdict big ${verdictClass(r.verdict)}">${h(r.verdict)}</span>
        <span class="muted">${r.passed} / ${r.total} test cases passed</span>
      </div>
      ${r.verdict === 'Accepted' ? `
        <div class="stats">
          <div class="stat"><div class="stat-label">Slowest test</div><div class="stat-value">${r.runtimeMs} <small>ms</small></div></div>
          <div class="stat"><div class="stat-label">Time limit</div><div class="stat-value">${r.limitMs} <small>ms</small></div></div>
          <div class="stat"><div class="stat-label">Language</div><div class="stat-value small-value">${h(backend.languages.find((l) => l.id === this.language)?.name || this.language)}</div></div>
        </div>` : ''}
      <div class="grid" aria-label="Per-test results">${grid}</div>
      ${failure}`;
    this.consoleBody.querySelector('#use-case')?.addEventListener('click', () => this.addCase(f.args));
  }

  // ---------------------------------------------------------------- splitters

  setupSplitters() {
    const ws = view.querySelector('.workspace');
    const right = this.$('#right-col');
    const drag = (gutter, axis, apply) => {
      gutter.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        gutter.setPointerCapture(e.pointerId);
        document.body.classList.add('resizing', `resizing-${axis}`);
        const move = (ev) => apply(ev);
        const up = () => {
          gutter.removeEventListener('pointermove', move);
          document.body.classList.remove('resizing', `resizing-${axis}`);
        };
        gutter.addEventListener('pointermove', move);
        gutter.addEventListener('pointerup', up, { once: true });
        gutter.addEventListener('pointercancel', up, { once: true });
      });
    };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    drag(this.$('#gutter-x'), 'x', (ev) => {
      const rect = ws.getBoundingClientRect();
      const v = clamp((ev.clientX - rect.left) / rect.width, 0.2, 0.7);
      ws.style.setProperty('--left', v);
      store.set('split:x', v);
    });
    drag(this.$('#gutter-y'), 'y', (ev) => {
      const rect = right.getBoundingClientRect();
      const v = clamp((rect.bottom - ev.clientY) / rect.height, 0.12, 0.8);
      ws.style.setProperty('--console', v);
      store.set('split:y', v);
    });
  }
}

function verdictClass(verdict) {
  if (verdict === 'Accepted') return 'ok';
  if (verdict === 'Time Limit Exceeded' || verdict === 'Output Limit Exceeded') return 'warn';
  return 'bad';
}

async function showProblem(slug) {
  view.className = 'view view-list';
  view.innerHTML = '<div class="page-loading">Loading problem…</div>';
  let problem;
  try {
    problem = await getProblem(slug);
  } catch {
    view.innerHTML = `<div class="page-error">Problem “${h(slug)}” was not found. <a href="#/">Back to the problem list</a></div>`;
    return;
  }
  if (!location.hash.endsWith(slug)) return; // navigated away while loading
  workspace = new Workspace(problem);
  workspace.mount();
}

// ------------------------------------------------------------------ routing

async function route() {
  workspace?.destroy();
  workspace = null;
  const m = location.hash.match(/^#\/problems\/([a-z0-9-]+)\/?$/);
  document.getElementById('nav-problems').classList.toggle('active', !m);
  if (m) await showProblem(m[1]);
  else await showList();
}

async function boot() {
  setupTheme();
  backend = await detectBackend();
  renderModePill();
  window.addEventListener('hashchange', route);
  await route();
}

boot();
