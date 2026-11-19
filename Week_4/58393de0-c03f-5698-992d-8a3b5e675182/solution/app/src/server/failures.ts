/** Failure handlers for background work whose caller cannot answer anyone: each logs, then returns the fallback. */
export function logged<T>(context: string, fallback: T): (error: unknown) => T {
  return (error) => {
    console.warn(`${context}:`, error instanceof Error ? error.message : error);
    return fallback;
  };
}

/** A file that does not exist reads as null; any other file-system error still propagates. */
export function nullIfMissing(error: unknown): null {
  if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
  throw error;
}
