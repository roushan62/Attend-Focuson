/**
 * ============================================================================
 *  FocusHR  —  Utils.gs
 *  Small, dependency-free helpers: execution memo, API errors, IST date maths,
 *  hashing, validation, masking, geo maths, search / sort / pagination, CSV.
 * ============================================================================
 */

var MEMO = {};

/** Wipe the per-execution memo caches (Apps Script starts each run fresh). */
function memoClear_() { MEMO = {}; }

function memoGet_(key) {
  return Object.prototype.hasOwnProperty.call(MEMO, key) ? MEMO[key] : undefined;
}
function memoSet_(key, value) { MEMO[key] = value; return value; }
function memoDrop_(prefix) {
  Object.keys(MEMO).forEach(function (k) { if (k.indexOf(prefix) === 0) delete MEMO[k]; });
}

/* --------------------------------------------------------------- errors -- */
function fail_(code, message, details) {
  var e = new Error(message || code);
  e.__api = true;
  e.code = code || 'ERROR';
  e.details = details || null;
  throw e;
}

function isApiError_(e) { return !!(e && e.__api); }

/* -------------------------------------------------------------- casting -- */
function txt_(v) { return v === null || v === undefined ? '' : String(v); }
function numVal_(v, def) {
  if (v === '' || v === null || v === undefined) return def === undefined ? 0 : def;
  var n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? (def === undefined ? 0 : def) : n;
}
function intVal_(v, def) { return Math.round(numVal_(v, def)); }
function boolVal_(v) {
  if (v === true) return true;
  if (v === false || v === '' || v === null || v === undefined) return false;
  var s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1' || s === 'Y';
}
function round2_(n) { return Math.round((numVal_(n) + Number.EPSILON) * 100) / 100; }
function round0_(n) { return Math.round(numVal_(n)); }
function sum_(arr, f) {
  return (arr || []).reduce(function (a, x) { return a + numVal_(f ? f(x) : x); }, 0);
}
function uniq_(arr) {
  var seen = {}, out = [];
  (arr || []).forEach(function (x) { var k = txt_(x); if (k && !seen[k]) { seen[k] = 1; out.push(x); } });
  return out;
}
function chunk_(arr, size) {
  var out = [];
  for (var i = 0; i < (arr || []).length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function safeJson_(s, fallback) {
  if (s === null || s === undefined || s === '') return fallback === undefined ? null : fallback;
  if (typeof s === 'object') return s;
  try { return JSON.parse(String(s)); } catch (e) { return fallback === undefined ? null : fallback; }
}
function jsonStr_(o) { return o === null || o === undefined ? '' : JSON.stringify(o); }
function escapeHtml_(s) {
  return txt_(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function uuid_() { return Utilities.getUuid(); }
function shuffleKey_(prefix) { return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

/* ---------------------------------------------------------------- dates -- */
function nowIso_() { return Utilities.formatDate(new Date(), APP.timezone, "yyyy-MM-dd'T'HH:mm:ss"); }
function todayIso_() { return Utilities.formatDate(new Date(), APP.timezone, 'yyyy-MM-dd'); }
function nowTime_() { return Utilities.formatDate(new Date(), APP.timezone, 'HH:mm'); }
function nowMillis_() { return new Date().getTime(); }
function isoToDate_(iso) {
  if (!iso) return null;
  if (iso instanceof Date) return iso;
  var s = String(iso).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function toIsoDate_(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  var d = isoToDate_(v);
  return d ? Utilities.formatDate(d, APP.timezone, 'yyyy-MM-dd') : '';
}
function isoAddDays_(iso, days) {
  var d = isoToDate_(iso);
  if (!d) return '';
  d.setDate(d.getDate() + numVal_(days));
  return Utilities.formatDate(d, APP.timezone, 'yyyy-MM-dd');
}
function isoDow_(iso) {
  var d = isoToDate_(iso);
  return d ? Number(Utilities.formatDate(d, APP.timezone, 'u')) : 0; // 1=Mon .. 7=Sun
}
function dayName_(iso) {
  var d = isoToDate_(iso);
  return d ? Utilities.formatDate(d, APP.timezone, 'EEEE') : '';
}
function daysBetweenIso_(a, b) {
  var da = isoToDate_(a), db = isoToDate_(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
function isoRange_(from, to) {
  var out = [], cur = toIsoDate_(from), end = toIsoDate_(to);
  var guard = 0;
  while (cur && end && cur <= end && guard < 400) { out.push(cur); cur = isoAddDays_(cur, 1); guard++; }
  return out;
}
function monthOfIso_(iso) { return txt_(toIsoDate_(iso)).slice(0, 7); }
function monthStart_(month) { return txt_(month).slice(0, 7) + '-01'; }
function monthEnd_(month) {
  var m = txt_(month).slice(0, 7), parts = m.split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]), 0, 12, 0, 0);
  return Utilities.formatDate(d, APP.timezone, 'yyyy-MM-dd');
}
function daysInMonth_(month) {
  var parts = txt_(month).slice(0, 7).split('-');
  return new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
}
var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthLabel_(month) {
  var p = txt_(month).slice(0, 7).split('-');
  if (p.length < 2) return txt_(month);
  return MONTH_NAMES[Number(p[1]) - 1] + ' ' + p[0];
}
function fmtDateHuman_(iso, pattern) {
  var d = isoToDate_(iso);
  if (!d) return '';
  return Utilities.formatDate(d, APP.timezone, pattern || 'dd MMM yyyy');
}
/** Financial year label for a date: 2025-05-01 -> "2025-26". */
function fyOf_(iso) {
  var d = isoToDate_(iso) || new Date();
  var y = Number(Utilities.formatDate(d, APP.timezone, 'yyyy'));
  var m = Number(Utilities.formatDate(d, APP.timezone, 'MM'));
  var start = m >= 4 ? y : y - 1;
  return start + '-' + String((start + 1) % 100).padStart(2, '0');
}
function fyStartYear_(fy) { return intVal_(txt_(fy).slice(0, 4)); }
/** 12 months (Apr..Mar) of a financial year. */
function fyMonths_(fy) {
  var start = fyStartYear_(fy), out = [];
  for (var i = 0; i < 12; i++) {
    var m = 4 + i, y = start;
    if (m > 12) { m -= 12; y += 1; }
    out.push(y + '-' + String(m).padStart(2, '0'));
  }
  return out;
}
function fyLabelFromMonth_(month) { return fyOf_(monthStart_(month)); }
function timeToMinutes_(t) {
  var m = txt_(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "HH:MM" from minutes since midnight (wraps past 24 h so overnight shifts work). */
function minutesToTime_(minutes) {
  var m = intVal_(minutes, 0);
  var sign = m < 0 ? '-' : '';
  m = Math.abs(m) % 1440;
  var h = Math.floor(m / 60);
  var mm = m % 60;
  return sign + (h < 10 ? '0' + h : '' + h) + ':' + (mm < 10 ? '0' + mm : '' + mm);
}
function minutesToHm_(mins) {
  var n = intVal_(mins);
  if (n < 0) n = 0;
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}
function hoursLabel_(mins) {
  var n = intVal_(mins);
  return (n / 60).toFixed(2) + ' h';
}
function isWeekOff_(iso, weekOff) {
  return dayName_(iso).toUpperCase() === txt_(weekOff || 'SUNDAY').toUpperCase();
}

/* -------------------------------------------------------------- hashing -- */
function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}
function sha256Hex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, txt_(text), Utilities.Charset.UTF_8));
}
function hashPassword_(password, salt) {
  var h = txt_(salt) + '|' + txt_(password) + '|focuson';
  for (var i = 0; i < APP.passwordIterations; i++) h = sha256Hex_(h + i);
  return h;
}
function randomSalt_() { return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + new Date().getTime())).slice(0, 32); }
function randomToken_(length) {
  var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var out = '', i;
  while (out.length < (length || 48)) {
    var hex = sha256Hex_(Utilities.getUuid() + new Date().getTime() + out.length + Math.random());
    for (i = 0; i < hex.length && out.length < (length || 48); i++) {
      out += chars.charAt(parseInt(hex.substr(i, 2), 16) % chars.length);
    }
  }
  return out;
}
function randomDigits_(len) {
  var out = '';
  while (out.length < len) {
    var hex = sha256Hex_(Utilities.getUuid() + new Date().getTime() + out.length + Math.random());
    for (var i = 0; i < hex.length && out.length < len; i += 2) {
      var v = parseInt(hex.substr(i, 2), 16) % 10;
      out += String(v);
    }
  }
  return out;
}
function strongTempPassword_() {
  var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ', small = 'abcdefghijkmnopqrstuvwxyz', digits = '23456789', symbols = '@#$%';
  var pool = letters + small + digits + symbols, out = '';
  out += letters.charAt(parseInt(randomDigits_(2)) % letters.length);
  out += small.charAt(parseInt(randomDigits_(2)) % small.length);
  out += digits.charAt(parseInt(randomDigits_(2)) % digits.length);
  out += symbols.charAt(parseInt(randomDigits_(2)) % symbols.length);
  while (out.length < 10) out += pool.charAt(parseInt(randomDigits_(2)) % pool.length);
  return out;
}

/* ----------------------------------------------------------- validation -- */
function normEmail_(e) { return txt_(e).trim().toLowerCase(); }
function normPhone_(p) {
  var s = txt_(p).replace(/[^\d+]/g, '');
  if (s.indexOf('+91') === 0) s = s.slice(3);
  else if (s.indexOf('91') === 0 && s.length === 12) s = s.slice(2);
  else if (s.indexOf('0') === 0 && s.length === 11) s = s.slice(1);
  return s.replace(/\D/g, '');
}
function isEmail_(e) { return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(txt_(e).trim()); }
function isPhoneIn_(p) { return /^[6-9]\d{9}$/.test(normPhone_(p)); }
function isPan_(p) { return /^[A-Z]{5}\d{4}[A-Z]$/.test(txt_(p).trim().toUpperCase()); }
function isGstin_(g) { return /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/.test(txt_(g).trim().toUpperCase()); }
function isIfsc_(c) { return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(txt_(c).trim().toUpperCase()); }
function isIsoDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(txt_(s).trim()); }
function isTime_(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(txt_(s).trim()); }
function gstinStateCode_(g) { return txt_(g).trim().slice(0, 2); }
var GST_STATE_CODES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory'
};

