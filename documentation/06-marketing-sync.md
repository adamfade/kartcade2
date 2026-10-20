# Booking data lockdown and marketing sync

## What this does

- **Locks down customer data.** The booking sheet's `allBookings` action used to return every customer's name,
  email and phone to anyone with the Apps Script URL (which is visible in the site's code). It now needs an
  admin key. The admin dashboard gets bookings through `/api/admin/bookings`, which checks the admin's sign-in.
- **Daily Mailchimp sync** (`/api/cron/marketing-sync`, 7am Pacific). Every real customer and every site account
  goes into the Mailchimp audience. New people are added as subscribed; anyone who unsubscribes stays
  unsubscribed. Owner block-outs and test accounts are skipped.
- **Tags** for Mailchimp automations: `Customer`, `Private event`, `Account, never booked`.
- **Weekly scorecard** emailed every Monday: hourly rig-hours by daypart, bookings, private events, new accounts.

## One-time setup (in this order)

1. **Make two random secrets** (Mac Terminal): run `openssl rand -hex 24` twice. One is the admin key, one is the cron secret.
2. **Mailchimp:** create a new audience (Audience → All contacts → Audience name dropdown → Create audience).
   Copy its **Audience ID** (Audience → Settings → Audience name and defaults). Create an **API key**
   (Profile → Extras → API keys → Create A Key).
3. **Vercel → kartcade2 → Settings → Environment Variables**, Production only, type **Secret**:
   - `APPS_SCRIPT_ADMIN_KEY` = the admin key
   - `CRON_SECRET` = the cron secret
   - `MAILCHIMP_API_KEY` = the Mailchimp API key
   - `MAILCHIMP_AUDIENCE_ID` = the audience ID
   - optional `SCORECARD_TO` = where the Monday scorecard goes (default kartcade.website@gmail.com)
4. **Merge the pull request.** The dashboard keeps working: the old script ignores the key until step 5.
5. **Apps Script** (bookings sheet → Extensions → Apps Script):
   - Project Settings (gear) → Script Properties → Add → `ADMIN_KEY` = the same admin key.
   - Editor: replace the code with `google-apps-script-v2.3.js` from this repo (or apply the two v2.5 changes:
     the `emailReport` and `allBookings` blocks in `handleRequest`, and the `isAdminKey` function).
   - Deploy → **Manage deployments** → edit the existing deployment → Version: **New version** → Deploy.
     Editing the existing deployment keeps the same URL. A brand-new deployment would change it.
6. **Check:** the admin dashboard still shows bookings. Opening the Apps Script URL with `?action=allBookings`
   in a private window now returns `unauthorized`.

## Mailchimp automations to turn on

- **Intro offer:** Automations → Customer Journey → starting point "Tag added: Account, never booked" →
  wait 3 days → email "Your first hour is $20" (honor it at the counter; code expires in 14 days).
- **Welcome / win-back:** starting point "Tag added: Customer"; win-back when `Last visit` is 45+ days ago.

Multi-step journeys depend on the Mailchimp plan.
