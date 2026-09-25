# SiteTrack — site attendance & workforce management on Google Apps Script + Google Sheets

**One Google Apps Script project.** Backend, API and the complete frontend (every page, both
sign-in portals, the employee app and the platform admin panel) are served from a single
`/exec` Web App URL. **One Google Sheet** (your own) is the database. There is no other service,
no third-party backend, no external host, no npm dependency and no build step.

| Layer | Technology | Cost |
|---|---|---|
| Database | Google Sheets — a Platform Master sheet + one spreadsheet per approved company | Google free quota |
| Backend / API | Google Apps Script Web App — 100 JSON actions, server-side permissions | Google free quota |
| Frontend | The **same** Apps Script Web App — HTML pages rendered by `doGet()` | Google free quota |
| Files (selfies, bills, documents) | Google Drive, private per-company folder tree | Google free quota |
| Mail / OTP | Gmail (`MailApp`) + optional WhatsApp Cloud API | free |
| Maps | OpenStreetMap tiles + browser Geolocation API | free, no API key |

**No demo data.** Bootstrap creates empty structure only; a company exists solely because a real
signup request was approved in the admin panel. `npm run verify` fails the build if a demo or
sample fixture is ever added to shipped code.

---

## 1. The two logins are separate — and both read your database

| | Company login | Employee login |
|---|---|---|
| Page | `?page=company` | `?page=employee` |
| Who | Super Admin, Admin, Sub-Admin (HR) | Site employees (workers) |
| Credentials | User ID / e-mail / mobile + password, or a one-time code | Registered mobile number + one-time code, or password |
| Extra field | Company code (`CMP-…`) — optional | — |
| Lands on | `?page=app` — the company console | `?page=mobile` — the employee app |
| Lands in | the company's Google Sheet created at approval | the same Google Sheet |

Both doors resolve the **same** `Users` tab of the company spreadsheet, but a credential
presented at the wrong door is refused with `403` and a link to the correct page — a worker can
never reach the HR console and an HR account cannot sign in on the worker app. Sessions carry
`portal: "company" | "employee"` and every request is re-checked server-side.

The platform admin has a **third, hidden door**: `?page=owner`, opened with the `OWNER_KEY`
script property (never a user account, never linked from the public pages).

```
   ?page=index  ──┬─▶ ?page=signup   company fills the request form
                  │        │
                  │        ▼
                  │   ?page=status   public tracking of REQ-…
                  │
                  ├─▶ ?page=company ──▶ ?page=app      HR / Admin console
                  ├─▶ ?page=employee ─▶ ?page=mobile   worker app
                  └─▶ ?page=owner    ──▶ ADMIN PANEL: approve / reject every signup request
```

**Company signup is request-only:** the public form (`?page=signup`) → the request appears in the
admin panel (`?page=owner` → *Signup requests*) → you review it and **Approve**. Approving creates
the company spreadsheet (all 17 tabs), the private Drive folder tree, the company code
(`CMP-…`) and the Super Admin login, then e-mails the credentials. Until then the company cannot
sign in at all.

---

## 2. What you get

* **Roles** — platform admin (hidden panel), Super Admin, Admin, Sub-Admin (23 granular
  permissions + project scope), Employee (worker app only).
* **Attendance engine** — Haversine geofence, marking window + late grace, GPS accuracy ceiling,
  live selfie (camera only), device binding, offline queue validated against the *captured*
  timestamp, QR fallback, regularization, auto mark-out with overtime, monthly
  `P L H A LV SL CL UL T TR HD WO F` summary.
* **Approvals centre** — leave, expenses (with proof), site transfers, flagged marks,
  regularizations and device changes in one queue; a second decision returns `409`.
* **Reports** — 9 report types, Excel / PDF / CSV export with the mandatory site-address block,
  every export audit-logged; **payroll wage sheet** with payable days, overtime and payout
  confirmation.
* **Extras** — live map dashboard, shifts & roster, holidays, document vault with expiry alerts,
  WhatsApp/SMS/e-mail notifications, Hindi/English worker app, weather rain-day flag, GPS
  retention purge, monthly report on the 1st.

---

## 3. Layout

