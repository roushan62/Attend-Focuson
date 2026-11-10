/**
 * FocusOn HRMS 2.0 — Node mock of Google Apps Script services.
 * Allows the src/*.gs server code to run in Node for smoke testing.
 * Implements: PropertiesService, CacheService, LockService, Session,
 * ScriptApp, SpreadsheetApp, Sheet/Range, DriveApp, File/Folder,
 * HtmlService, MailApp, Utilities, Date (fixed), Blob.
 */

// ---------- fixed "now" (Asia/Kolkata-ish, ISO) ----------
const NOW = new Date('2026-11-10T10:00:00+05:30');
let _now = () => new Date(NOW.getTime());
global.Date = class extends Date {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW.getTime(); }
};

// ---------- Utilities ----------
function computeDigest(algo, data) {
  const crypto = require('crypto');
  const hash = crypto.createHash(algo === 'SHA_256' ? 'sha256' : 'sha1').update(typeof data === 'string' ? data : Buffer.from(data)).digest();
  return Array.from(hash); // array of 0..255 bytes
}
function base64Decode(str) { return Buffer.from(str, 'base64'); }
function base64Encode(buf) { return Buffer.from(buf).toString('base64'); }
function formatDate(date, tz, fmt) {
  // minimal: yyyy-MM-dd, yyyy-MM-dd'T'HH:mm:ss, HH:mm:ss
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  if (fmt === 'yyyy-MM-dd') return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  if (fmt === 'yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'') {
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0') + 'Z';
  }
  if (fmt === 'yyyy-MM-dd HH:mm:ss') {
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  if (fmt === 'HH:mm:ss') return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  if (fmt === 'HH:mm') return pad(d.getHours()) + ':' + pad(d.getMinutes());
  return d.toISOString();
}
function newBlob(data, mime, name) { return new BlobProxy(data, mime, name); }
class BlobProxy {
  constructor(data, mime, name) { this.data = data; this.mime = mime; this.name = name; }
  getAs(mime) { return this; }
  setName(n) { this.name = n; return this; }
  getBytes() { return this.data; }
}

// ---------- Script Properties / Cache / Lock ----------
const _props = new Map();
const _cache = new Map();
class ScriptProperties { getProperty(k) { return _props.get(k) || null; } setProperty(k, v) { _props.set(k, String(v)); } deleteProperty(k) { _props.delete(k); } }
class PropertiesService { static getScriptProperties() { return new ScriptProperties(); } }
class CacheService {
  static getScriptCache() {
    return { get(k) { return _cache.get(k) || null; }, put(k, v, ttl) { _cache.set(k, String(v)); }, remove(k) { _cache.delete(k); } };
  }
}
class LockService {
  static getScriptLock() {
    let locked = false;
    return { waitLock(sec) { return true; }, releaseLock() { locked = false; } };
  }
}

// ---------- Session / ScriptApp ----------
class Session { static getScriptTimeZone() { return 'Asia/Kolkata'; } }
const _triggers = [];
class ScriptApp {
  static getProjectTriggers() { return _triggers; }
  static newTrigger(name) { return { timeBased: () => ({ everyHours: () => ({ create: () => { _triggers.push(name); return { getHandlerFunction: () => name, getEventType: () => 'time' }; } }), atHour: () => ({ create: () => { _triggers.push(name); return { getHandlerFunction: () => name, getEventType: () => 'time' }; } }) }) }; }
}

// ---------- Spreadsheet ----------
const _sheets = new Map(); // spreadsheetId -> {name, sheets: Map(sheetName -> {headers:[], rows:[][]})}
class Range {
  constructor(sheet, row, col, numRows, numCols) { this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols; }
  getValues() {
    const sh = _sheets.get(this.sheet.ssId).sheets.get(this.sheet.name);
    const out = [];
    for (let r = this.row - 1; r < this.row - 1 + this.numRows; r++) {
      const row = [];
      for (let c = this.col - 1; c < this.col - 1 + this.numCols; c++) row.push(sh.rows[r] ? sh.rows[r][c] : '');
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    const sh = _sheets.get(this.sheet.ssId).sheets.get(this.sheet.name);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < values[i].length; j++) {
        if (!sh.rows[this.row - 1 + i]) sh.rows[this.row - 1 + i] = [];
        sh.rows[this.row - 1 + i][this.col - 1 + j] = values[i][j];
      }
    }
    if (this.row === 1 && values.length === 1) sh.headers = values[0];
    return this;
  }
  setValue(v) { this.setValues([[v]]); return this; }
  setFontWeight() { return this; }
  getLastRow() { return _sheets.get(this.sheet.ssId).sheets.get(this.sheet.name).rows.length; }
  getLastColumn() { return _sheets.get(this.sheet.ssId).sheets.get(this.sheet.name).headers.length; }
  deleteRow(r) { const sh = _sheets.get(this.sheet.ssId).sheets.get(this.sheet.name); sh.rows.splice(r - 1, 1); return this; }
}
class Sheet {
  constructor(ssId, name) { this.ssId = ssId; this.name = name; }
  getParent() { return _sheets.get(this.ssId).ss; }
  getName() { return this.name; }
  getRange(r, c, nR, nC) { return new Range(this, r, c, nR || 1, nC || 1); }
  getLastRow() { const sh = _sheets.get(this.ssId).sheets.get(this.name); return sh.rows.length; }
  getLastColumn() { const sh = _sheets.get(this.ssId).sheets.get(this.name); return sh.headers.length; }
  insertSheet(name) { return _sheets.get(this.ssId).addSheet(name); }
  getSheets() { return Array.from(_sheets.get(this.ssId).sheets.values()).map((s) => ({ getName: () => s.name, getLastRow: () => s.rows.length, getLastColumn: () => s.headers.length, getRange: (...a) => new Range({ ssId: this.ssId, name: s.name }, ...a) })); }
}
class Spreadsheet {
  constructor(id, name) { this.id = id; this.name = name; _sheets.set(id, { name, sheets: new Map() }); }
  getId() { return this.id; }
  getSheetByName(name) { const s = _sheets.get(this.id).sheets.get(name); return s ? new Sheet(this.id, name) : null; }
  insertSheet(name) { return this.addSheet(name); }
  addSheet(name) { _sheets.get(this.id).sheets.set(name, { name, headers: [], rows: [] }); return new Sheet(this.id, name); }
}
class SpreadsheetApp {
  static openById(id) { return _sheets.has(id) ? _sheets.get(id).ss || (_sheets.get(id).ss = new Spreadsheet(id, _sheets.get(id).name)) : null; }
  static create(name) { const id = 'ss_' + Math.random().toString(36).slice(2, 9); const s = new Spreadsheet(id, name); _sheets.get(id).ss = s; return s; }
}

