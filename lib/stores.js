const { makeStore } = require('./store');

const players = makeStore('players', []);

const teams = makeStore('teams', []);

const standings = makeStore('standings', { day: 1, records: {} });

const bracket = makeStore('bracket', {
  mode: 'murderball',
  settings: { laneCount: 4 },
  entrantPlayerIds: [],
  generated: false,
  currentRound: 0,
  rounds: [],
  championPlayerId: null,
  byeHistory: [],
  history: []
});

const emptyLineup = () => ({
  battingOrder: [],
  pitchingRotation: [],
  battingCurrent: null,
  battingQueue: [],
  battingStarted: false,
  pitchingCurrent: null,
  pitchingQueue: [],
  pitchingStarted: false
});

const game = makeStore('game', {
  status: 'setup',
  gameType: 'standard',
  visitorTeamId: null,
  homeTeamId: null,
  visitorInnings: Array(9).fill(null),
  homeInnings: Array(9).fill(null),
  currentInning: 1,
  currentHalf: 'top',
  pitcherPlayerId: null,
  batterPlayerId: null,
  pitcherFallback: '',
  batterFallback: '',
  bases: { first: false, second: false, third: false },
  outs: 0,
  strikes: 0,
  balls: 0,
  inningsPlayed: 0,
  visitorLineup: emptyLineup(),
  homeLineup: emptyLineup(),
  history: []
});

const draft = makeStore('draft', {
  status: 'setup',
  teamOrder: [],
  eligiblePlayerIds: [],
  picks: [],
  currentRound: 1,
  currentPickIndex: 0,
  history: [],
  preCommitTeamsSnapshot: null,
  committedAt: null
});

// Server-side only — `connectionKey` never reaches the browser after the
// connect POST (see routes/bridge.js's publicBridgeState). `snapshot` holds
// the three-way-merge state from the last applied sync: hub-owned fields as
// last written, keyed by externalId, per entity (teams/players), plus
// membership (see lib/teamMembershipSync.js).
const bridge = makeStore('bridge', {
  hubUrl: null,
  connectionKey: null,
  leagueId: null,
  leagueName: null,
  season: null,
  lastSyncAt: null,
  lastSyncStatus: null, // 'SUCCESS' | 'PARTIAL' | 'ERROR'
  lastSyncError: null,
  lastSyncErrorCode: null, // 'UNAUTHORIZED' | 'LEAGUE_UNAVAILABLE' | 'RATE_LIMITED' | 'HUB_ERROR' | 'NETWORK'
  lastSyncAccepted: null,
  lastSyncSkipped: null,
  snapshot: { teams: {}, players: {}, membership: {} }
});

module.exports = { players, teams, standings, bracket, game, draft, bridge, emptyLineup };
