// What a log line may say about a failure: system and connection errors carry hosts, ports and user
// names in their messages, so only their code is logged; other errors log their message.

export function reason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  if ("code" in error && typeof error.code === "string" && /^E[A-Z_]+$/.test(error.code)) return error.code;
  return error.message;
}
