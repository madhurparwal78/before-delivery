// A small PostgreSQL client and pool over the v3 wire protocol: SCRAM-SHA-256, md5 or cleartext
// authentication, the extended query protocol with text parameters, and text-format results.
import crypto from 'node:crypto';
import net from 'node:net';

export class PgError extends Error {
  constructor(fields) {
    super(fields.M || 'PostgreSQL error');
    this.code = fields.C;
    this.detail = fields.D;
  }
}

// The connection to the server failed or was lost.
export class ConnectionError extends Error {
  constructor(message) {
    super(message);
    this.code = 'CONNECTION_LOST';
  }
}

function parseUrl(url) {
  const u = new URL(url);
  const user = decodeURIComponent(u.username);
  return {
    host: u.hostname || '127.0.0.1', port: Number(u.port || 5432), user,
    password: decodeURIComponent(u.password), database: decodeURIComponent(u.pathname.slice(1)) || user,
  };
}

// ---------------------------------------------------------------- message encoding
const cstr = (s) => Buffer.from(`${s}\0`, 'utf8');
const int16 = (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };

function frame(type, parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from(type, 'ascii'), int32(body.length + 4), body]);
}

function encodeParam(value) {
  if (value === null || value === undefined) return int32(-1);
  let text;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'boolean') text = value ? 't' : 'f';
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([int32(bytes.length), bytes]);
}

// ---------------------------------------------------------------- result decoding
function parseTimestamp(text) {
  const iso = text.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  return new Date(iso);
}

const DECODERS = {
  16: (t) => t === 't',
  20: Number, 21: Number, 23: Number, 26: Number, 700: Number, 701: Number,
  114: JSON.parse, 3802: JSON.parse,
  1114: parseTimestamp, 1184: parseTimestamp,
};

function readFields(buf) {
  const fields = {};
  let i = 0;
  while (buf[i] !== 0) {
    const key = String.fromCharCode(buf[i]);
    const end = buf.indexOf(0, i + 1);
    fields[key] = buf.toString('utf8', i + 1, end);
    i = end + 1;
  }
  return fields;
}

// ---------------------------------------------------------------- one connection
class Connection {
  constructor(config) {
    this.config = config;
    this.buffer = Buffer.alloc(0);
    this.queue = [];
    this.alive = false;
  }

