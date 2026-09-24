# SiteTrack — Copy-Paste Install Guide (Google Sheets + Apps Script)

**Everything — website, staff console, worker app, owner panel and the full API — runs inside
ONE Apps Script project.** No GitHub. No Vercel. No Netlify. No Node, no npm, no clasp.
You only need a Google account and the ability to copy-paste.

| | |
|---|---|
| **Time** | 30–40 minutes, once |
| **Cost** | ₹0 — Google's free quotas |
| **What you copy-paste** | 40 files: 23 script files + 16 HTML files + 1 manifest |
| **What you get** | GPS-geofenced attendance with selfie, approvals, reports, payroll, live map, Hindi/English worker app |
| **Full manual** | [GUIDE.md](GUIDE.md) (roles, rules, every setting) · [API.md](API.md) (99 actions) |

> **Rule of the system:** one `…/exec` URL = your entire software.
> Opening it shows the website; `?page=…` opens every screen; `?action=…` is the JSON API.

---

## 0. What you are building

```
  Worker phone (?page=mobile)      Office (?page=app)       Owner (?page=owner)
            │                             │                        │
            └──────────────┬──────────────┴───────────┬────────────┘
                           │  same origin, JSON       │
                           ▼                          ▼
              ┌─────────────────────────────────────────────┐
              │  YOUR Apps Script Web App  (…/exec)         │
              │  23 .gs modules  ·  16 HTML files           │
              │  geofence · HMAC sessions · payroll · audit │
              └──────────────┬───────────────┬──────────────┘
                             ▼               ▼
                    Google Sheets        Google Drive
                    (your database)      (selfies, proofs)
```

One spreadsheet holds the platform registry, each company gets its own spreadsheet, and all
files stay in your private Drive folders.

---

## 1. Create the script

1. Open <https://sheets.new> — a fresh Google Sheet appears (this is your "Google Sheet app").
2. Menu: **Extensions → Apps Script**. The script editor opens, bound to that sheet.
   (script.google.com → New project works exactly the same.)
3. Rename the project: **SiteTrack**.

## 2. Paste the manifest (1 file)

1. **Project Settings (⚙️)** → tick **“Show appsscript.json manifest file in editor”**.
2. Open `appsscript.json`, select ALL, delete, and paste the contents of
   [`backend/appsscript.json`](../backend/appsscript.json).
   It pins the timezone (`Asia/Kolkata`), the six OAuth scopes and the web-app access
   (`Anyone` + `Execute as: Me`) that let workers sign in without a Google account.
3. **Save 💾**.

## 3. Paste the 23 script files

Delete the default `Code.gs`. Then, for **each row**: **+ → Script**, type the **File name**
exactly as shown (no `.gs` needed — the editor adds it), select all, paste, **Save 💾**.

| # | File name | Owns |
|---|---|---|
| 1 | `00_Config` | enums, permissions, settings defaults, sheet schemas |
| 2 | `01_Utils` | dates, ids, Haversine GPS distance, validation |
| 3 | `02_Store` | Google Sheets I/O, company workbook lifecycle, audit writer |
| 4 | `03_Security` | salted passwords, HMAC tokens, permissions, OTP, device binding |
| 5 | `04_Router` | `doGet`/`doPost`, the 99-action table, rate limits |
| 6 | `05_Platform` | signup + OTP, owner actions, company approval & provisioning |
| 7 | `06_Auth` | login (password + OTP), sessions, profile |
| 8 | `07_Users` | employee CRUD, permission grants, password resets |
| 9 | `08_Projects` | projects, GPS lock, geofence, QR codes, assignments |
| 10 | `09_Attendance` | the engine: mark in/out, geofence, flags, regularization, live map |
| 11 | `10_Leave` | leave applications and decisions |
| 12 | `11_Expense` | expense claims with proof and decisions |
| 13 | `12_Transfer` | site transfer requests |
| 14 | `13_Vendors` | sub-contractor vendors and daily manpower |
| 15 | `14_Reports` | 9 reports, Excel/PDF/CSV export |
| 16 | `15_Payroll` | wage-sheet computation and payout confirmation |
| 17 | `16_Documents` | document vault and expiry alerts |
| 18 | `17_Notifications` | e-mail, WhatsApp/SMS, in-app inbox |
| 19 | `18_Settings` | settings validation, setup wizard, holidays, shifts |
| 20 | `19_Triggers` | the five scheduled jobs + installer |
| 21 | `20_Bootstrap` | `setupScript()` + `diagnoseDeployment()` |
| 22 | `21_Files` | Drive upload/download, token-gated file access |
| 23 | `22_Frontend` | serves every HTML page from the same `/exec` URL |

Paste from `backend/<same name>.gs` in the repository. The leading number is reading order —
Apps Script shares one global scope, so **do not rename or merge files**.

