// Log lines name what failed by error class and code only, never by message: driver messages can carry
// service hosts, ports or user names.

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" ? `${error.name} ${code}` : error.name;
}
