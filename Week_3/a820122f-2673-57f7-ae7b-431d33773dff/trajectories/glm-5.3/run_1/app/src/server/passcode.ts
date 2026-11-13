import bcrypt from "bcryptjs";

/**
 * Passcodes are stored only as salted hashes.
 */
export function hashPasscode(passcode: string): string {
  return bcrypt.hashSync(passcode, 10);
}

export function verifyPasscode(passcode: string, hash: string): boolean {
  return bcrypt.compareSync(passcode, hash);
}
