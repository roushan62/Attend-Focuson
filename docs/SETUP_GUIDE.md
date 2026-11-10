# FocusOn HRMS 2.0 — Complete Setup Guide

**System:** Windows PC + Google Chrome  
**Audience:** Super Admin setting up FocusOn HRMS 2.0 for the first time  
**Scope:** Single company + multiple branches, Super Admin controls everything  
**Prerequisites:** A Google (Gmail/Workspace) account, Google Chrome, internet access

---

## What this guide covers

Google account preparation → Apps Script project creation → paste source files → run `setupSystem` → install triggers → deploy as web app → Super Admin first login → company / branch / geo-fence / roles / workflows / policies setup → import employees → pilot → go-live checklist.

All steps are done in **Google Chrome on Windows**. No external server, no CDN, no npm build — everything runs on Google Apps Script with Google Sheets as the database.

---

## Phase 1 — Prepare your Google account and Chrome

1. Open **Google Chrome** on your Windows PC.
2. Sign in to your Google account (the account that will own the Apps Script project).
3. Make sure **pop-ups are allowed** for `script.google.com` and `docs.google.com` (Chrome → Settings → Privacy and security → Site settings → Pop-ups and redirects).
4. Open a new Chrome tab and go to <https://script.google.com>. Accept the Terms of Service if prompted.
5. Create a new project: click **+ New Project**. Name it `FocusOn HRMS 2.0`.

> **Tip:** Keep this Chrome window signed in to the same Google account for the entire setup. Switching accounts mid-setup will break the deployment ownership.

---

## Phase 2 — Add the source files

FocusOn HRMS 2.0 ships as 15 server files (`src/00_Config.gs` … `src/14_Api.gs`) and 6 client files (`src/Styles.html`, `src/Index.html`, `src/JsCore.html`, `src/JsSelf.html`, `src/JsHr.html`, `src/JsPayroll.html`, `src/JsAdmin.html`), plus `src/appsscript.json`.

### Option A — Paste files manually (no command-line tools)

1. In the Apps Script editor, delete the default `Code.gs` file.
2. For each server file, click **+ → Script** and name it exactly:
   - `00_Config.gs`, `01_Core.gs`, `02_DB.gs`, `03_Auth.gs`, `04_Access.gs`
   - `05_Org.gs`, `06_Workflow.gs`, `07_Attendance.gs`, `08_Leave.gs`
   - `09_Payroll.gs`, `10_People.gs`, `11_Comms.gs`, `12_Reports.gs`
   - `13_System.gs`, `14_Api.gs`
3. Paste the contents of each matching file from the repository's `src/` folder. Save (`Ctrl+S`) after each.
4. For each client file, click **+ → HTML** and name it exactly (without `.html`):
   - `Styles`, `Index`, `JsCore`, `JsSelf`, `JsHr`, `JsPayroll`, `JsAdmin`
5. Paste the contents. Save each.

### Option B — Use clasp (command line, optional)

If you have Node.js installed on Windows and prefer clasp:

```bash
# Install clasp (one time)
npm install -g @google/clasp

# Log in (opens Chrome)
clasp login

# Create the project
clasp create "FocusOn HRMS 2.0" --type standalone

# Copy the example config and fill in your script ID
copy src\.clasp.json.example .clasp.json
# edit .clasp.json and replace REPLACE_WITH_YOUR_APPS_SCRIPT_PROJECT_ID

# Push all files
clasp push
```

Skip the rest of Phase 2 if you used clasp.

---

## Phase 3 — Set the manifest

1. In the Apps Script editor, click **Project Settings** (gear icon, left sidebar).
2. Enable **"Show 'appsscript.json' manifest file"**.
3. Open `appsscript.json` and replace its contents with the repository's `src/appsscript.json`.
   - Keep `timeZone` as `"Asia/Kolkata"`.
   - Keep `runtimeVersion` as `"V8"`.
   - Keep `webapp.executeAs` as `"USER_DEPLOYING"` and `webapp.access` as `"ANYONE_ANONYMOUS"`.
4. Save (`Ctrl+S`).

The manifest grants: Sheets, Drive, userinfo.email, send_mail, scriptapp, external_request — everything FocusOn needs.

