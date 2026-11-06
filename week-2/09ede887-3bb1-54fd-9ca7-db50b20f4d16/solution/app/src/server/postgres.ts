import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { DatabaseError, parse, serialize } from 'pg-protocol';

// A small PostgreSQL client over the node-postgres wire codec (pg-protocol): one socket per
// connection, password / MD5 / SCRAM-SHA-256 sign-in, text-format results, and a bounded pool.

export { DatabaseError };

interface QueryResult<R> {
  rows: R[];
  rowCount: number;
}

export interface Queryable {
  query<R>(sql: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}

interface Message {
  name: string;
}

interface Field {
  name: string;
  dataTypeID: number;
}

const CONNECT_TIMEOUT_MS = 5000;

// Reads one property of a decoded backend message.
function field(message: Message, key: string): unknown {
  const value: unknown = Reflect.get(message, key);
  return value;
}

// Result columns arrive as text and are typed by their OID.
const NUMBER_TYPES = new Set([20, 21, 23, 26, 700, 701, 1700]);
const JSON_TYPES = new Set([114, 3802]);
const BOOL_TYPE = 16;

function decode(value: string | null, type: number): unknown {
  if (value === null) return null;
  if (NUMBER_TYPES.has(type)) return Number(value);
  if (JSON_TYPES.has(type)) return JSON.parse(value) as unknown;
  if (type === BOOL_TYPE) return value === 't';
  return value;
}

function arrayItem(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function encode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `{${value.map(arrayItem).join(',')}}`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function affectedRows(tag: string): number {
  const count = Number(tag.split(' ').at(-1));
  return Number.isInteger(count) ? count : 0;
}

class Scram {
  private readonly nonce = randomBytes(18).toString('base64');
  private serverSignature = Buffer.alloc(0);

  constructor(private readonly password: string) {}

  get clientFirstBare(): string {
    return `n=*,r=${this.nonce}`;
  }

  clientFinal(serverFirst: string): string {
    const attributes = new Map(serverFirst.split(',').map((part) => [part.slice(0, 1), part.slice(2)]));
    const serverNonce = attributes.get('r') ?? '';
    if (!serverNonce.startsWith(this.nonce)) throw new Error('SCRAM server nonce mismatch');
    const salted = pbkdf2Sync(this.password, Buffer.from(attributes.get('s') ?? '', 'base64'), Number(attributes.get('i')), 32, 'sha256');
    const clientKey = createHmac('sha256', salted).update('Client Key').digest();
    const storedKey = createHash('sha256').update(clientKey).digest();
    const withoutProof = `c=biws,r=${serverNonce}`;
    const authMessage = `${this.clientFirstBare},${serverFirst},${withoutProof}`;
    const signature = createHmac('sha256', storedKey).update(authMessage).digest();
    const proof = Buffer.from(clientKey.map((byte, index) => byte ^ (signature[index] ?? 0)));
    const serverKey = createHmac('sha256', salted).update('Server Key').digest();
    this.serverSignature = createHmac('sha256', serverKey).update(authMessage).digest();
    return `${withoutProof},p=${proof.toString('base64')}`;
  }

  verify(serverFinal: string): void {
    const signature = Buffer.from(serverFinal.startsWith('v=') ? serverFinal.slice(2) : '', 'base64');
    if (signature.length !== this.serverSignature.length || !timingSafeEqual(signature, this.serverSignature)) {
      throw new Error('SCRAM server signature mismatch');
    }
  }
}

type Handler = (message: Message) => void;

class Connection implements Queryable {
  broken = false;
  private handler: Handler = () => undefined;
  private tail: Promise<unknown> = Promise.resolve();

  private constructor(private readonly socket: net.Socket) {
    void parse(socket, (message) => this.handler(message));
    const fail = (): void => {
      this.broken = true;
      this.handler({ name: 'connectionLost' });
    };
    socket.on('error', fail);
    socket.on('close', fail);
  }

  static open(url: URL): Promise<Connection> {
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const socket = net.connect({ host: url.hostname, port: Number(url.port || 5432) });
    socket.setNoDelay(true);
    const connection = new Connection(socket);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => socket.destroy(new Error('connect timeout')), CONNECT_TIMEOUT_MS);
      const scram = new Scram(password);
      const finish = (error: Error | null): void => {
        clearTimeout(timer);
        connection.handler = () => undefined;
        if (error === null) {
          resolve(connection);
        } else {
          socket.destroy();
          reject(error);
        }
      };
      connection.handler = (message) => {
        try {
          if (message.name === 'authenticationCleartextPassword') {
            socket.write(serialize.password(password));
          } else if (message.name === 'authenticationMD5Password') {
            const salt = field(message, 'salt') as Buffer;
            const inner = createHash('md5').update(password + user).digest('hex');
            socket.write(serialize.password(`md5${createHash('md5').update(inner).update(salt).digest('hex')}`));
          } else if (message.name === 'authenticationSASL') {
            socket.write(serialize.sendSASLInitialResponseMessage('SCRAM-SHA-256', `n,,${scram.clientFirstBare}`));
          } else if (message.name === 'authenticationSASLContinue') {
            socket.write(serialize.sendSCRAMClientFinalMessage(scram.clientFinal(String(field(message, 'data')))));
          } else if (message.name === 'authenticationSASLFinal') {
            scram.verify(String(field(message, 'data')));
          } else if (message.name === 'readyForQuery') {
            finish(null);
          } else if (message.name === 'error') {
            finish(message instanceof Error ? message : new Error('connection refused'));
          } else if (message.name === 'connectionLost') {
            finish(new Error('connection lost'));
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      };
      socket.once('connect', () => {
        socket.write(serialize.startup({ user, database: url.pathname.slice(1), client_encoding: 'UTF8' }));
      });
    });
  }

  // Runs one statement (extended protocol) or, without values, a script (simple protocol).
  query<R>(sql: string, values: readonly unknown[] = []): Promise<QueryResult<R>> {
    const run = this.tail.then(() => this.send<R>(sql, values));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private send<R>(sql: string, values: readonly unknown[]): Promise<QueryResult<R>> {
    if (this.broken) return Promise.reject(new Error('connection lost'));
    return new Promise((resolve, reject) => {
      let fields: Field[] = [];
      let rows: R[] = [];
      let rowCount = 0;
      let failure: Error | null = null;
      this.handler = (message) => {
        if (message.name === 'rowDescription') {
          fields = field(message, 'fields') as Field[];
          rows = [];
        } else if (message.name === 'dataRow') {
          const cells = field(message, 'fields') as (string | null)[];
          const row: Record<string, unknown> = {};
          fields.forEach((column, index) => {
            row[column.name] = decode(cells[index] ?? null, column.dataTypeID);
          });
          rows.push(row as R);
        } else if (message.name === 'commandComplete') {
          rowCount = affectedRows(String(field(message, 'text')));
        } else if (message.name === 'error') {
          failure = message instanceof Error ? message : new Error('query failed');
        } else if (message.name === 'readyForQuery') {
          this.handler = () => undefined;
          if (failure === null) resolve({ rows, rowCount });
          else reject(failure);
        } else if (message.name === 'connectionLost') {
          this.handler = () => undefined;
          reject(new Error('connection lost'));
        }
      };
      if (values.length === 0) {
        this.socket.write(serialize.query(sql));
      } else {
        this.socket.write(
          Buffer.concat([
            serialize.parse({ text: sql }),
            serialize.bind({ values: values.map(encode) }),
            serialize.describe({ type: 'P' }),
            serialize.execute({}),
            serialize.sync(),
          ]),
        );
      }
    });
  }

  close(): void {
    this.broken = true;
    this.socket.destroy();
  }
}

interface PooledConnection extends Queryable {
  release(): void;
}

export class Pool implements Queryable {
  private readonly idle: Connection[] = [];
  private readonly waiting: ((connection: Connection | Error) => void)[] = [];
  private size = 0;
  private readonly url: URL;

  constructor(connectionString: string, private readonly max: number) {
    this.url = new URL(connectionString);
  }

  async connect(): Promise<PooledConnection> {
    const connection = await this.acquire();
    let released = false;
    return {
      query: (sql, values) => connection.query(sql, values),
      release: () => {
        if (released) return;
        released = true;
        this.giveBack(connection);
      },
    };
  }

  async query<R>(sql: string, values: readonly unknown[] = []): Promise<QueryResult<R>> {
    const connection = await this.acquire();
    try {
      return await connection.query<R>(sql, values);
    } finally {
      this.giveBack(connection);
    }
  }

  private async acquire(): Promise<Connection> {
    for (let connection = this.idle.pop(); connection !== undefined; connection = this.idle.pop()) {
      if (!connection.broken) return connection;
      this.size -= 1;
    }
    if (this.size >= this.max) {
      const next = await new Promise<Connection | Error>((resolve) => this.waiting.push(resolve));
      if (next instanceof Error) throw next;
      return next;
    }
    this.size += 1;
    try {
      return await Connection.open(this.url);
    } catch (error) {
      this.size -= 1;
      throw error;
    }
  }

  private giveBack(connection: Connection): void {
    const waiter = this.waiting.shift();
    if (connection.broken) {
      this.size -= 1;
      if (waiter !== undefined) {
        this.size += 1;
        Connection.open(this.url).then(waiter, (error: unknown) => {
          this.size -= 1;
          waiter(error instanceof Error ? error : new Error(String(error)));
        });
      }
      return;
    }
    if (waiter !== undefined) waiter(connection);
    else this.idle.push(connection);
  }
}
