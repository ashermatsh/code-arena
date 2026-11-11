// End-to-end judge tests: real compilers and interpreters, real processes.
// Languages whose toolchain is not installed are skipped.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { availableLanguages } from '../server/languages.js';
import { BadRequest, runCode, submitCode } from '../server/service.js';

const SLUG = 'ants-on-a-rod';
const SOLUTIONS = new URL('../problems/ants-on-a-rod/solutions/', import.meta.url);
const available = await availableLanguages();
const skip = (lang) => (available[lang] ? false : `${lang} toolchain not installed`);

const REFERENCE = {
  python: readFileSync(new URL('solution.py', SOLUTIONS), 'utf8'),
  javascript: readFileSync(new URL('solution.js', SOLUTIONS), 'utf8'),
  cpp: readFileSync(new URL('solution.cpp', SOLUTIONS), 'utf8'),
  java: readFileSync(new URL('Solution.java', SOLUTIONS), 'utf8'),
};

// Each language: a wrong answer, an infinite loop, a crash, a syntax error,
// and an O(N^2) brute force that is correct but too slow on the big tests.
const PROGRAMS = {
  python: {
    wrong: 'class Solution:\n    def antsOnARod(self, s):\n        return [len(s)]\n',
    loop: 'class Solution:\n    def antsOnARod(self, s):\n        while True:\n            pass\n',
    crash: 'class Solution:\n    def antsOnARod(self, s):\n        return [1 // 0]\n',
    syntax: 'class Solution:\n    def antsOnARod(self, s)\n        return []\n',
    print: 'class Solution:\n    def antsOnARod(self, s):\n        print("debug", s)\n        return [0]\n',
    flood: 'class Solution:\n    def antsOnARod(self, s):\n        while True:\n            print("x" * 1000)\n',
    slow: `class Solution:
    def antsOnARod(self, s):
        n = len(s)
        cnt = [0] * n
        rs = [i for i, c in enumerate(s) if c == 'R']
        ls = [j for j, c in enumerate(s) if c == 'L']
        for a, i in enumerate(rs):
            for b, j in enumerate(ls):
                if j > i:
                    cnt[a + b] += 1
                    cnt[a + b + 1] += 1
        best = max(cnt)
        return [best] + [k for k in range(n) if cnt[k] == best]
`,
  },
  javascript: {
    wrong: 'var antsOnARod = function(s) { return [s.length]; };\n',
    loop: 'var antsOnARod = function(s) { for (;;) {} };\n',
    crash: 'var antsOnARod = function(s) { return null.length; };\n',
    syntax: 'var antsOnARod = function(s) { return [; };\n',
    print: 'var antsOnARod = function(s) { console.log("debug", s); return [0]; };\n',
  },
  cpp: {
    wrong: 'class Solution {\npublic:\n    vector<int> antsOnARod(string s) { return {(int)s.size()}; }\n};\n',
    loop: 'class Solution {\npublic:\n    vector<int> antsOnARod(string s) { volatile long x = 0; while (true) x++; }\n};\n',
    crash: 'class Solution {\npublic:\n    vector<int> antsOnARod(string s) { int* p = nullptr; *p = 1; return {*p}; }\n};\n',
    syntax: 'class Solution {\npublic:\n    vector<int> antsOnARod(string s) { return {1} }\n};\n',
    print: 'class Solution {\npublic:\n    vector<int> antsOnARod(string s) { cout << "debug " << s << endl; return {0}; }\n};\n',
  },
  java: {
    wrong: 'class Solution {\n    public int[] antsOnARod(String s) { return new int[]{s.length()}; }\n}\n',
    loop: 'class Solution {\n    public int[] antsOnARod(String s) { while (true) {} }\n}\n',
    crash: 'class Solution {\n    public int[] antsOnARod(String s) { int[] a = new int[1]; return new int[]{a[5]}; }\n}\n',
    syntax: 'class Solution {\n    public int[] antsOnARod(String s) { return new int[]{1} }\n}\n',
    print: 'class Solution {\n    public int[] antsOnARod(String s) { System.out.println("debug " + s); return new int[]{0}; }\n}\n',
  },
};

