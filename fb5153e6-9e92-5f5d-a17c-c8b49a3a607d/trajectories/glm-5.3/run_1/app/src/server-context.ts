let secret = '';

export function setSessionSecret(value: string): void {
  secret = value;
}

export async function sessionSecret(): Promise<string> {
  if (secret === '') {
    const { initSecrets } = await import('./db/session-store.js');
    secret = await initSecrets();
  }
  return secret;
}
