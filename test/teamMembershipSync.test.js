'use strict';

/**
 * Team membership can't flow through leagueSync's ownedFields engine (it's a
 * relationship on the team's playerIds[], not a field on the player), so this
 * hand-rolled reconciliation carries the same load-bearing risk: a wrong
 * answer here silently reverts a venue operator's roster move.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { OUTCOME, planMembership, applyMembership } = require('../lib/teamMembershipSync');

function setup() {
  const localPlayers = [
    { id: 'p1', hubId: 'hp1', name: 'Josh' },
    { id: 'p2', hubId: 'hp2', name: 'Macy' }
  ];
  const localTeams = [
    { id: 't1', hubId: 'ht1', name: 'Team A', playerIds: ['p1'], captainId: null },
    { id: 't2', hubId: 'ht2', name: 'Team B', playerIds: ['p2'], captainId: null }
  ];
  const snapshot = { hp1: 'ht1', hp2: 'ht2' };
  const incomingPlayers = [
    { externalId: 'hp1', teamExternalId: 'ht1' },
    { externalId: 'hp2', teamExternalId: 'ht2' }
  ];
  return { localPlayers, localTeams, snapshot, incomingPlayers };
}

test('identical membership produces no plan entries', () => {
  const { localPlayers, localTeams, snapshot, incomingPlayers } = setup();
  const plan = planMembership({ localPlayers, localTeams, incomingPlayers, snapshot });
  assert.deepEqual(plan, []);
});

test('a hub-side team reassignment applies cleanly, moving the player without disturbing others', () => {
  const { localPlayers, localTeams, snapshot, incomingPlayers } = setup();
  incomingPlayers[0].teamExternalId = 'ht2'; // hub moves Josh from Team A to Team B

  const plan = planMembership({ localPlayers, localTeams, incomingPlayers, snapshot });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].outcome, OUTCOME.UPDATED);
  assert.equal(plan[0].playerExternalId, 'hp1');

  const result = applyMembership({ teams: localTeams, plan, snapshot, accept: ['hp1'] });
  const teamA = result.teams.find(t => t.id === 't1');
  const teamB = result.teams.find(t => t.id === 't2');
  assert.deepEqual(teamA.playerIds, []);
  assert.deepEqual(teamB.playerIds, ['p2', 'p1'], 'Josh is appended, not inserted — Macy keeps her spot');
  assert.equal(result.snapshot.hp1, 'ht2');
});

test('a venue reassignment survives when the hub has not moved the player', () => {
  const { localPlayers, localTeams, snapshot, incomingPlayers } = setup();
  // Operator drags Josh onto Team B locally; hub still says Team A.
  localTeams[0].playerIds = [];
  localTeams[1].playerIds = ['p2', 'p1'];

  const plan = planMembership({ localPlayers, localTeams, incomingPlayers, snapshot });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].outcome, OUTCOME.LOCAL_ONLY);

  const result = applyMembership({ teams: localTeams, plan, snapshot, accept: ['hp1'] });
  const teamB = result.teams.find(t => t.id === 't2');
  assert.deepEqual(teamB.playerIds, ['p2', 'p1'], 'explicit accept must not revert a LOCAL_ONLY move');
  assert.deepEqual(result.applied, []);
});

test('a reassignment conflict (both sides moved) is not applied without explicit acceptance', () => {
  const { localPlayers, localTeams, snapshot, incomingPlayers } = setup();
  localTeams[0].playerIds = [];
  localTeams[1].playerIds = ['p2', 'p1']; // venue moved Josh to Team B
  incomingPlayers[0].teamExternalId = null; // hub says Josh is now unrostered (e.g. NEEDS_TEAM)

  const plan = planMembership({ localPlayers, localTeams, incomingPlayers, snapshot });
  assert.equal(plan[0].outcome, OUTCOME.LOCAL_MODIFIED);

  const withoutAccept = applyMembership({ teams: localTeams, plan, snapshot, accept: [] });
  assert.deepEqual(withoutAccept.teams.find(t => t.id === 't2').playerIds, ['p2', 'p1']);
  assert.deepEqual(withoutAccept.skipped, ['hp1']);

  const withAccept = applyMembership({ teams: localTeams, plan, snapshot, accept: ['hp1'] });
  assert.deepEqual(withAccept.teams.find(t => t.id === 't2').playerIds, ['p2']);
  assert.equal(withAccept.snapshot.hp1, null);
});

test('a skipped conflict keeps its old snapshot entry so it stays a conflict next pull', () => {
  const { localPlayers, localTeams, snapshot, incomingPlayers } = setup();
  localTeams[0].playerIds = [];
  localTeams[1].playerIds = ['p2', 'p1'];
  incomingPlayers[0].teamExternalId = null;

  const plan = planMembership({ localPlayers, localTeams, incomingPlayers, snapshot });
  const result = applyMembership({ teams: localTeams, plan, snapshot, accept: [] });
  assert.equal(result.snapshot.hp1, 'ht1', 'snapshot must not advance for a skipped row');
});

test('a first-ever pull with no snapshot treats a membership mismatch as a conflict, not a free overwrite', () => {
  const { localPlayers, localTeams, incomingPlayers } = setup();
  localTeams[0].playerIds = [];
  localTeams[1].playerIds = ['p2', 'p1']; // local state disagrees with what the hub is about to say

  const plan = planMembership({ localPlayers, localTeams, incomingPlayers, snapshot: {} });
  assert.equal(plan[0].outcome, OUTCOME.LOCAL_MODIFIED);
});

test('a player the hub never mentions (purely local) is left out of the plan entirely', () => {
  const { localPlayers, localTeams, snapshot, incomingPlayers } = setup();
  localPlayers.push({ id: 'p9', name: 'Walk-in' });
  localTeams[0].playerIds.push('p9');

  const plan = planMembership({ localPlayers, localTeams, incomingPlayers, snapshot });
  assert.deepEqual(plan, []);
});

test('moving a player to no team (null) removes them from their old roster without a destination', () => {
  const { localPlayers, localTeams, snapshot, incomingPlayers } = setup();
  incomingPlayers[0].teamExternalId = null;

  const plan = planMembership({ localPlayers, localTeams, incomingPlayers, snapshot });
  assert.equal(plan[0].outcome, OUTCOME.UPDATED);

  const result = applyMembership({ teams: localTeams, plan, snapshot, accept: ['hp1'] });
  assert.deepEqual(result.teams.find(t => t.id === 't1').playerIds, []);
  assert.equal(result.snapshot.hp1, null);
});

test('an accept id absent from the plan is a harmless no-op', () => {
  const { localPlayers, localTeams, snapshot, incomingPlayers } = setup();
  const plan = planMembership({ localPlayers, localTeams, incomingPlayers, snapshot });
  const result = applyMembership({ teams: localTeams, plan, snapshot, accept: ['not-in-plan'] });
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.teams, localTeams);
});
