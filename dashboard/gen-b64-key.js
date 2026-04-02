const fs = require('fs');
const vars = fs.readFileSync('.dev.vars', 'utf8');
const match = vars.match(/APP_PRIVATE_KEY=(.+)/);
if (!match) { console.error('APP_PRIVATE_KEY not found'); process.exit(1); }

// The key in .dev.vars has literal \n (two chars), convert to actual newlines
const pem = match[1].split('\\n').join('\n');
console.log('PEM starts with:', JSON.stringify(pem.substring(0, 30)));
console.log('Has actual newlines:', pem.includes('\n'));

const b64 = Buffer.from(pem).toString('base64');
console.log('\nAPP_PRIVATE_KEY_B64=' + b64);
