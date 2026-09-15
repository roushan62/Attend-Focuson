/**
 * ============================================================================
 *  FILE: 01_Utils.gs
 *  ROLE: Pure helpers — dates, ids, validation, geo maths, normalisation.
 *        No spreadsheet / Drive / network I/O in this file.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  Environment                                                               */
/* -------------------------------------------------------------------------- */

/**
 * True when running inside the local Node dev harness (dev/gas polyfills).
 * The harness injects `globalThis.__SITETRACK_DEV__ = true`.
 */
function isDev_() {
  try {
    return typeof globalThis !== 'undefined' && globalThis.__SITETRACK_DEV__ === true;
  } catch (e) {
    return false;
  }
}

function prop_(key, fallback) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(key);
    if (v !== null && v !== undefined && String(v).length) return String(v);
  } catch (e) {
    Logger.log('prop_ read failed for ' + key + ': ' + e.message);
  }
  if (typeof fallback !== 'undefined') return fallback;
  return '';
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value === null || typeof value === 'undefined' ? '' : String(value));
  return true;
}

function platformTimezone_() {
  return prop_(PROP.TIMEZONE, 'Asia/Kolkata') || 'Asia/Kolkata';
}

function devMode_() {
  return String(prop_(PROP.DEV_MODE, 'false')).toLowerCase() === 'true' || isDev_();
}

/* -------------------------------------------------------------------------- */
/*  Dates & time                                                              */
/* -------------------------------------------------------------------------- */

/** Current time in the platform/company timezone as a Date object (UTC-based). */
function now_() {
  return new Date();
}

function fmtDate_(d, tz) {
  return Utilities.formatDate(toDate_(d), tz || platformTimezone_(), 'yyyy-MM-dd');
}

function fmtTime_(d, tz) {
  return Utilities.formatDate(toDate_(d), tz || platformTimezone_(), 'HH:mm:ss');
}

function fmtDateTime_(d, tz) {
  return Utilities.formatDate(toDate_(d), tz || platformTimezone_(), 'yyyy-MM-dd HH:mm:ss');
}

