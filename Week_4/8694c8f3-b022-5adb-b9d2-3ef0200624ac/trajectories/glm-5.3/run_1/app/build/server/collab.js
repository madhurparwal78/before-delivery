import { Socket } from 'node:net';
export class ValkeyError extends Error {
}
// One connection for commands, one for subscriptions. Every method throws when
// Valkey is unreachable; callers translate that into collab_offline.
export class ValkeyConnection {
    url;
    socket = null;
    connecting = null;
    buffer = Buffer.alloc(0);
    pending = [];
    reachable = false;
    constructor(url) {
        this.url = url;
    }
    async connect() {
        if (this.socket !== null && !this.socket.destroyed)
            return this.socket;
        if (this.connecting === null) {
            this.connecting = new Promise((resolve, reject) => {
                const url = new URL(this.url);
                const socket = new Socket({});
                const fail = (error) => {
                    this.socket = null;
                    this.connecting = null;
                    this.reachable = false;
                    socket.destroy();
                    reject(error);
                };
                socket.once('error', fail);
                socket.connect(Number(url.port ?? 6379), url.hostname, () => {
                    socket.off('error', fail);
                    socket.on('error', () => {
                        this.socket = null;
                        this.connecting = null;
                        this.reachable = false;
                        for (const p of this.pending)
                            p.reject(new Error('Valkey connection closed'));
                        this.pending = [];
                    });
                    socket.on('close', () => {
                        this.socket = null;
                        this.connecting = null;
                        this.reachable = false;
                    });
                    socket.on('data', (chunk) => { this.consume(chunk); });
                    this.socket = socket;
                    resolve(socket);
                });
            });
        }
        return await this.connecting;
    }
    consume(chunk) {
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
        while (true) {
            const [reply, consumed] = parseReply(this.buffer);
            if (reply === undefined)
                return;
            this.buffer = this.buffer.subarray(consumed);
            const waiter = this.pending.shift();
            if (waiter !== undefined)
                waiter.resolve(reply);
        }
    }
    async send(args) {
        const socket = await this.connect();
        const parts = [`*${args.length}\r\n`];
        for (const arg of args) {
            const text = String(arg);
            parts.push(`$${Buffer.byteLength(text)}\r\n${text}\r\n`);
        }
        return await new Promise((resolve, reject) => {
            this.pending.push({ resolve, reject });
            socket.write(parts.join(''));
        });
    }
}
function parseReply(buffer) {
    if (buffer.length === 0)
        return [undefined, 0];
    const crlf = buffer.indexOf('\r\n');
    if (crlf === -1)
        return [undefined, 0];
    const head = buffer.subarray(0, crlf).toString('latin1');
    const kind = head[0];
    const body = head.slice(1);
    if (kind === '+')
        return [body, crlf + 2];
    if (kind === '-')
        return [new ValkeyError(body), crlf + 2];
    if (kind === ':')
        return [Number(body), crlf + 2];
    if (kind === '$') {
        const length = Number(body);
        if (length === -1)
            return [null, crlf + 2];
        const start = crlf + 2;
        const end = start + length;
        if (buffer.length < end + 2)
            return [undefined, 0];
        return [buffer.subarray(start, end).toString('utf8'), end + 2];
    }
    if (kind === '*') {
        const count = Number(body);
        if (count === -1)
            return [null, crlf + 2];
        const items = [];
        let offset = crlf + 2;
        for (let i = 0; i < count; i++) {
            const [item, consumed] = parseReply(buffer.subarray(offset));
            if (item === undefined)
                return [undefined, 0];
            if (item instanceof ValkeyError)
                return [item, offset + consumed];
            items.push(item);
            offset += consumed;
        }
        return [items, offset];
    }
    return [new ValkeyError(`Unknown reply kind ${kind}`), crlf + 2];
}
export class Collab {
    url;
    commandConnection = null;
    subscriberConnection = null;
    reachable = false;
    lastProbe = 0;
    constructor(url) {
        this.url = url;
    }
    commands() {
        if (this.commandConnection === null) {
            this.commandConnection = new ValkeyConnection(this.url);
        }
        return this.commandConnection;
    }
    async authenticate(connection) {
        const url = new URL(this.url);
        if (url.username !== '' || url.password !== '') {
            await connection.send(['AUTH', decodeURIComponent(url.username || 'default'), decodeURIComponent(url.password)]);
        }
        if ((url.pathname.replace(/^\//, '') !== '') && url.pathname !== '/0') {
            const db = url.pathname.replace(/^\//, '');
            if (db !== '')
                await connection.send(['SELECT', db]);
        }
    }
    async call(args) {
        const connection = this.commands();
        await this.authenticate(connection);
        const reply = await connection.send(args);
        if (reply instanceof ValkeyError)
            throw reply;
        return reply;
    }
    async setLock(setId, layerId, userId) {
        const reply = await this.call(['SET', lockKey(setId, layerId), userId, 'NX', 'PX', 30_000]);
        return reply === 'OK';
    }
    async getLock(setId, layerId) {
        const value = await this.call(['GET', lockKey(setId, layerId)]);
        if (typeof value !== 'string' || value === '')
            return null;
        const pttl = await this.call(['PTTL', lockKey(setId, layerId)]);
        return { holder: value, pttl: Number(pttl) };
    }
    async renewLock(setId, layerId, userId) {
        const script = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end';
        const reply = await this.call(['EVAL', script, '1', lockKey(setId, layerId), userId, 30_000]);
        return Number(reply) === 1;
    }
    async releaseLock(setId, layerId, userId) {
        const script = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
        const reply = await this.call(['EVAL', script, '1', lockKey(setId, layerId), userId]);
        return Number(reply) === 1;
    }
    async removeLock(setId, layerId) {
        await this.call(['DEL', lockKey(setId, layerId)]);
    }
    async postPresence(setId, userId, value) {
        const script = 'redis.call("set", KEYS[1], ARGV[1], "PX", ARGV[2])';
        await this.call(['EVAL', script, '1', presenceKey(setId, userId), value, 30_000]);
    }
    async presenceKeys(setId) {
        const reply = await this.call(['KEYS', `afterglass:presence:${setId}:*`]);
        if (!Array.isArray(reply))
            return [];
        return reply.filter((entry) => typeof entry === 'string');
    }
    async presenceGet(key) {
        const reply = await this.call(['GET', key]);
        return typeof reply === 'string' ? reply : null;
    }
    async publish(channel, message) {
        await this.call(['PUBLISH', channel, message]);
    }
    async subscribe(channel, listener) {
        if (this.subscriberConnection === null) {
            this.subscriberConnection = new SubscriberConnection(this.url);
            await this.subscriberConnection.ready();
        }
        return this.subscriberConnection.subscribe(channel, listener);
    }
    async probe() {
        // Recheck at most every five seconds.
        if (Date.now() - this.lastProbe < 5_000 && this.commandConnection !== null)
            return this.reachable;
        this.lastProbe = Date.now();
        try {
            const reply = await this.call(['PING']);
            this.reachable = reply === 'PONG';
        }
        catch {
            this.reachable = false;
        }
        return this.reachable;
    }
    isReachable() {
        return this.reachable;
    }
    async flush() {
        if (this.commandConnection !== null)
            await this.commandConnection.send(['QUIT']).catch(() => { });
        if (this.subscriberConnection !== null)
            await this.subscriberConnection.close();
    }
}
class SubscriberConnection {
    url;
    socket = null;
    buffer = Buffer.alloc(0);
    listeners = new Map();
    readyPromise = null;
    constructor(url) {
        this.url = url;
    }
    async ready() {
        if (this.readyPromise !== null)
            return await this.readyPromise;
        this.readyPromise = new Promise((resolve, reject) => {
            const url = new URL(this.url);
            const socket = new Socket({});
            socket.once('error', (error) => { reject(error); this.readyPromise = null; });
            socket.connect(Number(url.port ?? 6379), url.hostname, () => {
                socket.on('error', () => { this.socket = null; this.readyPromise = null; });
                socket.on('close', () => { this.socket = null; this.readyPromise = null; });
                socket.on('data', (chunk) => { this.consume(chunk); });
                this.socket = socket;
                resolve();
            });
        });
        await this.readyPromise;
        await this.authenticate();
    }
    async authenticate() {
        const url = new URL(this.url);
        const args = [];
        if (url.username !== '' || url.password !== '') {
            args.push('AUTH', decodeURIComponent(url.username || 'default'), decodeURIComponent(url.password));
        }
        else {
            args.push('PING');
        }
        this.write([args]);
    }
    write(commands) {
        if (this.socket === null)
            throw new Error('Subscriber connection closed');
        const parts = [];
        for (const args of commands) {
            parts.push(`*${args.length}\r\n`);
            for (const arg of args) {
                parts.push(`$${Buffer.byteLength(arg)}\r\n${arg}\r\n`);
            }
        }
        this.socket.write(parts.join(''));
    }
    consume(chunk) {
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
        while (true) {
            const [reply, consumed] = parseReply(this.buffer);
            if (reply === undefined)
                return;
            this.buffer = this.buffer.subarray(consumed);
            if (reply instanceof Error)
                continue;
            if (Array.isArray(reply) && reply.length === 3 && reply[0] === 'message') {
                const channel = reply[1];
                const message = reply[2];
                if (typeof channel === 'string' && typeof message === 'string') {
                    for (const listener of this.listeners.get(channel) ?? [])
                        listener(message);
                }
            }
        }
    }
    async subscribe(channel, listener) {
        let set = this.listeners.get(channel);
        if (set === undefined) {
            set = new Set();
            this.listeners.set(channel, set);
            this.write([['SUBSCRIBE', channel]]);
        }
        set.add(listener);
        return () => {
            set.delete(listener);
        };
    }
    async close() {
        this.socket?.destroy();
        this.socket = null;
    }
}
export const lockKey = (setId, layerId) => `afterglass:lock:${setId}:${layerId}`;
export const presenceKey = (setId, userId) => `afterglass:presence:${setId}:${userId}`;
export const setChannel = (setId) => `afterglass:set:${setId}`;
export const PRESENCE_COLOURS = ['blue', 'green', 'yellow', 'violet', 'orange', 'red'];
export const colourForJoinOrder = (order) => PRESENCE_COLOURS[order % PRESENCE_COLOURS.length];
