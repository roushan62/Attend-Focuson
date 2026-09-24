# FocusHR — Complete Step-by-Step Guide

**For: company owners, HR managers and accountants — no coding needed.**
**What you get: a full HR + Payroll system (attendance, leave, expenses, salary, payslips)
running on your own Google account, with a website your staff open on their phones.**

- Time needed for first installation: **45–60 minutes** (one time only)
- Time needed per month after that: **~20 minutes** for the salary run
- Cost: **₹0 extra** — it runs inside Google Apps Script, Sheets and Drive
- Who can do this: anybody who can copy and paste and click a few buttons

---

## 0. What is ready and what is not (read this first)

| Stage | What it is | Status |
|---|---|---|
| **Server code** — 25 `.gs` files | The brain: logins, attendance, leave, expenses, payroll, payslips, reports | ✅ Ready — folder `hrms/` |
| **Client code** — 8 `.html` files | The screens your staff actually see (login, dashboard, punch buttons) | 🚧 Being built now — Part 3 lists the exact files |
| **This guide** | Installation + daily use, step by step | ✅ This document |
| **Test harness** | 349 automatic checks that prove the server works | ✅ Ready — `node dev/hrms-smoke.mjs all` |

> **You can do Parts 1, 2 and 4 today** (create the project + paste the server + install the
> platform). Part 3 (the screens) and everything after it needs the 8 client files, which are
> the next thing I am building. Nothing will be left as "TODO" — a file is either finished and
> listed here, or not yet written.

**Two words you will see again and again**

- **Apps Script** — Google's free "script behind a Google Sheet" tool. We build the whole
  system inside one Apps Script project. You reach it at <https://script.google.com>.
- **Web app URL** — the link Google gives you after deployment, ending in `/exec`. This is
  the website your employees open. You share this link with your team.

---

## Part 1 — Before you start (5 minutes)

### 1.1 What you need

| Item | Notes |
|---|---|
| A Google account | Your normal Gmail is fine. A Google **Workspace** account (business email) is better because you get more email quota and your company name appears on the consent screen. |
| A laptop or desktop with Chrome | Do the installation on a computer, not a phone. The editor is hard to use on a phone. |
| One mobile phone | To test the employee login (OTP + GPS punch). |
| Your company details | Legal name, GSTIN, PAN, address, state, signatory name, logo file (PNG/JPG). |
| Your salary policy | PF/ESIC applicability, Professional Tax state, monthly shift timing, weekly off, attendance radius in metres. |

### 1.2 Golden rules (please read — they save hours)

1. **Type file names exactly as written here.** `Code` is not the same as `code`.
2. **Copy the whole file, every time.** Do not copy half a file — the app will not work.
   Every file has a line count in Part 2 so you can double-check.
3. **Save after every paste** (`Ctrl + S` on Windows, `⌘ + S` on Mac).
4. **Never rename or delete a spreadsheet** that FocusHR creates. Never move the Drive
   folder. Renaming the file is fine; moving or deleting breaks the link.
5. **Do not share the master spreadsheet** with anyone except your accountant/IT head.
   It contains salary and identity data.

---

## Part 2 — Create the project and paste the server files

### Step 1 — Open Apps Script

1. Open Chrome.
2. Go to **<https://script.google.com>**.
3. Sign in with the Google account that will own FocusHR (usually the company account).
4. Click **+ New project** (top left).

### Step 2 — Name the project

1. Click the text **Untitled project** at the top-left.
2. Type `FocusHR` and press Enter.

### Step 3 — Turn on the manifest file

The manifest is a small settings file that tells Google which permissions FocusHR needs.

1. Click **Project Settings** in the left sidebar (the ⚙ gear icon).
2. Scroll down to the **General settings** heading.
3. Tick the checkbox **"Show 'appsscript.json' manifest file in editor"**.
4. Click the **Editor** icon (`<>`) in the left sidebar to go back.

You should now see a file called `appsscript.json` in the file list.

### Step 4 — Paste the manifest

1. Click `appsscript.json` in the left file list.
2. Press `Ctrl + A` then `Delete` to empty it.
3. Paste exactly this:

```json
{
  "timeZone": "Asia/Kolkata",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.send_mail",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```

4. Press `Ctrl + S` to save.

> **What this means in plain words**
> `executeAs: USER_DEPLOYING` = the app runs as **you**, so your Google account pays the
> quota and owns the files.
> `access: ANYONE_ANONYMOUS` = **your employees do not need a Google account** to punch in;
> they log in with their mobile number and an OTP. Their data is still protected because
> every screen goes through a login check on the server.

### Step 5 — Clean up the default file

1. Click the default file `Code.gs` (it has a small `helloWorld` function inside).
2. Do **not** delete the file — we need a file with this exact name.
3. Press `Ctrl + A` then `Delete` to empty it. We will paste the real `Code.gs` in the next step.

### Step 6 — Paste the 25 server files

For **each** row in the table below, do this:

1. Click the **+** button next to **Files** (top-left, above the file list).
2. Choose **Script**.
3. Type the **File name** exactly as shown (no `.gs` — Apps Script adds it).
4. Delete the placeholder text, then paste the **entire** file content from the repo folder
   `Attend-Focuson/hrms/`.
5. Press `Ctrl + S`.

**Paste order does not matter, but do them all.** Use the "Lines" column to confirm you
pasted the complete file (in the editor the line number of the last line is shown at the
bottom of the code area — it must match).

