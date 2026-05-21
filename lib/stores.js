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
  pitchingIndex: 0
});

const game = makeStore('game', {
  status: 'setup',
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
  balls: 0,
  inningsPlayed: 0,
  visitorLineup: emptyLineup(),
  homeLineup: emptyLineup()
});

const displayMode = makeStore('displayMode', { mode: 'standings' });

module.exports = { players, teams, standings, bracket, game, displayMode };
