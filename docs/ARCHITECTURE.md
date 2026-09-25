# SiteTrack — architecture & design notes

## 1. Big picture

There is exactly ONE deployment and no external host: the same Web App URL answers
`?page=…` with an HTML page and `?action=…` with JSON.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Google Apps Script Web App  (doGet / doPost · 04_Router.gs)               │
│                                                                            │
│   ?page=index|login|signup|status   public pages      ┌──────────────────┐  │
│   ?page=company  → ?page=app        company portal    │  HtmlService     │  │
│   ?page=employee → ?page=mobile     employee portal   │  templates:      │  │
│   ?page=owner (admin)               approvals panel   │  backend/tmpl_*  │  │
│   ?action=<name>                    JSON API (100)    └──────────────────┘  │
└───────┬───────────────────────────┬──────────────────────┬─────────────────┘
        │                           │                      │
   SpreadsheetApp              DriveApp                MailApp / UrlFetchApp
   Platform Master sheet       private per-company      OTP + notifications
   + one sheet per company     folders, selfies         (WhatsApp optional)
```

The browser talks to the *same origin* it was served from, so pages POST JSON-shaped bodies as
`Content-Type: text/plain` (a CORS-safe simple request) and never need a pre-flight.

The frontend is **dumb**: it renders DTOs and never computes attendance rules.
The backend is **stateless** between calls: identity lives in an HMAC token, tenant data
lives in the company spreadsheet, cross-call caches live in `CacheService`.

## 2. Data model

* **Platform Master spreadsheet** (script property `MASTER_ID`)
  `CompanySignupRequests`, `CompanyRegistry`, `LoginIndex`, `PlatformAuditLog`.
  `LoginIndex` maps `mobile|email|userId → (company, user)` so a single public endpoint can
  resolve any tenant without opening every company sheet.
* **Company spreadsheet** (one per approved company, 17 tabs):
  `Users`, `Projects`, `ProjectAssignments`, `Attendance`, `LeaveRequests`,
  `ExpenseRequests`, `SiteTransfers`, `RegularizationRequests`, `Vendors`,
  `VendorWorkers`, `Documents`, `Holidays`, `Shifts`, `DeviceRegistry`, `Notifications`,
  `AuditLog`, `Settings`.
* Sheets are used as append-mostly tables with a header row; `02_Store.gs` provides
  `readTable_/findRecord_/appendRecord_/updateRecord_/deleteRecord_` plus a lock wrapper
  (`withLock_`) for write bursts. Dropdowns & conditional formatting are applied when the
  company sheet is created so humans can also read/edit the sheet directly.
* **Drive** tree: `SiteTrack Companies/<Company>/{Selfies/yyyy-MM, Documents, Reports,
  VendorPhotos, CompanyLogos}` — nothing is ever shared publicly.

## 3. Request lifecycle

**Pages.** `doGet` with `?page=` (or no `page` at all) renders a template through
`servePage_` → `HtmlService.createTemplateFromFile(tmpl_*.html)`. The `<?!= includeJs_('api_js') ?>`
scriptlets inline the shared JS/CSS, and `tmpl_config_js.html` reads
`ScriptApp.getService().getUrl()` at render time, so every page knows its own `/exec` address
without a single hard-coded URL. `?page=login` is a small chooser; `?page=company` and
`?page=employee` are the two separate sign-in doors and `?page=owner` is the platform admin panel.

**API.**

1. `doGet/doPost` → `handleApi_` parses `{action, token, payload}` (+ device metadata).
2. Rate limit bucket (`login`, `otp`, `register`, `lookup`) via CacheService counters.
3. Auth: `none | user | staff | owner`. Tokens are
   `base64url(payload).hmacSha256(payload, TOKEN_SECRET)[0:32]`, 12 h TTL, revocable via
   `revoked:{jti}` cache keys, and carry a `portal` claim (`company` | `employee`). Sign-in is
   portal-gated: `companyLogin`/`companySendOtp` accept only SuperAdmin/Admin/SubAdmin rows,
   `employeeLogin`/`employeeSendOtp` only Employee rows (`assertPortal_`), and `ownerLogin` is a
   third, key-based door for the platform admin. Wrong-door credentials get `403` + the right link.
4. `buildContext_` opens the company spreadsheet **once per request**, loads settings,
   computes `permissions` + `projectScope`, and memoises tab reads (`memo_`).
5. The action function runs inside the tenant context; helpers like `scopedRows_`,
   `assertProjectScope_`, `maskUser_` enforce tenancy and masking.
6. Response `{success, data|error, meta}` — `meta.ms` makes latency visible to the UI.

## 4. Attendance engine (`09_Attendance.gs`)

`evaluateMark_` order of checks: project resolution → captured-timestamp drift
(≤ offlineMaxAgeHours, never in the future) → GPS validity & accuracy → device binding →
selfie presence/size → duplicate guard → Haversine distance vs `geofenceRadius`
(project override → company default) → marking window + late grace → status derivation:

| Condition                                   | Status    |
| ------------------------------------------- | --------- |
| inside fence, before cutoff                 | Present   |
| inside fence, after grace                   | Late      |
| outside fence / bad GPS / window violation  | Flagged (admin review) |
| QR payload valid (selfie still required)    | source=QR, fence bypassed |
| offline entry (source=offline)              | validated on capturedAt, then same rules |

Mark-out computes payable hours (break subtracted), half-day downgrade and overtime
hours against the project/company threshold. A nightly trigger closes the day
(Absent/Holiday/Week-off) so reports never have holes.

## 5. Payroll math (`15_Payroll.gs`)

```
payableDays = present + late + 0.5·halfDay + paidLeaves + travel + paidHolidays·holidays
rate        = assignment.DailyWage || user.DailyWage || monthlySalary / monthDays
earned      = rate · payableDays
overtime    = otHours · (rate / standardHours) · overtimeRate
+ approved expenses (not yet AddedToSalary)  − LOP days · rate  − advances
= netPayable
```
`confirmPayout=true` flips those expenses to `AddedToSalary` (idempotent guard against
double payment) and writes a `PAYROLL_CONFIRMED` audit row.

## 6. Frontend architecture (inside the Apps Script project)

* `api_js.html` — endpoint resolution (the page's own `/exec` URL, or the relative `/api` on the
  dev harness), device fingerprint (stable hash of UA+screen+tz+seed), session store, offline
  queue (`sitetrack.offlineQueue` in localStorage; batches `markAttendance` on flush), GPS/camera
  helpers (camera-only selfies, canvas downscale).
* `auth_js.html` — the shared sign-in engine behind both portals: mode tabs (password / one-time
  code), OTP sending, forced password change, new-device notice and the redirect that lands each
  role on its own home (`?page=app` for company staff, `?page=mobile` for employees).
* `ui_js.html` — 0-dependency DOM toolkit (hyperscript `h()`, toasts, modals, tables, badges,
  CSV/print/download helpers, theme, install prompt).
* `map_js.html` — lazy Leaflet from CDN with a graceful coordinate-card fallback when the CDN is
  unreachable (common on site networks).
* `admin_js.html` / `mobile_js.html` / `owner_js.html` — hash-routed SPAs for the company console,
  the employee app and the admin panel; every list is fetched through the same scoped actions, so
  permissions behave identically everywhere. `mobile_js.html` has no login form at all: without a
  session it forwards to `?page=employee`.
* `i18n_js.html` — EN/HI dictionary (280 keys, both languages complete); the worker app is fully
  translated, status codes included.
* No service worker: an Apps Script deployment cannot host an `sw.js` file, so offline attendance
  relies on the localStorage queue + `navigator.onLine` flush, which keeps working because the
  capture happens in the page the worker already has open.

## 7. Threat model & mitigations

| Threat                          | Mitigation |
| ------------------------------- | ---------- |
| Buddy punching (proxy marking)  | live selfie + device fingerprint binding + GPS accuracy cap |
| Back-dated offline entries      | capturedAt drift window + admin regularization flow + audit |
| Token theft / replay            | 12 h TTL, HMAC secret per deployment, revocation list, device check on sensitive actions |
| Cross-tenant access             | per-company spreadsheet + context-bound helpers; registry scan capped; admin actions on a separate key-based token |
| Worker reaching the HR console  | separate portals enforced server-side (`assertPortal_`), not by hiding UI |
| Secret leakage via DTOs         | `maskUser_` strips hashes/OTP for every role; script properties masked in owner panel |
| Brute force login/OTP           | per-bucket rate limits (8/min login, OTP throttles) |
| Public file exposure            | Drive files private; bytes only via `getFile` after record-level access check |
| Payroll disputes                | immutable attendance rows + full audit log incl. every export |

## 8. Limits & quotas (Google free tier)

* Apps Script: 6 min/execution, 90 min CPU/day (consumer) — batch sync caps at 20 entries,
  reports cap at 366 days, exports ≤ 6 MB inline (larger files land in Drive).
* MailApp: 100 mails/day (consumer) — notifications aggregate; monthly report is one mail
  with an attachment.
* Sheets: 10 M cells/spreadsheet — attendance rows are ~40 columns; a 50-person company
  produces ≈ 15 k rows/year, comfortably inside limits.

## 9. Extending

* New report type: add to `REPORT_TYPES`, a builder in `14_Reports.gs`, a column set — the
  export pipeline (render → Google export URL → Drive → dataUrl) is generic.
* New permission: add to `PERMISSIONS` + `ROLE_DEFAULT_PERMISSIONS` in `00_Config.gs`; the
  settings UI and router pick it up automatically.
* New channel: implement `sendSmsOrWhatsApp_` alternatives in `17_Notifications.gs`;
  `settings.notifyChannel` selects at runtime.
