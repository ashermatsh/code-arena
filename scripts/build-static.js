// Builds a static copy of the site into dist/ (for GitHub Pages or any static
// host). Without a judge server the front-end switches to in-browser mode and
// runs every language client-side: Python (Pyodide), JavaScript (Web Worker),
// C++ (Clang compiled to WebAssembly) and Java (CheerpJ).
//
//   node scripts/build-static.js [out-dir] [--no-pch]
//
// If the dev dependency @yowasp/clang is installed (npm install), the build
// also precompiles the C++ standard library header, which makes every C++
// compile in the browser about 3x faster. Without it the site still works.
//
// Note: in static mode the hidden tests are downloadable by anyone, since the
// browser has to grade them itself.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { JAVA_IMPORTS, cppSource, javaDriver } from '../server/drivers.js';
import { ROOT, getProblem, hiddenTests, listSlugs, problemIndex, publicProblem } from '../server/problems.js';
import {
  CLANG_VERSION, CPP_COMPILE_FLAGS, STDCPP_HEADER, USER_CODE_PLACEHOLDER,
} from '../shared/toolchains.js';

const args = process.argv.slice(2);
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'dist'));
const WITH_PCH = !args.includes('--no-pch');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(path.join(ROOT, 'public'), OUT, { recursive: true });
await cp(path.join(ROOT, 'shared'), path.join(OUT, 'shared'), { recursive: true });
await writeFile(path.join(OUT, '.nojekyll'), '');

await mkdir(path.join(OUT, 'data'), { recursive: true });
await writeFile(path.join(OUT, 'data', 'index.json'), JSON.stringify(await problemIndex()));

for (const slug of await listSlugs()) {
  const problem = await getProblem(slug);
  const dir = path.join(OUT, 'data', 'problems', slug);
  await mkdir(dir, { recursive: true });
  const data = {
    ...publicProblem(problem),
    // Harnesses for the in-browser C++ and Java runners.
    browser: {
      cpp: cppSource(problem.function, USER_CODE_PLACEHOLDER),
      java: javaDriver(problem.function, { watchdog: true }),
      javaImports: JAVA_IMPORTS,
    },
  };
  await writeFile(path.join(dir, 'problem.json'), JSON.stringify(data));
  await writeFile(path.join(dir, 'hidden.json'), JSON.stringify(await hiddenTests(problem)));
  await cp(path.join(problem.dir, 'reference.mjs'), path.join(dir, 'reference.mjs'));
}

if (WITH_PCH) await buildPrecompiledHeader();

console.log(`Static site written to ${path.relative(process.cwd(), OUT) || '.'}`);

async function buildPrecompiledHeader() {
  const pkgDir = path.join(ROOT, 'node_modules', '@yowasp', 'clang');
  let version;
  try {
    version = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8')).version;
  } catch {
    console.log('Skipping the C++ precompiled header (run `npm install` to enable it).');
    return;
  }
  if (version !== CLANG_VERSION) {
    console.warn(`Skipping the C++ precompiled header: installed @yowasp/clang ${version}, the site uses ${CLANG_VERSION}.`);
    return;
  }
  const { commands } = await import(pathToFileURL(path.join(pkgDir, 'gen', 'bundle.js')).href);
  const started = Date.now();
  let stderr = '';
  const out = await commands['clang++'](
    [...CPP_COMPILE_FLAGS, '-x', 'c++-header', 'bits/stdc++.h', '-o', 'stdc++.pch'],
    { bits: { 'stdc++.h': STDCPP_HEADER } },
    { stderr: (b) => { if (b) stderr += Buffer.from(b).toString(); } },
  ).catch((err) => {
    throw new Error(`building the precompiled header failed: ${stderr || err.message}`);
  });
  const pch = out['stdc++.pch'];
  await mkdir(path.join(OUT, 'cpp'), { recursive: true });
  const gz = gzipSync(pch, { level: 9 });
  await writeFile(path.join(OUT, 'cpp', 'stdc++.pch.gz'), gz);
  console.log(`Precompiled C++ header: ${(pch.length / 1e6).toFixed(1)} MB (${(gz.length / 1e6).toFixed(1)} MB gzipped) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
