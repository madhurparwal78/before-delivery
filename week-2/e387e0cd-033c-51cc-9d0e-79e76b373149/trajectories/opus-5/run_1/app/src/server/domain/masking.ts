/** Masking for support agents, applied to every response, screen and file. */

export function maskPersonName(name: string): string {
  const parts = name.split(/[\s-]+/).filter((part) => part !== '');
  return parts.map((part) => `${[...part][0]}.`).join(' ');
}

export function maskIdentityNumber(identityNumber: string): string {
  return `…${identityNumber.slice(-4)}`;
}
