/**
 * Free Fire Max — 4-character username candidate generator
 * ------------------------------------------------------------
 * IMPORTANT: Garena doesn't expose a public API to check whether a
 * nickname is already taken, so this script can only GENERATE
 * candidates — it can't verify availability for you. The only real
 * "check" is Free Fire's own rename screen: type a name in and it
 * tells you instantly, for free, before you spend diamonds or a
 * rename card.
 *
 * Also worth knowing: there are only 26^4 = 456,976 possible 4-letter
 * (a-z only) combinations, and Free Fire has hundreds of millions of
 * accounts — pure-letter 4-character names are almost certainly all
 * claimed by now. That's why CHARSET below defaults to letters+digits
 * (36^4 = 1,679,616 combinations), which gives you much better odds.
 *
 * Usage:
 *   node freefire-username-candidates.js
 */

const fs = require('fs');

// ---- Settings — tweak these ----
const LENGTH = 4;
const CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789'; // change to 'abcdefghijklmnopqrstuvwxyz' for letters only
const SAMPLE_SIZE = 2000; // how many candidates to output; set to null for the full list
const OUTPUT_FILE = 'freefire-username-candidates.txt';

function toDigits(n, base, length) {
  const digits = [];
  for (let i = 0; i < length; i++) {
    digits.unshift(n % base);
    n = Math.floor(n / base);
  }
  return digits;
}

function generateAll(length, charset) {
  const base = charset.length;
  const total = base ** length;
  const out = new Array(total);
  for (let n = 0; n < total; n++) {
    out[n] = toDigits(n, base, length).map((d) => charset[d]).join('');
  }
  return out;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Drop the most obviously-already-taken patterns, e.g. "aaaa", "1111".
function isLowValue(s) {
  return new Set(s).size === 1;
}

let candidates = generateAll(LENGTH, CHARSET).filter((s) => !isLowValue(s));
shuffle(candidates);
if (SAMPLE_SIZE) candidates = candidates.slice(0, SAMPLE_SIZE);

fs.writeFileSync(OUTPUT_FILE, candidates.join('\n') + '\n');

console.log(`Wrote ${candidates.length} candidates to ${OUTPUT_FILE}`);
console.log(`Total possible combinations with this charset/length: ${CHARSET.length ** LENGTH}`);
console.log(`Remember: test each one in the Free Fire rename screen — there's no way to check availability automatically.`);