/* -------------------------------------------------------------- masking -- */
function maskAccount_(acc) {
  var s = txt_(acc);
  if (s.length <= 4) return s ? '****' : '';
  return 'XXXX' + s.slice(-4);
}
function maskPan_(pan) {
  var s = txt_(pan).toUpperCase();
  if (!s) return '';
  if (s.length < 6) return '****';
  return s.slice(0, 2) + '****' + s.slice(-2);
}
function maskPhone_(p) {
  var s = normPhone_(p);
  return s.length === 10 ? 'XXXXXX' + s.slice(-4) : s;
}
function maskEmail_(e) {
  var s = txt_(e);
  var at = s.indexOf('@');
  if (at < 2) return s;
  return s.slice(0, 2) + '****' + s.slice(at);
}
function aadhaarLast4_(v) {
  var digits = txt_(v).replace(/\D/g, '');
  return digits.length > 4 ? digits.slice(-4) : digits;
}

/* ------------------------------------------------------------- geo math -- */
function haversineM_(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var toRad = function (d) { return (numVal_(d) * Math.PI) / 180; };
  var dLat = toRad(lat2) - toRad(lat1), dLng = toRad(lng2) - toRad(lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * (R / 6371000));
}
function distanceLabel_(m) {
  var n = intVal_(m);
  if (n < 1000) return n + ' m';
  return (n / 1000).toFixed(2) + ' km';
}