| # | File name | Lines | What it does (plain words) |
|---|---|---|---|
| 1 | `Config` | 1001 | All the settings, all the database table definitions, statutory rates (PF/ESIC/PT/TDS), default roles, leave types, expense heads, letter templates |
| 2 | `Utils` | 495 | Small helpers: dates in IST, password hashing, masking of PAN/Aadhaar/bank, distance calculation, CSV building |
| 3 | `Db` | 421 | Reads and writes the Google Sheets safely and fast; issues IDs like `EMP-0001`; soft-delete only |
| 4 | `Permissions` | 187 | Who can see/do what, and which rows (whole company / one project / one team / only self) |
| 5 | `Audit` | 407 | The audit trail: every important change and every sensitive viewing is recorded |
| 6 | `Auth` | 823 | Logins: company signup with GSTIN + OTP, employee OTP activation, password reset, sessions, impersonation |
| 7 | `Notify` | 432 | In-app bell, email queue, OTP sending, WhatsApp links |
| 8 | `Files` | 298 | Uploads in small chunks, private Drive folders, secure downloads, PDF/CSV saving |
| 9 | `Setup` | 246 | The one-time installer (`setupSystem`), health check, repairs, daily/hourly jobs |
| 10 | `Company` | 901 | Creates a new company workspace (spreadsheet + folders + roles + defaults), settings, branches, roles |
| 11 | `Code` | 448 | The web app entry point and the **single** API function the browser talks to |
| 12 | `SuperAdmin` | 762 | Platform owner screens: companies, subscriptions, tickets, logs, maintenance |
| 13 | `Employees` | 820 | Employee records, salary structures, documents, CSV import, exit process |
| 14 | `Projects` | 503 | Sites/projects with GPS fence, rostering, transfer requests |
| 15 | `Attendance` | 796 | GPS punch in/out, manual marking with reason, corrections, registers |
| 16 | `Leave` | 671 | Leave types, balances, requests, holidays, special requests (advance etc.) |
| 17 | `Expense` | 387 | Expense claims, bills, approvals, payment marking |
| 18 | `PayrollCalc` | 358 | The salary maths only — PF/ESIC/PT/TDS slabs, prorating, overtime |
| 19 | `Payroll` | 770 | The salary run: pre-check → calculate → approve → mark paid |
| 20 | `Payslip` | 578 | 4 payslip designs, PDF creation in Drive, emailing payslips |
| 21 | `Reports` | 1235 | 21 reports (attendance, leave, expense, salary register, PF/ESIC/PT/TDS, cost by site) |
| 22 | `Documents` | 592 | Document vault, letter templates, generated letters register |
| 23 | `Support` | 343 | Helpdesk tickets (company side + platform side) |
| 24 | `Dashboard` | 430 | Company, manager and employee dashboards |
| 25 | `Demo` | 636 | "Seed demo data" and "Reset workspace" tools |

