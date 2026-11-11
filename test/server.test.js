// HTTP-level tests for the judge server and the static build.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('judge server', () => {
  let server;
  let base;

  before(async () => {
    server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const post = (p, body) => fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  it('serves the front-end and shared modules', async () => {
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /<script type="module" src="js\/app.js">/);
    const shared = await fetch(`${base}/shared/judging.js`);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type'), /javascript/);
  });

  it('reports health and languages', async () => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.mode, 'server');
    assert.deepEqual(health.languages.map((l) => l.id).sort(), ['cpp', 'java', 'javascript', 'python']);
  });

  it('serves problem data without hidden tests', async () => {
    const index = await (await fetch(`${base}/data/index.json`)).json();
    assert.equal(index.problems[0].slug, 'ants-on-a-rod');
    const problem = await (await fetch(`${base}/data/problems/ants-on-a-rod/problem.json`)).json();
    assert.equal(problem.samples.length, 3);
    assert.equal((await fetch(`${base}/data/problems/ants-on-a-rod/hidden.json`)).status, 404);
    assert.equal((await fetch(`${base}/data/problems/ants-on-a-rod/reference.mjs`)).status, 200);
    assert.equal((await fetch(`${base}/data/problems/nope/problem.json`)).status, 404);
  });

  it('does not serve files outside public/', async () => {
    for (const p of ['/../server/judge.js', '/%2e%2e/server/judge.js', '/shared/../server/judge.js']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 404, p);
    }
  });

  it('runs code over HTTP', async () => {
    const code = 'var antsOnARod = function(s) { return s === "RL" ? [1, 0, 1] : [0]; };';
    const res = await post('/api/run', {
      slug: 'ants-on-a-rod', language: 'javascript', code, cases: [{ args: ['RL'] }, { args: ['RRL'] }],
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.verdict, 'Wrong Answer');
    assert.deepEqual(body.cases.map((c) => c.status), ['passed', 'failed']);
  });

  it('rejects bad requests with a message', async () => {
    let res = await post('/api/run', { slug: 'ants-on-a-rod', language: 'javascript', code: 'x', cases: [{ args: ['ABC'] }] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /'L' and 'R'/);
    res = await fetch(`${base}/api/submit`, { method: 'POST', body: 'not json' });
    assert.equal(res.status, 400);
    res = await post('/api/submit', { slug: 'ants-on-a-rod', language: 'javascript', code: 'x'.repeat(200 * 1024) });
    assert.equal(res.status, 400);
  });
});

describe('static build', () => {
  it('writes a self-contained site for GitHub Pages', () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'code-arena-dist-'));
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-static.js'), out]);
      for (const f of [
        'index.html', 'js/app.js', 'js/runners/py-worker.js', 'shared/judging.js', 'data/index.json',
        'data/problems/ants-on-a-rod/problem.json', 'data/problems/ants-on-a-rod/hidden.json',
        'data/problems/ants-on-a-rod/reference.mjs', '.nojekyll',
      ]) {
        assert.ok(existsSync(path.join(out, f)), f);
      }
      const problem = JSON.parse(readFileSync(path.join(out, 'data/problems/ants-on-a-rod/problem.json'), 'utf8'));
      assert.ok(problem.starterCode.python.includes('class Solution'));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
