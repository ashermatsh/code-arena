// Builds a static copy of the site into dist/ (for GitHub Pages or any static
// host). Without a judge server the front-end switches to in-browser mode:
// JavaScript and Python run client-side; C++ and Java need the server.
//
// Note: in static mode the hidden tests are downloadable by anyone, since the
// browser has to grade them itself.

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, getProblem, hiddenTests, listSlugs, problemIndex, publicProblem } from '../server/problems.js';

const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));

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
  await writeFile(path.join(dir, 'problem.json'), JSON.stringify(publicProblem(problem)));
  await writeFile(path.join(dir, 'hidden.json'), JSON.stringify(await hiddenTests(problem)));
  await cp(path.join(problem.dir, 'reference.mjs'), path.join(dir, 'reference.mjs'));
}

console.log(`Static site written to ${path.relative(process.cwd(), OUT) || '.'}`);
