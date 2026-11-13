export function readEnvInt(env, name, fallback) {
    const raw = env[name];
    if (raw === undefined || raw === '')
        return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
}
export function readEnvStr(env, name, fallback) {
    const raw = env[name];
    return raw === undefined || raw === '' ? fallback : raw;
}
