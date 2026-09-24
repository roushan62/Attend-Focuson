# Optional: install FocusHR with `clasp` instead of copy-paste

**Who this is for:** developers, or anybody comfortable with a terminal.
**Who should NOT use this:** if you are following `STEP-BY-STEP-GUIDE.md`, ignore this file —
copy-paste works perfectly and needs no extra software.

`clasp` is Google's official command-line tool. It uploads every `.gs` and `.html` file in a
folder into an Apps Script project in one command — 25 server files + 8 client files in about
five seconds instead of an hour of pasting.

---

## What you need

| Item | How |
|---|---|
| Node.js 18 or newer | <https://nodejs.org> (LTS installer) |
| `clasp` | `npm install -g @google/clasp` |
| Logged-in Google account | `clasp login` (opens a browser window once) |
| Apps Script API enabled for your account | <https://script.google.com/home/usersettings> → turn **Google Apps Script API** ON |

---

## Steps

### 1. Create the project in the browser first

Do **Steps 1–3** of the main guide: new project at <https://script.google.com>, rename it
`FocusHR`, and tick *"Show 'appsscript.json' manifest file in editor"*.
Leave the editor tab open.

### 2. Copy the Script ID

Project Settings (⚙) → **IDs → Script ID** → copy it.
It looks like `1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890`.

### 3. Point clasp at that project and push

```bash
cd Attend-Focuson/hrms

cat > .clasp.json <<'JSON'
{
  "scriptId": "PASTE_YOUR_SCRIPT_ID_HERE",
  "rootDir": "."
}
JSON

clasp push -f
```

`clasp push -f` skips the confirmation prompt and uploads:

- all 25 `.gs` files
- all 8 `.html` client files (once they exist in this folder)
- `appsscript.json` (runtime, time zone, scopes, web app settings)

> `.clasp.json` contains your Script ID and is already listed in the repository `.gitignore`,
> so it will never be committed by accident.

### 4. Install the platform

In the browser editor: pick **`setupSystem`** in the function dropdown → **▶ Run** → authorise.
Read the Super Admin email + temporary password from the Execution log (Part 4 of the main
guide).

### 5. Deploy the web app

**Deploy → New deployment → ⚙ → Web app → Execute as: Me → Who has access: Anyone → Deploy**,
then copy the `/exec` URL. (Or from the terminal: `clasp deploy --description "FocusHR live"`.)

---

## Everyday commands

| Command | What it does |
|---|---|
| `clasp push -f` | Upload your local files to the Apps Script project |
| `clasp pull` | Download the project files (careful — overwrites local files) |
| `clasp deploy -d "message"` | Create a new web-app version and deployment |
| `clasp deployments` | List deployments and their versions |
| `clasp logs` | Stream recent execution logs |
| `clasp open` | Open the project in the browser |

---

## Publishing an update to your team

```bash
cd Attend-Focuson/hrms
# edit files, then:
clasp push -f
clasp deploy -d "v1.1 - payslip fix"
```

The `/exec` URL never changes — your employees keep the same link.

---

## Troubleshooting

| Message | Fix |
|---|---|
| `Error: User has not enabled the Apps Script API` | Turn it on at <https://script.google.com/home/usersettings> |
| `Error: Script ID is not valid` | Re-copy the Script ID from Project Settings |
| `Files were not pushed` / nothing uploaded | Check you are inside `hrms/` and `.clasp.json` has `"rootDir": "."` |
| `SCOPE_ERROR` / permission prompt again | Authorise once in the browser editor by running `setupSystem` |
| Login expired | `clasp login` again |

---

*This is an alternative to Part 2/Part 3 of `STEP-BY-STEP-GUIDE.md` — the installation result is
identical.*
