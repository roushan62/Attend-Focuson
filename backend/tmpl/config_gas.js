/**
 * config_gas.js — Apps Script auto-detect config.
 * API_URL is set automatically from the script's own URL.
 * No manual configuration needed.
 */
(function () {
  var scriptUrl = '<?= ScriptApp.getService().getUrl() ?>';
  window.SITETRACK_CONFIG = {
    API_URL: scriptUrl || '',
    OWNER_KEY: '',
    APP_NAME: 'SiteTrack',
    APP_TAGLINE: 'Construction site live attendance & workforce management',
    SUPPORT_EMAIL: 'support@yourdomain.com',
    DEFAULT_LOCALE: 'en',
    MAP_TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    MAP_ATTRIBUTION: '&copy; OpenStreetMap contributors',
    SELFIE_WIDTH: 640,
    SELFIE_QUALITY: 0.72,
    GPS_TIMEOUT_MS: 20000,
    FEATURES: {
      offlineAttendance: true,
      qrFallback: true,
      weatherFlag: true,
      installPrompt: false,
      publicSignup: true
    }
  };
})();