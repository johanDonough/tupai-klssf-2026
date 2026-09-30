# Tupai at KLSSF 2026: booth registration page

A single-URL page for Tupai's booth at the KL Seni & STEM Festival (KLCC Park Esplanade, Fri 2 to Sun 4 Oct 2026).

Tupai is giving away **up to 100 KSSM and up to 100 IGCSE accounts** (Family Duo, 1 year), claimed at the booth. The page shows how many of each are left, lets a visitor claim one through a short form, and gives staff a passcode-protected list with CSV export.

**Status: the front end is finished and runs in demo mode. The live backend is written and tested locally, but not deployed.** Deploying it is the handover (see "Going live").

## Try the demo (no setup)

Serve the folder and open it. Any static server works:

```bash
python -m http.server 8026
```

Then open http://localhost:8026. On Windows, double-clicking `start-demo.bat` does both steps.

- Demo mode keeps claims in the browser's localStorage only. Nothing leaves the device, and two devices do not share counts.
- The **DEMO** pill (bottom-left) loads sample data and switches the registration window between before, open and closed.
- Staff view: **double-click the logo**, passcode `demo`.

## Screens

| Route | What it is |
|---|---|
| `#/` | Landing page: counters, QR code, "Register here" button. Booth-display layout on wide landscape screens; stacked layout (no QR) on phones and portrait tablets. |
| `#/register` | Claim form on the visitor's own phone. This is what the QR code opens. |
| `#/register?booth=1` | Same form on the booth device. After success it shows "Next visitor" and returns to the landing page after 10 seconds. |

Success, blocked (already claimed, not open yet, closed, all claimed) and staff screens are shown in place and cannot be reached by address. All visitor-facing copy is English with Bahasa Malaysia beneath, in `js/copy.js`.

## Going live

The live backend is Postgres behind Supabase's REST endpoint. About 20 minutes.

1. **Create a Supabase project** (or use an existing Tupai one).
2. **Run `backend/schema.sql`** in the SQL editor. It creates the tables and functions and locks the tables down.
3. **Set the staff passcode** in the SQL editor. Johan has the passcode; do not commit it anywhere. Only a bcrypt hash is stored.
   ```sql
   select public.set_admin_passcode('THE-PASSCODE');
   ```
4. **Run `backend/test-mode.sql`**. It opens registration now and sets the KSSM cap to 3 so "full" is easy to reach.
5. **Edit `js/config.js`**: set `mode: 'supabase'`, `supabaseUrl` and `supabaseAnonKey`. Both values are public by design.
6. **Host the folder** on any static host over HTTPS. There is no build step.
7. **Test** (see "What to test on the live setup").
8. **Run `backend/go-live.sql`**. It deletes all test claims, restores both caps to 100 and sets the real window. After this the page shows "Registration opens Friday 2 October, 8am" until then. That is correct.
9. **Print the QR code only now**, from the live landing page. The QR encodes `<live URL>#/register`, so the URL must not change after printing.

Registration window (set in `event_config`): **Fri 2 Oct 08:00 to Mon 5 Oct 00:00 MYT**, continuous.

## Rules, and where each is enforced

Everything that matters is enforced in the database (`claim_account()` in `backend/schema.sql`). The browser repeats the checks only for fast feedback (`js/validate.js`).

| Rule | Detail |
|---|---|
| Hard cap | 100 per syllabus. Checked under a transaction-level advisory lock, so two simultaneous claims cannot both take the last account. |
| No duplicates | Same email (case-insensitive) or same phone number cannot claim twice, across both lists. |
| Time window | Claims outside `opens_at` to `closes_at` are refused. |
| Phone | `+60`: Malaysian mobile, 9 or 10 digits starting with 1. Any other country code: 6 to 12 digits, 15 in total at most. Stored as `+<digits>`. |
| Consent | Must be ticked. Wording addresses the parent or guardian. |
| No public reads | RLS is on for every table with **no policies**, and table privileges are revoked from `anon`. The public key can only call three functions. |
| Staff passcode | Checked in the database against a bcrypt hash. Never in the front end. 5 wrong tries from one IP locks that IP out for 5 minutes. |
| Timestamp | Set by the database (`created_at`), not by the browser. |

## API contract

`js/api.supabase.js` calls three Postgres functions through `POST <supabaseUrl>/rest/v1/rpc/<name>`. If you would rather use another backend, implement the same three calls and point `js/app.js` at it.