/* ------------------------------------------- search / sort / pagination -- */
function haystack_(row, cols) {
  if (row.__hay === undefined) {
    var parts = [];
    (cols || []).forEach(function (c) { parts.push(txt_(row[c])); });
    row.__hay = parts.join(' ').toLowerCase();
  }
  return row.__hay;
}
function matchesSearch_(row, cols, q) {
  var needle = txt_(q).trim().toLowerCase();
  if (!needle) return true;
  var terms = needle.split(/\s+/);
  var hay = haystack_(row, cols);
  return terms.every(function (t) { return hay.indexOf(t) >= 0; });
}
function sortRows_(rows, key, dir) {
  if (!key) return rows;
  var sign = txt_(dir).toUpperCase() === 'DESC' ? -1 : 1;
  return rows.slice().sort(function (a, b) {
    var av = a[key], bv = b[key];
    if (typeof av === 'string' || typeof bv === 'string') {
      var as = txt_(av).toLowerCase(), bs = txt_(bv).toLowerCase();
      return as < bs ? -sign : as > bs ? sign : 0;
    }
    var an = numVal_(av), bn = numVal_(bv);
    if (an === bn) return 0;
    return an < bn ? -sign : sign;
  });
}
function paginate_(rows, page, pageSize) {
  var ps = Math.min(Math.max(intVal_(pageSize, APP.defaultPageSize), 1), APP.maxPageSize);
  var total = rows.length;
  var totalPages = Math.max(1, Math.ceil(total / ps));
  var p = Math.min(Math.max(intVal_(page, 1), 1), totalPages);
  return {
    rows: rows.slice((p - 1) * ps, p * ps),
    total: total, page: p, pageSize: ps, totalPages: totalPages
  };
}

