# MACH6 UPGRADE TRACKER
> Pinned by Ali — 2026-02-22 11:30 PM PKT
> "This is you we are working on."

## P0 — Critical (Unlocks core capability)
- [ ] **message/send tool** — Proactive messaging to any channel/chat. Send text, media, reactions.
- [ ] **Media download pipeline** — Auto-download incoming media (images, audio, docs) to local path. Attach to envelope so agent can see/analyze.
- [ ] **Image tool → real vision** — Wire image tool to actually call vision API (Anthropic/OpenAI). Or inject image content blocks into the LLM conversation.

## P1 — High (Unlocks autonomy)
- [ ] **Heartbeat wiring** — Connect HeartbeatScheduler to daemon. On fire → inject heartbeat message into session.
- [ ] **Cron scheduler** — Job runner with schedules, model selection, budget limits. Replace OpenClaw crons.
- [ ] **spawn tool** — Expose sub-agent spawning as a tool. Wire onComplete back to parent session.

## P2 — Medium (Unlocks full capability)
- [ ] **Browser tool** — Puppeteer/Playwright wrapper. Reuse OpenClaw Chromium profile. Screenshots, navigation, interaction.
- [ ] **reaction tool** — Emoji reactions on messages via tool call.
- [ ] **calendar tool** — Read/create calendar events.
- [ ] **email tool** — Send/read email (SMTP + IMAP).

## P3 — Low (Polish)
- [ ] **Token tracking** — Wire provider usage events to session.trackUsage().
- [ ] **Session archival** — Archive old sessions to compressed storage. Prevent unbounded growth.

---

## Progress Log
<!-- Append entries as items are completed -->
