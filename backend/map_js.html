/* ============================================================================
   frontend/assets/js/map.js — Leaflet wrapper with a no-JS-CDN fallback
   ---------------------------------------------------------------------------
   SiteTrack draws two kinds of maps:
     • admin "pick a pin" editors  → ST.map.picker(el, {lat,lng}, onChange)
     • live dashboards / history   → ST.map.view(el, {points:[...]})
   Leaflet + OpenStreetMap tiles load from a CDN. When the CDN is unreachable
   (offline site office, firewalled network) we degrade to a readable
   coordinate card with Google-Maps deep links instead of breaking the page.
   ========================================================================== */
window.ST = window.ST || {};

(function () {
  'use strict';

  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  var loadPromise = null;
  var failed = false;

  function tiles() {
    return (ST.config && ST.config.MAP_TILE_URL) ||
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  }
  function attribution() {
    return (ST.config && ST.config.MAP_ATTRIBUTION) ||
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (failed) return Promise.reject(new Error('MAP_CDN_UNAVAILABLE'));
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = LEAFLET_CSS;
      document.head.appendChild(link);
      var script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.onload = function () { window.L ? resolve(window.L) : reject(new Error('MAP_CDN_UNAVAILABLE')); };
      script.onerror = function () { failed = true; reject(new Error('MAP_CDN_UNAVAILABLE')); };
      document.head.appendChild(script);
      setTimeout(function () { if (!window.L) { failed = true; reject(new Error('MAP_CDN_TIMEOUT')); } }, 12000);
    });
    return loadPromise;
  }

  function icon(color, label) {
    var L = window.L;
    return L.divIcon({
      className: 'st-pin',
      html: '<span style="background:' + (color || '#f59e0b') + '">' + (label || '') + '</span>',
      iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14]
    });
  }

  /** Static fallback card: coordinates + deep links, never throws. */
  function fallback(el, points, opts) {
    var first = (points && points[0]) || opts && opts.center || null;
    var list = (points || []).slice(0, 12).map(function (p) {
      return '<li><b>' + (p.label || p.name || 'Point') + '</b> — ' +
        Number(p.lat).toFixed(5) + ', ' + Number(p.lng).toFixed(5) +
        ' <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
        p.lat + ',' + p.lng + '">open in Maps</a></li>';
    }).join('');
    el.innerHTML =
      '<div class="map-fallback">' +
      '<div class="ico">🗺️</div>' +
      '<p>Interactive map unavailable (offline or map CDN blocked).</p>' +
      (first ? '<p class="mono">' + Number(first.lat).toFixed(5) + ', ' + Number(first.lng).toFixed(5) + '</p>' : '') +
      (list ? '<ul>' + list + '</ul>' : '') +
      '</div>';
    return {
      ok: false,
      setCenter: function () { }, addMarker: function () { }, clear: function () { },
      fit: function () { }, remove: function () { el.innerHTML = ''; }
    };
  }

  function ensureStyle() {
    if (document.getElementById('st-pin-style')) return;
    var style = document.createElement('style');
    style.id = 'st-pin-style';
    style.textContent =
      '.st-pin span{display:flex;align-items:center;justify-content:center;width:26px;height:26px;' +
      'border-radius:50% 50% 50% 4px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);' +
      'color:#fff;font-size:12px;font-weight:700}' +
      '.st-circle{fill:rgba(245,158,11,.12);stroke:#f59e0b;stroke-width:1.5;stroke-dasharray:6 4}' +
      '.map-fallback{padding:22px;text-align:center;color:var(--muted,#7c8db0)}' +
      '.map-fallback ul{text-align:left;max-width:420px;margin:10px auto;font-size:.82rem}';
    document.head.appendChild(style);
  }

  /**
   * view(el, {points, center, zoom, geofence}) → interactive read-only map.
   * points: [{lat, lng, label, color, popup}]
   */
  function view(el, opts) {
    opts = opts || {};
    var points = (opts.points || []).filter(function (p) { return p && p.lat && p.lng; });
    ensureStyle();
    var handle = { ok: false, markers: [] };

    loadLeaflet().then(function (L) {
      if (!el.isConnected) return;
      el.innerHTML = '';
      var center = opts.center || (points[0] ? [points[0].lat, points[0].lng] : [19.076, 72.8777]);
      var map = L.map(el, { scrollWheelZoom: false, zoomControl: true }).setView(center, opts.zoom || 14);
      L.tileLayer(tiles(), { attribution: attribution(), maxZoom: 19 }).addTo(map);

      if (opts.geofence && points[0]) {
        L.circle([points[0].lat, points[0].lng], {
          radius: opts.geofence, className: 'st-circle'
        }).addTo(map);
      }
      points.forEach(function (p) {
        var m = L.marker([p.lat, p.lng], { icon: icon(p.color, p.label ? String(p.label).charAt(0) : '') })
          .addTo(map);
        if (p.popup) m.bindPopup(String(p.popup));
        handle.markers.push(m);
      });
      if (points.length > 1 && !opts.center) {
        var group = L.featureGroup(handle.markers);
        map.fitBounds(group.getBounds().pad(0.25));
      }
      handle.ok = true;
      handle.map = map;
      handle.setCenter = function (lat, lng, zoom) { map.setView([lat, lng], zoom || map.getZoom()); };
      handle.fit = function () { if (handle.markers.length) map.fitBounds(L.featureGroup(handle.markers).getBounds().pad(0.25)); };
      handle.remove = function () { map.remove(); el.innerHTML = ''; };
      setTimeout(function () { map.invalidateSize(); }, 120);
    }).catch(function () {
      if (el.isConnected) fallback(el, points, opts);
    });

    // Returned immediately; map fills in asynchronously.
    return Object.assign({
      ok: false,
      setCenter: function () { }, addMarker: function () { }, clear: function () { },
      fit: function () { }, remove: function () { }
    }, handle);
  }

  /**
   * picker(el, {lat, lng, radius}, onChange) → click-to-drop-pin editor used by
   * the project GPS lock and the setup wizard. onChange({lat,lng})
   */
  function picker(el, opts, onChange) {
    opts = opts || {};
    ensureStyle();
    var handle = { ok: false };
    loadLeaflet().then(function (L) {
      if (!el.isConnected) return;
      el.innerHTML = '';
      var center = opts.lat && opts.lng ? [opts.lat, opts.lng] : [19.076, 72.8777];
      var map = L.map(el, { scrollWheelZoom: true }).setView(center, opts.zoom || 16);
      L.tileLayer(tiles(), { attribution: attribution(), maxZoom: 19 }).addTo(map);

      var circle = null;
      var marker = null;
      function place(lat, lng, fire) {
        if (marker) marker.setLatLng([lat, lng]);
        else marker = L.marker([lat, lng], { icon: icon('#f59e0b', '✓'), draggable: true }).addTo(map);
        if (opts.radius) {
          if (circle) circle.setLatLng([lat, lng]);
          else circle = L.circle([lat, lng], { radius: opts.radius, className: 'st-circle' }).addTo(map);
        }
        if (fire && onChange) onChange({ lat: lat, lng: lng });
      }
      if (opts.lat && opts.lng) place(opts.lat, opts.lng, false);
      map.on('click', function (e) { place(e.latlng.lat, e.latlng.lng, true); });
      map.on('dragend', function () { });
      handle.ok = true; handle.map = map;
      handle.setRadius = function (r) { if (circle) circle.setRadius(r); };
      handle.setLocation = function (lat, lng) { place(lat, lng, false); map.setView([lat, lng], map.getZoom()); };
      handle.onMarkerDrag = function (cb) {
        if (marker) marker.on('dragend', function () {
          var p = marker.getLatLng(); cb({ lat: p.lat, lng: p.lng });
        });
      };
      setTimeout(function () { map.invalidateSize(); }, 120);
    }).catch(function () {
      if (!el.isConnected) return;
      el.innerHTML = '<div class="map-fallback"><div class="ico">📍</div>' +
        '<p>Map unavailable. Enter coordinates manually — you can copy them from Google Maps.</p></div>';
    });
    return handle;
  }

  /** Reverse-geocode helper → human address (Open-Meteo free geocoder). */
  function reverseGeocode(lat, lng) {
    return fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat +
      '&longitude=' + lng + '&localityLanguage=en')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return '';
        return [d.locality, d.city, d.principalSubdivision, d.countryName].filter(Boolean).join(', ');
      })
      .catch(function () { return ''; });
  }

  window.ST.map = { view: view, picker: picker, load: loadLeaflet, reverseGeocode: reverseGeocode };
})();