> Advanced (optional): `clasp push` also works — copy `.clasp.json.example` → `.clasp.json`,
> set your `scriptId`. Copy-paste is the supported path for this guide.

## 4. Paste the 16 HTML files (this IS the frontend)

For each row: **+ → HTML**, type the **File name exactly as shown, WITHOUT `.html`**
(the editor adds the extension), paste the contents of the same-named file in
`backend/`, **Save 💾**.

**Pages (7):**

| File name | What opens | Paste from |
|---|---|---|
| `tmpl_index` | the public website (opening the `/exec` URL) | `backend/tmpl_index.html` |
| `tmpl_login` | staff sign-in (`?page=login`) | `backend/tmpl_login.html` |
| `tmpl_signup` | company registration + OTP (`?page=signup`) | `backend/tmpl_signup.html` |
| `tmpl_status` | public application tracker (`?page=status`) | `backend/tmpl_status.html` |
| `tmpl_app` | staff console — dashboard, approvals, reports, payroll (`?page=app`) | `backend/tmpl_app.html` |
| `tmpl_mobile` | worker PWA — GPS + selfie marking, EN/हिंदी (`?page=mobile`) | `backend/tmpl_mobile.html` |
| `tmpl_owner` | hidden platform-owner panel (`?page=owner`) | `backend/tmpl_owner.html` |

**Assets (9)** — these are included into the pages server-side; they look like JS/CSS but
**must be created as HTML files** (that is how Apps Script stores embedded assets):

| File name | Contains | Paste from |
|---|---|---|
| `app_css` | the whole design system | `backend/app_css.html` |
| `tmpl_config_js` | auto API-URL config (reads its own web-app URL) | `backend/tmpl_config_js.html` |
| `i18n_js` | English + हिंदी strings | `backend/i18n_js.html` |
| `api_js` | API client, sessions, GPS/camera, offline queue | `backend/api_js.html` |
| `ui_js` | UI widgets, router, toasts, theme | `backend/ui_js.html` |
| `map_js` | live map (OpenStreetMap tiles, no key) | `backend/map_js.html` |
| `admin_js` | staff console screens | `backend/admin_js.html` |
| `mobile_js` | worker app screens | `backend/mobile_js.html` |
| `owner_js` | owner panel screens | `backend/owner_js.html` |

**Checkpoint:** the editor now shows **23 script files + 16 HTML files + appsscript.json**.
If any file is missing you will see it named on a friendly *“setup incomplete”* page when you
open the site — create that file and redeploy.

## 5. Run `setupScript` (creates the database + secrets)

1. Function dropdown (top toolbar) → **`setupScript`** → **▶ Run**.
2. Authorise when asked (choose your account → *“Google hasn’t verified this app”* →
   **Advanced → Go to SiteTrack (unsafe)** → **Allow** — it is your own project).
3. Open **Execution log**: it prints the Platform Master sheet URL, the five triggers, and
   **`Owner key: STK-OWNER-…`**.
   **Copy the owner key NOW — it is never shown again.** It is the password of `?page=owner`.

## 6. Script properties (2 required)

**Project Settings → Script properties → Add script property:**

| Key | Value |
|---|---|
| `OWNER_EMAIL` | your e-mail (signup alerts + monthly reports) |
| `DEV_MODE` | `false` (`true` echoes OTP codes — test deployments only) |

Optional later: `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`, `MAPS_API_KEY`, `WEATHER_ENABLED`,
`MAIL_FROM_NAME`, `SELFIE_MAX_BYTES`. Never put secrets in code or in a sheet.

## 7. Run `diagnoseDeployment`

Same dropdown → **`diagnoseDeployment`** → **▶ Run**. Every line should be `✓` — it checks
structure, secret presence (never values), triggers and tenant integrity. Paste its output
freely in a support chat.

## 8. Deploy as a Web App (this makes it LIVE)

1. **Deploy → New deployment → ⚙️ Web app**.
2. *Description:* `v1` · *Execute as:* **Me** · *Who has access:* **Anyone**.
3. **Deploy** → authorise → copy the **Web app URL**
   (`https://script.google.com/macros/s/AKfycb…/exec`).
   **This ONE link is your whole software** — no hosting, no domain, no other service.

## 9. Verify (2 minutes)

| Check | Expected |
|---|---|
| open `<URL>?action=ping` | JSON: `"actions": 99`, `"configured": true` |
| open `<URL>` (bare) | the SiteTrack website (hero + Register / Sign in) |
| open `<URL>?page=login` | staff sign-in |
| open `<URL>?page=mobile` | worker app (test on a phone) |
| open `<URL>?page=owner` | owner panel — asks for the owner key |
| open `<URL>?action=health` | `"ok": true` |

If `ping` shows `"configured": false`, step 5 (`setupScript`) did not run.

## 10. After EVERY code change

Apps Script **never** updates a live `/exec` link by itself:

**Deploy → Manage deployments → ✏️ (edit) → Version: *New version* → Deploy.**

