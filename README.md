# State Rooms

A room for every US state plus one national room (All USA), built to live
inside a Mighty Networks community. Members sign in once with Google, pick
their state, and talk to people close by — in text, and out loud in each
room's Live Room.

Live at https://patriotchute-state-talk.vercel.app, embedded in the
community at patriotchute.com.

## How it fits together

```
index.html    the app: join, chat, Live Room, admin zone, settings
app.js        all of its behaviour
app.css       the whole visual system, dark and light
db.js         the data layer — Supabase behind one interface
voice.js      peer-to-peer voice with Supabase realtime as signalling
states.js     the 51 rooms and placeholder city names
config.js     the Supabase project URL and publishable key
schema.sql    the database: tables, security policies, admin functions
vercel.json   headers that let the community frame the app
ROADMAP.md    what's agreed but not built yet
```

Push to `main` and Vercel redeploys. `schema.sql` is idempotent — paste the
whole file into the Supabase SQL Editor and Run after pulling schema changes.

## The parts

- **Sign-in** — Google OAuth through Supabase. Inside the embed the consent
  screen opens in a small window (Google refuses to render in an iframe)
  and hands the session back by postMessage.
- **Chat** — per-room messages over Supabase realtime; own messages on the
  right; emoji tray; report flag on hover.
- **Live Room** — speakers on a stage with speaking rings, listeners below,
  upcoming gatherings underneath. Voice is a WebRTC mesh (fine for a
  handful of speakers; LiveKit is the planned upgrade for scale and for
  enforceable mute/kick). Taking the mic inside the embed pops out to a
  tab because Mighty does not grant microphone permission to frames.
- **Announcements** — pinned notices, optionally targeted per state, with
  an optional gather time (weekly repeat supported), shown in each
  member's own timezone.
- **Admin zone** — behind the name menu, `is_host` only: announce
  composer, flagged-message queue, member management (remove/restore,
  promote admins). Bans are enforced by row-level security, not the UI.

## Known constraints (measured, not assumed)

- Mighty Networks does not pass `allow="microphone"` into its embed — a
  support request to add it for this app's URL removes the pop-out.
- The voice mesh has no relay server (STUN only), so some strict corporate
  networks will fail to connect a call.
