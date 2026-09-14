# SiteAttend — Complete Setup (Google Sheet as Database)

> Objective: ek location-verified attendance web app jo **100% free** chale
> (Vercel free + Google Sheets free), 100–150 log ki team aaram se handle kare,
> multiple companies use kar sakein, aur data hamesha aapki apni Sheet me rahe.

---

## 0. 2-minute quick start (demo, no Google needed)

```bash
npm install
cp .env.example .env.local        # bas AUTH_SECRET bhar do, Google values khali chhodo
npm run dev
```

App demo company ke saath khulegi. Login screen pe demo credentials dikhenge
(admin `9000000001 / admin@123`, worker `9000000011 / attend@123`).
Jaise hi aap `GOOGLE_SHEET_ID` + service account set karoge, app **automatically**
Google Sheets mode me chali jayegi — koi code change nahi.

---

## 1. Choose backend — do options hain, dono FREE

| | Option A — **Apps Script** (recommended) | Option B — Service Account + API |
|---|---|---|
| Setup | Sheet + paste 1 file, 10 min | Google Cloud project, keys, ~15–20 min |
| Credentials | 1 URL + 1 secret string | JSON private key file |
| Read/write | script via LockService (safe) | direct Sheets API |
| Best for | internal single-sheet DB | custom auth / direct API needs |

---

## 2A. Option A — Google Apps Script (no Cloud Console at all)

1. Google Sheet banao — naam `AttendanceDB` (blank is fine; tabs script bana degi)
2. Sheet me: **Extensions ▸ Apps Script** → editor ka default code hatao →
   repo ki **`google-apps-script/Code.gs`** ka poora content paste karo
3. Sabse upar `var SECRET = 'CHANGE_ME_LONG_RANDOM_STRING';` → koi lamba random
   string daalo (wahi string app ke `.env` me `APPS_SCRIPT_SECRET` banegi — exact same)
4. Function dropdown me **`setupDatabase`** select karo → **▶ Run** → permission
   maange to Allow (Google ki "unverified app" warning aaye to: Advanced →
   Go to …unsafe → Allow). Ye 5 tabs + headers + dropdown validations bana dega.
5. **Deploy ▸ New deployment ▸ Web app** → Execute as: **Me**, Who has access:
   **Anyone** → Deploy → `https://script.google.com/macros/s/.../exec` URL copy karo
6. `.env.local` me:

```
APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXX/exec
APPS_SCRIPT_SECRET=<jo Code.gs me daala tha>
AUTH_SECRET=<openssl rand -hex 32>
```

7. `npm run dev` → `/register` se pehla company admin banao → rows sheet me aayengi. ✅
   Login page pe ab "Demo mode" box nahi dikhega — matlab real backend live hai.

> ⚠️ **Code.gs edit karne ke baad dobara deploy zaroori**: `Deploy ▸ Manage
> deployments ▸ ✏️ Edit ▸ Version: New version ▸ Deploy` — warna purana code
> chalta rahega. Ye Apps Script ka #1 gotcha hai.
>
> 🔒 /exec URL ek master key hai — kisi ko mat do, GitHub pe kabhi mat daalo.
> Leak lage to naya deploy + naya secret (2 min). Users ko ye URL milta hi nahi —
> wo sirf app + phone/password use karte hain; saare reads/writes server (app) se
> jaate hain.
>
> Free-tier limits: ek request ~30s execution, daily quota internal teams ke liye
> aaram se kaafi (100–150 log, peak ~30–40 marks/min smooth).

### Option A ko locally test karo (deploy se pehle, 1 min)

Repo me mock server hai jo bilkul wahi protocol bolta hai:

```bash
node scripts/mock-appsscript.mjs 3900 test-secret            # terminal 1
APPS_SCRIPT_URL=http://localhost:3900/exec APPS_SCRIPT_SECRET=test-secret npm run dev                   # terminal 2
```

`.data/mockdb.json` me rows dikhnge — asli sheet ka rehearsal.

---

## 3. Option B — Google Cloud service account (classic, ~15 min)

