/* ============================================================================
   22_Frontend.gs — serve the full SiteTrack frontend from the Apps Script
   web-app URL.  No external hosting needed: one /exec URL serves both the
   JSON API and the HTML pages.
   ========================================================================== */

/* ---- include helpers (used by tmpl/*.html via <?!= … ?>) ------------- */

function includeFile_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
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
  var file = pages[page] || pages[''];
  var tmpl = HtmlService.createTemplateFromFile(file);
  var output = tmpl.evaluate()
    .setTitle('SiteTrack')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return output;
}