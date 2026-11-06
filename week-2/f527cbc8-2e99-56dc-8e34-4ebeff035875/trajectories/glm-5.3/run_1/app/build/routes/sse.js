import { connectDb } from '../db.js';
import { config } from '../config.js';
import { parseSessionCookie } from '../request.js';
import { Handled } from '../errors.js';
export async function serveSse(req, res, url, requestId, stream) {
    const lastEventId = Number(req.headers['last-event-id'] ?? '');
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Request-Id': requestId
    });
    res.write(`retry: 2000\n\n`);
    let lastSent = 0;
    if (Number.isFinite(lastEventId) && lastEventId > 0) {
        const rows = await connectDb().query(`select id, event, data from stream_events where stream = $1 and id > $2 order by id`, [stream, lastEventId]);
        const newest = await connectDb().query(`select coalesce(max(id),0) as m from stream_events where stream = $1`, [stream]);
        const maxId = newest.rows[0].m;
        if (rows.rows.length === 0 && (lastEventId >= maxId || maxId - lastEventId > config.sseRetentionEvents)) {
            res.write(`event: reset\ndata: {}\n\n`);
            lastSent = maxId;
        }
        else {
            for (const r of rows.rows) {
                res.write(`id: ${r.id}\nevent: ${r.event}\ndata: ${JSON.stringify(r.data)}\n\n`);
                lastSent = r.id;
            }
        }
    }
    else {
        const newest = await connectDb().query(`select coalesce(max(id),0) as m from stream_events where stream = $1`, [stream]);
        lastSent = newest.rows[0].m;
    }
    let closed = false;
    const heartbeat = setInterval(() => {
        if (closed)
            return;
        res.write(`: hb\n\n`);
    }, config.sseHeartbeatSeconds * 1000);
    const poll = setInterval(async () => {
        if (closed)
            return;
        try {
            const rows = await connectDb().query(`select id, event, data from stream_events where stream = $1 and id > $2 order by id`, [stream, lastSent]);
            for (const r of rows.rows) {
                res.write(`id: ${r.id}\nevent: ${r.event}\ndata: ${JSON.stringify(r.data)}\n\n`);
                lastSent = r.id;
            }
            const token = parseSessionCookie(req);
            if (token) {
                const alive = await connectDb().query(`select 1 from sessions where id = $1`, [token]);
                if (alive.rows.length === 0) {
                    cleanup();
                    res.end();
                }
            }
        }
        catch {
            cleanup();
            res.end();
        }
    }, 500);
    function cleanup() {
        closed = true;
        clearInterval(heartbeat);
        clearInterval(poll);
    }
    req.on('close', () => {
        cleanup();
    });
    await new Promise(() => { });
    throw new Handled(true);
}
