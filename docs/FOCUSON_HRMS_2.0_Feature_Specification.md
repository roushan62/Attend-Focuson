# FOCUSON HRMS 2.0 — Complete Software Specification (Verification Document)

**Prepared for:** FocusOn (internal company use) · **Date:** 10 November 2026
**Base:** `FOCUSON_HRMS_Complete_Plan_v2.docx` + purana software "Astra HR" (`Code.gs` + `Index.html`)
**Status:** Aapke verification ke liye — approve hone ke baad hi complete coding hogi.

> **Kaise verify karein:** Har feature ka ek ID hai (jaise `ATT-05`, `PAY-10`). Aap sirf ID likh kar bata sakte hain:
> `ATT-05: OK` · `LV-03: change → half day sirf CL mein` · `REC-08: remove`.
> Section 32 mein saare important **decisions** ek table mein hain (meri recommendation default rakhi hai).

---

## 0. Ek page mein summary

| Point | Detail |
|---|---|
| Kya ban raha hai | FocusOn ka internal **HR + Payroll** software — sirf Google products par (Apps Script + Sheets + Drive + Gmail). Koi paid hosting, database ya subscription nahi. |
| Upgrade kya hai | Purana **Astra HR** (multi-company SaaS: companies register hoti thi) → naya **FocusOn HRMS 2.0** (single company FocusOn + multiple branches/offices/sites). |
| Sabse important hissa | **Permission & Authority Engine** — Super Admin decide karega ki **Admin, HR, Manager, Accounts, Executive (CEO/Director), Supervisor, Employee** aur koi bhi **custom role** kya **dekh / bana / badal / delete / approve / export** kar sakta hai, **kis scope tak** (khud / team / department / branch / company) aur **kitni limit tak** (amount / days). |
| Size | 21 modules · ~145 permissions · 23 request types (approval chains) · 35+ reports · 17 letter templates |
| Capacity | **200 users fast (priority)** — monthly partition, caching, batch read/write. Design 1000+ users tak; uske aage database shift ka raasta ready. |
| Deliverables | Complete source code (Apps Script project), **alag Complete Setup Guide (stepwise)**, demo data + 200-user load-test data, test checklist, local preview tool. |

---

## 1. Purane software se kya badlega (Astra HR → FocusOn HRMS 2.0)

| Area | Purana (Astra HR) | Naya (FocusOn HRMS 2.0) |
|---|---|---|
| Company model | Multi-company SaaS; company signup + Super Admin approval | **Single company (FocusOn)** + multiple branches/sites. Company signup hata diya (internal software hai). |
| Super Admin | Sirf companies approve karta tha | **Poore system ka malik**: roles, permissions, authority, workflows, feature switches, settings, backup/restore, audit. |
| Roles | 4 fixed roles, 11 modules × 5 actions | **Unlimited custom roles**, ~145 permission keys, **7 scope levels**, conditions (amount/days limit), ek user ke multiple roles (validity ke saath), user overrides (ALLOW/DENY + expiry), delegation, authority profiles (ceiling). |
| Login | Admin: email · Employee: phone + activation code | Sab ke liye ek hi login: **Employee Code ya Mobile ya Email + password**; temporary password + first-login change; forgot password (email OTP); lockout. |
| Attendance | Har punch par project geo-fence | **Attendance Policy** based: Office (geo-fence, multiple points), Site (simple tap), Exempt; bahar hone par Block ya Flag + approval; optional selfie; anomaly flags; auto check-out; regularization; on-duty; OT; month lock. |
| Approvals | Admin seedha approve/reject | **Workflow engine**: multi-step chains, conditions, SLA, escalation, delegate, send-back, withdraw, versioning, **ek unified inbox**. |
| Leave | Har type ka fixed quota | Leave policies: accrual (yearly/monthly), prorate, carry forward, lapse, encashment, half-day, sandwich rule, comp-off, **ledger** (har transaction ka record). |
| Payroll | Basic + HRA + Special; PF/ESI simple; PT fixed | Configurable components, salary templates, monthly/daily/hourly, divisor options, OT, arrears, loan EMI, PF (ceiling + EPS split), ESI, **state-wise PT**, LWF, TDS (manual/auto), **maker-checker** (Prepare → Verify → Approve → Release), hold, reopen, statutory files. |
| Documents | Company policy upload | 17 letter templates auto-fill, numbering, approval + DRAFT watermark, signature/stamp, employee document vault (expiry alerts), policy acknowledgement. |
| Naye modules | — | Recruitment & Onboarding, Performance, Exit & F&F, Loans/Advances, Announcements, Org chart, RDash integration, Backup/Restore, Access Review, Preview-as-user, Hindi + Simple mode. |
| Speed | Har request par poori sheet padhi jati thi | Monthly partition tabs, yearly files, cache, batch writes → 200 users smooth. |
| Projects module | Projects + assignment + transfer + duty travel | **Sites** (work-locations) + employee site assignment; transfer aur duty travel ab workflow requests (TRANSFER, ON_DUTY) ban gaye. |

---

## 2. Users, Roles aur Hierarchy (sabse important)

### 2.1 Hierarchy (default)

```
Super Admin (max 2: primary + backup)
   └── Admin
        ├── HR Manager
        ├── Accounts / Payroll
        └── Executive (CEO / Director)
              └── Manager (Department Head)
                    └── Supervisor
                          └── Employee (Engineer, Office staff, Storekeeper, Office Boy ...)
```

Ye sirf **starting preset** hai. Super Admin har role ki power badal sakta hai, role clone/disable kar sakta hai aur naye roles bana sakta hai (jaise "Site Incharge", "Payroll Assistant", "Auditor (read-only)").

### 2.2 Designation aur Role alag cheezein hain
- **Designation** = employee ka title (CEO, Storekeeper). Har designation ka ek *default role* hota hai.
- **Role** = software mein power. Super Admin kisi bhi employee ko designation se alag role ya extra permission de sakta hai.

### 2.3 Default roles

| Role | Kiske liye | Default power (summary) | Default scope |
|---|---|---|---|
| **Super Admin** | System owner (max 2) | Sab kuch: roles, permissions, authority, workflows, settings, backup/restore, audit. Payroll ke routine stages (prepare/verify/approve/release) sirf "break-glass" switch ON karne par. | Company + system |
| **Admin** | Company administrator | Employees, org setup, attendance/leave admin, documents, settings (company/attendance/notifications), user create/reset, role assign (apni power ke andar), audit view, backup run. Role definition aur restore nahi. | Company |
| **HR Manager** | HR team | Employee master, attendance (lock/correct), leave (balance adjust, policy), payroll **prepare**, salary structure, revision initiate, letters, recruitment, performance, exit/F&F prepare, helpdesk, announcements, HR reports. | Company |
| **Accounts / Payroll** | Accounts team | Payroll **verify + release**, hold, statutory files, bank file, advances disburse, loans, expense pay, F&F approve, bank details edit, finance reports. Employee master edit nahi. | Company (payroll fields) |
| **Executive** | CEO / Director | Dashboards, sab reports (view), approvals: salary revision, offer, payroll final approval, exit, bade advances; salary view (logged). | Company (Super Admin per-Director alag scope de sakta hai) |
| **Manager** | Department Head | Department ke employees/attendance/leave dekhna + approve, expense (₹10,000 tak) & advance (₹20,000 tak) approve, performance review, job opening create, department reports. | Department |
| **Supervisor** | Site/Team supervisor | Team attendance dekhna, **mark on behalf** (site staff), leave/regularization approve, expense ₹2,000 tak approve, team reports. | Team (poori downline) |
| **Employee (Base)** | Har employee ko automatically | Self-service: check-in/out, leave, requests, payslip, documents, profile, helpdesk, apni salary/bank details dekhna. | Self |

