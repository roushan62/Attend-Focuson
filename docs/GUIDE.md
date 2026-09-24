# SiteTrack Guide Book

**The complete manual for the Google Sheets + Apps Script workforce platform** — how to build
it, how to deploy it, and how every role uses it once it is live.

| | |
|---|---|
| **Software** | SiteTrack `1.0.0` (schema `gas-sheets-v1`) |
| **Applies to** | Backend: 23 Apps Script modules, 99 API actions · Frontend: 7 HTML pages served by the same web app |
| **Audience** | The person who installs it, and every person who runs it afterwards |
| **Companion docs** | `docs/SETUP.md` (copy-paste install) · `README.md` (quick start) · `docs/API.md` (every action + payload) · `docs/ARCHITECTURE.md` (design notes) |

> **Read this first.** The book is split into four parts. You only need one or two of them:
>
> * **Installing or migrating the system** → **Part I** (chapters 1–10). Do them in order.
> * **Running a company day to day** → **Part II** (chapters 11–14), the role manuals.
> * **Attendance rules, approvals, reports, payroll** → **Part III** (chapters 15–20).
> * **Something is wrong, or you need an exact default value** → **Part IV** (chapters 21–27).
>
> Every number quoted in this book (timeouts, windows, defaults, limits) is read from the code,
> not from memory. If a value differs, your copy of the code differs — check
> `backend/00_Config.gs` and `backend/04_Router.gs`.

---

# PART I — BUILD AND DEPLOY

## 1. What you are building

SiteTrack is a multi-tenant workforce system where **Google Sheets is the database and Google
Apps Script is the server**. There is no VM, no container, no subscription, no SQL:

```
   Worker phone (PWA)             Office laptop (web app)          Platform owner
   ?page=mobile                   ?page=app                        ?page=owner
            │                              │                              │
            └──────────────┬───────────────┴──────────────┬───────────────┘
                           │  POST text/plain JSON         │
                           ▼                               │
              ┌──────────────────────────────┐             │
              │  Google Apps Script Web App  │◄────────────┘
              │  backend/*.gs   (99 actions) │  ← also SERVES the 7 HTML pages
              │  token auth · permissions ·  │
              │  geofence · payroll · audit  │
              └───────────┬──────────┬───────┘
                          │          │
                          ▼          ▼
              ┌────────────────┐  ┌──────────────────┐
              │ Google Sheets  │  │  Google Drive     │
              │ 1 workbook per │  │ 1 private folder  │
              │ company + the  │  │ tree per company  │
              │ Platform Master│  │ (selfies, proofs) │
              └────────────────┘  └──────────────────┘
```

**Four properties that shape everything else in this book:**

1. **Free.** The whole stack runs inside Google's consumer quotas (~90 MB of script storage,
   100 MB Sheets-per-file limit, 30 000 URL-fetch calls/day, 1 500 script-execution minutes/day).
   One company with ~150 staff and 2 attendance rows each per day sits comfortably inside them.
2. **Your data never leaves your Google account.** Nothing is stored on a third-party server.
   The frontend is served *from* your Apps Script deployment; the browser talks to
   *your* `/exec` URL only.
3. **Tenancy is physical.** Each company gets its **own spreadsheet and its own Drive folder**.
   A bug in the UI cannot leak one company's rows into another, because the API never opens
   two company workbooks in one request.
4. **No demo data, ever.** The installer creates **empty structure only**. There is no seed
   script, no evaluation company, no fake workers — a company exists only after a real signup
   is approved. `npm run verify` fails the build if a demo reference is ever added to shipped
   code.

### 1.1 The data map

| Store | What lives there | Written by |
|---|---|---|
| `SiteTrack - Platform Master` | signup requests, company registry, login index, platform audit log | owner + signup flow |
| `SiteTrack — <Company>` (17 tabs) | settings, users, projects, assignments, attendance, leave, expenses, transfers, regularizations, vendors, vendor workers, holidays, shifts, documents, notifications, devices, audit | the company's staff |
| `SiteTrack/SiteTrack-<CompanyID>/` (Drive) | `Selfies` (dated), `Documents`, `Expenses`, `VendorPhotos`, `Reports`, `Temp` | uploads only |

### 1.2 Who can do what (one glance)

| Capability | Owner | Super Admin | Admin | Sub-Admin | Worker |
|---|---|---|---|---|---|
| Approve companies, set plan, suspend | ✔ | — | — | — | — |
| Everything in the company | — | ✔ (all 23 permissions) | ✔ (15 by default) | only the ticks you grant | — |
| Mark attendance, raise requests | — | — | — | — | ✔ (own records) |
| UI used | `?page=owner` | `?page=app` | `?page=app` | `?page=app` | `?page=mobile` |

---

## 2. Before you start

You need exactly one account and no credit card:

1. **A Google account** that will own the data. Prefer a dedicated address
   (e.g. `sitetrack-ops@…`) rather than a personal one — everything (sheets, Drive files,
   the API's identity) is created as that user. A Google Workspace account raises the
   script quotas; a free consumer account works fine for a single company.
2. **Nothing else.** No GitHub, no Netlify, no Vercel, no domain — the frontend and the API
   are both served by your own Apps Script web app (see chapter 3).

Optional but recommended:

* **Node 18+** on your laptop: only for `npm run dev` (offline preview), `npm test`
  (200+-check end-to-end suite) and `npm run verify` (consistency checks). Not needed to deploy.
* **A phone with Chrome** — the worker app asks for camera and location permissions.
* **clasp** (`npm i -g @google/clasp`) — pushes `backend/` to the script project from the
  command line. Without it you copy-paste the 40 files once (docs/SETUP.md); with it, updates
  take one command.

### 2.1 Decide these before you install

| Decision | Value to note down | Where it goes |
|---|---|---|
| Company timezone | default `Asia/Kolkata` | script property `TIMEZONE` |
| Working week | e.g. Mon–Sat, Sunday off | setup wizard step 4 |
| Marking window | e.g. 06:00–11:00, cutoff 11:00 | setup wizard step 3 |
| Geofence radius | default 200 m per project | project form |
| Who approves signups | the platform owner's e-mail | `OWNER_EMAIL` |
| Which link people open | your Apps Script `/exec` URL (auto-detected by the frontend) | deployment step 3 |

### 2.2 Quota reality check

The consumer limits are generous but real. Plan for them:

* **Sheets:** 10 M cells per spreadsheet. A 150-person company writing ~300 attendance rows a
  month per year ≈ 3.6 k rows/year — years of headroom. `Attendance` is the fast-growing tab;
  the weekly purge job trims the bulky GPS columns.
* **Execution:** 90 min/day (consumer) or 6 h/day (Workspace). Marking attendance costs
  ~0.5 s; the heaviest calls are the payroll and monthly report exports.
* **URL fetch:** 20 k/day (used by weather and geocoding only).
* **Storage:** 15 GB Google Drive per consumer account. Selfies are resized to
  `SELFIE_WIDTH` 640 px at quality 0.72 in the browser (≈ 30–60 kB each).

---

## 3. Create the Apps Script project (backend + frontend)

**Time: 20 minutes.** Nothing here is irreversible. The clickable checklist version of this
chapter is [SETUP.md](SETUP.md).

1. Easiest: <https://sheets.new> → **Extensions → Apps Script** (a script bound to a fresh
   Sheet). Or <https://script.google.com> → **New project**. Name it `SiteTrack`.
2. Click **⚙️ Project settings** → tick **Show "appsscript.json" manifest file in editor**.
3. Replace the generated `appsscript.json` with `backend/appsscript.json`. It pins:
   * `timeZone: "Asia/Kolkata"` — **all** sheet timestamps and the attendance window use it;
   * six OAuth scopes (spreadsheets, drive, send_mail, external_request, scriptapp, userinfo.email);
   * `webapp.executeAs: "USER_DEPLOYING"` and `webapp.access: "ANYONE_ANONYMOUS"` — the latter
     is what lets a worker with no Google account sign in with a phone number.
4. Delete the default `Code.gs`.
5. For each file in `backend/*.gs` create a script with **the same name** (without `.gs`) and
   paste the contents. The leading number is only a reading order — Apps Script shares one
   global scope.

