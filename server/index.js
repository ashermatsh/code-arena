// HTTP server: static front-end, problem data and the run/submit API.
// Uses only Node built-ins, so `node server/index.js` works with no install.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, getProblem, problemIndex, publicProblem } from './problems.js';
import { BadRequest, languageList, runCode, submitCode } from './service.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const MAX_BODY = 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

async function serveFile(res, baseDir, relPath) {
  const file = path.normalize(path.join(baseDir, relPath));
  if (!file.startsWith(baseDir + path.sep)) return send(res, 404, { error: 'not found' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    return send(res, 200, await readFile(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch {
    return send(res, 404, { error: 'not found' });
  }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new BadRequest('request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadRequest('request body must be JSON');
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    try {
      if (req.method === 'POST' && (p === '/api/run' || p === '/api/submit')) {
        const body = await readJson(req);
        const args = { slug: body.slug, language: body.language, code: body.code, cases: body.cases };
        return send(res, 200, p === '/api/run' ? await runCode(args) : await submitCode(args));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });

      if (p === '/api/health') return send(res, 200, { ok: true, mode: 'server', languages: await languageList() });
      if (p === '/data/index.json') return send(res, 200, await problemIndex());
      let m = p.match(/^\/data\/problems\/([a-z0-9-]+)\/problem\.json$/);
      if (m) {
        const problem = await getProblem(m[1]);
        return problem ? send(res, 200, publicProblem(problem)) : send(res, 404, { error: 'unknown problem' });
      }
      m = p.match(/^\/data\/problems\/([a-z0-9-]+)\/reference\.mjs$/);
      if (m) {
        const problem = await getProblem(m[1]);
        if (!problem) return send(res, 404, { error: 'unknown problem' });
        return serveFile(res, problem.dir, 'reference.mjs');
      }
      if (p.startsWith('/shared/')) return serveFile(res, SHARED_DIR, p.slice('/shared/'.length));
      return serveFile(res, PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
    } catch (err) {
      if (err instanceof BadRequest) return send(res, 400, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'internal error' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, async () => {
    const langs = await languageList();
    console.log(`Code Arena judge listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`Languages: ${langs.map((l) => `${l.name}${l.available ? '' : ' (not installed)'}`).join(', ')}`);
  });
}
