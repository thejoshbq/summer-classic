# Summer Classic — Operator Toolkit

Digital display and management apps for **The Summer Classic**, a six-week recreational axe-throwing league run by **Lumber Jill's** in the Charleston/Summerville, SC area.

Everything runs locally on venue hardware. No cloud, no auth, no external services.

---

## The three apps

| App | Directory | What it does | When it's used |
|---|---|---|---|
| **Standings Board** | [`standings-board/`](./standings-board) | Season W–L and points board, top seed highlighted | Days 2–6 |
| **Brackets** | [`elimination-bracket/`](./elimination-bracket) | Murderball heat elimination + Home Run Derby single-elim | Days 4 & 6 |
| **Championship Scoreboard** | [`championship-scoreboard/`](./championship-scoreboard) | Live 9-inning scoreboard with `live` and `final` states | Day 6 |

Each app is self-contained — independent Node.js + Express server, flat-file JSON persistence, vanilla-JS frontend, no shared code between them.

Every app exposes three routes:

- `/display` — TV-facing, 1920×1080, no interaction required, polls every 5s
- `/admin` — operator-facing, laptop trackpad operable, large tap targets
- `/` — redirects to `/display`

---

## Quick start

Each app is run independently. From inside an app directory:

```bash
npm install
npm start          # or: node server.js
```

| App | Default port | Open in browser |
|---|---|---|
| `standings-board` | `3000` | http://localhost:3000 |
| `elimination-bracket` | `3000` (override with `PORT=...`) | http://localhost:3000 |
| `championship-scoreboard` | `3001` | http://localhost:3001 |

`standings-board` and `elimination-bracket` both default to port `3000`. Run one at a time, or override with `PORT=3002 node server.js` for the bracket app.

---

## Tech stack

- **Backend:** Node.js + Express. The only runtime dependency is `express`.
- **Persistence:** A single human-readable JSON file in each app's root. Hand-editable as a fallback if the admin UI is unreachable.
- **Frontend:** Vanilla JS. No framework, no bundler, no build step.
- **Fonts:** Oswald + Barlow Condensed from Google Fonts CDN.

Polling-based updates only — display pages poll `/api/*` every 5 seconds and re-render without a full page reload.

---

## Design system

All three displays share the same look exactly. Brief palette reference:

| | Hex | Used for |
|---|---|---|
| Navy | `#114566` | Primary background |
| Dark navy | `#0d3650` | Header, footer, cards |
| Teal | `#196A73` | Labels, borders, accents |
| Orange | `#F28F16` | Titles, leaders, winners |
| Red-orange | `#F25C05` | Points, outs, emphasis |
| Red | `#BF0606` | Used sparingly — currently only the `FINAL` badge |

Typography: **Oswald** for data, headers, names, scores, labels. **Barlow Condensed** for venue name and taglines. Footer tagline across every display: *"Have fun. Build community. Give back."*

Full conventions are in [`CLAUDE.md`](./CLAUDE.md).

---

## League context (the short version)

Six nights, one champion. Roughly:

| Day | Name | Format |
|---|---|---|
| 1 | Spring Training | Free-agent night, skill assessment |
| 2 | Opening Day | Team reveals, first baseball game |
| 3 | The Bullpen | Standard league baseball game |
| 4 | Murderball | Individual heat elimination — feeds team points |
| 5 | Playoffs | Format flexes with team count |
| 6 | The World Series | Home Run Derby, Championship Game, awards |

"House Baseball" is the core format — pitcher vs. batter at the lane, killshot calls, walks on 4 balls, mercy rule after the 5th, 9 innings per game. Full mechanics live in [`CLAUDE.md`](./CLAUDE.md).

---

## Out of scope

These apps deliberately do *not* handle:

- Stat tracking (Changeup Award, Most Clutch, MVP) — paper score sheets, tallied by coaches on Day 5
- Day 5 Playoffs bracket — not yet built; would reuse the bracket display component
- Score sheet management — physical handouts only
- Jersey or prize procurement — external

---

Built for Lumber Jill's. Drop the operator a beer if you see this in the wild.
