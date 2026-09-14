# 🏗️ SiteAttend

**Location-verified attendance for site teams — free forever.**
Next.js web app (installable PWA) + **Google Sheet as the database**. Built for
construction / field-work companies: workers mark attendance only when they are
physically inside the site geofence (default 50 m) before the cutoff (default
11:00 AM). Everything else becomes an approval request. Admin + HR get a real-time
picture, a payroll matrix, and a CSV export — no database bill, ever.

```
Worker phone ──(GPS + login)──► Vercel (Next.js, free) ──► Google Sheet "AttendanceDB" (free)
                                     │                        ▲
Admin / HR ◄── same app, extra tabs ─┘   (live site feed,     │
                                  approvals, payroll)   2 free backend options:
                                                 A) Apps Script Web-App bridge (no keys)
                                                 B) Service account + Sheets API
```

## Why this design (and the honest limits)

- ✅ **Free forever**: Vercel Hobby (unlimited personal projects, generous for ~150 internal users) + Google Sheets API free quota (~60 writes/min ≈ 30–60 check-ins per minute — fine even when a whole workforce clocks in at 10:55).
- ✅ **No black box**: the database is a normal Google Sheet. Open it any time, edit/filter/pivot, it always matches the app.
- ⚠️ Beyond ~300–500 employees or heavy concurrent writes, move to Supabase/Neon free tiers — same row shape, swap `lib/db/sheets.ts` for a Postgres driver. For one company of 100–150 site workers, Sheets is genuinely the right call.

## What's inside

| Area | Features |
|---|---|
| Worker app (PWA) | Phone+password login · **current assigned site dashboard** (details, map, team, GPS mark-IN/OUT) · **all company sites** visible; mark at another site = paid “site visit / on duty” after approval · month calendar + history · leave / half-day / travel(on-duty) requests · profile + password · installable, Hinglish helper text |
| Admin + HR panel | Live **per-site feed for today** (verified / pending / not marked) · Projects CRUD with geofence (centre + radius, "Use my location" capture) · Employee CRUD with site assignment + daily wage · Attendance review showing ~metres + in/out times with one-click status corrections + manual/force mark (with `approved_by` audit) · Approvals queue (late / out-of-radius / site visit / leave / half-day / travel) · **Monthly payroll matrix** (P L H O A chips) + CSV export (Excel-ready) · Company settings (cutoff, default radius, timezone) |
| Rules engine | in radius + before cutoff → **present** (auto) · in radius + late → `late_pending` + reason request · outside radius → `outside_pending` + reason · other site → `visit_pending` · admin approve → paid `late` / `on_duty` · reject → `absent` · approved leave/half-day/travel writes the calendar · **payable = P+L+O+½H × daily wage** |
| Backends | **Three drivers, auto-selected by env vars**: `appsscript` (sheet + free Apps Script Web App — zero Cloud Console, zero keys), `sheets` (service-account REST), `local` (JSON demo DB with seed). Same 5 tabs, same protocol, one-line env switch |
| Security | bcrypt hashes only · HMAC-signed httpOnly session cookie, 30-day · per-company data isolation (`company_id` on every query) · geofence math done **server-side** (client can't fake distance) · Origin check on writes |
| Multi-company | Companies are just rows — first admin signs up at `/register`, each company sees only its own data, all stored in the same 5 sheet tabs. One Sheet can host many small companies, or give each its own Sheet ID deployment. |

## Run it

```bash
npm install
cp .env.example .env.local   # fill AUTH_SECRET; leave GOOGLE_* empty for demo mode
npm run dev                  # http://localhost:3000
```

Demo mode auto-seeds a full company (sites near real Mumbai/Delhi coordinates, 12
workers, a month of history, 2 pending approvals) — logins are shown on `/login`.

**Full production guide — two free backends (A: Apps Script ~10 min, no keys;
B: service account + Sheet) → Vercel, testing checklist, honest limits:**
see [SETUP.md](./SETUP.md). The Apps Script backend lives in
[`google-apps-script/Code.gs`](./google-apps-script/Code.gs) — paste into
Extensions ▸ Apps Script, run `setupDatabase()`, deploy as Web App, done.
`scripts/mock-appsscript.mjs` lets you rehearse it locally before deploying.

## Layout

```
app/
  (emp)/          dashboard · projects/[id] · history · requests · profile
  (adm)/admin/    today · attendance · requests · reports · projects · employees · settings
  login · register
  api/auth/*  api/attendance/*  api/requests/*  api/employees  api/projects  api/company  api/reports/csv
lib/
  db.ts           storage switch (Google Sheets ⇄ local demo)
  db/sheets.ts    Sheets-API driver  db/appsscript.ts Apps Script driver  db/local.ts demo driver
  attendance.ts   the rule engine        domain.ts   queries + payroll
  auth.ts crypto.ts time.ts distance.ts ids.ts seed.ts
components/       Shell (nav) · MarkPanel (GPS buttons) · forms (client islands)
public/           sw.js, icons (PWA)
google-apps-script/Code.gs  ← the sheet-side backend (CRUD + locks + setup + digest)
scripts/          create-sheet.mjs (Option B helper) · mock-appsscript.mjs (local rehearsal)
```

## Market features I folded in (inspiration, not bloat)

Field-attendance products (Zoho People, Switchapp, Connecteam, work-automation apps)
converged on: geofence + timestamp, photo verification, offline queue, buddy-punch
anti-fraud, wage auto-calc, supervisor bulk-mark, exception→approval loops.
This app has: **geofence, cutoff rules, exception→approval with reasons, admin
force-mark with audit trail, per-visit paid day for transfers/travel, payroll export,
installable PWA**. Deliberately skipped (free-tier killers): face-photos (needs image
storage), realtime sockets, OTP/SMS costs. Roadmap-friendly next steps are listed at
the end of SETUP.md… they fit into the same sheet.
