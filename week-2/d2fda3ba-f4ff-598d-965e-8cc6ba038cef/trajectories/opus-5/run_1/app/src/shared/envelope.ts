export const ENVELOPE_MAGIC = 'CRN1';
export const ENVELOPE_IV_BYTES = 12;
export const ENVELOPE_MIN_BYTES = 32;
export const ENVELOPE_MAX_BYTES = 2_000_000;
export const VAULT_KEY_ITERATIONS = 600_000;
export const VAULT_SALT_BYTES = 16;
export const VAULT_PASSPHRASE_MIN_LENGTH = 12;

const MAGIC_BYTES = [0x43, 0x52, 0x4e, 0x31];

/** The plaintext shape that is encrypted into one revision envelope. */
export interface NotePlaintext {
  title: string;
  aliases: string[];
  frontmatter: Record<string, unknown>;
  body: string;
  private: boolean;
}

/** Why a blob is not an encrypted envelope, or null when it is one. */
export function envelopeProblem(bytes: Uint8Array): string | null {
  if (bytes.length > ENVELOPE_MAX_BYTES) return 'is longer than 2000000 bytes';
  if (bytes.length < ENVELOPE_MIN_BYTES) return 'is shorter than 32 bytes';
  for (let index = 0; index < MAGIC_BYTES.length; index += 1) {
    if (bytes[index] !== MAGIC_BYTES[index]) return 'is not an encrypted envelope';
  }
  return null;
}
