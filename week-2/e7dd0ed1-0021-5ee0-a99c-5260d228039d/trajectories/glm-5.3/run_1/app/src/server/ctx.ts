export interface Ctx {
  method: string;
  path: string;
  rawPath: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: Buffer | null;
  json(): unknown;
}

export function errUnexpected(m: string): Error & { status: number } {
  const e = new Error(m) as Error & { status: number };
  e.status = 500;
  return e;
}
