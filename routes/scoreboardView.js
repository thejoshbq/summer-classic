const express = require('express');

const router = express.Router();
// The scoreboard and rotation displays were consolidated into one page —
// this route just preserves any existing bookmark/OBS browser source.
router.get(['/', '/display'], (req, res) => res.redirect('/rotation/display'));

module.exports = router;
