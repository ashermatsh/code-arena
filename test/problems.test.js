// Checks every problem's data: tests satisfy the constraints, expected outputs
// match the reference solution, and generated starter code / drivers are sane.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkType, summarize, valuesEqual, parseCaseInput } from '../shared/judging.js';
import { encodeTests, starterCode } from '../server/drivers.js';
import { availableLanguages } from '../server/languages.js';
import { getProblem, hiddenTests, listSlugs, publicProblem } from '../server/problems.js';

const available = await availableLanguages();

for (const slug of await listSlugs()) {
  describe(`problem: ${slug}`, async () => {
    const problem = await getProblem(slug);
    const all = [...problem.samples, ...(await hiddenTests(problem))];

    it('has metadata and a statement with an examples slot', () => {
      assert.ok(problem.title && problem.difficulty);
      assert.ok(problem.timeLimitMs > 0);
      assert.match(problem.statement, /\{\{examples\}\}/);
      assert.ok(problem.samples.length > 0);
    });

    it('every test satisfies the constraints and matches the reference solution', () => {
      for (const [i, t] of all.entries()) {
        assert.equal(t.args.length, problem.function.params.length, `test ${i}`);
        problem.function.params.forEach((p, k) => assert.ok(checkType(p.type, t.args[k]), `test ${i} arg ${p.name}`));
        assert.equal(problem.reference.validate(...t.args), null, `test ${i}`);
        assert.ok(valuesEqual(t.expected, problem.reference.solve(...t.args)), `test ${i}`);
      }
    });

    it('never exposes hidden tests or reference code to the browser', () => {
      const pub = JSON.stringify(publicProblem(problem));
      assert.doesNotMatch(pub, /hidden/i);
      assert.ok(!('reference' in publicProblem(problem)));
    });
  });
}

describe('ants-on-a-rod reference', () => {
  it('matches the statement examples', async () => {
    const { reference } = await getProblem('ants-on-a-rod');
    assert.deepEqual(reference.solve('RL'), [1, 0, 1]);
    assert.deepEqual(reference.solve('RRL'), [2, 1]);
  });

  it('agrees with a brute-force physical simulation (tools/verify.py)', { skip: !available.python }, () => {
    const script = fileURLToPath(new URL('../problems/ants-on-a-rod/tools/verify.py', import.meta.url));
    const out = execFileSync('python3', [script], { encoding: 'utf8' });
    assert.match(out, /^OK/);
  });

  it('validates input', async () => {
    const { reference } = await getProblem('ants-on-a-rod');
    assert.equal(reference.validate('LRRL'), null);
    assert.match(reference.validate(''), /between 1 and 100000/);
    assert.match(reference.validate('R'.repeat(100001)), /between 1 and 100000/);
    assert.match(reference.validate('RLX'), /'L' and 'R'/);
  });
});

describe('shared judging helpers', () => {
  it('compares values', () => {
    assert.ok(valuesEqual([1, [2, 3]], [1, [2, 3]]));
    assert.ok(!valuesEqual([1, 2], [1, 2, 3]));
    assert.ok(!valuesEqual([1], ['1']));
    assert.ok(!valuesEqual([1], null));
    assert.ok(valuesEqual(0.1 + 0.2, 0.3, 'float'));
    assert.ok(!valuesEqual(0.1 + 0.2, 0.3, 'exact'));
  });

  it('checks types', () => {
    assert.ok(checkType('int[][]', [[1], []]));
    assert.ok(!checkType('int', 1.5));
    assert.ok(!checkType('int', 2 ** 31));
    assert.ok(!checkType('string', 'a\nb'));
    assert.ok(checkType('boolean[]', [true, false]));
  });

  it('parses custom case fields', () => {
    const params = [{ name: 's', type: 'string' }];
    assert.deepEqual(parseCaseInput(params, ['"RL"']), { args: ['RL'] });
    assert.match(parseCaseInput(params, ['RL']).error, /not valid JSON/);
    assert.match(parseCaseInput(params, ['5']).error, /type string/);
    assert.match(parseCaseInput(params, ['"RX"'], () => 'bad').error, /bad/);
  });

  it('summarizes outcomes into a verdict', () => {
    const problem = { function: { params: [{ name: 's', type: 'string' }] } };
    const tests = [{ args: ['RL'], expected: [1, 0, 1] }, { args: ['L'], expected: [0, 0] }];
    const ok = summarize({
      problem, tests, mode: 'submit', limitMs: 100,
      outcomes: [{ state: 'done', ms: 3, output: [1, 0, 1] }, { state: 'done', ms: 5, output: [0, 0] }],
    });
    assert.equal(ok.verdict, 'Accepted');
    assert.equal(ok.runtimeMs, 5);
    const slow = summarize({
      problem, tests, mode: 'run', limitMs: 4,
      outcomes: [{ state: 'done', ms: 3, output: [1, 0, 1] }, { state: 'done', ms: 5, output: [0, 0] }],
    });
    assert.equal(slow.verdict, 'Time Limit Exceeded');
    const ce = summarize({ problem, tests, mode: 'run', limitMs: 4, compileError: 'boom' });
    assert.equal(ce.verdict, 'Compilation Error');
  });
});