### 2.4 Super Admin power kaise set karega (Role Builder + Permission Matrix)
1. **Access Control → Roles** kholo → role chuno (ya *New role* / *Clone*).
2. Matrix dikhegi: **rows = modules**, har permission ke saamne **checkbox + scope dropdown** (Self / Direct reports / Team / Department / Branch / Company / Custom list) + **limit** (jaise "Expense approve: ₹10,000 tak", "Leave approve: 3 din tak").
3. Sensitive permissions (salary, bank, ID, payroll approve, delete, role define) par 🔒 mark hota hai.
4. **Save** → turant lagu (cache refresh). Har change Audit Log mein (kisne, kya, kab, purana → naya).
5. **"Effective permissions" / "Preview as user"** se check karo ki koi user asal mein kya kar sakta hai.

### 2.5 Base role
"Employee (Base)" ki permissions **har employee** ko automatically milti hain (self-service). Super Admin isse bhi edit kar sakta hai. Kisi ek user se koi base permission hatani ho to **DENY override**.

### 2.6 Multiple roles + validity
Ek user ke paas multiple roles ho sakte hain (jaise Supervisor + "Store Incharge"), har role ke saath **valid from / valid to** (temporary role possible). Effective power = sab roles ka union (sabse bada scope).

### 2.7 User overrides
Kisi ek user ke liye role se alag **ALLOW** ya **DENY**, scope ke saath, **expiry compulsory**, reason ke saath. Example: *"Rohit ko 15 din ke liye attendance.correct (Team)"*. **DENY hamesha jeet'ta hai.**

### 2.8 Delegation
Approver chhutti par ho to apni approvals kisi aur ko date-range ke liye saunp sakta hai (sab request types ya selected). Delegate ke action par "on behalf of" record hota hai.

### 2.9 Authority profiles (power aage dene ki ceiling)
Super Admin kisi higher authority (CEO / Director / HR Head) ko **Authority profile** deta hai:

| Field | Matlab |
|---|---|
| Scope | Kin departments/branches/employees par haq hai (jaise Director A sirf Engineering) |
| Ceiling (roles) | Kaunse roles wo aage assign kar sakta hai |
| Ceiling (permissions) | Kaunsi permissions wo override se de sakta hai (sensitive kabhi nahi) |
| Workflow rights | Apne department ke approval chains define/badal sakta hai ya nahi |
| User management | Apne scope mein users create / password reset kar sakta hai ya nahi |
| Validity | Permanent ya date-limited |

Authority **nahi** kar sakti: Super Admin settings, backup/restore, audit settings, role definitions, **apni khud ki permissions**.

### 2.10 Safeguards (hamesha lagu)
- **Default deny** — jo diya nahi, wo nahi milega. **Deny wins.** **Least privilege.**
- **Ceiling rule** — koi bhi sirf wahi permission aage de sakta hai jo uske paas khud ho, aur apne scope ke andar.
- **Maker-checker** — jo banata hai wo khud approve nahi kar sakta (payroll, salary revision, advance, F&F).
- **Self-approval blocked** — approver hi requester ho to agla step.
- **Sensitive grants** (salary/bank/ID, payroll approve, delete, role define) sirf Super Admin de sakta hai.
- **Kabhi kisi ko nahi diye ja sakte (SA-only):** backup restore, authority delegate, security settings, preview-as-user.
- **Max 2 Super Admin.** Temporary access ki expiry compulsory. Sensitive change par Super Admin ko alert.
- **Leaver rule** — exit hote hi login band, roles hat jate hain, pending approvals reassign.
- **Soft delete** — record permanently delete nahi; archive. Hard delete sirf Super Admin, reason ke saath.

### 2.11 Har request par permission check (server par, 10 steps)
1. Session valid + user active? 2. Preview session hai to write block. 3. Explicit DENY override? → ruko.
4. Roles + base role + active overrides + delegations jodo. 5. Permission key hai? 6. **Scope check** (record user ke scope mein?).
7. **Field check** (salary/bank/ID ke liye alag permission, warna masked). 8. **Feature switch** ON hai?
9. **Maker-checker + limit check** (amount/days). 10. Action + **Audit Log** (kaun, kya, kis record par, purana/naya, kab).

> Menu chhupana security nahi hai — **asli check hamesha server par** hota hai. Hidden menu ka action seedha server ko bheja jaye to bhi reject.

---

## 3. Login aur Security (AUTH)

| ID | Feature | Kaise kaam karega |
|---|---|---|
| AUTH-01 | Single login screen | Employee Code (FO-0001) **ya** Mobile **ya** Email + password. Super Admin bhi yahin se. |
| AUTH-02 | Temporary password | Employee add hote hi system temp password banata hai (HR ko ek baar dikhta hai + optional email/print slip). First login par **password change compulsory**. |
| AUTH-03 | Password policy | Default: min 8 characters, letters + numbers. Super Admin: length, special character, expiry days set kar sakta hai. Passwords salted hash mein (plain kahin nahi). |
| AUTH-04 | Forgot password | Email registered hai to **6-digit OTP (10 min valid)**; nahi to HR/Admin reset karega. |
| AUTH-05 | Admin/HR password reset | `user.resetpassword` permission (scope ke andar) → naya temp password, us user ke saare sessions logout. |
| AUTH-06 | Lockout | 5 galat attempts → 15 min lock (configurable). Admin/SA unlock kar sakta hai. |
| AUTH-07 | Sessions | Token-based, expiry (default 12 ghante, configurable), logout, **"sab devices se logout"**, expiry par auto logout. |
| AUTH-08 | Consent notice | Pehle login par location/selfie/data use ka notice → accept → `Consent_Log`. Notice ka version badla to dobara. |
| AUTH-09 | Account status | Active / Locked / Disabled / Exited — exit par login turant band. |
| AUTH-10 | Preview as user | Super Admin kisi user ko **bina password jaane read-only** dekh sakta hai ("Rohit ko kya dikhta hai?"). Banner dikhega, koi save/approve nahi hoga, audit hoga. |
| AUTH-11 | Login history | Har login, failed login, logout Audit Log mein. |
| AUTH-12 | Super Admin recovery | Max 2 SA. Dono ka password bhool gaye to script owner editor se `resetSuperAdminPassword()` chala sakta hai. |

---

## 4. Screens aur Navigation (UI)

| ID | Feature | Detail |
|---|---|---|
| UI-01 | Permission-driven menu | Ek hi portal. Menu groups: **Me** (self-service), **Team**, **HR**, **Payroll & Finance**, **Admin Console**. Jo permission nahi wo dikhega hi nahi. |
| UI-02 | Layout | Desktop: left sidebar + header. Mobile: **bottom navigation** (Home, Attendance, Inbox, Menu), bade buttons, tables mobile par cards ban jati hain. |
| UI-03 | Simple mode | 4 bade buttons: **Hazri (Check-in) · Chhutti (Leave) · Salary Slip · Meri Jaankari** — Hindi labels, kam text. SA/HR kisi bhi employee ke liye ON kar sakta hai. |
| UI-04 | Hindi / English | Toggle: self-service, simple mode, menu, common buttons/status Hindi mein. HR/Admin ki detailed screens English (baad mein Hindi add ho sakti hai). |
| UI-05 | Theme | Light / Dark mode; FocusOn logo + brand color. |
| UI-06 | Global search | Employees (naam/code/mobile) aur Request ID — permission ke hisaab se. |
| UI-07 | Notifications | Bell + inbox badge, har 2 min auto refresh (tab visible ho tab). |
| UI-08 | Tables | Search, filter, sort, pagination, export (permission ho to). |
| UI-09 | Forms | Validation, dropdowns, date pickers, photo/receipt upload (phone par auto-compress), saaf error message ("kyun nahi hua"). |
| UI-10 | Sensitive data | Salary/bank/Aadhaar default **masked**; "Show" dabane par view log banta hai. |
| UI-11 | Feedback | Loading skeleton, progress bar, success/error toast, delete/approve se pehle confirmation. |
| UI-12 | Print | Payslip, letters, reports print-friendly (PDF save). |

