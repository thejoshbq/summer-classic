const express = require('express');
const path = require('path');

const router = express.Router();
router.use(express.static(path.join(__dirname, '..', 'public', 'standings')));
router.get(['/', '/display'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'standings', 'display.html'));
});

module.exports = router;
