// Password hashing for the seeded accounts: salted bcrypt at cost 10, in its standard encoded form.
import bcrypt from "bcryptjs";

const COST = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return bcrypt.compare(password, stored);
}
