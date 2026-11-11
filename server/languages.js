// Supported languages: how to lay out the source files, compile and run them.
// Commands are argv arrays (never passed through a shell).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  PY_CHECK, JAVA_IMPORTS, pythonDriver, javascriptDriver, cppSource, javaDriver,
} from './drivers.js';

const run = promisify(execFile);

export const LANGUAGES = {
  cpp: {
    name: 'C++17',
    monaco: 'cpp',
    timeMultiplier: 1,
    probe: ['g++', ['--version']],
    files: (fn, code) => ({ 'main.cpp': cppSource(fn, code) }),
    compile: { cmd: 'g++', args: ['-std=c++17', '-O2', '-pipe', '-o', 'main', 'main.cpp'] },
    run: { cmd: './main', args: [] },
    limitAddressSpace: true,
  },
  java: {
    name: 'Java',
    monaco: 'java',
    timeMultiplier: 2,
    probe: ['javac', ['-version']],
    files: (fn, code) => ({ 'Main.java': javaDriver(fn), 'Solution.java': JAVA_IMPORTS + code }),
    compile: { cmd: 'javac', args: ['-encoding', 'UTF-8', '-nowarn', '-d', '.', 'Main.java', 'Solution.java'] },
    run: {
      cmd: 'java',
      args: ['-Xmx512m', '-XX:+UseSerialGC', '-XX:-UsePerfData', '-Djava.io.tmpdir=.', '-cp', '.', 'Main'],
    },
    limitAddressSpace: false, // the JVM reserves far more virtual memory than it uses; -Xmx caps the heap
  },
  python: {
    name: 'Python 3',
    monaco: 'python',
    timeMultiplier: 3,
    probe: ['python3', ['--version']],
    files: (fn, code) => ({ 'solution.py': code, 'check.py': PY_CHECK, 'main.py': pythonDriver(fn) }),
    compile: { cmd: 'python3', args: ['-B', 'check.py'] },
    run: { cmd: 'python3', args: ['-B', 'main.py'] },
    limitAddressSpace: true,
  },
  javascript: {
    name: 'JavaScript',
    monaco: 'javascript',
    timeMultiplier: 2,
    probe: [process.execPath, ['--version']],
    files: (fn, code) => ({ 'solution.js': code, 'main.js': javascriptDriver(fn) }),
    compile: { cmd: process.execPath, args: ['--check', 'solution.js'] },
    run: { cmd: process.execPath, args: ['--max-old-space-size=512', '--stack-size=32768', 'main.js'] },
    limitAddressSpace: false, // V8 reserves large virtual ranges; --max-old-space-size caps the heap
  },
};

let availability;

// Detects which toolchains are installed (cached after the first call).
export async function availableLanguages() {
  if (!availability) {
    availability = (async () => {
      const out = {};
      await Promise.all(Object.entries(LANGUAGES).map(async ([id, lang]) => {
        try {
          await run(lang.probe[0], lang.probe[1], { timeout: 10_000 });
          out[id] = true;
        } catch {
          out[id] = false;
        }
      }));
      return out;
    })();
  }
  return availability;
}

let prlimitPath;

// prlimit (util-linux) lets us cap memory, CPU time and file sizes for each run.
export async function findPrlimit() {
  if (prlimitPath === undefined) {
    prlimitPath = null;
    for (const p of ['/usr/bin/prlimit', '/bin/prlimit']) {
      try {
        await run(p, ['--version'], { timeout: 5_000 });
        prlimitPath = p;
        break;
      } catch {
        // try next
      }
    }
  }
  return prlimitPath;
}
