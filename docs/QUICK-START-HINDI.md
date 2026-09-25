# SiteTrack — हिंदी क्विक स्टार्ट (10 मिनट में लाइव)

पूरा सॉफ़्टवेयर **एक ही Google Apps Script प्रोजेक्ट** में है और डेटा **आपकी Google Sheet**
में रहता है। कोई दूसरा platform, hosting या server नहीं चाहिए — बस एक `/exec` लिंक।

---

## 1. Apps Script प्रोजेक्ट बनाइए

1. <https://script.google.com> → **New project** → नाम रखें `SiteTrack`.
2. **⚙️ Project settings** → *"Show appsscript.json manifest file in editor"* टिक करें →
   `backend/appsscript.json` का पूरा content पेस्ट कर दें।
3. डिफ़ॉल्ट `Code.gs` **डिलीट** कर दें।

## 2. सारी फ़ाइलें पेस्ट कीजिए (नाम बिलकुल वैसा ही, extension सहित)

`backend/` फ़ोल्डर की हर फ़ाइल के लिए editor में **नई फ़ाइल** बनाइए:

| किस तरह की फ़ाइल बनानी है | नाम | कितनी |
|---|---|---|
| **Script** (+ → Script) | `00_Config.gs` … `22_Frontend.gs` | 23 |
| **HTML** (+ → HTML) | `tmpl_index.html`, `tmpl_login.html`, `tmpl_company.html`, `tmpl_employee.html`, `tmpl_signup.html`, `tmpl_status.html`, `tmpl_app.html`, `tmpl_mobile.html`, `tmpl_owner.html`, `tmpl_config_js.html` | 10 पेज/config |
| **HTML** (+ → HTML) | `app_css.html`, `api_js.html`, `ui_js.html`, `auth_js.html`, `i18n_js.html`, `map_js.html`, `admin_js.html`, `mobile_js.html`, `owner_js.html` | 9 shared फ़ाइलें |

⚠️ **सबसे ज़रूरी बात:** HTML फ़ाइलें ज़रूर *HTML* टाइप में बनाएँ (नाम `.html` पर ख़त्म हो)।
अगर उन्हें Script बना दिया तो पेज पर `<?!= includeJs_('api_js') ?>` जैसा text दिखेगा और app
नहीं चलेगा। हर फ़ाइल पेस्ट करने के बाद **Ctrl+S** दबाएँ।

> फ़ास्ट तरीका: `npm i -g @google/clasp` → `.clasp.json.example` को `.clasp.json` बनाकर अपना
> script ID डालें → `clasp push` (एक कमांड में सब चला जाएगा)।

## 3. सेटअप चलाइए

1. ऊपर function में **`setupScript`** चुनें → **▶ Run** → permissions दे दें।
2. यह Platform Master Sheet, Drive फ़ोल्डर, `TOKEN_SECRET` और **OWNER_KEY** बनाता है।
   **OWNER_KEY (एडमिन की) तुरंत नोट कर लें** — दोबारा नहीं दिखेगी।
3. **Project settings → Script properties** में डालें:
   `OWNER_EMAIL` = आपका ई-मेल, `DEV_MODE` = `false`.

## 4. Deploy कीजिए

**Deploy → New deployment → Web app** · *Execute as:* **Me** · *Who has access:* **Anyone** →
**Deploy** → `/exec` लिंक कॉपी करें। **यही लिंक पूरा सॉफ़्टवेयर है।**

बाद में कोई भी बदलाव करने पर: **Deploy → Manage deployments → ✏️ → New version** (वरना पुराना
code ही चलता रहेगा)।

---

## 5. पहली कंपनी बनाइए (approval वाला flow)

1. `/exec` लिंक खोलें → **Register your company** (`?page=signup`) → फ़ॉर्म भरें → **Send OTP**
   (ई-मेल/WhatsApp पर कोड आएगा) → submit → आपको `REQ-…` नंबर मिलेगा
   (status कभी भी `?page=status` पर देख सकते हैं)।
2. **एडमिन पैनल:** `<लिंक>?page=owner` (या `?page=admin`) → अपनी **OWNER_KEY** डालें →
   *Signup requests* → request देखें → **Approve**।
   Approval करते ही कंपनी की Google Sheet (17 tabs), Drive फ़ोल्डर, कंपनी कोड `CMP-…` और
   **Super Admin** login बन जाता है और credentials ई-मेल हो जाते हैं।
3. **कंपनी लॉगिन:** `<लिंक>?page=company` → User ID / ई-मेल + temp password (चाहें तो
   *Mobile OTP* टैब से भी) → नया password बनाइए → **Setup Wizard** पूरा करें।
4. **कर्मचारी बनाइए:** console (`?page=app`) → Employees → Add. हर कर्मचारी को
   User ID + temp password मिलता है।
5. **कर्मचारी लॉगिन:** `<लिंक>?page=employee` → मोबाइल नंबर + OTP → attendance app खुल जाएगा।

## 6. दो लॉगिन अलग-अलग हैं (यही आपकी माँग थी)

| | कंपनी लॉगिन | कर्मचारी लॉगिन |
|---|---|---|
| पेज | `?page=company` | `?page=employee` |
| कौन | Super Admin, Admin, Sub-Admin (HR) | साइट के कर्मचारी |
| लॉगिन | User ID / ई-मेल / मोबाइल + password, या OTP | रजिस्टर्ड मोबाइल नंबर + OTP |
| कहाँ पहुँचेगा | कंपनी console `?page=app` | कर्मचारी app `?page=mobile` |
| डेटा | उसी कंपनी की Google Sheet | वही Google Sheet |

दोनों दरवाज़े **उसी डेटाबेस** (कंपनी की Sheet) से चेक होते हैं, लेकिन गलत दरवाज़े पर credential
डालने पर server `403` देकर सही पेज का लिंक दिखा देता है — कर्मचारी कभी HR console में नहीं
पहुँच सकता, और उलटा भी नहीं।

एडमिन का तीसरा (छिपा) दरवाज़ा `?page=owner` है, जो सिर्फ़ `OWNER_KEY` से खुलता है।

---

## 7. लोकल टेस्ट (Google account के बिना भी)

```bash
npm run dev      # http://localhost:8080 — असली Web App Node पर
npm test         # 224 automatic checks (दोनों login portals, attendance, payroll…)
npm run check    # verify + test — सब हरा होना चाहिए
```

## 8. अगर कुछ गड़बड़ लगे

| दिक्कत | हल |
|---|---|
| पेज पर `<?!= includeJs_('api_js') ?>` text दिख रहा है | वह फ़ाइल Script बनी है — HTML टाइप में नाम `.html` के साथ फिर बनाएँ |
| “Cannot reach SiteTrack API” | पुराना deployment version चल रहा है → नया version deploy करें |
| कंपनी लॉगिन पर “this account is a site employee account” | गलत दरवाज़ा — `?page=employee` इस्तेमाल करें (और उलटा भी) |
| OTP नहीं आया | Gmail quota या SMS gateway सेट नहीं है; टेस्ट के लिए `DEV_MODE=true` करने पर कोड response में दिखता है |
| कर्मचारी को “another device” कह रहा है | यह जान-बूझकर है — Approvals → Device changes → approve करें |
