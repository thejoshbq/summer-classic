const express = require('express');
const path = require('path');

const router = express.Router();
router.use(express.static(path.join(__dirname, '..', 'public', 'draft')));
router.get(['/', '/display'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'draft', 'display.html'));
});

module.exports = router;