for (const lang of Object.keys(PROGRAMS)) {
  const P = PROGRAMS[lang];
  describe(`judge: ${lang}`, { skip: skip(lang) }, () => {
    it('accepts the reference solution on every test', async () => {
      const r = await submitCode({ slug: SLUG, language: lang, code: REFERENCE[lang] });
      assert.equal(r.verdict, 'Accepted', JSON.stringify(r.failure || r.error || r.compileOutput));
      assert.equal(r.passed, r.total);
      assert.ok(r.total > 40);
    });

    it('reports Wrong Answer with the failing case', async () => {
      const r = await submitCode({ slug: SLUG, language: lang, code: P.wrong });
      assert.equal(r.verdict, 'Wrong Answer');
      assert.equal(r.failure.index, 0);
      assert.equal(r.failure.hidden, false);
      assert.equal(r.failure.input, 's = "RL"');
      assert.equal(r.failure.expected, '[1,0,1]');
      assert.equal(r.failure.actual, '[2]');
    });

    it('reports Time Limit Exceeded for an infinite loop', async () => {
      const r = await runCode({
        slug: SLUG, language: lang, code: P.loop, cases: [{ args: ['RL'] }, { args: ['RRL'] }], timeLimitMs: 300,
      });
      assert.equal(r.verdict, 'Time Limit Exceeded');
      assert.deepEqual(r.cases.map((c) => c.status), ['tle', 'skipped']);
    });

    it('reports Runtime Error with the error message', async () => {
      const r = await runCode({ slug: SLUG, language: lang, code: P.crash, cases: [{ args: ['RL'] }] });
      assert.equal(r.verdict, 'Runtime Error');
      assert.ok(r.error && r.error.length > 0);
      assert.equal(r.cases[0].status, 'error');
    });

    it('reports Compilation Error pointing at the user\'s line', async () => {
      const r = await runCode({ slug: SLUG, language: lang, code: P.syntax, cases: [{ args: ['RL'] }] });
      assert.equal(r.verdict, 'Compilation Error');
      assert.match(r.compileOutput, /(solution\.(py|js|cpp)|Solution\.java):(\d+:)?\d*|line 2/i);
      assert.doesNotMatch(r.compileOutput, /code-arena-/, 'temporary paths are hidden');
    });

    it('captures stdout per test case', async () => {
      const r = await runCode({
        slug: SLUG, language: lang, code: P.print, cases: [{ args: ['RL'] }, { args: ['RRL'] }],
      });
      assert.equal(r.verdict, 'Wrong Answer');
      assert.match(r.cases[0].stdout, /debug RL/);
      assert.match(r.cases[1].stdout, /debug RRL/);
      assert.doesNotMatch(r.cases[1].stdout, /debug RL\b/);
    });
  });
}

describe('judge: specific behaviours', () => {
  it('locates Python runtime errors in the user\'s code', { skip: skip('python') }, async () => {
    const r = await runCode({ slug: SLUG, language: 'python', code: PROGRAMS.python.crash, cases: [{ args: ['RL'] }] });
    assert.match(r.error, /ZeroDivisionError/);
    assert.match(r.error, /solution\.py", line 3/);
    assert.doesNotMatch(r.error, /main\.py/);
  });

  it('reports a C++ segmentation fault', { skip: skip('cpp') }, async () => {
    const r = await runCode({ slug: SLUG, language: 'cpp', code: PROGRAMS.cpp.crash, cases: [{ args: ['RL'] }] });
    assert.match(r.error, /Segmentation fault/);
  });

  it('times out a correct but quadratic solution on the large hidden tests', { skip: skip('python') }, async () => {
    const r = await submitCode({ slug: SLUG, language: 'python', code: PROGRAMS.python.slow, timeLimitMs: 200 });
    assert.equal(r.verdict, 'Time Limit Exceeded');
    assert.ok(r.passed >= 30, `small tests pass (${r.passed})`);
    assert.equal(r.failure.hidden, true);
  });

  it('stops runaway output', { skip: skip('python') }, async () => {
    const r = await runCode({ slug: SLUG, language: 'python', code: PROGRAMS.python.flood, cases: [{ args: ['RL'] }] });
    assert.equal(r.verdict, 'Output Limit Exceeded');
  });

  it('computes expected answers for custom cases with the reference solution', { skip: skip('python') }, async () => {
    const r = await runCode({
      slug: SLUG, language: 'python', code: REFERENCE.python, cases: [{ args: ['RRLL'] }, { args: ['LRRL'] }],
    });
    assert.equal(r.verdict, 'Accepted');
    assert.deepEqual(r.cases.map((c) => c.expected), ['[3,1,2]', '[2,2]']);
  });

  it('rejects custom cases outside the constraints', async () => {
    const lang = Object.keys(available).find((l) => available[l]);
    await assert.rejects(
      runCode({ slug: SLUG, language: lang, code: 'x', cases: [{ args: ['RXL'] }] }),
      (err) => err instanceof BadRequest && /'L' and 'R'/.test(err.message),
    );
    await assert.rejects(
      runCode({ slug: SLUG, language: lang, code: 'x', cases: [{ args: [42] }] }),
      (err) => err instanceof BadRequest && /type string/.test(err.message),
    );
    await assert.rejects(
      runCode({ slug: SLUG, language: 'cobol', code: 'x', cases: [{ args: ['RL'] }] }),
      BadRequest,
    );
  });
});
