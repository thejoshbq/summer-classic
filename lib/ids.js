const crypto = require('crypto');

function uid() {
  return crypto.randomUUID();
}

module.exports = { uid };
