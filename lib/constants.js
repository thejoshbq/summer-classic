// Shared schema constants — single source of truth for variation names/counts.
// Required by routes/players.js (server-side) and read from player responses on the client.

module.exports = {
  VARIATION_NAMES: ['Fastball', 'Switch-Up', 'Curveball'],
  THROWS_PER_VARIATION: 5
};
