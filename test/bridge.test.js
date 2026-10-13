'use strict';

/**
 * Route-level regression coverage for routes/bridge.js. These tests are
 * intentionally sequential within each `test()` block — they exercise real
 * consecutive pulls against one running app and one on-disk data dir,
 * because the bug class this guards against (a wrong snapshot carried
 * forward between pulls) only shows up across multiple syncs, not within a
 * single one.
 *
 * SUMMER_CLASSIC_DATA_DIR must be set before lib/store.js is first required
 * (it resolves DATA_DIR at module load), so it's set at the top of the file,
 * before express/routes are required.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SUMMER_CLASSIC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'summer-classic-bridge-test-'));

const express = require('express');
const bridgeRouter = require('../routes/bridge');

function fixtureRoster(overrides = {}) {
  return {
    contract: 'league-roster.v1',
    exportedAt: '2026-09-10T00:00:00.000Z',
    league: {
      id: 'league1',
      name: 'Fall Axe League',
      slug: 'fall-axe',
      season: 'Fall 2026',
      status: 'ACTIVE',
      startDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
      recurrenceRule: 'WEEKLY'
    },
    teams: [{ externalId: 'reg1', name: 'Blades of Glory' }],
    players: [
      {
        externalId: 'reg1:contact',
        fullName: 'Alice Contact',
        shirtFit: 'WOMENS',
        shirtSize: 'M',
        position: 0,
        teamExternalId: 'reg1',
        isContact: true,
        email: 'alice@example.com',
        phone: '555-1234'
      },
      {
        externalId: 'mem1',
        fullName: 'Bob Teammate',
        shirtFit: 'MENS',
        shirtSize: 'L',
        position: 1,
        teamExternalId: 'reg1',
        isContact: false
      }
    ],
    truncated: false,
    totalCount: 2,
    ...overrides
  };
}

let mockRoster = fixtureRoster();
const originalFetch = global.fetch;
// Only intercept the app's own outbound calls to the fake hub. Everything
// else (in particular the test helper's calls to the local Express server
// under test) must go through the real fetch, or the test would just be
// asking its own mock what it thinks happened.
global.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.startsWith('https://hub.example.com/')) {
    const auth = opts?.headers?.Authorization;
    if (auth !== 'Bearer goodtoken') {
      return { status: 401, ok: false, json: async () => ({ error: 'Invalid or unauthorized key' }) };
    }
    return { status: 200, ok: true, json: async () => mockRoster };
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

test('rejects a bad connection key without storing anything', async () => {
  const res = await api('POST', '/api/bridge/connect', { hubUrl: 'https://hub.example.com', key: 'league1.wrongtoken' });
  assert.equal(res.status, 401);

  const status = await api('GET', '/api/bridge/status');
  assert.equal(status.body.connected, false);
});

test('connect, sync, and place newly-added players on their hub-declared team', async () => {
  const connect = await api('POST', '/api/bridge/connect', { hubUrl: 'https://hub.example.com', key: 'league1.goodtoken' });
  assert.equal(connect.status, 200);
  assert.equal(connect.body.connected, true);
  assert.equal(connect.body.leagueName, 'Fall Axe League');

  const preview = await api('GET', '/api/bridge/preview');
  assert.equal(preview.body.teams.added.length, 1);
  assert.equal(preview.body.players.added.length, 2);

  const sync = await api('POST', '/api/bridge/sync', { accept: [] });
  assert.equal(sync.body.status, 'SUCCESS');
  assert.equal(sync.body.accepted, 3);

  // Re-pulling immediately must be a no-op — proves both the merge itself
  // and the ADD-time team placement are idempotent.
  const secondPreview = await api('GET', '/api/bridge/preview');
  assert.deepEqual(secondPreview.body.teams, { added: [], updated: [], conflicts: [], departed: [] });
  assert.deepEqual(secondPreview.body.players, { added: [], updated: [], conflicts: [], departed: [] });
  assert.deepEqual(secondPreview.body.membership, { updated: [], conflicts: [] });
});

test('a hub-side reassignment of an already-synced player is a clean update, not a false conflict', async () => {
  // Regression case: on the very first pull, a new player is placed on their
  // team directly (there's nothing to reconcile yet), bypassing
  // planMembership/applyMembership entirely. If that placement doesn't also
  // seed the membership snapshot, this pull has no baseline for the player
  // and misreads their current team as an unexplained local value —
  // reporting a genuine hub-side move as a local/hub conflict instead of an
  // auto-applied update.
  mockRoster = fixtureRoster({
    teams: [{ externalId: 'reg1', name: 'Blades of Glory' }, { externalId: 'reg2', name: 'Second Team' }],
    players: [
      fixtureRoster().players[0],
      {
        externalId: 'mem1',
        fullName: 'Bob Teammate',
        shirtFit: 'MENS',
        shirtSize: 'L',
        position: 1,
        teamExternalId: 'reg2',
        isContact: false
      }
    ]
  });

  const preview = await api('GET', '/api/bridge/preview');
  assert.deepEqual(preview.body.membership.conflicts, [], 'must not misreport the ADD-time placement as a local edit');
  assert.equal(preview.body.membership.updated.length, 1);
  assert.equal(preview.body.membership.updated[0].toTeamName, 'Second Team');

  const sync = await api('POST', '/api/bridge/sync', { accept: [] });
  assert.equal(sync.body.status, 'SUCCESS', 'an UPDATED membership move auto-applies, no accept needed');
});

test('a genuine local-vs-hub name conflict is skipped by default and applied on explicit accept', async () => {
  const players = await api('GET', '/api/bridge/status');
  assert.equal(players.body.connected, true);

  // Manually diverge local state the way a venue operator would (directly
  // via the store, since there's no players PUT wired into this test app).
  const { players: playersStore } = require('../lib/stores');
  await playersStore.update(curr => {
    const bob = curr.find(p => p.hubId === 'mem1');
    bob.name = 'Bob Local Edit';
    return curr;
  });

  mockRoster = fixtureRoster({
    teams: [{ externalId: 'reg1', name: 'Blades of Glory' }, { externalId: 'reg2', name: 'Second Team' }],
    players: [
      fixtureRoster().players[0],
      {
        externalId: 'mem1',
        fullName: 'Bob Hub Rename',
        shirtFit: 'MENS',
        shirtSize: 'L',
        position: 1,
        teamExternalId: 'reg2',
        isContact: false
      }
    ]
  });

  const preview = await api('GET', '/api/bridge/preview');
  assert.equal(preview.body.players.conflicts.length, 1);
  const conflictId = preview.body.players.conflicts[0].id;

  const skipped = await api('POST', '/api/bridge/sync', { accept: [] });
  assert.equal(skipped.body.status, 'PARTIAL');
  const afterSkip = playersStore.get().find(p => p.hubId === 'mem1');
  assert.equal(afterSkip.name, 'Bob Local Edit', 'a skipped conflict must not be silently overwritten');

  const accepted = await api('POST', '/api/bridge/sync', { accept: [conflictId] });
  assert.equal(accepted.body.status, 'SUCCESS');
  const afterAccept = playersStore.get().find(p => p.hubId === 'mem1');
  assert.equal(afterAccept.name, 'Bob Hub Rename');
});

test('disconnect clears the stored credential and connection state', async () => {
  const res = await api('POST', '/api/bridge/disconnect');
  assert.equal(res.body.connected, false);
  assert.equal(res.body.hubUrl, null);
});
