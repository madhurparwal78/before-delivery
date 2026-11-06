// The lock rule shared by the server and the console (brief: Retention and legal hold).

// Retention is in force before its retain-until second.
export function retentionInForce(retainUntil: Date | string | null, now: Date): boolean {
  if (retainUntil === null) return false;
  const until = typeof retainUntil === "string" ? Date.parse(retainUntil) : retainUntil.getTime();
  return now.getTime() < until;
}

// A version is locked while on legal hold or while its retention is in force.
export function isLocked(version: { legal_hold: boolean; retain_until: Date | string | null }, now: Date): boolean {
  return version.legal_hold || retentionInForce(version.retain_until, now);
}
