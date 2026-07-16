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
  history: []
});

const emptyLineup = () => ({
  battingOrder: [],
  pitchingRotation: [],
  battingIndex: 0,
  pitchingIndex: 0,
  battingAuto: false,
  pitchingAuto: false
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

module.exports = { players, teams, standings, bracket, game, draft, emptyLineup };
