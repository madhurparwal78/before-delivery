// Password hashing with the Node built-in scrypt.
import crypto from 'node:crypto';
export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 32).toString('hex');
    return `scrypt:${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
    const parts = stored.split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt')
        return false;
    const hash = crypto.scryptSync(password, parts[1], 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(parts[2], 'hex'));
}