describe('code generation', () => {
  const fn = {
    name: 'f',
    params: [
      { name: 'a', type: 'int' }, { name: 'b', type: 'string[]' }, { name: 'c', type: 'int[][]' },
      { name: 'd', type: 'double[]' }, { name: 'e', type: 'boolean' },
    ],
    returns: 'long[]',
  };

  it('encodes test inputs line by line', () => {
    const text = encodeTests(fn, [{ args: [7, ['x y', ''], [[1, 2], []], [0.5], true] }]);
    assert.equal(text, '1\n7\n2\nx y\n\n2\n2\n1 2\n0\n\n1\n0.5\ntrue\n');
  });

  it('generates starter code for every language', () => {
    const code = starterCode(fn);
    assert.match(code.python, /def f\(self, a: int, b: List\[str\], c: List\[List\[int\]\], d: List\[float\], e: bool\) -> List\[int\]:/);
    assert.match(code.javascript, /var f = function\(a, b, c, d, e\)/);
    assert.match(code.cpp, /vector<long long> f\(int a, vector<string>& b, vector<vector<int>>& c, vector<double>& d, bool e\)/);
    assert.match(code.java, /public long\[\] f\(int a, String\[\] b, int\[\]\[\] c, double\[\] d, boolean e\)/);
  });

  it('ships the starter code to the browser', async () => {
    const pub = publicProblem(await getProblem('ants-on-a-rod'));
    assert.match(pub.starterCode.python, /def antsOnARod\(self, s: str\) -> List\[int\]:/);
    assert.match(pub.starterCode.java, /public int\[\] antsOnARod\(String s\)/);
  });
});

describe('multi-type drivers', () => {
  // A throwaway problem using every supported type, run through each language,
  // to make sure the generated readers and writers round-trip values.
  const fn = {
    name: 'echo',
    params: [
      { name: 'a', type: 'int' }, { name: 'b', type: 'long' }, { name: 'c', type: 'double' },
      { name: 'd', type: 'boolean' }, { name: 'e', type: 'string' }, { name: 'f', type: 'int[]' },
      { name: 'g', type: 'string[]' }, { name: 'h', type: 'int[][]' }, { name: 'i', type: 'boolean[]' },
    ],
    returns: 'string[]',
  };
  const args = [-5, 9007199254740991, 2.5, true, 'he said "hi"\\', [3, -1], ['a b', ''], [[1, 2], [], [3]], [false, true]];
  const expected = ['-5', '9007199254740991', '2.5', 'true', 'he said "hi"\\', '2:-1', '2:', '3:3', '2:true'];
  const code = {
    python: `class Solution:
    def echo(self, a, b, c, d, e, f, g, h, i):
        return [str(a), str(b), str(c), "true" if d else "false", e, f"{len(f)}:{f[-1]}", f"{len(g)}:{g[1]}", f"{len(h)}:{h[2][0]}", f"{len(i)}:{'true' if i[1] else 'false'}"]
`,
    javascript: `var echo = function(a, b, c, d, e, f, g, h, i) {
  return [String(a), String(b), String(c), String(d), e, f.length + ':' + f[1], g.length + ':' + g[1], h.length + ':' + h[2][0], i.length + ':' + i[1]];
};
`,
    cpp: `class Solution {
public:
    vector<string> echo(int a, long long b, double c, bool d, string e, vector<int>& f, vector<string>& g, vector<vector<int>>& h, vector<bool>& i) {
        ostringstream cs; cs << c;
        return {to_string(a), to_string(b), cs.str(), d ? "true" : "false", e, to_string(f.size()) + ":" + to_string(f[1]),
                to_string(g.size()) + ":" + g[1], to_string(h.size()) + ":" + to_string(h[2][0]), to_string(i.size()) + ":" + (i[1] ? "true" : "false")};
    }
};
`,
    java: `class Solution {
    public String[] echo(int a, long b, double c, boolean d, String e, int[] f, String[] g, int[][] h, boolean[] i) {
        return new String[]{"" + a, "" + b, "" + c, "" + d, e, f.length + ":" + f[1], g.length + ":" + g[1], h.length + ":" + h[2][0], i.length + ":" + i[1]};
    }
}
`,
  };

  for (const lang of Object.keys(code)) {
    it(`round-trips every type in ${lang}`, async (t) => {
      if (!available[lang]) return t.skip(`${lang} not installed`);
      const { judge } = await import('../server/judge.js');
      const problem = { function: fn, timeLimitMs: 2000 };
      const raw = await judge({ problem, language: lang, code: code[lang], tests: [{ args }] });
      assert.equal(raw.compileError, undefined, raw.compileError);
      assert.equal(raw.outcomes[0].state, 'done', raw.errorText);
      assert.deepEqual(raw.outcomes[0].output, expected);
    });
  }
});

describe('static test files', () => {
  it('are valid JSON arrays', () => {
    for (const f of ['samples.json', 'hidden.json']) {
      const data = JSON.parse(readFileSync(new URL(`../problems/ants-on-a-rod/tests/${f}`, import.meta.url), 'utf8'));
      assert.ok(Array.isArray(data) && data.length > 0);
    }
  });
});