1. <https://console.cloud.google.com> → naya project banao (e.g. `attendance-db`)
2. **APIs & Services → Library** → `Google Sheets API` **Enable** karo, phir `Google Drive API` bhi enable karo
3. **APIs & Services → Credentials → Create Credentials → Service account**
   - naam: `sheets-bot`, koi role dena zaroori nahi
4. Service account → **Keys → Add key → JSON** → file download hogi
   - JSON me se `client_email` aur `private_key` uthao
5. `.env.local` banao (repo root) — `.gitignore` me already hai, **kabhi commit mat karna**:

```
GOOGLE_CLIENT_EMAIL=sheets-bot@attendance-db.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...poori key...\n-----END PRIVATE KEY-----\n"
AUTH_SECRET=koi-bhi-lambha-random-string        # openssl rand -hex 32
```

⚠ `GOOGLE_PRIVATE_KEY` me `\n` as-is rakho (double quotes ke andar), wrap mat karo.

## 4. Database Sheet banana (Option B ke liye)

**Option A (auto — recommended):**

```bash
node scripts/create-sheet.mjs
```

Ye `AttendanceDB` naam ki sheet bana dega, saare 5 tabs + header rows ke saath,
aur `GOOGLE_SHEET_ID=...` line print karega — wo `.env.local` me daal do.
Sheet service account ki own hoti hai, isliye manually share karne ki zaroorat nahi.

**Option B (manual):**

1. Google Sheets → blank spreadsheet → naam `AttendanceDB`
2. Neeche 5 tabs (sheets) banao aur header row exactly aisi likho (order bhi same):

| Tab | Header row (A1 se) |
|---|---|
| `Companies` | id, name, cutoff_time, default_radius_m, timezone, created_at |
| `Users` | id, company_id, name, phone, password_hash, role, current_project_id, daily_wage, status, created_at |
| `Projects` | id, company_id, name, address, latitude, longitude, radius_m, start_date, end_date, status |
| `Attendance` | id, company_id, employee_id, project_id, date, check_in_time, check_in_lat, check_in_lng, check_in_distance_m, check_out_time, check_out_lat, check_out_lng, check_out_distance_m, status, remarks, approved_by |
| `Requests` | id, company_id, employee_id, type, reason, from_date, to_date, project_id, attendance_id, status, review_note, reviewed_by, reviewed_at, created_at |

3. **Share** button → `client_email` (service account) ko **Editor** do
4. Sheet URL ka beech wala part → `GOOGLE_SHEET_ID=` me daalo

Phir: company ka pehla admin `/register` page se sign up karega — pehla row Sheet me
apne aap ban jayega. Aapko Sheet me kuch type karne ki zaroorat nahi.

## 5. Vercel deploy (free)

1. GitHub pe private repo banao, push karo (**`.env.local` push hona nahi chahiye** — gitignore check karo)
2. <https://vercel.com> → GitHub se import → Framework: Next.js (settings default theek)
3. **Project Settings → Environment Variables** me backend ke hisaab se values:
   - Option A → `APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`, `AUTH_SECRET`
   - Option B → `GOOGLE_SHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `AUTH_SECRET`
   Apps Script URL code me hardcode MAT karo — sirf Vercel env me rakho
4. Deploy → live URL milegi. **Vercel ka https URL hi use karo — GPS location
   permission sirf https + localhost pe milti hai.**
5. Sabhi users/phones pe yahi URL kholke "Add to Home screen" kar lein (app install ho jayegi, dekhne me real app jaisi).

## 6. Daily workflow

```
Admin:  /admin → Sites: add site (site pe khade hoke "Use my location" → radius 50m)
        → Team: add employee (naam, phone, password, daily wage, assign site)
Worker: URL kholo → phone+password login → dashboard pe CURRENT SITE dikhega
        → site pe pahunch ke "Mark IN" → green = Present ✓ (before cutoff, inside radius)
        → 11 AM ke baad / radius ke bahar = orange pending + reason → admin approve
        → shift khatam: "Mark OUT"
