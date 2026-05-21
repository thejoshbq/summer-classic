# Summer Classic — Operator Toolkit

This repository contains the digital display and management applications for **The Summer Classic**, a six-week recreational axe-throwing league run by **Lumber Jill's** in the Charleston/Summerville, SC area. All apps run locally on venue hardware. No cloud deployment, no auth, no external services.

---

## Repository Structure

```
/
├── standings-board/         # Season standings board (app 1)
├── elimination-bracket/     # Murderball + Home Run Derby brackets (app 2)
├── championship-scoreboard/ # Championship Game live scoreboard (app 3)
└── CLAUDE.md
```

Each app is an independent Node.js + Express server with flat-file JSON persistence. They share no code, no database, and no runtime dependencies on each other. Run each with `node server.js` inside its directory.

---

## Shared Stack Conventions

These apply to all three apps unless a specific app's README says otherwise.

- **Backend:** Node.js + Express. Only dependency is `express`.
- **Persistence:** Single flat-file `*.json` in the app root. Human-readable. Hand-editable as a fallback.
- **Frontend:** Vanilla JS. No framework, no bundler, no build step.
- **Fonts:** Oswald + Barlow Condensed loaded from Google Fonts CDN.
- **Display route:** `/display` — TV-facing, 1920×1080, no interaction required.
- **Admin route:** `/admin` — operator-facing, laptop trackpad operable, large tap targets.
- **Root `/`:** Redirects to `/display`.
- **Polling:** Display pages poll `/api/*` every 5 seconds and re-render without full page reload.

---

## Brand

All display UIs share this design system exactly. Do not deviate.

**Color palette:**
- `#114566` — navy. Primary background.
- `#0d3650` — dark navy. Header, footer, card backgrounds.
- `#196A73` — teal. Labels, borders, accents, badges.
- `#F28F16` — orange. Titles, leader highlights, winners, active states.
- `#F25C05` — red-orange. Points, outs, emphasis moments.
- `#BF0606` — red. Used sparingly — currently only the FINAL badge in the scoreboard.
- `rgba(25,106,115,0.25)` — muted teal. Dividers.

**Color hierarchy:** navy for structural dark blocks → teal for supporting borders and labels → orange for accents on dark fields → red-orange for emphasis moments → red used sparingly.

**Typography:**
- Oswald: all data, headers, names, scores, labels. Weights 400/500/600/700.
- Barlow Condensed: venue name, taglines, secondary text. Weights 400/500/600.

**Shell (all displays):**
- Outer background: `#114566`. Border-radius: 12px.
- Header: `#0d3650`, bottom border `3px solid #F28F16`.
- Header left: venue name in teal → display title in orange (Oswald 700) → subtitle in `rgba(255,255,255,0.4)`.
- Footer: `#0d3650`, border-top `1px solid rgba(25,106,115,0.3)`. Right-aligned italic tagline: *"Have fun. Build community. Give back."* in `rgba(255,255,255,0.2)`.

---

## App 1 — Standings Board (`/standings-board`)

Displays season standings updated after each league night (Days 2–6).

**Display columns:** Seed · Team · W–L · Points

**Data model (`standings.json`):**
```json
{
  "day": 3,
  "teams": [
    { "id": "uid", "name": "Team Name", "w": 2, "l": 0 }
  ]
}
```

**Points formula:** wins × 3. Computed server-side. Never stored directly.

**Sort:** descending by points. Seed reflects rank. Tiebreakers reflected in sort order, not displayed.

**Leader row treatment:** top seed gets left orange border, faint orange background tint, name and points in `#F28F16`.

**Admin controls:** add/edit/delete teams · set W and L per team · set current day number (1–6).

---

## App 2 — Bracket Display (`/elimination-bracket`)

Handles two elimination formats across Days 4 and 6. Mode is selectable from the admin panel.

### Mode 1 — Murderball (Day 4)

Parallel heat elimination. Heat size = lane count (configurable, 2–4). All heats run simultaneously per round. Lowest scorer per heat eliminated. Multiple eliminations per round. Bracket consolidates until one champion remains.

Display: horizontal grid. Rounds as columns. Heats as stacked cards within each column. Players listed within each heat.

Bye rule: if player count doesn't divide evenly into heat size, lowest-seeded player gets the bye for that round and auto-advances.

Team points by survival depth (feeds season standings, tracked externally):
- Round 1 out = 1pt · Round 2 = 2pt · Round 3 = 3pt · Finalist = 4pt · Champion = 6pt

### Mode 2 — Home Run Derby (Day 6)

Standard single-elimination head-to-head bracket. Two players per matchup, one advances. Seeded by roster order set in admin. Odd counts: lowest seed gets first-round bye.

Final matchup is 7 throws each (all other rounds: 5 throws). Final matchup card gets `border: 2px solid #F28F16`.

Display: classic left-to-right tournament tree. Seed + name + score per row. Winner in orange, loser struck through.

**Player states (both modes):**
- Active: `#fff`
- Advanced/winner: `#F28F16`
- Eliminated/loser: `rgba(255,255,255,0.25)` + `text-decoration: line-through`
- Bye: `#196A73`, italic