```
backend/                     ← THIS FOLDER IS THE WHOLE APPS SCRIPT PROJECT
  00_Config.gs                 enums, 23 permissions, settings defaults, sheet schemas, property keys
  01_Utils.gs                  pure helpers (dates, ids, Haversine, validation)
  02_Store.gs                  spreadsheet I/O, company workbook lifecycle, audit writer
  03_Security.gs               salted SHA-256 passwords, HMAC tokens, permissions, device binding, OTP
  04_Router.gs                 doGet/doPost → ACTIONS table (the single source of truth), rate limits
  05_Platform.gs               signup + OTP, admin actions, approval & provisioning, registry
  06_Auth.gs                   the two portals, LoginIndex, sessions, password, device changes
  07_Users.gs                  employee CRUD, permissions, status, password reset
  08_Projects.gs               project CRUD + GPS lock, QR, assignments, team
  09_Attendance.gs             the engine: mark in/out, QR, review, regularization, live map, summaries
  10_Leave 11_Expense 12_Transfer 13_Vendors   request → decision workflows
  14_Reports.gs                9 reports, xlsx/pdf/csv export, audit report
  15_Payroll.gs                wage-sheet computation + payout confirmation
  16_Documents 17_Notifications 18_Settings    vault, dispatch, settings/wizard/holidays/shifts
  19_Triggers.gs               5 scheduled jobs + installer
  20_Bootstrap.gs              setupScript() + diagnoseDeployment()
  21_Files.gs                  Drive upload/download, token-gated file access
  22_Frontend.gs               serves every page of the web app (the page router)
  appsscript.json              manifest (scopes, timezone, web-app config)

  --- the frontend files (Apps Script HTML files, inlined into the pages) ---
  tmpl_index.html              public landing — choose a portal
  tmpl_login.html              small chooser that points at both portals
  tmpl_company.html            COMPANY login          → ?page=app
  tmpl_employee.html           EMPLOYEE login         → ?page=mobile
  tmpl_signup.html             company registration request (goes to the admin panel)
  tmpl_status.html             public application tracker
  tmpl_app.html                company console (SPA)         tmpl_mobile.html   worker app
  tmpl_owner.html              ADMIN PANEL: approve signups   tmpl_config_js.html runtime config
  app_css.html ui_js.html api_js.html i18n_js.html map_js.html auth_js.html
  admin_js.html mobile_js.html owner_js.html                 (all inlined, no CDN, no bundler)

dev/                         local harness (never deployed, zero npm dependencies)
  gas/polyfill.mjs             Apps Script services (SpreadsheetApp, DriveApp, HtmlService… ) on Node
  gas/loader.mjs               loads backend/*.gs into a Node VM — the same code you deploy
  server.mjs                   runs the real Web App locally: pages from doGet(), /api from the router
  smoke-test.mjs               224-check end-to-end suite (portals, attendance, payroll, tenancy…)
  verify.mjs                   consistency checks: router↔code↔pages↔docs↔"no demo data"
docs/                        QUICK-START-HINDI.md (हिंदी quick start) · GUIDE.md (manual)
                             API.md (action reference) · ARCHITECTURE.md
```

Everything under `backend/` is uploaded to **one** Apps Script project. The `.html` files are
Apps Script *HTML* files (`tmpl_*` are pages, the rest are inlined assets) — keep the `.html`
extension, Apps Script infers the file type from it.

---

## 4. Install (about 15 minutes, one time)

