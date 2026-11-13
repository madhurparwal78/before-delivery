/** A fault is logged by kind and code only: an error message can carry a connection string or a key. */
export function logFault(scope: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : null;
  process.stderr.write(`${scope} failed: ${kind}${typeof code === 'string' ? ` ${code}` : ''}\n`);
}
