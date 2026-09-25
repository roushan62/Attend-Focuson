/**
 * ============================================================================
 *  dev/server.mjs — local preview of the Apps Script Web App (zero deps)
 *
 *  There is no separate frontend to serve any more: every page comes out of
 *  `doGet()` of the REAL backend code, exactly like script.google.com does it.
 *
 *    • GET /               → ?page=index      (landing, portal chooser)
 *    • GET /company.html   → ?page=company    company (HR/Admin) sign-in
 *    • GET /employee.html  → ?page=employee   employee sign-in
 *    • GET /signup.html    → ?page=signup     company registration request
 *    • GET /status.html    → ?page=status     public request tracker
 *    • GET /app.html       → ?page=app        company console (after sign-in)
 *    • GET /mobile.html    → ?page=mobile     employee app (after sign-in)
 *    • GET /owner.html     → ?page=owner      admin panel (signup approvals)
 *    • ANY /api?action=…   → the real JSON router (handleApi_)
 *
 *  The old *.html URLs are kept as aliases so bookmarks and the docs still
 *  work; ?page=<route> works on any path.
 *
 *  Run:  npm run dev        Port: PORT env var, default 8080 (0.0.0.0)
 *  Data: dev/data (gitignored JSON "spreadsheets" — an EMPTY platform is
 *        bootstrapped on first run; companies exist only after you approve a
 *        real signup request in the admin panel).
 * ============================================================================
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from './gas/loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'dev', 'data');
const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ------------------------------------------------------------------ pages */
const PAGE_ALIASES = {
  '/': 'index',
  '/index': 'index', '/index.html': 'index',
  '/login': 'login', '/login.html': 'login',
  '/company': 'company', '/company.html': 'company',
  '/employee': 'employee', '/employee.html': 'employee',
  '/signup': 'signup', '/signup.html': 'signup',
  '/status': 'status', '/status.html': 'status',
  '/app': 'app', '/app.html': 'app',
  '/mobile': 'mobile', '/mobile.html': 'mobile',
  '/owner': 'owner', '/owner.html': 'owner',
  '/admin': 'admin', '/admin.html': 'owner'
};

/* ---------------------------------------------------------------- backend */
fs.mkdirSync(DATA_DIR, { recursive: true });
// serviceUrl '' → the pages fall back to the RELATIVE /api path, which this
// server proxies; on real Apps Script the same line resolves to the /exec URL.
const app = loadBackend({ dataDir: DATA_DIR, verbose: process.env.VERBOSE === '1' });
const htmlFiles = fs.readdirSync(path.join(ROOT, 'backend')).filter((f) => f.endsWith('.html'));
log(`backend loaded: ${app.sources.length} Apps Script modules + ${htmlFiles.length} HTML pages/assets`);

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
  console.log('\n\x1b[1m\x1b[36m  SiteTrack preview — Apps Script Web App on Node (empty platform, no demo data)\x1b[0m');
  console.log('  \x1b[2mplatform master sheet:\x1b[0m', boot.masterSheetId);
  console.log('  \x1b[2madmin panel key:      \x1b[0m', boot.ownerKey);
  console.log('  \x1b[2mflow:                 \x1b[0m /signup.html → approve in /owner.html → /company.html');
  console.log('');
}

/* ------------------------------------------------------------------- http */
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  /* ---- API → the real Apps Script router ------------------------------ */
  if (p === '/api' || p === '/api/') {
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
        if (typeof params.payload === 'string') { try { params.payload = JSON.parse(params.payload); } catch { /* keep string */ } }
      }
      const token = params.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '';
      const method = req.method === 'GET' ? 'GET' : 'POST';
      const out = app.call(params.action || 'ping', params.payload || {}, {
        token, method, userAgent: req.headers['user-agent'] || 'dev-browser'
      });
      log(`API ${method} ${params.action || '?'} → ${out.success ? 'ok' : 'ERR ' + (out.error && out.error.code)} (${Date.now() - started}ms)`);
      const code = out.success ? 200 : (out.error && out.error.code >= 400 && out.error.code < 600 ? out.error.code : 200);
      return sendJson(res, code, out);
    } catch (e) {
      log('API crash:', e.message);
      return sendJson(res, 500, { success: false, error: { message: e.message, code: 500 } });
    }
  }

  /* ---- dev inspector endpoints ---------------------------------------- */
  if (p === '/dev/state') {
    const props = app.context.PropertiesService.getScriptProperties().getProperties();
    return sendJson(res, 200, {
      boot: bootInfo,
      properties: { ...props, OWNER_KEY: '***', TOKEN_SECRET: '***' },
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

  /* ---- every other path is a page rendered by doGet() ------------------ */
  const route = url.searchParams.get('page') || PAGE_ALIASES[p.replace(/\/$/, '') || '/'] || PAGE_ALIASES[p];
  if (!route) return send(res, 404, 'Not found: ' + p + '\nRoutes: / /company.html /employee.html /signup.html /status.html /app.html /mobile.html /owner.html\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  try {
    const html = app.page(route, Object.fromEntries(url.searchParams.entries()));
    return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
  } catch (e) {
    log('page crash:', e.message);
    return send(res, 500, '<pre>' + String(e.stack || e.message) + '</pre>', { 'Content-Type': 'text/html; charset=utf-8' });
  }
});

server.listen(PORT, HOST, () => {
  log(`SiteTrack preview → http://${HOST}:${PORT}`);
  log('  public   /              signup /signup.html    status /status.html');
  log('  sign-in  /company.html  /employee.html');
  log('  apps     /app.html      /mobile.html           admin  /owner.html');
  log('  api      /api?action=ping');
});