> **Instead of pasting?** If you are comfortable with a terminal you can use
> `clasp` (Google's command-line tool) to upload the whole `hrms/` folder at once —
> see `hrms/docs/CLASP-OPTION.md`. For everyone else, pasting is 100% fine and takes
> about 25 minutes.

### Step 7 — Verify nothing is missing

1. Press `Ctrl + S` once more.
2. Look at the file list: you should have **25 script files** plus `appsscript.json`.
3. Click the function dropdown in the toolbar (top, next to ▶ Run). Scroll it — you should see
   names like `setupSystem`, `dailyHousekeeping`, `hourlySweep`, `runPayrollSelfTest`.

If you see fewer files, paste the missing ones. **Do not guess** — a missing file shows up as
"is not defined" errors later.

### Step 8 — Run the automatic payroll test (optional but recommended)

This proves the salary maths is working on your account before any data exists.

1. In the function dropdown select **`runPayrollSelfTest`**.
2. Click **▶ Run**. Authorise when asked (see Step 10 for the authorisation walkthrough).
3. Click **Execution log** (bottom panel). You should see `ALL PASSED (21/21)` followed by
   21 lines of `PASS …`.

If any line says `FAIL`, stop and read it — it tells you which case failed.

---

## Part 3 — Paste the 8 client files (the screens)

> 🚧 **Status:** these 8 files are the next thing being built. The names below are final, so
> this part will not change. Until they are pasted, the web app shows a friendly
> "FocusHR is almost ready" page instead of the login screen — every other part of the
> system (Parts 2, 4, 5) works.

For each file: **+ → HTML → type the name → paste → `Ctrl + S`**.
Type the name **without** `.html`; Apps Script adds it.

| # | File name | What it contains |
|---|---|---|
| 1 | `Index` | The single page everything loads into: header, sidebar, content area, mobile bottom bar |
| 2 | `Styles` | Colours, fonts (Inter), dark mode, mobile layout, print styles for payslips |
| 3 | `Core` | The browser engine: `api()` caller, token storage, router, toasts, modals, tables, form builder |
| 4 | `Login` | Company login + signup with GSTIN/PAN/OTP, employee phone login, Super Admin login, first-login password change |
| 5 | `Components` | Reusable pieces: stat cards, charts (Chart.js), map picker (Leaflet), file upload, date range, approval box |
| 6 | `SuperAdmin` | The 7 platform screens (companies, verification, revenue, tickets, logs, config, demo tools) |
| 7 | `Company` | The 11 company screens (dashboard, employees, projects, attendance, leave, expenses, payroll, payslips, reports, documents, settings) |
| 8 | `Employee` | The mobile-first employee app with the sticky **Leave · Punch In · Punch Out** bar |

**Important:** `Index` must be the file that builds the page, because the server loads the
page with `HtmlService.createHtmlOutputFromFile('Index')`. The other seven are pulled into it
by the `include()` function (already present in `Code`).

---

## Part 4 — Install the platform (one time, ~5 minutes)

### Step 9 — Make sure everything is saved

Press `Ctrl + S`. All file names in the left list should be black, not grey/italic.

### Step 10 — Run `setupSystem`

1. At the top, choose the function **`setupSystem`** from the dropdown.
2. Click **▶ Run**.
3. Google shows **"Authorization required"** → click **Review permissions**.
4. Choose your Google account.
5. Google warns *"Google hasn't verified this app"* (normal for a private app):
   click **Advanced** → **Go to FocusHR (unsafe)** → **Allow**.
   *(Unsafe here only means "Google has not reviewed it" — the code is yours and runs only in
   your account.)*
6. Wait 20–60 seconds. When it finishes the log shows **`Setup finished at …`**.

### Step 11 — Copy the Super Admin password

In the **Execution log** you will see a box like this:

```
==============================================================
 SUPER ADMIN LOGIN
   email    : yourname@gmail.com
   password : Aa3%Gb$iGK   (also saved in the Logs tab)
   sign in  : <your web app URL>?admin=1
==============================================================
```

**Copy that email + password into a safe place right now** (password manager or a sealed
envelope). It is also written to the **Logs** tab of the master spreadsheet as a `WARN` row.

### Step 12 — Check what was created

`setupSystem` created these four things:

| Created | Where to find it | Name you will see |
|---|---|---|
| Master spreadsheet | Link is printed in the log (`…/spreadsheets/d/…`) | `FocusHR — Master (YYYY-MM-DD)` |
| Drive folder for files | Link is printed in the log | `FocusHR Files` |
| 14 platform tables | Inside the master spreadsheet, as tabs | `Companies`, `Users`, `Sessions`, `OtpCodes`, `Subscriptions`, `Revenue`, `SystemConfig`, `SuperTickets`, `SuperTicketComments`, `EmailQueue`, `AuditLog`, `Logs`, `Notifications`, `Counters` |
| 2 automatic jobs | Apps Script → **Triggers** (clock icon) | `dailyHousekeeping` (2 AM daily), `hourlySweep` (every hour) |

**Bookmark the master spreadsheet link.** That is your control room for the platform.

### Step 13 — If you missed the password

1. Open the master spreadsheet → **Logs** tab.
2. Filter the **level** column for `WARN` and look for `SUPER ADMIN TEMPORARY PASSWORD`.
3. Still stuck? In the editor, temporarily change the `setupSystem` function's first line to
   `function setupSystem(options) {` and run it with a temporary wrapper: create a new script
   file, paste `function resetSuper() { setupSystem({ reset_super_password: true }); }`,
   run `resetSuper`, read the new password from the log, then **delete that temporary file**.

> You can always re-run `setupSystem` later. It never deletes data — it only creates what is
> missing and repairs broken links.

---

## Part 5 — Put it on the internet (deploy the web app)

### Step 14 — Create the deployment

1. Click the blue **Deploy** button (top right) → **New deployment**.
2. Click the ⚙ gear icon next to "Select type" → choose **Web app**.
3. Fill in:
   - **Description:** `FocusHR live`
   - **Execute as:** `Me (your-email@gmail.com)`
   - **Who has access:** `Anyone`
4. Click **Deploy**.
5. If asked again about permissions: **Authorize access** → pick account → **Advanced** →
   **Go to FocusHR (unsafe)** → **Allow**.

### Step 15 — Copy the web app URL

After deploying you get a **Web app URL** ending in `/exec`, like:

```
https://script.google.com/macros/s/AKfycb...long-string.../exec
```

**Copy it. This is your company's HR website.** Useful variations of the same link:

| Link | What it opens |
|---|---|
| `<URL>` | Company login (default) |
| `<URL>?admin=1` | Super Admin login (keep this private!) |
| `<URL>?c=CMP-0001` | Company-branded login page for one specific company |
| `<URL>/exec` and add `?c=` for multi-company setups | Show the right logo/branding automatically |

### Step 16 — Share it with your team

1. Send the plain `<URL>` on your staff WhatsApp group.
2. Tell employees: *"Open this link, tap Employee Login, enter your mobile number, and use the
   OTP you receive."*
3. On Android/iPhone, staff can tap **⋮ → Add to Home screen** so it behaves like an app.

### Step 17 — Testing vs live link

| Link type | When to use |
|---|---|
| `/dev` (from Deploy → Test deployments) | Only you, always the newest code. Use while setting up. |
| `/exec` (the deployed URL) | Everybody. Use after you press **Deploy → Manage deployments → ✏ → Version: New version → Deploy** |

---

## Part 6 — First sign-in as Super Admin

### Step 18 — Sign in

1. Open `<URL>?admin=1`.
2. Email: the Super Admin email from Step 11.
3. Password: the temporary password.
4. FocusHR forces you to **set a new password** (at least 8 characters, and it must not be a
   common word). Use something like `Sharma@HR#2026`. **Write it down.**

### Step 19 — The 7 Super Admin screens

| Screen | What you do there |
|---|---|
| **Dashboard** | Companies, active users, revenue, pending verifications, recent activity |
| **Companies** | Approve/reject signups, view a company, impersonate (login as their admin with an audit trail), suspend, extend subscription |
| **Subscriptions & Revenue** | Plans, billing cycles, payment records |
| **Platform tickets** | Support tickets raised by companies; reply here |
| **System config** | App name, support email, "Require manual verification" toggle, WhatsApp Cloud API credentials, email sender name — secrets are stored in Apps Script properties, never in the sheet |
| **Logs & audit** | Platform logs, audit trail, sensitive-read log, email queue |
| **Demo data** | Create a practice company, reset a workspace (see Part 12) |

### Step 20 — Decide your verification policy

1. Go to **System config**.
2. `Require manual verification`:
   - **ON (recommended to start):** every new company signup lands as `PENDING` until you
     approve it. Safer — you meet your customers.
   - **OFF:** a company becomes `ACTIVE` immediately after OTP verification. Faster, use once
     you trust your signup funnel.

### Step 21 — (Optional) WhatsApp

If you want punch confirmations and payslip notices on WhatsApp:

1. Create a WhatsApp Business Cloud API account with Meta.
2. In FocusHR → **System config**, paste the **Phone number ID** and **Access token**.
3. Leave them empty to use the free `wa.me` click-to-chat fallback: FocusHR opens WhatsApp with
   the message already typed.

---

## Part 7 — Onboard a company

### Step 22 — How a company signs up (self-service)

1. Open `<URL>` → **Company Login** → **Create account**.
2. Fill: legal name, GSTIN, PAN, state, city, pincode, industry, size, your name, email,
   mobile, and a password.
3. FocusHR validates the **GSTIN format** and checks the **state code matches the state you
   picked**; PAN format is validated too.
4. A **6-digit OTP** is emailed to you (valid 10 minutes, max 5 tries; resend after 45 s).
5. Enter the OTP → the company workspace is created (status `PENDING` if verification is ON).
6. If the GSTIN is already registered you get exactly this message:
   **"This company is already registered. Please log in."**
7. Super Admin approves → the admin gets an approval email and can log in.

### Step 23 — What a company workspace contains

| Created automatically | Name |
|---|---|
| Its own Google spreadsheet | `FocusHR — <Company Name> (CMP-0001)` |
| Its own private Drive folder | `FocusHR Files / <Company Name> (CMP-0001) / …` |
| 31 tabs | Employees, SalaryStructures, Projects, Attendance, LeaveRequests, ExpenseClaims, PayrollRuns, PayrollItems, Payslips, Documents, Tickets … |
| 6 roles | Company Admin, HR Manager, Project Manager, Supervisor, Accountant, Employee |
| 6 leave types | Casual (CL), Sick (SL), Earned (EL), Leave Without Pay (LWP), Maternity (ML), Paternity (PL) — add your own any time |
| 9 expense categories | Travel (bus/train/flight), Local conveyance, Food & refreshments, Hotel & stay, Site material, Fuel, Mobile & internet, Medical reimbursement, Other |
| 9 letter templates | Offer, Confirmation, Salary certificate, Experience, Relieving, Warning, Promotion, Site transfer order, Internship certificate |
| Holiday list | National + popular holidays for the current and next year (editable) |

**Rule of thumb:** the master spreadsheet holds *accounts*; each company spreadsheet holds
*one company's data*. Companies can never see each other.

---

## Part 8 — Company setup (do this once per company, ~30 minutes)

Log in at `<URL>` with the company admin email and password.

### Step 24 — Company profile & policy (Settings)

| Setting | What to enter |
|---|---|
| Company name / legal name | Exactly as on your GST certificate |
| Logo | PNG/JPG under 1 MB (appears on payslips and letters) |
| Brand colour | Hex code, e.g. `#0f766e` |
| Registered address, state | Used on payslips and statutory reports |
| PF / ESIC / PT / TDS | Turn each on/off for your company; the PT **state** decides the slab |
| Attendance radius | Default **50 m** (10–5000 m allowed) |
| GPS accuracy limit | Default **100 m** — punches with worse GPS are refused as `GPS_WEAK` |
| Shift start / end, grace | e.g. 09:00 / 18:00 with 15 minutes grace |
| Weekly off | Sunday (or your site's off day) |
| Work hours per day | 8 |
| Regularisation window | How many past days an employee may ask to correct (default 7) |
| Expense submission window | Days within which a bill can be claimed (default 60) |

### Step 25 — Branches

Add each office/site office with name, address, city, state, pincode, in-charge and optional
lat/lng. Attendance and reports can be filtered by branch.

### Step 26 — Roles & permissions

1. Open **Roles**. Each role shows its permission grid (module × view/create/edit/delete/approve/export).
2. Data scope decides **which rows** the person sees:
   - `ALL` — whole company (Admin, HR, Accountant)
   - `PROJECT` — only the sites they are mapped to (Project Manager)
   - `TEAM` — only their reporting team (Supervisor)
   - `SELF` — only their own records (Employee)
3. Need a one-off exception? Use **User permission overrides** (grant or revoke a single right
   for one person, with a reason and an expiry date). Every override is audited.

### Step 27 — Projects / sites with GPS fence (the heart of attendance)

For every site:

1. Open **Projects** → **Add project**.
2. Enter name, code (or let FocusHR give `PRJ-0001`), client, city, state, start date, shift.
3. **Set the location:** allow the browser to use your location *while standing at the site
   gate*, or type latitude/longitude, or drop the pin on the map.
4. Set the **radius** (10–5000 m). 50–100 m for a gate, 300–500 m for a large site.
5. Save. The pin/radius is locked once attendance is recorded against it (Super Admin/Admin can
   change it and the change is audited).

### Step 28 — Add employees

**One by one:** **Employees → Add employee** → fill personal details, contact, address,
emergency contact, bank, PAN, Aadhaar **last 4 digits only**, PF UAN, ESIC IP number,
department, designation, employment type, joining date, work state, reporting manager,
branch, project → Save.

**In bulk (recommended):**

1. **Employees → Import CSV** → download the template.
2. Fill one row per employee in Excel/Google Sheets. Column order does not matter — the
   importer detects columns by their heading.
3. Upload → FocusHR shows a **preview**: every row marked OK or with the exact error
   (bad PAN, bad IFSC, missing joining date, bad mobile).
4. Fix the flagged rows in the file and re-upload, or fix them in the preview.
5. Click **Import** — only the OK rows are committed.

### Step 29 — Salary structures

For each employee: **Employees → open profile → Salary** → enter Basic, HRA, DA,
Conveyance, Special allowance, Other allowance, and tick PF/ESIC/PT/TDS applicability.
FocusHR shows the monthly gross instantly. Any change is versioned with an effective date, so
old payslips never change.

### Step 30 — Assign employees to sites

**Projects → Team** → add each employee with a role on site (`Mason`, `Supervisor`…), shift
and date range. Moving an employee to another site later: **Transfer request → approve with a
remark** — the primary project switches, old and new assignment rows stay for history.

### Step 31 — Optional polish

| Task | Where |
|---|---|
| Upload employee documents (Aadhaar, PAN, licence, certificates) | Employee profile → Documents (set an expiry date to get reminders) |
| Company documents (licences, insurance, agreements) | Documents (company vault) |
| Letter templates | Documents → Templates (edit the wording, keep `{{placeholders}}`) |
| Holidays | Leave → Holidays (add your local/festival offs) |
| Leave types | Leave → Leave types (accrual per month, max balance, carry forward, needs document?) |
| Expense categories | Expenses → Categories (per-claim limit, bill required?) |
| Letter templates | Documents → Templates (add a brand-new letter with your own wording) |

---

## Part 9 — Your employees start using it

### Step 32 — Give them the link

Share `<URL>` (or `<URL>?c=CMP-0001` so their page shows your logo).

### Step 33 — First-time activation (employee)

1. Open the link → **Employee Login**.
2. Enter the **mobile number** HR saved for them (this is their login ID).
3. If the number exists in more than one company, FocusHR asks which company.
4. Tap **Send OTP** → receives a 6-digit code by SMS/WhatsApp/email (see the note below) →
   enters it → **sets their own password**. Now they can log in with mobile + password.
5. Forgot password later? Same screen → **Send OTP** → reset. No HR involvement needed.

> **OTP delivery:** FocusHR sends through the channel you configured in System config.
> If no SMS/WhatsApp provider is set up, the OTP is written into the platform **Logs** tab and
> emailed to the employee's email address, and HR can read it out. Everything is in one place:
> `Notify.sendOtp`.

### Step 34 — The employee app (mobile)

| What you see | What it does |
|---|---|
| **Home** | Today's status, this month's attendance, leave balance, latest payslip, notice board |
| **Punch In** (big green button, bottom bar) | Asks GPS permission → checks distance from the site → records the punch or explains: *"You are 5.6 km away from Baner Annexe — the allowed radius is 90 m. Please move closer to the site and try again, or ask your supervisor for manual attendance."* |
| **Punch Out** (red button) | Same check; calculates worked hours and overtime |
| **Leave** | Apply (type, dates, half-day morning/evening, reason, document if required), see balance, status, cancel |
| **Attendance** | Own calendar/register, plus **Raise correction** if a punch failed — goes to the supervisor with the reason |
| **Expenses** | Add a claim with bill photo, submit, track approval, see payment status |
| **Payslips** | Month-wise list; tap to view the styled payslip and download the PDF |
| **Profile** | Own details, bank, documents, emergency contact, change password |
| **Support** | Raise a ticket to HR; chat thread with HR replies |

**Anti-spoofing built in:** the server (not the phone) decides if a punch is genuine — it
compares the GPS against the site radius, rejects low-accuracy readings, and flags impossible
accuracy values (e.g. 0 m) as suspicious. Flagged punches appear in the admin register.

---

## Part 10 — Daily operations (admin & HR)

### Step 35 — Every morning (2 minutes)

| Screen | What to look at |
|---|---|
| Dashboard | Present today, absent today, who has not punched in yet, site-wise coverage |
| Attendance → Register | Late arrivals, flagged punches, missing punch-outs |

### Step 36 — Fix a missed punch (manual attendance)

1. **Attendance → Register → pick the date/person → Mark manually.**
2. Choose the status (`PRESENT`, `HALF_DAY`, `ABSENT`, `LEAVE`, `MISSING_PUNCH`…) and the times.
3. **A reason is mandatory** — it is stored in the audit trail and the employee gets a
   notification. Manual entries are marked `ADMIN` in the register so they can never be
   confused with genuine GPS punches.

**Bulk marking** (site closed but paid, rain day, etc.): **Attendance → Bulk mark** → pick the
date, tick the employees, enter the reason → all rows are created and audited.

### Step 37 — Handle corrections and approvals

| Queue | Decision |
|---|---|
| Attendance corrections (employee requested) | Approve (with a remark) or Reject (with a reason). Approving writes the corrected attendance automatically. |
| Leave requests | Approve/Reject **with a remark** — the remark is shown to the employee and stored forever. Approving adjusts the balance. |
| Special requests — salary advance, overtime payout, comp-off, conveyance, medical help, bonus, other | Approve/Reject with a remark; for money requests the amount is recorded and flows into the salary run |
| Expense claims | Approve (can reduce the amount — up to 1.5× the claimed value is allowed with a remark) or Reject with a reason. |
| Transfers | Approve/Reject with a remark; approving switches the employee's primary site. |

**Rule everywhere:** approve/reject *always* needs a remark. If you try without one, FocusHR
blocks it and says so.

### Step 38 — Pay a claim outside payroll

**Expenses → select claims → Mark paid** → enter mode (NEFT/UPI/Cash) and the reference
number. Claims already inside a salary run cannot be paid twice — the system links them once.

---

## Part 11 — Month-end payroll (the 20-minute routine)

Do this after the last working day of the month.

### Step 39 — Close attendance first (10 minutes)

1. **Attendance → Register** for the month: fix missing punch-outs, approve pending
   corrections and leave, check the late/overtime numbers.
2. **Reports → Attendance Summary** and **Attendance Register** → export CSV if your
   supervisor keeps a paper register. Reconcile.
3. Remember: days with no record at all are treated as **absent (loss of pay)**. That is why
   Step 39 matters.

### Step 40 — Create the salary run

1. **Payroll → New run.**
2. Choose the **Financial Year** (April–March) and the **month**.
3. Choose the days basis: `CALENDAR` (all days of the month) or `WORKING` (exclude weekly offs
   and holidays).
4. Save. Status = `DRAFT`.

### Step 41 — Read the pre-check (this is your safety net)

The pre-check shows three lists:

| List | Meaning | What to do |
|---|---|---|
| **Blockers** | Employee has no salary structure (basic = 0). Calculation is refused until fixed. | Click the employee → Salary → enter amounts |
| **Warnings** | Missing PAN, missing bank account, no attendance rows for the month | Fix before paying (TDS/NEFT need these) |
| **Infos** | PF UAN / ESIC number missing, 5+ absent days, incomplete punches | Your call — usually fine to proceed |

Claims section: approved expense claims up to the period end are added as reimbursement and
**locked so they can never be paid twice**.

### Step 42 — Calculate

1. Click **Calculate**. Work happens in chunks of ~50 employees, so even a few hundred
   employees finish without hitting Google's time limit.
2. Watch the progress bar: `processed / total`, chunk numbers, live totals.
3. If the run stops midway (browser closed, quota hiccup), press **Resume** — it continues from
   where it stopped. Old runs are swept automatically every hour by the `hourlySweep` trigger.
4. Status becomes `CALCULATED`.

### Step 43 — Review and adjust

Open the run → each row shows present days, paid days, LOP days, gross, PF, ESIC, PT, TDS,
advance recovery, reimbursement and net pay.

| Adjustment | How |
|---|---|
| Site bonus, Diwali bonus | Edit the row → **Bonus** |
| Overtime hours | Edit the row → **OT hours** (rate comes from the structure, default 2×) |
| Extra deduction / advance | Edit the row → **Advance / other deduction** |
| Do not pay someone this month | Edit the row → **Hold** with a reason |
| Recalculate one person | Edit → **Recalculate** |

Every change is audited with who/why.

### Step 44 — Approve

1. Click **Approve**. A **remark is required** (e.g. *"Verified against the site register."*)
2. Status becomes `APPROVED`. Nobody can silently change the numbers after this point.

### Step 45 — Mark paid + generate payslips

1. Click **Mark paid** → enter payment reference (e.g. `NEFT-20260901-BATCH1`), mode (NEFT/UPI/
   Cash), a remark, and tick **Generate payslips**.
2. FocusHR then:
   - marks the run `PAID`,
   - creates the payslip PDF for every employee in Drive
     (`FocusHR Files / <Company>/Payslips/<FY>/<Month>/`),
   - links the approved expense claims to this run and marks them `PAID`,
   - locks the month's attendance (`payroll_locked`), so later edits to that month are refused
     until you reverse the payroll.

### Step 46 — Send payslips

1. **Payroll → Payslips → select all → Email** (or send one at a time).
2. Employees also see them under **Payslips** in the app immediately.
3. Choose the design per payslip if you like: `CLASSIC`, `MODERN`, `COMPACT` or `MINIMAL`
   (all A4, print-ready, with the company logo and net pay in words).

### Step 47 — Statutory follow-up

| Report | Where | Use it for |
|---|---|---|
| Salary Register | Reports → Payroll | Your own voucher / bank file |
| PF Statement | Reports → Compliance | ECR upload |
| ESIC Statement | Reports → Compliance | ESIC portal |
| Professional Tax | Reports → Compliance | State PT return |
| TDS Statement | Reports → Compliance | Quarterly TDS / 24Q |
| Compliance Summary | Reports → Compliance | One-page due-date tracker |
| Salary cost by project | Reports → Payroll | Site-wise costing |

Every report has **Export CSV** and can also be **saved straight into the company Drive
folder** (`Reports/<FY>/`) with an audit entry.

---

## Part 12 — Practice safely with demo data

### Step 48 — Create a practice company

1. Sign in as Super Admin (`?admin=1`) → **Demo data → Seed demo workspace**.
2. FocusHR creates *Sunrise Infra Demo Pvt Ltd* with 2 branches, 3 sites, up to 16 employees,
   ~60 days of attendance, leave balances and requests, expense claims, payroll runs and
   payslips.
3. Demo logins:
   - Admin: `admin@sunrise-demo.test` / `Demo#Focus2026`
   - Employees: as shown on the seeded employee records (phones `9820000001…`)
4. Use this tenant to train your HR team. It never touches your real company.

### Step 49 — Reset a workspace completely

1. **Demo data → Reset workspace** → pick the company → type **`DELETE`** in the confirmation
   box (typed exactly; anything else is refused).
2. Result: all company rows removed, IDs start again from 1, settings/roles/leave
   types/categories/holidays restored to defaults, all non-admin logins disabled, and the demo
   admin password reset to `Demo#Focus2026`.
3. Use this on the practice tenant, or at the very end of a trial, **never** on live data.

---

## Part 13 — Automatic jobs and upkeep

### Step 50 — The two triggers (already installed)

| Trigger | Runs | What it does |
|---|---|---|
| `dailyHousekeeping` | Daily ~2 AM | Closes expired sessions, sends queued emails, sends document-expiry reminders, finishes any payroll run that got stuck |
| `hourlySweep` | Every hour | Sends queued emails, resumes stuck payroll runs |

Check them at any time: Apps Script → **Triggers** (clock icon). To add them again after a
rebuild, run `setupSystem` or `Setup.installTriggers`.

### Step 51 — Monthly maintenance (5 minutes)

Super Admin → **System config → Maintenance**:

| Task | What it does |
|---|---|
| `integrity` | Checks every table for broken rows; you want "0 errors" |
| `rebuild_counters` | Re-reads the highest ID in each table and fixes the counter (run it if you ever see a duplicate-ID error) |
| `prune_sessions` | Logs out expired sessions |
| `flush_emails` | Sends anything still sitting in the email queue |
| `repair_tables` | Recreates any missing tab/column in the master or a company spreadsheet |
| `archive_logs` | Saves audit rows older than N days to a CSV in Drive and removes them from the sheets |

### Step 52 — Backups (do this monthly)

1. **Master spreadsheet:** File → Make a copy → name it `FocusHR Master backup YYYY-MM`. Move
   the copy into a `Backups/<Year>` Drive folder.
2. **Each company spreadsheet:** same. (File → Make a copy.)
3. Keep the last 12 monthly copies. Google Sheets version history is your second safety net
   (File → Version history → See version history).
4. Do **not** rename the live spreadsheets — FocusHR finds them by their stored ID, so renaming
   is fine, but deleting is not.

### Step 53 — Security habits

| Habit | Why |
|---|---|
| Super Admin password only with the owner | It can impersonate any company admin (every impersonation is audited) |
| Give each person their own login | The audit trail then shows who did what |
| Use `?admin=1` on your own device only | Never put the Super Admin link in a group chat |
| Bank details, PAN and Aadhaar are masked in the UI | Full values never reach the browser unless you press reveal, and revealing is audited |
| Review **Audit log → Sensitive** monthly | It lists every salary/document reveal |
| Remove a leaving employee the same day | Employee profile → Exit → last working date; their login stops immediately |

---

## Part 14 — Updating FocusHR later

### Step 54 — When you receive updated files

1. Open the Apps Script project → open the file that changed.
2. `Ctrl + A` → `Delete` → paste the complete new file → `Ctrl + S`.
3. If a new file appears in the release notes, **+ → Script/HTML → add it**.
4. If `appsscript.json` changed, paste it too.
5. Run `setupSystem` once (safe — it only adds what is missing), or run
   `Setup.repair` from the maintenance screen.
6. **Deploy → Manage deployments → ✏ pencil → Version: New version → Deploy.**
   *(Updating the code alone does not update the live `/exec` link — this step does.)*

### Step 55 — Roll back if an update misbehaves

Apps Script keeps your project history: **File → Version history → See version history** →
restore an earlier version → then deploy a new version of the web app.

---

## Part 15 — Quick reference

### 15.1 Server files (25) — already in the project after Part 2

`Attendance` `Audit` `Auth` `Code` `Company` `Config` `Dashboard` `Db` `Demo` `Documents`
`Employees` `Expense` `Files` `Leave` `Notify` `Payroll` `PayrollCalc` `Payslip` `Permissions`
`Projects` `Reports` `Setup` `SuperAdmin` `Support` `Utils` — plus `appsscript.json`

### 15.2 Client files (8) — Part 3

`Index` `Styles` `Core` `Login` `Components` `SuperAdmin` `Company` `Employee`

### 15.3 Links cheat-sheet

| Purpose | Link |
|---|---|
| Apps Script editor | <https://script.google.com> |
| Company / employee login | `<web-app-url>` |
| Super Admin login | `<web-app-url>?admin=1` |
| Branded login for one company | `<web-app-url>?c=CMP-0001` |
| Master spreadsheet | printed by `setupSystem`; also the link saved in the Drive folder |
| Company spreadsheet | Super Admin → Companies → open company → spreadsheet link |
| Drive root | `FocusHR Files` in your Drive |

### 15.4 ID formats

| Prefix | Means | Example |
|---|---|---|
| `CMP-` | Company | `CMP-0001` |
| `USR-` | User login | `USR-0007` |
| `EMP-` | Employee | `EMP-0012` |
| `PRJ-` | Project/site | `PRJ-0003` |
| `ATT-` | Attendance row | `ATT-4821` |
| `LVE-` | Leave request | `LVE-0031` |
| `CLM-` | Expense claim | `CLM-0009` |
| `PYR-` | Payroll run | `PYR-0002` |
| `PSL-` | Payslip | `PSL-0014` |
| `AUD-` | Audit entry | `AUD-90021` |

### 15.5 Numbers you can change in Settings

Attendance radius (50 m) · GPS accuracy limit (100 m) · shift start/end and grace ·
weekly off day · work hours/day (8) · regularisation window (7 days) · expense claim
window (60 days) · PF 12% both sides, wage ceiling ₹15,000 · ESIC 0.75% / 3.25%,
ceiling ₹21,000 · PT slab by state · TDS new regime, standard deduction ₹75,000,
87A rebate ₹12,00,000 · overtime multiplier (2×).

> Every statutory number lives in **one place** (Settings → Payroll rates) so when the
> government changes a rate you edit it once, and old payslips stay untouched.

### 15.6 Word list

| Word | Meaning in FocusHR |
|---|---|
| **Geofence** | The invisible circle around a site; punches outside it are refused |
| **LOP** | Loss of Pay — an unpaid day reduces the salary |
| **Regularisation** | An employee's request to correct a wrong/missing punch |
| **Reimbursement** | An approved expense claim added to net pay in the salary run |
| **Payroll lock** | After `PAID`, that month's attendance can no longer be edited |
| **Tenant / workspace** | One company's private spreadsheet + Drive folder |
| **Impersonate** | Super Admin logging in as a company admin to help (always audited) |

---

## Part 16 — If something goes wrong (quick fixes)

| What you see | What it means | Fix |
|---|---|---|
| "FocusHR is almost ready" page instead of the login screen | The client HTML files are not in the project yet | Do Part 3 (paste the 8 HTML files), then **Deploy → Manage deployments → New version** |
| `setupSystem is not defined` | The `Setup` file was not pasted or was renamed | Paste `Setup.gs` (246 lines) |
| "Authorization required" loop | Consent not completed | Run any function once, choose **Advanced → Go to FocusHR (unsafe) → Allow** |
| `UNKNOWN_ACTION` after an update | Client and server versions differ | Deploy a **new version**; hard-refresh the page (`Ctrl + Shift + R`) |
| Punch rejected: "You are X km away…" | Employee is outside the site radius | Check the site pin and radius; if wrong, fix the project (audited); otherwise use manual attendance with a reason |
| Punch rejected: `GPS_WEAK` | Phone GPS accuracy is poor (indoors, basement) | Step outside, wait 10 seconds, punch again |
| "This company is already registered. Please log in." | GSTIN already exists | Use Company Login; if the admin is gone, Super Admin can reset the admin password |
| Employee OTP not received | No SMS gateway configured | Look at the platform **Logs** tab — the OTP is logged and emailed; read it out to the employee once |
| Salary run says "N employee(s) need a salary structure" | Basic salary missing | Payroll → pre-check list → open each employee → Salary → enter amounts |
| Net pay looks wrong | Attendance day basis or LOP | Open the run → the item shows LOP days; check Attendance register and Settings → days basis |
| "This day is already included in a paid payroll run" | Attendance is locked after payment | Reverse/cancel the run (Super Admin) or mark attendance next month |
| Employee sees another employee's data | Should never happen | Send me the action name and the two IDs immediately; check Roles → data scope for that person |
| Duplicate ID error | Counter drift after manual sheet edits | Maintenance → `rebuild_counters` |
| Emails not arriving | Daily quota finished or queued | Maintenance → `flush_emails`; check `MailApp` quota in health; consider Google Workspace |
| Slow screens in a big company | Too many rows on one page | Use the filters (month/project/department) and page size; ask me to add an index/report |

A longer 15-item troubleshooting list, the known-limitations note and the DPDP-aware privacy
statement ship with the operations pack in the final phase.

---

## Part 17 — Go-live checklist (print this)

**Installation**
- [ ] Project named `FocusHR`, manifest pasted, 25 server files pasted, all saved
- [ ] `runPayrollSelfTest` → `ALL PASSED (21/21)`
- [ ] `setupSystem` run; master spreadsheet + Drive folder created
- [ ] Super Admin email + temp password saved in a safe place
- [ ] Web app deployed (`Execute as Me`, `Anyone`), `/exec` URL copied
- [ ] 8 client files pasted → new version deployed → login screen opens

**Platform**
- [ ] Super Admin password changed
- [ ] `Require manual verification` set the way you want
- [ ] (Optional) WhatsApp credentials added
- [ ] Demo tenant seeded and trainers walked through it

**Company**
- [ ] Company profile, logo, brand colour, statutory toggles and PT state set
- [ ] Attention radius, GPS accuracy limit, shift and weekly off set
- [ ] Branches added
- [ ] Roles reviewed; senior staff given `ALL`, supervisors `TEAM`, PMs `PROJECT`
- [ ] Every live site added **with correct pin + radius**
- [ ] Employees imported; PAN, bank account and IFSC correct for everyone
- [ ] Salary structures entered for everyone (pre-check must show 0 blockers)
- [ ] Site assignments created; reporting managers set
- [ ] Holiday list checked; leave types and expense limits reviewed

**First month**
- [ ] Employees activated on their phones (OTP) and punched at the gate
- [ ] First correction request approved with a remark
- [ ] First salary run: pre-check clean → calculate → review → approve → mark paid
- [ ] Payslips emailed; PF/ESIC/PT/TDS reports downloaded and filed
- [ ] Backup copy of master + company spreadsheets taken
- [ ] Audit log reviewed once

---

*FocusHR step-by-step guide · v1.0 · applies to server build 25 files / 15,000 lines and the
8-file client · keep this file with your HR documents, and update it whenever you deploy a new
version.*
