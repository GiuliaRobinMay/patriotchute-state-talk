# State Rooms

A room for every US state, built to live inside a Mighty Networks community.
Members join once, pick their state, and talk to people close by — in text, and
out loud if the browser lets us.

This is the **preview build**: the real interface at a real URL, with no backend
yet. Profiles and messages are saved on the visitor's own device. That's
deliberate — it lets us put the actual app inside the actual embed and find out
what the browser allows before committing to a database.

## Putting it online

No accounts, no build step, no configuration.

1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import
   an existing project**.
2. Pick GitHub, then this repository, then the branch
   `claude/state-chat-community-app-x525hu`.
3. Leave every build setting alone — `netlify.toml` already says the site is the
   `public` folder and there is nothing to compile. Press **Deploy**.

You'll get a URL like `https://something-random.netlify.app`. That's the link to
embed.

## What to test, in order

**1. Does it embed at all?**
Add the URL to a space in your community and see whether it renders. Check it on
a laptop *and* inside the Mighty mobile app — they behave differently.

**2. What does the browser allow in there?**
Embed `your-url/check.html` and open it inside the community. It reports six
things, including the one that decides whether live voice is possible. Press
**Test the microphone**, then **Copy results** and send them over.

**3. Does the app feel right?**
Join, pick a state, send a few messages. Messages are local to your device, so
don't expect a second phone to see them yet.

The host view for announcements is at `your-url/#announce` until real roles
exist.

## What's here

```
public/index.html   the app
public/app.js       all of its behaviour
public/app.css      the whole visual system
public/states.js    the 51 rooms, and placeholder headcounts
public/check.html   the embed diagnostics page
netlify.toml        publish folder and the headers that let it be framed
```

## What comes next

Once the check comes back, the preview build becomes the real one:

- **Chat that's actually shared.** Supabase for accounts, message history and
  live delivery. This is the biggest piece and it's what turns the preview into
  a product.
- **The member gate.** A Zapier connection watching your community for joins and
  departures, keeping the allow-list current, so the email field on the join
  screen checks something real.
- **Live voice**, if the microphone check passes — LiveKit for the stage, or a
  pop-out tab if the embed refuses.

## Notes for later

`netlify.toml` currently permits framing from any Mighty Networks domain. Once
the community's real address is known, narrow `frame-ancestors` to that exact
host so nothing else can embed the app.