---

## Phase 4 — Initialize the database (`setupSystem`)

1. In the Apps Script editor, open `13_System.gs`.
2. In the function dropdown (top toolbar), select **`setupSystem`**.
3. Click **Run**.
4. Approve the authorization dialogs:
   - Click **Review permissions** → choose your Google account → **Advanced** → **Go to FocusOn HRMS 2.0 (unsafe)** → **Allow**.
   - Approve Sheets, Drive, and Gmail scopes when asked.
5. Open **Executions** (clock icon, left sidebar) and confirm the `setupSystem` run completed with status **Completed**.
6. The result shows:
   - Super Admin: `FO-0001` / temporary password `FocusOn@2026`
   - Admin: `FO-0002` / temporary password `Admin@2026`

> **Save these credentials.** You will change the temporary passwords on first login. Maximum 2 Super Admins.

---

## Phase 5 — Seed demo data (optional, recommended for pilot)

1. In the function dropdown, select **`seedDemoData`**.
2. Click **Run** and approve permissions if asked.
3. Confirm the run completed. This creates:
   - Branches: Head Office Delhi (BR_HO), Mumbai (BR_MUM)
   - Departments: Engineering, HR, Accounts
   - Sample employees: FO-0003 … FO-0006

> For a 200-user load test, run `seedLoadTest200` instead (or after demo data). It creates 200 employees across branches/departments to verify speed at scale.

---

## Phase 6 — Install cron triggers

1. Open `14_Api.gs`.
2. In the function dropdown, select **`installTriggers`**.
3. Click **Run** and approve permissions.
4. Go to **Triggers** (alarm-clock icon, left sidebar). Confirm 7 triggers are installed:
   - `cron_hourly` — every hour
   - `cron_daily` — ~1 AM IST
   - `cron_nightly` — 2 AM IST (auto checkout)
   - `cron_leaveaccrual` — midnight
   - `cron_retention` — 3 AM IST
   - `cron_alerts` — 8 AM IST
   - `cron_digest` — 9 AM IST

These handle auto-checkout, leave accrual, retention, alerts, and digest emails automatically.

---

## Phase 7 — Deploy as a web app

1. Click **Deploy** (top right) → **New deployment**.
2. Select type: **Web app**.
3. Fill in:
   - **Deployment name:** `FocusOn HRMS 2.0 — v1`
   - **Execute as:** `Me` (your account)
   - **Who has access:** `Anyone`
4. Click **Deploy**.
5. Authorize the deployment when prompted.
6. Copy the **Deployment URL** (e.g. `https://script.google.com/macros/s/……/exec`).

> This URL is what employees and admins open in Chrome. It is HTTPS, so geo-fence punch-in and selfie uploads work.

> After any later code change: **Deploy → Manage deployments → Edit → New version → Deploy**.

---

## Phase 8 — Super Admin first login

1. Open the deployment URL in **Google Chrome**.
2. The login screen appears. Sign in as:
   - **Login ID:** `FO-0001`
   - **Password:** `FocusOn@2026`
3. You will be forced to change the temporary password. Set a strong new password and remember it.
4. The Super Admin dashboard loads. From here you control everything.

---

## Phase 9 — Org setup (company, branches, departments, roles)

All done from the Super Admin console in Chrome.

### Company profile
1. Go to **Setup → Company profile**.
2. Enter: company name, legal name, address, state, GSTIN, PAN, primary brand color.
3. Upload logo / signature / stamp (each capped at ~69 KB; embedded in payslip PDFs).
4. Save.

### Branches
1. Go to **Setup → Branches**.
2. Add each branch: name, code (e.g. `BR_HO`, `BR_MUM`), address, state, head employee.
3. For every branch, set **geo-fence** coordinates (latitude, longitude, radius in metres). Example Head Office Delhi: `28.6304, 77.2177, radius 100`.

> Geo-fence is used for check-in/out. If an employee punches outside the radius, the punch is flagged (or blocked, depending on policy).

### Departments & designations
1. **Setup → Departments:** add departments (Engineering, HR, Accounts, …) with optional parent and head.
2. **Setup → Designations:** add designations with level, default role, notice period.