  open(timeoutMs) {
    return new Promise((resolve, reject) => {
      const { host, port, user, database } = this.config;
      const socket = net.connect({ host, port });
      this.socket = socket;
      const timer = setTimeout(() => this.fail(new ConnectionError('Timed out connecting to PostgreSQL')), timeoutMs);
      this.startup = {
        resolve: () => { clearTimeout(timer); this.alive = true; resolve(this); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };
      socket.setNoDelay(true);
      socket.on('connect', () => {
        const params = Buffer.concat([cstr('user'), cstr(user), cstr('database'), cstr(database),
          cstr('client_encoding'), cstr('UTF8'), cstr('TimeZone'), cstr('UTC'), Buffer.from([0])]);
        socket.write(Buffer.concat([int32(params.length + 8), int32(196608), params]));
      });
      socket.on('data', (chunk) => this.receive(chunk));
      socket.on('error', (err) => this.fail(new ConnectionError(err.message)));
      socket.on('close', () => this.fail(new ConnectionError('The PostgreSQL connection closed')));
    });
  }

  fail(err) {
    const wasAlive = this.alive;
    this.alive = false;
    if (this.startup) {
      const { reject } = this.startup;
      this.startup = null;
      reject(err);
    }
    for (const op of this.queue.splice(0)) op.reject(err);
    if (this.socket && !this.socket.destroyed) this.socket.destroy();
    if (wasAlive && this.onClose) this.onClose();
  }

  receive(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < length + 1) return;
      const type = String.fromCharCode(this.buffer[0]);
      const body = this.buffer.subarray(5, length + 1);
      this.buffer = this.buffer.subarray(length + 1);
      try {
        this.handle(type, body);
      } catch (err) {
        this.fail(err instanceof ConnectionError ? err : new ConnectionError(err.message));
        return;
      }
    }
  }

  handle(type, body) {
    if (this.startup) return this.handleStartup(type, body);
    const op = this.queue[0];
    if (!op) return undefined;
    switch (type) {
      case 'T': {
        const count = body.readInt16BE(0);
        let i = 2;
        op.fields = [];
        for (let k = 0; k < count; k += 1) {
          const end = body.indexOf(0, i);
          const name = body.toString('utf8', i, end);
          const typeOid = body.readInt32BE(end + 7);
          op.fields.push({ name, decode: DECODERS[typeOid] || ((t) => t) });
          i = end + 19;
        }
        op.rows = [];
        break;
      }
      case 'D': {
        const count = body.readInt16BE(0);
        const row = {};
        let i = 2;
        for (let k = 0; k < count; k += 1) {
          const len = body.readInt32BE(i);
          i += 4;
          const field = op.fields[k];
          if (len < 0) {
            row[field.name] = null;
          } else {
            row[field.name] = field.decode(body.toString('utf8', i, i + len));
            i += len;
          }
        }
        op.rows.push(row);
        break;
      }
      case 'C': {
        const tag = body.toString('utf8', 0, body.length - 1);
        const n = Number(tag.split(' ').pop());
        op.result = { rows: op.rows || [], rowCount: Number.isNaN(n) ? 0 : n };
        break;
      }
      case 'E':
        op.error = new PgError(readFields(body));
        break;
      case 'Z':
        this.queue.shift();
        if (op.error) op.reject(op.error);
        else op.resolve(op.result || { rows: op.rows || [], rowCount: 0 });
        break;
      default:
        break;
    }
    return undefined;
  }

  handleStartup(type, body) {
    const { user, password } = this.config;
    if (type === 'E') throw new PgError(readFields(body));
    if (type === 'R') {
      const code = body.readInt32BE(0);
      if (code === 3) this.socket.write(frame('p', [cstr(password)]));
      if (code === 5) {
        const inner = crypto.createHash('md5').update(password + user).digest('hex');
        const outer = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), body.subarray(4, 8)])).digest('hex');
        this.socket.write(frame('p', [cstr(`md5${outer}`)]));
      }
      if (code === 10) {
        this.nonce = crypto.randomBytes(18).toString('base64');
        this.clientFirstBare = `n=,r=${this.nonce}`;
        const first = Buffer.from(`n,,${this.clientFirstBare}`);
        this.socket.write(frame('p', [cstr('SCRAM-SHA-256'), int32(first.length), first]));
      }
      if (code === 11) this.scramContinue(body.toString('utf8', 4));
      if (code === 12) {
        const verifier = body.toString('utf8', 4).replace(/^v=/, '');
        if (verifier !== this.serverSignature) throw new ConnectionError('The PostgreSQL server signature did not verify');
      }
      return;
    }
    if (type === 'Z') {
      const { resolve } = this.startup;
      this.startup = null;
      resolve();
    }
  }

  scramContinue(serverFirst) {
    const attrs = Object.fromEntries(serverFirst.split(',').map((p) => [p[0], p.slice(2)]));
    if (!attrs.r || !attrs.r.startsWith(this.nonce)) throw new ConnectionError('The PostgreSQL SCRAM nonce did not match');
    const salted = crypto.pbkdf2Sync(this.config.password.normalize('NFKC'), Buffer.from(attrs.s, 'base64'),
      Number(attrs.i), 32, 'sha256');
    const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest();
    const clientKey = hmac(salted, 'Client Key');
    const storedKey = crypto.createHash('sha256').update(clientKey).digest();
    const finalBare = `c=biws,r=${attrs.r}`;
    const authMessage = `${this.clientFirstBare},${serverFirst},${finalBare}`;
    const signature = hmac(storedKey, authMessage);
    const proof = Buffer.from(clientKey.map((b, i) => b ^ signature[i]));
    this.serverSignature = hmac(hmac(salted, 'Server Key'), authMessage).toString('base64');
    this.socket.write(frame('p', [Buffer.from(`${finalBare},p=${proof.toString('base64')}`)]));
  }

  query(text, params = []) {
    if (!this.alive) return Promise.reject(new ConnectionError('The PostgreSQL connection is closed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      if (params.length === 0) {
        this.socket.write(frame('Q', [cstr(text)]));
        return;
      }
      this.socket.write(Buffer.concat([
        frame('P', [cstr(''), cstr(text), int16(0)]),
        frame('B', [cstr(''), cstr(''), int16(0), int16(params.length), ...params.map(encodeParam), int16(0)]),
        frame('D', [Buffer.from('P'), cstr('')]),
        frame('E', [cstr(''), int32(0)]),
        frame('S', []),
      ]));
    });
  }

  close() {
    this.alive = false;
    if (this.socket && !this.socket.destroyed) this.socket.end(frame('X', []));
  }
}

// ---------------------------------------------------------------- the pool
export class Pool {
  constructor(url, { max = 10, connectTimeoutMs = 3000 } = {}) {
    this.config = parseUrl(url);
    this.max = max;
    this.connectTimeoutMs = connectTimeoutMs;
    this.idle = [];
    this.waiting = [];
    this.total = 0;
  }

  async open() {
    this.total += 1;
    try {
      const conn = await new Connection(this.config).open(this.connectTimeoutMs);
      conn.onClose = () => { this.idle = this.idle.filter((c) => c !== conn); };
      return conn;
    } catch (err) {
      this.total -= 1;
      this.next();
      throw err;
    }
  }

  // Hands a freed slot to the first waiter.
  next() {
    if (!this.waiting.length || this.total >= this.max) return;
    const waiter = this.waiting.shift();
    this.open().then(waiter.resolve, waiter.reject);
  }

  async connect() {
    let conn = null;
    while (this.idle.length && !conn) {
      const candidate = this.idle.pop();
      if (candidate.alive) conn = candidate;
      else this.total -= 1;
    }
    if (!conn) {
      conn = this.total < this.max ? await this.open()
        : await new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
    }
    let released = false;
    return {
      query: (text, params) => conn.query(text, params),
      release: (broken = false) => {
        if (released) return;
        released = true;
        if (broken || !conn.alive) {
          conn.close();
          this.total -= 1;
          this.next();
          return;
        }
        const waiter = this.waiting.shift();
        if (waiter) waiter.resolve(conn);
        else this.idle.push(conn);
      },
    };
  }

  async query(text, params) {
    const client = await this.connect();
    try {
      const result = await client.query(text, params);
      client.release();
      return result;
    } catch (err) {
      client.release(err instanceof ConnectionError);
      throw err;
    }
  }
}
