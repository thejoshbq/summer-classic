// Shared schema constants — single source of truth for variation names/counts.
// Required by routes/players.js (server-side) and read from player responses on the client.

const VARIATION_NAMES = ['Fastball', 'Switch-Up', 'Curveball'];
const THROWS_PER_VARIATION = 5;

// Scout score is derived, not entered — the cumulative total of every
// recorded throw across all variations. Untouched (all-default-zero) players
// stay `null` so they remain exempt from Murderball bye assignment in
// routes/bracketApi.js (which treats null as "unscored", not "scored zero").
function computeScoutScore(variations) {
  const sum = variations.reduce((s, v) => s + v.throws.reduce((a, b) => a + b, 0), 0);
  return sum === 0 ? null : sum;
}

module.exports = { VARIATION_NAMES, THROWS_PER_VARIATION, computeScoutScore };
