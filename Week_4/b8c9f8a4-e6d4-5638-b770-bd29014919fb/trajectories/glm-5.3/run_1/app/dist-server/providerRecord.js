/** One call to the roadworthiness-record API for a stored registration. */
export async function pullRecord(cfg, registration) {
    const url = `${cfg.wiremockUrl}/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`;
    try {
        const reply = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (reply.status === 404)
            return { failure: { kind: 'not_found' } };
        if (reply.status === 429) {
            const retryHeader = reply.headers.get('retry-after');
            const seconds = /^\d+$/.test(retryHeader ?? '') ? parseInt(retryHeader, 10) : 60;
            return { failure: { kind: 'throttled', retryAfterSeconds: seconds } };
        }
        if (reply.status >= 500)
            return { failure: { kind: 'unreachable' } };
        const body = (await reply.json());
        if (!body || !Array.isArray(body.motTests))
            return { failure: { kind: 'unreachable' } };
        return { record: body };
    }
    catch {
        return { failure: { kind: 'unreachable' } };
    }
}
