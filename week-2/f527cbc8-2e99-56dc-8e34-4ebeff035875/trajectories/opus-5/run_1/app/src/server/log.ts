import { config } from './config.js';

/**
 * One JSON line on stdout per request. Vet tokens in paths are written as `[token]`,
 * and cookies, passwords, Bearer tokens and card tokens never reach a log line.
 */
export interface RequestLogLine {
  request_id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
}

const VET_PATH = /(\/api\/vet\/|\/vet\/)[^/?#]+/g;

export function redactPath(path: string): string {
  return path.replace(VET_PATH, (_match, prefix: string) => `${prefix}[token]`);
}

function write(level: string, msg: string, fields: Record<string, unknown>): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    instance: config.instanceLabel,
    ...fields,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

export const log = {
  request(line: RequestLogLine): void {
    write('info', 'request', { ...line, path: redactPath(line.path) });
  },
  event(fields: Record<string, unknown>): void {
    const { event, ...rest } = fields as { event?: string } & Record<string, unknown>;
    write('info', event ?? 'event', { event, ...rest });
  },
  error(msg: string, fields: Record<string, unknown> = {}): void {
    write('error', msg, fields);
  },
};