| # | File | What it owns |
|---|---|---|
| 00 | `00_Config.gs` | enums, 23 permissions, 33 default settings, sheet schemas, script-property keys |
| 01 | `01_Utils.gs` | pure helpers: dates, ids, Haversine distance, validation, JSON, memo cache |
| 02 | `02_Store.gs` | spreadsheet I/O, table read/write, company workbook lifecycle, audit writer |
| 03 | `03_Security.gs` | salted SHA-256 passwords, HMAC session tokens, permission checks, device binding, OTP |
| 04 | `04_Router.gs` | `doGet`/`doPost`/`doOptions`, the ACTIONS table (the single source of truth for auth), rate limiting, JSON envelope |
| 05 | `05_Platform.gs` | signup + OTP, owner panel actions, company approval/provisioning, registry |
| 06 | `06_Auth.gs` | LoginIndex, password + OTP login, session payload, device-change request, profile |
| 07 | `07_Users.gs` | employee CRUD, permission grants, status changes, password resets, device registry |
| 08 | `08_Projects.gs` | project CRUD, GPS lock, geofence, QR payload, assignments, team view |
| 09 | `09_Attendance.gs` | the engine: mark in/out, QR check-in, flagging, review, regularization, live map, dashboard, monthly summary |
| 10 | `10_Leave.gs` | leave application, balances, approval, cancellation |
| 11 | `11_Expense.gs` | expense claims with proof upload, approval, payout status |
| 12 | `12_Transfer.gs` | site transfer requests and their effect on assignment + attendance |
| 13 | `13_Vendors.gs` | sub-contractor vendors, daily manpower entries, manpower report |
| 14 | `14_Reports.gs` | 9 report builders, Excel/PDF/CSV export, audit-log report |
| 15 | `15_Payroll.gs` | wage-sheet computation, payout confirmation |
| 16 | `16_Documents.gs` | document vault, expiry statuses and alerts |
| 17 | `17_Notifications.gs` | in-app inbox, e-mail, SMS/WhatsApp dispatch |
| 18 | `18_Settings.gs` | settings validation and saving, setup wizard, holidays, shifts |
| 19 | `19_Triggers.gs` | the 5 scheduled jobs + trigger installer |
| 20 | `20_Bootstrap.gs` | `setupScript()` (structure + secrets) and `diagnoseDeployment()` (audit) |
| 21 | `21_Files.gs` | Drive upload/download, token-gated byte serving |
| 22 | `22_Frontend.gs` | page router (`?page=…`), server-side includes, inline logo, setup-error page |

6. **Save** (💾). With clasp instead of pasting: copy `.clasp.json.example` → `.clasp.json`,
   set `scriptId` to the id from the project URL, then `clasp push` from the repo root
   (`rootDir` is already `backend`).

7. **Create the 16 HTML files** — this is the frontend, served by the same web app.
   For each: **+ → HTML**, type the name **without `.html`** (the editor adds it), paste the
   contents of the same-named file in `backend/`:

   | Pages | Assets (look like JS/CSS but are HTML files) |
   |---|---|
   | `tmpl_index` · `tmpl_login` · `tmpl_signup` · `tmpl_status` | `app_css` · `tmpl_config_js` · `i18n_js` |
   | `tmpl_app` · `tmpl_mobile` · `tmpl_owner` | `api_js` · `ui_js` · `map_js` |
   | | `admin_js` · `mobile_js` · `owner_js` |

   `22_Frontend.gs` routes `/` → `tmpl_index`, `?page=login` → `tmpl_login`, and so on, and
   inlines the assets with `includeCss_`/`includeJs_`. The page's API URL resolves itself
   (`tmpl_config_js` reads `ScriptApp.getService().getUrl()`), so there is nothing to configure.
   A missing file shows a **“setup incomplete”** page naming exactly what to create.

> **Do not add "libraries", do not rename files, do not merge them.** `04_Router.gs` reads the
> `ACTIONS` table and resolves handlers by name; the file inventory and the mirror checks are
> enforced by `npm run verify`.

---

## 4. Script properties and secrets

Everything secret lives in **Project settings → Script properties** — never in code, never in a
sheet. Create the mandatory ones:

| Key | Value | Notes |
|---|---|---|
| `OWNER_EMAIL` | your e-mail | receives signup alerts and monthly reports |
| `DEV_MODE` | `false` | `true` echoes OTP codes in API responses. **Never** enable it on a public deployment |

Two more are **generated for you** by the bootstrap step and must never be typed by hand:
`PLATFORM_MASTER_ID` (the master workbook) and `TOKEN_SECRET` (signs session tokens).
`OWNER_KEY` (owner panel password) and `DRIVE_ROOT_ID` are generated too.

Optional integrations — add only what you use:

| Key | Effect when set |
|---|---|
| `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` | OTPs and alerts go out over WhatsApp Cloud API; falls back to e-mail silently |
| `MAPS_API_KEY` | Google geocoding instead of the free Open-Meteo geocoder |
| `WEATHER_ENABLED=true` | rain / extreme-heat flagging by the 05:00 job |
| `SELFIE_MAX_BYTES` | upload ceiling; default 4 000 000 |
| `MAIL_FROM_NAME` | sender name on every e-mail |
| `ALLOW_UNVERIFIED_SIGNUP=true` | lets signup complete without an OTP — local testing only |
| `TIMEZONE` | overrides `Asia/Kolkata` platform-wide |

---

## 5. Bootstrap the platform

Open the editor's function picker, choose **`setupScript`**, press **▶ Run**, and authorise the
scopes when the consent screen appears. This is the only manual database step in the product.

It calls `actionBootstrapPlatform`, which:

1. creates **`SiteTrack - Platform Master`** with 4 tabs — `CompanySignupRequests`,
   `CompanyRegistry`, `LoginIndex`, `PlatformAuditLog`;
2. creates the Drive root folder **`SiteTrack`** (company folders are made under it);
3. generates `TOKEN_SECRET` and `OWNER_KEY` and stores `PLATFORM_MASTER_ID`;
4. installs the five time-driven triggers;
5. prints the owner key **once** in the execution log.

**Copy the owner key the moment it appears.** It is never returned again by any action, and it
is the password of the owner panel. Store it in your password manager. Re-running `setupScript()`
rotates the secrets and invalidates every live session — that is the recovery path if the key is
lost *and* the reason not to run it casually.

Check the log for `✓` on each line, or run **`diagnoseDeployment`** (same picker) — it reports
structure, secret presence (never values), company count, per-company tab integrity, trigger
coverage and warnings. Safe to paste into a support chat.

---

## 6. Deploy — one URL serves the API AND the frontend

### 6.1 Deploy as Web App

1. **Deploy → New deployment → ⚙️ Web app.**
2. *Description:* `v1.0.0`. *Execute as:* **Me**. *Who has access:* **Anyone**.
3. Press **Deploy**, authorise, and copy the **Web app URL** — `https://script.google.com/macros/s/<id>/exec`.
4. Sanity check in a browser: `<that URL>?action=ping` must return

   ```json
   { "success": true, "data": { "app": "SiteTrack", "version": "1.0.0",
     "actions": 99, "configured": true, "devMode": false, … } }
   ```

   `configured:false` means bootstrap did not run; an HTML login page instead of JSON means the
   *Who has access* setting is wrong.
5. Open the bare URL: the website must appear (hero, **Register**, **Sign in**). Then check
   `?page=login`, `?page=mobile` and `?page=owner` — all served from this same deployment.

> **The rule that catches everyone:** Apps Script never auto-updates an `/exec` URL. After any
> change (backend **or** HTML files): **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.**
> The same is true for scope changes; you only re-consent when a *new* scope appears.

### 6.2 Frontend configuration — nothing to do

The 16 HTML files are part of the same project (chapter 3, step 7) and are served by
`22_Frontend.gs`. The client resolves its own API URL at render time
(`ScriptApp.getService().getUrl()` inside `backend/tmpl_config_js.html`) — **there is no
`API_URL` to paste anywhere.** Optional knobs live in that same file: `APP_NAME`,
`SUPPORT_EMAIL`,
`DEFAULT_LOCALE` (`en`/`hi`), `MAP_TILE_URL`, `SELFIE_WIDTH`/`SELFIE_QUALITY`,
`GPS_TIMEOUT_MS` (20 000 — how long the worker app waits for a fix before offering QR),
and the `FEATURES` flags (`offlineAttendance`, `qrFallback`, `weatherFlag`, `installPrompt`,
`publicSignup`). Setting `publicSignup:false` hides signup and status pages — useful after the
first tenants are onboarded.

