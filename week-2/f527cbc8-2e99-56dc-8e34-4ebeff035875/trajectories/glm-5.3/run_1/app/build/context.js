export function isFarrier(c) {
    return !!c && (c.type === 'token' ? c.scope !== undefined : c.role === 'farrier');
}
export function isStaff(c) {
    return !!c && c.type === 'session' && (c.role === 'farrier' || c.role === 'apprentice');
}
