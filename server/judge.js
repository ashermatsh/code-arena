// Runs a submission against a list of test cases.
//
// One process runs every test in sequence (cheap for languages with slow
// start-up such as Java). The driver prints a marker before each test, which
// lets us run a per-test watchdog and attribute the user's prints to tests.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeTests } from './drivers.js';
import { LANGUAGES, findPrlimit } from './languages.js';

const COMPILE_TIMEOUT_MS = 30_000;
const STARTUP_ALLOWANCE_MS = 10_000; // before the first test starts (JVM boot, parsing input)
const WATCHDOG_SLACK_MS = 1_000;
const MAX_STDOUT = 2 * 1024 * 1024;
const MAX_STDERR = 64 * 1024;
const MEMORY_LIMIT_BYTES = 1024 * 1024 * 1024;
const STACK_LIMIT_BYTES = 256 * 1024 * 1024;

// ------------------------------------------------------------ concurrency gate

const MAX_CONCURRENCY = Math.max(1, Number(process.env.MAX_CONCURRENCY) || Math.min(4, os.cpus().length));
let active = 0;
const waiting = [];

async function withSlot(fn) {
  if (active >= MAX_CONCURRENCY) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = waiting.shift();
    if (next) next();
  }
}

// ------------------------------------------------------------ process helpers

const SIGNALS = {
  SIGSEGV: 'Segmentation fault (invalid memory access or stack overflow)',
  SIGABRT: 'Aborted',
  SIGFPE: 'Floating point exception (e.g. division by zero)',
  SIGBUS: 'Bus error',
  SIGKILL: 'Killed (resource limit exceeded)',
  SIGXCPU: 'CPU time limit exceeded',
  SIGXFSZ: 'File size limit exceeded',
};

function cleanEnv(dir) {
  return {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: dir,
    TMPDIR: dir,
    LANG: 'C.UTF-8',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONIOENCODING: 'utf-8',
  };
}

function killTree(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

function sanitize(text, dir) {
  return text.split(dir + path.sep).join('').split(dir).join('.');
}

async function compile(lang, dir) {
  if (!lang.compile) return null;
  return new Promise((resolve) => {
    const child = spawn(lang.compile.cmd, lang.compile.args, {
      cwd: dir, env: cleanEnv(dir), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (d) => {
      if (output.length < MAX_STDERR) output += d.toString();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      output += '\nCompilation timed out.';
      killTree(child);
    }, COMPILE_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(`Could not start the compiler: ${err.message}`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? null : sanitize(output, dir).trim() || `Compiler exited with code ${code}`);
    });
  });
}

function execute({ lang, dir, perTestMs, testCount }) {
  return new Promise(async (resolve) => {
    const mark = `@@CA-${randomBytes(6).toString('hex')}@@`;
    const prlimit = await findPrlimit();
    let cmd = lang.run.cmd;
    let args = [...lang.run.args, 'input.txt', 'results.txt', mark];
    if (prlimit) {
      const cpuSeconds = Math.ceil((testCount * (perTestMs + WATCHDOG_SLACK_MS) + STARTUP_ALLOWANCE_MS) / 1000);
      const limits = [
        `--cpu=${cpuSeconds}`,
        `--stack=${STACK_LIMIT_BYTES}`,
        `--fsize=${64 * 1024 * 1024}`,
        '--core=0',
      ];
      if (lang.limitAddressSpace) limits.push(`--as=${MEMORY_LIMIT_BYTES}`);
      args = [...limits, '--', cmd, ...args];
      cmd = prlimit;
    } else {
      args = args.filter((a) => !a.startsWith('--stack-size'));
    }

    const child = spawn(cmd, args, {
      cwd: dir, env: cleanEnv(dir), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let scanFrom = 0;
    let current = -1;
    let killedFor = null;
    let timer = null;
    const needle = `\n${mark}`;

    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        killedFor = 'tle';
        killTree(child);
      }, ms);
    };
    arm(STARTUP_ALLOWANCE_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_STDOUT && !killedFor) {
        killedFor = 'ole';
        killTree(child);
        return;
      }
      for (;;) {
        const at = stdout.indexOf(needle, scanFrom);
        if (at === -1) {
          scanFrom = Math.max(scanFrom, stdout.length - needle.length);
          break;
        }
        const eol = stdout.indexOf('\n', at + needle.length);
        if (eol === -1) {
          scanFrom = at;
          break;
        }
        current = Number(stdout.slice(at + needle.length, eol));
        arm(perTestMs + WATCHDOG_SLACK_MS);
        scanFrom = eol + 1;
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ spawnError: err.message });
    });
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      let resultsText = '';
      try {
        resultsText = await readFile(path.join(dir, 'results.txt'), 'utf8');
      } catch {
        // no results written
      }
      resolve({
        code, signal, killedFor, current, mark, stdout, stderr: sanitize(stderr, dir), resultsText,
      });
    });
  });
}

