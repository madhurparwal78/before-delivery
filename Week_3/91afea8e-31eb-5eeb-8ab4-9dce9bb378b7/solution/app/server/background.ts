/** Work that continues after the reply: failures are logged, never thrown into the request. */
export function detach(work: Promise<unknown>): void {
  work.catch((error: unknown) => console.error(error instanceof Error ? error.stack : error));
}
