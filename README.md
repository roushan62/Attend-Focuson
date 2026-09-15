# SiteTrack — Construction Site Live Attendance & Workforce Management

**Free, multi-tenant SaaS for construction companies** — GPS-geofenced attendance with live
selfies, device binding, offline-first worker PWA, approvals, sub-vendor manpower, document
vault, payroll-ready reports and a full audit trail.

Zero recurring cost by design:

| Layer        | Technology                                                        | Cost                        |
| ------------ | ----------------------------------------------------------------- | --------------------------- |
| Database     | Google Sheets — one spreadsheet per company + one Platform Master  | Google free quota           |
| Backend/API  | Google Apps Script Web App (JSON router, server-side permissions)  | Google free quota           |
| Frontend     | Static HTML/CSS/JS — GitHub Pages (or Netlify/Vercel/any host)     | Free tier                   |
| Files        | Google Drive, private per-company folder tree                      | Google free quota           |
| Mail / OTP   | Gmail (`MailApp`) + optional WhatsApp Cloud API free tier          | Free                        |
| Maps         | OpenStreetMap tiles + browser Geolocation API                      | Free, no API key            |

---

## 1. What you get

* **Roles** — Platform Owner (hidden panel), Super Admin, Admin, Sub-Admin (granular
  permission toggles + project scope), Site Employee (mobile PWA only).
* **Company onboarding** — public signup → mobile OTP → owner approval → automatic creation
  of the company spreadsheet, Drive folder and Super Admin (temp password e-mailed) →
  forced password change → 4-step setup wizard (geofence default 200 m, cutoff 11:00,
  working days/holidays).
* **Attendance engine** — Haversine geofence check, marking window + late grace, GPS
  accuracy limit, live selfie (camera only), device binding, offline queue validated
  against the captured timestamp, QR fallback check-in, regularization requests,
  auto mark-out with overtime calculation, monthly auto-summary
  (`P L H A LV SL CL T TR HD WO F`).
* **Approvals centre** — leave, expenses (with proof), site transfers, flagged marks,
  regularization and device-change requests in one queue.
* **Reports** — monthly attendance grid, employee history, daily register, flagged log,
  leave/expense summaries, vendor manpower, project summary and the **payroll-ready wage
  sheet**; Excel / PDF / CSV export with the mandatory site-address block; every export is
  written to the audit log.
* **Extras** — live map dashboard, shifts & roster, holidays, document vault with expiry
  alerts, WhatsApp/SMS/e-mail notifications, Hindi/English worker app, weather rain-day
  flag, GPS retention purge, scheduled monthly report on the 1st.

---

## 2. Repository layout

```
backend/            Google Apps Script project (the whole API)
  00_Config.gs        enums, permissions, settings defaults, sheet schemas
  01_Utils.gs         pure helpers (dates, ids, geo/Haversine, validation)
  02_Store.gs         spreadsheet I/O, company sheet lifecycle, audit
  03_Security.gs      password hashing, tokens, permissions, device binding, OTP
  04_Router.gs        doGet/doPost → action table (101 actions), rate limiting
  05_Platform.gs      signup/OTP, owner panel, company approval, registry
  06_Auth.gs          login (password + OTP), sessions, profile, device change
  07_Users.gs         employee CRUD, permissions, status, password reset
  08_Projects.gs      project CRUD + GPS lock, QR, assignments, team
  09_Attendance.gs    mark in/out, QR check-in, review, regularization, live map
  10_Leave.gs  11_Expense.gs  12_Transfer.gs   request + decision flows
  13_Vendors.gs       vendor CRUD + worker entries + manpower report
  14_Reports.gs       9 report types, exports (xlsx/pdf/csv), audit log
  15_Payroll.gs       wage-sheet computation + payout confirmation
  16_Documents.gs     document vault with expiry statuses
  17_Notifications.gs in-app + e-mail + SMS/WhatsApp dispatch
  18_Settings.gs      company settings, setup wizard, holidays, shifts
  19_Triggers.gs      5 scheduled jobs + installer
  20_Bootstrap.gs     platform bootstrap, setupScript(), demo seed
  21_Files.gs         Drive upload/download, token-gated file access
  appsscript.json     manifest (scopes, timezone, web-app config)

frontend/           static web app (GitHub Pages)
  index.html          public landing page
  signup.html         company registration + OTP
  status.html         public application-status lookup
  login.html          password/OTP sign-in for staff + workers
  app.html            staff console (SPA: dashboard → audit)
  mobile.html         worker PWA (offline-first)
  owner.html          hidden platform-owner panel
  config.js           runtime config (API URL, branding, feature flags)
  manifest.webmanifest, sw.js, favicon.svg
  assets/css/app.css  design system (light + dark)
  assets/js/          api.js i18n.js ui.js map.js admin.js mobile.js owner.js
  assets/icons/       generated PWA icons (scripts/make-icons.mjs)

dev/                local development harness (not deployed)
  gas/polyfill.mjs    Google Apps Script service polyfills for Node
  gas/loader.mjs      loads backend/*.gs into a Node VM
  server.mjs          zero-dependency dev server + /api proxy + demo seed
  smoke-test.mjs      151-assertion end-to-end test suite

docs/               API.md (action reference) · ARCHITECTURE.md (design notes)
scripts/make-icons.mjs  dependency-free PWA icon generator
```

