import { config } from '../config.js';
import { connectDb } from '../db.js';
import { storageUp } from '../storage.js';
import { killbillUp } from '../killbill.js';
import { mailUp } from '../mail.js';
import { send } from '../respond.js';
async function check(name, fn) {
    try {
        return (await Promise.race([
            fn().then(ok => ok ? 'up' : 'down'),
            new Promise((r) => setTimeout(() => r('down'), config.readyCheckTimeoutMs))
        ]));
    }
    catch {
        return 'down';
    }
}
export async function readyz(res, requestId, draining) {
    const [postgres, minio, killbill, mailpit] = await Promise.all([
        check('postgres', async () => (await connectDb().query('select 1')).rows.length >= 0),
        check('minio', storageUp),
        check('killbill', killbillUp),
        check('mailpit', mailUp)
    ]);
    const dependencies = { postgres, minio, killbill, mailpit };
    const down = Object.entries(dependencies).filter(([, v]) => v === 'down').map(([k]) => k);
    if (down.length === 0 && !draining) {
        send(res, requestId, 200, { status: 'ready', dependencies });
    }
    else {
        const body = { status: 'not_ready', dependencies, down };
        if (draining)
            body.draining = true;
        send(res, requestId, 503, body);
    }
}
