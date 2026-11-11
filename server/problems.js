// Loads problems from problems/<slug>/:
//   problem.json      title, difficulty, tags, function signature, time limit
//   statement.md      problem statement ({{examples}} marks where examples go)
//   editorial.md      optional write-up, hidden behind a spoiler in the UI
//   reference.mjs     solve(...args) and validate(...args)
//   tests/samples.json, tests/hidden.json   [{ args, expected, explanation? }]

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSupported, starterCode } from './drivers.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROBLEMS_DIR = path.join(ROOT, 'problems');

const DIFFICULTY_ORDER = { Easy: 0, Medium: 1, Hard: 2 };
const cache = new Map();

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function loadProblem(slug) {
  const dir = path.join(PROBLEMS_DIR, slug);
  const meta = JSON.parse(await readFile(path.join(dir, 'problem.json'), 'utf8'));
  assertSupported(meta.function);
  const reference = await import(pathToFileURL(path.join(dir, 'reference.mjs')).href);
  return {
    slug,
    ...meta,
    dir,
    statement: await readFile(path.join(dir, 'statement.md'), 'utf8'),
    editorial: await readOptional(path.join(dir, 'editorial.md')),
    samples: JSON.parse(await readFile(path.join(dir, 'tests', 'samples.json'), 'utf8')),
    reference,
    _hidden: null,
  };
}

export async function listSlugs() {
  const entries = await readdir(PROBLEMS_DIR, { withFileTypes: true });
  const slugs = [];
  for (const e of entries) {
    if (e.isDirectory() && (await readOptional(path.join(PROBLEMS_DIR, e.name, 'problem.json')))) {
      slugs.push(e.name);
    }
  }
  return slugs;
}

export async function getProblem(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  if (!cache.has(slug)) {
    const p = loadProblem(slug).catch((err) => {
      cache.delete(slug);
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    cache.set(slug, p);
  }
  return cache.get(slug);
}

export async function hiddenTests(problem) {
  if (!problem._hidden) {
    const text = await readOptional(path.join(problem.dir, 'tests', 'hidden.json'));
    problem._hidden = text ? JSON.parse(text) : [];
  }
  return problem._hidden;
}

// What the browser gets: everything except hidden tests and the reference code.
export function publicProblem(p) {
  return {
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    tags: p.tags || [],
    function: p.function,
    timeLimitMs: p.timeLimitMs,
    compare: p.compare || 'exact',
    statement: p.statement,
    editorial: p.editorial,
    samples: p.samples,
    starterCode: starterCode(p.function),
  };
}

export async function problemIndex() {
  const problems = [];
  for (const slug of await listSlugs()) {
    const p = await getProblem(slug);
    if (p) problems.push({ slug, title: p.title, difficulty: p.difficulty, tags: p.tags || [] });
  }
  problems.sort((a, b) => (DIFFICULTY_ORDER[a.difficulty] ?? 9) - (DIFFICULTY_ORDER[b.difficulty] ?? 9)
    || a.title.localeCompare(b.title));
  return { problems };
}