```
get_status()
  -> { kssm_cap, igcse_cap, kssm_left, igcse_left, state: "before" | "open" | "closed" }

claim_account(p_name, p_email, p_phone, p_syllabus, p_consent)
  p_phone is "+<country code> <national number>", e.g. "+60 12-345 6789"
  p_syllabus is "KSSM" or "IGCSE"
  -> "ok" | "duplicate" | "full" | "not_open" | "closed" | "invalid"

admin_list(p_passcode)
  -> { ok: true, kssm_cap, igcse_cap, kssm: [row], igcse: [row] }      row = { name, email, phone, created_at }, newest first
   | { ok: false, reason: "wrong", tries_left }
   | { ok: false, reason: "locked", retry_seconds }
```

## What has been tested

- **Database logic: 73 checks pass** against an in-process Postgres (PGlite). Covers the lock-down, the window, every validation rule, duplicates, the cap, the passcode hash, the lockout, and both SQL scripts.
  ```bash
  cd backend/test
  npm install
  npm test
  ```
- **Front end, in demo mode, in a browser:** form validation, a successful claim, duplicate, foreign number, the booth flow and auto-return, a syllabus filling up (including the case where the page thought one was left and the server said full), all claimed, before and closed states, the staff login, lockout, search, tabs, refresh and CSV output. Layout checked at 375, 895, 1180, 1366, 1600 and 1920 px wide.

## What to test on the live setup

These need a real Supabase project, so they have **not** been run:

1. **Simultaneous claims.** In test mode (KSSM cap 3):
   ```bash
   cd backend/test
   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=... node race.mjs
   ```
   It fires 25 claims at once and expects exactly as many `ok` as there were accounts left. It also checks the public key cannot read any table.
2. **IP-based lockout.** `admin_list()` reads the caller's IP from the `x-forwarded-for` request header. Confirm a wrong passcode is recorded against your real IP (`select * from admin_attempts`), not `unknown`. If it shows `unknown`, the lockout still works but is shared by everyone.
3. **End to end on real phones:** scan the QR from the landing page, claim, watch the counter drop within 20 seconds, then check the staff list and a CSV export.
4. **Booth device:** "Register here", claim, confirm it returns to the landing page and the form is empty for the next visitor.

## Known limits and open points

- **Bots.** There is a honeypot field but no rate limit or CAPTCHA on claims. Someone scripting the endpoint during the window could burn the allocation with fake emails. Junk rows can be deleted in the Supabase table editor, which frees the slots. Add Turnstile or similar if this is a real concern.
- **Staff view is read-only.** No edit or delete from the page.
- **CSV phone numbers start with an apostrophe** (`'+60123456789`). It stops Excel treating `+60…` as a formula. The same guard applies to any cell starting with `=`, `+`, `-` or `@`.
- **Logo.** The page uses the Parent App icon (`assets/parent-app-logo.svg`), as instructed. The Claude Design mockup (`docs/mockup.pdf`) used the horizontal Tupai wordmark. To swap, change `logo` in `js/config.js`.
- **Bahasa Malaysia copy** is a draft and needs a native-speaker check before the event. It is all in `js/copy.js`.
- **Privacy notice** names `johan@tupai.ai` as the contact.
- **Fonts** load from Google Fonts, so the booth device needs internet (it does anyway, for the backend).
- The mockup PDF is slightly out of date in two places: it shows a fixed `+60` and a 10am opening time. The build is right; the PDF is a layout reference only.

## Files

```
index.html               page shell
start-demo.bat           runs the demo locally on Windows
css/styles.css           all styling (Tupai design tokens)
js/config.js             demo vs live switch, Supabase URL and key
js/copy.js               every string, EN and BM
js/countries.js          country calling codes
js/validate.js           client-side copy of the validation rules
js/api.demo.js           demo backend (localStorage)
js/api.supabase.js       live backend (three RPC calls)
js/app.js                screens, routing, staff view, CSV
vendor/qrcode.js         QR generator (qrcode-generator 1.4.4, MIT)
assets/                  logo
backend/schema.sql       tables, lock-down, functions
backend/test-mode.sql    open now, KSSM cap 3
backend/go-live.sql      clear test rows, real caps and window
backend/test/            schema tests and the live race test
docs/mockup.pdf          Claude Design mockup (22 screens)
```

Icons are Tabler Icons (MIT), inlined as SVG in `js/app.js`.
