'use strict';

// Passwords are stored only as a one-way scrypt hash, at a cost of at least
// 50 milliseconds per check. An unknown email does the same work as a wrong
// password, so sign-in refusals take comparable time.

const crypto = require('crypto');

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 96 * 1024 * 1024 };

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, SCRYPT, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    await derive(password, crypto.randomBytes(16));
    return false;
  }
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  const key = await derive(password, salt);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// A hash no password matches, used to spend the same work on unknown emails.
const DECOY_HASH = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${crypto
  .randomBytes(16)
  .toString('hex')}$${crypto.randomBytes(32).toString('hex')}`;

module.exports = { hashPassword, verifyPassword, DECOY_HASH };