No CORS setup is needed: the client POSTs `application/json`-shaped bodies as
`Content-Type: text/plain`, which is a CORS-safe simple request, so Google never gets a
pre-flight it cannot answer.

### 6.3 Optional: static mirror (never required)

Only for a custom domain. Publish `frontend/` on **any** static host (GitHub Pages, Netlify,
Vercel, S3 …), set `API_URL` in `frontend/config.js` to your `/exec` URL and leave `OWNER_KEY`
blank (`?page=owner` asks for it at runtime). The API still runs exclusively on Apps Script.
`npm run verify` keeps `frontend/` byte-identical to `backend/*.html`, so the mirror can never
drift from the served UI. Skip this chapter entirely if you do not need a custom domain.

### 6.4 Install the worker app on phones

Open `<URL>?page=mobile` on the phone → Chrome menu → **Add to Home screen**. Attendance taken
offline is queued under the localStorage key `sitetrack.offlineQueue` and replayed when
connectivity returns (validated against the *captured* timestamp, not the sync time). On the
optional static mirror, `frontend/sw.js` additionally caches the shell for full offline loads.

---

## 7. First company: signup → approval → wizard

Do this once per company; it is the only way a tenant can exist.

1. **`?page=signup`** — company name, GST/registration number, registered address, contact
   person, official e-mail, 10-digit mobile, industry, optional logo (printed on every report).
   Press **Send OTP**: a 6-digit code is e-mailed (plus SMS/WhatsApp if configured) and expires
   after 600 s. Typing it fires `verifyOtp`, which shows **Number verified** before you submit —
   `registerCompany` re-checks the same code server-side, so a "verified" tick cannot be replayed.
   The result is a **Request ID** (`REQ-…`) you can track publicly at `?page=status`.
2. **`?page=owner`** (not linked anywhere) — paste the owner key → **Signup requests** → open the
   pending row → check GST/address/contact → **Approve**. Approval, atomically:
   * creates `SiteTrack — <Company>` with **all 17 tabs**, headers, dropdown validations and
     conditional formatting;
   * creates the private Drive folder tree `SiteTrack/SiteTrack-<CompanyID>/` with `Selfies`, `Documents`, `Expenses`, `VendorPhotos`, `Reports`, `Temp` — shared with **nobody**;
   * writes the `CompanyRegistry` row (the `LoginIndex` entry that resolves a phone number or
     e-mail to this tenant is written the first time that person signs in);
   * creates the **Super Admin** account and e-mails the temporary password.
3. **`?page=login`** — the Super Admin signs in with the e-mail (or user ID) and the temp
   password. `mustChangePassword:true` is returned, so the UI forces a new password immediately
   (**≥ 8 characters, at least one letter and one number**). The device fingerprint is bound at
   this first login.
4. **Setup wizard, 4 steps** — (1) profile & address, (2) rules: geofence radius, selfie
   required, device binding required, QR fallback, (3) attendance window, cutoff, late grace,
   check-out window, (4) working days, weekly off, holidays. `completeSetupWizard` writes the
   company settings and `setupCompleted:'Y'`.
5. **Projects** — + Project: name, client, PMC, start/end dates, address. Press **Locate** to
   drop the GPS pin (or paste coordinates) and set the radius; the geofence is **locked on
   creation** — moving it later needs `manageGeofence` and is audit-logged. Print the **QR code**
   for indoor check-in fallback.
6. **Employees** — add staff and workers; a temp password is e-mailed when an e-mail exists,
   otherwise share it and let the worker use password-less OTP login. Assign each to a project;
   the assignment drives "expected today" on the dashboard.
7. **Team & go-live** — grant Sub-Admins only the permission ticks they need (chapter 13),
   upload the documents the compliance calendar needs (chapter 18), then tell the site to start
   marking. The next day at 23:00 the close job marks everyone unmarked as Absent / Week-off /
   Holiday — that is your confirmation the triggers are alive.

**Verify with `?action=health`:** `PlatformMasterSheet`, `CompanyRegistry` and
`CompanySheetsReachable` must all be `true`.

---

## 8. Scheduled jobs

Five time-driven functions exist. **Owner panel → Triggers → Install triggers** registers them
(or run `installTriggers()` once in the editor). They run as the deploying user, so they work
even when nobody is signed in.

| Function | When (script timezone) | What it does |
|---|---|---|
| `monthlyAutoReport` | 1st of every month, 06:00 | builds the previous month's attendance + payroll workbook, e-mails it to every Super Admin and to `reportRecipients` |
| `documentExpiryCheck` | daily 07:00 | expiry alerts for documents inside their alert window; at most one reminder per document per day |
| `dailyAttendanceClose` | daily 23:00 | auto-marks assigned staff with no record: `Absent`, or `Holiday`/`WeekOff` when the calendar says so |
| `weatherFlagJob` | daily 05:00 | yesterday's rain / extreme-heat flag (Open-Meteo, no key), when `autoRainDayFlag` is on |
| `purgeOldGpsData` | weekly Sunday 03:00 | blanks raw lat/long older than `gpsRetentionMonths` (default 12), keeping only the distance and the site |

Test any of them today without waiting for the schedule: run the function name from the editor
and read the execution log, or use `npm run dev` locally where the same functions are exercised
by `npm test`. Two practical notes:

* Triggers are counted against daily execution time; the monthly report is the only heavy one.
  If a company grows past ~500 staff, run the report per company instead of platform-wide.
* **Remove triggers before deleting a sheet**: `removeAllTriggers()` (owner panel → Triggers →
  Remove) prevents jobs erroring against an uninstalled deployment.

---

## 9. Verify, harden, then go live

### 9.1 The five-minute technical check

```bash
npm run verify     # static consistency: router ↔ code ↔ docs ↔ mirrors ↔ i18n ↔ SETUP checklist ↔ "no demo data"
npm test           # 200+ behavioural checks: the API AND every page rendered by doGet, on Node polyfills
npm run check      # both
```

`npm run verify` catches the class of mistakes that survive review: an action wired in the
router with no handler, a UI call to a renamed action, a `backend/*.html` file that has drifted
from its `frontend/` twin, an include that points at a missing editor file, an English key with
no Hindi twin, a schema dropdown pointing at a column that does
not exist, docs claiming the wrong action count, a `docs/SETUP.md` checklist that forgot a file,
and any demo/sample data creeping into shipped
code. It is safe to run in CI — zero dependencies, exit code 0/1.

`npm test` runs the *actual* Apps Script sources in a Node VM with polyfills
(`dev/gas/polyfill.mjs`): SpreadsheetApp → JSON files, DriveApp → a local folder, MailApp →
an outbox, real HMAC/SHA-256 via `node:crypto`. It exercises signup → approval → wizard →
projects → users → the attendance engine → approvals → vendors → documents → reports →
payroll → exports → permissions → triggers, then proves a **second company can be onboarded
through the public flow with zero seeded rows** and sees nothing from the first.

### 9.2 Security checklist for production

- [ ] `DEV_MODE=false` (or unset) — `?action=ping` must show `"devMode": false`.
- [ ] `OWNER_KEY` is **not** in any HTML/config file — the owner panel asks for it at runtime.
- [ ] Web app *Execute as: Me*, *Anyone* access, and the URL is only in `config.js`.
- [ ] `ALLOW_UNVERIFIED_SIGNUP` not set.
- [ ] `SELFIE_MAX_BYTES` reasonable for your phones; `gpsRetentionMonths` set to your policy (default 12).
- [ ] Password policy untouched (≥ 8 chars, letter + number) and `TOKEN_SECRET` never rotated casually.
- [ ] Sheet permissions: the master and every company workbook are shared with **nobody**;
      verify by opening the master in an incognito window — it must fail.
- [ ] Triggers installed; `diagnoseDeployment()` green.
- [ ] Recovery: you know the owner key, and you can regenerate a lost worker password with
      `resetUserPassword` (Admin with `editEmployees`).

---

## 10. Backup, updates, migration, removal

**Update the app.** Paste the changed files (or `clasp push`) → **new deployment version** —
this republishes backend *and* frontend together, since both live in the same project.
`npm run check` before every push. Never
edit a company sheet's header row — the store maps columns by header name, so adding columns is
tolerated but renaming one is not.

