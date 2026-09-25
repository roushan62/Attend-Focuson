/* ============================================================================
   22_Frontend.gs — serve the WHOLE SiteTrack frontend from the same Apps Script
   Web App that answers the JSON API. Nothing is hosted anywhere else: one
   /exec URL gives you the public site, both sign-in portals, the company
   console, the employee app and the admin panel.
   ========================================================================== */

/* ---- include helpers (used by the tmpl_*.html pages via <?!= … ?>) --- */

/**
 * Inline one of the project's own files into a page.
 *
 * createTemplateFromFile().evaluate() (not createHtmlOutputFromFile) is used
 * on purpose: it also evaluates scriptlets inside the included file — which is
 * how tmpl_config_js.html reads its OWN web-app URL with
 * `<?= ScriptApp.getService().getUrl() ?>` so that API_URL always points at the
 * deployment that served the page. No domain is ever hard-coded.
 */
function includeFile_(name) {
  return HtmlService.createTemplateFromFile(name).evaluate().getContent();
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

/**
 * Every screen is served from this one Web-App URL as  ?page=<route>.
 *
 *   ?page=index     public landing page (choose a portal)
 *   ?page=company   COMPANY sign-in  — SuperAdmin / Admin / SubAdmin  → ?page=app
 *   ?page=employee  EMPLOYEE sign-in — site workers                   → ?page=mobile
 *   ?page=login     small chooser that points at the two portals above
 *   ?page=signup    company registration request (goes to the admin panel)
 *   ?page=status    public tracker for a signup request
 *   ?page=app       company console (staff)
 *   ?page=mobile    employee app (worker)
 *   ?page=owner     platform admin panel (signup approvals, companies) — ?page=admin too
 */
var PAGES = {
  '':         { file: 'tmpl_index',    title: 'SiteTrack — site attendance on Google Sheets' },
  'index':    { file: 'tmpl_index',    title: 'SiteTrack — site attendance on Google Sheets' },
  'login':    { file: 'tmpl_login',    title: 'Sign in — SiteTrack' },
  'company':  { file: 'tmpl_company',  title: 'Company sign in — SiteTrack' },
  'employee': { file: 'tmpl_employee', title: 'Employee sign in — SiteTrack' },
  'signup':   { file: 'tmpl_signup',   title: 'Register your company — SiteTrack' },
  'status':   { file: 'tmpl_status',   title: 'Application status — SiteTrack' },
  'app':      { file: 'tmpl_app',      title: 'SiteTrack — company console' },
  'mobile':   { file: 'tmpl_mobile',   title: 'SiteTrack — employee app' },
  'owner':    { file: 'tmpl_owner',    title: 'SiteTrack — admin panel' },
  'admin':    { file: 'tmpl_owner',    title: 'SiteTrack — admin panel' }
};

function pageRoute_(page) {
  var key = String(page === undefined || page === null ? '' : page).toLowerCase().trim();
  return PAGES[key] || PAGES[''];
}

function servePage_(page) {
  var route = pageRoute_(page);
  var tmpl = HtmlService.createTemplateFromFile(route.file);
  return tmpl.evaluate()
    .setTitle(route.title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('robots', 'noindex');
}