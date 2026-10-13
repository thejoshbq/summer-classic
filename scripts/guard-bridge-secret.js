#!/usr/bin/env node
'use strict';

// pkg's assets glob (`data/**/*.json`) bundles whatever physically exists in
// data/ at package time, regardless of .gitignore. data/bridge.json can hold
// a live hub connection key (see lib/leagueSync.js, lib/stores.js) — running
// the app in dev mode against SOURCE_DATA_DIR (the default when
// SUMMER_CLASSIC_DATA_DIR isn't set) writes it right there. Refuses to
// package rather than silently embedding it in the distributed binary.

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'data', 'bridge.json');

if (fs.existsSync(target)) {
  console.error(
    `Refusing to package: ${target} exists.\n\n` +
    'This file is local-only bridge connection state, never seed data — it can ' +
    'hold a live hub credential. Delete it before packaging, and use\n' +
    '  SUMMER_CLASSIC_DATA_DIR=/some/scratch/dir node server.js\n' +
    'for any bridge-connect testing so it never lands in data/ in the first place.'
  );
  process.exit(1);
}