/* ------------------------------------------------------------------ csv -- */
function csvCell_(v) {
  var s = txt_(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCsv_(rows, columns) {
  var cols = columns || (rows[0] ? Object.keys(rows[0]).filter(function (k) { return k.indexOf('__') !== 0; }) : []);
  var lines = [cols.map(function (c) { return csvCell_(c); }).join(',')];
  (rows || []).forEach(function (r) {
    lines.push(cols.map(function (c) { return csvCell_(typeof r[c] === 'object' ? jsonStr_(r[c]) : r[c]); }).join(','));
  });
  return lines.join('\r\n');
}
function base64Encode_(str) { return Utilities.base64Encode(str, Utilities.Charset.UTF_8); }
function base64Decode_(str) { return Utilities.base64Decode(str); }

/* ------------------------------------------------------------ logging ---- */
function logEvent_(level, source, message, context) {
  try {
    Db.insert(masterCtx_(), 'Logs', {
      level: txt_(level).toUpperCase(),
      source: txt_(source),
      message: txt_(message).slice(0, 900),
      context_json: context ? jsonStr_(context).slice(0, 4000) : ''
    }, { system: true });
  } catch (e) {
    Logger.log('logEvent failed: ' + e.message);
  }
}

/* ------------------------------------------------------------ payload ---- */
/** Parse the compact field spec used by ACTION_META.f */
function parseFieldSpec_(spec) {
  if (typeof spec === 'string') {
    var s = spec.trim(), req = false;
    if (s.slice(-1) === '!') { req = true; s = s.slice(0, -1); }
    return { t: s, r: req };
  }
  if (spec && typeof spec === 'object') {
    var f = {};
    Object.keys(spec).forEach(function (k) {
      f[k === 't' || k === 'type' ? 't' : k === 'r' || k === 'required' ? 'r' : k === 'en' || k === 'enum' ? 'en' : k] = spec[k];
    });
    return f;
  }
  return { t: 'string' };
}

function validatePayload_(action, fields, payload) {
  var p = payload && typeof payload === 'object' ? payload : {};
  var out = {};
  var specs = fields || {};
  Object.keys(specs).forEach(function (name) {
    var f = parseFieldSpec_(specs[name]);
    var raw = p[name];
    var missing = raw === undefined || raw === null || raw === '' || (typeof raw === 'string' && !raw.trim());
    if (missing) {
      if (f.r) fail_('VALIDATION', fieldLabel_(name) + ' is required.', { field: name });
      if (f.def !== undefined) out[name] = f.def;
      return;
    }
    var t = f.t || 'string';
    switch (t) {
      case 'string':
      case 'text':
        if (typeof raw === 'object') out[name] = jsonStr_(raw); else out[name] = txt_(raw);
        if (f.max && out[name].length > f.max) fail_('VALIDATION', fieldLabel_(name) + ' must be under ' + f.max + ' characters.', { field: name });
        if (f.min && out[name].length < f.min) fail_('VALIDATION', fieldLabel_(name) + ' must be at least ' + f.min + ' characters.', { field: name });
        if (f.en && f.en.indexOf(out[name]) < 0) fail_('VALIDATION', fieldLabel_(name) + ' must be one of: ' + f.en.join(', '), { field: name });
        break;
      case 'int':
        out[name] = intVal_(raw);
        break;
      case 'number':
      case 'money':
      case 'pct':
        out[name] = numVal_(raw);
        break;
      case 'bool':
        out[name] = boolVal_(raw);
        break;
      case 'date':
        out[name] = toIsoDate_(raw);
        if (!out[name]) fail_('VALIDATION', fieldLabel_(name) + ' must be a valid date (YYYY-MM-DD).', { field: name });
        break;
      case 'time':
        out[name] = txt_(raw).slice(0, 5);
        if (!isTime_(out[name])) fail_('VALIDATION', fieldLabel_(name) + ' must be a valid time (HH:MM).', { field: name });
        break;
      case 'email':
        out[name] = normEmail_(raw);
        if (!isEmail_(out[name])) fail_('VALIDATION', 'Enter a valid email address.', { field: name });
        break;
      case 'phone':
        out[name] = normPhone_(raw);
        if (!isPhoneIn_(out[name])) fail_('VALIDATION', fieldLabel_(name) + ' must be a valid 10-digit Indian mobile number.', { field: name });
        break;
      case 'lat':
        out[name] = numVal_(raw);
        if (out[name] < -90 || out[name] > 90) fail_('VALIDATION', 'Latitude must be between -90 and 90.', { field: name });
        break;
      case 'lng':
        out[name] = numVal_(raw);
        if (out[name] < -180 || out[name] > 180) fail_('VALIDATION', 'Longitude must be between -180 and 180.', { field: name });
        break;
      case 'array':
        if (!(raw instanceof Array)) fail_('VALIDATION', fieldLabel_(name) + ' must be a list.', { field: name });
        out[name] = raw;
        break;
      case 'object':
        if (typeof raw !== 'object' || raw instanceof Array) fail_('VALIDATION', fieldLabel_(name) + ' must be an object.', { field: name });
        out[name] = raw;
        break;
      case 'base64':
        out[name] = txt_(raw);
        break;
      default:
        out[name] = raw;
    }
  });
  // keep any extra keys (handlers may read optional pass-through values)
  Object.keys(p).forEach(function (k) { if (!(k in out) && !(k in specs)) out[k] = p[k]; });
  return out;
}

function fieldLabel_(name) {
  return txt_(name).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

/** Redact secrets before anything is written to audit/log sheets. */
function redact_(obj) {
  var copy = safeJson_(jsonStr_(obj), {});
  if (!copy || typeof copy !== 'object') return obj;
  var walk = function (o) {
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach(function (k) {
      if (SECRET_FIELDS.indexOf(k) >= 0) o[k] = '***';
      else if (o[k] && typeof o[k] === 'object') walk(o[k]);
      else if (typeof o[k] === 'string' && o[k].length > 400) o[k] = o[k].slice(0, 400) + '…';
    });
  };
  walk(copy);
  return copy;
}