**Backup.** Drive → the `SiteTrack` folder → select all → Download (copies every workbook as
`.xlsx` and every selfie/proof). The Sheets-native alternative is a weekly copy of the master +
company workbooks into a backup folder; a company can also self-serve: Reports → any report →
Export `.xlsx`.

**Migrate to another Google account.** Copy each workbook and the Drive folder tree to the new
account (share → transfer ownership, or download/upload), create a fresh script project, run
`setupScript()`, then update `PLATFORM_MASTER_ID` and `DRIVE_ROOT_ID` in the new project's script
properties to the copied ids. The new project's `/exec` URL is the new API + frontend address —
share it again (or redeploy under a custom URL). Session tokens
are signed by `TOKEN_SECRET`, so everybody signs in again — expected.

**Close a company.** Owner panel → Companies → Status `Closed`. Login is refused immediately and
the workbook + Drive folder stay available for the statutory retention period; delete them
yourself from Drive when that period ends. Nothing else in the platform references the tenant but
the registry row.

---

# PART II — ROLE MANUALS

## 11. Platform Owner (hidden panel)

The owner is you, the operator of the platform — not a company manager. There is no link to this
panel anywhere in the product (that is deliberate): open it directly, i.e. append
`?page=owner` to your Apps Script `/exec` URL.

**Sign in** with the owner key from the bootstrap log. The key is sent as-is to `ownerLogin`; a
wrong key returns 401 with no hint about why. Sessions behave like any other (12 h) and the
owner is never a user row in any company.

| Tab | What you do there |
|---|---|
| **Overview** | companies by status, signups pending, total users/projects/marks, latest platform audit entries |
| **Signup requests** | review Pending rows → **Approve & provision** (creates workbook + Drive folder + Super Admin) or **Reject** with a reason that is e-mailed to the applicant |
| **Companies** | per-tenant counts (users, projects, marks, last activity) · **Open sheet** (returns the workbook link to the owner only) · suspend with a reason (login blocked, data preserved) · reinstate · change plan tier |
| **Triggers** | Install / remove the five scheduled jobs, see what is registered |
| **Properties** | read the whitelisted script properties, set `OWNER_EMAIL`, `DEV_MODE`, WhatsApp keys, etc. — no secret values are ever echoed back |
| **Audit** | the platform log: who signed up, who approved what, bootstrap runs, trigger installs |

**Operating rules**

1. Approve only after checking GST number, address and contact e-mail; the workbook is created in
   your Drive, so an approved tenant consumes your quota.
2. Suspensions are reversible; a `Closed` company is not. Prefer suspend → investigate → reinstate.
3. Rejecting leaves the request row for the record; the applicant may submit a new request.
4. Never put the owner key into `config.js` in a published build. If it leaks, re-run
   `setupScript()` to rotate it (this also rotates `TOKEN_SECRET`, signing everyone out).
5. Weekly: skim **Overview** for pending requests (each also arrives by e-mail to `OWNER_EMAIL`).

---

## 12. Super Admin — the company owner's console

Sign in at `?page=login` (e-mail or user ID + password, or mobile + OTP). The staff console
(`?page=app`) sidebar is one screen per job:

**Dashboard** → today's numbers per project (expected / present / late / half-day / leave /
absent / flagged / not-yet-marked), the live ticker of marks as they arrive, quick links to
whatever needs attention. If it says `Setup incomplete`, finish the wizard before anything else —
attendance rules are read from company settings, and defaults are deliberately strict.

**Live site map** → the map with a pin per project and a dot per worker inside the fence, with
the selfie and distance in the popup. Tiles come from OpenStreetMap; if a site office blocks the
tile CDN the panel degrades to coordinate cards with Google-Maps deep links, so the information
is never lost. Above the map sits the **site weather strip**: today's rain and peak temperature per
active site from Open-Meteo, and when a site crosses `rainThresholdMm` / `heatThresholdC` a
supervisor can stamp that flag onto the day's marks in one click (the same call the 05:00 trigger
makes — see chapter 8).

**Attendance** → day grid + per-person list, filters by project/date/status, and three
corrections: **Review** a flagged mark (approve → keeps, reject → voids), **Manual mark** (needs
`reviewAttendance`; source recorded as `Manual` and audit-logged), **Regularization** decisions.

**Approvals** → one queue for leave, expenses (with the receipt image inline), site transfers,
flagged marks, regularization requests and device changes. Every decision notifies the requester
and writes an audit row. Nothing here is auto-approved.

**Projects** → create/edit sites, geofence radius, windows, shift, client & PMC (printed on
exports). Opening a project shows the assignment table *and* an **On site today** roll-up (who is
inside the fence, who has not marked yet, coverage %), a **Set status** button (`Active`, `OnHold`,
`Completed` — the three values `setProjectStatus` accepts; Completed also closes the end date), and
the QR check-in block: **Print-ready QR** opens a full sheet (project name, code, scannable square)
and **New code** rotates it, which is what you do when a contractor's phone is being used to mark
from far away — old prints stop working immediately.

**Employees** → the roster, roles, designations, salary (daily wage or monthly), reporting line,
permissions, project scope, status, password reset.

**Devices** → the registry behind that roster: every browser/phone bound to an account, its masked
fingerprint, last use, and login count. Filter by `PendingChange` in the morning and approve the
new phones in one pass; **Block** writes the reason to the audit log, sets the user's device status
to `Blocked` and notifies them, so attendance from that handset stops until you unblock it. A lost
phone that is not blocked here is the hole most site setups leave open.

**Leave / Expenses / Transfers** → each list is filterable and shows pending decisions on top. A
worker sees **Cancel** on their own not-yet-decided leave; an approver can cancel on their behalf
(`cancelLeave` marks it `Cancelled`, it is never deleted). Once a decision exists the cancel button
is gone — reject or correct the day instead.

**Documents** → the vault per worker: type, file, expiry date, alert window; statuses
`Valid` → `ExpiringSoon` → `Expired` drive the daily 07:00 reminder.

**Reports** → 9 report types with an on-screen grid, Print, and `.xlsx` / `.pdf` / `.csv`
export. Each export writes `EXPORT_REPORT` to the audit log and a copy into the company's
`Exports` Drive folder.

**Payroll** → the wage sheet for a month (chapter 20), with payout confirmation per employee.

**Audit log** → every privileged action: actor, role, target, result, timestamp, plus the
`Details` JSON. Filterable; exportable as a report.

**Settings** → 43 keys in seven groups — Company · Attendance rules · Geofence & GPS ·
Notifications · Reports & branding · Calendar & shifts · Data & retention (chapter 23 lists every
key). Changes take effect at the next mark, not retroactively.

**My profile** → name, phone, address, emergency contact, weekly off, bank details, language,
theme, password change, and the device you are bound to. **Edit my details** saves through
`updateMyProfile` (only the fields you actually change are sent; bank fields stay readable by you
and Super Admins). **Register this browser/phone** files a device-change request for the machine
you are on — the desktop equivalent of signing in from a new handset.

---

## 13. Admin and Sub-Admin — the permission matrix

A **Super Admin** holds all 23 permissions. An **Admin** holds these by default:
`createProjects, editProjects, createEmployees, editEmployees, approveLeave, approveExpense,
approveTransfer, reviewAttendance, approveRegularization, viewReports, exportReports,
manageVendors, manageDocuments, viewAllEmployees, runPayroll`.

A **Sub-Admin** starts empty: tick exactly what the person needs, then set a project scope
("ALL" or a chosen list). **Scope always wins over `viewAllEmployees`** — the flag widens which
*fields* they see inside their scope, never which projects. Both checks run on the server: hiding
a button in the UI is cosmetic, `403 Not permitted` from the API is the real gate.

| If someone is… | Give them |
|---|---|
| Site engineer, marks + watches their team | `reviewAttendance`, `viewReports` + scope = their project |
| HR, handles leave and documents | `approveLeave`, `manageDocuments`, `manageHolidays`, `manageShifts`, `viewAllEmployees` |
| Accounts, money only | `runPayroll`, `viewReports`, `exportReports`, `approveExpense` |
| Admin-in-training | Admin defaults minus `manageSettings`, `manageGeofence`, `manageAdmins` |
| Nobody on payroll | never `runPayroll` — payslips expose wages |

