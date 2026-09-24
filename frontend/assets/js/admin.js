/* ============================================================================
   frontend/assets/js/admin.js — SiteTrack staff web application (SPA)
   ---------------------------------------------------------------------------
   Sections: dashboard, live map, attendance, approvals, projects, employees,
   leave, expenses, transfers, vendors, documents, reports, payroll, audit,
   settings and profile. Every server call goes through ST.api (token + device
   fingerprint attached); every list is scoped & masked server-side.
   ========================================================================== */
(function () {
  'use strict';
  var ui = ST.ui, api = ST.api, h = ui.h, t = ST.i18n.t;
  var session = api.session;

  var cache = { projects: null, users: null, shifts: null, enums: null, settings: null, holidays: null };
  var view = null;          // #view container
  var navBadge = {};        // section → badge count

  /* ================================================================ boot */
  function boot() {
    if (!session.token || !session.data) return go('login.html');
    var role = session.role;
    if (role === 'owner') return go('owner.html');
    if (role === 'SiteEmployee') return go('mobile.html');

    view = ui.el('view');
    buildChrome();
    window.addEventListener('hashchange', route);
    refreshMe().then(function () { route(); });
  }

  function go(url) { location.replace(url); }

  function refreshMe() {
    return api.must('me', {}).then(function (res) {
      if (!res.success) { session.clear(); return go('login.html'); }
      session.save(session.token, Object.assign({}, session.data, res.data));
      cache.settings = res.data.settings;
      return res.data;
    });
  }

  /* ============================================================== chrome */
  var SECTIONS = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard', perm: null },
    { id: 'livemap', icon: '🗺️', label: 'Live site map', perm: null },
    { id: 'attendance', icon: '🕒', label: 'Attendance', perm: null },
    { id: 'approvals', icon: '✅', label: 'Approvals', perm: null, badge: 'approvals' },
    { id: 'projects', icon: '🏗️', label: 'Projects', perm: null },
    { id: 'employees', icon: '👷', label: 'Employees', perm: null },
    { id: 'devices', icon: '📱', label: 'Devices', perm: 'editEmployees' },
    { id: 'leave', icon: '🌴', label: 'Leave', perm: null },
    { id: 'expenses', icon: '💸', label: 'Expenses', perm: null },
    { id: 'transfers', icon: '🔁', label: 'Transfers', perm: null },
    { id: 'vendors', icon: '🚚', label: 'Vendors', perm: 'manageVendors' },
    { id: 'documents', icon: '📄', label: 'Documents', perm: null },
    { id: 'reports', icon: '📈', label: 'Reports', perm: 'viewReports' },
    { id: 'payroll', icon: '💰', label: 'Payroll', perm: 'runPayroll' },
    { id: 'audit', icon: '🧾', label: 'Audit log', perm: 'viewAuditLog' },
    { id: 'settings', icon: '⚙️', label: 'Settings', perm: null },
    { id: 'profile', icon: '👤', label: 'My profile', perm: null }
  ];

  function sectionVisible(s) {
    if (s.id === 'settings') return session.isStaff;
    if (s.perm) return session.can(s.perm);
    if (['attendance', 'approvals', 'livemap', 'dashboard'].indexOf(s.id) >= 0) return session.isStaff;
    return true;
  }

  function buildChrome() {
    var co = session.company || {};
    var user = session.user || {};
    ui.el('brandCompany').textContent = co.companyName || 'SiteTrack';
    ui.el('chipRole').textContent = user.role || '';
    ui.el('userName').textContent = user.name || user.userId || '';

    var nav = ui.el('sidenav');
    ui.render(nav, SECTIONS.filter(sectionVisible).map(function (s) {
      return h('a.navlink', { href: '#/' + s.id, 'data-section': s.id }, [
        h('span.ico', null, s.icon), h('span.lbl', null, s.label),
        h('span.navbadge', { 'data-badge': s.id, hidden: true })
      ]);
    }));

    ui.el('themeBtn').addEventListener('click', function () { ui.toggleTheme(); });
    ui.el('langBtn').addEventListener('click', function () {
      var next = ST.store.get(ST.keys.locale, 'en') === 'en' ? 'hi' : 'en';
      ST.i18n.setLocale(next); ST.i18n.apply(document.body); ST.store.set(ST.keys.locale, next);
    });
    ui.el('installBtn').addEventListener('click', function () { ui.installApp(); });
    window.addEventListener('st:installable', function () { ui.el('installBtn').hidden = false; });
    ui.el('logoutBtn').addEventListener('click', async function () {
      await api.call('logout', {}); session.clear(); go('login.html');
    });
    ui.el('menuBtn').addEventListener('click', function () {
      document.body.classList.toggle('nav-open');
    });

    var bell = ui.el('bellBtn');
    bell.addEventListener('click', function () { location.hash = '#/notifications'; });
    setInterval(pollNotifications, 60000);
    pollNotifications();

    // offline banner
    function netBanner() {
      ui.el('offlineBar').hidden = navigator.onLine !== false;
    }
    window.addEventListener('online', function () { netBanner(); api.queue.flush(); });
    window.addEventListener('offline', netBanner);
    netBanner();

    if (session.company && !session.company.setupCompleted && session.role === 'SuperAdmin') {
      ui.el('setupBar').hidden = false;
      ui.el('setupBarBtn').addEventListener('click', function () { openSetupWizard(); });
    }
  }

  function pollNotifications() {
    api.call('myNotifications', { limit: 1, unreadOnly: true }).then(function (res) {
      if (!res.success) return;
      var n = res.data.unread !== undefined ? res.data.unread : (res.data.notifications || []).length;
      var dot = ui.el('bellDot');
      dot.hidden = !n;
      if (dot.parentNode) dot.parentNode.title = n + ' unread notifications';
    });
  }

  /* ============================================================== router */
  function route() {
    var hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    var parts = hash.split('/');
    var id = parts[0] || 'dashboard';
    var param = parts.slice(1).join('/');
    var section = SECTIONS.filter(function (s) { return s.id === id; })[0] ||
      (id === 'notifications' ? { id: 'notifications', label: 'Notifications' } : null);
    if (!section) id = 'dashboard';

    ui.qsa('.navlink').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-section') === id);
    });
    document.body.classList.remove('nav-open');
    ui.loading(view);
    var fn = VIEWS[id] || VIEWS.dashboard;
    Promise.resolve(fn(view, param)).catch(function (err) {
      ui.render(view, h('div.err-box', null, 'View error: ' + (err && err.message ? err.message : err)));
    });
  }

  /* ============================================================ helpers */
  function ensure(key, action, payload, field) {
    if (cache[key]) return Promise.resolve(cache[key]);
    return api.must(action, payload || {}).then(function (res) {
      if (!res.success) throw new Error(res.error.message);
      cache[key] = res.data[field] || res.data;
      return cache[key];
    });
  }
  function projects() { return ensure('projects', 'listProjects', {}, 'projects'); }
  function users() { return ensure('users', 'listUsers', {}, 'users'); }
  function shifts() { return ensure('shifts', 'listShifts', {}, 'shifts'); }
  function enums() {
    if (cache.enums) return Promise.resolve(cache.enums);
    return api.must('getSettings', {}).then(function (res) {
      if (!res.success) throw new Error(res.error.message);
      cache.enums = res.data.enums || {};
      cache.settings = res.data.settings || cache.settings;
      return cache.enums;
    });
  }
  function invalidate(key) { cache[key] = null; }

  function projectOptions(all) {
    return projects().then(function (ps) {
      return ps.filter(function (p) { return all || p.status !== 'Completed'; })
        .map(function (p) { return { value: p.projectId, label: p.name + ' (' + p.projectCode + ')' }; });
    });
  }
  function userOptions() {
    return users().then(function (us) {
      return us.map(function (u) { return { value: u.userId, label: u.name + ' — ' + u.userId }; });
    });
  }

  function sectionHead(title, sub, actions) {
    return h('div.page-head', [
      h('div', [h('h2', null, title), sub ? h('p.sub', null, sub) : null]),
      h('div.row', { style: { gap: '8px', flexWrap: 'wrap' } }, actions || [])
    ]);
  }

  function run(promise, okMsg) {
    return promise.then(function (res) {
      if (!res.success) { ui.toast(res.error.message, 'bad'); return res; }
      if (okMsg) ui.toast(okMsg, 'good');
      return res;
    });
  }

  function selfieThumb(fileId) {
    if (!fileId) return h('span.muted', null, '—');
    var img = h('img.thumb', { alt: 'selfie', title: 'View selfie' });
    img.src = '';
    img.addEventListener('click', function () { openSelfie(fileId); });
    api.getFile(fileId).then(function (url) { if (url) img.src = url; }).catch(function () { });
    return img;
  }

  function openSelfie(fileId) {
    var img = h('img', { style: { width: '100%', borderRadius: '12px' }, alt: 'Selfie' });
    var m = ui.modal({ title: 'Captured selfie', body: h('div.loading-block', null, h('span.spinner')) });
    api.getFile(fileId).then(function (url) {
      if (!url) { ui.render(m.body, h('div.err-box', null, 'Selfie not available.')); return; }
      img.src = url; ui.render(m.body, img);
    }).catch(function (e) { ui.render(m.body, h('div.err-box', null, e.message)); });
  }

  function monthInput(value) {
    var now = new Date();
    var def = value || now.toISOString().slice(0, 7);
    return h('input', { type: 'month', value: def });
  }
  function dateInput(value, daysBack) {
    var d = value || new Date(Date.now() - (daysBack || 0) * 86400000).toISOString().slice(0, 10);
    return h('input', { type: 'date', value: d });
  }

  /* ========================================================== VIEWS map */
  var VIEWS = {};

  /* ------------------------------------------------------------ dashboard */
  VIEWS.dashboard = async function (el) {
    var res = await api.must('todayDashboard', {});
    if (!res.success) return ui.render(el, h('div.err-box', null, res.error.message));
    var d = res.data;
    var tot = d.totals || {};
    var expected = tot.expected || 0;
    var onSite = (tot.present || 0) + (tot.late || 0) + (tot.halfDay || 0);
    var pct = expected ? Math.round((onSite / expected) * 100) : 0;

    ui.render(el, [
      sectionHead('Dashboard', 'Live picture of today across your projects'),
      h('div.stats', [
        ui.statCard('On site now', onSite, 'of ' + expected + ' expected', 'ok'),
        ui.statCard('Late', tot.late || 0, 'after grace window', 'warn'),
        ui.statCard('Flagged', tot.flagged || 0, 'need review', 'bad'),
        ui.statCard('On leave', tot.leave || 0, 'approved leave', 'info'),
        ui.statCard('Not marked', tot.notMarked || 0, 'no check-in yet', 'muted'),
        ui.statCard('Attendance', pct + '%', 'today', 'accent')
      ]),
      h('div.grid.c2.mt', [
        h('div.card', [
          h('h3', null, 'Projects today'),
          ui.table({
            columns: [
              { key: 'name', label: 'Project', render: function (r) { return h('a', { href: '#/projects/' + r.projectId }, r.name); } },
              { key: 'present', label: 'Present', align: 'right' },
              { key: 'late', label: 'Late', align: 'right' },
              { key: 'flagged', label: 'Flagged', align: 'right' },
              { key: 'notMarked', label: 'Not marked', align: 'right' },
              {
                label: 'Coverage', render: function (r) {
                  var exp = (r.counts || {}).expected || 0;
                  var got = ((r.counts || {}).present || 0) + ((r.counts || {}).late || 0);
                  var p = exp ? Math.round(got / exp * 100) : 0;
                  return h('div.progress', null, h('span', { style: { width: p + '%' } }));
                }
              }
            ],
            rows: (d.projects || []).map(function (r) {
              var p = r.project || {};
              return {
                projectId: p.projectId, name: p.name, present: r.onSite, late: r.counts.late,
                flagged: r.counts.flagged, notMarked: r.counts.notMarked,
                counts: Object.assign({ expected: r.headcount }, r.counts)
              };
            }),
            emptyMessage: 'No active projects yet — create one under Projects.'
          })
        ]),
        h('div.card', [
          h('h3', null, 'Needs attention'),
          ui.table({
            compact: true,
            columns: [
              { key: 'userName', label: 'Employee' },
              { key: 'projectName', label: 'Project' },
              { label: 'Why', render: function (r) { return r.reason || r.flagReason || r.status; } },
              { key: 'markedAt', label: 'Time', render: function (r) { return ui.fmtTime(r.markedAt); } }
            ],
            rows: (d.flagged || []).slice(0, 8),
            emptyMessage: 'Nothing flagged — clean day so far 🎉',
            onRowClick: function (r) { location.hash = '#/attendance'; }
          }),
          h('div.row.mt', null, [
            h('a.btn.sm', { href: '#/approvals' }, 'Open approvals queue'),
            h('a.btn.sm.ghost', { href: '#/livemap' }, 'Live map')
          ])
        ])
      ])
    ]);
  };

  /* -------------------------------------------------------------- live map */
  VIEWS.livemap = async function (el) {
    var res = await api.must('liveMap', {});
    if (!res.success) return ui.render(el, h('div.err-box', null, res.error.message));
    var pins = res.data.pins || [];
    var mapBox = h('div.map');
    var points = pins.filter(function (p) { return p.lat && p.lng; }).map(function (p) {
      return {
        lat: p.lat, lng: p.lng, label: String(p.present), color: p.flagged ? '#ef4444' : '#22c55e',
        popup: '<b>' + ui.esc(p.name) + '</b><br>' + p.present + ' on site · ' + p.headcount + ' marks' +
          (p.flagged ? '<br>⚠ ' + p.flagged + ' flagged' : '') + '<br>' + ui.esc(p.address || '')
      };
    });
    var weatherBox = h('div');
    ui.render(el, [
      sectionHead('Live site map', 'Today\'s check-ins per project geofence', [
        h('button.btn.sm', { onclick: function () { VIEWS.livemap(el); } }, '↻ Refresh')
      ]),
      weatherBox,
      h('div.grid.side', [
        mapBox,
        h('div.card', [
          h('h3', null, 'Sites'),
          h('div.list', null, pins.map(function (p) {
            return h('div.list-row', [
              h('div', [h('b', null, p.name), h('div.tiny.muted', null, (p.address || '').slice(0, 60))]),
              h('div.right', [
                ui.badge(p.present ? 'Present' : 'NotMarked', p.present + ' on site'),
                p.flagged ? ui.badge('Flagged', p.flagged + ' flagged') : null
              ])
            ]);
          }))
        ])
      ])
    ]);
    ST.map.view(mapBox, { points: points, geofence: pins[0] && pins[0].radius, zoom: 12 });
    loadSiteWeather(weatherBox);
  };

  /** Rain / heat advisory per site — the 05:00 weather trigger does the same check. */
  function loadSiteWeather(box) {
    ui.render(box, h('div.card', null, h('p.tiny.muted', null, 'Checking the forecast for active sites…')));
    api.must('checkSiteWeather', {}).then(function (res) {
      if (!res.success) return ui.render(box, h('div.card', null, h('p.tiny.muted', null, res.error.message)));
      var sites = (res.data.sites || []).filter(function (s) { return s.weather; });
      if (!sites.length) {
        return ui.render(box, h('div.card', null, h('p.tiny.muted', null,
          'No weather to show — turn on WEATHER_ENABLED in Script Properties and give each site coordinates.')));
      }
      var flags = sites.filter(function (s) { return s.suggestedFlag; });
      ui.render(box, h('div.card', [
        h('div.row', { style: { alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, [
          h('h3', { style: { margin: 0 } }, 'Site weather · ' + ui.fmtDate(res.data.date)),
          flags.length ? ui.badge('Flagged', flags.length + ' site(s) past the threshold') : h('span.badge.ok', null, 'All sites workable'),
          h('span.grow'),
          flags.length && session.can('reviewAttendance') ? h('button.btn.sm.bad', {
            onclick: function () {
              ui.confirm('Stamp “' + flags.map(function (s) { return s.suggestedFlag; }).join(' / ') +
                '” on every attendance mark recorded at these sites today? Supervisors see it when reviewing flags.').then(function (ok) {
                  if (!ok) return;
                  run(api.must('checkSiteWeather', { applyFlag: true }), 'Weather flag stamped on today\'s marks')
                    .then(function (x) { if (x.success) loadSiteWeather(box); });
                });
            }
          }, 'Apply flag to today\'s marks') : null
        ].filter(Boolean)),
        ui.table({
          compact: true,
          columns: [
            { key: 'name', label: 'Site' },
            { label: 'Rain', align: 'right', render: function (r) { return r.weather.rainMm + ' mm'; } },
            { label: 'High', align: 'right', render: function (r) { return r.weather.maxTempC + ' °C'; } },
            { label: 'Wind', align: 'right', render: function (r) { return r.weather.windKmph + ' km/h'; } },
            {
              label: 'Advice', render: function (r) {
                return r.suggestedFlag
                  ? ui.badge('Flagged', r.suggestedFlag + ' (rain ≥ ' + r.thresholdMm + ' mm)')
                  : h('span.tiny.muted', null, 'work as usual');
              }
            }
          ],
          rows: sites,
          emptyMessage: 'No active site has coordinates yet.'
        })
      ]));
    });
  }

  /* ------------------------------------------------------------ attendance */
  VIEWS.attendance = async function (el, param) {
    var pOpts = await projectOptions(true);
    var uOpts = await userOptions();
    var f = {
      from: dateInput(undefined, 6),
      to: dateInput(), status: h('select', null, [h('option', { value: '' }, 'All statuses')]
        .concat(['Present', 'Late', 'HalfDay', 'Absent', 'Leave', 'Travel', 'Holiday', 'WeekOff', 'Flagged']
          .map(function (s) { return h('option', { value: s }, s); }))),
      project: h('select', null, [h('option', { value: '' }, 'All projects')].concat(
        pOpts.map(function (o) { return h('option', { value: o.value }, o.label); }))),
      user: h('select', null, [h('option', { value: '' }, 'All employees')].concat(
        uOpts.map(function (o) { return h('option', { value: o.value }, o.label); })))
    };
    var body = h('div');

    async function load() {
      ui.loading(body);
      var res = await api.must('listAttendance', {
        from: f.from.value, to: f.to.value, projectId: f.project.value,
        userId: f.user.value, status: f.status.value, limit: 300
      });
      if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
      ui.render(body, ui.table({
        columns: [
          { key: 'date', label: 'Date', render: function (r) { return ui.fmtDate(r.date); } },
          { key: 'userName', label: 'Employee' },
          { key: 'projectName', label: 'Project' },
          { label: 'In / Out', render: function (r) { return ui.fmtTime(r.markedAt) + ' → ' + (r.markedOutAt ? ui.fmtTime(r.markedOutAt) : '—'); } },
          { label: 'Status', render: function (r) { return h('span', null, [ui.badge(r.status), r.lateMark ? h('span.badge.warn', null, 'late') : null]); } },
          { label: 'Dist.', align: 'right', render: function (r) { return ui.dist(r.distance); } },
          { label: 'Hrs', align: 'right', render: function (r) { return ui.num(r.hoursWorked, 1) + (r.overtimeHours ? ' +' + ui.num(r.overtimeHours, 1) + ' OT' : ''); } },
          { label: 'Selfie', render: function (r) { return selfieThumb(r.selfieFileId); } },
          { label: '', render: function (r) { return h('button.btn.sm.ghost', { onclick: function (e) { e.stopPropagation(); openAttendanceDetail(r); } }, 'Open'); } }
        ],
        rows: res.data.attendance || [],
        emptyMessage: 'No attendance rows for this filter.'
      }));
    }

    ui.render(el, [
      sectionHead('Attendance', 'Every check-in with GPS distance, hours and selfie', [
        session.can('reviewAttendance') ? h('button.btn.primary.sm', { onclick: openManualMark }, '+ Manual mark') : null
      ]),
      h('div.card', [
        h('div.filters', [
          h('label', null, 'From'), f.from,
          h('label', null, 'To'), f.to,
          h('label', null, 'Project'), f.project,
          h('label', null, 'Employee'), f.user,
          h('label', null, 'Status'), f.status,
          h('button.btn.primary', { onclick: load }, 'Apply')
        ])
      ]),
      body
    ]);
    load();

    function openAttendanceDetail(r) {
      ui.modal({
        wide: true,
        title: r.userName + ' — ' + ui.fmtDate(r.date),
        body: [
          ui.kvList([
            ['Project', r.projectName], ['Status', ui.badge(r.status)],
            ['Marked in', ui.fmtDateTime(r.markedAt)], ['Marked out', r.markedOutAt ? ui.fmtDateTime(r.markedOutAt) : ''],
            ['Source', r.source + (r.capturedAt ? ' (captured ' + ui.fmtTime(r.capturedAt) + ')' : '')],
            ['GPS', r.lat && r.lng ? r.lat.toFixed(5) + ', ' + r.lng.toFixed(5) + ' ±' + ui.num(r.accuracy, 0) + ' m' : ''],
            ['Distance from site', ui.dist(r.distance)],
            ['Hours / OT', ui.num(r.hoursWorked, 2) + ' h / ' + ui.num(r.overtimeHours, 2) + ' h'],
            ['Weather flag', r.weatherFlag], ['Flag reason', r.flagReason],
            ['Reviewed by', r.reviewedBy ? r.reviewedBy + (r.reviewNote ? ' — ' + r.reviewNote : '') : ''],
            ['Device', r.deviceId]
          ]),
          r.selfieFileId ? h('div.mt', null, selfieThumbBig(r.selfieFileId)) : null
        ],
        actions: (session.can('reviewAttendance') && r.status === 'Flagged') ? [
          {
            label: 'Approve as Present', kind: 'primary', onClick: function (close) {
              review(r.attendanceId, 'approve', 'Present', close);
            }
          },
          {
            label: 'Reject → Absent', kind: 'bad', onClick: function (close) {
              review(r.attendanceId, 'reject', 'Absent', close);
            }
          }
        ] : [{ label: 'Close', onClick: function (c) { c(); } }]
      });
    }

    function selfieThumbBig(fileId) {
      var img = h('img', { style: { maxWidth: '320px', borderRadius: '12px' }, alt: 'selfie' });
      api.getFile(fileId).then(function (u) { if (u) img.src = u; });
      return img;
    }

    function review(id, decision, status, close) {
      run(api.must('reviewAttendance', { attendanceId: id, decision: decision, status: status, note: 'Reviewed from web app' }),
        'Attendance ' + decision + 'ed').then(function (res) { if (res.success) { close(); load(); } });
    }

    function openManualMark() {
      Promise.all([userOptions(), projectOptions()]).then(function (opts) {
        var fu = h('select', null, opts[0].map(function (o) { return h('option', { value: o.value }, o.label); }));
        var fp = h('select', null, opts[1].map(function (o) { return h('option', { value: o.value }, o.label); }));
        var fd = dateInput();
        var fs = h('select', null, ['Present', 'HalfDay', 'Leave', 'Travel', 'Absent'].map(function (s) { return h('option', null, s); }));
        var fn = h('textarea', { rows: 2, placeholder: 'Reason (shown in audit log)' });
        ui.modal({
          title: 'Manual attendance mark',
          body: [
            h('div.field', [h('label.req', null, 'Employee'), fu]),
            h('div.field', [h('label.req', null, 'Project'), fp]),
            h('div.grid.c2', [h('div.field', [h('label.req', null, 'Date'), fd]), h('div.field', [h('label.req', null, 'Status'), fs])]),
            h('div.field', [h('label', null, 'Note'), fn])
          ],
          actions: [{
            label: 'Save mark', kind: 'primary', onClick: function (close) {
              run(api.must('manualMark', {
                userId: fu.value, projectId: fp.value, date: fd.value, status: fs.value, note: fn.value
              }), 'Manual mark saved').then(function (r) { if (r.success) { close(); load(); } });
            }
          }]
        });
      });
    }
  };

  /* ------------------------------------------------------------- approvals */
  VIEWS.approvals = async function (el) {
    var tabs = h('div.tabs');
    var body = h('div.mt');
    var current = 'all';
    var TABS = [
      ['all', 'All'], ['leave', 'Leave'], ['expense', 'Expenses'], ['transfer', 'Transfers'],
      ['flagged', 'Flagged attendance'], ['regularization', 'Regularization'], ['device', 'Device changes']
    ];
    TABS.forEach(function (tb) {
      var b = h('button.tab' + (tb[0] === current ? '.active' : ''), { 'data-tab': tb[0] }, tb[1] + ' ');
      b.addEventListener('click', function () {
        current = tb[0];
        ui.qsa('.tab', tabs).forEach(function (x) { x.classList.toggle('active', x === b); });
        load();
      });
      tabs.appendChild(b);
    });

    async function load() {
      ui.loading(body);
      var res = await api.must('approvalsQueue', { tab: current, limit: 100 });
      if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
      var q = res.data;
      // badge counts on the nav
      setBadge('approvals', q.total || 0);

      var cards = [];
      function card(title, rows, renderer) {
        if (!rows || !rows.length) return;
        cards.push(h('div.card.mt', [h('h3', null, title + ' (' + rows.length + ')'), h('div.list', null, rows.map(renderer))]));
      }

      var show = function (k) { return current === 'all' || current === k; };
      if (show('leave')) card('Leave requests', q.tabs.leave, function (r) {
        return h('div.list-row', [
          h('div', [h('b', null, r.userName), h('div.tiny.muted', null, r.type + ' · ' + ui.fmtDate(r.fromDate) + ' → ' + ui.fmtDate(r.toDate) + ' (' + r.days + 'd) · ' + (r.reason || ''))]),
          decideButtons('leave', r.leaveId, load)
        ]);
      });
      if (show('expense')) card('Expense claims', q.tabs.expense, function (r) {
        return h('div.list-row', [
          h('div', [
            h('b', null, r.userName + ' — ' + ST.i18n.money(r.amount)),
            h('div.tiny.muted', null, r.category + ' · ' + ui.fmtDate(r.date || r.appliedAt) + ' · ' + (r.description || '')),
            r.proofFileId ? h('div.tiny', null, h('a', { href: '#', onclick: function (e) { e.preventDefault(); openSelfie(r.proofFileId); } }, '📎 view proof')) : null
          ]),
          decideButtons('expense', r.expenseId, load)
        ]);
      });
      if (show('transfer')) card('Site transfer requests', q.tabs.transfer, function (r) {
        return h('div.list-row', [
          h('div', [h('b', null, r.userName), h('div.tiny.muted', null, (r.fromProjectName || '—') + ' → ' + (r.toProjectName || '') + ' from ' + ui.fmtDate(r.effectiveDate) + ' · ' + (r.reason || ''))]),
          decideButtons('transfer', r.transferId, load)
        ]);
      });
      if (show('flagged')) card('Flagged attendance', q.tabs.flagged, function (r) {
        return h('div.list-row', [
          h('div', [
            h('b', null, r.userName + ' — ' + ui.fmtDate(r.date)),
            h('div.tiny.muted', null, (r.projectName || '') + ' · ' + (r.flagReason || '') + ' · dist ' + ui.dist(r.distance)),
            r.selfieFileId ? h('div.tiny', null, h('a', { href: '#', onclick: function (e) { e.preventDefault(); openSelfie(r.selfieFileId); } }, '🤳 view selfie')) : null
          ]),
          h('div.right.row', null, [
            h('button.btn.sm.primary', { onclick: function () { decideFlag(r.attendanceId, 'approve', 'Present', load); } }, 'Approve'),
            h('button.btn.sm.bad', { onclick: function () { decideFlag(r.attendanceId, 'reject', 'Absent', load); } }, 'Mark absent')
          ])
        ]);
      });
      if (show('regularization')) card('Regularization requests', q.tabs.regularization, function (r) {
        return h('div.list-row', [
          h('div', [h('b', null, r.userName + ' — ' + ui.fmtDate(r.date)), h('div.tiny.muted', null, 'wants ' + r.requestedStatus + ' · ' + (r.reason || ''))]),
          h('div.right.row', null, [
            h('button.btn.sm.primary', { onclick: function () { decideGeneric('decideRegularization', { requestId: r.requestId, decision: 'approve' }, load); } }, 'Approve'),
            h('button.btn.sm.bad', { onclick: function () { decideGeneric('decideRegularization', { requestId: r.requestId, decision: 'reject', note: 'Rejected' }, load); } }, 'Reject')
          ])
        ]);
      });
      if (show('device')) {
        card('Device change requests', q.tabs.device, function (d) {
          return h('div.list-row', [
            h('div', [h('b', null, d.userName || d.userId), h('div.tiny.muted', null, (d.label || 'device') + ' · requested ' + ui.ago(d.requestedAt || d.requestedAt))]),
            h('div.right.row', null, [
              h('button.btn.sm.primary', { onclick: function () { decideGeneric('approveDeviceChange', { deviceId: d.deviceId, decision: 'approve' }, load); } }, 'Approve'),
              h('button.btn.sm.bad', { onclick: function () { decideGeneric('approveDeviceChange', { deviceId: d.deviceId, decision: 'reject' }, load); } }, 'Reject')
            ])
          ]);
        });
      }

      ui.render(body, cards.length ? cards : h('div.empty', [h('span.ico', null, '🎉'), h('div', null, 'Queue is clear — nothing waiting for approval.')]));
    }

    function decideButtons(kind, id, reload) {
      return h('div.right.row', null, [
        h('button.btn.sm.primary', { onclick: function () { decideGeneric('decide' + cap(kind), leavePayload(kind, id, 'approve'), reload); } }, 'Approve'),
        h('button.btn.sm.bad', { onclick: function () { decideGeneric('decide' + cap(kind), leavePayload(kind, id, 'reject'), reload); } }, 'Reject')
      ]);
    }
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    function leavePayload(kind, id, decision) {
      var base = { decision: decision, note: decision === 'reject' ? 'Rejected from web app' : '' };
      if (kind === 'leave') return Object.assign({ leaveId: id, writeAttendance: true }, base);
      if (kind === 'expense') return Object.assign({ expenseId: id }, base);
      return Object.assign({ transferId: id }, base);
    }
    function decideGeneric(action, payload, reload) {
      run(api.must(action, payload), 'Decision saved').then(function (r) { if (r.success) reload(); });
    }
    function decideFlag(id, decision, status, reload) {
      run(api.must('reviewAttendance', { attendanceId: id, decision: decision, status: status, note: 'Reviewed' }), 'Saved')
        .then(function (r) { if (r.success) reload(); });
    }

    ui.render(el, [sectionHead('Approvals centre', 'Everything waiting on a decision, in one queue'), tabs, body]);
    load();
  };

  /* -------------------------------------------------------------- projects */
  VIEWS.projects = async function (el, param) {
    var body = h('div');
    async function load() {
      ui.loading(body);
      var res = await api.must('listProjects', {});
      if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
      ui.render(body, ui.table({
        columns: [
          { label: 'Project', render: function (r) { return h('div', [h('b', null, r.name), h('div.tiny.muted', null, r.projectCode)]); } },
          { label: 'Status', render: function (r) { return ui.badge(r.status); } },
          { label: 'Client', render: function (r) { return r.clientName || '—'; } },
          { label: 'Address', render: function (r) { return h('span.tiny', null, (r.address || '').slice(0, 44)); } },
          { label: 'Team', align: 'right', render: function (r) { return r.assignedCount; } },
          { label: 'Today', align: 'right', render: function (r) { return r.presentToday; } },
          { label: 'Window', render: function (r) { return r.windowStart + '–' + r.windowEnd; } },
          { label: '', render: function (r) { return h('button.btn.sm.ghost', { onclick: function () { openProject(r.projectId); } }, 'Open'); } }
        ],
        rows: res.data.projects || [],
        emptyMessage: 'No projects yet. Create the first site to start attendance.'
      }));
    }

    ui.render(el, [
      sectionHead('Projects', 'Sites with GPS lock, geofence and marking window', [
        session.can('createProjects') ? h('button.btn.primary.sm', { onclick: function () { openProject(null); } }, '+ New project') : null
      ]),
      body
    ]);
    load();
    if (param) openProject(param);

    function openProject(id) {
      api.must('getProject', id ? { projectId: id } : {}).then(function (res) {
        if (!res.success) return ui.toast(res.error.message, 'bad');
        var p = res.data.project;
        var editable = session.can('editProjects');
        var mapBox = h('div.map.sm');
        var teamBox = h('div.mt');
        var liveBox = h('div.mt');
        var qrBox = h('div', p.qrImageUrl ? [
          h('img', { src: p.qrImageUrl, alt: 'QR', style: { width: '160px', borderRadius: '10px', background: '#fff', padding: '6px' } })
        ] : [h('span.tiny.muted', null, 'No QR stored for this site yet — generate one below.')]);

        var m = ui.modal({
          wide: true,
          title: p.name,
          body: [
            h('div.grid.c2', [
              h('div', [
                ui.kvList([
                  ['Code', p.projectCode], ['Status', ui.badge(p.status)],
                  ['Client', p.clientName ? p.clientName + (p.clientContact ? ' · ' + p.clientContact : '') : ''],
                  ['PMC', p.pmcName], ['Site engineer', p.siteEngineer],
                  ['Start', ui.fmtDate(p.startDate)], ['End', p.endDate ? ui.fmtDate(p.endDate) : ''],
                  ['Address', p.address],
                  ['Geofence', p.geofenceRadius + ' m'], ['Window', p.windowStart + '–' + p.windowEnd + ' (out ' + p.outWindowStart + '–' + p.outWindowEnd + ')'],
                  ['Coordinates', p.lat && p.lng ? p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) : 'not set'],
                  ['Shift', p.shiftId]
                ]),
                h('div.mt', [
                  h('h4', null, 'QR check-in code'),
                  qrBox,
                  h('div.row.mt', { style: { gap: '6px' } }, [
                    h('button.btn.sm', { onclick: function () { siteQrCode(p, qrBox, false, load); } }, '🖨 Print-ready QR'),
                    editable ? h('button.btn.sm.ghost', { onclick: function () { siteQrCode(p, qrBox, true, load); } }, '↻ New code') : null
                  ].filter(Boolean)),
                  h('div.tiny.muted.mt', null, 'Print and stick at the site gate — workers scan when GPS fails indoors.')
                ])
              ]),
              h('div', [mapBox, h('div.tiny.muted.mt', null, 'Geofence radius shown as the dashed circle.')])
            ]),
            h('h3.mt', null, 'Assigned team'),
            teamBox,
            h('h3.mt', null, 'On site today'),
            liveBox
          ],
          actions: [
            editable ? {
              label: 'Edit project', kind: 'primary', onClick: function (close) { close(); editProject(p); }
            } : null,
            editable ? {
              label: 'Set status', onClick: function () { setProjectStatus(p, load); }
            } : null,
            session.can('createEmployees') ? {
              label: 'Assign employee', onClick: function (close) { close(); assignEmployee(p); }
            } : null,
            { label: 'Close', onClick: function (c) { c(); } }
          ].filter(Boolean)
        });

        if (p.lat && p.lng) ST.map.view(mapBox, { points: [{ lat: p.lat, lng: p.lng, label: '✓', popup: ui.esc(p.address || p.name) }], geofence: p.geofenceRadius, zoom: 16 });

        loadLiveTeam(p.projectId, liveBox);
        api.must('listAssignments', { projectId: p.projectId, status: 'All' }).then(function (tr) {
          if (!tr.success) return ui.render(teamBox, h('div.err-box', null, tr.error.message));
          ui.render(teamBox, ui.table({
            compact: true,
            columns: [
              { key: 'userName', label: 'Employee' },
              { key: 'roleOnSite', label: 'Site role' },
              { label: 'From', render: function (r) { return ui.fmtDate(r.assignedFrom); } },
              { label: 'To', render: function (r) { return r.assignedTo ? ui.fmtDate(r.assignedTo) : 'active'; } },
              { label: 'Wage/day', align: 'right', render: function (r) { return ST.i18n.money(r.dailyWage || 0); } },
              { label: 'Status', render: function (r) { return ui.badge(r.status); } },
              session.can('createEmployees') ? {
                label: '', render: function (r) {
                  return String(r.status) === 'Active' ? h('button.btn.sm.ghost', {
                    onclick: function () {
                      ui.confirm('End ' + r.userName + '\'s assignment to ' + p.name + '?').then(function (ok) {
                        if (!ok) return;
                        run(api.must('endAssignment', { assignmentId: r.assignmentId }), 'Assignment ended')
                          .then(function (x) { if (x.success) m.close(); });
                      });
                    }
                  }, 'End') : null;
                }
              } : null
            ].filter(Boolean),
            rows: tr.data.assignments || [],
            emptyMessage: 'Nobody assigned yet.'
          }));
        });
      });
    }

    /** Who is physically on this site today — rolled up server-side. */
    function loadLiveTeam(projectId, box) {
      api.must('projectTeam', { projectId: projectId }).then(function (res) {
        if (!res.success) return ui.render(box, h('div.err-box', null, res.error.message));
        var d = res.data, tt = d.today || {};
        ui.render(box, [
          h('div.row.mt.tiny', { style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, [
            h('b', null, (tt.present || 0) + ' / ' + (tt.total || 0) + ' marked'),
            h('span.chip', null, (tt.percentage || 0) + '% coverage')
          ].concat(Object.keys(tt.counts || {}).filter(function (k) {
            return k !== 'other' && tt.counts[k];
          }).map(function (k) { return h('span.chip', null, k + ' ' + tt.counts[k]); }))),
          ui.table({
            compact: true,
            columns: [
              { key: 'name', label: 'Worker' },
              { key: 'roleOnSite', label: 'Site role' },
              {
                label: 'Status', render: function (r) {
                  return r.status === 'NotMarked' ? h('span.tiny.muted', null, 'no mark yet today') : ui.badge(r.status);
                }
              },
              { label: 'In', render: function (r) { return r.markedAt ? ui.fmtTime(r.markedAt) : '—'; } },
              { label: 'Out', render: function (r) { return r.markedOutAt ? ui.fmtTime(r.markedOutAt) : '—'; } },
              { label: 'Distance', align: 'right', render: function (r) { return r.distance == null ? '—' : ui.dist(r.distance); } },
              { label: 'Source', render: function (r) { return r.source ? h('span.tiny.muted', null, r.source) : ''; } }
            ],
            rows: d.members || [],
            emptyMessage: 'No active assignments on this site.'
          })
        ]);
      });
    }

    /** Active / OnHold / Completed — Completed also closes the end date. */
    function setProjectStatus(p, reload) {
      ui.promptFields('Project status — ' + p.name, [
        {
          name: 'status', label: 'Status', type: 'select', required: true, value: p.status,
          options: [
            { value: 'Active', label: 'Active — workers can mark attendance here' },
            { value: 'OnHold', label: 'On hold — paused, history kept' },
            { value: 'Completed', label: 'Completed — site closed' }
          ],
          hint: 'Only Active sites accept check-ins or feed the daily report and weather jobs.'
        }
      ], 'Save status').then(function (v) {
        if (!v || v.status === p.status) return;
        run(api.must('setProjectStatus', { projectId: p.projectId, status: v.status }), 'Site is now ' + v.status)
          .then(function (x) { if (x.success) { invalidate('projects'); reload(); } });
      });
    }

    /** Fetch (or rotate) the site QR and hand over a printable sheet. */
    function siteQrCode(p, box, regenerate, reload) {
      run(api.must('projectQrCode', { projectId: p.projectId, regenerate: !!regenerate }),
        regenerate ? 'A fresh QR was issued — older prints stop working' : 'QR ready')
        .then(function (res) {
          if (!res.success) return;
          var d = res.data;
          if (box) {
            ui.render(box, [
              h('img', { src: d.imageUrl, alt: 'QR', style: { width: '160px', borderRadius: '10px', background: '#fff', padding: '6px' } }),
              h('div.tiny.muted.mt', { style: { wordBreak: 'break-all' } }, d.payload)
            ]);
          }
          var sheet = h('div', { style: { textAlign: 'center', padding: '12px' } }, [
            h('h2', null, d.projectName),
            h('img', { src: d.imageUrl, alt: 'Site QR', style: { width: '300px', background: '#fff', padding: '12px' } }),
            h('p', null, 'Scan at the site office when GPS fails indoors'),
            h('p.tiny.muted', { style: { wordBreak: 'break-all' } }, d.payload)
          ]);
          ui.modal({
            title: 'Site gate QR — ' + d.projectName,
            body: [sheet, h('div.hint.mt', null, d.printInstructions)],
            actions: [
              { label: 'Print sheet', kind: 'primary', onClick: function () { ui.printNode(sheet); } },
              { label: 'Close', onClick: function (c) { c(); } }
            ]
          });
          if (regenerate) { invalidate('projects'); if (reload) reload(); }
        });
    }

    function editProject(p) {
      var fields = {
        name: h('input', { value: p ? p.name : '', maxlength: 120 }),
        clientName: h('input', { value: p ? p.clientName : '', maxlength: 120 }),
        clientContact: h('input', { value: p ? p.clientContact : '', maxlength: 60 }),
        pmcName: h('input', { value: p ? p.pmcName : '' }),
        pmcContact: h('input', { value: p ? p.pmcContact : '' }),
        siteEngineer: h('input', { value: p ? p.siteEngineer : '' }),
        address: h('textarea', { rows: 2 }, p ? p.address : ''),
        startDate: dateInput(p ? p.startDate : undefined),
        endDate: dateInput(p && p.endDate ? p.endDate : ''),
        radius: h('input', { type: 'number', value: p ? p.geofenceRadius : (cache.settings || {}).defaultGeofenceRadius || 200, min: 10, max: 50000 }),
        windowStart: h('input', { type: 'time', value: p ? p.windowStart : '06:00' }),
        windowEnd: h('input', { type: 'time', value: p ? p.windowEnd : '11:00' }),
        outWindowStart: h('input', { type: 'time', value: p ? p.outWindowStart : '16:00' }),
        outWindowEnd: h('input', { type: 'time', value: p ? p.outWindowEnd : '23:59' }),
        lat: h('input', { type: 'number', step: '0.00001', value: p && p.lat ? p.lat : '' }),
        lng: h('input', { type: 'number', step: '0.00001', value: p && p.lng ? p.lng : '' })
      };
      var mapBox = h('div.map.sm');
      var picker = null;
      var geoBtn = h('button.btn.sm', {
        onclick: function () {
          geoBtn.disabled = true; geoBtn.textContent = 'Locating…';
          api.must('geocodeAddress', { address: fields.address.value }).then(function (res) {
            geoBtn.disabled = false; geoBtn.textContent = '📍 Find on map';
            if (!res.success) return ui.toast(res.error.message, 'bad');
            fields.lat.value = res.data.lat; fields.lng.value = res.data.lng;
            if (picker && picker.setLocation) picker.setLocation(res.data.lat, res.data.lng);
            ui.toast('Address located: ' + (res.data.formatted || res.data.source || ''), 'good');
          });
        }
      }, '📍 Find on map');
      var gpsBtn = h('button.btn.sm.ghost', {
        onclick: function () {
          api.device.position().then(function (pos) {
            fields.lat.value = pos.lat.toFixed(5); fields.lng.value = pos.lng.toFixed(5);
            if (picker && picker.setLocation) picker.setLocation(pos.lat, pos.lng);
          }).catch(function (e) { ui.toast(e.message === 'GPS_DENIED' ? 'Location permission denied' : 'Could not get GPS fix', 'bad'); });
        }
      }, 'Use my GPS');

      ui.modal({
        wide: true,
        title: p ? 'Edit project' : 'New project (GPS lock)',
        body: [
          h('div.grid.c2', [
            h('div', [
              h('div.field', [h('label.req', null, 'Project name'), fields.name]),
              h('div.grid.c2', [
                h('div.field', [h('label.req', null, 'Client name'), fields.clientName]),
                h('div.field', [h('label.req', null, 'Client contact'), fields.clientContact])
              ]),
              h('div.grid.c2', [
                h('div.field', [h('label', null, 'PMC name'), fields.pmcName]),
                h('div.field', [h('label', null, 'PMC contact'), fields.pmcContact])
              ]),
              h('div.field', [h('label', null, 'Site engineer'), fields.siteEngineer]),
              h('div.field', [h('label.req', null, 'Site address (printed on reports)'), fields.address,
                h('div.row.mt', { style: { gap: '6px' } }, [geoBtn, gpsBtn])]),
              h('div.grid.c2', [
                h('div.field', [h('label.req', null, 'Start date'), fields.startDate]),
                h('div.field', [h('label', null, 'End date'), fields.endDate])
              ])
            ]),
            h('div', [
              h('div.field', [h('label', null, 'Latitude'), fields.lat]),
              h('div.field', [h('label', null, 'Longitude'), fields.lng]),
              mapBox,
              h('div.tiny.muted.mt', null, 'Click the map to drop the site pin (or drag it).'),
              h('div.grid.c2.mt', [
                h('div.field', [h('label', null, 'Geofence radius (m)'), fields.radius]),
                h('div.field', [h('label', null, 'Site engineer'), null])
              ]),
              h('div.grid.c2', [
                h('div.field', [h('label', null, 'Mark-in window'), h('div.row', null, [fields.windowStart, fields.windowEnd])]),
                h('div.field', [h('label', null, 'Mark-out window'), h('div.row', null, [fields.outWindowStart, fields.outWindowEnd])])
              ])
            ])
          ])
        ],
        actions: [{
          label: p ? 'Save changes' : 'Create project', kind: 'primary', onClick: function (close) {
            var payload = {
              name: fields.name.value.trim(), clientName: fields.clientName.value.trim(),
              clientContact: fields.clientContact.value.trim(), pmcName: fields.pmcName.value.trim(),
              pmcContact: fields.pmcContact.value.trim(), siteEngineer: fields.siteEngineer.value.trim(),
              address: fields.address.value.trim(), startDate: fields.startDate.value,
              endDate: fields.endDate.value || '', geofenceRadius: Number(fields.radius.value),
              windowStart: fields.windowStart.value, windowEnd: fields.windowEnd.value,
              outWindowStart: fields.outWindowStart.value, outWindowEnd: fields.outWindowEnd.value,
              lat: Number(fields.lat.value || 0), long: Number(fields.lng.value || 0)
            };
            if (!payload.name || !payload.clientName || !payload.clientContact || !payload.address || !payload.startDate) {
              return ui.toast('Name, client, contact, address and start date are required', 'bad');
            }
            if (p) payload.projectId = p.projectId;
            run(api.must(p ? 'updateProject' : 'createProject', payload), p ? 'Project updated' : 'Project created — now assign your team')
              .then(function (r) { if (r.success) { close(); invalidate('projects'); load(); } });
          }
        }]
      });
      picker = ST.map.picker(mapBox, { lat: p && p.lat, lng: p && p.lng, radius: p ? p.geofenceRadius : Number(fields.radius.value) },
        function (ll) { fields.lat.value = ll.lat.toFixed(5); fields.lng.value = ll.lng.toFixed(5); });
    }

    function assignEmployee(p) {
      Promise.all([userOptions(), shifts()]).then(function (opts) {
        var fu = h('select', null, opts[0].map(function (o) { return h('option', { value: o.value }, o.label); }));
        var fr = h('input', { placeholder: 'e.g. Electrician, Supervisor', maxlength: 60 });
        var fd = dateInput();
        var fw = h('input', { type: 'number', value: 0, min: 0, step: 50 });
        var fs = h('select', null, [h('option', { value: '' }, 'Company default')].concat(
          (opts[1] || []).map(function (s) { return h('option', { value: s.shiftId }, s.name); })));
        ui.modal({
          title: 'Assign employee to ' + p.name,
          body: [
            h('div.field', [h('label.req', null, 'Employee'), fu]),
            h('div.grid.c2', [
              h('div.field', [h('label', null, 'Role on site'), fr]),
              h('div.field', [h('label', null, 'From date'), fd])
            ]),
            h('div.grid.c2', [
              h('div.field', [h('label', null, 'Daily wage at this site (₹)'), fw]),
              h('div.field', [h('label', null, 'Shift'), fs])
            ])
          ],
          actions: [{
            label: 'Assign', kind: 'primary', onClick: function (close) {
              run(api.must('assignEmployee', {
                projectId: p.projectId, userId: fu.value, roleOnSite: fr.value,
                assignedFrom: fd.value, dailyWage: Number(fw.value || 0), shiftId: fs.value
              }), 'Employee assigned').then(function (r) { if (r.success) { close(); load(); } });
            }
          }]
        });
      });
    }
  };

  /* ------------------------------------------------------------- employees */
  VIEWS.employees = async function (el, param) {
    var body = h('div');
    var filterRole = h('select', null, [h('option', { value: '' }, 'All roles')]
      .concat(['SuperAdmin', 'Admin', 'SubAdmin', 'SiteEmployee'].map(function (s) { return h('option', null, s); })));
    var filterStatus = h('select', null, [h('option', { value: '' }, 'All statuses')]
      .concat(['Active', 'Inactive', 'Suspended'].map(function (s) { return h('option', null, s); })));
    var search = h('input', { placeholder: 'Search name / ID / mobile' });

    async function load() {
      ui.loading(body);
      var res = await api.must('listUsers', { role: filterRole.value, status: filterStatus.value });
      if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
      var rows = (res.data.users || []).filter(function (u) {
        var q = search.value.toLowerCase();
        return !q || (u.name + ' ' + u.userId + ' ' + u.mobile).toLowerCase().indexOf(q) >= 0;
      });
      ui.render(body, ui.table({
        columns: [
          { label: 'Employee', render: function (r) { return h('div.row', { style: { gap: '8px' } }, [h('span.avatar', null, ui.initials(r.name)), h('div', [h('b', null, r.name), h('div.tiny.muted', null, r.userId + ' · ' + (r.designation || ''))])]); } },
          { label: 'Role', render: function (r) { return ui.badge(r.role === 'SiteEmployee' ? 'Present' : 'Approved', r.role); } },
          { label: 'Mobile', render: function (r) { return r.mobile; } },
          { label: 'Projects', render: function (r) { return (r.projects || []).map(function (p) { return h('span.chip', null, p); }); } },
          { label: 'Status', render: function (r) { return ui.badge(r.status); } },
          { label: '', render: function (r) { return h('button.btn.sm.ghost', { onclick: function () { openUser(r.userId); } }, 'Open'); } }
        ],
        rows: rows,
        emptyMessage: 'No employees match the filter.'
      }));
    }

    ui.render(el, [
      sectionHead('Employees', 'Accounts, site roles, wages, permissions and devices', [
        session.can('createEmployees') ? h('button.btn.primary.sm', { onclick: function () { editUser(null); } }, '+ Add employee') : null
      ]),
      h('div.card', [h('div.filters', [search, filterRole, filterStatus, h('button.btn', { onclick: load }, 'Apply')])]),
      body
    ]);
    search.addEventListener('input', debounce(load, 250));
    load();
    if (param) openUser(param);

    function openUser(id) {
      api.must('getUser', { userId: id }).then(function (res) {
        if (!res.success) return ui.toast(res.error.message, 'bad');
        var u = res.data.user;
        var perms = res.data.permissions || {};
        var scope = res.data.projectScope || [];
        ui.modal({
          wide: true,
          title: u.name,
          body: [
            h('div.grid.c2', [
              h('div', [
                ui.kvList([
                  ['User ID', u.userId || u.UserID], ['Role', u.role || u.Role], ['Status', ui.badge(u.status || u.Status)],
                  ['Mobile', u.mobile || u.MobileNumber], ['Email', u.email || u.Email],
                  ['Designation', u.designation || u.Designation], ['Salary', (u.salaryType || u.SalaryType) + ' · ' + ST.i18n.money(u.dailyWage || u.DailyWage || 0) + '/day'],
                  ['Joined', ui.fmtDate(u.joinedAt || u.JoinedAt)], ['Weekly off', u.weeklyOff || u.WeeklyOff],
                  ['Device', u.deviceStatus || u.DeviceStatus], ['Bank', u.bankAccount || u.BankAccount],
                  ['Reports to', u.reportsTo || u.ReportsTo]
                ]),
                h('h4.mt', null, 'Project scope'),
                h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } }, scope.map(function (s) { return h('span.chip', null, s); })),
                h('h4.mt', null, 'Permissions'),
                h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } }, perms.__all ? [h('span.chip.ok', null, 'ALL (Super Admin)')] :
                  Object.keys(perms).filter(function (k) { return perms[k] && k !== '__all'; }).map(function (k) { return h('span.chip', null, k); }))
              ]),
              h('div', [
                h('h4', null, 'Assignments'),
                ui.table({
                  compact: true,
                  columns: [{ key: 'projectName', label: 'Project' }, { key: 'roleOnSite', label: 'Role' }, { label: 'From', render: function (r) { return ui.fmtDate(r.assignedFrom); } }, { label: 'Status', render: function (r) { return ui.badge(r.status); } }],
                  rows: res.data.assignments || [],
                  emptyMessage: 'No project assignments.'
                }),
                h('h4.mt', null, 'Devices'),
                ui.table({
                  compact: true,
                  columns: [{ label: 'Device', render: function (r) { return r.label || r.deviceId; } }, { label: 'Status', render: function (r) { return ui.badge(r.status); } }, { label: 'Last used', render: function (r) { return ui.ago(r.lastUsedAt); } }],
                  rows: res.data.devices || [],
                  emptyMessage: 'No devices registered yet.'
                })
              ])
            ])
          ],
          actions: [
            session.can('editEmployees') ? { label: 'Edit', kind: 'primary', onClick: function (c) { c(); editUser(u.userId || u.UserID); } } : null,
            session.role === 'SuperAdmin' || session.can('editEmployees') ? {
              label: 'Permissions', onClick: function (c) { c(); editPermissions(u, perms, scope); }
            } : null,
            session.can('editEmployees') ? {
              label: 'Reset password', onClick: function (c) {
                c();
                ui.confirm('Generate a new temporary password for ' + u.name + '? It will be shown once and e-mailed.').then(function (ok) {
                  if (!ok) return;
                  run(api.must('resetUserPassword', { userId: u.userId || u.UserID })).then(function (r) {
                    if (r.success) ui.modal({ title: 'Temporary password', body: h('div.ok-box', [h('p', null, 'Share this with the employee — they must change it at first sign-in.'), h('code.big', null, r.data.tempPassword || r.data.password || '')]) });
                  });
                });
              }
            } : null,
            session.can('deactivateEmployees') ? {
              label: (u.status || u.Status) === 'Active' ? 'Deactivate' : 'Activate', kind: 'bad', onClick: function (c) {
                c();
                var next = (u.status || u.Status) === 'Active' ? 'Inactive' : 'Active';
                run(api.must('setUserStatus', { userId: u.userId || u.UserID, status: next }), 'Status updated').then(function (r) { if (r.success) { invalidate('users'); load(); } });
              }
            } : null,
            { label: 'Close', onClick: function (c) { c(); } }
          ].filter(Boolean)
        });
      });
    }

    function editUser(id) {
      enums().then(function (en) {
        var loadingBox = id ? h('div.loading-block', null, h('span.spinner')) : null;
        var fields = {
          name: h('input', { maxlength: 120 }), role: h('select', null, (en.roles || ['SiteEmployee']).map(function (r) { return h('option', { value: r }, r); })),
          mobile: h('input', { type: 'tel', maxlength: 12 }), email: h('input', { type: 'email' }),
          designation: h('input', {}), salaryType: h('select', null, ['Daily', 'Monthly', 'Contract'].map(function (s) { return h('option', null, s); })),
          dailyWage: h('input', { type: 'number', min: 0, step: 50, value: 0 }), monthlySalary: h('input', { type: 'number', min: 0, step: 500, value: 0 }),
          weeklyOff: h('select', null, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(function (d, i) { return h('option', { value: String(i) }, d); })),
          joinedAt: dateInput(), address: h('textarea', { rows: 2 }), emergencyContact: h('input', { maxlength: 20 }),
          bankAccount: h('input', { maxlength: 30 }), ifscCode: h('input', { maxlength: 15 }),
          reportsTo: h('input', { maxlength: 32 }), notes: h('textarea', { rows: 2 })
        };
        fields.role.value = 'SiteEmployee';

        function prefill(u) {
          if (!u) return;
          fields.name.value = u.Name || u.name || ''; fields.role.value = u.Role || u.role || 'SiteEmployee';
          fields.mobile.value = u.MobileNumber || u.mobile || ''; fields.email.value = u.Email || u.email || '';
          fields.designation.value = u.Designation || u.designation || '';
          fields.salaryType.value = u.SalaryType || u.salaryType || 'Daily';
          fields.dailyWage.value = u.DailyWage || u.dailyWage || 0; fields.monthlySalary.value = u.MonthlySalary || u.monthlySalary || 0;
          fields.weeklyOff.value = String(u.WeeklyOff !== undefined ? u.WeeklyOff : (u.weeklyOff || '0'));
          fields.joinedAt.value = (u.JoinedAt || u.joinedAt || '').slice(0, 10);
          fields.address.value = u.Address || u.address || ''; fields.emergencyContact.value = u.EmergencyContact || u.emergencyContact || '';
          fields.bankAccount.value = u.BankAccount || u.bankAccount || ''; fields.ifscCode.value = u.IfscCode || u.ifscCode || '';
          fields.reportsTo.value = u.ReportsTo || u.reportsTo || ''; fields.notes.value = u.Notes || u.notes || '';
        }

        var modal = ui.modal({
          wide: true,
          title: id ? 'Edit employee' : 'Add employee',
          body: [
            loadingBox,
            h('div.grid.c2', [
              h('div', [
                h('div.field', [h('label.req', null, 'Full name'), fields.name]),
                h('div.grid.c2', [
                  h('div.field', [h('label.req', null, 'Mobile'), fields.mobile]),
                  h('div.field', [h('label', null, 'Email'), fields.email])
                ]),
                h('div.grid.c2', [
                  h('div.field', [h('label.req', null, 'Role'), fields.role]),
                  h('div.field', [h('label', null, 'Designation'), fields.designation])
                ]),
                h('div.grid.c2', [
                  h('div.field', [h('label', null, 'Salary type'), fields.salaryType]),
                  h('div.field', [h('label', null, 'Weekly off'), fields.weeklyOff])
                ]),
                h('div.grid.c2', [
                  h('div.field', [h('label', null, 'Daily wage (₹)'), fields.dailyWage]),
                  h('div.field', [h('label', null, 'Monthly salary (₹)'), fields.monthlySalary])
                ]),
                h('div.field', [h('label', null, 'Joined on'), fields.joinedAt])
              ]),
              h('div', [
                h('div.field', [h('label', null, 'Address'), fields.address]),
                h('div.grid.c2', [
                  h('div.field', [h('label', null, 'Emergency contact'), fields.emergencyContact]),
                  h('div.field', [h('label', null, 'Reports to (user ID)'), fields.reportsTo])
                ]),
                h('div.grid.c2', [
                  h('div.field', [h('label', null, 'Bank account'), fields.bankAccount]),
                  h('div.field', [h('label', null, 'IFSC'), fields.ifscCode])
                ]),
                h('div.field', [h('label', null, 'Notes'), fields.notes]),
                h('div.hint', null, id ? '' : 'A temporary password is generated automatically and e-mailed; the employee must change it at first sign-in.')
              ])
            ])
          ],
          actions: [{
            label: id ? 'Save' : 'Create account', kind: 'primary', onClick: function (close) {
              var payload = {
                name: fields.name.value.trim(), role: fields.role.value, mobile: fields.mobile.value.trim(),
                email: fields.email.value.trim(), designation: fields.designation.value.trim(),
                salaryType: fields.salaryType.value, dailyWage: Number(fields.dailyWage.value || 0),
                monthlySalary: Number(fields.monthlySalary.value || 0), weeklyOff: fields.weeklyOff.value,
                joinedAt: fields.joinedAt.value, address: fields.address.value.trim(),
                emergencyContact: fields.emergencyContact.value.trim(), bankAccount: fields.bankAccount.value.trim(),
                ifscCode: fields.ifscCode.value.trim(), reportsTo: fields.reportsTo.value.trim(), notes: fields.notes.value.trim()
              };
              if (!payload.name || !payload.mobile) return ui.toast('Name and mobile are required', 'bad');
              if (id) payload.userId = id;
              run(api.must(id ? 'updateUser' : 'createUser', payload), id ? 'Employee updated' : 'Account created — share the temporary password')
                .then(function (r) {
                  if (!r.success) return;
                  close(); invalidate('users'); load();
                  if (!id && r.data.tempPassword) {
                    ui.modal({ title: 'Temporary password', body: h('div.ok-box', [h('p', null, 'E-mailed to the employee. Show it once now:'), h('code.big', null, r.data.tempPassword)]) });
                  }
                });
            }
          }]
        });
        if (id) api.must('getUser', { userId: id }).then(function (r) {
          if (r.success) prefill(r.data.user);
          if (loadingBox) loadingBox.remove();
        });
      });
    }

    function editPermissions(u, currentPerms, currentScope) {
      var uid = u.userId || u.UserID;
      enums().then(function (en) {
        var list = en.permissions || [];
        var current = currentPerms || {};
        var boxes = {};
        var scopeSel = h('select', { multiple: true, size: 8 });
        projects().then(function (ps) {
          ui.render(scopeSel, [h('option', { value: 'ALL' }, 'ALL — every project')].concat(
            ps.map(function (p) { return h('option', { value: p.projectId }, p.name); })));
          (currentScope || []).forEach(function (s) {
            ui.qsa('option', scopeSel).forEach(function (o) { if (o.value === s) o.selected = true; });
          });
        });
        ui.modal({
          wide: true,
          title: 'Permissions — ' + u.name,
          body: [
            h('p.tiny.muted', null, 'Granular toggles for Sub-Admins and Admins. Super Admins always hold every right. Changes apply at next sign-in or token refresh.'),
            h('div.perm-grid', null, list.map(function (p) {
              var cb = h('input', { type: 'checkbox', checked: !!(current.__all || current[p]) });
              boxes[p] = cb;
              return h('label.perm', null, [cb, h('span', null, p)]);
            })),
            h('h4.mt', null, 'Project scope (multi-select)'),
            scopeSel,
            h('div.hint', null, 'Scope restricts every list, report and approval this user can touch — enforced server-side.')
          ],
          actions: [{
            label: 'Save permissions', kind: 'primary', onClick: function (close) {
              var perms = {};
              Object.keys(boxes).forEach(function (k) { if (boxes[k].checked) perms[k] = true; });
              var scope = ui.qsa('option', scopeSel).filter(function (o) { return o.selected; }).map(function (o) { return o.value; });
              run(api.must('setUserPermissions', { userId: uid, permissions: perms, projectScope: scope }), 'Permissions saved')
                .then(function (r) { if (r.success) { close(); invalidate('users'); } });
            }
          }]
        });
      });
    }
  };


  /* ------------------------------------------------------- device registry */
  VIEWS.devices = async function (el) {
    var body = h('div');
    var statusSel = h('select', null, ['All', 'Active', 'PendingChange', 'Blocked'].map(function (s) {
      return h('option', null, s);
    }));

    async function load() {
      ui.loading(body);
      var st = statusSel.value === 'All' ? '' : statusSel.value;
      var res = await api.must('listDeviceRegistry', st ? { status: st } : {});
      if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
      var d = res.data;
      var pending = (d.devices || []).filter(function (r) { return r.pendingFingerprint; }).length;
      ui.render(body, [
        h('div.stats', [
          ui.statCard('Bound devices', d.count, 'one per worker account', 'accent'),
          ui.statCard('Awaiting approval', pending, 'new-phone requests', pending ? 'warn' : 'good')
        ]),
        ui.table({
          columns: [
            { label: 'Employee', render: function (r) { return h('div', [h('b', null, r.userName || r.userId), h('div.tiny.muted', null, (r.role || '') + ' · ' + (r.mobile || ''))]); } },
            { label: 'Device', render: function (r) { return h('div', [h('span', null, r.label || 'unnamed'), h('div.tiny.muted', null, r.userAgent || '')]); } },
            { label: 'Fingerprint', render: function (r) { return h('span.tiny.muted', null, r.fingerprint); } },
            {
              label: 'Change requested', render: function (r) {
                return r.pendingFingerprint
                  ? h('div', [h('span.tiny', null, r.pendingFingerprint), h('div.tiny.muted', null, ui.ago(r.requestedAt))])
                  : h('span.tiny.muted', null, 'none');
              }
            },
            { label: 'Last used', render: function (r) { return r.lastUsedAt ? ui.ago(r.lastUsedAt) : 'never'; } },
            { label: 'Logins', align: 'right', render: function (r) { return r.loginCount; } },
            { label: 'Status', render: function (r) { return ui.badge(r.status); } },
            {
              label: '', render: function (r) {
                var btns = [];
                if (r.pendingFingerprint) {
                  btns.push(h('button.btn.sm.primary', { onclick: function () { decideDevice('approve', r); } }, 'Approve'));
                  btns.push(h('button.btn.sm.bad', { onclick: function () { decideDevice('reject', r); } }, 'Reject'));
                }
                btns.push(String(r.status) === 'Blocked'
                  ? h('button.btn.sm', { onclick: function () { toggleBlock(r, false); } }, 'Unblock')
                  : h('button.btn.sm.ghost', { onclick: function () { toggleBlock(r, true); } }, 'Block'));
                return h('div.row', { style: { gap: '6px' } }, btns);
              }
            }
          ],
          rows: d.devices || [],
          emptyMessage: 'Nothing here yet — a device is bound the first time a worker signs in.'
        })
      ]);
    }

    function decideDevice(decision, r) {
      run(api.must('approveDeviceChange', {
        deviceId: r.deviceId, decision: decision, note: 'Handled in the device registry'
      }), decision === 'approve' ? 'Device bound — ' + (r.userName || r.userId) + ' can mark attendance' : 'Device change rejected')
        .then(function (x) { if (x.success) load(); });
    }

    function toggleBlock(r, blocked) {
      ui.promptFields(blocked ? 'Block this device' : 'Unblock this device', [
        {
          name: 'reason', label: 'Reason (kept in the audit log)', type: 'textarea', required: blocked,
          value: blocked ? 'Phone lost or stolen' : 'Returned to service',
          hint: 'While blocked this worker cannot sign in or mark attendance from that device.'
        }
      ], blocked ? 'Block device' : 'Unblock device').then(function (v) {
        if (!v) return;
        run(api.must('blockDevice', { deviceId: r.deviceId, blocked: blocked, reason: String(v.reason).slice(0, 200) }),
          blocked ? 'Device blocked' : 'Device unblocked').then(function (x) { if (x.success) load(); });
      });
    }

    ui.render(el, [
      sectionHead('Device registry', 'Every phone bound to an account — approve new ones, block lost or shared ones', [
        statusSel, h('button.btn.sm', { onclick: load }, 'Apply')
      ]),
      body
    ]);
    load();
  };

  /* ------------------------------------------------------- leave/expenses */
  function requestList(section) {
    return async function (el) {
      var cfg = {
        leave: { action: 'listLeaves', field: 'leaves', decide: 'decideLeave', idKey: 'leaveId', perm: 'approveLeave', title: 'Leave requests' },
        expense: { action: 'listExpenses', field: 'expenses', decide: 'decideExpense', idKey: 'expenseId', perm: 'approveExpense', title: 'Expense claims' },
        transfer: { action: 'listTransfers', field: 'transfers', decide: 'decideTransfer', idKey: 'transferId', perm: 'approveTransfer', title: 'Site transfers' }
      }[section];
      var statusSel = h('select', null, [h('option', { value: '' }, 'All statuses')].concat(['Pending', 'Approved', 'Rejected', 'Cancelled'].map(function (s) { return h('option', null, s); })));
      var body = h('div');
      async function load() {
        ui.loading(body);
        var res = await api.must(cfg.action, { status: statusSel.value, limit: 200 });
        if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
        var rows = res.data[cfg.field] || [];
        ui.render(body, ui.table({
          columns: section === 'leave' ? [
            { key: 'userName', label: 'Employee' },
            { label: 'Type', render: function (r) { return ui.badge(r.type); } },
            { label: 'Period', render: function (r) { return ui.fmtDate(r.fromDate) + ' → ' + ui.fmtDate(r.toDate) + ' (' + r.days + 'd)'; } },
            { key: 'reason', label: 'Reason' },
            { label: 'Status', render: function (r) { return ui.badge(r.status); } },
            { label: 'Decision', render: function (r) { return r.reviewNote || r.approvedBy || '—'; } },
            canceller(rows, load),
            decider(cfg, rows, load)
          ] : section === 'expense' ? [
            { key: 'userName', label: 'Employee' },
            { label: 'Amount', align: 'right', render: function (r) { return ST.i18n.money(r.amount); } },
            { key: 'category', label: 'Category' },
            { key: 'description', label: 'Description' },
            { label: 'Proof', render: function (r) { return r.proofFileId ? h('button.btn.sm.ghost', { onclick: function () { openSelfie(r.proofFileId); } }, '📎') : '—'; } },
            { label: 'Status', render: function (r) { return h('span', null, [ui.badge(r.status), r.payoutStatus ? h('span.badge.muted', null, r.payoutStatus) : null]); } },
            decider(cfg, rows, load)
          ] : [
            { key: 'userName', label: 'Employee' },
            { label: 'Move', render: function (r) { return (r.fromProjectName || '—') + ' → ' + (r.toProjectName || r.toProjectId); } },
            { label: 'Effective', render: function (r) { return ui.fmtDate(r.effectiveDate); } },
            { key: 'reason', label: 'Reason' },
            { label: 'Status', render: function (r) { return ui.badge(r.status); } },
            decider(cfg, rows, load)
          ],
          rows: rows,
          emptyMessage: 'Nothing here.'
        }));
      }
      ui.render(el, [
        sectionHead(cfg.title, 'History and decisions'),
        h('div.card', [h('div.filters', [statusSel, h('button.btn', { onclick: load }, 'Apply')])]),
        body
      ]);
      load();
    };
  }

  /** A worker may withdraw their own pending leave; staff may do it on their behalf. */
  function canceller(rows, reload) {
    return {
      label: '', render: function (r) {
        if (String(r.status) !== 'Pending') return null;
        var mine = String(r.userId) === String((session.user || {}).userId || '');
        if (!mine && !session.can('approveLeave')) return null;
        return h('button.btn.sm.ghost', {
          onclick: function () {
            ui.confirm('Cancel this leave request? It leaves the approval queue.').then(function (ok) {
              if (!ok) return;
              run(api.must('cancelLeave', { leaveId: r.leaveId }), 'Leave cancelled').then(function (x) { if (x.success) reload(); });
            });
          }
        }, 'Cancel');
      }
    };
  }

  function decider(cfg, rows, reload) {
    return {
      label: '', render: function (r) {
        if (r.status !== 'Pending' || !session.can(cfg.perm)) return h('span.muted.tiny', null, r.status);
        return h('div.row', { style: { gap: '6px' } }, [
          h('button.btn.sm.primary', {
            onclick: function () {
              var payload = { decision: 'approve', note: '' }; payload[cfg.idKey] = r[cfg.idKey];
              if (cfg.decide === 'decideLeave') payload.writeAttendance = true;
              run(api.must(cfg.decide, payload), 'Approved').then(function (x) { if (x.success) reload(); });
            }
          }, 'Approve'),
          h('button.btn.sm.bad', {
            onclick: function () {
              var payload = { decision: 'reject', note: 'Rejected from web app' }; payload[cfg.idKey] = r[cfg.idKey];
              run(api.must(cfg.decide, payload), 'Rejected').then(function (x) { if (x.success) reload(); });
            }
          }, 'Reject')
        ]);
      }
    };
  }
  VIEWS.leave = requestList('leave');
  VIEWS.expenses = requestList('expense');
  VIEWS.transfers = requestList('transfer');

  /* --------------------------------------------------------------- vendors */
  VIEWS.vendors = async function (el) {
    var body = h('div');
    async function load() {
      ui.loading(body);
      var res = await api.must('listVendors', {});
      if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
      ui.render(body, ui.table({
        columns: [
          { label: 'Vendor', render: function (r) { return h('div', [h('b', null, r.vendorName), h('div.tiny.muted', null, r.vendorId)]); } },
          { key: 'contactPerson', label: 'Contact' },
          { key: 'mobile', label: 'Mobile' },
          { label: 'Projects', render: function (r) { return (r.projectIds || []).join(', '); } },
          { label: 'Rate/head', align: 'right', render: function (r) { return ST.i18n.money(r.ratePerHead || 0); } },
          { label: 'Workers', align: 'right', render: function (r) { return r.workerCount; } },
          { label: 'Status', render: function (r) { return ui.badge(r.status); } },
          {
            label: '', render: function (r) {
              return h('div.row', { style: { gap: '6px' } }, [
                h('button.btn.sm.ghost', { onclick: function () { editVendor(r); } }, 'Edit'),
                session.can('manageVendors') ? h('button.btn.sm.' + (r.status === 'Active' ? 'bad' : 'primary'), {
                  onclick: function () {
                    var next = r.status === 'Active' ? 'Inactive' : 'Active';
                    ui.confirm('Mark ' + r.vendorName + ' as ' + next + '? ' +
                      (next === 'Inactive' ? 'They cannot be assigned to a site while inactive.' : 'They can be assigned to sites again.')).then(function (ok) {
                        if (!ok) return;
                        run(api.must('setVendorStatus', { vendorId: r.vendorId, status: next }), 'Vendor ' + next.toLowerCase())
                          .then(function (x) { if (x.success) load(); });
                      });
                  }
                }, r.status === 'Active' ? 'Disable' : 'Enable') : null
              ].filter(Boolean));
            }
          }
        ],
        rows: res.data.vendors || [],
        emptyMessage: 'No vendors registered.'
      }));
    }

    function editVendor(v) {
      projectOptions().then(function (opts) {
        var multi = h('select', { multiple: true, size: 6 }, opts.map(function (o) { return h('option', { value: o.value }, o.label); }));
        if (v) (v.projectIds || []).forEach(function (pid) {
          ui.qsa('option', multi).forEach(function (o) { if (o.value === pid) o.selected = true; });
        });
        var fields = {
          vendorName: h('input', { value: v ? v.vendorName : '' }), contactPerson: h('input', { value: v ? v.contactPerson : '' }),
          mobile: h('input', { value: v ? v.mobile : '' }), rate: h('input', { type: 'number', value: v ? (v.ratePerHead || 0) : 0, min: 0 }),
          gst: h('input', { value: v ? (v.gstNumber || '') : '' }), notes: h('textarea', { rows: 2 }, v ? (v.notes || '') : '')
        };
        ui.modal({
          title: v ? 'Edit vendor' : 'Register vendor',
          body: [
            h('div.field', [h('label.req', null, 'Vendor / contractor name'), fields.vendorName]),
            h('div.grid.c2', [
              h('div.field', [h('label', null, 'Contact person'), fields.contactPerson]),
              h('div.field', [h('label.req', null, 'Mobile'), fields.mobile])
            ]),
            h('div.grid.c2', [
              h('div.field', [h('label', null, 'Default rate per head (₹/day)'), fields.rate]),
              h('div.field', [h('label', null, 'GST no.'), fields.gst])
            ]),
            h('div.field', [h('label.req', null, 'Projects (multi-select)'), multi]),
            h('div.field', [h('label', null, 'Notes'), fields.notes])
          ],
          actions: [{
            label: 'Save vendor', kind: 'primary', onClick: function (close) {
              var pids = ui.qsa('option', multi).filter(function (o) { return o.selected; }).map(function (o) { return o.value; });
              if (!pids.length) return ui.toast('Select at least one project', 'bad');
              var payload = {
                vendorName: fields.vendorName.value.trim(), contactPerson: fields.contactPerson.value.trim(),
                mobile: fields.mobile.value.trim(), ratePerHead: Number(fields.rate.value || 0),
                gstNumber: fields.gst.value.trim(), notes: fields.notes.value.trim(), projectIds: pids
              };
              if (v) payload.vendorId = v.vendorId;
              run(api.must('saveVendor', payload), 'Vendor saved').then(function (r) { if (r.success) { close(); load(); } });
            }
          }]
        });
      });
    }

    function logWorkers() {
      api.must('listVendors', {}).then(function (vr) {
        if (!vr.success) return ui.toast(vr.error.message, 'bad');
        var vendors = (vr.data.vendors || []).filter(function (v) { return v.status === 'Active'; });
        if (!vendors.length) return ui.toast('Register an active vendor first', 'bad');
        var fv = h('select', null, vendors.map(function (v) { return h('option', { value: v.vendorId }, v.vendorName); }));
        var fp = h('select');
        var fd = dateInput();
        var mode = h('select', null, [h('option', { value: 'named' }, 'Named workers'), h('option', { value: 'bulk' }, 'Bulk headcount')]);
        var named = h('input', { placeholder: 'Worker name (optional)' });
        var count = h('input', { type: 'number', value: 1, min: 1 });
        var rate = h('input', { type: 'number', placeholder: 'override ₹/head (optional)' });
        var photo = h('input', { type: 'file', accept: 'image/*' });
        function refreshProjects() {
          var v = vendors.filter(function (x) { return x.vendorId === fv.value; })[0] || { projectIds: [] };
          projectOptions().then(function (opts) {
            ui.render(fp, opts.filter(function (o) { return (v.projectIds || []).indexOf(o.value) >= 0; })
              .map(function (o) { return h('option', { value: o.value }, o.label); }));
          });
        }
        fv.addEventListener('change', refreshProjects); refreshProjects();
        mode.addEventListener('change', function () { named.hidden = mode.value !== 'named'; photo.hidden = mode.value !== 'named'; count.hidden = mode.value !== 'bulk'; });
        ui.modal({
          title: 'Log vendor manpower',
          body: [
            h('div.field', [h('label.req', null, 'Vendor'), fv]),
            h('div.grid.c2', [h('div.field', [h('label.req', null, 'Project'), fp]), h('div.field', [h('label.req', null, 'Date'), fd])]),
            h('div.grid.c2', [h('div.field', [h('label', null, 'Mode'), mode]), h('div.field', [h('label', null, 'Headcount'), count])]),
            h('div.field', [h('label', null, 'Worker name'), named]),
            h('div.field', [h('label', null, 'Photo (optional, live capture not enforced for vendors)'), photo]),
            h('div.field', [h('label', null, 'Rate override'), rate])
          ],
          actions: [{
            label: 'Save entry', kind: 'primary', onClick: function (close) {
              var doIt = function (photoData) {
                run(api.must('addVendorWorkerEntry', mode.value === 'named' ? {
                  vendorId: fv.value, projectId: fp.value, date: fd.value,
                  workers: [{ name: named.value.trim() || 'Worker', photoBase64: photoData || '' }],
                  ratePerDay: Number(rate.value || 0)
                } : {
                  vendorId: fv.value, projectId: fp.value, date: fd.value,
                  count: Number(count.value || 1), ratePerDay: Number(rate.value || 0)
                }), 'Vendor manpower logged').then(function (r) { if (r.success) { close(); load(); } });
              };
              if (mode.value === 'named' && photo.files && photo.files[0]) {
                ST.api.device.shrink ? api.fileToDataUrl(photo.files[0]).then(function (d) { return api.device.shrink(d, 640, 0.7); }).then(doIt) : doIt('');
              } else doIt('');
            }
          }]
        });
      });
    }

    ui.render(el, [
      sectionHead('Sub-vendors & manpower', 'Contractor workers logged by name or bulk headcount', [
        h('button.btn.sm', { onclick: logWorkers }, '+ Log manpower'),
        session.can('manageVendors') ? h('button.btn.primary.sm', { onclick: function () { editVendor(null); } }, '+ Register vendor') : null,
        h('button.btn.sm.ghost', { onclick: vendorReport }, 'Manpower report')
      ]),
      body
    ]);
    load();

    function vendorReport() {
      var from = dateInput(undefined, 6), to = dateInput();
      var fp = h('select', null, [h('option', { value: '' }, 'All projects')]);
      projectOptions(true).then(function (opts) { ui.render(fp, [h('option', { value: '' }, 'All projects')].concat(opts.map(function (o) { return h('option', { value: o.value }, o.label); }))); });
      var out = h('div.mt');
      ui.modal({
        wide: true, title: 'Vendor manpower report',
        body: [h('div.filters', [from, to, fp, h('button.btn.primary', {
          onclick: function () {
            ui.loading(out);
            api.must('vendorManpowerReport', { from: from.value, to: to.value, projectId: fp.value }).then(function (res) {
              if (!res.success) return ui.render(out, h('div.err-box', null, res.error.message));
              ui.render(out, ui.table({
                columns: (res.data.columns || []).map(function (c) { return { key: c.key, label: c.label }; }),
                rows: res.data.rows || [], emptyMessage: 'No vendor entries in range.'
              }));
            });
          }
        }, 'Generate')]), out]
      });
    }
  };

  /* ------------------------------------------------------------- documents */
  VIEWS.documents = async function (el) {
    var body = h('div');
    async function load() {
      ui.loading(body);
      var res = await api.must('listDocuments', {});
      if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
      var d = res.data;
      ui.render(body, [
        h('div.stats', [
          ui.statCard('Documents', d.count, 'in vault', 'accent'),
          ui.statCard('Expiring soon', d.expiringSoon, 'within alert window', 'warn'),
          ui.statCard('Expired', d.expired, 'action needed', 'bad')
        ]),
        ui.table({
          columns: [
            { label: 'Holder', render: function (r) { return r.userName || r.userId; } },
            { label: 'Type', render: function (r) { return h('span.chip', null, r.docType); } },
            { key: 'fileName', label: 'File' },
            { label: 'Expiry', render: function (r) { return r.expiryDate ? ui.fmtDate(r.expiryDate) : 'no expiry'; } },
            { label: 'Status', render: function (r) { return ui.badge(r.status || 'Valid'); } },
            { label: 'File', render: function (r) { return r.fileId ? h('button.btn.sm.ghost', { onclick: function () { openSelfie(r.fileId); } }, '👁') : '—'; } },
            session.can('manageDocuments') ? {
              label: '', render: function (r) {
                return h('div.row', { style: { gap: '6px' } }, [
                  h('button.btn.sm.ghost', { onclick: function () { editDocument(r); } }, 'Edit'),
                  h('button.btn.sm.bad', {
                  onclick: function () {
                    ui.confirm('Delete this document record?').then(function (ok) {
                      if (ok) run(api.must('deleteDocument', { docId: r.docId }), 'Deleted').then(function (x) { if (x.success) load(); });
                    });
                  }
                }, 'Delete')
                ].filter(Boolean));
              }
            } : null
          ].filter(Boolean),
          rows: d.documents || [],
          emptyMessage: 'No documents uploaded yet.'
        })
      ]);
    }

    function editDocument(doc) {
      enums().then(function (en) {
        ui.promptFields('Update ' + (doc.docType || 'document'), [
          { name: 'docType', label: 'Document type', type: 'select', options: en.docTypes || [], value: doc.docType },
          { name: 'expiryDate', label: 'Expiry date', type: 'date', value: doc.expiryDate || '', hint: 'Leave blank for a document that never expires.' },
          { name: 'expiryAlertDays', label: 'Warn this many days before expiry', type: 'number', value: String(doc.expiryAlertDays || 15) },
          {
            name: 'status', label: 'Status', type: 'select', value: doc.status || 'Valid',
            options: ['Valid', 'ExpiringSoon', 'Expired', 'Rejected'].map(function (s) { return { value: s, label: s }; }),
            hint: 'Rejected is for unreadable copies or the wrong document; the worker is told to upload again.'
          },
          { name: 'notes', label: 'Notes', type: 'textarea', value: doc.notes || '' }
        ], 'Save document').then(function (v) {
          if (!v) return;
          var payload = {
            docId: doc.docId, expiryDate: v.expiryDate || '', status: v.status,
            notes: v.notes, expiryAlertDays: Number(v.expiryAlertDays || 15)
          };
          if (v.docType && v.docType !== doc.docType) payload.docType = v.docType;
          run(api.must('updateDocument', payload), 'Document updated').then(function (x) { if (x.success) load(); });
        });
      });
    }

    function upload(forUserId) {
      enums().then(function (en) {
        var types = en.docTypes || [];
        var ft = h('select', null, types.map(function (tt) { return h('option', null, tt); }));
        var fn = h('input', { placeholder: 'Document number (masked ok)' });
        var fe = h('input', { type: 'date' });
        var ff = h('input', { type: 'file', accept: 'image/*,application/pdf' });
        var fu = h('select');
        userOptions().then(function (opts) {
          ui.render(fu, opts.map(function (o) { return h('option', { value: o.value, selected: o.value === forUserId }, o.label); }));
        });
        ui.modal({
          title: 'Upload document',
          body: [
            h('div.field', [h('label.req', null, 'Employee'), fu]),
            h('div.grid.c2', [
              h('div.field', [h('label.req', null, 'Document type'), ft]),
              h('div.field', [h('label', null, 'Expiry date'), fe])
            ]),
            h('div.field', [h('label', null, 'Number / reference'), fn]),
            h('div.field', [h('label.req', null, 'File (photo or PDF)'), ff])
          ],
          actions: [{
            label: 'Upload', kind: 'primary', onClick: function (close) {
              if (!ff.files || !ff.files[0]) return ui.toast('Choose a file', 'bad');
              api.fileToDataUrl(ff.files[0]).then(function (data) {
                return api.device.shrink ? api.device.shrink(data, 1200, 0.8).then(function (shrunk) {
                  return api.must('uploadDocument', {
                    userId: fu.value, docType: ft.value, docNumber: fn.value,
                    expiryDate: fe.value || '', fileBase64: shrunk
                  });
                }) : api.must('uploadDocument', { userId: fu.value, docType: ft.value, docNumber: fn.value, expiryDate: fe.value || '', fileBase64: data });
              }).then(function (r) {
                if (!r.success) return ui.toast(r.error.message, 'bad');
                ui.toast('Document stored in the private vault', 'good'); close(); load();
              });
            }
          }]
        });
      });
    }

    ui.render(el, [
      sectionHead('Document vault', 'ID proofs and certificates with expiry alerts', [
        h('button.btn.primary.sm', { onclick: function () { upload(); } }, '+ Upload document')
      ]),
      body
    ]);
    load();
  };

  /* --------------------------------------------------------------- reports */
  VIEWS.reports = async function (el) {
    var TYPES = [
      ['monthlyAttendance', 'Monthly attendance sheet'],
      ['dailyAttendance', 'Daily attendance register'],
      ['employeeHistory', 'Employee history'],
      ['flagged', 'Flagged / review log'],
      ['leaveSummary', 'Leave summary'],
      ['expenseSummary', 'Expense summary'],
      ['vendorManpower', 'Vendor manpower'],
      ['projectSummary', 'Project summary'],
      ['payroll', 'Payroll-ready wage sheet']
    ];
    var fType = h('select', null, TYPES.map(function (tt) { return h('option', { value: tt[0] }, tt[1]); }));
    var fMonth = monthInput();
    var fFrom = dateInput(undefined, 29), fTo = dateInput();
    var fProject = h('select'), fUser = h('select');
    projectOptions(true).then(function (opts) { ui.render(fProject, [h('option', { value: '' }, 'All projects')].concat(opts.map(function (o) { return h('option', { value: o.value }, o.label); }))); });
    userOptions().then(function (opts) { ui.render(fUser, [h('option', { value: '' }, 'All employees')].concat(opts.map(function (o) { return h('option', { value: o.value }, o.label); }))); });
    var out = h('div.mt');
    var lastFilters = null;

    fMonth.addEventListener('change', function () {
      if (fMonth.value) {
        fFrom.value = fMonth.value + '-01';
        var d = new Date(fMonth.value + '-01T00:00:00');
        var end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        fTo.value = end.toISOString().slice(0, 10);
      }
    });

    function payload() {
      return {
        type: fType.value, month: fMonth.value, from: fFrom.value, to: fTo.value,
        projectId: fProject.value, userId: fUser.value
      };
    }

    function generate() {
      ui.loading(out);
      lastFilters = payload();
      api.must('generateReport', lastFilters).then(function (res) {
        if (!res.success) return ui.render(out, h('div.err-box', null, res.error.message));
        var r = res.data;
        ui.render(out, [
          h('div.card', [
            h('div.report-head', [
              h('div', [h('h3', null, r.title), h('p.sub', null, r.subtitle || ''), h('p.tiny.muted', null, (r.company && r.company.address ? r.company.address + ' · ' : '') + 'Generated ' + r.generatedAt + ' by ' + r.generatedBy)]),
              session.can('exportReports') ? h('div.row', { style: { gap: '6px' } }, [
                h('button.btn.sm', { onclick: function () { exportAs('xlsx'); } }, '⬇ Excel'),
                h('button.btn.sm', { onclick: function () { exportAs('pdf'); } }, '⬇ PDF'),
                h('button.btn.sm', { onclick: function () { exportAs('csv'); } }, '⬇ CSV'),
                h('button.btn.sm.ghost', { onclick: function () { ui.printNode(ui.el('reportTable'), r.title); } }, '🖨 Print')
              ]) : null
            ]),
            h('div.mt', { id: 'reportTable' }, ui.table({
              compact: true,
              columns: (r.columns || []).map(function (c) {
                return {
                  key: c.key, label: c.label, render: function (row) {
                    var v = row[c.key];
                    if (v === undefined || v === null || v === '') return '—';
                    return String(v);
                  }
                };
              }),
              rows: r.rows || [],
              emptyMessage: 'No rows for these filters.'
            })),
            r.totals && Object.keys(r.totals).length ? h('div.row.mt', { style: { flexWrap: 'wrap', gap: '10px' } }, Object.keys(r.totals).map(function (k) {
              return ui.statCard(k, ui.num(r.totals[k], 2));
            })) : null
          ])
        ]);
      });
    }

    function exportAs(format) {
      ui.toast('Rendering ' + format.toUpperCase() + '… this can take a few seconds', 'info');
      api.must('exportReport', Object.assign(payload(), { format: format })).then(function (res) {
        if (!res.success) return ui.toast(res.error.message, 'bad');
        var d = res.data;
        if (d.dataUrl) ui.downloadDataUrl(d.dataUrl, d.fileName);
        else if (d.downloadUrl) window.open(d.downloadUrl, '_blank');
        else return ui.toast('Export too large to download here — check the company Drive Reports folder', 'warn');
        ui.toast('Export ready: ' + d.fileName + ' (' + Math.round(d.bytes / 1024) + ' KB). Logged in audit trail.', 'good');
      });
    }

    ui.render(el, [
      sectionHead('Reports & exports', 'Every register, summary and the payroll-ready wage sheet'),
      h('div.card', [
        h('div.filters', [
          h('label', null, 'Report'), fType,
          h('label', null, 'Month'), fMonth,
          h('label', null, 'From'), fFrom,
          h('label', null, 'To'), fTo,
          h('label', null, 'Project'), fProject,
          h('label', null, 'Employee'), fUser,
          h('button.btn.primary', { onclick: generate }, 'Generate')
        ]),
        h('div.hint.mt', null, 'Exports carry the mandatory site address block, optional logo and client/PMC lines, and every export is written to the audit log.')
      ]),
      out
    ]);
  };

  /* --------------------------------------------------------------- payroll */
  VIEWS.payroll = async function (el) {
    var fMonth = monthInput();
    var fProject = h('select');
    projectOptions(true).then(function (opts) { ui.render(fProject, [h('option', { value: '' }, 'All projects')].concat(opts.map(function (o) { return h('option', { value: o.value }, o.label); }))); });
    var out = h('div.mt');
    var last = null;

    function gen(confirmPayout) {
      ui.loading(out);
      last = { month: fMonth.value, projectId: fProject.value, confirmPayout: !!confirmPayout };
      api.must('generatePayrollSheet', last).then(function (res) {
        if (!res.success) return ui.render(out, h('div.err-box', null, res.error.message));
        var d = res.data;
        var rows = d.rows || d.sheet && d.sheet.rows || [];
        ui.render(out, [
          h('div.stats', [
            ui.statCard('Employees', (d.totals || {}).employees || rows.length, fMonth.value, 'accent'),
            ui.statCard('Payable days', ui.num((d.totals || {}).payableDays, 1), 'sum', 'ok'),
            ui.statCard('Gross earned', ST.i18n.money((d.totals || {}).grossEarned || 0), '', 'info'),
            ui.statCard('Overtime', ST.i18n.money((d.totals || {}).overtimeAmount || 0), ui.num((d.totals || {}).overtimeHours, 1) + ' h', 'warn'),
            ui.statCard('Deductions', ST.i18n.money((d.totals || {}).deductions || 0), 'LOP + advances', 'bad'),
            ui.statCard('Net payable', ST.i18n.money((d.totals || {}).netPayable || 0), '', 'ok')
          ]),
          h('div.card.mt', [
            h('div.report-head', [
              h('h3', null, 'Wage sheet — ' + fMonth.value),
              session.can('exportReports') ? h('div.row', null, [
                h('button.btn.sm', { onclick: function () { dl('xlsx'); } }, '⬇ Excel'),
                h('button.btn.sm', { onclick: function () { dl('pdf'); } }, '⬇ PDF')
              ]) : null
            ]),
            ui.table({
              compact: true,
              columns: [
                { key: 'name', label: 'Employee' },
                { label: 'Days', align: 'right', render: function (r) { return ui.num(r.payableDays, 1); } },
                { label: 'Rate', align: 'right', render: function (r) { return ST.i18n.money(r.rate || 0); } },
                { label: 'Earned', align: 'right', render: function (r) { return ST.i18n.money(r.earned || 0); } },
                { label: 'OT', align: 'right', render: function (r) { return ui.num(r.overtimeHours, 1) + 'h / ' + ST.i18n.money(r.overtimeAmount || 0); } },
                { label: 'Expenses', align: 'right', render: function (r) { return ST.i18n.money(r.expensesAdded || 0); } },
                { label: 'Deductions', align: 'right', render: function (r) { return ST.i18n.money(r.deductions || 0); } },
                { label: 'Net', align: 'right', render: function (r) { return h('b', null, ST.i18n.money(r.netPayable || 0)); } }
              ],
              rows: rows,
              emptyMessage: 'No payroll rows — check assignments and attendance for the month.'
            }),
            session.can('runPayroll') && !confirmPayout ? h('div.row.mt', null, [
              h('button.btn.primary', {
                onclick: function () {
                  ui.confirm('Confirm payout? Approved expenses in this sheet will be marked "Added to salary" and cannot be paid twice.').then(function (ok) {
                    if (ok) gen(true);
                  });
                }
              }, '✔ Confirm payout & lock expenses')
            ]) : (confirmPayout ? h('div.ok-box.mt', null, 'Payout confirmed — expenses locked into salary.') : null)
          ])
        ]);
      });
    }

    function dl(format) {
      api.must('exportReport', Object.assign({ type: 'payroll', month: fMonth.value, projectId: fProject.value }, { format: format })).then(function (res) {
        if (!res.success) return ui.toast(res.error.message, 'bad');
        if (res.data.dataUrl) ui.downloadDataUrl(res.data.dataUrl, res.data.fileName);
        ui.toast('Payroll export ready', 'good');
      });
    }

    ui.render(el, [
      sectionHead('Payroll', 'Payable days + overtime + expenses − loss of pay'),
      h('div.card', [h('div.filters', [h('label', null, 'Month'), fMonth, h('label', null, 'Project'), fProject, h('button.btn.primary', { onclick: function () { gen(false); } }, 'Compute wage sheet')])]),
      out
    ]);
  };

  /* ----------------------------------------------------------------- audit */
  VIEWS.audit = async function (el) {
    var fAction = h('input', { placeholder: 'Filter action (e.g. EXPORT_REPORT)' });
    var fFrom = dateInput(undefined, 6), fTo = dateInput();
    var body = h('div');
    async function load() {
      ui.loading(body);
      var res = await api.must('listAuditLog', { from: fFrom.value, to: fTo.value, action: fAction.value, limit: 300 });
      if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
      ui.render(body, ui.table({
        compact: true,
        columns: [
          { label: 'When', render: function (r) { return ui.fmtDateTime(r.at || r.timestamp); } },
          { key: 'userId', label: 'User' },
          { key: 'action', label: 'Action' },
          { key: 'entity', label: 'Entity' },
          { label: 'Detail', render: function (r) { return h('span.tiny.muted', null, typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail || {})); } },
          { label: 'Result', render: function (r) { return ui.badge(r.result === 'OK' ? 'Approved' : (r.result === 'DENIED' ? 'Rejected' : 'Pending'), r.result); } }
        ],
        rows: res.data.entries || res.data.logs || [],
        emptyMessage: 'No audit entries in range.'
      }));
    }
    ui.render(el, [
      sectionHead('Audit log', 'Who did what, when — including every export'),
      h('div.card', [h('div.filters', [fFrom, fTo, fAction, h('button.btn', { onclick: load }, 'Apply')])]),
      body
    ]);
    load();
  };

  /* ------------------------------------------------------ notifications */
  VIEWS.notifications = async function (el) {
    var body = h('div');
    async function load() {
      ui.loading(body);
      var res = await api.must('myNotifications', { limit: 100 });
      if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
      ui.render(body, h('div.list', null, (res.data.notifications || []).map(function (n) {
        return h('div.list-row' + (String(n.read) === 'Y' ? '.read' : ''), [
          h('div', [h('b', null, n.title || n.kind), h('div.tiny.muted', null, n.message || ''), h('div.tiny.muted', null, ui.ago(n.createdAt))]),
          String(n.read) === 'Y' ? null : h('button.btn.sm.ghost', {
            onclick: function () {
              api.must('markNotificationRead', { notifId: n.notifId }).then(load);
            }
          }, 'Mark read')
        ]);
      })));
    }
    ui.render(el, [sectionHead('Notifications', 'Expiry alerts, approvals and system messages'), body]);
    load();
  };

  /* -------------------------------------------------------------- settings */
  VIEWS.settings = async function (el) {
    var res = await api.must('getSettings', {});
    if (!res.success) return ui.render(el, h('div.err-box', null, res.error.message));
    var s = res.data.settings || {};
    cache.settings = s;
    var geoKeys = res.data.geoKeys || [];
    var company = res.data.company || {};
    var canGeo = session.can('manageGeofence');
    var canSet = session.can('manageSettings');

    var tabs = h('div.tabs');
    var pane = h('div.mt');
    var TABDEF = [
      ['company', 'Company'], ['rules', 'Attendance rules'], ['geo', 'Geofence & GPS'],
      ['notify', 'Notifications'], ['report', 'Reports branding'], ['calendar', 'Calendar & shifts'], ['data', 'Data & retention']
    ];
    if (!canSet) TABDEF = TABDEF.filter(function (tb) { return ['calendar'].indexOf(tb[0]) < 0; });
    TABDEF.forEach(function (tb, i) {
      var b = h('button.tab' + (i === 0 ? '.active' : ''), null, tb[1]);
      b.addEventListener('click', function () {
        ui.qsa('.tab', tabs).forEach(function (x) { x.classList.toggle('active', x === b); });
        show(tb[0]);
      });
      tabs.appendChild(b);
    });

    function saveBtn(getPatch, msg) {
      return h('button.btn.primary.mt', {
        onclick: function () {
          run(api.must('saveSettings', { settings: getPatch() }), msg || 'Settings saved').then(function (r) {
            if (r.success) { invalidate('settings'); cache.settings = null; }
          });
        }
      }, 'Save changes');
    }

    function show(which) {
      if (which === 'company') {
        var f = {
          companyName: h('input', { value: s.companyName || '', disabled: !canSet }),
          companyAddress: h('textarea', { rows: 2, disabled: !canSet }, s.companyAddress || ''),
          gst: h('input', { value: s.gst || '', disabled: !canSet }),
          industryType: h('input', { value: s.industryType || '', disabled: !canSet }),
          currency: h('input', { value: s.currency || 'INR', disabled: !canSet }),
          timezone: h('input', { value: s.timezone || 'Asia/Kolkata', disabled: !canSet })
        };
        ui.render(pane, h('div.card', [
          h('h3', null, 'Company profile'),
          ui.kvList([
            ['Company ID', company.companyId], ['Status', ui.badge(company.status)],
            ['Spreadsheet', company.sheetUrl ? h('a', { href: company.sheetUrl, target: '_blank' }, 'Open company sheet') : ''],
            ['Drive folder', company.driveFolderId], ['Plan', company.planTier], ['Created', ui.fmtDateTime(company.createdAt)]
          ]),
          h('div.grid.c2.mt', [
            h('div.field', [h('label', null, 'Company name'), f.companyName]),
            h('div.field', [h('label', null, 'GST'), f.gst]),
          ]),
          h('div.field', [h('label', null, 'Registered address (printed on reports)'), f.companyAddress]),
          h('div.grid.c2', [
            h('div.field', [h('label', null, 'Industry'), f.industryType]),
            h('div.grid.c2', [h('div.field', [h('label', null, 'Currency'), f.currency]), h('div.field', [h('label', null, 'Timezone'), f.timezone])])
          ]),
          canSet ? saveBtn(function () {
            return {
              companyName: f.companyName.value, companyAddress: f.companyAddress.value, gst: f.gst.value,
              industryType: f.industryType.value, currency: f.currency.value, timezone: f.timezone.value
            };
          }) : null
        ]));
      }

      if (which === 'rules') {
        var f2 = {
          attendanceWindowStart: h('input', { type: 'time', value: s.attendanceWindowStart, disabled: !canGeo }),
          attendanceWindowEnd: h('input', { type: 'time', value: s.attendanceWindowEnd, disabled: !canGeo }),
          lateGraceMinutes: h('input', { type: 'number', value: s.lateGraceMinutes, disabled: !canGeo }),
          outWindowStart: h('input', { type: 'time', value: s.outWindowStart, disabled: !canGeo }),
          outWindowEnd: h('input', { type: 'time', value: s.outWindowEnd, disabled: !canGeo }),
          standardHours: h('input', { type: 'number', value: s.standardHours, disabled: !canGeo }),
          halfDayHours: h('input', { type: 'number', value: s.halfDayHours, disabled: !canGeo }),
          overtimeAfterHours: h('input', { type: 'number', value: s.overtimeAfterHours, disabled: !canGeo }),
          overtimeRate: h('input', { type: 'number', step: 0.1, value: s.overtimeRate, disabled: !canGeo }),
          workingDays: h('input', { value: s.workingDays, disabled: !canGeo }),
          weeklyOff: h('input', { value: s.weeklyOff, disabled: !canGeo }),
          paidHolidays: h('select', { disabled: !canGeo }, [h('option', { value: 'Y', selected: s.paidHolidays !== 'N' }, 'Paid'), h('option', { value: 'N', selected: s.paidHolidays === 'N' }, 'Unpaid')]),
          payrollDaysBasis: h('input', { type: 'number', min: 1, max: 31, value: s.payrollDaysBasis || 26, disabled: !canGeo })
        };
        ui.render(pane, h('div.card', [
          h('h3', null, 'Attendance, hours & overtime'),
          h('div.grid.c2', [
            h('div.field', [h('label', null, 'Mark-in window start'), f2.attendanceWindowStart]),
            h('div.field', [h('label', null, 'Mark-in cutoff'), f2.attendanceWindowEnd])
          ]),
          h('div.grid.c2', [
            h('div.field', [h('label', null, 'Late grace (minutes)'), f2.lateGraceMinutes]),
            h('div.field', [h('label', null, 'Payroll days per month (÷ for salary)'), f2.payrollDaysBasis])
          ]),
          h('div.grid.c2', [
            h('div.field', [h('label', null, 'Mark-out window'), h('div.row', null, [f2.outWindowStart, f2.outWindowEnd])]),
            h('div.field', [h('label', null, 'Working days (0=Sun…6=Sat)'), f2.workingDays])
          ]),
          h('div.grid.c2', [
            h('div.field', [h('label', null, 'Standard hours/day'), f2.standardHours]),
            h('div.field', [h('label', null, 'Half-day threshold (hours)'), f2.halfDayHours])
          ]),
          h('div.grid.c2', [
            h('div.field', [h('label', null, 'Overtime after (hours)'), f2.overtimeAfterHours]),
            h('div.field', [h('label', null, 'Overtime multiplier'), f2.overtimeRate])
          ]),
          h('div.grid.c2', [
            h('div.field', [h('label', null, 'Company weekly off (day index)'), f2.weeklyOff]),
            h('div.field', [h('label', null, 'Holidays paid?'), f2.paidHolidays])
          ]),
          canGeo ? saveBtn(function () {
            return {
              attendanceWindowStart: f2.attendanceWindowStart.value, attendanceWindowEnd: f2.attendanceWindowEnd.value,
              lateGraceMinutes: f2.lateGraceMinutes.value, outWindowStart: f2.outWindowStart.value, outWindowEnd: f2.outWindowEnd.value,
              standardHours: f2.standardHours.value, halfDayHours: f2.halfDayHours.value,
              overtimeAfterHours: f2.overtimeAfterHours.value, overtimeRate: f2.overtimeRate.value,
              workingDays: f2.workingDays.value, weeklyOff: f2.weeklyOff.value,
              paidHolidays: f2.paidHolidays.value, payrollDaysBasis: f2.payrollDaysBasis.value
            };
          }) : h('p.hint.mt', null, 'You need the manageGeofence permission to edit these rules.')
        ]));
      }

      if (which === 'geo') {
        var f3 = {
          defaultGeofenceRadius: h('input', { type: 'number', value: s.defaultGeofenceRadius, disabled: !canGeo }),
          maxGpsAccuracy: h('input', { type: 'number', value: s.maxGpsAccuracy || 500, disabled: !canGeo }),
          requireSelfie: h('input', { type: 'checkbox', checked: s.requireSelfie !== 'N', disabled: !canGeo }),
          requireDeviceBinding: h('input', { type: 'checkbox', checked: s.requireDeviceBinding !== 'N', disabled: !canGeo }),
          allowQrFallback: h('input', { type: 'checkbox', checked: s.allowQrFallback !== 'N', disabled: !canGeo }),
          qrFallbackRadius: h('input', { type: 'number', value: s.qrFallbackRadius || 1000, disabled: !canGeo }),
          offlineMaxAgeHours: h('input', { type: 'number', value: s.offlineMaxAgeHours || 26, disabled: !canGeo }),
          autoRainDayFlag: h('input', { type: 'checkbox', checked: s.autoRainDayFlag === 'Y', disabled: !canGeo }),
          rainThresholdMm: h('input', { type: 'number', value: s.rainThresholdMm || 20, disabled: !canGeo }),
          heatThresholdC: h('input', { type: 'number', value: s.heatThresholdC || 43, disabled: !canGeo })
        };
        ui.render(pane, h('div.card', [
          h('h3', null, 'Geofence, GPS & offline policy'),
          h('div.grid.c2', [
            h('div.field', [h('label', null, 'Default geofence radius (m)'), f3.defaultGeofenceRadius]),
            h('div.field', [h('label', null, 'Max GPS accuracy (m)'), f3.maxGpsAccuracy])
          ]),
          h('div.grid.c2', [
            h('label.perm', null, [f3.requireSelfie, h('span', null, 'Require live selfie')]),
            h('label.perm', null, [f3.requireDeviceBinding, h('span', null, 'Require device binding')])
          ]),
          h('div.grid.c2', [
            h('label.perm', null, [f3.allowQrFallback, h('span', null, 'Allow QR fallback check-in')]),
            h('div.field', [h('label', null, 'QR fallback radius (m)'), f3.qrFallbackRadius])
          ]),
          h('div.grid.c2', [
            h('div.field', [h('label', null, 'Offline entry max age (hours)'), f3.offlineMaxAgeHours]),
            h('div.field', [h('label', null, 'Rain flag threshold (mm/day)'), f3.rainThresholdMm])
          ]),
          h('div.grid.c2', [
            h('label.perm', null, [f3.autoRainDayFlag, h('span', null, 'Auto weather (rain) day flag')]),
            h('div.field', [h('label', null, 'Extreme heat threshold (°C)'), f3.heatThresholdC])
          ]),
          canGeo ? saveBtn(function () {
            return {
              defaultGeofenceRadius: f3.defaultGeofenceRadius.value, maxGpsAccuracy: f3.maxGpsAccuracy.value,
              requireSelfie: f3.requireSelfie.checked ? 'Y' : 'N', requireDeviceBinding: f3.requireDeviceBinding.checked ? 'Y' : 'N',
              allowQrFallback: f3.allowQrFallback.checked ? 'Y' : 'N', qrFallbackRadius: f3.qrFallbackRadius.value,
              offlineMaxAgeHours: f3.offlineMaxAgeHours.value, autoRainDayFlag: f3.autoRainDayFlag.checked ? 'Y' : 'N',
              rainThresholdMm: f3.rainThresholdMm.value, heatThresholdC: f3.heatThresholdC.value
            };
          }) : null
        ]));
      }

      if (which === 'notify') {
        var f4 = {
          notifyChannel: h('select', { disabled: !canSet }, ['Email', 'SMS', 'WhatsApp', 'Email+WhatsApp'].map(function (c) { return h('option', { value: c, selected: s.notifyChannel === c }, c); })),
          notifyOnFlagged: h('input', { type: 'checkbox', checked: s.notifyOnFlagged !== 'N', disabled: !canSet }),
          reportRecipients: h('input', { value: s.reportRecipients || '', disabled: !canSet, placeholder: 'comma-separated emails for monthly report' }),
          autoMonthlyReport: h('input', { type: 'checkbox', checked: s.autoMonthlyReport === 'Y', disabled: !canSet })
        };
        ui.render(pane, h('div.card', [
          h('h3', null, 'Notifications'),
          h('div.grid.c2', [
            h('div.field', [h('label', null, 'Outbound channel'), f4.notifyChannel]),
            h('label.perm', null, [f4.notifyOnFlagged, h('span', null, 'Alert admins on flagged marks')])
          ]),
          h('div.field', [h('label', null, 'Monthly auto-report recipients'), f4.reportRecipients]),
          h('label.perm', null, [f4.autoMonthlyReport, h('span', null, 'Auto e-mail monthly report on the 1st')]),
          h('p.hint.mt', null, 'WhatsApp uses the Cloud API free tier when a token is configured in script properties; otherwise messages fall back to e-mail silently.'),
          canSet ? saveBtn(function () {
            return {
              notifyChannel: f4.notifyChannel.value, notifyOnFlagged: f4.notifyOnFlagged.checked ? 'Y' : 'N',
              reportRecipients: f4.reportRecipients.value, autoMonthlyReport: f4.autoMonthlyReport.checked ? 'Y' : 'N'
            };
          }) : null
        ]));
      }

      if (which === 'report') {
        var f5 = {
          reportFooterText: h('textarea', { rows: 2, disabled: !canSet }, s.reportFooterText || ''),
          reportIncludeLogo: h('input', { type: 'checkbox', checked: s.reportIncludeLogo !== 'N', disabled: !canSet }),
          reportIncludeClientPmc: h('input', { type: 'checkbox', checked: s.reportIncludeClientPmc !== 'N', disabled: !canSet })
        };
        ui.render(pane, h('div.card', [
          h('h3', null, 'Report branding'),
          h('div.field', [h('label', null, 'Footer text on every export'), f5.reportFooterText]),
          h('label.perm', null, [f5.reportIncludeLogo, h('span', null, 'Include company logo')]),
          h('label.perm', null, [f5.reportIncludeClientPmc, h('span', null, 'Include client / PMC block')]),
          h('p.hint.mt', null, 'The site address block is mandatory and always printed (§7).'),
          canSet ? saveBtn(function () {
            return {
              reportFooterText: f5.reportFooterText.value,
              reportIncludeLogo: f5.reportIncludeLogo.checked ? 'Y' : 'N',
              reportIncludeClientPmc: f5.reportIncludeClientPmc.checked ? 'Y' : 'N'
            };
          }) : null
        ]));
      }

      if (which === 'calendar') {
        renderCalendar(pane);
      }

      if (which === 'data') {
        var f6 = {
          gpsRetentionMonths: h('input', { type: 'number', value: s.gpsRetentionMonths || 12, disabled: !canSet }),
          expenseProofRequired: h('input', { type: 'checkbox', checked: s.expenseProofRequired !== 'N', disabled: !canSet })
        };
        ui.render(pane, h('div.card', [
          h('h3', null, 'Data retention & proofs'),
          h('div.field', [h('label', null, 'Raw GPS retention (months; then blurred to site-level)'), f6.gpsRetentionMonths]),
          h('label.perm', null, [f6.expenseProofRequired, h('span', null, 'Require proof attachment on expenses')]),
          h('p.hint.mt', null, 'A weekly trigger purges raw coordinates older than the retention window; attendance rows themselves are never deleted.'),
          canSet ? saveBtn(function () {
            return { gpsRetentionMonths: f6.gpsRetentionMonths.value, expenseProofRequired: f6.expenseProofRequired.checked ? 'Y' : 'N' };
          }) : null,
          session.role === 'SuperAdmin' ? h('div.row.mt', null, [
            h('button.btn', { onclick: function () { openSetupWizard(); } }, '🧙 Re-run setup wizard')
          ]) : null
        ]));
      }
    }

    ui.render(el, [sectionHead('Settings', 'Company rules that drive the attendance engine'), tabs, pane]);
    show('company');

    function renderCalendar(pane) {
      var holBox = h('div'), shiftBox = h('div');
      ui.render(pane, h('div.grid.c2', [
        h('div.card', [h('h3', null, 'Holidays'), holBox]),
        h('div.card', [h('h3', null, 'Shifts'), shiftBox])
      ]));
      loadHolidays(); loadShifts();

      function loadHolidays() {
        api.must('listHolidays', {}).then(function (res) {
          ui.render(holBox, [
            ui.table({
              compact: true,
              columns: [
                { label: 'Date', render: function (r) { return ui.fmtDate(r.date); } },
                { key: 'name', label: 'Holiday' },
                { label: 'Applies', render: function (r) { return r.applicableProjects === 'All' ? 'Company-wide' : r.applicableProjects; } },
                { label: 'Paid', render: function (r) { return ui.badge(r.paid === 'N' ? 'N' : 'Y'); } },
                session.can('manageHolidays') ? {
                  label: '', render: function (r) {
                    return h('button.btn.sm.bad', {
                      onclick: function () { run(api.must('deleteHoliday', { holidayId: r.holidayId }), 'Holiday removed').then(function (x) { if (x.success) loadHolidays(); }); }
                    }, '✕');
                  }
                } : null
              ].filter(Boolean),
              rows: res.data.holidays || [], emptyMessage: 'No holidays defined.'
            }),
            session.can('manageHolidays') ? h('button.btn.sm.mt', { onclick: addHoliday }, '+ Add holiday') : null
          ]);
        });
      }
      function addHoliday() {
        var fd = dateInput(), fn = h('input', { placeholder: 'e.g. Diwali' });
        var fp = h('input', { value: 'All', placeholder: 'All or comma-separated project IDs' });
        var fpaid = h('input', { type: 'checkbox', checked: true });
        ui.modal({
          title: 'Add holiday',
          body: [
            h('div.field', [h('label.req', null, 'Date'), fd]),
            h('div.field', [h('label.req', null, 'Name'), fn]),
            h('div.field', [h('label', null, 'Applicable projects'), fp]),
            h('label.perm', null, [fpaid, h('span', null, 'Paid holiday')])
          ],
          actions: [{
            label: 'Save', kind: 'primary', onClick: function (close) {
              run(api.must('saveHoliday', { date: fd.value, name: fn.value, applicableProjects: fp.value || 'All', paid: fpaid.checked ? 'Y' : 'N' }), 'Holiday saved')
                .then(function (r) { if (r.success) { close(); loadHolidays(); } });
            }
          }]
        });
      }
      function loadShifts() {
        api.must('listShifts', {}).then(function (res) {
          ui.render(shiftBox, [
            ui.table({
              compact: true,
              columns: [
                { key: 'name', label: 'Shift' },
                { label: 'Hours', render: function (r) { return r.startTime + '–' + r.endTime; } },
                { label: 'OT after', align: 'right', render: function (r) { return r.overtimeAfter + 'h'; } },
                { label: 'Applies', render: function (r) { return r.applicableProjects === 'All' ? 'All' : r.applicableProjects; } },
                session.can('manageShifts') ? {
                  label: '', render: function (r) {
                    return h('button.btn.sm.bad', {
                      onclick: function () { run(api.must('deleteShift', { shiftId: r.shiftId }), 'Shift removed').then(function (x) { if (x.success) loadShifts(); }); }
                    }, '✕');
                  }
                } : null
              ].filter(Boolean),
              rows: res.data.shifts || [], emptyMessage: 'No shifts — company window applies.'
            }),
            session.can('manageShifts') ? h('button.btn.sm.mt', { onclick: addShift }, '+ Add shift') : null
          ]);
        });
      }
      function addShift() {
        var fn = h('input', { placeholder: 'Night shift' });
        var fs = h('input', { type: 'time', value: '20:00' }), fe = h('input', { type: 'time', value: '04:00' });
        var fo = h('input', { type: 'number', value: 9 });
        ui.modal({
          title: 'Add shift',
          body: [
            h('div.field', [h('label.req', null, 'Name'), fn]),
            h('div.grid.c2', [h('div.field', [h('label.req', null, 'Start'), fs]), h('div.field', [h('label.req', null, 'End'), fe])]),
            h('div.field', [h('label', null, 'Overtime after (hours)'), fo])
          ],
          actions: [{
            label: 'Save', kind: 'primary', onClick: function (close) {
              run(api.must('saveShift', { name: fn.value, startTime: fs.value, endTime: fe.value, overtimeAfter: fo.value }), 'Shift saved')
                .then(function (r) { if (r.success) { close(); loadShifts(); invalidate('shifts'); } });
            }
          }]
        });
      }
    }
  };

  /* --------------------------------------------------------------- profile */
  VIEWS.profile = async function (el) {
    var me = await refreshMe();
    var u = me.user || {};
    ui.render(el, [
      sectionHead('My profile', 'Your account, devices and password'),
      h('div.grid.c2', [
        h('div.card', [
          h('div.row', { style: { gap: '12px', alignItems: 'center' } }, [
            h('span.avatar.xl', null, ui.initials(u.name || u.Name)),
            h('div', [h('h3', { style: { margin: 0 } }, u.name || u.Name), h('p.sub', null, (u.role || u.Role) + ' · ' + (u.designation || u.Designation || ''))])
          ]),
          ui.kvList([
            ['User ID', u.userId || u.UserID], ['Mobile', u.mobile || u.MobileNumber], ['Email', u.email || u.Email],
            ['Joined', ui.fmtDate(u.joinedAt || u.JoinedAt)], ['Device status', ui.badge(u.deviceStatus || u.DeviceStatus || 'Unbound')],
            ['Salary', (u.salaryType || u.SalaryType) + ' · ' + ST.i18n.money(u.dailyWage || u.DailyWage || 0) + '/day'],
            ['Address', u.address || u.Address || ''], ['Emergency contact', u.emergencyContact || u.EmergencyContact || ''],
            ['Weekly off', (['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
              Number(u.weeklyOff !== undefined ? u.weeklyOff : u.WeeklyOff)
            ]) || '—']
          ]),
          h('div.row.mt', { style: { gap: '8px' } }, [
            h('button.btn.sm.primary', { onclick: function () { editMyProfile(u, function () { VIEWS.profile(el); }); } }, 'Edit my details'),
            h('button.btn.sm', { onclick: function () { requestMyDevice(el); } }, '📱 Register this browser/phone')
          ]),
          h('h4.mt', null, 'Change password'),
          (function () {
            var cp = h('input', { type: 'password' }), np = h('input', { type: 'password' });
            return h('div', [
              h('div.field', [h('label', null, 'Current password'), cp]),
              h('div.field', [h('label', null, 'New password'), np]),
              h('button.btn.primary', {
                onclick: function () {
                  run(api.must('changePassword', { currentPassword: cp.value, newPassword: np.value }), 'Password changed')
                    .then(function (r) { if (r.success) { cp.value = ''; np.value = ''; } });
                }
              }, 'Update password')
            ]);
          })()
        ]),
        h('div.card', [
          h('h3', null, 'Registered devices'),
          ui.table({
            compact: true,
            columns: [
              { label: 'Device', render: function (r) { return r.label || r.deviceId; } },
              { label: 'Fingerprint', render: function (r) { return r.fingerprint; } },
              { label: 'Status', render: function (r) { return ui.badge(r.status); } },
              { label: 'Logins', align: 'right', render: function (r) { return r.loginCount; } }
            ],
            rows: me.devices || [],
            emptyMessage: 'No devices bound yet — your next sign-in binds this one.'
          }),
          h('p.hint.mt', null, 'Moving to a new phone? Sign in there once — an approval request reaches your admin automatically. '
            + 'On a shared desktop, use “Register this browser/phone” above instead.'),
          h('h3.mt', null, 'My assignments'),
          ui.table({
            compact: true,
            columns: [{ key: 'projectName', label: 'Project' }, { key: 'roleOnSite', label: 'Role' }, { label: 'Window', render: function (r) { return r.windowStart + '–' + r.windowEnd; } }],
            rows: me.assignments || [],
            emptyMessage: 'Not assigned to a project yet.'
          })
        ])
      ])
    ]);
  };

  /** Staff can fix their own contact and bank details without an HR round-trip. */
  function editMyProfile(u, done) {
    ui.promptFields('Edit my details', [
      { name: 'name', label: 'Full name', required: true, value: u.name || u.Name || '' },
      { name: 'designation', label: 'Designation', value: u.designation || u.Designation || '' },
      { name: 'address', label: 'Address', type: 'textarea', value: u.address || u.Address || '' },
      {
        name: 'emergencyContact', label: 'Emergency contact', value: u.emergencyContact || u.EmergencyContact || '',
        hint: 'Digits with + ( ) - and spaces, 6–20 characters'
      },
      {
        name: 'weeklyOff', label: 'Weekly off', type: 'select',
        value: String(u.weeklyOff !== undefined ? u.weeklyOff : (u.WeeklyOff !== undefined ? u.WeeklyOff : '0')),
        options: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(function (d, i) {
          return { value: String(i), label: d };
        })
      },
      { name: 'bankAccount', label: 'Bank account', value: u.bankAccount || u.BankAccount || '', hint: 'Private field — only you and Super Admins read it back' },
      { name: 'ifscCode', label: 'IFSC', value: u.ifscCode || u.IfscCode || '' }
    ], 'Save my details').then(function (v) {
      if (!v) return;
      function current(key) {
        var camel = u[key];
        var pascal = u[key.charAt(0).toUpperCase() + key.slice(1)];
        return String(camel !== undefined ? camel : (pascal !== undefined ? pascal : '')).trim();
      }
      var payload = {};
      ['name', 'designation', 'address', 'emergencyContact', 'bankAccount', 'ifscCode', 'weeklyOff'].forEach(function (k) {
        var next = String(v[k] == null ? '' : v[k]).trim();
        if (next && next !== current(k)) payload[k] = next;
      });
      if (!Object.keys(payload).length) return ui.toast('Nothing to save — no field changed', 'warn');
      run(api.must('updateMyProfile', payload), 'My profile updated').then(function (r) {
        if (!r.success) return;
        invalidate('users');   // the profile re-render refetches `me`, so no local patching
        if (done) done();
      });
    });
  }

  /**
   * Binds the browser you are reading this in. Signing in from a new phone files
   * a request automatically; this is the deliberate path for desk machines and
   * for admins who want the request in front of them.
   */
  function requestMyDevice(el) {
    var fp = api.device.fingerprint ? api.device.fingerprint() : '';
    if (!fp || fp.length < 8) return ui.toast('This browser cannot produce a device fingerprint', 'bad');
    ui.promptFields('Register this device', [
      {
        name: 'label', label: 'Device name', required: true,
        value: api.device.label ? String(api.device.label()).slice(0, 60) : 'Desk browser',
        hint: 'Shown to whoever approves the request'
      }
    ], 'Send request').then(function (v) {
      if (!v) return;
      run(api.must('requestDeviceChange', { deviceFingerprint: fp, deviceLabel: String(v.label).slice(0, 60) }),
        'Request filed — it appears in Devices for approval').then(function (r) {
          if (r.success) VIEWS.profile(el);
        });
    });
  }

  /* ========================================================= setup wizard */
  function openSetupWizard() {
    var s = cache.settings || {};
    var step = 1;
    var f = {
      companyName: h('input', { value: s.companyName || (session.company || {}).companyName || '' }),
      companyAddress: h('textarea', { rows: 2 }, s.companyAddress || ''),
      gst: h('input', { value: s.gst || '' }),
      industryType: h('input', { value: s.industryType || '' }),
      radius: h('input', { type: 'number', value: s.defaultGeofenceRadius || 200 }),
      requireSelfie: h('input', { type: 'checkbox', checked: s.requireSelfie !== 'N' }),
      requireDeviceBinding: h('input', { type: 'checkbox', checked: s.requireDeviceBinding !== 'N' }),
      ws: h('input', { type: 'time', value: s.attendanceWindowStart || '06:00' }),
      we: h('input', { type: 'time', value: s.attendanceWindowEnd || '11:00' }),
      grace: h('input', { type: 'number', value: s.lateGraceMinutes || 15 }),
      ows: h('input', { type: 'time', value: s.outWindowStart || '16:00' }),
      owe: h('input', { type: 'time', value: s.outWindowEnd || '23:59' }),
      wd: h('input', { value: s.workingDays || '1,2,3,4,5,6' }),
      wo: h('select', null, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(function (d, i) { return h('option', { value: String(i), selected: String(i) === String(s.weeklyOff || '0') }, d); }))
    };
    var stepsEl = h('div.wiz-steps');
    var body = h('div.mt');
    var m = ui.modal({
      wide: true, dismissable: false,
      title: 'Company setup wizard',
      body: [stepsEl, body],
      actions: [
        {
          label: 'Back', onClick: function () { if (step > 1) { step--; paint(); } }
        },
        {
          label: 'Next', kind: 'primary', onClick: function () {
            if (step < 4) { step++; paint(); }
            else finish();
          }
        }
      ]
    });

    function paint() {
      ui.render(stepsEl, ['Profile', 'Geofence', 'Attendance window', 'Calendar'].map(function (label, i) {
        return h('div.wiz-step' + (i + 1 === step ? '.active' : (i + 1 < step ? '.done' : '')), [
          h('span.n', null, i + 1 < step ? '✓' : String(i + 1)), h('span', null, label)
        ]);
      }));
      if (step === 1) ui.render(body, [
        h('div.field', [h('label.req', null, 'Company name'), f.companyName]),
        h('div.field', [h('label.req', null, 'Registered address (mandatory on reports)'), f.companyAddress]),
        h('div.grid.c2', [h('div.field', [h('label', null, 'GST'), f.gst]), h('div.field', [h('label', null, 'Industry'), f.industryType])])
      ]);
      if (step === 2) ui.render(body, [
        h('div.field', [h('label.req', null, 'Default geofence radius (metres)'), f.radius, h('div.hint', null, '200 m is the recommended default; each project can override it.')]),
        h('label.perm', null, [f.requireSelfie, h('span', null, 'Require a live selfie with every check-in')]),
        h('label.perm', null, [f.requireDeviceBinding, h('span', null, 'Bind one device per employee (anti buddy-punching)')])
      ]);
      if (step === 3) ui.render(body, [
        h('div.grid.c2', [h('div.field', [h('label.req', null, 'Mark-in opens'), f.ws]), h('div.field', [h('label.req', null, 'Cutoff (late after)'), f.we])]),
        h('div.field', [h('label', null, 'Late grace (minutes)'), f.grace]),
        h('div.grid.c2', [h('div.field', [h('label', null, 'Mark-out opens'), f.ows]), h('div.field', [h('label', null, 'Mark-out closes'), f.owe])])
      ]);
      if (step === 4) ui.render(body, [
        h('div.field', [h('label.req', null, 'Working days (0=Sun … 6=Sat, comma separated)'), f.wd]),
        h('div.field', [h('label', null, 'Weekly off'), f.wo]),
        h('p.hint', null, 'Holidays and shifts can be added later under Settings → Calendar.')
      ]);
    }

    function finish() {
      run(api.must('completeSetupWizard', {
        companyName: f.companyName.value, companyAddress: f.companyAddress.value, gst: f.gst.value,
        industryType: f.industryType.value, defaultGeofenceRadius: Number(f.radius.value),
        requireSelfie: f.requireSelfie.checked, requireDeviceBinding: f.requireDeviceBinding.checked,
        attendanceWindowStart: f.ws.value, attendanceWindowEnd: f.we.value, lateGraceMinutes: Number(f.grace.value),
        outWindowStart: f.ows.value, outWindowEnd: f.owe.value, workingDays: f.wd.value, weeklyOff: f.wo.value
      }), 'Setup complete — SiteTrack is live for your company 🎉').then(function (r) {
        if (r.success) {
          m.close();
          ui.el('setupBar').hidden = true;
          cache.settings = null;
          refreshMe().then(route);
        }
      });
    }
    paint();
  }

  /* ============================================================== helpers */
  function setBadge(section, n) {
    navBadge[section] = n;
    var elBad = ui.qs('[data-badge="' + section + '"]');
    if (elBad) { elBad.hidden = !n; elBad.textContent = n > 99 ? '99+' : n; }
  }
  function debounce(fn, ms) {
    var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  window.ST.admin = { boot: boot, openSetupWizard: function () { openSetupWizard(); } };
})();
