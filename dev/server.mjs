/**
 * ============================================================================
 *  dev/server.mjs — local preview server (zero npm dependencies)
 *
 *  • Serves frontend/ as a static site (GitHub-Pages-compatible relative paths)
 *  • Proxies /api  →  the REAL backend/*.gs code running on the GAS polyfills
 *  • Auto-bootstraps an EMPTY Platform Master Sheet on first run (no demo or
 *    sample data exists in this project — create a company through the
 *    signup page + owner approval exactly like a real customer would)
 *  • /dev/* endpoints expose the mock outbox, logs and a data reset
 *
 *  Run:  npm run dev      (or: node dev/server.mjs)
 *  Port: PORT env var, default 8080, bound to 0.0.0.0 for sandbox previews.
 * ============================================================================
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from './gas/loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const DATA_DIR = path.join(ROOT, 'dev', 'data');
const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.map': 'application/json'
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------------------------------------------------------------- backend */
fs.mkdirSync(DATA_DIR, { recursive: true });
const app = loadBackend({ dataDir: DATA_DIR, verbose: process.env.VERBOSE === '1' });
log(`backend loaded (${app.sources.length} Apps Script modules)`);

let bootInfo = null;
function bootstrapIfNeeded() {
  const props = app.context.PropertiesService.getScriptProperties().getProperties();
  if (props.PLATFORM_MASTER_ID && props.OWNER_KEY) return { alreadyConfigured: true };
  const res = app.call('bootstrapPlatform', { confirm: 'BOOTSTRAP', devMode: true, ownerEmail: 'owner@sitetrack.local' });
  if (!res.success) throw new Error('bootstrap failed: ' + JSON.stringify(res.error));
  const ownerKey = res.data.ownerKey;
  const ownerToken = app.call('ownerLogin', { ownerKey }).data.token;
  app.call('installTriggers', {}, { token: ownerToken });
  bootInfo = { ownerKey, masterSheetId: res.data.masterSheetId };
  return bootInfo;
}

const boot = bootstrapIfNeeded();
if (boot && boot.ownerKey) {
  console.log('\n\x1b[1m\x1b[36m  SiteTrack dev backend ready — empty platform (no demo data)\x1b[0m');
  console.log('  \x1b[2mplatform master sheet:\x1b[0m', boot.masterSheetId);
  console.log('  \x1b[2mplatform owner key:   \x1b[0m', boot.ownerKey);
  console.log('  \x1b[2mstart here:           \x1b[0m /signup.html  → then approve at /owner.html with the key above');
  console.log('');
}

/* ------------------------------------------------------------------ http */
function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(code, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(buf);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj, null, 1), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 40e6) req.destroy(); });
    req.on('end', () => resolve(raw));
  });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(FRONTEND_DIR, rel);
  if (!filePath.startsWith(FRONTEND_DIR)) return send(res, 403, 'Forbidden');
  let target = filePath;
  try {
    const st = fs.statSync(target);
    if (st.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    if (!path.extname(target)) target += '.html';
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return send(res, 404, `Not found: ${rel}\n`, { 'Content-Type': 'text/plain' });
  }
  const ext = path.extname(target).toLowerCase();
  const body = fs.readFileSync(target);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (ext === '.html') headers['Cache-Control'] = 'no-cache';
  if (target.endsWith('sw.js')) headers['Service-Worker-Allowed'] = '/';
  send(res, 200, body, headers);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  /* ---- API proxy → the real Apps Script router ------------------------ */
  if (p === '/api' || p === '/api/' || p.startsWith('/api/gas')) {
    try {
      const started = Date.now();
      let params = {};
      if (req.method === 'POST') {
        const raw = await readBody(req);
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
        params = body;
      } else {
        url.searchParams.forEach((v, k) => { params[k] = v; });
        if (params.payload) { try { params.payload = JSON.parse(params.payload); } catch { /* keep string */ } }
      }
      const token = params.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '';
      const method = req.method === 'GET' ? 'GET' : 'POST';
      const out = app.call(params.action || 'ping', params.payload || {}, {
        token, method, userAgent: req.headers['user-agent'] || 'dev-browser'
      });
      log(`API ${method} ${params.action || '?'} → ${out.success ? 'ok' : 'ERR ' + (out.error && out.error.code)} (${Date.now() - started}ms)`);
      return sendJson(res, out.success ? 200 : (out.error && out.error.code >= 400 && out.error.code < 600 ? out.error.code : 200), out);
    } catch (e) {
      log('API crash:', e.message);
      return sendJson(res, 500, { success: false, error: { message: e.message, code: 500 } });
    }
  }

  /* ---- dev inspector endpoints ---------------------------------------- */
  if (p === '/dev/state') {
    const props = app.context.PropertiesService.getScriptProperties().getProperties();
    return sendJson(res, 200, {
      boot: bootInfo, properties: { ...props, OWNER_KEY: '***', TOKEN_SECRET: '***' },
      spreadsheets: fs.existsSync(path.join(DATA_DIR, 'sheets')) ? fs.readdirSync(path.join(DATA_DIR, 'sheets')) : [],
      driveFiles: Object.keys(app.dev.driveState.files || {}).length,
      emails: app.dev.outbox.length, fetches: app.dev.fetchLog.length,
      triggers: app.dev.triggers.map((t) => t.fn)
    });
  }
  if (p === '/dev/outbox') return sendJson(res, 200, { count: app.dev.outbox.length, emails: app.dev.outbox.slice(-40) });
  if (p === '/dev/fetchlog') return sendJson(res, 200, app.dev.fetchLog.slice(-40));
  if (p === '/dev/logs') return sendJson(res, 200, { log: app.context.Logger.getLog().split('\n').slice(-200) });
  if (p === '/dev/reset' && req.method === 'POST') {
    app.dev.reset();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const fresh = loadBackend({ dataDir: DATA_DIR });
    Object.keys(app.context).forEach((k) => { try { delete app.context[k]; } catch { /* noop */ } });
    Object.assign(app.context, fresh.context);
    app.dev = fresh.dev;
    bootInfo = bootstrapIfNeeded();
    return sendJson(res, 200, { reset: true, boot: bootInfo });
  }

  /* ---- static frontend ------------------------------------------------- */
  return serveStatic(req, res, p + url.search);
});

server.listen(PORT, HOST, () => {
  log(`SiteTrack preview → http://${HOST}:${PORT}`);
  log(`  landing  /index.html   signup /signup.html   owner /owner.html`);
  log(`  staff    /app.html     mobile /mobile.html   api    /api?action=ping`);
});
