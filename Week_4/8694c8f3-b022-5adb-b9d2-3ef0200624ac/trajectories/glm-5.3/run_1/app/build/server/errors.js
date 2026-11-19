export class ApiError extends Error {
    status;
    code;
    fields;
    extra;
    constructor(status, code, message, extra, fields) {
        super(message);
        this.status = status;
        this.code = code;
        this.extra = extra;
        this.fields = fields;
    }
}
export const errorBody = (error) => {
    const body = { code: error.code, message: error.message };
    if (error.fields !== undefined)
        body.fields = error.fields;
    if (error.extra !== undefined)
        Object.assign(body, error.extra);
    return { error: body };
};
export const canonicalJson = (value) => {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
};
export function sendError(res, error) {
    if (res.headersSent) {
        res.end();
        return;
    }
    res.writeHead(error.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(errorBody(error)));
}
// Every API error is produced through these constructors, so the shape is the same everywhere.
export const errors = {
    tooLarge: (limit) => new ApiError(413, 'too_large', `Body exceeds the ${limit} byte limit`),
    unsupportedMediaType: (received) => new ApiError(415, 'unsupported_media_type', `Content type ${received} is not supported`),
    unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue'),
    notFound: () => new ApiError(404, 'not_found', 'Not found'),
    forbidden: () => new ApiError(403, 'forbidden', 'You may not do this'),
    forbiddenOrigin: () => new ApiError(403, 'forbidden', 'Cross-origin writes are not allowed'),
    collabOffline: () => new ApiError(503, 'collab_offline', 'Live collaboration is offline. Locks can’t be taken right now.'),
    storageUnavailable: () => new ApiError(503, 'storage_unavailable', 'Asset storage is unreachable. Uploads and publishing are paused.'),
    layerLocked: (holder, expiresAt) => new ApiError(423, 'layer_locked', `${holder.display_name} holds a lock on this layer`, { holder, expires_at: expiresAt }),
    lockHeld: (holder, expiresAt) => new ApiError(409, 'lock_held', `${holder.display_name} holds this lock`, { holder, expires_at: expiresAt }),
    lockNotHeld: () => new ApiError(409, 'lock_not_held', 'You do not hold this lock'),
    staleVersion: (currentVersion, current, changedBy) => new ApiError(409, 'stale_version', `${changedBy.display_name} changed this before your edit arrived`, { current_version: currentVersion, current, changed_by: changedBy }),
    opIdReused: () => new ApiError(409, 'op_id_reused', 'This op id was already used for a different op'),
    idTaken: () => new ApiError(409, 'id_taken', 'This id is already in use'),
    inviteUsed: () => new ApiError(410, 'invite_used', 'This invite link has already been used'),
    noPreviousVersion: () => new ApiError(409, 'no_previous_version', 'No earlier published version to roll back to'),
    notPublished: () => new ApiError(409, 'not_published', 'This version is not published'),
    assetNotReady: () => new ApiError(409, 'asset_not_ready', 'This asset is not ready'),
    assetInUse: (dependents) => new ApiError(409, 'asset_in_use', 'This asset is used by layers, materials or scripts', { dependents }),
    assetInShows: (showVersions) => new ApiError(409, 'asset_in_shows', `This asset is part of published show versions ${showVersions.join(', ')}.`, { show_versions: showVersions }),
    emailTaken: () => new ApiError(409, 'email_taken', 'An account with this email already exists'),
    invalidCredentials: () => new ApiError(401, 'invalid_credentials', 'Email or password is incorrect'),
    validation: (fields) => {
        const first = Object.values(fields)[0] ?? '';
        return new ApiError(422, 'validation', first, undefined, fields);
    },
};
export const AUTH_FIELD_MESSAGES = {
    emailInvalid: 'Enter a valid email address',
    passwordShort: 'Password must be at least 10 characters',
    displayNameInvalid: 'Display name must be 1 to 40 characters',
    emailTaken: 'An account with this email already exists',
    invalidCredentials: 'Email or password is incorrect',
};
export async function readJson(req, limitBytes) {
    return await new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', (chunk) => {
            total += chunk.byteLength;
            if (total > limitBytes) {
                // Refuse the body but let the response reach the client.
                req.removeAllListeners('data');
                req.removeAllListeners('end');
                reject(errors.tooLarge(limitBytes));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch {
                reject(errors.validation({ body: 'The request body is not valid JSON' }));
            }
        });
        req.on('error', reject);
    });
}
