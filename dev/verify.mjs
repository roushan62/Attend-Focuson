/**
 * ============================================================================
 *  dev/verify.mjs — static consistency checker (zero npm dependencies)
 *
 *  Runs in ~1s and catches the mistakes that are invisible until a user hits
 *  them: an action wired in the router but never implemented, a frontend call to
 *  a renamed action, a missing asset, an i18n key with no Hindi twin, a doc row
 *  for a deleted action — and, per this project's rule, ANY demo/sample data.
 *
 *  Run:  npm run verify        (behavioural tests: npm test)
 *  Exit code 0 = clean, 1 = problems found.
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendSources, checkSyntax, BACKEND_DIR } from './gas/loader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`, yellow: `\x1b[33m`
};

const problems = [];
const notes = [];
const fail = (check, message) => problems.push({ check, message });
const info = (message) => notes.push(message);

const infoOnceSeen = new Set();
function infoOnce(m) { if (!infoOnceSeen.has(m)) { infoOnceSeen.add(m); info(m); } }

function section(title, fn) {
  console.log('\n' + c.cyan(c.bold('▌ ' + title)));
  try { fn(); } catch (e) { fail(title, 'checker crashed: ' + (e && e.stack ? e.stack : e)); }
}

/* ------------------------------------------------------------------ sources */
const sources = backendSources();
const backendCode = sources.map((s) => s.code).join('\n');
const perFile = Object.fromEntries(sources.map((s) => [s.file, s.code]));
const definedFns = [...backendCode.matchAll(/^function\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
const definedSet = new Set(definedFns);

/* The frontend IS part of the Apps Script project: pages are backend/tmpl_*.html
   and the shared JavaScript/CSS are flat backend/*.html files inlined by
   includeJs_()/includeCss_(). Nothing is hosted anywhere else. */
const PAGES = ['tmpl_index.html', 'tmpl_login.html', 'tmpl_company.html', 'tmpl_employee.html',
  'tmpl_signup.html', 'tmpl_status.html', 'tmpl_app.html', 'tmpl_mobile.html', 'tmpl_owner.html'];
const JS_FILES = ['api_js.html', 'i18n_js.html', 'ui_js.html', 'map_js.html', 'admin_js.html',
  'mobile_js.html', 'owner_js.html', 'auth_js.html'];
const CSS_FILES = ['app_css.html'];
const CONFIG_FILE = 'tmpl_config_js.html';
const readUI = (f) => read('backend/' + f);
const UI_FILES = [...PAGES, ...JS_FILES, ...CSS_FILES, CONFIG_FILE];
const frontendCode = UI_FILES.map(readUI).join('\n');

/* ------------------------------------------------------------------- 1. GAS */
section('Apps Script sources', () => {
  const errs = checkSyntax();
  if (errs.length) errs.forEach((e) => fail('syntax', `${e.file}: ${e.message}`));
  else info(`${sources.length} backend modules parse as Apps Script would load them`);

  const longFiles = sources.filter((s) => s.code.split('\n').length > 1300).map((s) => s.file);
  if (longFiles.length) info('large but coherent modules: ' + longFiles.join(', '));
});

/* --------------------------------------------------- 2. action table ↔ code */
const router = perFile['04_Router.gs'];
const aStart = router.indexOf('var ACTIONS = {');
const aBody = router.slice(aStart, router.indexOf('\n};', aStart));
const actions = [...aBody.matchAll(/^\s*([A-Za-z0-9_]+):\s*\{\s*fn:\s*'([A-Za-z0-9_]+)'([^}]*)\}/gm)]
  .map((m) => ({
    action: m[1], fn: m[2],
    auth: (m[3].match(/auth:\s*'(\w+)'/) || [])[1],
    perm: (m[3].match(/perm:\s*'(\w+)'/) || [])[1],
    rate: (m[3].match(/rate:\s*'(\w+)'/) || [])[1]
  }));

section('Router action table', () => {
  if (!actions.length) return fail('action table', 'could not parse the ACTIONS table');
  info(`${actions.length} actions registered`);

  const seen = new Set();
  actions.forEach((a) => {
    if (!a.action || !a.fn) return fail('action table', 'unparsed entry near "' + a[0] + '"');
    if (seen.has(a.action)) fail('action table', `duplicate action "${a.action}"`);
    seen.add(a.action);
    if (!definedSet.has(a.fn)) fail('action table', `${a.action} → ${a.fn}() is not implemented in backend/*.gs`);
    if (!['none', 'user', 'staff', 'owner'].includes(a.auth)) fail('action table', `${a.action}: auth must be none|user|staff|owner (got ${a.auth})`);
  });

  const permsList = (perFile['00_Config.gs'].match(/var PERMISSIONS = \[([\s\S]*?)\];/) || [])[1] || '';
  const PERMISSIONS = new Set([...permsList.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  actions.forEach((a) => {
    if (a.perm && !PERMISSIONS.has(a.perm)) fail('permissions', `${a.action}: unknown permission "${a.perm}"`);
    if ((a.auth === 'staff') && !a.perm && !['none'].includes(a.auth)) infoOnce(`staff action without an explicit permission toggle: ${a.action}`);
  });

  const rates = new Set([...router.matchAll(/^\s{2}(\w+):\s*\{ windowSeconds/gm)].map((m) => m[1]));
  actions.forEach((a) => { if (a.rate && !rates.has(a.rate)) fail('rate limiting', `${a.action}: unknown rate bucket "${a.rate}"`); });

  const orphans = definedFns.filter((f) => /^action[A-Z]/.test(f) && !actions.some((a) => a.fn === f));
  if (orphans.length) fail('action table', `implemented but unreachable (no router entry): ${orphans.join(', ')}`);
});

/* ------------------------------------------------- 3. config lists ↔ router */
section('Config: single source of truth', () => {
  const cfg = perFile['00_Config.gs'];

  // Auth must be declared once — in the router. A duplicated list always rots.
  [/var\s+PUBLIC_ACTIONS/, /var\s+OWNER_ACTIONS/, /var\s+STAFF_ACTIONS/].forEach((re) => {
    if (re.test(cfg)) fail('config drift', `00_Config.gs re-declares an action list (${re.source}) instead of relying on the ACTIONS table`);
  });
  actions.filter((a) => a.auth === 'none').forEach((a) => infoOnce(`public action: ${a.action}`));

  // Top-level configuration constants must actually be read somewhere.
  const declared = [...backendCode.matchAll(/^var\s+([A-Za-z0-9_$]+)\s*=/gm)].map((m) => m[1]);
  const dead = declared.filter((v) => {
    const uses = (backendCode.match(new RegExp('\\b' + v.replace(/\$/g, '\\$') + '\\b', 'g')) || []).length;
    return uses <= 1;
  });
  if (dead.length) fail('dead config', 'declared but never read: ' + dead.join(', '));
  else info(`${declared.length} module-level constants, all referenced`);

  // Tab schemas: order lists and schema objects must agree.
  const keysOf = (src) => new Set([...src.matchAll(/^ {2}([A-Za-z0-9_]+):\s*\{/gm)].map((m) => m[1]));
  const companyTabs = keysOf(slice(cfg, 'var COMPANY_TABS'));
  const platformTabs = keysOf(slice(cfg, 'var PLATFORM_TABS'));
  const order = listItems(slice(cfg, 'var COMPANY_TAB_ORDER'));
  const platOrder = listItems(slice(cfg, 'var PLATFORM_TAB_ORDER'));
  if (!companyTabs.size || !platformTabs.size) fail('schemas', 'could not read COMPANY_TABS / PLATFORM_TABS');
  order.forEach((t) => { if (!companyTabs.has(t)) fail('schemas', `COMPANY_TAB_ORDER lists "${t}" with no schema in COMPANY_TABS`); });
  [...companyTabs].forEach((t) => { if (!order.includes(t)) fail('schemas', `COMPANY_TABS defines "${t}" but it is not in COMPANY_TAB_ORDER (never created)`); });
  platOrder.forEach((t) => { if (!platformTabs.has(t)) fail('schemas', `PLATFORM_TAB_ORDER lists "${t}" but PLATFORM_TABS does not define it`); });
  [...platformTabs].forEach((t) => { if (!platOrder.includes(t)) fail('schemas', `PLATFORM_TABS defines "${t}" but PLATFORM_TAB_ORDER omits it`); });

  // Every tab the code touches must exist in a schema, otherwise reads throw at runtime.
  const touched = new Set([...backendCode.matchAll(/'(Settings|Users|Projects|ProjectAssignments|Attendance|LeaveRequests|ExpenseRequests|SiteTransfers|RegularizationRequests|Vendors|VendorWorkers|Holidays|Shifts|Documents|Notifications|DeviceRegistry|AuditLog|CompanySignupRequests|CompanyRegistry|LoginIndex|PlatformAuditLog)'/g)].map((m) => m[1]));
  const unknownTabs = [...touched].filter((t) => !companyTabs.has(t) && !platformTabs.has(t));
  if (unknownTabs.length) fail('schemas', 'code references tab(s) with no schema: ' + unknownTabs.join(', '));

  // Declared headers must be unique per tab and always written in that order.
  Object.entries({ COMPANY_TABS: companyTabs, PLATFORM_TABS: platformTabs }).forEach(([name, set]) => {
    const block = slice(cfg, 'var ' + name);
    [...set].forEach((tab) => {
      const at = block.indexOf('\n  ' + tab + ':');
      const after = block.slice(at + 5);
      const next = after.search(/^ {2}[A-Za-z0-9_]+:\s*\{/m);
      const body = next < 0 ? after : after.slice(0, next);
      const hAt = body.indexOf('headers:');
      if (hAt < 0) { fail('schemas', `${name}.${tab} has no headers list`); return; }
      const hEnd = body.indexOf(']', hAt);
      const headers = [...body.slice(hAt, hEnd).matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
      const dup = headers.filter((h, i) => headers.indexOf(h) !== i);
      if (dup.length) fail('schemas', `${name}.${tab} declares duplicate column(s): ${[...new Set(dup)].join(', ')}`);
      // Sheet validation may only point at columns that actually exist.
      const ddAt = body.indexOf('dropdowns:', hEnd);
      if (ddAt >= 0) {
        const ddBlock = body.slice(ddAt, body.indexOf('statusColumns', ddAt) > -1 ? body.indexOf('statusColumns', ddAt) : body.length);
        const cols = [...ddBlock.matchAll(/^\s{6}([A-Za-z0-9_]+):\s*\[/gm)].map((m) => m[1]);
        cols.forEach((col) => { if (!headers.includes(col)) fail('schemas', `${name}.${tab} sets a dropdown on unknown column "${col}"`); });
      }
      const scAt = body.indexOf('statusColumns:', hEnd);
      if (scAt >= 0) {
        const sc = [...body.slice(scAt, body.indexOf(']', scAt)).matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
        sc.forEach((col) => { if (!headers.includes(col)) fail('schemas', `${name}.${tab} marks "${col}" a status column but no such header exists`); });
      }
    });
  });
  info(`${companyTabs.size} company tabs + ${platformTabs.size} platform tabs, schemas complete`);
});

/** Return the literal that follows a top-level `var <decl> =` (object or array). */
function slice(src, decl) {
  const i = src.indexOf(decl);
  if (i < 0) return '';
  const start = src.slice(i).search(/[[{(]/);
  if (start < 0) return '';
  const from = i + start;
  const pairs = { '[': ']', '{': '}', '(': ')' };
  const closeChar = pairs[src[from]];
  let depth = 0, q = null, esc = false;
  for (let j = from; j < src.length; j++) {
    const ch = src[j];
    if (q) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === src[from]) depth++;
    else if (ch === closeChar) { depth--; if (!depth) return src.slice(from, j + 1); }
  }
  return src.slice(from);
}

function listItems(text) {
  return [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

section('Frontend ↔ backend contract', () => {
  const called = new Set();
  // api.must('x') / api.call('x') / ST.api.send('x') / call('x') / { action: 'x' }
  [...frontendCode.matchAll(/(?:\bST\.api\.|\bapi\.)(must|call|send|post|get)\(\s*'([A-Za-z0-9_]+)'/g)].forEach((m) => called.add(m[2]));
  [...frontendCode.matchAll(/\bcall\(\s*'([A-Za-z0-9_]+)'/g)].forEach((m) => called.add(m[1]));
  [...frontendCode.matchAll(/action:\s*'([A-Za-z0-9_]+)'/g)].forEach((m) => called.add(m[1]));
  const unknown = [...called].filter((a) => !actions.some((x) => x.action === a));
  if (unknown.length) fail('frontend calls', 'actions the API does not expose: ' + unknown.join(', '));
  info(`${called.size} distinct actions called by the UI — all registered`);

  // Second, looser pass: a distinctive quoted name anywhere in the UI counts as a caller
  // (many views dispatch through a helper that takes the action name as a variable).
  const byName = actions.map((a) => a.action).filter((n) => new RegExp(`'${n}'`).test(frontendCode));
  const unused = actions.map((a) => a.action).filter((a) => !byName.includes(a) && !['bootstrapPlatform', 'health'].includes(a));
  if (unused.length) fail('frontend calls', 'no UI or owner-panel caller for: ' + unused.join(', ') + ' (documented in API.md, but nothing calls them)');
  else info(`all ${actions.length - 2} non-system actions have a UI caller (${byName.length} by literal name)`);
});

/* --------------------------------------------------------------- 5. assets */
/* ------------------------------------------ 4b. frontend namespace contract */
/**
 * `ui.device.vibrate()` once shipped against an export that did not exist — the
 * page threw only when a worker took a selfie. Static check of every namespace
 * member the frontend touches, against the object each module actually exports.
 */
const mod = (f) => stripJs(readUI(f));
const stripJs = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')
  .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''");

function objLiteral(src, fromIdx) {
  const open = src.indexOf('{', src.indexOf('=', fromIdx));
  if (open < 0) return '';
  let depth = 0, str = null, esc = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (str) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === str) str = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { str = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return src.slice(open, i + 1); }
  }
  return '';
}

/** Keys declared at the top level of an object literal (incl. get/set accessors). */
function topKeys(objSrc) {
  const out = new Set();
  // Only braces matter: a `key:` is top-level when the object's own { is the
  // single one open. Counting ( and ) too desynchronised on accessor methods.
  let i = 0, depth = 0, str = null, esc = false;
  while (i < objSrc.length) {
    const ch = objSrc[i];
    if (str) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === str) str = null; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { str = ch; i++; continue; }
    if (ch === '/' && objSrc[i + 1] === '/') { while (i < objSrc.length && objSrc[i] !== '\n') i++; continue; }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; i++; continue; }
    if (depth === 1) {
      const m = /^(?:(?:get|set)\s+)?([A-Za-z_$][\w$]*)\s*:/.exec(objSrc.slice(i));
      if (m) { out.add(m[1]); i += m[0].length; continue; }
      const g = /^(get|set)\s+([A-Za-z_$][\w$]*)\s*\(/.exec(objSrc.slice(i));
      if (g) { out.add(g[2]); i += g[0].length; continue; }
    }
    i++;
  }
  return out;
}

section('Frontend namespace contract', () => {
  const srcOf = {};
  for (const f of JS_FILES) srcOf[f] = mod(f);
  const configSrc = stripJs(readUI(CONFIG_FILE));

  // Every namespace the modules publish — `window.ST.ui = { … }` or `window.ST.store = store;`
  // (the second form resolves to the module-level literal it points at).
  const EXPORTED = {};
  const grab = (ns, src, fromIdx) => {
    const keys = topKeys(objLiteral(src, fromIdx));
    if (!keys.size) return fail('namespace contract', `could not read ${ns} exports — fix this check`);
    EXPORTED[ns] = new Set([...(EXPORTED[ns] || []), ...keys]);
  };
  for (const [f, src] of Object.entries(srcOf)) {
    for (const x of src.matchAll(/window\.ST\.([A-Za-z_$][\w$]*)\s*=\s*(\{)?/g)) {
      if (x[1] === 'config') continue;                       // ST.config mirrors SITETRACK_CONFIG below
      const from = x[2] ? x.index : (() => {
        const assigned = src.slice(x.index, src.indexOf(';', x.index)).split('=').pop().trim();
        return src.indexOf('var ' + assigned);
      })();
      if (from < 0) continue;
      grab(x[1], src, from);
    }
    for (const x of src.matchAll(/var\s+(device|session|queue)\s*=\s*\{/g)) grab('api.' + x[1], src, x.index);
  }
  for (const x of configSrc.matchAll(/window\.SITETRACK_CONFIG\s*=/g)) grab('config', configSrc, x.index);

  const aliasRe = /([A-Za-z_$][\w$]*)\s*=\s*ST\.([A-Za-z_$][\w$]*)\s*(?:[,;)\n]|\s*$)/g;
  let refs = 0;
  for (const f of [...JS_FILES, ...PAGES]) {
    const src = f.endsWith('.html') ? stripJs(readUI(f)) : srcOf[f];
    const uses = [];
    for (const x of src.matchAll(/\bST\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) uses.push([x[1], x[2]]);
    for (const x of src.matchAll(/\bST\.api\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) uses.push(['api.' + x[1], x[2]]);
    for (const x of src.matchAll(aliasRe)) {
      if (!EXPORTED[x[2]]) continue;
      const bare = new RegExp('\\b' + x[1].replace(/\$/g, '\\$') + '\\.([A-Za-z_$][\\w$]*)', 'g');
      const deep = new RegExp('\\b' + x[1].replace(/\$/g, '\\$') + '\\.(device|session|queue)\\.([A-Za-z_$][\\w$]*)', 'g');
      for (const y of src.matchAll(bare)) uses.push([x[2], y[1]]);
      for (const y of src.matchAll(deep)) uses.push([x[2] + '.' + y[1], y[2]]);
    }
    for (const [ns, member] of uses) {
      const set = EXPORTED[ns];
      if (!set) continue;                                     // a local object, not a published namespace
      refs++;
      if (!set.has(member)) {
        const via = EXPORTED[ns + '.' + member];              // `ST.api.session` handed out as a namespace too
        if (via) continue;
        fail('namespace contract', `${f}: ${ns === 'config' ? 'SITETRACK_CONFIG' : 'ST.' + ns}.${member} is not exported` +
          ` (has: ${[...set].sort().slice(0, 16).join(', ')}${set.size > 16 ? ', …' : ''})`);
      }
    }
  }
  if (!problems.length) {
    const shown = ['ui', 'api', 'map', 'i18n', 'store', 'admin', 'mobile', 'owner'].filter((n) => EXPORTED[n]);
    info(`${refs} namespace references resolve — ` +
      shown.map((n) => `${n}:${EXPORTED[n].size}`).join(' · ') +
      ` · api.device:${EXPORTED['api.device'].size} · api.queue:${EXPORTED['api.queue'].size} · api.session:${EXPORTED['api.session'].size}` +
      ` · config:${EXPORTED.config.size}`);
  }
});

section('Apps Script frontend wiring', () => {
  // Every page in the router must exist as a template, and every template must
  // be reachable — an unreferenced file is dead weight inside the project.
  const routerSrc = perFile['22_Frontend.gs'];
  const pageFiles = [...routerSrc.matchAll(/file:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1] + '.html');
  pageFiles.forEach((f) => { if (!exists('backend/' + f)) fail('pages', `22_Frontend.gs serves backend/${f} which does not exist`); });
  PAGES.forEach((f) => { if (!pageFiles.includes(f)) fail('pages', `${f} is never served by the page router`); });
  ['company', 'employee'].forEach((route) => {
    if (!new RegExp("'" + route + "':\\s*\\{").test(routerSrc)) fail('pages', `the ?page=${route} route is missing from PAGES`);
  });

  // includeJs_/includeCss_ must point at real files (Apps Script resolves the
  // name without extension), and every asset must be included by some page.
  const included = new Set();
  PAGES.forEach((page) => {
    const html = readUI(page);
    for (const m of html.matchAll(/include(?:Js|Css|File)_\(\s*'([A-Za-z0-9_]+)'/g)) {
      const file = m[1] + '.html';
      included.add(file);
      if (!exists('backend/' + file)) fail('assets', `${page} includes '${m[1]}' but backend/${file} is missing`);
    }
  });
  [...JS_FILES, ...CSS_FILES, CONFIG_FILE].forEach((f) => {
    if (!included.has(f)) fail('assets', `backend/${f} is never included by any page (dead file)`);
  });

  // Apps Script inlines the files, so the pages must not link to .html URLs —
  // every link has to be a ?page=<route> route or the router would 404.
  PAGES.forEach((page) => {
    const html = readUI(page);
    for (const m of html.matchAll(/href="([^"]*\.html[^"]*)"/g)) {
      fail('links', `${page} links to '${m[1]}' — inside Apps Script use ?page=<route>`);
    }
  });

  // Both sign-in portals must be complete: their own page, their own actions.
  const company = readUI('tmpl_company.html');
  const employee = readUI('tmpl_employee.html');
  if (!company.includes("ST.auth.mount({ portal: 'company' })")) fail('portals', 'tmpl_company.html does not mount the company portal');
  if (!employee.includes("ST.auth.mount({ portal: 'employee' })")) fail('portals', 'tmpl_employee.html does not mount the employee portal');
  ['companyLogin', 'companySendOtp'].forEach((a) => { if (!actions.some((x) => x.action === a)) fail('portals', `company portal action ${a} is missing from the router`); });
  ['employeeLogin', 'employeeSendOtp'].forEach((a) => { if (!actions.some((x) => x.action === a)) fail('portals', `employee portal action ${a} is missing from the router`); });
  if (!perFile['06_Auth.gs'].includes('function assertPortal_')) fail('portals', '06_Auth.gs must gate each portal server-side (assertPortal_)');

  // No static-host leftovers: the whole point is one Apps Script deployment.
  ['frontend', 'deploy', 'hrms', 'scripts'].forEach((dir) => {
    if (fs.existsSync(path.join(ROOT, dir))) fail('layout', `${dir}/ still exists — this project is Apps Script + Sheets only`);
  });
  const backendHtml = fs.readdirSync(path.join(ROOT, 'backend')).filter((f) => f.endsWith('.html'));
  const expected = new Set([...PAGES, ...JS_FILES, ...CSS_FILES, CONFIG_FILE]);
  backendHtml.forEach((f) => { if (!expected.has(f)) fail('unused files', `backend/${f} is not a page or an included asset`); });
  info(`${PAGES.length} pages + ${JS_FILES.length + CSS_FILES.length + 1} inlined assets, all wired through the router`);
});

/* ------------------------------------------------------------------ 6. i18n */
section('i18n (English / हिंदी)', () => {
  const src = readUI('i18n_js.html');
  const objAt = (from) => {
    let i = src.indexOf('{', from), depth = 0;
    for (let j = i; j < src.length; j++) {
      const ch = src[j];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (!depth) return src.slice(i, j + 1); }
    }
    return '';
  };
  const keysOf = (code) => {
    const out = new Set();
    let i = 0, depth = 0, str = null, esc = false;
    while (i < code.length) {
      const ch = code[i];
      if (str) {
        if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === str) str = null;
        i++; continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { str = ch; i++; continue; }
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;
      if (depth === 1) {
        const m = /^([A-Za-z0-9_$]+)\s*:/.exec(code.slice(i));
        if (m && (i === 0 || /[\s{,]/.test(code[i - 1]))) { out.add(m[1]); i += m[0].length; continue; }
      }
      if (ch === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
      i++;
    }
    return out;
  };
  const en = keysOf(objAt(src.indexOf('en:', src.indexOf('DICT'))));
  const hi = keysOf(objAt(src.indexOf('hi:', src.indexOf('DICT'))));
  if (!en.size || !hi.size) return fail('i18n', 'could not extract the dictionaries');
  const onlyEn = [...en].filter((k) => !hi.has(k));
  const onlyHi = [...hi].filter((k) => !en.has(k));
  if (onlyEn.length) fail('i18n', 'missing Hindi translation for: ' + onlyEn.join(', '));
  if (onlyHi.length) fail('i18n', 'Hindi-only key (no English): ' + onlyHi.join(', '));

  const used = new Set();
  for (const page of PAGES) {
    for (const m of readUI(page).matchAll(/data-i18n(?:-ph|-title|-html)?="([^"]+)"/g)) used.add(m[1]);
  }
  for (const f of JS_FILES) {
    const code = readUI(f);
    for (const m of code.matchAll(/i18n\.t\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
    for (const m of code.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
    for (const m of code.matchAll(/data-i18n(?:-ph|-title|-html)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => k && !en.has(k));
  if (missing.length) fail('i18n', 'keys used by the UI but absent from the dictionary: ' + missing.join(', '));
  info(`${en.size} keys in both languages · ${used.size} referenced by the UI`);
});

/* ----------------------------------------------------- 7. shipped-code rules */
section('Zero demo data & no debug leftovers', () => {
  const BANNED = [
    [/\bdemo\b|demo_|_demo|seedDemo/i, 'a demo-data reference (this project ships none)'],
    [/\bsample data\b|\bdummy data\b/i, 'sample/dummy data'],
    [/[A-Za-z0-9._%+-]+@sitetrack\.local/, 'a placeholder account address'],
    [/\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b:/, 'a TODO/FIXME marker'],
    [/\bdebugger\b/, 'a debugger statement']
  ];
  const shipped = [...sources.map((s) => 'backend/' + s.file), 'backend/appsscript.json',
    ...PAGES.map((p) => 'backend/' + p), ...JS_FILES.map((f) => 'backend/' + f),
    ...CSS_FILES.map((f) => 'backend/' + f), 'backend/' + CONFIG_FILE];
  for (const rel of shipped) {
    const text = read(rel);
    text.split('\n').forEach((line, i) => {
      // Allow sentences that explicitly promise the absence of demo data.
      const allowed = /(no demo|zero demo|not demo|without demo|no sample|never.*demo|demo\/sample data)/i.test(line);
      if (allowed) return;
      for (const [re, why] of BANNED) {
        if (re.test(line)) fail('shipped code', `${rel}:${i + 1} contains ${why}\n      ${line.trim().slice(0, 140)}`);
      }
    });
  }
  const logs = JS_FILES.map((f) => [f, (readUI(f).match(/console\.(log|debug)\(/g) || []).length])
    .filter(([, n]) => n > 0);
  if (logs.length) info('console usage in shipped JS: ' + logs.map(([f, n]) => `${f}×${n}`).join(', '));
  info(`${shipped.length} shipped files scanned for demo data and debug leftovers`);
});

/* -------------------------------------------------------------------- 8. docs */
section('Documentation sync', () => {
  const api = read('docs/API.md');
  const readme = read('README.md');
  const names = actions.map((a) => a.action);
  const undocumented = names.filter((n) => !api.includes('`' + n + '`') && !api.includes('| ' + n + ' '));
  if (undocumented.length) fail('docs/API.md', 'actions missing from the reference: ' + undocumented.join(', '));

  const docRows = new Set([...api.matchAll(/^\|\s*`([a-z][A-Za-z0-9_]*)`\s*\|\s*`?action[A-Za-z0-9_]*`?/gm)].map((m) => m[1]));
  const stale = [...docRows].filter((n) => !names.includes(n));
  if (stale.length) fail('docs/API.md', 'documented but no longer exists: ' + stale.join(', '));

  const claims = [...(readme + '\n' + api).matchAll(/(\d+)\s+(?:registered\s+|JSON\s+)?actions|actions\D{0,4}(\d+)/g)]
    .map((m) => Number(m[1] !== undefined ? m[1] : m[2])).filter(Boolean);
  claims.forEach((n) => { if (n !== actions.length) fail('docs count', `docs claim ${n} actions, the router has ${actions.length}`); });
  if (!claims.length) info('no action-count claims to verify');

  const countRow = api.match(/Total actions:\s*\*\*(\d+)\*\*/);
  if (countRow && Number(countRow[1]) !== actions.length) fail('docs/API.md', `Total actions says ${countRow[1]}, router has ${actions.length}`);

  const cfgBlock = perFile['00_Config.gs'];
  const version = (cfgBlock.match(/version:\s*'([^']+)'/) || [])[1];
  if (version && !readme.includes(version) && api.includes('version')) info(`manifest/API version ${version}`);

  // Files that the README promises actually exist.
  [...readme.matchAll(/`((?:backend|dev|docs)\/[A-Za-z0-9_./-]+)`/g)]
    .map((m) => m[1].replace(/\/$/, ''))
    .filter((p) => p.includes('.') && !p.endsWith('/') && !/^dev\/data(-test)?\//.test(p))
    .forEach((p) => { if (!exists(p)) fail('README', `references ${p} which is not in the repo`); });
  info(`${names.length} actions, ${docRows.size} documented in API.md`);
});

/* ---------------------------------------------------------------- 9. deploy */
section('Deployment manifest', () => {
  const manifest = JSON.parse(read('backend/appsscript.json'));
  const need = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];
  const scopes = manifest.oauthScopes || [];
  need.forEach((s) => { if (!scopes.includes(s)) fail('appsscript.json', `missing scope ${s}`); });
  if (manifest.timeZone !== 'Asia/Kolkata') info('timeZone is ' + manifest.timeZone + ' (docs assume Asia/Kolkata)');
  const wa = (manifest.webapp || {});
  if (!wa.executeAs) fail('appsscript.json', 'webapp.executeAs is missing — the deployment would not own the Sheets');
  if (wa.access !== 'ANYONE' && wa.access !== 'ANYONE_ANONYMOUS') fail('appsscript.json', `webapp.access must be ANYONE_ANONYMOUS (found ${wa.access})`);
  if ((wa.access === 'ANYONE')) info('webapp.access=ANYONE requires a Google sign-in; ANYONE_ANONYMOUS is what workers need');
  info('deployment: one Apps Script Web App serves the API and every page (no external host)');

  // clasp pushes backend/ — the .clasp.json example must agree.
  const clasp = read('.clasp.json.example');
  if (!/"rootDir":\s*"backend"/.test(clasp)) fail('clasp', '.clasp.json.example must point rootDir at backend/');
});

/* ----------------------------------------------------------------- summary */
console.log('\n' + c.bold('─'.repeat(70)));
notes.forEach((n) => console.log(c.dim('  · ' + n)));
if (!problems.length) {
  console.log(c.green(c.bold(`\n  ✅ verify: no inconsistencies found (${actions.length} actions, ${sources.length} modules).\n`)));
  process.exit(0);
}
console.log(c.red(c.bold(`\n  ❌ verify: ${problems.length} problem(s)`)));
[...new Set(problems.map((p) => p.check))].forEach((check) => {
  problems.filter((p) => p.check === check).forEach((p) => console.log(c.red('  ✗ ') + c.bold(p.check) + ' — ' + p.message));
});
console.log('');
process.exit(1);