// Splits captured stdout into per-test chunks using the driver's markers.
function splitStdout(stdout, mark, count) {
  const parts = stdout.split(`\n${mark}`);
  const perTest = new Array(count).fill('');
  let preamble = parts[0];
  for (const part of parts.slice(1)) {
    const eol = part.indexOf('\n');
    const idx = Number(part.slice(0, eol));
    if (Number.isInteger(idx) && idx >= 0 && idx < count) perTest[idx] = part.slice(eol + 1);
  }
  if (preamble && count) perTest[0] = preamble + perTest[0];
  return perTest;
}

/**
 * Compiles and runs `code` on `tests` ([{ args }]).
 * Returns { compileError } or { outcomes, errorText } where outcomes follow
 * the shape expected by shared/judging.js summarize().
 */
export async function judge({ problem, language, code, tests, timeLimitMs }) {
  const lang = LANGUAGES[language];
  if (!lang) throw new Error(`unknown language "${language}"`);
  const perTestMs = Math.round((timeLimitMs ?? problem.timeLimitMs) * lang.timeMultiplier);

  return withSlot(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'code-arena-'));
    try {
      for (const [name, content] of Object.entries(lang.files(problem.function, code))) {
        await writeFile(path.join(dir, name), content);
      }
      await writeFile(path.join(dir, 'input.txt'), encodeTests(problem.function, tests));

      const compileError = await compile(lang, dir);
      if (compileError != null) return { compileError, perTestMs };

      const r = await execute({ lang, dir, perTestMs, testCount: tests.length });
      if (r.spawnError) {
        return { perTestMs, outcomes: tests.map(() => ({ state: 'error' })), errorText: r.spawnError };
      }

      const stdoutByTest = splitStdout(r.stdout, r.mark, tests.length);
      const results = new Map();
      for (const line of r.resultsText.split('\n')) {
        if (!line) continue;
        const [i, ms, ...rest] = line.split('\t');
        try {
          results.set(Number(i), { ms: Number(ms), output: JSON.parse(rest.join('\t')) });
        } catch {
          results.set(Number(i), { ms: Number(ms), output: null });
        }
      }

      const crashed = r.killedFor || r.code !== 0 || r.signal;
      const failedAt = r.current < 0 ? 0 : r.current;
      const outcomes = tests.map((_, i) => {
        const res = results.get(i);
        if (res) return { state: 'done', ms: res.ms, output: res.output, stdout: stdoutByTest[i] };
        if (i === failedAt) {
          const state = r.killedFor === 'tle' ? 'tle' : r.killedFor === 'ole' ? 'ole' : 'error';
          return { state, stdout: stdoutByTest[i] };
        }
        return { state: 'skipped' };
      });

      let errorText = r.stderr.trim();
      if (crashed && !r.killedFor) {
        if (r.signal && SIGNALS[r.signal]) errorText += `${errorText ? '\n' : ''}${SIGNALS[r.signal]}`;
        else if (r.signal) errorText += `${errorText ? '\n' : ''}Terminated by ${r.signal}`;
        if (!errorText) errorText = `Process exited with code ${r.code}`;
      } else if (!crashed && results.size < tests.length) {
        errorText = errorText || 'The program exited before every test case produced a result.';
      }
      return { outcomes, errorText, perTestMs };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