**Champion card:** `border: 2px solid #F28F16`. Label "CHAMPION" or "DERBY CHAMPION". Name in `#F28F16`, 17px Oswald 700.

**Admin controls:** mode select · player roster (drag to reorder = seeding) · lane count (Murderball) · generate bracket · mark eliminations / enter scores · declare champion · undo last action (single level).

---

## App 3 — Championship Scoreboard (`/championship-scoreboard`)

Live scoreboard for the Day 6 Championship Game only. Two states.

### State: live

Header right: teal inning badge — "INNING" label · half ("Top"/"Bottom") · number.

Line score: 9 innings across, visitor on top, home on bottom. Completed half-innings show runs. Active half-inning shows a dot placeholder (`#F25C05`). Unplayed innings show "—" in `rgba(255,255,255,0.2)`.

At-bat panel: current pitcher name · current batter name · occupied bases (diamond graphic, active bases `#F28F16`) · outs 0–2 (active `#F25C05`) · ball count 0–3 (active `#196A73`).

### State: final

Header right: red pill (`#BF0606`) — "FINAL" in 28px Oswald 700, letter-spacing 4px.

Line score: all innings filled. Winning team name and total in `#F28F16`. Losing total `rgba(255,255,255,0.5)`.

Lower panel: winner block (team name 30px Oswald 700 orange, "SUMMER CLASSIC CHAMPIONS" label above) · final score callout (large run totals, winner orange, loser muted).

Footer: "X innings played" on the left (covers extra innings).

Winner determined automatically by total run comparison server-side on "Declare final."

**Admin controls:** set team names · increment/decrement runs per inning per team · advance inning / set half · set pitcher and batter names · toggle base occupancy · set outs · set ball count · "Clear bases + reset count" (end-of-half shortcut) · declare final · reset game.

**Data model (`game.json`):**
```json
{
  "status": "setup|live|final",
  "visitor": { "name": "", "innings": [] },
  "home":    { "name": "", "innings": [] },
  "currentInning": 1,
  "currentHalf": "top|bottom",
  "pitcher": "",
  "batter": "",
  "bases": { "first": false, "second": false, "third": false },
  "outs": 0,
  "balls": 0,
  "inningsPlayed": 0
}
```

Null innings = "—". Zero innings = "0". Totals always computed server-side.

---

## League Context

Knowing how the league works helps when extending or debugging these apps.

**The six-day arc:**

| Day | Name | Format |
|---|---|---|
| 1 | Spring Training | Free agent night. Skill assessment. Scout Reports collected. No competitive stakes. |
| 2 | Opening Day | Team reveals, captain selection, first baseball game. Standings go live. |
| 3 | The Bullpen | Standard league baseball game. Jerseys distributed. |
| 4 | Murderball | Individual heat elimination. Feeds team points into standings. |
| 5 | Playoffs | Format flexes with team count (4/5/6 teams). Season stats tallied. |
| 6 | The World Series | Home Run Derby, Championship Game, awards ceremony. |

**House Baseball (the core game format):**
- Two teams alternate pitching and batting. Every at-bat is one pitcher vs. one batter.
- Score comparison: pitcher > batter = out · tied = strike · batter > pitcher = hit (bases advanced = score differential) · differential 4+ = run scored.
- Batter calls killshot (face value 10) before throw: if hit and unmatched = home run. Both hit killshots = strike.
- Ball rule: pitcher non-stick = ball. 4 balls = walk.
- Changeup Pitch: pitcher throws non-dominant at discretion, declares after landing. Score × season multiplier (locked pre-season). Stacks with killshot.
- Trick Shot variation: declared before throw. Successful = 1.5× face value. Declared miss = zero.
- 9 innings per game. Mercy rule: 10-run lead after 5th ends the game (suspended for Championship).
- Captains submit locked batting order and pitching rotation before first pitch each game.

**Season standings formula:** wins × 3 (baseball games, Days 2–3) + Murderball survival depth points (Day 4). The standings app only displays W–L and total points — it does not break out Murderball points.

**Roles:**
- Commissioner: runs the room, arbitrates, emcees. Not playing.
- Player-Coaches: play on teams, handle lane operations and score sheets.
- Captains: one per team. Submit lineups, score, verify, hand in sheets.

**Prizes:**
- Championship team: pre-engraved pint glasses ("Summer Classic Champions [Year] — Lumber Jill's"). Generic — no player names. Distributed Day 6.
- Home Run Derby winner: custom engraved throwing hatchet (13–16"). Presented Day 6.
- Murderball champion: drink on the Commissioner's tab, night of.

**Key operational notes for display logic:**
- Murderball bye goes to the player with the lowest Spring Training composite score. Admin sets this manually via roster ordering.
- Home Run Derby is open to playoff losers only. Championship Game participants are not eligible.
- The Derby final is 7 throws each; all other matchups are 5.
- Extra innings resolve ties in the Championship Game — the scoreboard inning counter runs past 9.

---

## What These Apps Do Not Handle

- Stat tracking (Changeup Award, Most Clutch, MVP) — done on paper score sheets, tallied by coaches on Day 5.
- Playoff bracket (Day 5) — not yet built. Would reuse the brackets app bracket display component.
- Score sheet management — physical handouts only.
- Jersey or prize procurement — external to this repo.
