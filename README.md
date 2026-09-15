# SiteTrack — Construction Site Live Attendance & Workforce Management

**A complete, free, multi-tenant SaaS built on Google Sheets (database) + Google Apps Script
(API) with a static HTML/CSS/JS frontend.** GPS-geofenced attendance with live selfies, device
binding, an offline-first worker PWA, approvals, sub-vendor manpower, a document vault,
payroll-ready reports and a full audit trail.

> 📖 **The full manual is [docs/GUIDE.md](docs/GUIDE.md)** — the guide book: installation,
> configuration, one chapter per role, the rules the engine applies, every setting, the
> troubleshooting matrix and the data model. This README is the 15-minute quick start.

| Layer | Technology | Cost |
|---|---|---|
| Database | Google Sheets — one spreadsheet per company + one Platform Master | Google free quota |
| Backend / API | Google Apps Script Web App — 99 JSON actions, server-side permissions | Google free quota |
| Frontend | Static HTML/CSS/JS — GitHub Pages (or Netlify/Vercel/any host) | free tier |
| Files | Google Drive, private per-company folder tree | Google free quota |
| Mail / OTP | Gmail (`MailApp`) + optional WhatsApp Cloud API | free |
| Maps | OpenStreetMap tiles + browser Geolocation API | free, no API key |

**No demo data.** There is no seed script, no evaluation tenant and no fake workers anywhere in this
repository — bootstrap creates empty structure only, and a company exists solely because a real
signup was approved. `npm run verify` fails the build if a demo/sample fixture is ever added to
shipped code.

---

## 1. What you get

* **Roles** — Platform Owner (hidden panel), Super Admin, Admin, Sub-Admin (23 granular
  permissions + project scope), Site Employee (mobile PWA only).
* **Company onboarding** — public signup → mobile OTP → owner approval → the company spreadsheet,
  Drive folder and Super Admin are created automatically → temp password by e-mail → forced
  password change → 4-step setup wizard.
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
  WhatsApp/SMS/e-mail notifications, Hindi/English worker app, weather rain-day flag, GPS retention
  purge, monthly report on the 1st.

---

## 2. Layout

```
backend/             Google Apps Script project = the whole API (22 files)
  00_Config.gs         enums, 23 permissions, 43 settings defaults, sheet schemas, property keys
  01_Utils.gs          pure helpers (dates, ids, Haversine, validation)
  02_Store.gs          spreadsheet I/O, company workbook lifecycle, audit writer
  03_Security.gs       salted SHA-256 passwords, HMAC tokens, permissions, device binding, OTP
  04_Router.gs         doGet/doPost → ACTIONS table (99 actions; the single source of truth for auth), rate limits
  05_Platform.gs       signup + OTP, owner actions, approval & provisioning, registry
  06_Auth.gs           LoginIndex, login (password + OTP), sessions, profile, device change
  07_Users.gs          employee CRUD, permissions, status, password reset
  08_Projects.gs       project CRUD + GPS lock, QR, assignments, team
  09_Attendance.gs     the engine: mark in/out, QR, review, regularization, live map, summaries
  10_Leave 11_Expense 12_Transfer 13_Vendors     requests and decisions
  14_Reports.gs        9 reports, xlsx/pdf/csv export, audit report
  15_Payroll.gs        wage-sheet computation + payout confirmation
  16_Documents 17_Notifications 18_Settings       vault, dispatch, settings/wizard/holidays/shifts
  19_Triggers.gs       5 scheduled jobs + installer
  20_Bootstrap.gs      setupScript() + diagnoseDeployment()
  21_Files.gs          Drive upload/download, token-gated file access
  appsscript.json      manifest (scopes, timezone, web-app config)

frontend/            static web app (any static host)
  index.html signup.html status.html login.html     public pages + staff sign-in
  app.html                 staff console (SPA: dashboard → audit)
  mobile.html              worker PWA (offline-first, EN/HI)
  owner.html               hidden platform-owner panel
  config.js                the ONLY file you edit: API_URL, branding, feature flags
  assets/css, assets/js    design system + api/i18n/ui/map/admin/mobile/owner
  manifest.webmanifest sw.js favicon.svg assets/icons/

dev/                 local harness (never deployed, zero npm dependencies)
  gas/polyfill.mjs     Apps Script service polyfills for Node
  gas/loader.mjs       loads backend/*.gs into a Node VM
  server.mjs           static server + /api proxy (bootstraps an EMPTY platform)
  smoke-test.mjs       166-check end-to-end suite against the real backend code
  verify.mjs           consistency checks: router↔code↔docs↔frontend callers↔ST.* namespace
                       exports↔assets↔i18n↔"no demo data"
docs/                GUIDE.md (guide book) · API.md (action reference) · ARCHITECTURE.md
scripts/make-icons.mjs   dependency-free PWA icon generator
deploy/github-pages.workflow.yml   publish frontend/ with GitHub Actions
```

