const express = require('express');
const path = require('path');

const router = express.Router();

router.use(express.static(path.join(__dirname, '..', 'public', 'admin')));

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

module.exports = router;
