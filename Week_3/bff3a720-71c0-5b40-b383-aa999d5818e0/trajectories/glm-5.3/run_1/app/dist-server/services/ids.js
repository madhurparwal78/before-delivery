import crypto from 'crypto';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newId() {
    const bytes = crypto.randomBytes(20);
    let out = '';
    for (let i = 0; i < 20; i++)
        out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
}
export function newToken() {
    return crypto.randomBytes(32).toString('hex');
}
export function newCode() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}
