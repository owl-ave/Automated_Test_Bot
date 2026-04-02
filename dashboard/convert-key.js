const crypto = require('crypto');
const fs = require('fs');

const pem = fs.readFileSync('./key.pem', 'utf8');
const key = crypto.createPrivateKey(pem);
const pkcs8 = key.export({ type: 'pkcs8', format: 'pem' });

// Single line with \n for .dev.vars
const singleLine = pkcs8.replace(/\n/g, '\\n');
console.log('APP_PRIVATE_KEY=' + singleLine);
