/* ============================================================================
   frontend/assets/js/api.js
   API client, session store, device fingerprint, GPS/camera capture and the
   offline-first attendance queue (§9.1, §9.2). No dependencies, no build step.
   ========================================================================== */
window.ST = window.ST || {};

(function () {
  'use strict';

  var CFG = window.SITETRACK_CONFIG || {};

  /* ------------------------------------------------------------- storage */
  var KEY = {
    token: 'sitetrack.token',
    session: 'sitetrack.session',
    apiUrl: 'sitetrack.apiUrl',
    ownerToken: 'sitetrack.ownerToken',
    fp: 'sitetrack.deviceFingerprint',
    locale: 'sitetrack.locale',
    theme: 'sitetrack.theme',
    queue: 'sitetrack.offlineQueue',
    lastSync: 'sitetrack.lastSync'
  };

  var store = {
    get: function (k, fallback) {
      try { var v = localStorage.getItem(k); return v === null ? fallback : v; } catch (e) { return fallback; }
    },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { } },
    json: function (k, fallback) {
      try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    setJson: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };

  /* ------------------------------------------------------------- base URL */
  function baseUrl() {
    var q = new URLSearchParams(location.search).get('api');
    if (q) { store.set(KEY.apiUrl, q); return q.replace(/\/$/, ''); }
    var saved = store.get(KEY.apiUrl, '');
    if (saved) return saved.replace(/\/$/, '');
    var cfg = (CFG.API_URL || '').trim();
    return cfg ? cfg.replace(/\/$/, '') : '';
  }

  function endpoint() {
    var b = baseUrl();
    return b === '' ? 'api' : b; // relative works on the dev server + any reverse proxy
  }

  function isLocalProxy() { return baseUrl() === ''; }

  /* --------------------------------------------------- device fingerprint */
  /**
   * A stable, privacy-friendly browser fingerprint used for the anti-proxy
   * device lock. It mixes hardware/browser signals with a random per-install
   * id, so clearing site data or switching phones produces a new fingerprint.
   */
  function fingerprint() {
    var seed = store.get(KEY.fp, '');
    if (seed) return seed;
    var parts = [
      navigator.userAgent || '', navigator.language || '',
      (screen.width || 0) + 'x' + (screen.height || 0) + 'x' + (screen.colorDepth || 0),
      new Date().getTimezoneOffset(), navigator.hardwareConcurrency || 0,
      navigator.platform || '', (navigator.deviceMemory || '')
    ];
    var raw = parts.join('|') + '|' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    seed = hashHex(raw).slice(0, 32);
    store.set(KEY.fp, seed);
    return seed;
  }

  function hashHex(str) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < str.length; i++) {
      h1 = (h1 ^ str.charCodeAt(i)) >>> 0; h1 = (h1 * 16777619) >>> 0;
      h2 = (h2 + str.charCodeAt(i) * (i + 7)) >>> 0; h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }

  function deviceLabel() {
    var ua = navigator.userAgent || '';
    var os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' :
      /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    var browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' :
      /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return os + ' · ' + browser;
  }

  /* ---------------------------------------------------------- session */
  var session = {
    token: store.get(KEY.token, ''),
    data: store.json(KEY.session, null),
    save: function (token, data) {
      session.token = token || '';
      session.data = data || null;
      if (token) store.set(KEY.token, token); else store.del(KEY.token);
      if (data) store.setJson(KEY.session, data); else store.del(KEY.session);
    },
    clear: function () { session.save('', null); },
    get user() { return (session.data && session.data.user) || null; },
    get company() { return (session.data && session.data.company) || null; },
    get permissions() { return (session.data && session.data.permissions) || {}; },
    get scope() { return (session.data && session.data.projectScope) || []; },
    get settings() { return (session.data && session.data.settings) || {}; },
    get isStaff() {
      var r = session.data && session.data.user && session.data.user.role;
      return ['SuperAdmin', 'Admin', 'SubAdmin'].indexOf(r) >= 0;
    },
    get role() { return (session.data && session.data.user && session.data.user.role) || ''; },
    can: function (perm) {
      var p = session.permissions;
      if (session.role === 'SuperAdmin') return true;
      return !!(p && (p.__all || p[perm]));
    },
    scopeAll: function () { return session.scope.indexOf('ALL') >= 0; }
  };

  /* -------------------------------------------------------------- calls */
  function call(action, payload, opts) {
    opts = opts || {};
    var url = endpoint();
    var token = opts.token !== undefined ? opts.token : (opts.owner ? store.get(KEY.ownerToken, '') : session.token);
    var body = {
      action: action,
      payload: Object.assign({}, payload || {}, {
        deviceFingerprint: fingerprint(),
        deviceLabel: deviceLabel(),
        locale: store.get(KEY.locale, CFG.DEFAULT_LOCALE || 'en')
      })
    };
    if (token) body.token = token;

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, opts.timeout || 60000);

    var init = {
      method: opts.method === 'GET' ? 'GET' : 'POST',
      redirect: 'follow',
      signal: controller ? controller.signal : undefined
    };
    if (init.method === 'GET') {
      var qs = new URLSearchParams({ action: action });
      if (token) qs.set('token', token);
      qs.set('payload', JSON.stringify(body.payload));
      url += (url.indexOf('?') >= 0 ? '&' : '?') + qs.toString();
    } else {
      // text/plain avoids a CORS pre-flight against the Apps Script Web App.
      init.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      init.body = JSON.stringify(body);
    }

    return fetch(url, init).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (text) {
        var json;
        try { json = JSON.parse(text); }
        catch (e) {
          return {
            success: false,
            error: {
              code: res.status || 0,
              message: 'Unexpected response from the server' +
                (res.status ? ' (HTTP ' + res.status + ')' : '') +
                (text && text.indexOf('<!DOCTYPE') === 0 ? ' — the API URL looks like an HTML page. Check API_URL in config.js.' : '.')
            }
          };
        }
        return json;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      var offline = !navigator.onLine || /Failed to fetch|NetworkError|aborted/i.test(String(err && err.message));
      return {
        success: false,
        offline: offline,
        error: {
          code: offline ? 0 : 500,
          message: offline ? 'You appear to be offline. Your entry was saved on this device and will sync automatically.'
            : ('Network error: ' + (err && err.message ? err.message : err))
        }
      };
    });
  }

  /** call() + throw on failure (handy for sequential flows). */
  function must(action, payload, opts) {
    return call(action, payload, opts).then(function (res) {
      if (!res.success) {
        var e = new Error((res.error && res.error.message) || ('Action failed: ' + action));
        e.code = res.error && res.error.code;
        e.offline = res.offline;
        throw e;
      }
      return res.data;
    });
  }

  /* ------------------------------------------------------- offline queue */
  var queue = {
    all: function () { return store.json(KEY.queue, []); },
    save: function (items) {
      store.setJson(KEY.queue, items);
      window.dispatchEvent(new CustomEvent('st:queue', { detail: { count: items.length } }));
    },
    pending: function () { return queue.all().filter(function (i) { return !i.done; }).length; },
    push: function (item) {
      var items = queue.all();
      item.id = item.id || ('q' + Date.now() + Math.random().toString(36).slice(2, 7));
      item.queuedAt = item.queuedAt || new Date().toISOString();
      item.deviceFingerprint = fingerprint();
      items.push(item);
      if (items.length > 12) items = items.slice(-12); // keep the device storage small
      queue.save(items);
      return item;
    },
    remove: function (id) { queue.save(queue.all().filter(function (i) { return i.id !== id; })); },
    clear: function () { queue.save([]); },
    /** Push every queued entry through the API (batch endpoint on the server). */
    flush: function (opts) {
      var items = queue.all().filter(function (i) { return !i.done; });
      if (!items.length) return Promise.resolve({ flushed: 0 });
      if (!session.token) return Promise.resolve({ flushed: 0, waiting: 'login' });

      var attendance = items.filter(function (i) { return i.action === 'markAttendance' && i.payload && !i.payload.batch; });
      var others = items.filter(function (i) { return attendance.indexOf(i) < 0; });
      var results = [];

      var runBatch = attendance.length
        ? call('markAttendance', { batch: attendance.map(function (i) {
            var p = Object.assign({}, i.payload);
            p.source = 'offline';
            p.deviceFingerprint = i.deviceFingerprint || fingerprint();
            return p;
          }) })
          : Promise.resolve({ success: true, data: { results: [] } });

      return runBatch.then(function (res) {
        if (res.success && res.data && res.data.results) {
          res.data.results.forEach(function (r, idx) {
            var item = attendance[idx];
            if (!item) return;
            results.push({ item: item, ok: !!r.ok, detail: r.ok ? (r.result && (r.result.status || 'ok')) : r.error });
            if (r.ok) queue.remove(item.id);
          });
        } else if (!res.success) {
          results.push({ item: null, ok: false, detail: res.error && res.error.message });
        }
        // Non-attendance items are sent one at a time.
        var chain = Promise.resolve();
        others.forEach(function (item) {
          chain = chain.then(function () {
            return call(item.action, item.payload).then(function (r) {
              results.push({ item: item, ok: r.success, detail: r.success ? 'ok' : (r.error && r.error.message) });
              if (r.success) queue.remove(item.id);
            });
          });
        });
        return chain.then(function () {
          store.set(KEY.lastSync, new Date().toISOString());
          window.dispatchEvent(new CustomEvent('st:synced', { detail: { results: results } }));
          return { flushed: results.filter(function (r) { return r.ok; }).length, results: results };
        });
      });
    }
  };

  /* ------------------------------------------------------------ device IO */
  var device = {
    fingerprint: fingerprint,
    label: deviceLabel,
    online: function () { return navigator.onLine !== false; },

    /** High-accuracy GPS fix with a timeout + a friendly failure message. */
    position: function (opts) {
      opts = opts || {};
      return new Promise(function (resolve, reject) {
        if (!('geolocation' in navigator)) {
          return reject(new Error('This browser does not support location services.'));
        }
        var done = false;
        var timer = setTimeout(function () {
          if (!done) { done = true; reject(new Error('GPS_TIMEOUT')); }
        }, opts.timeout || CFG.GPS_TIMEOUT_MS || 20000);

        navigator.geolocation.getCurrentPosition(function (pos) {
          if (done) return; done = true; clearTimeout(timer);
          resolve({
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 0,
            at: new Date(pos.timestamp || Date.now()).toISOString(),
            source: 'gps'
          });
        }, function (err) {
          if (done) return; done = true; clearTimeout(timer);
          var msg = err.code === 1 ? 'GPS_DENIED' : (err.code === 3 ? 'GPS_TIMEOUT' : 'GPS_UNAVAILABLE');
          var e = new Error(msg); e.detail = err.message; reject(e);
        }, {
          enableHighAccuracy: opts.highAccuracy !== false,
          timeout: (opts.timeout || CFG.GPS_TIMEOUT_MS || 20000) - 1000,
          maximumAge: opts.maximumAge !== undefined ? opts.maximumAge : 0
        });
      });
    },

    /** Open the rear/front camera. Live capture only — no gallery uploads (§5). */
    camera: function (videoEl, opts) {
      opts = opts || {};
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('CAMERA_UNSUPPORTED'));
      }
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: opts.facing || 'user', width: { ideal: CFG.SELFIE_WIDTH || 640 }, height: { ideal: 480 } },
        audio: false
      }).then(function (stream) {
        videoEl.srcObject = stream;
        videoEl.setAttribute('playsinline', '');
        return videoEl.play().then(function () { return stream; }).catch(function () { return stream; });
      });
    },

    stopCamera: function (stream) {
      try { if (stream && stream.getTracks) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
    },

    /** Grab a frame from a playing <video> as a downscaled JPEG data URL. */
    snap: function (videoEl, width, quality) {
      var w = width || CFG.SELFIE_WIDTH || 640;
      var ratio = (videoEl.videoHeight || 480) / (videoEl.videoWidth || 640);
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = Math.round(w * ratio);
      var ctx2d = canvas.getContext('2d');
      ctx2d.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', quality || CFG.SELFIE_QUALITY || 0.72);
    },

    /** Downscale any image data URL (used for documents/proofs). */
    shrink: function (dataUrl, width, quality) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var ratio = img.height / img.width;
          var canvas = document.createElement('canvas');
          canvas.width = Math.min(width || 1024, img.width);
          canvas.height = Math.round(canvas.width * ratio);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality || 0.8));
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      });
    },

    vibrate: function (pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { } }
  };

  /* ------------------------------------------------------- file fetching */
  /** Fetch a token-gated Drive file (selfie / document) as a data URL. */
  function getFile(fileId) {
    return must('getFile', { fileId: fileId }).then(function (d) { return d.dataUrl; });
  }

  /** Read a browser File into a data URL (the backend accepts data URLs). */
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('Could not read the selected file.')); };
      reader.readAsDataURL(file);
    });
  }

  window.ST.store = store;
  window.ST.keys = KEY;
  window.ST.config = CFG;
  window.ST.api = {
    baseUrl: baseUrl, endpoint: endpoint, isLocalProxy: isLocalProxy,
    call: call, must: must, ping: function () { return call('ping', {}); },
    getFile: getFile, fileToDataUrl: fileToDataUrl, session: session, queue: queue, device: device,
    setApiUrl: function (u) { if (u) store.set(KEY.apiUrl, u); else store.del(KEY.apiUrl); },
    ownerToken: function () { return store.get(KEY.ownerToken, ''); },
    setOwnerToken: function (t) { if (t) store.set(KEY.ownerToken, t); else store.del(KEY.ownerToken); }
  };
})();
