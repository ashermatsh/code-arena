// Grading logic shared by the judge server and the in-browser runners, so both
// produce identical verdicts and result shapes.

export const SUPPORTED_TYPES = [
  'int', 'long', 'double', 'boolean', 'string',
  'int[]', 'long[]', 'double[]', 'boolean[]', 'string[]', 'int[][]',
];

const VERDICTS = {
  passed: 'Accepted',
  failed: 'Wrong Answer',
  tle: 'Time Limit Exceeded',
  error: 'Runtime Error',
  ole: 'Output Limit Exceeded',
  skipped: 'Runtime Error',
};

const DISPLAY_LIMIT = 1000;

// Deep equality on JSON values. Doubles compare with a small tolerance when
// the problem asks for it ("float" mode); everything else must match exactly.
export function valuesEqual(expected, actual, mode = 'exact') {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (mode === 'float') {
      const diff = Math.abs(expected - actual);
      return diff <= 1e-6 || diff <= 1e-6 * Math.abs(expected);
    }
    return expected === actual;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (!valuesEqual(expected[i], actual[i], mode)) return false;
    }
    return true;
  }
  return expected === actual;
}

// Checks that a parsed JSON value has the shape a parameter type expects.
export function checkType(type, value) {
  switch (type) {
    case 'int':
      return Number.isInteger(value) && value >= -(2 ** 31) && value < 2 ** 31;
    case 'long':
      return Number.isSafeInteger(value);
    case 'double':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string' && !/[\r\n]/.test(value);
    default:
      if (type.endsWith('[]')) {
        const inner = type.slice(0, -2);
        return Array.isArray(value) && value.every((v) => checkType(inner, v));
      }
      return false;
  }
}

export function truncate(text, limit = DISPLAY_LIMIT) {
  if (text == null) return text;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)} … (${text.length.toLocaleString('en-US')} characters total)`;
}

export function formatValue(value) {
  if (value === undefined) return 'null';
  return truncate(JSON.stringify(value));
}

export function formatArgs(params, args) {
  return params.map((p, i) => `${p.name} = ${formatValue(args[i])}`).join('\n');
}

// Parses user-entered test case fields (one JSON literal per parameter).
export function parseCaseInput(params, fields, validate) {
  const args = [];
  for (let i = 0; i < params.length; i++) {
    const { name, type } = params[i];
    const raw = (fields[i] ?? '').trim();
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      return { error: `${name}: not valid JSON (strings need double quotes, e.g. "RRL")` };
    }
    if (!checkType(type, value)) return { error: `${name}: expected a value of type ${type}` };
    args.push(value);
  }
  const problem = validate ? validate(...args) : null;
  if (problem) return { error: problem };
  return { args };
}

/**
 * Turns raw execution outcomes into the result object the UI renders.
 *
 * tests:    [{ args, expected }]
 * outcomes: [{ state: 'done'|'tle'|'ole'|'error'|'skipped', ms?, output?, stdout? }]
 * mode:     'run' (show every case) or 'submit' (summary + first failure)
 */
export function summarize({
  problem, tests, outcomes, limitMs, mode, compileError, errorText, sampleCount = 0,
}) {
  const total = tests.length;
  if (compileError != null) {
    return { verdict: 'Compilation Error', compileOutput: compileError, passed: 0, total, cases: [] };
  }
  const compareMode = problem.compare || 'exact';
  const statuses = tests.map((test, i) => {
    const o = outcomes[i] || { state: 'skipped' };
    if (o.state !== 'done') return o.state;
    if (o.ms > limitMs) return 'tle';
    return valuesEqual(test.expected, o.output, compareMode) ? 'passed' : 'failed';
  });
  const firstBad = statuses.findIndex((s) => s !== 'passed');
  const verdict = firstBad === -1 ? 'Accepted' : VERDICTS[statuses[firstBad]];
  const finished = outcomes.filter((o) => o && o.state === 'done');
  const runtimeMs = finished.length ? Math.round(Math.max(...finished.map((o) => o.ms))) : null;
  const passed = statuses.filter((s) => s === 'passed').length;
  const params = problem.function.params;

  const detail = (i) => {
    const o = outcomes[i] || {};
    return {
      index: i,
      status: statuses[i],
      timeMs: o.ms != null ? Math.round(o.ms * 10) / 10 : null,
      input: formatArgs(params, tests[i].args),
      expected: formatValue(tests[i].expected),
      actual: o.state === 'done' ? formatValue(o.output) : null,
      stdout: truncate(o.stdout || '', 4000),
    };
  };

  const result = { verdict, passed, total, runtimeMs, limitMs };
  if (verdict === 'Runtime Error' && errorText) result.error = truncate(errorText, 8000);
  if (mode === 'run') {
    result.cases = tests.map((_, i) => detail(i));
  } else {
    result.cases = statuses.map((status, i) => ({
      status,
      timeMs: outcomes[i] && outcomes[i].ms != null ? Math.round(outcomes[i].ms * 10) / 10 : null,
    }));
    if (firstBad !== -1) {
      const { args } = tests[firstBad];
      result.failure = { ...detail(firstBad), hidden: firstBad >= sampleCount };
      // Small failing inputs are sent back verbatim so they can become custom test cases.
      if (JSON.stringify(args).length <= 5000) result.failure.args = args;
    }
  }
  return result;
}

// ------------------------------------------------------------------ input encoding
// Line-based format read by every language's driver: the test count, then
// each argument (arrays as a length line followed by the values).

function encodeValue(type, value, out) {
  if (type === 'string[]') {
    out.push(String(value.length), ...value);
  } else if (type.endsWith('[][]')) {
    out.push(String(value.length));
    for (const row of value) encodeValue(type.slice(0, -2), row, out);
  } else if (type.endsWith('[]')) {
    out.push(String(value.length), value.map((v) => String(v)).join(' '));
  } else {
    out.push(String(value));
  }
}

export function encodeTests(fn, tests) {
  const out = [String(tests.length)];
  for (const t of tests) fn.params.forEach((p, i) => encodeValue(p.type, t.args[i], out));
  return `${out.join('\n')}\n`;
}
