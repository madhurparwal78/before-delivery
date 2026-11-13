const REDACTED = '[redacted]';

const SECRET_PREFIXES: Record<string, readonly string[]> = {
  Secret: ['data.', 'stringData.'],
  SealedSecret: ['spec.encryptedData.', 'spec.template.data.'],
};

/**
 * The one redaction rule. Every value under a Secret's `data`/`stringData` and under a
 * SealedSecret's `spec.encryptedData`/`spec.template.data` is replaced wherever it would be
 * shown. Key names stay visible.
 */
function isSecretLeaf(kind: string, path: string): boolean {
  const prefixes = SECRET_PREFIXES[kind];
  if (!prefixes) return false;
  return prefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

export function redactLeaf(kind: string, path: string, value: unknown): unknown {
  return isSecretLeaf(kind, path) ? REDACTED : value;
}
