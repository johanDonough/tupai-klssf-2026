# Setting up the Google Sheet

About 10 minutes. Do it signed in to the Google account that should own the claims.

## 1. Create the Sheet and add the script

1. Create a new Google Sheet. Name it something like **Tupai KLSSF 2026 registrations**.
2. In the Sheet, open **Extensions > Apps Script**.
3. Delete everything in the editor. Paste in the whole of [`Code.gs`](Code.gs).
4. Click the save icon. Name the project if asked.

## 2. Set up the tabs and the passcode

1. Go back to the Sheet and reload the page. A **Tupai KLSSF** menu appears after a few seconds.
2. Click **Tupai KLSSF > 1. Set up this sheet**.
   - The first time, Google asks for permission. Choose your account and click **Allow**.
   - If nothing seems to happen after allowing, click the menu item once more.
   - You should now have three tabs: **KSSM**, **IGCSE** and **Settings**.
3. Click **Tupai KLSSF > 2. Set staff passcode** and type the passcode staff will use on the page.
4. Click **Tupai KLSSF > Testing: open registration now**. Otherwise the page says "opens Friday" and refuses test claims.

## 3. Publish the script as a web app

1. In the Apps Script tab, click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**. Copy the **Web app URL**. It ends in `/exec`.
5. Put that URL into `js/config.js` as `sheetsUrl`, and set `mode: 'sheets'`.

**If "Anyone" is not offered** (only "Anyone within Tupai" or similar), the organisation's policy is blocking public scripts. Stop there. The fallback is to repeat these steps in a personal Google account.

## 4. Check it

Open the web app URL in a browser. You should see a line of text like:

```
{"kssm_cap":100,"igcse_cap":100,"kssm_left":100,"igcse_left":100,"qr_version":"","state":"open"}
```

Then claim through the page and watch the row appear in the KSSM or IGCSE tab.

## Before the event

Click **Tupai KLSSF > Go live: clear test claims and set real times**. It deletes every test claim, sets both caps to 100, and sets registration to open Fri 2 Oct 08:00 and close at midnight at the end of Sun 4 Oct (Malaysia time).

Never run "Go live" during or after the event. It deletes the claims.

## During the event

- **The KSSM and IGCSE tabs are the master lists.** New claims appear at the bottom.
- **Fake or mistaken rows:** right-click the row number and choose **Delete row**. The slot is free again within a few seconds.
- **Settings tab:** caps, opening and closing times, the speed limit and the alert email can be changed there at any time. Times are Malaysia time, written as `2026-10-02 08:00`.
- **Alert email:** if more claims arrive in one minute than the speed limit allows, new claims are asked to try again shortly and an email goes to the alert address (at most one every 15 minutes).
- **Staff view locked out?** Five wrong passcodes lock the staff view for everyone for 5 minutes. **Tupai KLSSF > Unlock the staff view** clears it straight away. The Sheet itself is unaffected.

## If the script is changed later

In Apps Script, paste the new code, save, then **Deploy > Manage deployments > pencil icon > Version: New version > Deploy**.

Do not use "New deployment" again. That creates a different URL and the page would stop working.

## What Google will ask permission for

- **See, edit, create and delete your spreadsheets:** to read and write the claims.
- **Send email as you:** only for the alert email.

The Sheet is not shared with anyone by this setup. The page never reads the Sheet directly; it only gets what the script chooses to answer.