// ---------- Drive ----------
const _files = new Map(); // fileId -> {name, mime, blob, folderId}
const _folders = new Map(); // folderId -> {name, files:[], folders:[]}
let _rootId = 'root_1';
_folders.set(_rootId, { name: 'Root', files: [], folders: [] });
class File {
  constructor(id) { const f = _files.get(id); this.id = id; this.name = f.name; this.mime = f.mime; this.blob = f.blob; this.folderId = f.folderId; this.created = new Date(); }
  getId() { return this.id; }
  getName() { return this.name; }
  getSize() { return this.blob ? this.blob.data.length || 0 : 0; }
  getDateCreated() { return this.created; }
  makeCopy(name, destFolder) { return DriveApp.createFile(this.blob.data, this.blob.mime, name).then ? null : null; }
}
File.prototype.makeCopy = function(name, destFolder) {
  const f = _files.get(this.id);
  const nid = 'file_' + Math.random().toString(36).slice(2, 9);
  _files.set(nid, { name, mime: f.mime, blob: f.blob, folderId: destFolder ? destFolder.id : _rootId });
  if (destFolder) destFolder.files.push(nid);
  return new File(nid);
};
class Folder {
  constructor(id) { const f = _folders.get(id); this.id = id; this.name = f.name; this.folders = []; }
  getId() { return this.id; }
  getName() { return this.name; }
  createFolder(name) { const nid = 'folder_' + Math.random().toString(36).slice(2, 9); _folders.set(nid, { name, files: [], folders: [] }); this.folders.push(nid); return new Folder(nid); }
  getFoldersByName(name) { const found = this.folders.filter((fid) => _folders.get(fid).name === name).map((fid) => new Folder(fid)); return { hasNext: () => found.length > 0, next: () => found.shift() || null }; }
  createFile(blob, mime, name) {
    const nid = 'file_' + Math.random().toString(36).slice(2, 9);
    const b = blob instanceof BlobProxy ? blob : new BlobProxy(blob, mime, name);
    _files.set(nid, { name, mime: b.mime, blob: b, folderId: this.id });
    this.files.push(nid);
    return new File(nid);
  }
  getFiles() { const files = this.files.map((fid) => new File(fid)); let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; }
}
class DriveApp {
  static getRootFolder() { return new Folder(_rootId); }
  static getFileById(id) { if (_files.has(id)) return new File(id); if (_sheets.has(id)) { var s = _sheets.get(id).ss || new Spreadsheet(id, _sheets.get(id).name); return { getId: function(){return id;}, getName: function(){return s.name;}, makeCopy: function(name, destFolder){ return DriveApp.createFile('', 'application/vnd.google-apps.spreadsheet', name); } }; } return null; }
  static getFolderById(id) { return _folders.has(id) ? new Folder(id) : null; }
  static createFile(data, mime, name) {
    const nid = 'file_' + Math.random().toString(36).slice(2, 9);
    const b = data instanceof BlobProxy ? data : new BlobProxy(data, mime, name);
    _files.set(nid, { name, mime: b.mime, blob: b, folderId: _rootId });
    _folders.get(_rootId).files.push(nid);
    return new File(nid);
  }
}

// ---------- HtmlService / MailApp ----------
class HtmlService {
  static createTemplateFromFile(file) {
    return { evaluate: () => ({ setXFrameOptionsMode: (x) => ({ addMetaTag: (a, b) => ({ getContent: () => '<html>template:' + file + '</html>' }) }), getContent: () => '<html>template:' + file + '</html>' }) };
  }
  static createHtmlOutputFromFile(file) { return { getContent: () => 'CONTENT_OF_' + file }; }
}
class MailApp {
  static sendEmail(o) { console.log('[MAIL]', o.to, '|', o.subject, '|', (o.body || o.htmlBody || '').slice(0, 80)); return { responseCode: 200 }; }
}

// ---------- expose globals ----------
global.PropertiesService = PropertiesService;
global.CacheService = CacheService;
global.LockService = LockService;
global.Session = Session;
global.ScriptApp = ScriptApp;
global.SpreadsheetApp = SpreadsheetApp;
global.DriveApp = DriveApp;
global.HtmlService = HtmlService;
global.MailApp = MailApp;
global.Utilities = { computeDigest, base64Decode, base64Encode, formatDate, newBlob, DigestAlgorithm: { SHA_256: 'SHA_256' } };
global.Blob = BlobProxy;
global.console = global.console || { log: () => {}, error: () => {} };

module.exports = { Utilities, PropertiesService, CacheService, LockService, Session, ScriptApp, SpreadsheetApp, DriveApp, HtmlService, MailApp };
