const express = require('express');
const path = require('path');

const router = express.Router();
router.use(express.static(path.join(__dirname, '..', 'public', 'rotation')));
router.get(['/', '/display'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'rotation', 'display.html'));
});

module.exports = router;