---

## 5. Dashboard (DASH)

| ID | Kiske liye | Kya dikhega |
|---|---|---|
| DASH-01 | Employee | **Check-in/Check-out card** (policy ke hisaab se location/selfie), aaj ka status, shift, is mahine ka summary (P/L/A/leave), leave balance, pending requests, announcements, upcoming holidays, birthdays. |
| DASH-02 | Manager / Supervisor | Team aaj (present / late / absent / on leave / not marked), **pending approvals**, is hafte team leave calendar, exceptions (geo-fence flags). |
| DASH-03 | HR | Headcount, joiners/leavers (month), attendance today, exceptions, pending approvals, payroll status, probation due, document expiry, birthdays/anniversaries. |
| DASH-04 | Accounts | Payroll stage, advances to disburse, expenses payable, statutory summary (PF/ESI/PT of last run). |
| DASH-05 | Executive | Summary cards + approvals + trends (headcount, attendance %, payroll cost 6 months). |
| DASH-06 | Super Admin | System health (last backup, triggers, email quota), security/access alerts (sensitive changes, failed logins, expiring overrides), users summary. |
| DASH-07 | Sab | RDash shortcut link (agar ON). |

---

## 6. Employee Management (EMP)

| ID | Feature | Kaise kaam karega |
|---|---|---|
| EMP-01 | Employee master | Sections: **Basic** (naam, code, photo, gender, DOB), **Job** (branch, department, designation, site, reporting manager, employment type, attendance policy, shift, DOJ, probation, confirmation, notice period), **Personal/Contact** (address, emergency contact, blood group, marital status, father's name), **Bank & Statutory** (bank, account, IFSC, PAN, Aadhaar, UAN, PF no, ESIC no), **Salary**, **Documents**, **Access** (login, roles). |
| EMP-02 | Auto Employee Code | Prefix configurable (default `FO-0001`, sequence auto). |
| EMP-03 | Reporting line | Reporting manager se **Direct reports** aur **Team (poori downline)** auto banti hai; department head, branch head bhi. |
| EMP-04 | Status lifecycle | Probation → Active (Confirmed) → Notice → Exited; Inactive. Probation end / confirmation due alerts. |
| EMP-05 | Login creation | Employee add karte waqt login + role + temp password (AUTH-02). |
| EMP-06 | Employee 360° profile | Tabs: Overview, Job & Org, Personal, Bank/Statutory, Salary, Attendance, Leave, Payslips, Loans, Documents, Timeline, Access. Har tab permission se. |
| EMP-07 | Document vault | Aadhaar, PAN, photo, certificates, offer letter etc. upload (Drive private folder), **verify**, **expiry date + alert**. |
| EMP-08 | Sensitive masking | Salary, bank, govt ID, personal, medical fields masked; reveal par log (field.*.view permissions). |
| EMP-09 | Bulk import / export | CSV/Excel paste ya upload → validation preview (galti row-wise) → import. Export CSV/Excel (permission). |
| EMP-10 | Self profile + change request | Employee apni details dekhta hai; contact/address/bank/emergency change ka **request** → HR approval → auto update. |
| EMP-11 | Timeline | Role change, transfer, salary revision, status change, letters — date-wise history. |
| EMP-12 | Org chart | Reporting tree view (department filter). |
| EMP-13 | Transfer | Branch/department/site/manager change ka request + approval + effective date. |
| EMP-14 | Archive only | Soft delete; hard delete sirf Super Admin (reason ke saath). |

---

## 7. Organization Setup (ORG)

| ID | Master | Fields / kaam |
|---|---|---|
| ORG-01 | Company profile | Naam, legal naam, address, GSTIN, PAN, TAN, PF establishment code, ESI code, logo, signature, stamp, brand color, RDash link. |
| ORG-02 | Branches / Offices | Naam, code, address, **state (PT ke liye)**, **multiple geo-points** (lat/lng + radius har point ka), branch head. |
| ORG-03 | Departments | Naam, code, department head, parent department. |
| ORG-04 | Designations | Naam, level, **default role**, default notice period. |
| ORG-05 | Sites / Work locations | Site naam, code, branch, address, (optional) geo-point, RDash code. |
| ORG-06 | Shifts | Start, end, grace minutes, break, night shift, weekly off pattern (jaise Sunday + 2nd/4th Saturday). |
| ORG-07 | Attendance policies | Office / Site / Exempt + rules (section 10). |
| ORG-08 | Holidays | Year-wise, branch-wise, type (National / Festival / Optional). |

---

## 8. Access Control Console — Super Admin (ACL)

| ID | Screen | Kya karta hai |
|---|---|---|
| ACL-01 | Role Builder | Role create / clone / edit / disable; description; base role flag. |
| ACL-02 | Permission Matrix | Roles × permissions grid; har permission ka scope + limit; sensitive 🔒; ek nazar mein "kisko kya milta hai"; yahin se edit. |
| ACL-03 | User Access | User search → uske roles (validity), overrides, delegations, authority, **effective permissions (source ke saath)** — "Rohit kya kya kar sakta hai?"; actions: role assign/remove, override, reset password, lock/unlock, logout all, preview. |
| ACL-04 | User overrides | ALLOW / DENY, scope, **expiry compulsory**, reason. |
| ACL-05 | Delegations | Approval delegation (date range, request types). Approver khud bhi kar sakta hai; dusron ke liye `delegation.manage`. |
| ACL-06 | Authority profiles | Scope, ceiling (roles + permissions), workflow rights, user-management rights, validity (section 2.9). |
| ACL-07 | Feature switches | Modules ON/OFF (Recruitment, Performance, Expenses, Loans, Helpdesk, Documents, Exit, Announcements, RDash, Comp-off, OT, On-duty), Selfie (company → policy → employee), Simple mode, Hindi, Email notifications, Payroll CEO approval, Profile change requests. |
| ACL-08 | Access Review | High-privilege users, 30+ din inactive users, expiring/expired grants, sensitive permission holders → **ek click revoke**, export (quarterly review). |
| ACL-09 | Preview as user | AUTH-10. |
| ACL-10 | Alerts | Sensitive permission change par Super Admin ko in-app + email alert. |
| ACL-11 | Super Admin accounts | Max 2 (primary + backup) manage. |

---

## 9. Workflow Engine aur Approvals (WF)

| ID | Feature | Detail |
|---|---|---|
| WF-01 | Request types (23) | Leave, Leave cancel, Leave encashment, Comp-off, Attendance regularization, Attendance exception (geo-fence flag), On-duty/Tour, Overtime, Advance, Loan, Expense, Salary revision, Job opening, Offer, Resignation, F&F, Document request, Letter approval, Profile change, Transfer, Payroll reopen, Role change, General request. |
| WF-02 | Workflow Designer | Har request type ke steps: **approver type** (Reporting Manager, Skip-level Manager, Department Head, Branch Head, kisi Role ke log, Specific person), **mode** (any-of / all-of), **condition** (days, amount, leave type, unpaid, mahine mein count, post-lock…), **SLA hours**, **escalate to**. |
| WF-03 | Department-specific chain | Kisi department ka alag chain (optional) — warna company default. Authority (workflow rights) apne department ka chain bana sakti hai. |
| WF-04 | Versioning | Chain badalne par naye requests naye version par; chalti requests purane par. |
| WF-05 | Unified Inbox | **My approvals**, **My requests**, **Team/All requests** (scope), filters (type/status/date), **bulk approve** (leave/regularization). |
| WF-06 | Actions | Approve, Reject (**comment compulsory**), Send back for correction, Withdraw (requester), Comment, Reassign / Override (`approval.override`). |
| WF-07 | SLA + Escalation | Approver X ghante mein action na le → reminder; phir upar escalate (hourly job). |
| WF-08 | Delegation | Active delegation automatically lagu. |
| WF-09 | Edge cases | Self-approval → agla step; reporting manager nahi → Dept Head → HR → Super Admin; approver exit → uske manager ko reassign; approved ke baad badlav → sirf reopen/cancel request. |
| WF-10 | Approver ki permission + limit | Approver ke paas approve permission aur scope hona chahiye; limit se bada amount/days ho to auto escalation. |
| WF-11 | Timeline | Requester ko har step ka status (kaun, kab, comment) dikhta hai. |
| WF-12 | Notifications | Har step par in-app; email optional / daily digest. |

---

## 10. Attendance (ATT)

### 10.1 Attendance policies

| Policy | Kiske liye | Geo-fence | Selfie | Bahar / GPS fail hone par |
|---|---|---|---|---|
| **Office (Geo-fenced)** | Office-based staff | Zaroori | Optional switch | Block **ya** Flag + manager approval (policy mein set) |
| **Site / Field** | Site supervisor, engineer, labour, storekeeper (site) | Nahi (location maangi hi nahi jati) | Optional switch | Simple tap; supervisor mark-on-behalf |
| **Exempt / Flexible** | CEO, Directors | Nahi | Nahi | Working day par present maana jayega |

### 10.2 Features

| ID | Feature | Kaise kaam karega |
|---|---|---|
| ATT-01 | Policy assignment | Har employee ko policy (Office/Site/Exempt ya custom) + shift. Bulk assign possible. |
| ATT-02 | Check-in / Check-out | 1–2 tap. **Time hamesha server ka** (phone ka time kabhi nahi). |
| ATT-03 | Geo-fence (Office) | Branch ke multiple geo-points; radius 50–500 m (default 100 m); min GPS accuracy 50 m; **Haversine distance server par**; check-out geo-fence optional (default OFF). |
| ATT-04 | Outside / GPS denied | Policy setting: **Block** (check-in nahi hoga, clear message) ya **Flag + approval** (check-in hoga, manager ke inbox mein "Attendance exception"). |
| ATT-05 | Check-in window | Shift start se X min pehle se shift end tak (configurable). |
| ATT-06 | Selfie (optional) | Switch: company → policy → employee (neeche wala level jeet'ta hai). OFF ho to button hi nahi. ON ho to camera khulta hai (compressed ~60 KB). Drive private folder month-wise. Sirf `selfie.view` wale dekh sakte hain. **90 din baad auto-delete** (configurable). Face recognition nahi. |
| ATT-07 | Anomaly flags | Roz bilkul same coordinates, impossible jump (bahut tez doori), GPS accuracy suspicious → flag + exceptions list. |
| ATT-08 | Late / Early / Hours | Shift + grace ke baad Late; early going; work hours; **full day / half day thresholds**; **late rule**: mahine mein 3 late = ½ day (optional). |
| ATT-09 | Missed check-out | Raat ko auto check-out (shift end time) + **flagged** (ya policy ke hisaab se Half day) → employee regularization se theek kare. |
| ATT-10 | Site attendance | Simple tap (bina location). **Supervisor mark-on-behalf**: team list se single/bulk Present/Half day/Absent, reason ke saath. |
| ATT-11 | Exempt | Working days par auto present (leave ho to leave). |
| ATT-12 | Regularization | Missed punch / galat time / forgot → request (date, in/out time, reason) → workflow. Mahine mein limit (default 3); limit se zyada par HR step. |
| ATT-13 | On-duty / Tour | Date range + purpose + location → approval → un dino **On Duty (present)**, geo-fence skip. |
| ATT-14 | Overtime | Shift se upar minutes auto calculate; OT request (auto ya manual) → approval → **sirf approved OT payroll mein**. |
| ATT-15 | Live board (Today) | Present, late, absent, on leave, not marked, exceptions — scope ke hisaab se; filter by branch/department/site. |
| ATT-16 | Muster roll | Mahine ka grid (P/L/H/A/V/U/D/W/O/X codes) + totals; employee calendar view (din par click → punch detail). |
| ATT-17 | Attendance lock | Cutoff par HR month lock karta hai; lock ke baad sirf approval se change (audit ke saath); payroll release ho chuka ho to farq **next month adjustment** mein. |
| ATT-18 | Direct correction | `attendance.correct` wale reason ke saath correct kar sakte hain → audit. |
| ATT-19 | Comp-off earn | Holiday/weekly off par kaam → comp-off request → approval → comp-off leave credit (expiry ke saath). |
| ATT-20 | CSV/RDash import | Site attendance CSV import (column mapping + preview + validation). |
| ATT-21 | Weekly off patterns | Sunday, 2nd/4th Saturday jaise patterns policy/shift level par. |

### 10.3 Geo-fence ki honest limits
Browser GPS 100% foolproof nahi: fake GPS apps, indoor weak signal, location permission deny, battery saver. Upay: accuracy limit, anomaly flags, optional selfie, spot-check, flag-and-approve fallback, pilot mein har phone test.

---

## 11. Leave (LV)

| ID | Feature | Kaise kaam karega |
|---|---|---|
| LV-01 | Leave types + rules | Har type: paid/unpaid, yearly quota, **accrual** (yearly upfront / monthly / none), joiners ke liye prorate, **carry forward** + max, **encashable** + max, half-day allowed, **sandwich rule**, min notice days, max days per request, backdated limit, document required after N days, gender restriction, probation mein allowed, negative balance allowed, color. |
| LV-02 | Default types | Casual (CL), Sick (SL), Earned/Privilege (EL), Comp-off (CO), Leave Without Pay (LWP), Maternity (ML), Paternity (PTL), Optional Holiday (OH). Sab editable. |
| LV-03 | Apply leave | Full day / half day (first/second half), balance check, overlap check, attachment (medical certificate). Weekly off/holiday auto exclude (sandwich ON ho to include). |
| LV-04 | Approval | Workflow (default: Manager; 3 din se zyada → HR; 15 din se zyada ya unpaid → Director). |
| LV-05 | Balance + Ledger | Opening, accrued, used, adjusted, encashed, lapsed — **har transaction ka record**; balance kabhi "gayab" nahi hota. |
| LV-06 | Withdraw / Cancel | Pending → withdraw; approved future leave → cancel request → approval → balance wapas. |
| LV-07 | Accrual jobs | Monthly accrual (1 tarikh) / yearly credit (leave year start, prorated) — automatic. |
| LV-08 | Year-end processing | Carry forward (max tak) + lapse; **preview ke baad commit**. |
| LV-09 | Encashment | Request → approval → next payroll mein earning. |
| LV-10 | Comp-off credit | ATT-19 se credit, expiry days ke saath. |
| LV-11 | Balance adjust | `leave.balance.adjust` — reason compulsory, ledger mein. |
| LV-12 | Leave calendar | Team/department calendar; "aaj kaun leave par hai". |
| LV-13 | Leave year | Financial year (Apr–Mar) default; calendar year option. |

---

## 12. Holidays aur Calendar (CAL)

| ID | Feature | Detail |
|---|---|---|
| CAL-01 | Holiday calendar | Year-wise, branch-wise, Optional holidays (OH leave se). |
| CAL-02 | Company calendar | Holidays, team leaves, birthdays, work anniversaries, interviews — month view. |
| CAL-03 | Wishes | Birthday/anniversary in-app wishes (daily job). |

---

## 13. Payroll (PAY)

### 13.1 Features

| ID | Feature | Kaise kaam karega |
|---|---|---|
| PAY-01 | Salary components | Earning/Deduction; calculation: Fixed / % of Basic / % of Gross / Balancing; taxable; PF applicable; ESI applicable; prorate; payslip order. Default: Basic, HRA, Conveyance, Medical, Special Allowance, Other. |
| PAY-02 | Salary templates | Gross/CTC daalo → template se auto split (jaise Basic 50% of gross, HRA 40% of basic, baaki Special). |
| PAY-03 | Employee salary structure | Salary type (**Monthly / Daily wage / Hourly**), components, PF option (ceiling par / full wage / not applicable), ESI, PT, LWF, **TDS mode** (None / Manual monthly / Auto new-regime estimate), OT rate, effective date, history. |
| PAY-04 | Salary revision | HR initiate → workflow (Dept Head → Director/CEO → Accounts) → effective date se lagu; **arrears auto-calculate** (pichhle released months ka farq next payroll mein). |
| PAY-05 | Payroll inputs | Locked attendance, approved leave, approved OT, arrears, adjustments (incentive/bonus/other earning/deduction), reimbursements, loan/advance EMI, TDS. |
| PAY-06 | Payable days divisor | **Calendar days** / 30 / 26 / Working days (Settings). |
| PAY-07 | Pre-check | Blockers & warnings: salary structure missing, bank details missing, unresolved punches, pending leave/regularization, attendance unlocked, joiners/leavers list. |
| PAY-08 | Calculation engine | 200 employees ek click mein (seconds), har employee ka breakup; mid-month joiner/leaver; daily wage = paid days × rate; hourly = approved hours × rate. |
| PAY-09 | Statutory | **PF** 12% (wage ceiling ₹15,000, voluntary higher option, employer EPS 8.33% / EPF 3.67% split), **ESI** 0.75% / 3.25% (gross ₹21,000 tak), **PT** branch ke state ke slab se (Delhi mein PT nahi), **LWF** (optional), **TDS** (manual ya new-regime estimate). Saare rates Settings mein editable. |
| PAY-10 | Maker-checker lifecycle | **Draft → Prepared (HR) → Verified (Accounts) → Approved (CEO/Director, optional) → Released (Accounts) → Locked.** Ek hi banda do stage nahi kar sakta. |
| PAY-11 | Draft edits + Hold | Draft mein LOP override, adjustments (remark ke saath); kisi employee ki salary **Hold/Unhold** (bank file se bahar). |
| PAY-12 | Reopen | Release ke baad edit nahi. Galti ho to `payroll.reopen` request → **Super Admin approval + reason** → poora audit. |
| PAY-13 | Payslips | In-app view + PDF (3 templates, logo/signature/stamp). Batch generation progress bar ke saath; employee sirf apna payslip dekhta hai; "payslip ready" notification. |
| PAY-14 | Outputs | Payroll register, **bank transfer file** (generic + custom columns), **PF ECR** text file, ESI statement, PT statement, LWF, TDS statement, LOP report, OT statement, arrears, department cost, variance vs last month, **annual salary summary (Form 16 support)**, CTC report. |
| PAY-15 | Employee view | Payslips, apna salary structure, YTD summary, tax estimate. |
| PAY-16 | F&F | Exit module ke saath (EXIT-05). |

### 13.2 Calculation (example — rates Settings se aayenge)
Gross ₹20,000, mahina 30 din, 2 din LOP → paid days 28.

| Item | Calculation | Amount (₹) |
|---|---|---|
| Basic | 10,000 × 28/30 | 9,333 |
| HRA | 4,000 × 28/30 | 3,733 |
| Special allowance | 6,000 × 28/30 | 5,600 |
| **Earned gross** | | **18,666** |
| PF (employee) | 12% × 9,333 | 1,120 |
| ESI (employee) | 0.75% × 18,666 (round up) | 140 |
| Professional Tax | State slab (example) | 200 |
| **Net pay** | 18,666 − 1,120 − 140 − 200 | **17,206** |

> Statutory figures ko HR/Accounts aur CA verify karenge (Labour Codes / state rules badalte rehte hain). Software filing nahi karega — sirf files/data dega.

---

## 14. Loans aur Advances (LOAN)

| ID | Feature | Detail |
|---|---|---|
| LOAN-01 | Request | Salary advance ya loan (amount, reason, tenure/EMI). |
| LOAN-02 | Approval | Workflow: Manager → HR → (₹20,000 se upar Director) → Accounts. |
| LOAN-03 | Disbursement | Accounts disburse karta hai (date, mode, reference). |
| LOAN-04 | EMI recovery | EMI schedule auto; **payroll mein auto deduction**; EMI skip/hold, prepayment, closure. |
| LOAN-05 | Ledger | Har EMI ka record, outstanding report; exit par F&F mein recovery. |

## 15. Expenses / Reimbursement (EXP)

| ID | Feature | Detail |
|---|---|---|
| EXP-01 | Categories | Travel, Food, Fuel, Accommodation, Site material, Other — per-claim limit, receipt compulsory flag. |
| EXP-02 | Submit claim | Receipt photo/PDF (auto compress), date, amount, site/purpose. |
| EXP-03 | Approval | Manager → Accounts; approved amount kam kiya ja sakta hai (remark ke saath). |
| EXP-04 | Payment | Next payroll mein ya direct (paid mark + reference). |
| EXP-05 | Tracking | Employee status track; reports. |

---

## 16. HR Documents aur Letters (DOC)

| ID | Feature | Detail |
|---|---|---|
| DOC-01 | Templates (17) | Offer, Appointment, Confirmation, Increment/Salary revision, Promotion, Transfer, Relieving, Experience, Resignation acceptance, Warning, Show-cause, Salary certificate, Employment certificate, NOC, F&F statement, Address proof letter, Internship certificate + custom. **In-app editor** with placeholders (`{{employee.name}}`, `{{designation}}`, `{{salary.table}}` …) + live preview. |
| DOC-02 | Generate | Employee/candidate chuno → PDF Drive mein → **unique number** (jaise `FO/HR/2026/0001`) + version. |
| DOC-03 | Approval + DRAFT | Sensitive letters (offer, increment, promotion, warning…) approval se pehle **"DRAFT" watermark**; approve hone par final PDF. |
| DOC-04 | Signatory | Authorised signatory naam/designation + signature image + stamp (sirf permission wale ke generate karne par). |
| DOC-05 | Register | Issued documents list; revoke/replace (purana archive). |
| DOC-06 | Employee | Apne letters download; document request (salary certificate etc.) → HR approve → auto-generate. |
| DOC-07 | Policy library | Handbook, policies, forms — visibility (sab / department / branch / role) + **acknowledgement tracking**. |
| DOC-08 | Category permissions | HR sab letters; Accounts sirf payroll docs; Manager sirf request. |
| DOC-09 | Auto triggers | Payroll release → payslips; exit complete → relieving/experience draft. |

---

## 17. Recruitment aur Onboarding (REC)

| ID | Feature | Detail |
|---|---|---|
| REC-01 | Job openings | Requisition (dept, branch, positions, CTC range, description) → approval → Open / On hold / Closed. |
| REC-02 | Candidates | Add, resume upload, source (referral, portal, walk-in, consultant…), pipeline: **Applied → Screening → Interview → Offer → Hired** / Rejected / On hold. |
| REC-03 | Kanban + list | Drag-free stage buttons (mobile friendly). |
| REC-04 | Interviews | Schedule (date/time/mode/interviewers), round-wise feedback + rating. |
| REC-05 | Offer | CTC + joining date → offer approval → offer letter generate. |
| REC-06 | Hire | Candidate → employee (auto-fill) → onboarding checklist. |
| REC-07 | Onboarding checklist | Template tasks (HR / IT / Admin / Manager), due dates, owners, progress. |
| REC-08 | Data retention | Rejected candidates ka data 12 mahine baad purge (configurable). |

## 18. Performance (PERF)

| ID | Feature | Detail |
|---|---|---|
| PERF-01 | Review cycles | Annual / half-yearly / quarterly; stages: Goal setting → Self review → Manager review → HR calibration → Closed. |
| PERF-02 | Goals / KRAs | Har employee ke goals, weightage (total 100). |
| PERF-03 | Reviews | Self, Manager, HR consolidation. |
| PERF-04 | Rating scale | 1–5 (labels editable); weighted final score; HR override reason ke saath. |
| PERF-05 | Results | Publish; increment recommendation → salary revision initiate. |
| PERF-06 | Reports | Rating distribution, completion status. |

## 19. Exit aur Full & Final (EXIT)

| ID | Feature | Detail |
|---|---|---|
| EXIT-01 | Resignation | Employee requested last working day ke saath → workflow (Manager → HR). |
| EXIT-02 | HR-initiated exit | Termination, retirement, absconding, contract end. |
| EXIT-03 | Notice period | Required vs served, shortfall, waiver. |
| EXIT-04 | Clearance | Checklist (Manager, IT, Admin, Accounts, HR) — assigned tasks, status. |
| EXIT-05 | F&F calculation | Last month salary (LWD tak), leave encashment, **gratuity** (5 saal+; 15/26 × last basic × years), notice pay/recovery, loan/advance recovery, other → F&F approval (Accounts) → paid. |
| EXIT-06 | Letters | Resignation acceptance, relieving, experience, F&F statement. |
| EXIT-07 | LWD automation | Login disable, roles remove, pending approvals reassign, status Exited. |
| EXIT-08 | Exit feedback | Simple exit interview form. |

---

## 20. Communication (COM)

| ID | Feature | Detail |
|---|---|---|
| COM-01 | Helpdesk | Ticket (category → handler role: Payroll→Accounts, Attendance/Leave→HR, IT/Admin→Admin), priority, status, comments. |
| COM-02 | Announcements | Audience (sab / department / branch / role), pin, expiry, acknowledgement. |
| COM-03 | Notifications | In-app, item ka direct link. |
| COM-04 | Email | Zaroori events + optional daily digest; **Gmail daily quota guard** (quota khatam ho to sirf in-app). |
| COM-05 | Preferences | Super Admin set karega kaunse events par email jaye. |

---

## 21. Reports (RPT) — sab scope ke hisaab se filter, **CSV + Excel (.xlsx) + Print/PDF**

| Group | Reports |
|---|---|
| Employee | Employee master, Headcount (dept/branch/designation/type), Joiners & leavers, Attrition, Birthdays & anniversaries, Probation due, Document expiry, Reporting structure |
| Attendance | Daily attendance, **Monthly muster roll**, Attendance summary, Late coming, Early going, Absenteeism, Exceptions (flagged), Overtime statement, Regularization register, On-duty register |
| Leave | Leave register, Leave balances, Leave ledger, Encashment |
| Payroll | Payroll register, Department cost, Bank transfer statement, PF (ECR), ESI, PT, LWF, TDS, Annual salary summary (Form 16), CTC, Arrears, Variance |
| Finance | Loan/advance ledger, Outstanding loans, Expense report, Reimbursements, F&F register |
| Recruitment / Performance | Openings status, Candidate pipeline, Interview schedule, Rating distribution, Goal completion |
| Audit / Access | Audit trail, Login history, Sensitive field views, **Access review (kiske paas kya)**, Permission matrix export |

---

## 22. Settings (SET) — sab Super Admin (ya granted user) set karega

| ID | Settings group | Kya set hota hai |
|---|---|---|
| SET-01 | Company & branding | Profile, logo, signature, stamp, brand color, app naam |
| SET-02 | Security | Password policy, session timeout, lockout, OTP |
| SET-03 | Attendance defaults | Default policy/shift, auto check-out time, late rule, anomaly detection, selfie retention |
| SET-04 | Leave | Leave year, accrual day, year-end rules |
| SET-05 | Payroll & statutory | Divisor, OT multiplier, rounding, PF/ESI/PT/LWF/TDS parameters, bank file format, payslip template & fields, payroll CEO approval ON/OFF, SA break-glass |
| SET-06 | Notifications | Email events, digest time |
| SET-07 | Documents | Numbering format, signatory |
| SET-08 | Checklists | Onboarding + exit clearance items |
| SET-09 | Employee | Code format, probation months, notice periods |
| SET-10 | Data retention | Selfie, GPS, notifications, rejected candidates |
| SET-11 | RDash | Link, mapping, CSV format |
| SET-12 | Modules | Feature switches (ACL-07) |

---

## 23. System: Backup, Audit, Automation (SYS)

| ID | Feature | Detail |
|---|---|---|
| SYS-01 | Audit log | Kaun, kya, kab, kis record par, purana → naya. Monthly partition. Viewer (filters) + export. |
| SYS-02 | Daily backup | Core + Attendance + Logs files ki copy Drive backup folder mein; **30 daily + 12 monthly** rakhe jayenge; row-count integrity check; Backup_Logs. |
| SYS-03 | Restore | Super Admin: backup chuno → pehle current data ki safety copy → ek click restore. Manual "Backup now" bhi. |
| SYS-04 | Scheduled jobs | Hourly: SLA reminders/escalation. Daily: backup, accrual, retention purge, alerts (probation, document expiry, birthdays), digest. Nightly: auto check-out. |
| SYS-05 | Data retention | Selfie 90 din, raw GPS 90 din, notifications 60 din, rejected candidates 12 mahine (configurable). |
| SYS-06 | System health | Triggers status, email quota bacha, DB size (rows), last jobs, errors. |
| SYS-07 | Error log | Har server error ka reference ID (support ke liye). |
| SYS-08 | Year rollover | Naye saal ki Attendance/Logs file automatic. |
| SYS-09 | Test data | Demo data (FocusOn sample) + **200-user load test** generator. |

## 24. RDash Integration (RD)

| ID | Feature | Detail |
|---|---|---|
| RD-01 | Link | Dashboard par RDash shortcut. |
| RD-02 | ID mapping | Same Employee ID (FO-0001); alag ho to "RDash ID" field. |
| RD-03 | Export | Employee list CSV (RDash ke liye). |
| RD-04 | Import | Site attendance/manpower CSV → column mapping → preview → validation → attendance (source RDASH) + Integration_Log. |
| RD-05 | API sync | Future (RDash API milne par). |

> HRMS mein **DPR, site tasks, site progress, material** nahi banenge — ye RDash par hi rahenge.

---

## 25. Permission Catalog (complete)

Scope codes: **S** Self · **D** Direct reports · **T** Team · **P** Department · **B** Branch · **C** Company · **X** Custom list. 🔒 = sensitive (sirf Super Admin grant kar sakta hai; view/use log hota hai).

| Module | Permission keys |
|---|---|
| Employee | `employee.view` (S–X) · `employee.create` · `employee.edit` · `employee.status` · `employee.delete` 🔒 · `employee.export` · `employee.import` · `employee.docs` · `orgchart.view` |
| Sensitive fields | `field.salary.view` 🔒 · `field.salary.edit` 🔒 · `field.bank.view` 🔒 · `field.bank.edit` 🔒 · `field.govtid.view` 🔒 · `field.govtid.edit` 🔒 · `field.personal.view` · `field.medical.view` 🔒 |
| Organization | `org.view` · `org.create` · `org.edit` · `org.delete` · `geofence.configure` 🔒 · `attendancepolicy.manage` 🔒 · `shift.edit` · `holiday.edit` |
| Users & access | `user.create` · `user.resetpassword` · `user.lock` 🔒 · `role.view` · `role.define` 🔒 · `role.assign` 🔒 · `override.grant` 🔒 · `authority.delegate` (SA-only) · `delegation.manage` · `featureflag.manage` 🔒 · `accesslog.view` 🔒 · `user.preview` (SA-only) |
| Approvals | `approval.inbox` · `approval.delegate` · `approval.viewall` · `approval.override` 🔒 · `workflow.define` 🔒 |
| Requests (raise) | `request.leave` · `request.leaveencash` · `request.compoff` · `request.regularize` · `request.onduty` · `request.overtime` · `request.advance` · `request.loan` · `request.expense` · `request.document` · `request.profilechange` · `request.resignation` · `request.transfer` · `request.general` |
| Attendance | `attendance.markself` · `attendance.markothers` · `attendance.view` · `attendance.approve` · `overtime.approve` · `attendance.correct` 🔒 · `attendance.lock` 🔒 · `attendance.export` · `attendance.import` · `selfie.view` 🔒 |
| Leave | `leave.view` · `leave.approve` (limit: days) · `leave.balance.adjust` 🔒 · `leave.policy.configure` · `leave.yearend` 🔒 · `leave.export` |
| Payroll | `salarystructure.view` 🔒 · `salarystructure.edit` 🔒 · `revision.initiate` 🔒 · `revision.approve` 🔒 · `payroll.view` 🔒 · `payroll.prepare` 🔒 · `payroll.verify` 🔒 · `payroll.approve` 🔒 · `payroll.release` 🔒 · `payroll.reopen` 🔒 · `payroll.hold` 🔒 · `payroll.adjust` 🔒 · `payroll.settings` 🔒 · `payslip.view` · `payslip.generate` · `statutory.export` 🔒 |
| Finance | `advance.approve` (limit: amount) · `advance.disburse` 🔒 · `loan.manage` 🔒 · `expense.view` · `expense.approve` (limit: amount) · `expense.pay` 🔒 |
| Documents | `doc.view` · `doc.generate.hiring` · `doc.generate.employment` · `doc.generate.exit` · `doc.generate.disciplinary` 🔒 · `doc.generate.certificate` · `doc.generate.payroll` · `doc.approve` · `doc.delete` 🔒 · `doctemplate.manage` · `doclibrary.manage` |
| Recruitment | `recruit.view` · `recruit.create` · `recruit.manage` · `offer.approve` · `onboarding.manage` |
| Performance | `perf.view` · `perf.goal.set` · `perf.review` · `perf.consolidate` · `perf.cycle.manage` |
| Exit | `exit.initiate` 🔒 · `exit.approve` · `exit.clearance` · `exit.manage` · `fnf.prepare` 🔒 · `fnf.approve` 🔒 |
| Communication | `helpdesk.raise` · `helpdesk.manage` · `announce.send` · `calendar.view` |
| Reports | `report.employee` · `report.attendance` · `report.leave` · `report.payroll` 🔒 · `report.finance` 🔒 · `report.recruitment` · `report.performance` · `report.audit` 🔒 · `report.export` |
| Settings & system | `settings.company` · `settings.attendance` · `settings.notifications` · `settings.security` (SA-only) · `integration.manage` · `backup.run` 🔒 · `backup.restore` (SA-only) · `audit.view` 🔒 · `system.health` · `system.maintenance` 🔒 |

---

## 26. Default Permission Matrix (starting preset — Super Admin har cell badal sakta hai)

V = View · C = Create · E = Edit · D = Delete (soft) · A = Approve · X = Export. Brackets mein scope. "—" = koi access nahi.

| Module | Super Admin | Admin | HR Manager | Accounts | Executive | Manager | Supervisor | Employee (Base) |
|---|---|---|---|---|---|---|---|---|
| Employee master | V C E D X | V C E X (C) | V C E X (C) | V (C) | V (C) | V (P) | V (T) | V (S) + change request |
| Salary / bank / ID fields | V E (logged) | V | V E (logged) | V; E bank | V salary (logged) | — | — | V (S) |
| Org setup, geo-fence, policies | Full | Full | V C E; holidays, shifts | — | — | — | — | — |
| Attendance | Full | V E X, lock (C) | V E X, lock, correct (C) | V (C) | V (C) | V, A (P) | V, mark on behalf, A (T) | Mark + V (S) |
| Selfie view | Full | V (C) | — (grant) | — | — | — | — | — |
| Leave | Full | V A X (C) | V A, balance adjust, policy (C) | V (C) | V A (C) | A (P) | A (T) | Apply, V (S) |
| Salary structure / revision | V E | — | V E, initiate (C) | V (C) | A revision | — | — | V (S) |
| Payroll run | Config; run = break-glass | V | **Prepare** | **Verify, Release**, hold | **Approve (final)** | — | — | — |
| Payslip | V (logged) | V (C) | V (C) | V (C) | — | — | — | V (S) |
| Advance / loan / expense | Full | — | V | A, Disburse, Pay | A (no limit) | A (P) ₹20k/₹10k | A (T) expense ₹2k | Request (S) |
| Documents / letters | Full | Generate all | Generate all, templates | Payroll docs | A letters | — | — | Own docs, request |
| Recruitment | Full | Full | Full | — | A offer | Create opening, feedback | — | — |
| Performance | Full | — | Full, consolidate | — | V (C) | Review (P) | Review (T) | Goals, self review |
| Exit & F&F | Full | Initiate | Initiate, clearance, F&F prepare | F&F approve | A | A (P) | A level-1 (D) | Resign (S) |
| Approvals / workflow | Define all, override | Override (C) | View all (C) | View (C) | View (C) | Inbox (P) | Inbox (T) | Own requests |
| Reports | All | All except payroll | All HR + payroll | Payroll, finance | All (view) | (P) | (T) | — |
| Users / roles / access | Full | Create user, reset, assign (ceiling) | Create user, reset | — | — | — | — | Own password |
| Settings / backup / audit | Full | Company, attendance, notifications, backup run, audit | — | — | — | — | — | — |

---

## 27. Default Approval Workflows (Super Admin / authority badal sakti hai)

| Request | Default chain | Rule / condition |
|---|---|---|
| Leave | Reporting Manager → HR → Director | HR: >3 din ya unpaid/maternity/paternity; Director: >15 din ya unpaid |
| Leave cancel | Reporting Manager | Approved future leave |
| Leave encashment | HR → Accounts | Encashable type, max limit |
| Comp-off credit | Reporting Manager → HR | Holiday/weekly off par kaam |
| Attendance regularization | Reporting Manager → HR | HR sirf jab mahine mein 3 se zyada ya month locked |
| Attendance exception | Reporting Manager | Geo-fence bahar / GPS fail (Flag policy) |
| On-duty / Tour | Reporting Manager | — |
| Overtime | Reporting Manager → Dept Head → HR → Accounts | Approved OT hi payroll mein |
| Advance | Reporting Manager → HR → Director → Accounts | Director sirf ₹20,000 se upar |
| Loan | Reporting Manager → HR → Director → Accounts | Director sirf ₹50,000 se upar |
| Expense | Reporting Manager → Accounts | Receipt compulsory |
| Salary revision | (HR initiate) Dept Head → Director/CEO → Accounts | Effective date se arrears auto |
| Job opening | Dept Head → Director/CEO | — |
| Offer | Dept Head → Director/CEO | Approval ke baad hi offer letter final |
| Resignation | Reporting Manager → HR | Phir clearance + F&F |
| F&F | Accounts → Director | Director sirf ₹1,00,000 se upar |
| Document request | HR | Allowed templates auto-generate |
| Letter approval | Director/CEO | Offer, increment, promotion, warning, show-cause |
| Profile change | HR | Bank/contact/address update |
| Transfer | Reporting Manager → New Dept Head → HR | Effective date |
| Payroll reopen | Super Admin | Reason compulsory |
| Role change | Super Admin | Authority ka request |
| General request | Reporting Manager → HR | ID card, NOC, other |

**Payroll run** ka apna maker-checker flow hai: HR Prepare → Accounts Verify → CEO/Director Approve (optional switch) → Accounts Release.

---

## 28. Database Design (Google Sheets)

**3 tarah ki files** (employees ko direct access nahi — sirf portal se):

| File | Tabs |
|---|---|
| `FocusOn HRMS – Core DB` (~58 tabs) | **System:** Settings, Users, Sessions, Notifications, ConsentLog, BackupLog, IntegrationLog · **Org:** Employees, Departments, Designations, Branches, GeoLocations, Sites, Shifts, AttPolicies, Holidays · **Access:** Roles, RolePerms, UserRoles, Overrides, Delegations, Authorities, FeatureFlags · **Workflow:** Workflows, Requests, RequestActions · **Leave:** LeaveTypes, LeaveApps, LeaveBalances, LeaveLedger · **Payroll:** SalaryComponents, SalaryTemplates, SalaryStructures, PayAdjustments, Loans, LoanLedger, PayrollRuns, PayrollItems, Payslips, Expenses, ExpenseCategories · **Docs:** DocTemplates, Documents, EmpDocs, Library, Acks · **People:** Jobs, Candidates, Interviews, OnboardTasks, PerfCycles, Goals, Reviews, Exits, ExitTasks · **Comms:** Tickets, TicketComments, Announcements |
| `FocusOn HRMS – Attendance <YYYY>` (har saal nayi) | Monthly tabs `ATT_YYYY_MM` (200 users ≈ 5,000 rows/mahina) |
| `FocusOn HRMS – Logs <YYYY>` (har saal nayi) | Monthly audit tabs `AUD_YYYY_MM` + Errors |

Design rules: Employee ID har jagah foreign key · batch read/write · photos/selfies/PDFs Drive mein, sheet mein sirf file ID · LockService se safe writes · statutory rates, geo-fence, workflows sab Settings/tabs mein (code mein hardcode nahi) · raw GPS retention ke baad hat jata hai · database layer alag (baad mein Cloud DB par shift aasaan).

---

## 29. Speed aur Capacity — 200 users fast kaise chalega

| Technique | Fayda |
|---|---|
| Monthly attendance tabs + yearly files | Check-in par sirf chhota data padha jata hai (poore saal ka nahi) |
| Server cache (settings, roles, permissions, org, employee directory) | Har request par sheet nahi padhni padti |
| "Aaj ki attendance" index cache | Check-in/out < 1 second server time |
| Batch read/write, short locks | 200 log subah ek saath check-in karein to bhi queue chhoti |
| Ek "boot" call | Login ke baad home screen ek hi request mein |
| Client cache + pagination + skeleton | UI lag-free; badi tables page-wise |
| Payslip PDFs batch + on-demand | 6-minute limit kabhi hit nahi |
| Audit/notification buffered writes | Har action par ek hi write |

**Expected timing (200 users, normal internet):** Login 1–2 s · Home 1–2 s · Check-in server part < 1 s (GPS phone par 1–8 s) · Lists < 1.5 s · Payroll calculate (200) ~10–20 s · 200 payslip PDFs ~4–6 min (auto batches, progress bar).

**Unlimited users ke baare mein honest baat:** Apps Script ek saath ~30 server executions chalata hai (sab requests owner account se chalti hain) aur ek Google Sheets file ki limit **1 crore (10 million) cells** hai. 200–500 users ke liye ye design aaram se chalega; 1000+ par attendance file quarterly split (setting) aur 3000+ par database Cloud SQL/BigQuery par shift (code mein DB layer alag hai, isliye poora software nahi badlega).

---

## 30. Limits aur Risks (honest)

| Limit | Asar | Upay |
|---|---|---|
| Apps Script 6 min/execution | Bada kaam ruk sakta hai | Batches + resume |
| Trigger runtime (free ~90 min/day) | Jobs limited | Efficient jobs |
| Gmail ~100 recipients/day (free) | Sabko email nahi | Portal-first, digest; Workspace par 1,500/day |
| Drive 15 GB | Selfie/receipts se bhar sakta hai | Compression, 90-din retention |
| GPS spoofing / iframe limits | Geo-fence bypass possible | Accuracy limit, flags, selfie, spot-check |
| Single Google account | Account lock = system band | 2-Step Verification, backup alag account mein |
| Statutory rules badalna | Galat deduction | Rates editable, CA verification, parallel run |
| Koi software 100% error-free guarantee nahi deta | — | Validation, maker-checker, audit, backup, testing se errors kam aur recoverable |

---

## 31. Deliverables (approve hone ke baad milega)

| # | Deliverable |
|---|---|
| 1 | `src/` — complete Apps Script project (server `.gs` files + UI `.html` files + `appsscript.json`) |
| 2 | **`docs/SETUP_GUIDE.md` — Complete Setup Guide (alag se, stepwise, screenshots-style instructions)**: Google account taiyari → project banana → files paste (ya clasp se ek command) → `setupSystem` → triggers → deploy → Super Admin first login → company/branch/geo-fence/roles/workflows/policies setup → employees import → pilot → go-live checklist |
| 3 | `docs/TEST_CHECKLIST.md` — 14 permission tests + module-wise tests |
| 4 | Demo data (FocusOn sample company) + **200-user load test data** |
| 5 | Local preview/test tool (developer ke liye) |
| 6 | Ye specification (Markdown + Word) |

---

## 32. Decisions — confirm karein (default = meri recommendation)

| # | Decision | Recommendation (default) | Option |
|---|---|---|---|
| D1 | Company model | **Single company FocusOn + multi-branch** | Purana multi-company SaaS model rakhna |
| D2 | Login ID | **Employee Code ya Mobile ya Email** (teeno chalenge) | Sirf Employee Code |
| D3 | Super Admin | **2 (primary + backup)** | Sirf 1 |
| D4 | Default roles | **8 presets (section 2.3)** | Aap list badal dein |
| D5 | New employee default policy | **Office (geo-fence)** | Site |
| D6 | Geo-fence fail | **Flag + manager approval** | Block |
| D7 | Selfie | **Default OFF**, policy-wise ON | Office ke liye ON |
| D8 | Leave year | **Financial year (Apr–Mar)** | Calendar year |
| D9 | Payroll divisor | **Calendar days** | 30 / 26 |
| D10 | Payroll CEO approval step | **ON** | OFF |
| D11 | TDS | **Manual per employee** (auto estimator available) | Auto default |
| D12 | PT | **Branch ke state ke hisaab se** (Delhi = no PT) | Fixed amount |
| D13 | Language | **Hindi/English toggle** | Sirf English |
| D14 | Email | **Zaroori events + daily digest** | Sab events / koi nahi |
| D15 | Letter templates | **In-app templates** (fast, no Google Docs dependency) | Google Docs templates |
| D16 | Data files | **Core + yearly Attendance + yearly Logs** | Ek hi file |
| D17 | CEO/Director attendance | **Exempt policy** | Normal punch |
| D18 | RDash | **Level 0 (link) + Level 1 (CSV) abhi** | Baad mein |

### Aapse ye inputs chahiye (setup ke time — code ke liye zaroori nahi)
FocusOn logo + brand color · employee list (Excel) · org chart / reporting lines · office lat/long + radius · leave policy + holiday list · salary structure format, PF/ESI/PT applicability · letter formats (agar existing hain) · site list · approval limits · RDash CSV format.

---
*Next step: Aap verify karein (OK / changes). Approve hote hi complete coding + alag Setup Guide.*
