import crypto from 'node:crypto';
/** scrypt password hashing. Seeded accounts use a fixed password; verification is the only use. */
export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 32).toString('hex');
    return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(password, stored) {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt')
        return false;
    const hash = crypto.scryptSync(password, parts[1], 32).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(parts[2], 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function randomToken(bytes = 24) {
    return crypto.randomBytes(bytes).toString('base64url');
}
export function objectKey() {
    return crypto.randomBytes(16).toString('hex');
}
export function sha256Hex(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}