Same URL, new code. Skipping this is the #1 “my change didn’t appear” cause.

---

## 11. URL map (share these, not file names)

| Link | Screen |
|---|---|
| `<URL>` | public website |
| `<URL>?page=login` | staff sign-in |
| `<URL>?page=signup` | company registration (OTP) |
| `<URL>?page=status&requestId=REQ-…` | public application tracker |
| `<URL>?page=mobile` | worker app — add to Home screen on the phone |
| `<URL>?page=app` | staff console (admin / sub-admin) |
| `<URL>?page=owner` | platform owner panel (owner key) |
| `<URL>?action=ping` | API self-test |

Worker phones: open `?page=mobile` → Chrome menu ⋮ → **Add to Home screen**. Offline marks
queue on the device (`sitetrack.offlineQueue`) and replay when the signal returns — validated
against the *captured* time, not the sync time.

---

## 12. First company (the only way one exists)

1. `<URL>?page=signup` → details → **Send OTP** (e-mail) → enter the 6-digit code → submit.
   You get a `REQ-…` id.
2. `<URL>?page=owner` → paste the owner key → **Signup requests → Approve**.
   Google creates the company spreadsheet, the private Drive folder tree and the Super Admin
   account (temp password e-mailed) — all atomically.
3. `<URL>?page=login` → sign in with that temp password → set a new one (≥ 8 chars, letter +
   number) → finish the **4-step setup wizard** (profile → geofence/selfie rules → attendance
   window → working days).
4. Add a project: drop the pin on the map (**Locate**), set the radius, print the QR.
5. Add employees, assign them to the project. Workers open `?page=mobile` and mark attendance
   **inside the geofence with a live selfie** — distance is checked server-side (Haversine).
6. Next day 23:00 the close job marks the unmarked as Absent / Week-off / Holiday — your
   confirmation that the five triggers are alive (see GUIDE.md §8).

---

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| Page says **“SiteTrack setup incomplete — missing file X.html”** | create that HTML file (step 4), then **New version** (step 10) |
| “You do not have permission” or “script not deployed” when running | finish step 8 (Deploy → Web app) |
| `?action=ping` returns an HTML page instead of JSON | redeploy: *Who has access* = **Anyone**, *Execute as* = **Me** |
| Edited code but the site behaves the same | you skipped **New version** (step 10) |
| “Google hasn’t verified this app” during authorisation | Advanced → Go to project → Allow (it is your own code) |
| OTP e-mail never arrives | check Spam; `MailApp` daily quota; `DEV_MODE=true` shows the code in the API response (test only) |
| Owner key lost | re-run `setupScript` — it rotates the key **and** invalidates all sessions (recovery path) |
| Blank white page in the editor on Run | a paste step missed a file — the error names it; re-paste that file |
| Want to start over | delete the `SiteTrack - Platform Master` spreadsheet + Drive folder `SiteTrack`, clear `PLATFORM_MASTER_ID` property, run `setupScript` again |

Quotas that matter at scale (~150 staff / company fit comfortably): 1 500 script-execution
minutes/day, 30 000 `UrlFetchApp` calls/day, 100 MB per spreadsheet, 15 GB Drive.

---

## 14. File map — repository ↔ Apps Script editor

Everything lives in [`backend/`](../backend/) — one repo file = one editor file:

| Repository file | Editor file name | Editor type |
|---|---|---|
| `backend/appsscript.json` | `appsscript.json` (manifest) | Project settings |
| `backend/00_Config.gs` … `backend/22_Frontend.gs` (23 files) | same name without `.gs` | **Script** |
| `backend/tmpl_index.html` (and the other 6 pages) | same name without `.html` | **HTML** |
| `backend/app_css.html`, `*_js.html` (9 assets) | same name without `.html` | **HTML** |

Not needed to run the product (developer extras, safe to ignore):
`frontend/` (byte-identical mirror used only by optional static hosting — `npm run verify`
keeps it in sync), `dev/` (local test harness), `docs/` (this manual), `hrms/` (legacy FocusHR
experiment — **not** part of SiteTrack), `deploy/`, `scripts/`, `.clasp.json.example`.

---

## 15. Optional extras (never required)

* **Static mirror of the same UI** (custom domain lovers): publish `frontend/` on any static
  host and set `API_URL` in `frontend/config.js` to your `/exec` URL. The API still runs only
  on Apps Script. Ignore this unless you know you want it.
* **WhatsApp OTP/alerts:** `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` script properties.
* **Weather rain-day flag:** `WEATHER_ENABLED=true` (Open-Meteo, free).
* **Local development (developers, Node ≥ 18 only):** `npm run dev` · `npm test` (200+ checks)
  · `npm run verify`.

---

*Every number in this guide is read from the code, not from memory. If your copy differs,
check `backend/00_Config.gs` and `backend/04_Router.gs` — or open an issue.*