1. [script.google.com](https://script.google.com) → **New project** → rename it `SiteTrack`.
2. **Project settings** → tick *Show `appsscript.json` manifest file* → paste
   [`backend/appsscript.json`](backend/appsscript.json) (scopes, `Asia/Kolkata`, web-app config).
3. Create **one file per file in `backend/`**, with the same name **including the extension**:
   `00_Config.gs` … `22_Frontend.gs` are *Script* files, `tmpl_index.html`, `app_css.html`,
   `api_js.html` … are *HTML* files. Delete the default `Code.gs`.
   * **Faster, and error-free:** use clasp —
     `cp .clasp.json.example .clasp.json`, put your script ID in it, then `clasp push`.
4. Select **`setupScript`** → **▶ Run** → authorise. It creates the Platform Master sheet
   (4 tabs), the `SiteTrack` Drive root, generates `TOKEN_SECRET` + `OWNER_KEY`, installs the five
   triggers and prints the **admin key once** — store it now.
5. **Project settings → Script properties:** `OWNER_EMAIL` = your e-mail, `DEV_MODE` = `false`.
   Optional: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `MAPS_API_KEY`, `WEATHER_ENABLED`,
   `MAIL_FROM_NAME`, `SELFIE_MAX_BYTES`.
6. Run **`diagnoseDeployment`** once — structure, secrets (presence only), tenant integrity, triggers.
7. **Deploy → New deployment → Web app** · *Execute as:* **Me** · *Who has access:* **Anyone** ·
   copy the `/exec` URL. That single URL is the whole product: the website, both logins,
   the console, the employee app and the admin panel.
8. Open the URL → the landing page. Check `<URL>?action=ping` returns `"actions": 100` and
   `"configured": true`; `<URL>?action=health` should be all `true`.

> **After every change:** Deploy → **Manage deployments** → ✏️ → **New version**.
> Apps Script never auto-updates an `/exec` URL.

### 4.1 First company (the only way one can exist)

1. `?page=signup` → company details → **Send OTP** (e-mail; SMS/WhatsApp when configured) →
   submit. You get a `REQ-…` id, trackable at `?page=status`.
2. `?page=owner` → paste the **admin key** → *Signup requests* → **Approve**. The company sheet,
   Drive folders, `CMP-…` code and Super Admin are created and the credentials are e-mailed.
3. `?page=company` → sign in with the e-mailed user ID / e-mail + temporary password → set your
   own password → finish the **setup wizard** (profile, geofence, marking window, working days).
4. Add projects (pin on the map or paste coordinates; print the QR) and employees. Workers sign in
   at `?page=employee` with their mobile number + OTP and mark attendance inside the fence.

### 4.2 Local development (no Google account needed)

```bash
npm run dev        # http://localhost:8080 — the real Web App on Node (pages + /api)
npm test           # 224 end-to-end checks against backend/*.gs
npm run verify     # static checks (router↔code↔pages↔docs↔no demo data)
npm run check      # verify + test
npm run clean      # delete the local harness state
```

`dev/server.mjs` loads **the same `backend/*.gs` + `backend/*.html`** into a Node VM
(`dev/gas/polyfill.mjs` implements SpreadsheetApp, DriveApp, MailApp, HtmlService templating…).
It bootstraps an **empty** platform: create a company through `?page=signup` + the admin panel,
exactly like a real customer. The admin key is printed on boot and shown at `/dev/state`.
Inspectors: `/dev/state`, `/dev/outbox`, `/dev/fetchlog`, `/dev/logs`, `/dev/reset` (POST).

---

## 5. Scheduled jobs

Admin panel → **Triggers → Install triggers**, or run `installTriggers()` in the editor. Times are
the script timezone (`Asia/Kolkata` by default).

| Function | Schedule | Purpose |
|---|---|---|
| `monthlyAutoReport` | 1st, 06:00 | e-mails last month's attendance + payroll to Super Admins |
| `documentExpiryCheck` | daily 07:00 | expiry alerts, once per document per day |
| `dailyAttendanceClose` | daily 23:00 | Absent / Holiday / Week-off for assigned staff with no record |
| `weatherFlagJob` | daily 05:00 | rain / extreme-heat flag on yesterday (Open-Meteo, no key) |
| `purgeOldGpsData` | weekly Sun 03:00 | blanks raw lat/long older than `gpsRetentionMonths` |

---

## 6. Security model

* Passwords: salted SHA-256 (`salt$hex`); `PasswordHash`, `OtpHash`, `OtpExpiry` are stripped by
  `maskUser_` for **every** caller; wage/bank/ID fields only for payroll-capable staff.
* Sessions: stateless HMAC tokens (12 h, `portal` claim); logout blacklists the token id in
  CacheService. Role, permissions and scope are re-read per request, so revocation bites immediately.
* Multi-tenancy: one spreadsheet per company; the tenant comes from the token and role +
  permission + **project scope** are re-checked server-side. UI hiding is cosmetic.
* Portal separation: company vs employee is enforced on the server (`assertPortal_`), not in the UI.
* Device binding: one fingerprint per worker; a new device needs approval, blocked devices refused.
* Files: Drive stays private; bytes are served only through `getFile`, which verifies the caller
  may see the record referencing the file.
* Rate limiting per action family (login / OTP / register / lookup); GPS coordinates purged after
  the retention window; exports and approvals audit-logged with actor, target and result.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · every action and payload:
[docs/API.md](docs/API.md) · everything else: [docs/GUIDE.md](docs/GUIDE.md).

---

## 7. Optional integrations

| Integration | How |
|---|---|
| WhatsApp | script properties `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`; without them everything falls back to e-mail silently |
| SMS | any HTTP gateway: extend `sendSmsOrWhatsApp_()` in `backend/17_Notifications.gs` |
| Geocoding | `MAPS_API_KEY` (otherwise the free Open-Meteo geocoder is used) |
| Weather flagging | `WEATHER_ENABLED=true` + `autoRainDayFlag`, `rainThresholdMm`, `heatThresholdC` |

---

## 8. Rollout checklist

1. **Phase 1 — core:** backend deployed, admin panel opened, first company approved, wizard
   complete, 1 project + 5 employees, attendance marked from phones.
2. **Phase 2 — control:** approvals in daily use, flagged review, regularization, device changes,
   documents uploaded.
3. **Phase 3 — money:** monthly attendance + payroll exported on the 1st, vendor manpower logged,
   expense claims with proofs.
4. **Phase 4 — scale:** second company onboarded (proves tenancy), Sub-Admins scoped, triggers
   installed, Hindi rolled out.

---

## 9. Troubleshooting (top five)

| Symptom | Fix |
|---|---|
| A page shows `<?!= includeJs_('api_js') ?>` as text | that file was created as a *Script* instead of an *HTML* file, or is missing. Rename/append `.html` and redeploy a new version |
| “Cannot reach SiteTrack API” | you are on an old deployment version, or the page was opened from the editor preview — use the `/exec` URL |
| Company login says “this account is a site employee account” | you used the employee's number at the company door — open `?page=employee` instead (and vice-versa) |
| OTP never arrives | `MailApp` quota, or no SMS gateway configured; set `DEV_MODE=true` on a test deployment to echo the code |
| Worker told to use another device | expected — Approvals → Device changes → approve |

---

## 10. License & credits

Free, self-hostable alternative to per-employee attendance SaaS pricing. Maps © OpenStreetMap
contributors; weather by Open-Meteo; QR images by api.qrserver.com. All attendance data stays in
**your** Google account.
