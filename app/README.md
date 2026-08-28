# Nexer speeddating — bokningssystem

Real implementation of the `Speeddating Booking.dc.html` design from `project/`
(Claude Design handoff — see the repo root `README.md` and `chats/chat1.md`
for the full design intent). Static HTML/CSS/JS front end, Supabase for
shared, race-safe storage.

Schedule: Fredag 4 september, 09.00–12.00, 15-minuters intervjuer med 15
minuters lucka mellan varje → 6 tider (`app.js`, top of file — change
`SLOT_MINUTES`/`BUFFER_MINUTES`/`START`/`END` there if the morning changes
shape).

## What's here

- `index.html` / `styles.css` / `app.js` — the app. No build step, no
  framework; `styles.css` is the Nocturne design-system stylesheet
  (copied verbatim from `project/_ds/.../styles.css`, which is plain CSS)
  plus the page's own layout rules.
- `config.js` — Supabase URL + anon key. **Placeholders — fill these in.**
- `supabase/schema.sql` — the database setup (run once).

## Set up the backend

1. Create a Supabase project (supabase.com), or reuse an existing one.
2. Open the SQL editor and run `supabase/schema.sql` once. It creates the
   `bookings` table, a `public_slots` view, and three RPC functions
   (`create_booking`, `cancel_booking`, `get_admin_bookings`) — see the
   comments at the top of that file for why access goes through these
   instead of the table directly (it's what keeps candidate names out of
   reach of the anon key, and slots race-safe).
3. **Change the admin password** in `schema.sql` before running it — it
   currently matches the design's placeholder, `starforlife2005`
   (`get_admin_bookings`, near the bottom of the file).
4. In Project Settings → API, copy the **Project URL** and **anon public
   key** into `config.js`.
5. (Optional but recommended) Confirm Realtime is on for the `bookings`
   table — `schema.sql`'s last line adds it to the `supabase_realtime`
   publication, so every open booking page updates live when someone else
   books or cancels a slot, without a page refresh.

## Deploy

Three static files + one image — host them anywhere that serves plain
files (Netlify, a Supabase-hosted static site, SharePoint, any web
server). No build step.

## Known limitations (same trade-offs the design conversation flagged)

- **Admin password** is a single shared secret checked in a database
  function, not real authentication — anyone with the password (or who
  guesses it) sees every candidate's name. Fine for a one-morning
  internal tool; not for anything long-lived or higher-stakes.
- **Cancelling a booking** only requires the booking's own code
  (`NX-####`, one of 9000 combinations) — matches the original prototype's
  security level (a shared secret, not an account), not real auth either.
- Candidate names are stored only for the event and are never exposed to
  other candidates — the RLS setup in `schema.sql` blocks the anon key
  from reading the underlying table or other candidates' names directly,
  which the original localStorage-only prototype couldn't guarantee once
  shared beyond one browser.
