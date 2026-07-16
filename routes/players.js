const express = require('express');
const { players, teams, bracket, game, draft } = require('../lib/stores');
const { uid } = require('../lib/ids');
const { VARIATION_NAMES, THROWS_PER_VARIATION, computeScoutScore } = require('../lib/constants');

const router = express.Router();

// ── Variation helpers ──────────────────────────────────────────────────

function defaultVariations() {
  return VARIATION_NAMES.map(name => ({
    name,
    throws: Array(THROWS_PER_VARIATION).fill(0)
  }));
}

function normalizeVariations(input) {
  // Always returns VARIATION_NAMES.length entries with canonical names and
  // THROWS_PER_VARIATION ints each clamped to 0..5.
  // Key order: { name, throws } — stable for JSON.stringify dirty-checks.
  return VARIATION_NAMES.map((canonicalName, i) => {
    const src = Array.isArray(input) ? input[i] : null;
    const rawThrows = src?.throws;
    const throws = Array.isArray(rawThrows)
      ? Array.from({ length: THROWS_PER_VARIATION }, (_, j) => {
          const v = Number(rawThrows[j]);
          return Number.isFinite(v) ? Math.max(0, Math.min(5, Math.round(v))) : 0;
        })
      : Array(THROWS_PER_VARIATION).fill(0);
    return { name: canonicalName, throws };
  });
}

// ── Routes ─────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  // Lazy-inject variations on read without mutating the store cache, and
  // recompute scoutScore live so players saved before auto-calc existed
  // (or never re-saved since) still display the correct derived value.
  const defaults = defaultVariations();
  const list = players.get().map(p => {
    const variations = p.variations ?? JSON.parse(JSON.stringify(defaults));
    return { ...p, variations, scoutScore: computeScoutScore(variations) };
  });
  res.json(list);
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const list = await players.update(curr => {
    const variations = normalizeVariations(null);
    curr.push({ id: uid(), name, scoutScore: computeScoutScore(variations), variations });
    return curr;
  });
  res.status(201).json(list);
});

router.put('/:id', async (req, res) => {
  let updated;
  const list = await players.update(curr => {
    const p = curr.find(x => x.id === req.params.id);
    if (!p) return curr;
    if (req.body?.name !== undefined) p.name = String(req.body.name).trim();
    if (req.body?.variations !== undefined) {
      p.variations = normalizeVariations(req.body.variations);
    }
    p.scoutScore = computeScoutScore(p.variations ?? normalizeVariations(null));
    updated = p;
    return curr;
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(list);
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  let removed = false;
  await players.update(curr => {
    const idx = curr.findIndex(p => p.id === id);
    if (idx === -1) return curr;
    curr.splice(idx, 1);
    removed = true;
    return curr;
  });
  if (!removed) return res.status(404).json({ error: 'not found' });

  // Cascade: drop from team rosters (and clear captaincy if it was them)
  await teams.update(curr => {
    for (const t of curr) {
      t.playerIds = (t.playerIds || []).filter(pid => pid !== id);
      if (t.captainId === id) t.captainId = null;
    }
    return curr;
  });

  // Cascade: drop from bracket entrants if not yet generated
  await bracket.update(curr => {
    if (!curr.generated) {
      curr.entrantPlayerIds = (curr.entrantPlayerIds || []).filter(pid => pid !== id);
    }
    return curr;
  });

  // Cascade: clear from scoreboard at-bat if currently set
  await game.update(curr => {
    if (curr.pitcherPlayerId === id) curr.pitcherPlayerId = null;
    if (curr.batterPlayerId === id) curr.batterPlayerId = null;
    return curr;
  });

  // Cascade: drop from draft eligiblePlayerIds and picks
  await draft.update(d => {
    d.eligiblePlayerIds = (d.eligiblePlayerIds || []).filter(pid => pid !== id);
    // Strip from picks[] (not just eligible) — leave already-picked records
    // pointing at dead player stripped here for commit-time safety
    d.picks = (d.picks || []).filter(pick => pick.playerId !== id);

    // Re-run allEligiblePicked; if active and all done, auto-end
    if (d.status === 'active') {
      if (d.picks.length >= d.eligiblePlayerIds.length && d.eligiblePlayerIds.length > 0) {
        d.status = 'ended';
      }
      // Clamp currentPickIndex if needed
      const tLen = (d.teamOrder || []).length;
      if (tLen > 0 && d.currentPickIndex >= tLen) {
        d.currentPickIndex = 0;
        d.currentRound = (d.currentRound || 1) + 1;
      }
    }

    // If already committed, also strip from team rosters that were written
    if (d.status === 'committed') {
      teams.update(curr => {
        for (const t of curr) {
          t.playerIds = (t.playerIds || []).filter(pid => pid !== id);
        }
        return curr;
      });
    }

    return d;
  });

  res.json(players.get());
});

module.exports = router;
