// "Run" and "Submit" on top of the judge: input validation, expected answers
// for custom cases (from the reference solution), and result summaries.

import { checkType, summarize } from '../shared/judging.js';
import { judge } from './judge.js';
import { LANGUAGES, availableLanguages } from './languages.js';
import { getProblem, hiddenTests } from './problems.js';

const MAX_CODE_BYTES = 100 * 1024;
const MAX_RUN_CASES = 10;

export class BadRequest extends Error {}

async function prepare({ slug, language, code }) {
  const problem = typeof slug === 'string' ? await getProblem(slug) : null;
  if (!problem) throw new BadRequest('unknown problem');
  if (!LANGUAGES[language]) throw new BadRequest('unknown language');
  if (!(await availableLanguages())[language]) {
    throw new BadRequest(`${LANGUAGES[language].name} is not installed on this judge server`);
  }
  if (typeof code !== 'string' || !code.trim()) throw new BadRequest('code is empty');
  if (Buffer.byteLength(code) > MAX_CODE_BYTES) throw new BadRequest('code is larger than 100 KB');
  return problem;
}

export async function runCode({ slug, language, code, cases, timeLimitMs }) {
  const problem = await prepare({ slug, language, code });
  if (!Array.isArray(cases) || cases.length === 0) throw new BadRequest('add at least one test case');
  if (cases.length > MAX_RUN_CASES) throw new BadRequest(`at most ${MAX_RUN_CASES} test cases per run`);
  const { params } = problem.function;
  const tests = cases.map((c, i) => {
    const args = c && c.args;
    if (!Array.isArray(args) || args.length !== params.length) {
      throw new BadRequest(`case ${i + 1}: expected ${params.length} argument(s)`);
    }
    params.forEach((p, k) => {
      if (!checkType(p.type, args[k])) throw new BadRequest(`case ${i + 1}: ${p.name} must be of type ${p.type}`);
    });
    const invalid = problem.reference.validate(...args);
    if (invalid) throw new BadRequest(`case ${i + 1}: ${invalid}`);
    return { args, expected: problem.reference.solve(...args) };
  });
  const raw = await judge({ problem, language, code, tests, timeLimitMs });
  return summarize({
    problem, tests, mode: 'run', limitMs: raw.perTestMs, ...raw,
  });
}

export async function submitCode({ slug, language, code, timeLimitMs }) {
  const problem = await prepare({ slug, language, code });
  const tests = [...problem.samples, ...(await hiddenTests(problem))];
  const raw = await judge({ problem, language, code, tests, timeLimitMs });
  return summarize({
    problem, tests, mode: 'submit', limitMs: raw.perTestMs, sampleCount: problem.samples.length, ...raw,
  });
}

export async function languageList() {
  const available = await availableLanguages();
  return Object.entries(LANGUAGES).map(([id, l]) => ({
    id, name: l.name, monaco: l.monaco, timeMultiplier: l.timeMultiplier, available: available[id],
  }));
}
