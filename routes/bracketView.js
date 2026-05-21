const express = require('express');
const path = require('path');

const router = express.Router();
router.use(express.static(path.join(__dirname, '..', 'public', 'bracket')));
router.get(['/', '/display'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'bracket', 'display.html'));
});

module.exports = router;
