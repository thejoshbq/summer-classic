'use strict';

/**
 * Consumer half of the hub/consumer roster contract drift guard.
 *
 * test/fixtures/league-roster-contract.fixture.json is copied BYTE-FOR-BYTE
 * from lumberjills/src/lib/league-roster-contract.fixture.json (the hub
 * repo) — QA's fixture, deliberately pure JSON with no hub imports so it can
 * be shared verbatim. It exercises: a TEAM registration with members, a team
 * whose name already carries the hub's `Team (contactName)` fallback, an
 * INDIVIDUAL and a NEEDS_TEAM registration both with `teamExternalId: null`,
 * unicode and emoji names, and league dates both null and non-null.
 *
 * PROVENANCE / STALENESS: re-copy that file from the hub whenever the hub's
 * ROSTER_CONTRACT_VERSION changes. That re-copy is a manual step — there is
 * no cross-repo tooling for it — so a green run here only proves this
 * mapper handles the contract version the fixture was last copied from.
 * Check the hub's version before trusting this test blindly. The hub's own
 * contract test is what catches a shape change first; this test is what
 * then proves (or disproves) that summer-classic's mapper still handles the
 * new shape once someone re-copies the fixture.
 *
 * Deliberately not schema validation — this runs the real fixture through
 * the real path (routes/bridge.js's buildIncomingTeams/buildIncomingPlayers
 * join, then lib/leagueSync's planMerge/applyMerge and
 * lib/teamMembershipSync's placement) via the connect/preview/sync HTTP
 * endpoints, not the mapping functions in isolation. The hub call is
 * intercepted at the global.fetch seam used throughout test/bridge.test.js,
 * scoped to a fixed fake hub origin so this file's own calls into the local
 * Express app under test still go through the real fetch.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SUMMER_CLASSIC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'summer-classic-fixture-test-'));

const express = require('express');
const bridgeRouter = require('../routes/bridge');
const { teams, players } = require('../lib/stores');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'league-roster-contract.fixture.json'), 'utf8')
);

const HUB_ORIGIN = 'https://hub.example.com';
const originalFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.startsWith(`${HUB_ORIGIN}/`)) {
    return { status: 200, ok: true, json: async () => fixture };
  }
  return originalFetch(url, opts);
};

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/bridge', bridgeRouter);
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

test.after(() => {
  server.close();
  global.fetch = originalFetch;
});

async function api(method, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

test('the vendored hub fixture maps into sane local records via the real connect/preview/sync path', async () => {
  const connect = await api('POST', '/api/bridge/connect', {
    hubUrl: HUB_ORIGIN,
    key: `${fixture.league.id}.fixture-token`
  });
  assert.equal(connect.status, 200, JSON.stringify(connect.body));
  assert.equal(connect.body.leagueName, 'Fall Axe League');

  const preview = (await api('GET', '/api/bridge/preview')).body;

  // Against empty local stores every hub row must plan as ADDED — nothing to
  // conflict with yet. If this isn't true, planMerge or the incoming-row
  // mapping produced a bogus outcome before persistence is even involved.
  assert.deepEqual(preview.teams.updated, []);
  assert.deepEqual(preview.teams.conflicts, []);
  assert.deepEqual(preview.players.updated, []);
  assert.deepEqual(preview.players.conflicts, []);

  // 2 teams, including the one carrying the hub's own already-computed
  // "Team (contactName)" fallback name — that fallback happens hub-side;
  // this just needs to arrive and map like any other team name.
  assert.equal(preview.teams.added.length, 2);
  const fallbackTeam = preview.teams.added.find(t => t.id === 'team:clxreg000000000000000002');
  assert.equal(fallbackTeam.proposed.name, 'Team (Josh Boquiren)');

  // Contact email/phone must land on the TEAM row via the isContact +
  // teamExternalId join (buildIncomingTeams), not get lost.
  const axKickers = preview.teams.added.find(t => t.id === 'team:clxreg000000000000000001');
  assert.equal(axKickers.proposed.contactEmail, 'dale@example.com');
  assert.equal(axKickers.proposed.contactPhone, '8435550100');

  // 6 players total, none silently dropped.
  assert.equal(preview.players.added.length, 6);

  // Unicode and emoji survive the round trip intact.
  const maria = preview.players.added.find(p => p.id === 'player:clxmem00000000000000001');
  assert.equal(maria.proposed.name, 'María José Núñez');
  const erin = preview.players.added.find(p => p.id === 'player:clxreg000000000000000003:contact');
  assert.equal(erin.proposed.name, '🪓 Erin Kōno');

  // Apply it and check the actually-persisted local records, not just the plan.
  const accept = [...preview.teams.added, ...preview.players.added].map(r => r.id);
  const sync = (await api('POST', '/api/bridge/sync', { accept })).body;
  assert.equal(sync.status, 'SUCCESS');
  assert.equal(teams.get().length, 2);
  assert.equal(players.get().length, 6);

  assert.equal(
    players.get().find(p => p.hubId === 'clxmem00000000000000001').name,
    'María José Núñez'
  );
  assert.equal(
    teams.get().find(t => t.hubId === 'clxreg000000000000000001').contactEmail,
    'dale@example.com'
  );

  // The two teamless registrants (INDIVIDUAL / NEEDS_TEAM, teamExternalId
  // null in the fixture) must not be silently attached to any team's roster.
  const erinLocal = players.get().find(p => p.hubId === 'clxreg000000000000000003:contact');
  const patLocal = players.get().find(p => p.hubId === 'clxreg000000000000000004:contact');
  const allPlayerIds = teams.get().flatMap(t => t.playerIds || []);
  assert.ok(!allPlayerIds.includes(erinLocal.id), 'Erin has no team in the fixture and must not be on one');
  assert.ok(!allPlayerIds.includes(patLocal.id), 'Pat has no team in the fixture and must not be on one');

  // Nothing in the roster payload should ever set captainId — it's local-only.
  assert.ok(teams.get().every(t => t.captainId === null));
});
