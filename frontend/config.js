/**
 * ============================================================================
 *  frontend/config.js — the ONLY file you edit when deploying SiteTrack
 * ============================================================================
 *  API_URL   : your Google Apps Script Web App URL
 *              (…/exec  — not the /dev link). Leave '' when running the local
 *              dev server, which proxies /api to the real backend code.
 *  OWNER_KEY : the Platform Owner key printed by the bootstrap step. It is only
 *              used by owner.html and is never sent anywhere else.
 *
 *  Both can be overridden at runtime without redeploying:
 *    • query string  →  app.html?api=https://script.google.com/…/exec
 *    • localStorage  →  ST.api.setApiUrl('…') from the console (persists per browser)
 * ============================================================================
 */
window.SITETRACK_CONFIG = {
  /** e.g. 'https://script.google.com/macros/s/AKfycb…/exec' */
  API_URL: 'https://script.google.com/macros/s/AKfycby0MnadUSSoio7iBi3DXhtJKrqOfrFoEDzcb8fHDyc0GAxYUjMohDePBcSbCnzDBE7N/exec',

  /** Platform Owner secret (leave blank in production builds you publish). */
  OWNER_KEY: '',

  /** Product branding shown across the UI. */
  APP_NAME: 'SiteTrack',
  APP_TAGLINE: 'Construction site live attendance & workforce management',
  SUPPORT_EMAIL: 'support@yourdomain.com',

  /** Default locale: 'en' or 'hi'. Users can switch at any time. */
  DEFAULT_LOCALE: 'en',

  /** Map tiles (OpenStreetMap by default — free, no API key). */
  MAP_TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  MAP_ATTRIBUTION: '&copy; OpenStreetMap contributors',

  /** Selfie capture settings (kept small so offline sync stays fast). */
  SELFIE_WIDTH: 640,
  SELFIE_QUALITY: 0.72,

  /** Milliseconds to wait for a GPS fix before offering the QR fallback. */
  GPS_TIMEOUT_MS: 20000,

  /** Feature flags */
  FEATURES: {
    offlineAttendance: true,
    qrFallback: true,
    weatherFlag: true,
    installPrompt: true,
    publicSignup: true
  }
};