function iso_(d, tz) {
  return Utilities.formatDate(toDate_(d), tz || platformTimezone_(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** Today's date string (yyyy-MM-dd) in the given timezone. */
function today_(tz) {
  return fmtDate_(new Date(), tz);
}

/** Coerce anything (Date, string, epoch millis) into a Date. */
function toDate_(v) {
  if (v instanceof Date) return v;
  if (v === null || typeof v === 'undefined' || v === '') return new Date(0);
  if (typeof v === 'number') return new Date(v);
  var s = String(v).trim();
  // yyyy-MM-dd (optionally with time)
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(Date.UTC(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0
    ));
  }
  if (/^\d{10,13}$/.test(s)) return new Date(s.length === 10 ? Number(s) * 1000 : Number(s));
  var d = new Date(s);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

/** Days between two dates (inclusive of the start day, whole days only). */
function daysBetween_(fromIso, toIso) {
  var a = toDate_(fromIso).getTime();
  var b = toDate_(toIso).getTime();
  if (b < a) { var t = a; a = b; b = t; }
  return Math.floor((b - a) / 86400000) + 1;
}

/** Inclusive list of yyyy-MM-dd strings between two dates. */
function dateRange_(fromIso, toIso) {
  var out = [];
  var cur = toDate_(fromIso);
  var end = toDate_(toIso);
  if (end.getTime() < cur.getTime()) end = cur;
  var guard = 0;
  while (cur.getTime() <= end.getTime() && guard < 400) {
    out.push(Utilities.formatDate(cur, 'UTC', 'yyyy-MM-dd'));
    cur = new Date(cur.getTime() + 86400000);
    guard++;
  }
  return out;
}

/** yyyy-MM of a date string. */
function monthKey_(dateIso) {
  return String(dateIso || '').substring(0, 7);
}

/** First and last day of a yyyy-MM month. */
function monthBounds_(yyyymm) {
  var parts = String(yyyymm).split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var first = Utilities.formatDate(new Date(Date.UTC(y, m - 1, 1)), 'UTC', 'yyyy-MM-dd');
  var lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  var last = Utilities.formatDate(new Date(Date.UTC(y, m - 1, lastDay)), 'UTC', 'yyyy-MM-dd');
  return { from: first, to: last, days: lastDay };
}

/** Shift a yyyy-MM month by n months. */
function shiftMonth_(yyyymm, n) {
  var parts = String(yyyymm).split('-');
  var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1 + n, 1));
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM');
}

/** 0=Sunday … 6=Saturday for a yyyy-MM-dd string. */
function weekdayOf_(dateIso) {
  return toDate_(dateIso).getUTCDay();
}

/** "HH:mm" → minutes from midnight. */
function timeToMinutes_(hhmm) {
  var s = String(hhmm || '').trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes from midnight of a datetime, in the given timezone. */
function minutesOfDay_(dateObj, tz) {
  var s = Utilities.formatDate(toDate_(dateObj), tz || platformTimezone_(), 'HH:mm');
  return timeToMinutes_(s);
}

function addMinutes_(dateObj, mins) {
  return new Date(toDate_(dateObj).getTime() + mins * 60000);
}

/* -------------------------------------------------------------------------- */
/*  Identifiers                                                               */
/* -------------------------------------------------------------------------- */

function uuid_() {
  try {
    return Utilities.getUuid();
  } catch (e) {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
}

function shortId_(len) {
  var n = len || 6;
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  var u = uuid_().replace(/-/g, '').toUpperCase();
  for (var i = 0; i < u.length && out.length < n; i++) {
    var c = u.charAt(i);
    out += chars.indexOf(c) >= 0 ? c : chars[(parseInt(c, 16) || 0) % chars.length];
  }
  return out.substring(0, n);
}

function id_(prefix) {
  return prefix + '-' + uuid_().substring(0, 8).toUpperCase();
}

/** e.g. FOI-2026-014 (§4 project code). */
function projectCode_(prefix, seq) {
  var p = (prefix || 'PRJ').toString().toUpperCase().replace(/[^A-Z]/g, '').substring(0, 4) || 'PRJ';
  var year = new Date().getUTCFullYear();
  var n = ('000' + (Number(seq) || 1)).slice(-3);
  return p + '-' + year + '-' + n;
}

function randomPassword_(len) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var out = '';
  var raw = uuid_().replace(/-/g, '') + uuid_().replace(/-/g, '');
  for (var i = 0; i < raw.length && out.length < (len || 10); i++) {
    out += chars.charAt(parseInt(raw.charAt(i), 16) % chars.length);
  }
  return out.substring(0, len || 10) + '#' + String(new Date().getUTCFullYear()).slice(2);
}

function otp6_() {
  var raw = uuid_().replace(/-/g, '');
  var n = 0;
  for (var i = 0; i < 8; i++) n = (n * 31 + parseInt(raw.charAt(i), 16)) % 1000000;
  return ('000000' + n).slice(-6);
}

/* -------------------------------------------------------------------------- */
/*  Validation & normalisation                                                */
/* -------------------------------------------------------------------------- */

function isBlank_(v) {
  return v === null || typeof v === 'undefined' || String(v).trim() === '';
}

function str_(v, maxLen) {
  if (v === null || typeof v === 'undefined') return '';
  var s = String(v).trim();
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
  return s;
}

function num_(v, fallback) {
  if (v === null || typeof v === 'undefined' || v === '') return typeof fallback === 'undefined' ? 0 : fallback;
  var n = Number(String(v).replace(/[^0-9eE\.\-\+]/g, ''));
  return isNaN(n) ? (typeof fallback === 'undefined' ? 0 : fallback) : n;
}

function bool_(v, def) {
  if (v === null || typeof v === 'undefined' || v === '') return !!def;
  var s = String(v).trim().toLowerCase();
  if (['y', 'yes', 'true', '1', 'on'].indexOf(s) >= 0) return true;
  if (['n', 'no', 'false', '0', 'off'].indexOf(s) >= 0) return false;
  return !!def;
}

function yn_(v, def) { return bool_(v, def) ? 'Y' : 'N'; }

function emailOk_(v) {
  return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(String(v || '').trim());
}

/** Accepts 10-digit Indian numbers, +91… and generic international formats. */
function normaliseMobile_(v) {
  var s = String(v || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.indexOf('+') !== 0) {
    if (s.length === 10) s = '+91' + s;
    else if (s.length === 11 && s.charAt(0) === '0') s = '+91' + s.substring(1);
    else if (s.length === 12 && s.substring(0, 2) === '91') s = '+' + s;
    else s = '+' + s;
  }
  return s;
}

function mobileOk_(v) {
  var s = normaliseMobile_(v);
  return /^\+\d{8,15}$/.test(s);
}

function isIsoDate_(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());
}

function latOk_(v) { var n = num_(v, 999); return n >= -90 && n <= 90; }
function lngOk_(v) { var n = num_(v, 999); return n >= -180 && n <= 180; }

function assert_(condition, message, code) {
  if (!condition) throw new ApiError_(message || 'Validation failed', code || 400);
}

/** Error type carrying an HTTP-ish status code. */
function ApiError_(message, code) {
  var e = new Error(message);
  e.name = 'ApiError';
  e.code = code || 400;
  return e;
}

function requireFields_(obj, fields) {
  var missing = [];
  for (var i = 0; i < fields.length; i++) {
    if (isBlank_(obj ? obj[fields[i]] : '')) missing.push(fields[i]);
  }
  if (missing.length) throw new ApiError_('Missing required field(s): ' + missing.join(', '), 400);
  return true;
}

function inList_(value, list) {
  return list.indexOf(String(value)) >= 0;
}

function pickOne_(value, list, fallback) {
  return inList_(value, list) ? String(value) : (typeof fallback === 'undefined' ? list[0] : fallback);
}

/* -------------------------------------------------------------------------- */
/*  JSON helpers                                                              */
/* -------------------------------------------------------------------------- */

function jsonParse_(s, fallback) {
  if (typeof s === 'object' && s !== null) return s;
  if (isBlank_(s)) return typeof fallback === 'undefined' ? {} : fallback;
  try { return JSON.parse(String(s)); } catch (e) { return typeof fallback === 'undefined' ? {} : fallback; }
}

function jsonString_(o) {
  try { return JSON.stringify(o === null || typeof o === 'undefined' ? {} : o); } catch (e) { return '{}'; }
}

function jsonList_(s) {
  var v = jsonParse_(s, []);
  if (Object.prototype.toString.call(v) !== '[object Array]') {
    if (typeof v === 'string' && v.length) return v.split(',');
    return [];
  }
  return v;
}

/* -------------------------------------------------------------------------- */
/*  Geo maths                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Haversine distance in metres between two lat/long pairs (§12.3).
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var toRad = function (x) { return Number(x) * Math.PI / 180; };
  var a1 = toRad(lat1), a2 = toRad(lat2);
  var dLat = toRad(lat2 - lat1);
  var dLon = toRad(lon2 - lon1);
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a1) * Math.cos(a2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Approximate lat/long bounding box for a radius (used for cheap pre-filters). */
function boundingBox_(lat, lon, radiusMeters) {
  var dLat = radiusMeters / 111320;
  var dLon = radiusMeters / (111320 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
  return { north: lat + dLat, south: lat - dLat, east: lon + dLon, west: lon - dLon };
}

/**
 * Generates a compact site QR payload. Printed at the site office as a GPS
 * fallback (§9.3). Format: SITETRACK|<companyId>|<projectId>|<challenge>
 */
function makeQrPayload_(companyId, projectId, challenge) {
  return ['SITETRACK', companyId, projectId, challenge || uuid_().substring(0, 12)].join('|');
}

/* -------------------------------------------------------------------------- */
/*  Misc                                                                      */
/* -------------------------------------------------------------------------- */

function chunk_(arr, size) {
  var out = [];
  for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function uniq_(arr) {
  var seen = {}, out = [];
  for (var i = 0; i < arr.length; i++) {
    var k = String(arr[i]);
    if (!seen[k]) { seen[k] = true; out.push(arr[i]); }
  }
  return out;
}

function indexBy_(rows, key) {
  var map = {};
  for (var i = 0; i < rows.length; i++) map[String(rows[i][key])] = rows[i];
  return map;
}

function groupBy_(rows, keyFn) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var k = String(keyFn(rows[i], i));
    if (!map[k]) map[k] = [];
    map[k].push(rows[i]);
  }
  return map;
}

function sortBy_(rows, keyFn, desc) {
  var copy = rows.slice();
  copy.sort(function (a, b) {
    var ka = keyFn(a), kb = keyFn(b);
    if (ka === kb) return 0;
    var r = ka > kb ? 1 : -1;
    return desc ? -r : r;
  });
  return copy;
}

function maskString_(s, keep) {
  var v = String(s || '');
  var k = keep || 4;
  if (v.length <= k) return v;
  return 'XXXX' + v.slice(-k);
}

function truncate_(s, n) {
  var v = String(s === null || typeof s === 'undefined' ? '' : s);
  return v.length > n ? v.substring(0, n) + '…' : v;
}

/** Stable deep clone through JSON (Sheets values are always JSON-safe). */
function clone_(o) { return jsonParse_(jsonString_(o), {}); }

/** Simple in-memory per-execution memo to avoid re-reading the same sheet. */
var MEMO_ = {};
function memo_(key, producer) {
  if (MEMO_.hasOwnProperty(key)) return MEMO_[key];
  var v = producer();
  MEMO_[key] = v;
  return v;
}
function memoClear_() { MEMO_ = {}; }