Three permissions are dangerous and default off for everyone below Super Admin: `manageAdmins`
(lets a user change other users' roles — the only path to privilege escalation), `manageGeofence`
(moves the fence that validates attendance) and `viewAuditLog`. `deleteProjects` exists for
cleanup; prefer status `Closed`, which keeps history intact.

Grant via **Employees → user → Permissions** (the toggles are saved with `setUserPermissions`).
Re-check grants after anyone leaves: the context (role, permissions, project scope, account
status, company status) is re-read from the company sheet on **every** request, so revoking a
permission or deactivating an account bites on the next click — no logout required.

---

## 14. Worker: the mobile PWA

For site staff — supervisor, mason, electrician, helper. It is one page, five tabs
(**Home**, **Mark**, **History**, **Requests**, **More**), and it works in Hindi:
More → Language → हिंदी. Everything the worker needs is on one screen; nothing is admin-only.

**First use**

1. Open `?page=mobile` (or the installed icon), enter the mobile number given by the office and the
   temp password — or press **Send OTP** and sign in with the 6-digit code, no password needed.
2. This first sign-in **binds the device** (a fingerprint of browser + screen + timezone). A new
   phone is refused for attendance until an admin approves the change request the app files for
   you.
3. Allow **location** and **camera** when Chrome asks. Without them the app cannot verify where
   you are.

**Marking attendance**

* The Mark tab lists the projects you are assigned to. Pick one; the app waits for a GPS fix
  (up to 20 s) and shows the distance to the site.
* **Check in** takes a live selfie (`getUserMedia`, no gallery access, captured at
  640 px / quality 0.72) and submits. Green = **Present**; inside the grace window after the
  cutoff = **Late**; outside the fence or the window = **Flagged**, and your supervisor sees why.
* **Check out** computes hours; beyond `standardHours` it becomes overtime at the configured
  multiplier, and the day may auto-close at the end of the window if you forget.
* **Half day** is derived from hours when they fall under `halfDayHours`; you do not tick it.
* **No network at the site?** The mark is stored on the phone with its captured timestamp and
  replayed when you reconnect — the server validates the *captured* time, so an offline mark is
  neither lost nor late-adjusted by a 3-hour sync delay. A badge shows the pending count; tap it
  to force a sync.
* **Indoor site, GPS useless?** Scan the project QR printed at the gate — same check-in, source
  `QR`, and the fence is checked against the QR's validity, not your coordinates.

**Requests tab** → leave (type + dates + reason), expense (amount, category, receipt photo),
site transfer, and **regularization** for a day you forgot to mark (propose the status and the
in/out times, add the reason your supervisor will read). Every request shows Pending / Approved /
Rejected / Cancelled with the reviewer's note, and a pending leave carries **Cancel** so a mistake
can be withdrawn without messaging the office. Regularizations are listed for the worker who raised
them, queue for everyone else — the same action, scoped by role.

**History** → the month grid with the same codes your payroll uses (P, L, H, A, LV, SL, CL, T,
TR, HD, WO, F) and per-day detail: time, distance, selfie, hours, overtime, source, reviewer note.

**More** → notifications, your documents (with expiry), the sub-vendor headcount log, language,
theme, the **install** prompt ("Add to Home screen" gives the standalone app with the offline
cache), **My profile** (name, address, emergency contact, weekly off — self-service through
`updateMyProfile`), and **Request device change**. When the phone you are holding is blocked or
awaiting approval, a red card at the top says so and files the request in one tap; the app tells
you plainly that marking stays disabled until an admin clears it.

**Home** → today's assignments with their mark (or the reason you are still unmarked), the pending-
sync badge, and a ↻ that refetches only today's rows (`myAttendanceToday`) — on a weak site network
that is a third of the bytes of a full profile refresh.

**What a worker can never do:** see another worker's attendance, open the roster, read wages,
upload a fake photo, or edit a submitted mark — corrections always go through an approval.

---

# PART III — HOW THE SYSTEM DECIDES

## 15. The attendance engine

Every mark — from a phone, a QR scan, an offline queue or an admin's manual entry — goes through
the same rule set in `evaluateMark_()` (`backend/09_Attendance.gs`). Nothing is trusted because
of where it came from.

### 15.1 The seven checks

| # | Check | Rule | Fails as |
|---|---|---|---|
| 1 | Coordinates present | lat/long must exist and not be 0,0 | 400 rejected |
| 2 | Geofence | Haversine distance ≤ project `GeofenceRadius` (else company `defaultGeofenceRadius`, 200 m). QR marks use `max(radius, qrFallbackRadius)` | Flagged |
| 3 | Window open | mark time ≥ `attendanceWindowStart` (project `WindowStart` wins) | Flagged |
| 4 | Before cutoff | ≤ `attendanceWindowEnd` → Present; within `lateGraceMinutes` after it → **Present + Late**; later | Late / Flagged |
| 5 | GPS quality | `accuracy` ≤ `maxGpsAccuracy` (500 m default) | Flagged |
| 6 | Selfie | `requireSelfie:'Y'` and a photo attached (QR marks exempt) | Flagged |
| 7 | Duplicate | one open mark per user per project per day | politely refused, `alreadyMarked:true` |

A **Flagged** row is still written — the day is not lost, it just needs a decision. The reason
string ("Outside the site geofence — 1 842 m from the site (limit 200 m)") is stored on the row,
shown to the reviewer, and visible to the worker in History.

### 15.2 Status → monthly code

| Status | Code | Counts as payable | Meaning |
|---|---|---|---|
| Present | `P` | yes | on site, in the window |
| Present + late | `L` | yes | marked after cutoff, inside grace |
| HalfDay | `H` | 0.5 | hours under `halfDayHours` (auto-derived on mark-out) |
| Leave | `LV` | yes | approved paid leave |
| Sick / Casual leave | `SL` / `CL` | yes | approved by type |
| Unpaid leave | `UL` | no | LOP day |
| Travel / Transfer | `T` / `TR` | yes | on company business / moved site |
| Holiday | `HD` | `paidHolidays` | from the holiday calendar (project-aware) |
| WeekOff | `WO` | no | company `weeklyOff` or the user's own day |
| Absent | `A` | no | no mark, and the 23:00 close job recorded it |
| Flagged | `F` | no, until reviewed | a check failed and nobody has decided yet |

Future dates are never auto-marked, and the summary shows them with an empty code.

### 15.3 Mark-out, hours and overtime

* `markOut` accepts the current position; the out-time is the server clock, the out-geofence is
  checked but a mismatch only annotates the row (leaving site early is a management question, not
  a GPS one).
* `hoursWorked = out − in − break` (break is subtracted only for days over 4 h, `breakMinutes`
  default 0).
* Under `halfDayHours` (4) the status becomes **HalfDay** automatically. Beyond
  `overtimeAfterHours` (9) the excess is overtime, **rounded to half-hour steps**, paid at
  `overtimeRate` (1.5× the per-day rate ÷ `standardHours`). A computed span over 24 h is treated
  as a clock anomaly and zeroed for an admin to correct rather than paid out.
* Forget to mark out? The day keeps its in-time with **no** out-time, so hours stay empty and
  the payroll row shows the day as present but unpaid-hours-zero. The 23:00 close job only fills
  rows for people with **no** record at all (Absent, or Holiday/WeekOff when the calendar says so,
  `Source:System`) — it never invents an out-time. Fix it with **manual mark-out** (Attendance →
  the day → Manual mark) or let the worker raise a regularization.

### 15.4 Offline and QR paths

* **Offline** — captured with its own timestamp, queued under localStorage
  `sitetrack.offlineQueue`, replayed with the same geofence/window/selfie checks against the
  *captured* time. Marks older than `offlineMaxAgeHours` (26) are rejected rather than trusted.
  Device clock drift is defended against: the server compares the captured time with the sync
  time and flags a suspicious gap.
* **QR** — the printed code carries `SITETRACK|<companyId>|<projectId>|<challenge>`. Scanning it
  proves presence at the office rather than via GPS, so the geofence check is widened to
  `qrFallbackRadius` (1 000 m) and no selfie is demanded. Source is recorded as `QR` everywhere,
  including exports, so auditors can distinguish it.
* **Regularization** — for a day that cannot be fixed by either path, the worker raises a request
  (proposed status + in/out times + reason); it lands in the approvals queue and, when approved,
  rewrites the day with `Source:Manual` and the reviewer as `ReviewedBy`.

### 15.5 Device binding and anti-proxy rules

One fingerprint per worker (`DeviceRegistry`). A new phone writes a **device change request** and
attendance is refused until an admin approves it (`approveDeviceChange`) or the request is
rejected; a `Blocked` device is refused with no further path. The fingerprint is a hash of browser
+ screen + timezone, so it survives an app update but not a different handset. Turning
`requireDeviceBinding:'N'` removes this protection — do it only where phones are shared and
supervisor-verified.

---

## 16. Requests and approvals

Everything a worker can ask for, and what happens when it is decided.

| Request | Fields | On approve | On reject |
|---|---|---|---|
| **Leave** (`requestLeave`) | type (Paid/Unpaid/Sick/Casual/HalfDay/WeekOff), from, to, reason | days become `LV`/`SL`/`CL`/`UL` in the grid, balance updated, worker notified | status `Rejected` + note; days revert to whatever was marked |
| **Expense** (`requestExpense`) | amount, category (Travel/Food/Labour/Material/Fuel/Loading/Tools/Medical/Misc), description, receipt file, `ReceiptNo` | counted into payroll (`expenseAmount`), `PayoutStatus:Pending` until marked paid | row kept for the record, nothing pays out |
| **Site transfer** (`requestTransfer`) | from project, to project, effective date, travel paid, reason | the **assignment moves** on the effective date, so the next day's "expected" count is right at the new site | assignment untouched |
| **Regularization** (`requestRegularization`) | date, requested status, in/out times, reason | attendance row rewritten, `Source:Manual` | original (missing/absent) row stands |
| **Device change** (`requestDeviceChange`) | new fingerprint + label | old device unbound, new one bound | new device stays blocked |
| **Flagged mark** (`reviewAttendance`) | approve / reject + note | the day counts, status set to what you approve (Present/HalfDay/…) | the day becomes `Absent`, the flag reason stays in the trail |

A request that has already been decided returns **409 “This request was already approved”**, so two
admins cannot pay the same claim twice.

Approving is idempotent-safe: a second decision on the same row returns 409, so two admins cannot
double-pay. Every decision writes `Notification` rows for the requester and an `AuditLog` row with
the actor, target and result.

**Expense proof**: with `expenseProofRequired:'Y'` a receipt file is mandatory; the proof is
stored in the company's `Expenses` Drive folder and is only readable through `getFile` by people
who can see the expense.

---

## 17. Sub-vendor manpower

Vendors are the labour contractors you pay by head-day. `saveVendor` keeps name, contact person,
mobile, GST, the projects they serve, `RatePerHead` and payment terms.

`addVendorWorkerEntry` is what a supervisor does at the gate: vendor + project + date + worker
name (+ mobile, designation, count). Entries are per worker per day, so **Attendance** (your
staff) and **VendorWorkers** (their staff) never mix — a contractor's worker gets no login, no
device binding and no payroll row, only a headcount that feeds money.

* **Vendor manpower report** (`vendorManpowerReport`, needs `viewReports`) — per vendor: man-days,
  amount payable, per project, for a date range.
* **Payroll fold-in** — `generatePayrollSheet { includeVendorLabour:true }` adds the month's
  vendor labour to `grandTotal`, so one sheet shows what leaves the bank for staff *and*
  contractors.
* Settle a vendor by exporting the manpower report to `.xlsx`; there is no payment state on a
  vendor entry by design — approval of the sheet is the approval of the bill.

---

## 18. Documents and expiries

`uploadDocument` (any signed-in user for themselves; staff for anyone) stores the file in the
company `Documents` Drive folder — never public — with type, expiry date and an alert window
(`ExpiryAlertDays`, default 15).

Statuses are computed, not stored: `Valid` → `ExpiringSoon` (inside the alert window) → `Expired`.
The 07:00 job sends one reminder per document per day to the owner and to staff with
`manageDocuments`. Types available: AadhaarCard, PANCard, VoterID, DrivingLicense, BankPassbook,
SafetyCertificate, MedicalFitness, SkillCertificate, InsurancePolicy, WorkPermit, Photo, Resume,
Other.

Compliance loop that actually closes: worker sees the alert in the app → uploads the renewed copy
→ the row's expiry date updates → the alert stops. Deleting a document (staff, `manageDocuments`)
removes the sheet row and trashes the Drive file; the audit row survives.

---

## 19. Reports and exports

Nine report types (`generateReport`), all filtered by month *or* from/to, by project and by
employee, and always narrowed to the caller's scope:

| Type | Answers | Key columns |
|---|---|---|
| `monthlyAttendance` | the whole company's grid for a month | one column per day with the codes, then Present/Absent/HalfDay/LOP totals |
| `employeeHistory` | one person's day-by-day story | date, project, in/out, hours, OT, distance, source, status, note |
| `dailyAttendance` | who was on site on one date | per project: name, in-time, late, hours, selfie, status |
| `leaveSummary` | balances and history | by person and type, pending vs decided |
| `expenseSummary` | money claimed | by person, category, status, payout status |
| `vendorManpower` | contractor head-days | by vendor, by project, rate, amount |
| `projectSummary` | per-site totals | headcount, present %, flagged, hours, OT |
| `flagged` | everything needing a decision | reason, distance, age of the mark |
| `payroll` | the wage sheet (chapter 20) | see below |

Every report renders with the **site-address block** (company name, GST, address, logo when
`reportIncludeLogo:'Y'`, client/PMC when `reportIncludeClientPmc:'Y'`, `reportFooterText`),
because a printout without that block is not evidence of anything.

**Export** (`exportReport`, needs `exportReports`) → `xlsx`, `pdf` or `csv`:

1. a temp spreadsheet is built inside the deployment's own Drive,
2. exported with the matching MIME type, then the temp file is trashed,
3. the bytes come back base64 and the browser downloads them, so nobody needs Drive access,
4. the copy is filed in the company's `Reports` Drive folder, and
5. `EXPORT_REPORT` is written to the audit log with who, what and when.

Print straight from the screen (Reports → **Print**) whenever Google's export endpoint is having a
bad day — the tables are the same data, rendered client-side.

---

## 20. Payroll

One call, `generatePayrollSheet { month, projectId?, includeVendorLabour?, advances? }`, needs
`runPayroll`. It re-derives everything from the *current* attendance, leave and expense rows — so
it is always re-runnable, and correcting a day then re-running the sheet is the normal workflow.

```
perDayRate  = assignment dailyWage            (daily worker)
            = user dailyWage                  (fallback)
            = monthlySalary ÷ payrollDaysBasis (monthly worker, default ÷ 26)

payableDays = present + late
            + 0.5 × halfDays
            + paidLeave + sickLeave + casualLeave
            + travel + transfer
            + holidayDays × (paidHolidays = 'Y' ? 1 : 0)

lopDays     = unpaidLeave + absent
earned      = monthly ? (monthlySalary ÷ calendar days in month) × payableDays
              : perDayRate × payableDays
overtime    = overtimeHours × perDayRate ÷ standardHours × overtimeRate
expenses    = Σ approved expense amounts claimed in that month (this project)
NET PAYABLE = earned + overtime + expenses − advance
```

Notes that matter in practice:

* **Super Admins are excluded** from the wage sheet on purpose — owners pay themselves elsewhere.
* A row appears only if it has activity or an assignment, so the sheet is not padded with zeros.
* `advances` is a `{ userId: amount }` map you pass at run time; it is not stored on the worker,
  which keeps one-off deductions out of the master data.
* `lopDeduction` is reported next to `lopDays` as the visible "what the absence cost" figure; the
  arithmetic itself is already inside `earned`, because earned is paid on **payable** days.
* Monthly staff are prorated on **calendar days** (`monthBounds_`), which is the standard
  "salary ÷ days in month × days present" contract; if your payroll deed uses a fixed 26-day
  month for the *numerator* too, set `payrollDaysBasis` accordingly and use the daily path.
* **Confirm payout** is the same call with `confirmPayout:true` — it stamps `PAYROLL_PAYOUT_CONFIRMED`
  in the audit log with the employee list, the month and the net total, and returns
  `payoutConfirmed:true`. Sheet + audit row together are your proof of payment; there is no bank
  integration and there never will be one in a spreadsheet product.
* `paidHolidays:'N'` removes holidays from payable days — the switch is in Settings → Rules and
  takes effect on the next run, not retroactively.

---

# PART IV — TROUBLESHOOT, CONFIGURE, REFER

## 21. Troubleshooting matrix

### 21.1 During installation

| Symptom | Real cause | Fix |
|---|---|---|
| `?action=ping` returns a Google sign-in HTML page | deployed with *Anyone with a Google account* instead of *Anyone* | Manage deployments → edit → **Who has access: Anyone** → New version |
| `ping` answers but `"configured": false` | bootstrap never ran | run `setupScript()` once in the editor |
| `Setup script failed: …` at first run | scopes not authorised yet, or the master sheet could not be created (quota/permission) | run any function once manually to complete the consent flow, then re-run `setupScript()` |
| Frontend shows “Cannot reach SiteTrack API” | `API_URL` empty/typo, or the deployment was never re-versioned after a change | `curl '<API_URL>?action=ping'` from a terminal; fix `config.js`; publish |
| 401 on every action after a code change | you re-ran `setupScript()` and rotated `TOKEN_SECRET` | expected — sign in again; do not rotate secrets on a live system |
| Signup page: “Mobile number verification is required” | the OTP expired (600 s) or the code was mistyped | resend; with `DEV_MODE=true` the code is echoed in the response for testing |
| No e-mails arrive | Gmail sending quota, or the OAuth consent was not granted for `send_mail` | check the execution log for `MailApp` errors; authorise; keep `OWNER_EMAIL` valid |
| `installTriggers` reports errors | the `scriptapp` scope was refused | Project settings → change scope → re-run |
| Health check `CompanySheetsReachable:false` | a company workbook was deleted or moved out of the deploying user's Drive | restore it, or mark the tenant `Closed` in the registry |

### 21.2 In daily use

| Symptom | Cause | Fix |
|---|---|---|
| Worker gets “Outside the site geofence” at the gate | coordinates fine but radius too tight for that entrance, or the pin is on the wrong building | measure once from the gate, then update the radius (needs `manageGeofence`, audit-logged) |
| “GPS accuracy too poor (±78 m)” | indoor/urban-canyon fix | use the QR check-in at the office, or raise `maxGpsAccuracy` for that site |
| “Marked after the window closed” | genuine late arrival, or the window doesn't match the shift | raise `lateGraceMinutes`, or set the project's own `WindowStart/End` per shift |
| “A live selfie is required” but the camera showed | camera permission denied, or the phone produced HEIC | Chrome → site settings → allow camera; retake in Chrome (JPEG) |
| “This entry is older than 26 hours…” | offline too long | the worker raises a **regularization**; admin approves |
| “The captured time is in the future” | phone clock is ahead (auto-time off) | fix the device clock; the mark is refused on purpose |
| New phone: attendance refused | device binding, by design | Approvals → Device changes → approve (or block) |
| Mark stuck in the queue (badge never clears) | the payload is invalid, so the server keeps rejecting it | open the badge → the item shows the server message; fix via regularization or correct the settings |
| Map shows pins but no tiles | the site blocks the OSM tile CDN | nothing to do — the coordinate cards + Google-Maps links still work; or set `MAP_TILE_URL` to a reachable tile server |
| Export fails with 502 | Google's export endpoint hiccup | Reports → **Print** → Save as PDF (same data, client-side) |
| Payroll total looks wrong for one person | an unreconciled Flagged day, or leave approved after the sheet was generated | re-run the sheet — it recomputes from live rows; only confirm payout after the flagged count is 0 |
| A worker's monthly grid shows `A` for a day they worked | no mark and the 23:00 job closed it | manual mark or approved regularization; the row keeps `Source:Manual` so it is visible in the audit |
| Someone cannot see a project in their dropdowns | their scope excludes it | Employees → scope; remember scope beats `viewAllEmployees` |
| Session dies mid-shift | 12 h token TTL, by design | sign in again; the offline queue is unaffected |

### 21.3 Escalation: reading the real state

1. `GET <API_URL>?action=health` — three checks, all must be `ok:true`.
2. Apps Script editor → **Executions** — the failing run, its 500 message and stack.
3. Owner panel → **Audit** for platform actions; **Audit log** in the company console for tenant actions
   (`action`, `Actor`, `Target`, `Result`, `Details` JSON).
4. For a reproducible bug, run the suite locally: `npm run dev` reproduces the same backend code on
   Node polyfills — `npm test` first tells you whether it is your data or the code.

---

## 22. Error-message glossary

Verbatim strings the API returns, what they mean, and who fixes it.

| Message (code) | Meaning | Who acts |
|---|---|---|
| `Not permitted` (403) | the permission tick for this action is missing | Super Admin grants it |
| `This action is restricted to administrators` (403) | a worker called a staff action | nobody — UI bug, report it |
| `This project is outside your assigned scope` (403) | user is not attached to that project | assign them |
| `You may only access your own record` (403) | workers can read only themselves | correct by design |
| `Authentication required` / `Session expired or invalid. Please sign in again.` (401) | no or stale token | sign in |
| `This session was signed out. Please sign in again.` (401) | token blacklisted by logout/rotation | sign in |
| `Account is not active` / `This account is inactive.` (403) | status is not `Active` | admin re-activates |
| `This company account is suspended.` / `Your company account is suspended: <reason>` (403) | owner suspended the tenant | owner reinstates |
| `No account found for those sign-in details.` (404) | identifier unknown to every tenant | check e-mail/mobile/user ID |
| `Incorrect password. Please try again.` (401) | password mismatch | reset via `resetUserPassword` |
| `That OTP is incorrect or has expired. Request a new one.` (401) | login OTP stale | resend |
| `That verification code is incorrect or has expired. Request a new one.` (400) | signup OTP stale | resend |
| `Too many OTP requests. Try again in 5 minutes.` (429) | rate limiter (5 per 5 min) | wait |
| `Too many sign-in attempts. Try again in a minute.` (429) | login limiter (8 per min) | wait |
| `Missing required field(s): x, y` (400) | payload validation | fix the call/form |
| `A signup request for this e-mail is already pending review.` (409) | duplicate signup | owner rejects one |
| `This e-mail is already registered as a Super Admin. Please sign in instead.` (409) | existing tenant owner | sign in |
| `This request was already approved` (409) | double decision | nothing — idempotency guard |
| `An overlapping leave request already exists (…)` (400) | date clash | cancel the first |
| `Outside the site geofence — N m from the site (limit R m)` (in the flag reason) | distance rule | review or widen the radius |
| `Platform Master Sheet is not configured. Set Script Property PLATFORM_MASTER_ID or run setupScript().` (500) | bootstrap missing | run `setupScript()` |
| `Unknown action: xyz` (404) | wrong `action` name (see `docs/API.md`) | fix the caller |
| `Action handler not available: xyz` (501) | the router names a function that no `.gs` file defines | restore the backend file, redeploy a new version |

---

## 23. Settings reference (43 keys)

Stored in each company workbook's `Settings` tab as Key/Value. The form is
**Settings → Company · Attendance rules · Geofence & GPS · Notifications · Reports branding ·
Calendar & shifts · Data & retention** (needs `manageSettings`; the geofence/window keys inside
those tabs additionally need `manageGeofence`), and every save is audit-logged with the changed
keys. Only three operational keys are API-only, marked ◐ below — set them with `saveSettings`.

| Key | Default | Effect |
|---|---|---|
| `companyName`, `companyAddress`, `gst`, `industryType` | from signup | report header block |
| `companyLogoLink` | — | logo on exports (`reportIncludeLogo`) |
| `timezone` | `Asia/Kolkata` | all timestamps, windows and the day boundary |
| `defaultGeofenceRadius` | 200 m | used when a project sets no radius |
| `attendanceWindowStart` / `attendanceWindowEnd` | 06:00 / 11:00 | mark-in window (a project's own window overrides) |
| `cutoffTime` ◐ | 11:00 | the headline deadline shown in apps and mails; the engine enforces `attendanceWindowEnd` + grace |
| `outWindowStart` / `outWindowEnd` | 16:00 / 23:59 | mark-out window |
| `lateGraceMinutes` | 15 | Present+Late band after the window closes |
| `standardHours` / `halfDayHours` / `overtimeAfterHours` | 8 / 4 / 9 | day length, half-day cut, OT start |
| `overtimeRate` | 1.5 | OT multiplier (1–5) |
| `breakMinutes` ◐ | 0 | subtracted from hours when the day exceeds 4 h |
| `workingDays` | `1,2,3,4,5,6` | 0=Sun … 6=Sat; drives "expected today" |
| `weeklyOff` | `0` | company default week-off; a user's own `WeeklyOff` wins |
| `requireSelfie` | `Y` | selfie mandatory (QR exempt) |
| `requireDeviceBinding` | `Y` | one handset per worker, change needs approval |
| `allowQrFallback` | `Y` | QR check-in permitted |
| `qrFallbackRadius` | 1000 m | geofence used for QR marks |
| `maxGpsAccuracy` | 500 m | worse fix than this is flagged |
| `offlineMaxAgeHours` | 26 | how old an offline mark may be |
| `gpsRetentionMonths` | 12 | then raw coordinates are purged |
| `autoRainDayFlag` + `rainThresholdMm` + `heatThresholdC` | `N` / 20 mm / 45 °C | weather job flags (needs `WEATHER_ENABLED=true`) |
| `notifyOnFlagged` / `notifyChannel` | `Y` / `Email` | alerts on flags; `Email`, `WhatsApp`, `SMS` |
| `reportFooterText`, `reportIncludeLogo`, `reportIncludeClientPmc` | see defaults | export appearance |
| `autoMonthlyReport` | `Y` | skip this tenant in the 1st-of-month job when `N` |
| `reportRecipients` | — | extra comma-separated inboxes for the monthly report |
| `paidHolidays` | `Y` | holidays in payable days |
| `payrollDaysBasis` | 26 | monthly salary ÷ N = per-day rate |
| `currency` | `INR` | number/currency formatting everywhere |
| `expenseProofRequired` | `N` | receipt mandatory on claims |
| `projectCodePrefix` ◐ | — | default project code prefix (`PRJ` if blank) |
| `setupCompleted` | `N` | only `completeSetupWizard` writes it |

---

## 24. Data model

**Platform Master (4 tabs)** — `CompanySignupRequests` (application + OTP flag + review),
`CompanyRegistry` (tenant → workbook id, Drive folder, plan, status, counts, last activity),
`LoginIndex` (identifier → company, the fast lookup that makes tenant resolution one read),
`PlatformAuditLog` (bootstrap, approvals, suspensions, property changes).

**Each company workbook (17 tabs)**

| Tab | One row is… | Written by |
|---|---|---|
| `Settings` | a Key/Value pair | wizard, settings form |
| `Users` | a staff/worker account (role, permissions, wage, device status) | admin CRUD |
| `Projects` | a site (GPS lock, radius, windows, client/PMC, QR) | admin |
| `ProjectAssignments` | a worker on a site between dates | assign / transfer |
| `Attendance` | one person, one project, one day (in/out, distance, selfie, status, source) | engine + jobs |
| `LeaveRequests` / `ExpenseRequests` / `SiteTransfers` / `RegularizationRequests` | a pending or decided request | workers + approvers |
| `Vendors` / `VendorWorkers` | a contractor / their head-day entry | admin + supervisor |
| `Holidays` / `Shifts` | a calendar day off / a shift definition | admin |
| `Documents` | an uploaded file + expiry | workers + admin |
| `Notifications` | an inbox message with read flag | every decision + jobs |
| `DeviceRegistry` | a device per user, with pending/blocked state | login + approvals |
| `AuditLog` | every privileged action | all writers |

Three rules keep this safe to touch by hand in an emergency: headers map columns by **name**
(so rows can be sorted or filtered freely), **do not rename or delete header cells**, and any
manual edit will be reflected in the next report — the audit log will not show it, which is why
the sanctioned path is always a UI action.

---

## 25. Roles, permissions and the security envelope

| Permission | Unlocks |
|---|---|
| `createProjects` `editProjects` `deleteProjects` | site CRUD (delete prefers `Closed` status) |
| `createEmployees` `editEmployees` `deactivateEmployees` | roster and assignment changes |
| `manageAdmins` | change roles/permissions of others — **escalation risk**, Super Admin only |
| `approveLeave` `approveExpense` `approveTransfer` `approveRegularization` | the four queues |
| `reviewAttendance` `manageGeofence` | mark corrections / moving the fence that validates marks |
| `viewReports` `exportReports` `runPayroll` | reporting and money |
| `manageVendors` `manageDocuments` `manageHolidays` `manageShifts` `manageSettings` | the rest of the console |
| `viewAuditLog` `viewAllEmployees` | audit trail / wages + contact details of everyone |

**How a request is decided** (in order, `04_Router.gs`): rate limit → token → role (`staff` gate)
→ permission → project scope → action-specific check → handler. Then `maskUser_` strips
`PasswordHash`, `OtpHash`, `OtpExpiry` for every caller and hides `BankAccount`, `IfscCode`,
`IdProofMasked`, `MonthlySalary`, `DailyWage` from anyone without `viewAllEmployees` (or their own
record). Files are `PRIVATE` in Drive and only readable through `getFile`, which re-checks that the
caller can see the record that references the file. Passwords are `salt$sha256`; sessions are
stateless HMAC with a 12 h TTL and a logout blacklist.

---

## 26. FAQ

**Can a worker fake the location?** Not from the browser: the geofence, the GPS accuracy ceiling and
the time window are all enforced server-side, a mark needs a live camera frame, and the device is
bound. A rooted phone lying about location is a physical-security problem, which is what the QR
at the gate and the supervisor's live map are for.

**What if 400 workers mark at 09:00 exactly?** Each request is independent; Apps Script queues
executions (up to 30 concurrent, 250 waiting). Beyond that the browser retries, and the worker app
keeps the mark in its queue, so nobody loses a day. If a site is chronically at the limit, stagger
two windows by project (06:00–10:00 and 08:00–12:00).

**Can two companies share a Google account?** Yes — that is the design: one deployment, one master
sheet, one workbook per tenant, and the token decides which workbook a caller can open.

**Is the data really only in my account?** Yes — the frontend is served *from* your own Apps
Script deployment (the only server), the data lives in your Sheets and Drive, and the only
third-party calls are
the optional weather/geocode lookups (no coordinates are sent to them, only lat/long of a *site*
for weather).

**What happens when we outgrow Sheets?** The schema is plain tables, so `Attendance`, `Users`,
`Projects` etc. export 1:1. Rewrite `02_Store.gs` (spreadsheet I/O) against SQL and `03_Security.gs`
if you want real sessions; the router, the engine and the whole frontend stay untouched — that is
why the layering in `docs/ARCHITECTURE.md` keeps all sheet reads inside one module.

**Can I run two script projects (dev + prod)?** Yes, and you should: keep `DEV_MODE=true` on the
dev project, point a copy of `config.js` at each URL, and never bootstrap the production project
from a laptop that also holds clasp credentials for dev.

**How do I test an attendance edge case without a phone?** `npm run dev` → the harness's
`/api` proxy runs the real backend; set the project window around "now", then
`curl -s -X POST -d '{"action":"markAttendance","payload":{…}}' localhost:8080/api`.
`docs/API.md` has every payload.

**Where are my secrets if I lose the owner key?** Nowhere retrievable — that is the point. Run
`setupScript()` again to generate a new pair (invalidates all sessions), then update `config.js`.

---

## 27. Glossary

| Term | Meaning in this product |
|---|---|
| **Tenant / company** | one workbook + one Drive folder, addressed by `CMP-…` id |
| **Owner / Platform Owner** | you, the operator; keyed by `OWNER_KEY`, not a user row |
| **Super Admin / Admin / Sub-Admin** | company roles; Sub-Admin = permissions + project scope |
| **Employee / worker** | the site staff who mark attendance; mobile PWA only |
| **Geofence** | the radius around a project's locked GPS point that a mark must fall inside |
| **Cutoff / grace** | last minute a mark counts as on-time, and the late band after it |
| **Flagged** | written but not trusted — sits in Approvals until a human decides |
| **Regularization** | a worker's request to fix a day they could not mark |
| **Binding / device change** | one handset per worker, and the approval to move to a new one |
| **LoginIndex** | platform-side map from mobile/e-mail/user ID to the owning tenant |
| **Wage sheet** | the payroll output: days → payable days → earned + OT + expenses − advance |
| **Audit row** | the immutable record of a privileged action: actor, role, target, result, details |
| **`Source`** | how a mark arrived: `GPS`, `QR`, `Manual`, `Offline`, `System` |

---

*End of the guide book.* Nothing in this product is hidden behind a support ticket: the backend is
23 files of readable Apps Script, the frontend is 16 plain HTML files served by that same project,
and `npm run check` re-proves the whole contract in about two seconds.
