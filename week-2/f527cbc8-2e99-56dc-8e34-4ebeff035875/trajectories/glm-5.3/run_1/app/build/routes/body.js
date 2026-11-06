import { AppError } from '../errors.js';
export function readBody(req, limit) {
    return new Promise((resolveBody, reject) => {
        const chunks = [];
        let total = 0;
        let done = false;
        req.on('data', (c) => {
            if (done)
                return;
            total += c.length;
            if (total > limit) {
                done = true;
                req.removeAllListeners('data');
                reject(new AppError(413, 'payload_too_large'));
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => { if (!done) {
            done = true;
            resolveBody(Buffer.concat(chunks));
        } });
        req.on('error', (e) => { if (!done) {
            done = true;
            reject(e);
        } });
    });
}
