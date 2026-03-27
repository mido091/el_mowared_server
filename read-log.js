import fs from 'fs';
const text = fs.readFileSync('debug_v7.log', 'utf16le');
const lines = text.split('\n');
console.log(lines.slice(-30).join('\n'));
