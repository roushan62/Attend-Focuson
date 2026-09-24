/* ============================================================================
   frontend/assets/js/owner.js — hidden Platform Owner panel (§3 / §12)
   ---------------------------------------------------------------------------
   The owner key is a script property, never a user account. This panel lets the
   platform operator approve tenants, suspend companies, inspect the platform
   audit log, install the scheduled triggers and manage script properties.
   ========================================================================== */
(function () {
  'use strict';
  var ui = ST.ui, api = ST.api, h = ui.h;

  function boot() {
    if (api.ownerToken()) {
      return api.call('ownerStats', {}, { owner: true }).then(function (res) {
        if (res.success) return enter(res.data);
        api.setOwnerToken('');
        login();
      });
    }
    login();
  }

  function login() {
    ui.el('loginBox').hidden = false;
    ui.el('panel').hidden = true;
    ui.el('ownerKey').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    ui.el('ownerLoginBtn').addEventListener('click', submit);
    function submit() {
      var key = ui.el('ownerKey').value.trim();
      if (!key) return ui.toast('Enter the platform owner key', 'bad');
      api.must('ownerLogin', { ownerKey: key }).then(function (res) {
        if (!res.success) return ui.toast(res.error.message, 'bad');
        api.setOwnerToken(res.data.token);
        ui.el('loginBox').hidden = true;
        api.must('ownerStats', {}, { owner: true }).then(function (st) { enter(st.success ? st.data : {}); });
      });
    }
  }

  function call(action, payload) { return api.must(action, payload || {}, { owner: true }); }

  function enter(stats) {
    ui.el('loginBox').hidden = true;
    ui.el('panel').hidden = false;
    var tabs = ui.el('ownerTabs');
    var pane = ui.el('ownerPane');
    var TABS = [
      ['overview', '🛰️ Overview'], ['requests', '📥 Signup requests'], ['companies', '🏢 Companies'],
      ['triggers', '⏰ Triggers'], ['props', '🔧 Properties'], ['audit', '🧾 Platform audit']
    ];
    ui.render(tabs, TABS.map(function (tb, i) {
      return h('button.tab' + (i === 0 ? '.active' : ''), { onclick: function (e) {
        ui.qsa('.tab', tabs).forEach(function (x) { x.classList.toggle('active', x === e.target); });
        VIEWS[tb[0]](pane);
      } }, tb[1]);
    }));
    ui.el('ownerLogout').addEventListener('click', function () {
      api.setOwnerToken(''); location.reload();
    });
    VIEWS.overview(pane, stats);
  }

  var VIEWS = {};

  VIEWS.overview = function (el, stats) {
    call('ownerStats').then(function (res) {
      if (!res.success) return ui.render(el, h('div.err-box', null, res.error.message));
      var d = res.data;
      var cfg = d.configured || {};
      ui.render(el, [
        h('div.stats', [
          ui.statCard('Pending signups', (d.requests || {}).Pending || 0, 'awaiting review', 'warn'),
          ui.statCard('Approved', (d.requests || {}).Approved || 0, 'lifetime', 'ok'),
          ui.statCard('Companies', d.totalCompanies || 0, (d.companies || {}).Active + ' active', 'accent'),
          ui.statCard('Suspended', (d.companies || {}).Suspended || 0, 'tenants', 'bad')
        ]),
        h('div.grid.c2.mt', [
          h('div.card', [
            h('h3', null, 'Deployment health'),
            ui.kvList([
              ['Master sheet', cfg.masterSheet ? '✔ configured' : '✘ missing'],
              ['Drive root', cfg.driveRoot ? '✔ configured' : '✘ missing'],
              ['Token secret', cfg.tokenSecret ? '✔ configured' : '✘ missing'],
              ['Owner e-mail', cfg.ownerEmail ? '✔ configured' : '✘ missing'],
              ['Dev mode', cfg.devMode ? 'ON (OTP echoed, unverified signup allowed)' : 'off'],
              ['Server time', d.serverTime]
            ]),
            h('p.tiny.muted.mt', null, 'Bootstrap creates the master sheet and generates OWNER_KEY / TOKEN_SECRET — see README §4.'),
          ]),
          h('div.card', [
            h('h3', null, 'Largest tenants'),
            ui.table({
              compact: true,
              columns: [
                { key: 'companyName', label: 'Company' },
                { label: 'Users', align: 'right', render: function (r) { return (r.counts || {}).users || 0; } },
                { label: 'Projects', align: 'right', render: function (r) { return (r.counts || {}).projects || 0; } },
                { label: 'Marks', align: 'right', render: function (r) { return (r.counts || {}).attendance || 0; } },
                { label: 'Status', render: function (r) { return ui.badge(r.status); } }
              ],
              rows: d.platformUsage || [],
              emptyMessage: 'No companies yet.'
            })
          ])
        ])
      ]);
    });
  };

  VIEWS.requests = function (el) {
    var statusSel = h('select', null, ['Pending', 'Approved', 'Rejected', 'All'].map(function (s) { return h('option', null, s); }));
    var body = h('div.mt');
    function load() {
      ui.loading(body);
      call('listSignupRequests', { status: statusSel.value }).then(function (res) {
        if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
        ui.render(body, ui.table({
          columns: [
            { label: 'Company', render: function (r) { return h('div', [h('b', null, r.companyName), h('div.tiny.muted', null, r.industryType + ' · GST ' + (r.gst || '—'))]); } },
            { label: 'Contact', render: function (r) { return h('div', [h('div', null, r.contactPerson), h('div.tiny.muted', null, r.email + ' · ' + r.mobile)]); } },
            { label: 'OTP', render: function (r) { return ui.badge(r.otpVerified === 'Y' ? 'Y' : 'N', r.otpVerified === 'Y' ? 'verified' : 'unverified'); } },
            { label: 'Submitted', render: function (r) { return ui.fmtDateTime(r.submittedAt); } },
            { label: 'Status', render: function (r) { return ui.badge(r.status); } },
            {
              label: '', render: function (r) {
                if (r.status !== 'Pending') return h('span.tiny.muted', null, r.companyId || '');
                return h('div.row', { style: { gap: '6px' } }, [
                  h('button.btn.sm.primary', { onclick: function () { approve(r); } }, 'Approve'),
                  h('button.btn.sm.bad', { onclick: function () { reject(r); } }, 'Reject')
                ]);
              }
            }
          ],
          rows: res.data.requests || [],
          emptyMessage: 'No signup requests with this status.'
        }));
      });
    }
    function approve(r) {
      var cid = h('input', { placeholder: 'CMP-XXXXXX (auto if blank)' });
      var pw = h('input', { placeholder: 'temp password (auto if blank)' });
      ui.modal({
        title: 'Approve ' + r.companyName + '?',
        body: [
          h('p.tiny', null, 'This creates the company spreadsheet, private Drive folder, registry row and the Super Admin account. Credentials are e-mailed to ' + r.email + '.'),
          h('div.grid.c2.mt', [h('div.field', [h('label', null, 'Company ID'), cid]), h('div.field', [h('label', null, 'Temp password'), pw])])
        ],
        actions: [{
          label: 'Approve & provision', kind: 'primary', onClick: function (close) {
            call('approveCompany', { requestId: r.requestId, companyId: cid.value.trim(), tempPassword: pw.value }).then(function (res) {
              if (!res.success) return ui.toast(res.error.message, 'bad');
              close();
              ui.modal({
                title: 'Company provisioned 🎉',
                body: h('div.ok-box', [
                  ui.kvList([
                    ['Company ID', res.data.companyId],
                    ['Super Admin', res.data.superAdminUserId],
                    ['Temp password', res.data.tempPassword],
                    ['Sheet', res.data.sheetUrl ? h('a', { href: res.data.sheetUrl, target: '_blank' }, 'open') : res.data.sheetId],
                    ['Tabs created', res.data.tabsCreated]
                  ]),
                  h('p.tiny.mt', null, 'Credentials were e-mailed to the contact. In production the temp password is NOT returned here.')
                ])
              });
              load();
            });
          }
        }]
      });
    }
    function reject(r) {
      var note = h('textarea', { rows: 2, placeholder: 'Reason (shared with the applicant)' });
      ui.modal({
        title: 'Reject ' + r.companyName + '?',
        body: h('div.field', null, note),
        actions: [{
          label: 'Reject', kind: 'bad', onClick: function (close) {
            if (!note.value.trim()) return ui.toast('A review note is required', 'bad');
            call('rejectCompany', { requestId: r.requestId, reviewNote: note.value.trim() }).then(function (res) {
              if (!res.success) return ui.toast(res.error.message, 'bad');
              close(); ui.toast('Request rejected', 'good'); load();
            });
          }
        }]
      });
    }
    ui.render(el, [h('div.filters', [statusSel, h('button.btn', { onclick: load }, 'Refresh')]), body]);
    load();
  };

  VIEWS.companies = function (el) {
    var q = h('input', { placeholder: 'Search name / ID / super admin' });
    var body = h('div.mt');
    function load() {
      ui.loading(body);
      call('listCompanies', { query: q.value }).then(function (res) {
        if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
        ui.render(body, ui.table({
          columns: [
            { label: 'Company', render: function (r) { return h('div', [h('b', null, r.companyName), h('div.tiny.muted', null, r.companyId + ' · ' + r.planTier)]); } },
            { label: 'Super admin', render: function (r) { return r.superAdminEmail; } },
            { label: 'Created', render: function (r) { return ui.fmtDate(r.createdAt); } },
            { label: 'Employees', align: 'right', render: function (r) { return r.employeeCount; } },
            { label: 'Sheet', render: function (r) { return r.sheetUrl ? h('a', { href: r.sheetUrl, target: '_blank' }, 'open') : '—'; } },
            { label: 'Status', render: function (r) { return ui.badge(r.status); } },
            {
              label: '', render: function (r) {
                return h('button.btn.sm.' + (r.status === 'Suspended' ? 'primary' : 'bad'), {
                  onclick: function () {
                    var next = r.status === 'Suspended' ? 'Active' : 'Suspended';
                    var reason = h('input', { placeholder: 'Reason (required to suspend)' });
                    ui.modal({
                      title: next + ' — ' + r.companyName,
                      body: h('div.field', null, reason),
                      actions: [{
                        label: next, kind: next === 'Active' ? 'primary' : 'bad', onClick: function (close) {
                          if (next === 'Suspended' && !reason.value.trim()) return ui.toast('Give a suspension reason', 'bad');
                          call('setCompanyStatus', { companyId: r.companyId, status: next, reason: reason.value.trim() }).then(function (x) {
                            if (!x.success) return ui.toast(x.error.message, 'bad');
                            close(); ui.toast('Company ' + next.toLowerCase(), 'good'); load();
                          });
                        }
                      }]
                    });
                  }
                }, r.status === 'Suspended' ? 'Restore' : 'Suspend');
              }
            }
          ],
          rows: res.data.companies || [],
          emptyMessage: 'No companies.'
        }));
      });
    }
    ui.render(el, [h('div.filters', [q, h('button.btn', { onclick: load }, 'Search')]), body]);
    load();
  };

  VIEWS.triggers = function (el) {
    var out = h('div.mt');
    ui.render(el, [
      h('div.card', [
        h('h3', null, 'Scheduled jobs'),
        h('p.tiny.muted', null, 'Five time-driven triggers: monthly auto-report (1st), document expiry check (daily), attendance close (23:00), weather flag (05:00) and GPS retention purge (weekly).'),
        h('div.row.mt', { style: { gap: '8px' } }, [
          h('button.btn.primary', {
            onclick: function () {
              call('installTriggers').then(function (res) {
                if (!res.success) return ui.toast(res.error.message, 'bad');
                ui.render(out, h('div.ok-box', [h('b', null, 'Triggers installed'), h('ul.tiny.mt', null, (res.data.installed || []).map(function (tt) { return h('li', null, tt); }))]));
              });
            }
          }, '⏰ Install triggers'),
          h('button.btn.bad', {
            onclick: function () {
              call('removeTriggers').then(function (res) {
                if (res.success) ui.render(out, h('div.warn-box', null, 'All SiteTrack triggers removed.'));
              });
            }
          }, 'Remove triggers')
        ]),
        out
      ])
    ]);
  };

  VIEWS.props = function (el) {
    var body = h('div');
    function load() {
      ui.loading(body);
      call('listScriptProperties').then(function (res) {
        if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
        ui.render(body, ui.table({
          compact: true,
          columns: [
            { key: 'key', label: 'Property' },
            { label: 'Value', render: function (r) { return h('code', null, r.value || '(not set)'); } },
            {
              label: '', render: function (r) {
                return h('button.btn.sm.ghost', {
                  onclick: function () {
                    var v = h('input', { value: r.value && r.value.indexOf('(hidden') !== 0 ? r.value : '' });
                    ui.modal({
                      title: 'Set ' + r.key,
                      body: h('div.field', null, v),
                      actions: [{
                        label: 'Save', kind: 'primary', onClick: function (close) {
                          call('setScriptProperty', { key: r.key, value: v.value }).then(function (x) {
                            if (!x.success) return ui.toast(x.error.message, 'bad');
                            close(); ui.toast('Property saved', 'good'); load();
                          });
                        }
                      }]
                    });
                  }
                }, 'Edit');
              }
            }
          ],
          rows: res.data.properties || []
        }));
      });
    }
    ui.render(el, [h('div.card', [h('h3', null, 'Script properties'), h('p.tiny.muted', null, 'Secrets are write-only from this panel; values are masked.'), body])]);
    load();
  };

  VIEWS.audit = function (el) {
    var body = h('div');
    function load() {
      ui.loading(body);
      call('platformAuditLog', { limit: 300 }).then(function (res) {
        if (!res.success) return ui.render(body, h('div.err-box', null, res.error.message));
        ui.render(body, ui.table({
          compact: true,
          columns: [
            { label: 'When', render: function (r) { return ui.fmtDateTime(r.Timestamp); } },
            { key: 'Action', label: 'Action' },
            { label: 'Detail', render: function (r) { return h('span.tiny.muted', null, r.Details || ''); } },
            { label: 'Result', render: function (r) { return ui.badge(r.Result === 'OK' ? 'Approved' : 'Rejected', r.Result); } },
            { key: 'ActorUserID', label: 'Actor' }
          ],
          rows: res.data.entries || [],
          emptyMessage: 'No platform audit entries.'
        }));
      });
    }
    ui.render(el, [h('div.card', [h('div.row', null, [h('h3', { style: { margin: 0 } }, 'Platform audit log'), h('span.grow'), h('button.btn.sm', { onclick: load }, '↻')]), body])]);
    load();
  };

  window.ST.owner = { boot: boot };
})();