---

## 3. Prerequisites

1. A **Google account** with Drive + Sheets + Apps Script access
   ([script.google.com](https://script.google.com)).
2. A **GitHub account** (for GitHub Pages hosting of the frontend).
3. Optional, for command-line deploys: Node ≥ 18 and `npm i -g @google/clasp`.
4. A phone with Chrome (worker app needs camera + location permissions).

> Everything below can be done from the browser only — clasp is a convenience, never a
> requirement.

---

## 4. Backend setup (Google Apps Script) — ~15 minutes

### 4.1 Create the script project

1. Open [script.google.com](https://script.google.com) → **New project**, name it
   `SiteTrack API`.
2. **Project settings → show `appsscript.json`** and paste the contents of
   [`backend/appsscript.json`](backend/appsscript.json) (scopes, IST timezone, web-app
   config). Alternatively set them manually:
   * Scopes: `spreadsheets`, `drive`, `script.send_mail`, `script.external_request`,
     `script.scriptapp`.
   * Time zone: `(GMT+05:30) India`.
3. Delete the default `Code.gs`. For **each file in `backend/`** create a file with the
   same name (`.gs`) and paste the contents — order does not matter (Apps Script shares
   one global scope).
   *With clasp:* copy `.clasp.json.example` → `.clasp.json`, fill in the `scriptId` of the
   project you just created, then `clasp push` from the repo root (`rootDir` is `backend`).

### 4.2 Bootstrap the platform

1. In the editor, select `setupScript` and press **Run** once (authorise the scopes when
   asked). It is a thin wrapper around `actionBootstrapPlatform` and:
   * creates the **Platform Master spreadsheet** (tabs: `CompanySignupRequests`,
     `CompanyRegistry`, `LoginIndex`, `PlatformAuditLog`);
   * creates the root **Drive folder** `SiteTrack Companies/`;
   * generates `OWNER_KEY` and `TOKEN_SECRET` script properties.
2. The execution log prints the two secrets **once**. Copy them somewhere safe — the owner
   key opens the hidden owner panel, the token secret signs every session token.
   (Re-running `setupScript()` rotates them and invalidates existing sessions.)
3. Still in **Project settings → Script properties**, set at least:
   | Key           | Value                                              |
   | ------------- | -------------------------------------------------- |
   | `OWNER_EMAIL` | your e-mail (signup + alert notifications)         |
   | `DEV_MODE`    | `false` for production (`true` echoes OTPs in API responses — dev only!) |
   Optional: `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` (Cloud API), `MAPS_API_KEY`
   (better geocoding), `WEATHER_ENABLED=true`, `MAIL_FROM_NAME`, `SELFIE_MAX_BYTES`.

### 4.3 Deploy as a Web App

1. **Deploy → New deployment → Web app**.
2. *Execute as:* **Me** (the deploying user — keeps every Sheet/Drive file private to you).
3. *Who has access:* **Anyone** (workers have no Google accounts; every action is
   authenticated by your own token layer).
4. Copy the **Web app URL** — it looks like
   `https://script.google.com/macros/s/AKfycb…/exec`. This is your `API_URL`.
5. Sanity check: open `…/exec?action=ping` — you should get JSON listing the app version
   and the 101 registered actions.

> **After any backend change:** Deploy → **Manage deployments → edit → New version**.
> Apps Script never auto-updates a `/exec` URL.

---

## 5. Frontend setup (GitHub Pages) — ~10 minutes

1. Push this repository to GitHub (it is already a GitHub project — use your remote).
2. Edit [`frontend/config.js`](frontend/config.js):
   ```js
   API_URL: 'https://script.google.com/macros/s/AKfycb…/exec',
   ```
   Leave `OWNER_KEY` **empty** in production — the owner panel asks for it at runtime and
   it must never ship in JavaScript. (For local experiments you can also override the API
   at runtime with `?api=<url>` or from `localStorage`.)
3. Publish `frontend/` as the site root. Two options:
   * **GitHub Actions (recommended):** copy the shipped workflow once —
     `cp deploy/github-pages.workflow.yml .github/workflows/pages.yml` — commit it from
     your own machine (GitHub blocks workflow files pushed by app tokens), then
     **Settings → Pages → Source: GitHub Actions**. Every push to `main` republishes.
   * **Any static host:** Netlify/Vercel/drag-and-drop work unchanged — just point the
     publish directory at `frontend/`.
4. Visit `https://<you>.github.io/<repo>/` — the landing page loads. Sign-up, login and
   the worker PWA are plain static pages; they POST `text/plain` JSON to the Apps Script
   URL, which needs no CORS pre-flight.
5. Installability: on Android Chrome, open `mobile.html` → menu → *Add to Home screen*.
   The service worker (`sw.js`) caches the shell so the app opens without network;
   attendance captured offline is queued and synced automatically.

### 5.1 Local development (no Google account needed)

```bash
node dev/server.mjs          # http://localhost:8080  (PORT=9000 node dev/server.mjs)
node dev/smoke-test.mjs      # 151 end-to-end assertions against the real backend code
node scripts/make-icons.mjs  # regenerate PWA icons (dependency-free PNG encoder)
```

The dev server loads **the same `backend/*.gs` files** into a Node VM with Google-service
polyfills (`dev/gas/polyfill.mjs`): SpreadsheetApp → JSON files under `dev/data/`,
DriveApp → `dev/data/drive/`, MailApp → `dev/data/outbox.json`, real HMAC/SHA-256 via
`node:crypto`. It auto-bootstraps the platform and seeds a **demo company**:

| Role        | Login                        | Password / OTP            |
| ----------- | ---------------------------- | ------------------------- |
| Super Admin | `demo.admin@sitetrack.local` | `Demo@1234`               |
| Admin       | `demo.admin1@sitetrack.local`| `Demo@1234`               |
| Sub-Admin   | `demo.hr@sitetrack.local`    | `Demo@1234`               |
| Employee    | `9800000011` … `9800000018`  | password `Demo@1234` or OTP (dev code echoed) |

The owner key is printed on boot (also visible at `/dev/state`). Inspector endpoints:
`/dev/state`, `/dev/outbox` (sent mails), `/dev/fetchlog`, `/dev/logs`, `/dev/reset`.

---

## 6. Onboarding your first company (production flow)

1. Open `signup.html` → company details → **Send OTP** (delivered by e-mail; in `DEV_MODE`
   the code is also shown on screen) → submit. Status becomes `Pending`.
2. Open `owner.html` (not linked anywhere) → enter `OWNER_KEY` → **Signup requests** →
   *Approve*. This creates:
   * the company spreadsheet with all 17 tabs,
   * the private Drive folder `SiteTrack Companies/<Company>/…`,
   * a `CompanyRegistry` row, and
   * the **Super Admin** account — credentials e-mailed to the contact (temp password,
     forced change on first login).
3. The Super Admin signs in at `login.html`, sets a new password and completes the
   **setup wizard**: profile/address → geofence & selfie/device rules → attendance window
   (default 06:00–11:00, cutoff 11:00, 15 min grace) → working days & weekly off.
4. Create projects (drop the GPS pin on the map or paste coordinates; print the QR code
   for indoor fallback), add employees (temp passwords e-mailed; workers can also use
   password-less OTP login on `mobile.html`), assign teams — done. Workers can now mark
   attendance inside the fence with a live selfie.
5. Track any application publicly at `status.html?requestId=REQ-…`.

---

## 7. Scheduled jobs (triggers)

Open `owner.html` → **Triggers** → *Install triggers*, or run `installTriggers()` once
from the editor. Five time-driven functions are registered:

| Function                | Schedule            | Purpose                                        |
| ----------------------- | ------------------- | ---------------------------------------------- |
| `monthlyAutoReport`     | 1st of month, 06:00 | e-mails the monthly XLSX report to Super Admins + `reportRecipients` |
| `documentExpiryCheck`   | daily 07:00         | expiry alerts (once per document per day)      |
| `dailyAttendanceClose`  | daily 23:00         | auto-marks Absent/Holiday/Week-off for unmarked assigned staff |
| `weatherFlagJob`        | daily 05:00         | rain/extreme-heat flag on yesterday's attendance (Open-Meteo, no key) |
| `purgeOldGpsData`       | weekly Sun 02:00    | blanks raw lat/long older than `gpsRetentionMonths` |

---

## 8. Security model (summary)

* Passwords: salted SHA-256 via `Utilities.computeDigest` (`salt$hex`), never returned by
  any API (`maskUser_` strips `PasswordHash`, `OtpHash`, `OtpExpiry` for **every** caller).
* Sessions: stateless HMAC tokens (12 h) with a per-deployment secret; logout blacklists
  the token id in CacheService.
* Multi-tenancy: one spreadsheet per company; every action resolves the tenant from the
  token and re-checks role + permission + **project scope server-side** (UI hiding is
  cosmetic only). Employees only ever see teammates on shared projects.
* Device binding: one fingerprint per worker; new devices require admin approval before
  attendance works; blocked devices are refused.
* Files: all Drive files stay **private**; bytes are served only through `getFile`, which
  verifies the caller can access the record referencing the file.
* Rate limiting per action family (login/OTP/register/lookup) via CacheService.
* GPS privacy: raw coordinates are purged to site-level after the retention window;
  exports and approvals are audit-logged with actor, target and result.

Details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the full action reference
(payloads, permissions, responses) is [`docs/API.md`](docs/API.md).

---

## 9. Optional integrations

| Integration            | How                                                                 |
| ---------------------- | ------------------------------------------------------------------- |
| WhatsApp notifications | Script properties `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` (Cloud API free tier). Without them everything falls back to e-mail silently. |
| SMS                    | any HTTP gateway: extend `sendSmsOrWhatsApp_()` in `17_Notifications.gs`. |
| Better geocoding       | `MAPS_API_KEY` script property (otherwise the free Open-Meteo geocoder is used). |
| Custom domain          | point the domain at GitHub Pages/Netlify and keep `API_URL` absolute. |

---

## 10. Phased rollout checklist (spec §13)

1. **Phase 1 — core:** backend deployed, owner panel bootstrapped, first company approved,
   setup wizard complete, 1 project + 5 employees, attendance marking from phones.
2. **Phase 2 — control:** approvals queue in daily use, flagged review, regularization,
   device-change handling, document uploads.
3. **Phase 3 — money:** monthly attendance + payroll wage sheet exported on the 1st,
   vendor manpower logged by supervisors, expense claims with proofs.
4. **Phase 4 — scale:** second company onboarded (proves tenancy), Sub-Admins with scoped
   permissions, triggers installed, Hindi toggle rolled out to site staff.

---

## 11. Troubleshooting

| Symptom                                    | Fix                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `ping` returns HTML login page             | Web app deployed with wrong access — redeploy with *Anyone* + *Execute as me*.         |
| Frontend says “Cannot reach SiteTrack API” | `API_URL` wrong/empty in `config.js`, or deployment not updated after a backend change. |
| OTP never arrives                          | Check `MailApp` quota; in `DEV_MODE=true` the code is returned in the API response.     |
| Worker gets “device” error on new phone    | Expected: admin must approve the device-change request (Approvals → Device changes).   |
| Selfie upload fails                        | `SELFIE_MAX_BYTES` too low, or phone sends HEIC — retake in Chrome (JPEG).             |
| Map tiles blank in site office             | CDN blocked — the UI degrades to coordinate cards with Google-Maps deep links.          |
| Exports fail with HTTP 502                 | Google export endpoint hiccup — use on-screen report → Print → Save as PDF.            |
| Session dies after 12 h                    | By design (token TTL); sign in again.                                                  |

---

## 12. License & credits

Built as a free, self-hostable alternative to per-employee attendance SaaS pricing.
Maps © OpenStreetMap contributors; weather by Open-Meteo; QR images by api.qrserver.com.
All attendance data stays in **your** Google account.
