import bcrypt from "bcryptjs";
import { one, rows, type Db, type Tx } from "./db.js";
import { randomToken } from "./util.js";

export type Role = "operator" | "shift_lead" | "renter";
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  renter_id: string | null;
  renter_status: string | null;
};

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, 10);
export const verifyPassword = (password: string, hash: string): Promise<boolean> => bcrypt.compare(password, hash);

export const findUserByEmail = (db: Db, email: string) =>
  one<{ id: string; email: string; password_hash: string; name: string; role: Role; renter_id: string | null; renter_status: string | null }>(
    db,
    `select u.id, u.email, u.password_hash, u.name, u.role, u.renter_id, r.status as renter_status
     from users u left join renters r on r.id = u.renter_id
     where lower(u.email) = lower($1)`,
    [email],
  );

export const createUser = async (
  tx: Tx,
  email: string,
  password: string,
  name: string,
  role: Role,
  renterId: string | null,
): Promise<string> => {
  const hash = await hashPassword(password);
  const result = await rows<{ id: string }>(
    tx,
    "insert into users (email, password_hash, name, role, renter_id) values (lower($1), $2, $3, $4, $5) returning id",
    [email, hash, name, role, renterId],
  );
  return result[0]!.id;
};

export const createSession = async (tx: Tx, userId: string): Promise<string> => {
  const token = randomToken(32);
  await tx.query("insert into sessions (token, user_id, expires_at) values ($1, $2, now() + interval '14 days')", [
    token,
    userId,
  ]);
  return token;
};

export const userForSession = async (db: Db, token: string | null): Promise<User | null> => {
  if (!token) return null;
  const found = await one<User>(
    db,
    `select u.id, u.email, u.name, u.role, u.renter_id, r.status as renter_status
     from sessions s join users u on u.id = s.user_id
     left join renters r on r.id = u.renter_id
     where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  return found;
};

export const deleteSession = (tx: Tx, token: string): Promise<unknown> =>
  tx.query("delete from sessions where token = $1", [token]);

export const userFromRow = (row: { id: string; email: string; name: string; role: Role; renter_id: string | null; renter_status: string | null }): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  renter_id: row.renter_id,
  renter_status: row.renter_status,
});
