# Astra HR & Payroll

Multi-tenant HR & Payroll SaaS built **only** on Google Apps Script.

| File | Role |
|---|---|
| `Code.gs` | The whole server: `doGet`, the single `api(action, token, payload)` entry point, `setupSystem()`, `seedDemoData()` |
| `Index.html` | The whole client: inline CSS, JS, SVG icons and charts. No CDN, no external files |
| `appsscript.json` | Manifest (Asia/Kolkata, V8, OAuth scopes, web-app access) |

Google Sheets is the database (one master spreadsheet, every row scoped by `companyId`). Google Drive stores uploads; only the file ID is kept in the sheet.

## How to deploy

1. Go to <https://script.google.com> → **New project**. Name it, e.g. "Astra HR".
2. Replace the default `Code.gs` with this repo's `Code.gs`.
3. Add an HTML file named exactly `Index` (**+ → HTML**) and paste in `Index.html`.
4. Open **Project Settings → Show "appsscript.json" manifest file**, and paste this repo's `appsscript.json` over it. Keep the timezone at `Asia/Kolkata`.
5. Select `setupSystem` in the function dropdown and click **Run**. Approve the permissions (Sheets, Drive, email).
6. Open **Execution log**. It prints the spreadsheet URL, the Drive folder URL, the Super Admin login and a **temporary password**. Copy them.
7. *(Optional)* Run `seedDemoData` to load a demo company ("Bharat Build Co"). Sign in as `demo@astra-demo.com` or an employee phone `9876500001`–`9876500008`, all with password `Demo@1234`.
8. **Deploy → New deployment → Web app**. Execute as **Me**. Who has access: **Anyone** (users still sign in with the app's own login). Click **Deploy** and open the URL.
9. Sign in at **Company admin → Platform sign in** with the Super Admin login. You will be asked to change the temporary password.
10. After any later code change, use **Deploy → Manage deployments → Edit → New version**.

### Using it
- **Companies** register at *Register your company* (GSTIN validated). The Super Admin approves them under **Companies**. Approval can be switched off in **Platform settings**.
- **Admins** sign in with email. They add employees, who get a one-time **activation code**. **Employees** choose *Employee → Activate my account* and sign in with their **phone number**.
- Punch-in needs GPS. Test on a phone over HTTPS (the web-app URL is HTTPS).

### Notes
- Extra sheet tabs beyond the 27 specified ones are created for settings, holidays, notifications, employee profiles, payroll breakups and decisions.
- Brand logos, signature and stamp are capped at ~69 KB (they are embedded in payslip PDFs).
- Quotas: Apps Script limits apply (6 min per execution). Payslips are generated in batches of 15 per call.
