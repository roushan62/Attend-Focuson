/**
 * ============================================================================
 *  dev/gas/loader.mjs
 *  Concatenates backend/*.gs exactly the way the Apps Script editor does and
 *  evaluates them inside a VM context wired to the local polyfills.
 *  → the same code you deploy to Google runs here, unmodified.
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createPolyfill } from './polyfill.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const BACKEND_DIR = path.join(REPO_ROOT, 'backend');

export function backendSources(backendDir = BACKEND_DIR) {
  return fs.readdirSync(backendDir)
    .filter((f) => f.endsWith('.gs'))
    .sort()
    .map((f) => ({
      file: f,
      code: fs.readFileSync(path.join(backendDir, f), 'utf8')
    }));
}

/** Syntax-check every .gs file the way Apps Script would parse it. */
export function checkSyntax(backendDir = BACKEND_DIR) {
  const errors = [];
  for (const src of backendSources(backendDir)) {
    try {
      new vm.Script(src.code, { filename: src.file });
    } catch (e) {
      errors.push({ file: src.file, message: e.message });
    }
  }
  return errors;
}

export function loadBackend({ dataDir = path.join(REPO_ROOT, 'dev', 'data'), verbose = false, backendDir = BACKEND_DIR } = {}) {
  const sandbox = createPolyfill({ dataDir, verbose });
  const context = vm.createContext(sandbox);

  const sources = backendSources(backendDir);
  for (const src of sources) {
    try {
      vm.runInContext(src.code, context, { filename: src.file, lineOffset: 0 });
    } catch (e) {
      const stack = String(e.stack || e.message).split('\n').slice(0, 6).join('\n');
      throw new Error(`Failed to load ${src.file}: ${e.message}\n${stack}`);
    }
  }

  function clearCaches() {
    try { vm.runInContext('if (typeof memoClear_ === "function") memoClear_();', context); } catch { /* noop */ }
  }

  /** Invoke a raw global function from the backend (triggers, seeds, helpers). */
  function invoke(fnName, ...args) {
    clearCaches();
    const fn = context[fnName];
    if (typeof fn !== 'function') throw new Error('Backend function not found: ' + fnName);
    return fn(...args);
  }

  /**
   * Call the API the same way the deployed Web App would: build the `e`
   * parameter object, run handleApi_ and parse the ContentService output.
   */
  function call(action, payload = {}, opts = {}) {
    clearCaches();
    const params = { action, payload };
    if (opts.token) params.token = opts.token;
    if (opts.companyId) params.companyId = opts.companyId;
    if (opts.method === 'GET') {
      for (const k of Object.keys(payload)) params[k] = typeof payload[k] === 'object' ? JSON.stringify(payload[k]) : payload[k];
    }
    const e = {
      parameter: opts.method === 'GET' ? params : { action },
      postData: opts.method === 'GET' ? undefined : {
        type: 'application/json',
        contents: JSON.stringify(params),
        length: JSON.stringify(params).length
      },
      userAgent: opts.userAgent || 'dev-harness',
      headers: opts.token ? { Authorization: 'Bearer ' + opts.token } : {}
    };
    const out = opts.method === 'GET' ? context.doGet(e) : context.doPost(e);
    const text = out.getContent();
    try { return JSON.parse(text); } catch { return { success: false, error: { message: 'non-JSON response', raw: text.slice(0, 500) } }; }
  }

  return {
    context,
    sandbox,
    call,
    invoke,
    clearCaches,
    sources: sources.map((s) => s.file),
    dev: sandbox.__dev,
    dataDir
  };
}
