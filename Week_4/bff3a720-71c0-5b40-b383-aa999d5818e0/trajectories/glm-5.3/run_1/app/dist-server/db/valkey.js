import net from 'net';
const CRLF = Buffer.from('\r\n');
/**
 * Minimal RESP client for Valkey: pipeline commands over one socket, return parsed replies.
 */
export class Valkey {
    #sock = null;
    #pending = [];
    #buf = Buffer.alloc(0);
    #closed = false;
    #reconnectTimer = null;
    #host;
    #port;
    #password;
    #username;
    constructor(url) {
        const u = new URL(url);
        this.#host = u.hostname || 'localhost';
        this.#port = Number(u.port || 6379);
        const auth = decodeURIComponent(u.password || '');
        const user = decodeURIComponent(u.username || '');
        this.#password = auth.length > 0 ? auth : null;
        this.#username = user.length > 0 ? user : null;
    }
    connect() {
        return new Promise((resolve, reject) => {
            const sock = net.createConnection({ host: this.#host, port: this.#port });
            sock.setNoDelay(true);
            sock.on('connect', () => {
                this.#sock = sock;
                this.#closed = false;
                if (this.#password) {
                    const auth = this.#username ? ['AUTH', this.#username, this.#password] : ['AUTH', this.#password];
                    this.write(auth).catch(() => undefined);
                }
                resolve();
            });
            sock.on('data', (chunk) => this.onData(chunk));
            sock.on('error', (err) => { if (!this.#sock)
                reject(err); this.teardown(err); });
            sock.on('close', () => this.teardown(new Error('valkey connection closed')));
        });
    }
    write(args) {
        return new Promise((resolve, reject) => {
            const parts = [`*${args.length}\r\n`];
            for (const a of args) {
                const s = String(a);
                parts.push(`$${Buffer.byteLength(s, 'utf8')}\r\n${s}\r\n`);
            }
            this.#pending.push({ resolve, reject });
            this.#sock?.write(parts.join(''), 'utf8');
        });
    }
    cmd(...args) {
        if (!this.#sock || this.#closed) {
            return new Promise((_, reject) => reject(new Error('valkey unavailable')));
        }
        return this.write(args);
    }
    onData(chunk) {
        this.#buf = this.#buf.length === 0 ? chunk : Buffer.concat([this.#buf, chunk]);
        let cursor = 0;
        while (true) {
            const parsed = this.tryParse(this.#buf, cursor);
            if (parsed === null)
                return;
            const [value, next] = parsed;
            const p = this.#pending.shift();
            if (p) {
                if (value instanceof Error)
                    p.reject(value);
                else
                    p.resolve(value);
            }
            cursor = next;
            if (cursor >= this.#buf.length) {
                this.#buf = Buffer.alloc(0);
                return;
            }
            this.#buf = this.#buf.subarray(cursor);
            cursor = 0;
        }
    }
    tryParse(buf, start) {
        if (start >= buf.length)
            return null;
        const type = String.fromCharCode(buf[start]);
        const lineEnd = buf.indexOf(CRLF, start);
        if (lineEnd < 0)
            return null;
        const head = buf.toString('utf8', start + 1, lineEnd).trim();
        switch (type) {
            case '+': return [head, lineEnd + 2];
            case '-': return [new Error(head), lineEnd + 2];
            case ':': return [Number(head), lineEnd + 2];
            case '$': {
                const len = Number(head);
                if (len < 0)
                    return [null, lineEnd + 2];
                const total = lineEnd + 2 + len + 2;
                if (buf.length < total)
                    return null;
                return [buf.toString('utf8', lineEnd + 2, lineEnd + 2 + len), total];
            }
            case '*': {
                const n = Number(head);
                if (n < 0)
                    return [null, lineEnd + 2];
                const items = [];
                let cursor = lineEnd + 2;
                for (let i = 0; i < n; i++) {
                    const one = this.tryParse(buf, cursor);
                    if (one === null)
                        return null;
                    items.push(one[0]);
                    cursor = one[1];
                }
                return [items, cursor];
            }
            default:
                return [new Error('valkey protocol error'), lineEnd + 2];
        }
    }
    teardown(err) {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#sock = null;
        for (const p of this.#pending.splice(0))
            p.reject(err);
        if (this.#reconnectTimer === null && this.#onDown)
            this.#onDown();
        this.#reconnectTimer = setTimeout(() => { this.#reconnectTimer = null; this.connect().catch(() => undefined); }, 1000);
    }
    #onDown = null;
    onDown(cb) { this.#onDown = cb; }
    close() {
        this.#sock?.destroy();
        this.#sock = null;
    }
}
