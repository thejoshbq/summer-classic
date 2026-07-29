# Summer Classic — Operator Toolkit

Digital display and management tools for **The Summer Classic**, a six-week recreational axe-throwing league run by **Lumber Jill's** in the Charleston/Summerville, SC area.

Everything runs locally on venue hardware. No cloud, no accounts, no internet connection required once installed.

---

## Download

Download, install, and launch. The app opens in your browser automatically — nothing to configure.

| Platform | Download |
|---|---|
| Windows | [**SummerClassicSetup.exe**](https://github.com/thejoshbq/summer-classic/releases/latest/download/SummerClassicSetup.exe) |
| macOS | [**SummerClassic.dmg**](https://github.com/thejoshbq/summer-classic/releases/latest/download/SummerClassic.dmg) |
| Linux (AppImage) | [**SummerClassic-x86_64.AppImage**](https://github.com/thejoshbq/summer-classic/releases/latest/download/SummerClassic-x86_64.AppImage) |
| Linux (.deb) | [Browse latest release →](https://github.com/thejoshbq/summer-classic/releases/latest) |

---

## What's inside

Once running, the app opens to a hub page with links to everything an operator or a TV display needs:

| Page | What it's for |
|---|---|
| **Admin** | Operator controls — manage teams, players, scores, and brackets |
| **Standings TV** | Season standings board for display |
| **Bracket TV** | Murderball and Home Run Derby elimination brackets |
| **Game TV (Rotation)** | Live championship scoreboard |
| **Draft TV** | Team draft display |

Admin pages are built for a laptop trackpad. TV pages are built for a 1080p display and update automatically — no refreshing needed.

---

## Design system

All displays share the same look exactly. Brief palette reference:

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
- Score sheet management — physical handouts only
- Jersey or prize procurement — external

---

## For developers

Everything below is only relevant if you're working on the codebase itself — not needed to run the app.

```bash
git clone git@github.com:thejoshbq/summer-classic.git
cd summer-classic
npm install
npm start
```

The app opens your browser to the hub automatically, same as the packaged build.

**Stack:** Node.js + Express (only runtime dependency is `express`), flat-file JSON persistence, vanilla JS frontend — no framework, no bundler, no build step. Installers are built and published via `.github/workflows/release.yml` on tag push.

---

Built for Lumber Jill's. Drop the operator a beer if you see this in the wild.