### Shifts & attendance policies
1. **Setup → Shifts:** add shifts (start, end, grace minutes, break minutes, night shift, weekly off days).
2. **Setup → Attendance Policies:** set geo radius, selfie requirement, block-or-flag, grace minutes, auto-checkout.

### Holidays
1. **Setup → Holidays:** add holiday dates with name, type, and branch (leave blank for company-wide).

### Roles & permissions
1. **Setup → Roles:** create roles (Super Admin, Admin, HR, Manager, Accounts, Executive, Supervisor, Employee).
2. **Setup → Permissions:** assign permissions to each role with scope (`S` self, `D` department, `T` team, `P` branch, `B` branch+, `C` company, `X` excluded).
3. Super Admin gets everything implicitly; payroll stage actions (prepare/verify/approve/release) need `SETTINGS.payroll.saBreakGlass = 1` (already set by `setupSystem`).

### Workflows
1. **Setup → Workflows:** define approval steps, conditions, and SLAs for leave, attendance regularization, documents, exit, etc.
2. Each step lists approvers by role / department / branch / specific users.

---

## Phase 10 — Import employees

1. Go to **Employees → Import**.
2. Download the CSV template and fill it with columns matching `EMP_HEADERS`:
   `empId, empCode, name, gender, dob, phone, email, address, emergencyContact, bloodGroup, maritalStatus, fathersName, branchId, departmentId, designationId, siteId, managerId, shiftId, attPolicyId, employmentType, doj, probationMonths, confirmed, confirmationDate, noticePeriod, status, photoFileId, joiningLetter, roleId, panel, loginId, passwordTemp, mustChangePassword, createdBy, createdAt, deleted`
3. Upload the CSV. FocusOn validates duplicates (empCode/email/phone) and reports errors row-by-row.
4. For large uploads (200+ employees), the import is batched and fast.

Each employee can also be created individually via **Employees → Add**.

---

## Phase 11 — Pilot and go-live checklist

Before go-live, verify each item in Chrome:

- [ ] Super Admin login works (changed temp password)
- [ ] Admin / HR / Manager can log in with their roles
- [ ] Employee self-service loads (dashboard, punch, leave, payslip, profile, helpdesk)
- [ ] Check-in / check-out records correctly (geo-fence flag/block works)
- [ ] Leave application creates a request and routes through the workflow
- [ ] Leave approval/reject/send-back notifies the employee
- [ ] Payroll precheck and calculate run without errors
- [ ] Payslip PDF generates
- [ ] Bank / PF / ESI export files generate
- [ ] Reports run (headcount, attendance, leave, payroll, finance)
- [ ] Backup creates a Drive file
- [ ] Cron triggers fire (check Executions the next hour)
- [ ] 200-employee load test feels fast and lag-free

If all items pass, announce the go-live date to employees and share the deployment URL.

---

## Daily operations (after go-live)

| Task | Where | Frequency |
|---|---|---|
| Check pending approvals | Super Admin / Manager dashboard | Daily |
| Review attendance board | Attendance → Live board | Daily |
| Run payroll precheck/calculate | Payroll → Monthly run | Monthly |
| Generate payslips + exports | Payroll → Payslips | Monthly |
| Backup | System → Backup | Weekly |
| Review audit log | System → Audit | Monthly |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `setupSystem` fails with permission error | Re-run and approve all Google authorization dialogs |
| Login returns "Invalid login ID or password" | Confirm `setupSystem` ran; use `FO-0001` / `FocusOn@2026` |
| Check-in flagged "Outside geo-fence" | Set branch geo-fence coordinates in Setup → Branches |
| Web app not reflecting code changes | Deploy → Manage deployments → New version → Deploy |
| Cron not firing | Confirm 7 triggers installed in Triggers page; check Executions |
| Payslip PDF blank | Confirm logo/signature/stamp are under ~69 KB each |

---

## Support

FocusOn HRMS 2.0 is a single-company, multi-branch HRMS + payroll on Google Apps Script. The Super Admin controls everything and decides the powers of Admin / Manager / HR. For issues, check the **Executions** log in the Apps Script editor and the **ErrorLog** sheet in the Core DB.

---
<tool_call>
<function=bash>