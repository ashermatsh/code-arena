// The browser's Java runtime cannot be interrupted from outside, so submitted
// Java is instrumented with time checks (shared/java-instrument.js). These
// tests compile instrumented code with a real javac and run it with the
// watchdog driver to make sure that (1) valid Java stays valid, (2) results
// are unchanged, and (3) runaway loops and recursion are stopped.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { instrumentJava, originalColumn } from '../shared/java-instrument.js';
import { encodeTests } from '../shared/judging.js';
import { JAVA_IMPORTS, javaDriver } from '../server/drivers.js';
import { availableLanguages } from '../server/languages.js';

const available = await availableLanguages();
const FN = { name: 'antsOnARod', params: [{ name: 's', type: 'string' }], returns: 'int[]' };
const MARK = '@@T@@';

function runInstrumented(code, inputs, limitMs = 300, instrument = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ca-instr-'));
  try {
    writeFileSync(path.join(dir, 'Main.java'), javaDriver(FN, { watchdog: true }));
    writeFileSync(path.join(dir, 'Solution.java'), JAVA_IMPORTS + (instrument ? instrumentJava(code).code : code));
    writeFileSync(path.join(dir, 'input.txt'), encodeTests(FN, inputs.map((s) => ({ args: [s] }))));
    const env = { PATH: process.env.PATH, HOME: dir };
    const javac = spawnSync('javac', ['--release', '17', '-nowarn', '-d', '.', 'Main.java', 'Solution.java'], { cwd: dir, env, encoding: 'utf8' });
    if (javac.status !== 0) return { compileError: javac.stderr };
    const t = Date.now();
    const run = spawnSync('java', ['-cp', '.', 'Main', 'input.txt', 'results.txt', MARK, String(limitMs)], {
      cwd: dir, env, encoding: 'utf8', timeout: 20_000,
    });
    let results = [];
    try {
      results = readFileSync(path.join(dir, 'results.txt'), 'utf8').trim().split('\n').filter(Boolean)
        .map((l) => JSON.parse(l.split('\t')[2]));
    } catch {
      // no results
    }
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, results, ms: Date.now() - t };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Every construct here is valid Java 17 and must stay valid after instrumentation.
const TRICKY = `
import java.util.*;
import java.util.function.*;

class Solution {
    private final int base;
    static int counter;
    static { for (int i = 0; i < 3; i++) counter += i; }
    { int k = 0; while (k < 2) k++; }

    Solution() { this(1); }
    Solution(int base) { super(); this.base = base; }

    record Pair(int a, int b) {
        Pair { if (a < 0) throw new IllegalArgumentException(); }
        int sum() { int s = 0; for (int x : new int[]{a, b}) s += x; return s; }
    }

    enum Dir { L, R; Dir flip() { return this == L ? R : L; } }

    interface Shape { default int sides() { int n = 0; do { n++; } while (n < 4); return n; } }

    static <T extends Comparable<T>> T maxOf(List<T> xs) throws IllegalStateException {
        T best = null;
        for (T x : xs) if (best == null || x.compareTo(best) > 0) best = x;
        return best;
    }

    int firstPositive(int[] a) {
        int i = 0;
        while (true) {             // the method relies on while(true) for definite return
            if (a[i] > 0) return a[i];
            i++;
        }
    }

    int forever(int[] a) {
        for (;;) { if (a.length > 0) return a[0]; }
    }

    int definite(Iterator<Integer> it) {
        int y;
        int total = 0;
        while (it.hasNext() && (y = it.next()) > 0) total += y;   // y assigned only when true
        return total;
    }

    int patterns(Object o) {
        int n = 0;
        while (o instanceof String str && n < str.length()) n++;  // pattern binding in condition
        return n;
    }

    String text() {
        String t = """
            while (true) { "for(;;)" }
            """;
        char c = '{';
        // for (;;) { while (true) } in a comment
        return t.trim() + c + "while (x) {";
    }

    int switches(int v) {
        int r = switch (v) {
            case 0 -> { int q = 0; for (int i = 0; i < 3; i++) q += i; yield q; }
            default -> v;
        };
        return r;
    }

    int nested() {
        int count = 0;
        outer:
        for (int i = 0; i < 5; i++)
            for (int j = 0; j < 5; j++) {
                if (j == 3) continue outer;
                count++;
            }
        int w = 0;
        while (w < 3) w++;
        for (int k = 0; k < 2; k++) count += k;
        return count + w;
    }

    int lambdas() {
        Comparator<int[]> byFirst = (x, y) -> { int d = 0; while (d < 1) d++; return x[0] - y[0]; };
        Comparator<Integer> anon = new Comparator<Integer>() {
            @Override public int compare(Integer p, Integer q) { return Integer.compare(p, q); }
        };
        List<int[]> l = new ArrayList<>(List.of(new int[]{3}, new int[]{1}));
        l.sort(byFirst);
        Function<Integer, Integer> f = x -> x + 1;
        return l.get(0)[0] + anon.compare(1, 2) + f.apply(1);
    }

    public int[] antsOnARod(String s) {
        int check = firstPositive(new int[]{0, 0, 5}) + forever(new int[]{2})
            + definite(List.of(1, 2, -1, 4).iterator()) + patterns("abc") + text().length()
            + switches(0) + nested() + lambdas() + new Pair(1, 2).sum() + Dir.L.flip().ordinal()
            + new Shape() {}.sides() + maxOf(List.of(3, 9, 2)) + counter + base;
        return new int[]{check, s.length()};
    }
}
`;

describe('java instrumentation', { skip: available.java ? false : 'javac not installed' }, () => {
  it('keeps tricky but valid Java compiling and behaving the same', () => {
    const plain = runInstrumented(TRICKY, ['RL', 'RRL'], 300, false);
    assert.equal(plain.status, 0, plain.compileError || plain.stderr);
    const r = runInstrumented(TRICKY, ['RL', 'RRL']);
    assert.equal(r.compileError, undefined, r.compileError);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.results, plain.results);
    assert.equal(r.results[1][1], 3);
  });

  it('passes the reference solution', () => {
    const code = readFileSync(new URL('../problems/ants-on-a-rod/solutions/Solution.java', import.meta.url), 'utf8');
    const r = runInstrumented(code, ['RL', 'RRL', 'LLRR']);
    assert.equal(r.status, 0, r.compileError || r.stderr);
    assert.deepEqual(r.results, [[1, 0, 1], [2, 1], [0, 0, 1, 2, 3]]);
  });

  const RUNAWAY = {
    'while (true) with a block': 'class Solution { public int[] antsOnARod(String s) { long x = 0; while (true) { x++; } } }',
    'for (;;) with a single statement': 'class Solution { public int[] antsOnARod(String s) { long x = 0; for (;;) x++; } }',
    'a condition that never changes': 'class Solution { public int[] antsOnARod(String s) { int i = 0; long x = 0; while (i < 10) { x++; } return new int[]{(int) x}; } }',
    'do-while': 'class Solution { public int[] antsOnARod(String s) { long x = 0; do { x++; } while (x > 0 || true); return null; } }',
    'exponential recursion': 'class Solution { long fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); } public int[] antsOnARod(String s) { return new int[]{(int) fib(80)}; } }',
  };
  for (const [label, code] of Object.entries(RUNAWAY)) {
    it(`stops runaway code: ${label}`, () => {
      const r = runInstrumented(code, ['RL', 'RRL']);
      assert.equal(r.compileError, undefined, r.compileError);
      assert.equal(r.status, 3, `exit status (stderr: ${r.stderr})`);
      assert.match(r.stdout, new RegExp(`${MARK}TLE`));
      assert.ok(r.ms < 10_000, `stopped after ${r.ms} ms`);
    });
  }

  it('maps compiler columns back to the original source', () => {
    const src = 'class S { void f() { int i = 0; while (i < 3) i++; } }';
    const { code, insertions } = instrumentJava(src);
    const col = code.indexOf('i < 3') + 1;
    assert.equal(originalColumn(insertions, 0, src.length, col), src.indexOf('i < 3') + 1);
  });

  it('leaves constructors, which may start with super(...), alone', () => {
    const { code } = instrumentJava('class A extends B { A() { super(); } void g() { } }');
    assert.match(code, /A\(\) \{ super\(\); \}/);
    assert.match(code, /void g\(\) \{ __ca\.t\(\);/);
  });
});
