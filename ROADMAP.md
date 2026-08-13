# State Rooms — what's agreed but not yet built

## Admin zone (agreed 12 Aug 2026 — build after current work)

A separate browser view for admins, running outside the community embed.

- **Admin flag** on members, visible in chat (badge), plus the ability for
  an admin to invite/promote other admins. The `is_host` column already
  exists in the profiles table and is the seed for this.
- **Moderation**: members can flag/report a message; admins see a queue of
  flagged content and can remove messages.
- **Member overview**: list of everyone in the app, searchable, with the
  ability to remove a person.
- **Broadcast message**: an admin can send an urgent message to every state
  at once (already partly covered by announcements — this adds urgency and
  reach, e.g. "join now", or a link to a video).

## Already noted earlier

- **Member gate**: only paying community members may sign in — Zapier
  watches Mighty Networks joins/leaves and keeps an allow-list current.
  The `profiles.email` column is filled by Google sign-in for this purpose.
- **Voice at scale**: the current voice test is peer-to-peer (fine for a
  handful of people). If it proves out, move to LiveKit for large rooms,
  stage/hand-raise controls, enforceable mute/kick, and recording.
- **Member-created talk rooms** (agreed 13 Aug 2026): several parallel
  Live Rooms per state — anyone can open "New York talk" alongside the
  main one. Needs LiveKit; one mesh call per room does not scale.
- **Hand over ownership**: Google Cloud project + Supabase org transfer to
  the client's accounts; regenerate the Google client secret at handover.
- **Tidy GitHub**: make `main` the default branch, delete the old
  `claude/state-chat-community-app-x525hu` branch.
