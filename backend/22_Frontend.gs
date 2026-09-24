/* ============================================================================
   22_Frontend.gs — serve the full SiteTrack frontend from the Apps Script
   web-app URL.  No external hosting needed: one /exec URL serves both the
   JSON API and the HTML pages.

   The Apps Script editor needs exactly two kinds of files beyond these .gs
   modules (see docs/SETUP.md for the full copy-paste checklist):
     · HTML files  — backend/*.html  → created as type "HTML" in the editor
     · the manifest — backend/appsscript.json → Project settings
   ========================================================================== */

/* ---- include helpers (used by tmpl_*.html via <?!= … ?>) -------------- */

function includeFile_(name) {
  var raw = HtmlService.createHtmlOutputFromFile(name).getContent();
  // Scriptlets inside an included file (e.g. the auto API URL in
  // tmpl_config_js) are NOT evaluated by getContent() — they only run inside
  // a Template.evaluate().  Detect them and evaluate the file as a nested
  // template; plain CSS/JS assets are returned untouched.
  if (/<\?[\!=]/.test(raw)) {
    raw = HtmlService.createTemplateFromFile(name).evaluate().getContent();
  }
  return raw;
}

function includeCss_(name) {
  return '<style>\n' + includeFile_(name) + '\n</style>';
}

function includeJs_(name) {
  return '<script>\n' + includeFile_(name) + '\n</script>';
}

/* ---- inline SVG logo (replaces <img src="logo.svg">) ---------------- */

function logoSvg_() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="32" height="32" role="img">' +
    '<defs><linearGradient id="lg" x1="0" y1="0" x2="0.6" y2="1">' +
    '<stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/>' +
    '</linearGradient></defs>' +
    '<rect x="1" y="1" width="62" height="62" rx="15" fill="url(#lg)"/>' +
    '<circle cx="32" cy="31" r="21.5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.6" stroke-dasharray="6 5"/>' +
    '<path d="M32 12.5c-6.6 0-12 5.4-12 12 0 8.4 12 21 12 21s12-12.6 12-21c0-6.6-5.4-12-12-12z" fill="#fff"/>' +
    '<path d="M25.4 25.6l4.9 5 8.4-9.3" fill="none" stroke="#b45309" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
}

function logoSvgLarge_() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="56" height="56" role="img">' +
    '<defs><linearGradient id="lg" x1="0" y1="0" x2="0.6" y2="1">' +
    '<stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/>' +
    '</linearGradient></defs>' +
    '<rect x="1" y="1" width="62" height="62" rx="15" fill="url(#lg)"/>' +
    '<circle cx="32" cy="31" r="21.5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.6" stroke-dasharray="6 5"/>' +
    '<path d="M32 12.5c-6.6 0-12 5.4-12 12 0 8.4 12 21 12 21s12-12.6 12-21c0-6.6-5.4-12-12-12z" fill="#fff"/>' +
    '<path d="M25.4 25.6l4.9 5 8.4-9.3" fill="none" stroke="#b45309" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
}

/* ---- page router ----------------------------------------------------- */

function servePage_(page) {
  var pages = {
    '':         'tmpl_index',
    'index':    'tmpl_index',
    'login':    'tmpl_login',
    'signup':   'tmpl_signup',
    'status':   'tmpl_status',
    'app':      'tmpl_app',
    'mobile':   'tmpl_mobile',
    'owner':    'tmpl_owner'
  };
  var titles = {
    'tmpl_index':  'SiteTrack — GPS-verified construction site attendance',
    'tmpl_login':  'Sign in — SiteTrack',
    'tmpl_signup': 'Register your company — SiteTrack',
    'tmpl_status': 'Application status — SiteTrack',
    'tmpl_app':    'SiteTrack — Staff console',
    'tmpl_mobile': 'SiteTrack — Worker app',
    'tmpl_owner':  'Platform owner — SiteTrack'
  };
  var key = Object.prototype.hasOwnProperty.call(pages, page) ? page : '';
  var file = pages[key];
  try {
    var tmpl = HtmlService.createTemplateFromFile(file);
    var output = tmpl.evaluate()
      .setTitle(titles[file] || 'SiteTrack')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    return output;
  } catch (err) {
    // Most likely an HTML file that was not created in the Apps Script
    // editor.  Say exactly which one instead of showing a blank page.
    return HtmlService.createHtmlOutput(pageSetupError_(file, err))
      .setTitle('SiteTrack — setup incomplete')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
}

/** Friendly, secret-free setup error page (shown only when a file is missing). */
function pageSetupError_(file, err) {
  var detail = '';
  try { detail = String((err && (err.message || err)) || ''); } catch (e) { detail = ''; }
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>SiteTrack — setup incomplete</title>',
    '<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;',
    'color:#e6edf7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}',
    '.card{max-width:680px;background:#111c33;border:1px solid #22314f;border-radius:18px;padding:34px 30px}',
    'h1{margin:0 0 8px;font-size:24px}code{background:#0b1220;padding:2px 6px;border-radius:6px;color:#7dd3fc}',
    'p,li{line-height:1.6;color:#a9b7cf;font-size:14px}ol{padding-left:20px}</style></head><body>',
    '<div class="card">',
    '<h1>🧩 SiteTrack setup incomplete</h1>',
    '<p>The page could not be rendered because an HTML file is missing from this Apps Script project.',
    ' Nothing is broken in your data — this is a copy-paste step that was skipped.</p>',
    '<p>Missing file: <code>' + escapeHtml_(file) + '.html</code></p>',
    '<ol>',
    '<li>Open your project at <code>script.google.com</code>.</li>',
    '<li>Click <b>+ → HTML</b>, name it exactly <code>' + escapeHtml_(file) + '</code> (the editor adds .html).</li>',
    '<li>Paste the contents of <code>' + escapeHtml_(file) + '.html</code> from the repository.</li>',
    '<li>Save, then <b>Deploy → Manage deployments → ✏️ → New version → Deploy</b>.</li>',
    '</ol>',
    '<p>Full checklist: <code>docs/SETUP.md</code> in the repository.' +
    (detail ? '<br>Technical detail: <code>' + escapeHtml_(detail) + '</code>' : '') + '</p>',
    '</div></body></html>'
  ].join('');
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