---

## 3. Backend — 15 minutes

1. [script.google.com](https://script.google.com) → **New project** → `SiteTrack API`.
2. **Project settings →** show `appsscript.json`, paste [`backend/appsscript.json`](backend/appsscript.json)
   (scopes, `Asia/Kolkata`, web-app config).
3. Delete `Code.gs`; create one `.gs` file per file in `backend/` (same names, paste contents).
   With clasp: copy `.clasp.json.example` → `.clasp.json`, set `scriptId`, then `clasp push`.
4. Select **`setupScript`** → **▶ Run** → authorise. It creates the Platform Master (4 tabs), the
   `SiteTrack` Drive root, and generates `OWNER_KEY` + `TOKEN_SECRET`; then it installs the five
   triggers and prints the owner key **once** — store it now, it is never returned again.
5. **Project settings → Script properties:** `OWNER_EMAIL` = your e-mail, `DEV_MODE` = `false`.
   Optional: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `MAPS_API_KEY`, `WEATHER_ENABLED`,
   `MAIL_FROM_NAME`, `SELFIE_MAX_BYTES`.
6. Run **`diagnoseDeployment`** once — it reports structure, secret presence (never values),
   tenant integrity and trigger coverage.
7. **Deploy → New deployment → Web app** · *Execute as:* **Me** · *Who has access:* **Anyone** ·
   copy the `/exec` URL → that is your `API_URL`.
8. Check: `<API_URL>?action=ping` returns JSON with `"actions": 99` and `"configured": true`;
   `?action=health` should be all `true`.

> **After every backend change:** Deploy → **Manage deployments** → ✏️ → **New version**.
> Apps Script never auto-updates an `/exec` URL.

---

## 4. Frontend — 10 minutes

1. `frontend/config.js`:
   ```js
   API_URL: 'https://script.google.com/macros/s/AKfycb…/exec',
   OWNER_KEY: '',   // keep BLANK in a published build; owner.html asks for it at runtime
   ```
   Runtime overrides while testing: `?api=<url>` on any page, or `ST.api.setApiUrl('…')`.
2. Publish `frontend/` as the site root:
   * **GitHub Pages:** `cp deploy/github-pages.workflow.yml .github/workflows/pages.yml`, commit it
     from your own machine (GitHub blocks workflow files pushed by app tokens), then
     **Settings → Pages → Source: GitHub Actions**.
   * **Netlify / Vercel / S3 / drag-and-drop:** point the publish directory at `frontend/`. No build.
3. Worker phones: open `mobile.html` → Chrome menu → **Add to Home screen**. `sw.js` caches the
   shell, so the app opens offline and queued attendance syncs when the signal returns.

### 4.1 Local development (no Google account needed)

```bash
npm run dev        # http://localhost:8080  — serves frontend/ and proxies /api to the real backend
npm test           # 166 end-to-end checks against backend/*.gs on Node polyfills
npm run verify     # static checks (router↔code↔docs↔every action has a UI caller↔no demo data)
npm run check      # verify + test
npm run icons      # regenerate the PWA icons
npm run clean      # delete the local harness state
```

`dev/server.mjs` loads **the same `backend/*.gs`** into a Node VM (`dev/gas/polyfill.mjs`):
SpreadsheetApp → JSON under `dev/data/`, DriveApp → `dev/data/drive/`, MailApp → `dev/data/outbox.json`,
real HMAC/SHA-256 via `node:crypto`. It bootstraps an **empty** platform — you create a company
through `signup.html` + `owner.html` exactly like a real customer (the owner key is printed on boot;
also visible at `/dev/state`). No accounts, no passwords, no seeded rows. Inspector endpoints:
`/dev/state`, `/dev/outbox`, `/dev/fetchlog`, `/dev/logs`, `/dev/reset` (POST).

---

## 5. First company (this is the only way one can exist)

1. `signup.html` → details → **Send OTP** (e-mail; also SMS/WhatsApp if configured) → the 6-digit
   code is confirmed live by `verifyOtp` → submit. Status becomes `Pending`; you get a `REQ-…` id.
2. `owner.html` (not linked anywhere) → paste the owner key → **Signup requests** → **Approve**:
   creates `SiteTrack — <Company>` with all 17 tabs, the private folder tree
   `SiteTrack/SiteTrack-<CompanyID>/{Selfies,Documents,Expenses,VendorPhotos,Reports,Temp}`, the
   registry row, and the **Super Admin** (temp password e-mailed).
3. `login.html` → sign in → set a new password (≥ 8 chars, letter + number) → finish the
   **setup wizard**: profile/address → geofence 200 m, selfie + device rules → window 06:00–11:00,
   cutoff 11:00, grace 15 min → working days and weekly off.
4. Add projects (pin on the map or paste coordinates; print the QR), add employees, assign teams.
   Workers mark attendance inside the fence with a live selfie.
5. Track any application publicly at `status.html?requestId=REQ-…`.

---

## 6. Scheduled jobs

Owner panel → **Triggers → Install triggers**, or run `installTriggers()` in the editor. Times are
the script timezone (`Asia/Kolkata` by default).

| Function | Schedule | Purpose |
|---|---|---|
| `monthlyAutoReport` | 1st, 06:00 | e-mails last month's attendance + payroll to Super Admins + `reportRecipients` |
| `documentExpiryCheck` | daily 07:00 | expiry alerts, once per document per day |
| `dailyAttendanceClose` | daily 23:00 | Absent / Holiday / Week-off for assigned staff with no record |
| `weatherFlagJob` | daily 05:00 | rain / extreme-heat flag on yesterday (Open-Meteo, no key) |
| `purgeOldGpsData` | weekly Sun 03:00 | blanks raw lat/long older than `gpsRetentionMonths` |

---

## 7. Security model

* Passwords: salted SHA-256 (`salt$hex`); `PasswordHash`, `OtpHash`, `OtpExpiry` are stripped by
  `maskUser_` for **every** caller, and wage/bank/ID fields only for payroll-capable staff.
* Sessions: stateless HMAC tokens (12 h); logout blacklists the token id in CacheService.
  Role, permissions and scope are re-read per request, so revocation bites immediately.
* Multi-tenancy: one spreadsheet per company; the tenant comes from the token and role +
  permission + **project scope** are re-checked server-side. UI hiding is cosmetic.
* Device binding: one fingerprint per worker; a new device needs approval, blocked devices refused.
* Files: Drive stays private; bytes are served only through `getFile`, which verifies the caller
  may see the record referencing the file.
* Rate limiting per action family (login / OTP / register / lookup); GPS coordinates purged after the
  retention window; exports and approvals audit-logged with actor, target, result.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · every action and payload:
[docs/API.md](docs/API.md) · everything else: [docs/GUIDE.md](docs/GUIDE.md).

---

## 8. Optional integrations

| Integration | How |
|---|---|
| WhatsApp | script properties `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`; without them everything falls back to e-mail silently |
| SMS | any HTTP gateway: extend `sendSmsOrWhatsApp_()` in `backend/17_Notifications.gs` |
| Geocoding | `MAPS_API_KEY` (otherwise the free Open-Meteo geocoder is used) |
| Weather flagging | `WEATHER_ENABLED=true` + `autoRainDayFlag`, `rainThresholdMm`, `heatThresholdC` |
| Custom domain | point it at Pages/Netlify and keep `API_URL` absolute |

---

## 9. Rollout checklist

1. **Phase 1 — core:** backend deployed, owner panel bootstrapped, first company approved, wizard
   complete, 1 project + 5 employees, attendance marked from phones.
2. **Phase 2 — control:** approvals in daily use, flagged review, regularization, device changes,
   documents uploaded.
3. **Phase 3 — money:** monthly attendance + payroll exported on the 1st, vendor manpower logged,
   expense claims with proofs.
4. **Phase 4 — scale:** second company onboarded (proves tenancy), Sub-Admins scoped, triggers
   installed, Hindi rolled out.

---

## 10. Troubleshooting (top five — the book has 25)

| Symptom | Fix |
|---|---|
| `ping` returns an HTML login page | redeploy with *Anyone* access + *Execute as: Me* |
| “Cannot reach SiteTrack API” | `API_URL` wrong/empty, or no new deployment version after a change |
| OTP never arrives | `MailApp` quota; or set `DEV_MODE=true` in a test deployment to echo the code |
| Worker told to use another device | expected — Approvals → Device changes → approve |
| Exports fail with 502 | Google endpoint hiccup — use Reports → Print → Save as PDF |

---

## 11. License & credits

Free, self-hostable alternative to per-employee attendance SaaS pricing. Maps © OpenStreetMap
contributors; weather by Open-Meteo; QR images by api.qrserver.com. All attendance data stays in
**your** Google account.
