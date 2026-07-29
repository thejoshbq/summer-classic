// rcedit ships as an ESM API only (no CLI/bin) — this wraps it so CI and
// `npm run package:win` can invoke it as a plain command.
import { rcedit } from 'rcedit'

const [exePath, iconPath] = process.argv.slice(2)
if (!exePath || !iconPath) {
  console.error('Usage: set-win-icon.mjs <exe> <icon.ico>')
  process.exit(1)
}

await rcedit(exePath, { icon: iconPath })