Admin:  Today tab = live per-site feed · Approvals = pending queue · Payroll = monthly matrix + CSV
```

## 7. Rules jo app follow karti hai (configurable)

| Rule | Default | Kahan badlega |
|---|---|---|
| On-time cutoff | 11:00 (company timezone me) | Admin → Settings → Cutoff |
| Geofence radius | 50 m | Site ke edit me (per-site) |
| Late check-in (site pe, cutoff ke baad) | `late_pending` → approval → paid **Late** | auto |
| Radius ke bahar | `outside_pending` → approval → paid **On Duty** | auto |
| Assign site ke ALIVA site pe mark (visit) | `visit_pending` → approval → paid **On Duty** | auto |
| Travel / company-duty (2 din ka case) | Worker "On duty / travel" request bhejta hai → approve = har din paid | Requests |
| Leave / Half-day | request → approve = leave entry / ₹0.5 din | Requests |
| Reject pending mark | us din `absent` | Approvals |
| Salary | payable days × daily_wage (P=1, L=1, O=1, H=0.5) | Payroll / CSV |

## 8. Free-scale reality check (honest limits)

- Option A (Apps Script): ek clock-in = 1 Web-App call (script ke andar
  LockService writes serialize karta hai) → internal scale pe koi dikkat nahi.
- Option B: ~60 write *requests*/min/user → **30–60 check-ins/min** — 150 log
  subah 10:45–11:15 me aayein to bhi kaafi.
- Read heavy time (admin dashboards) me sheet full-scan hoti hai; 100 log × 1 saal
  (≈ 25k attendance rows) tak bilkul theek chalta hai. 300–500+ employees ya real-time
  multi-branch pe jao to Supabase free tier pe migrate karna — schema isi type ka hai.
- Purana data bhaari lage to Sheet me `Attendance` ka purana mahine ka hissa
  `Attendance2025` jaisa backup tab me shift kar do (app sirf active tab padhti hai).
- Ek Sheet = ek database; multiple companies ek hi Sheet me `company_id` se
  isolate hoti hain. Badi companies ke liye per-company ek Sheet bhi chala sakta hai
  (phir har company ka apna GOOGLE_SHEET_ID deploy karo).

## 9. Security notes

- Passwords `bcrypt` hash (`$2b$`) — Sheet me plaintext kabhi nahi jaata
- Login cookie HMAC-signed, httpOnly, sameSite=lax, 30 din expiry; saare write
  APIs pe Origin check (basic CSRF) + server-side role/company enforcement
- GPS distance **server pe** Haversine se nikalti hai — client sirf bhejta hai
  `lat,lng,accuracy`; radius-set aur cutoff-set client se bypass nahi ho sakte
- Admin/HR bhi apne liye fake "correct" kar sakta hai — isiliye har manual change
  `approved_by` + row me `remarks` ke saath audit trail ban ke Sheet me rehta hai
- `.env.local`, service-account JSON aur Apps Script /exec URL — kuch bhi GitHub pe mat daalo (`.gitignore` cover karta hai)
- Apps Script driver GET+secret protocol use karta hai (Apps Script POST bodies redirects me drop kar deta hai — isliye GET hi safe pattern hai)
- Koi bhi employee sirf apne company ka data dekhta hai (`company_id` har query me)

## 10. Testing checklist (deploy se pehle)

- [ ] Demo mode: worker login → "Mark IN" → site ke 50m ke andar = green Present
- [ ] Chrome me location **block** karo → friendly error dikhna chahiye
- [ ] Phone ko site coords se 5 km door le jao (ya Map me manual lat/lng bhejo — devtools
      "Sensors" se override) → orange `outside_pending` + Approvals me request
- [ ] Cutoff 11:00 set karke 11:05 ke baad mark → `late_pending` → approve → Payroll me paid late
- [ ] Worker ko dusre site pe bhejo → us site page se mark → visit_pending → approve → On Duty paid
- [ ] Leave request → approve → calendar/history me leave cell
- [ ] Admin: attendance row ka status dropdown → Sheet me `status` + `approved_by` badla hua dikhe
- [ ] Payroll CSV download → Excel me totals match ho (payable × wage)
- [ ] Sheet ko manually kholo → rows wahi dikhne chahiye (real DB verify)
