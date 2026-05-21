const express = require('express');
const path = require('path');

const router = express.Router();
router.use(express.static(path.join(__dirname, '..', 'public', 'tv')));
router.get(['/', '/main'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tv', 'main.html'));
});

module.exports = router;
