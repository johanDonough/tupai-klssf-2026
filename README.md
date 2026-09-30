# Tupai at KLSSF 2026: booth registration page

A single-URL page for Tupai's booth at the KL Seni & STEM Festival (KLCC Park Esplanade, Fri 2 to Sun 4 Oct 2026).

Tupai is giving away **up to 100 KSSM and up to 100 IGCSE accounts** (Family Duo, 1 year). The page shows how many of each are left, lets a visitor claim one through a short form, and gives staff a passcode-protected list with CSV export and a place to upload the booth's QR code.

## How it fits together

- **The page** is plain HTML, CSS and JavaScript with no build step. It is hosted on GitHub Pages.
- **The record** is a Google Sheet with a KSSM tab and an IGCSE tab. A script attached to the Sheet (`backend-sheets/Code.gs`) is the only thing that reads or writes it. Setup steps: [`backend-sheets/SETUP.md`](backend-sheets/SETUP.md).
- `js/config.js` says which backend the page talks to: `demo`, `sheets` or `supabase`.

## Screens

| Route | What it is |
|---|---|
| `#/` | Landing page: counters, QR code, "Register here" button. Booth-display layout on wide landscape screens; stacked layout (no QR) on phones and portrait tablets. |
| `#/register` | Claim form on the visitor's own phone. This is what the QR code opens. |
| `#/register?booth=1` | Same form on the booth device. After success it shows "Next visitor" and returns to the landing page after 10 seconds. |

Success, blocked (already claimed, not open yet, closed, all claimed) and staff screens are shown in place and cannot be reached by address. The staff view opens with a **double-click on the logo**. All visitor-facing copy is English with Bahasa Malaysia beneath, in `js/copy.js`.

## Rules

Every rule is enforced by the backend. The page repeats the checks only for fast feedback (`js/validate.js`).

| Rule | Detail |
|---|---|
| Hard cap | 100 per syllabus. Claims are processed one at a time under a lock, so two people cannot both take the last account. |
| No duplicates | The same email (any capitalisation) or the same phone number cannot claim twice, across both lists. |
| Time window | Fri 2 Oct 08:00 to midnight at the end of Sun 4 Oct, Malaysia time. |
| Phone | `+60`: Malaysian mobile, 9 or 10 digits starting with 1. Any other country code: 6 to 12 digits, 15 in total at most. |
| Consent | Must be ticked. Wording addresses the parent or guardian. |
| Speed limit | More than 10 accepted claims in a minute: further claims are asked to try again shortly, and an alert email is sent. |
| No formulas | A name or email cannot begin with `=`, `+`, `-` or `@`, and every cell is written as plain text. |
| Staff passcode | Checked by the backend against a salted hash. Five wrong tries lock the staff view for 5 minutes. |
| Timestamp | Set by the backend, not by the browser. |

## Booth QR code

The landing page draws its own QR code for the registration link. Staff can replace it with their own image: staff view > **Booth QR code** > **Upload QR image**. The card shows the exact link the QR must open. The uploaded image is redrawn as a small PNG in the browser and stored by the backend, so every booth screen shows the same one.

Use a plain (static) QR code. A "dynamic" code from a QR website sends every visitor through that company's servers, and free plans can carry scan limits or an advert page.

## Run it locally

```bash
python -m http.server 8026
```

Then open http://localhost:8026. On Windows, double-clicking `start-demo.bat` does both steps.

With `mode: 'demo'`, claims stay in the browser's localStorage, the **DEMO** pill (bottom-left) loads sample data and switches the registration window, and the staff passcode is `demo`.

## Tests

```bash
cd backend-sheets/test
node test-code.mjs
```

96 checks run `Code.gs` against a fake of the Google services: the window, every validation rule, duplicates, the cap, the speed limit and alert, the passcode and lockout, the QR upload, and the menu actions. They prove the logic, not how the real Sheets service behaves, so the live checks in `SETUP.md` still matter.

## Known limits

- **The QR code is visible to anyone who opens the page**, and the link works from anywhere. Nothing proves a claimant is at the booth. The speed limit, the duplicate block and the cap are the protection, and junk rows can be deleted in the Sheet to free their slots.
- **The staff lockout is shared.** Apps Script cannot see who is calling, so five wrong passcodes lock the staff view for everyone for 5 minutes. The Sheet's menu can unlock it.
- **Each claim takes 1 to 3 seconds**, which is how fast Apps Script answers.
- **CSV phone numbers start with an apostrophe** (`'+60123456789`), which stops Excel treating `+60…` as a formula.
- **Fonts** load from Google Fonts, so booth devices need internet (they do anyway, for the backend).

## Alternative backend: Supabase

`backend/` holds an equivalent Postgres backend (tables locked down with row-level security, the same rules in one database function, 73 passing tests, and a race test for a live project). It is faster and its staff lockout is per IP address. It does not have the speed limit or the QR upload. To use it, run `backend/schema.sql`, set the passcode with `select public.set_admin_passcode('…')`, and set `mode: 'supabase'` in `js/config.js`.

## Files

```
index.html                  page shell
start-demo.bat              runs it locally on Windows
css/styles.css              all styling (Tupai design tokens)
js/config.js                which backend, and its address
js/copy.js                  every string, EN and BM
js/countries.js             country calling codes
js/validate.js              client-side copy of the validation rules
js/api.demo.js              demo backend (localStorage)
js/api.sheets.js            Google Sheet backend client
js/api.supabase.js          Supabase backend client
js/app.js                   screens, routing, staff view, CSV, QR upload
vendor/qrcode.js            QR generator (qrcode-generator 1.4.4, MIT)
assets/                     logo
backend-sheets/Code.gs      the script that lives in the Google Sheet
backend-sheets/SETUP.md     how to set the Sheet up
backend-sheets/test/        logic tests
backend/                    alternative Supabase backend and its tests
docs/mockup.pdf             Claude Design mockup (layout reference; shows a fixed +60 and 10am, both since changed)
```

Icons are Tabler Icons (MIT), inlined as SVG in `js/app.js`.
