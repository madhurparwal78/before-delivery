import { seedAccounts } from './seed.ts';
import { ensureIdentity, ensureSchemaSeed, type Ctx } from './boot.ts';
import { createHash } from 'node:crypto';

/**
 * The identity keeper: checks the realm roles and every seeded account at least every 15
 * seconds, re-creating any missing user, and retries every pending_store drawing at least
 * every 5 seconds until the store confirms it.
 */
export function startKeepers(ctx: Ctx): void {
  void identityKeeper(ctx);
  void storeKeeper(ctx);
  void recoveryKeeper(ctx);
}

async function identityKeeper(ctx: Ctx): Promise<void> {
  for (;;) {
    try {
      await ctx.keycloak.ensureRealmRoles();
      for (const account of seedAccounts) {
        const rows = await ctx.db.query<{ id: string; deleted: boolean }>(
          `SELECT id, deleted FROM accounts WHERE email_norm=$1`, [account.email],
        );
        if (rows.length === 0 || rows[0]!.deleted) continue;
        const user = await ctx.keycloak.findUserByEmail(account.email);
        // ensureUser both creates a missing user and repairs an existing one whose
        // names or password are incomplete, which the realm's login policy needs.
        await ctx.keycloak.ensureUser(account.email, account.password, account.role);
        const fresh = await ctx.keycloak.findUserByEmail(account.email);
        if (fresh) await ctx.db.query(`UPDATE accounts SET kc_user_id=$1 WHERE email_norm=$2`, [fresh.id, account.email]);
        void user;
      }
    } catch {
      // Keycloak not answering; try again on the next pass.
    }
    await sleep(15_000);
  }
}

async function storeKeeper(ctx: Ctx): Promise<void> {
  for (;;) {
    try {
      const pending = await ctx.db.query<{ code: string }>(
        `SELECT code FROM drawings WHERE status='pending_store' AND cut_sheet_key IS NOT NULL`,
      );
      for (const d of pending) {
        const rows = await ctx.db.query<{ cut_sheet_key: string; cut_sheet_sha256: string; cut_sheet_size: number }>(
          `SELECT cut_sheet_key, cut_sheet_sha256, cut_sheet_size FROM drawings WHERE code=$1`, [d.code],
        );
        const target = rows[0]!;
        let bytes: Buffer | null = null;
        try {
          bytes = await ctx.store.get(target.cut_sheet_key);
        } catch {
          continue;
        }
        if (bytes && bytes.length === target.cut_sheet_size && shaOf(bytes) === target.cut_sheet_sha256) {
          await ctx.db.query(`UPDATE drawings SET status='issued' WHERE code=$1`, [d.code]);
        }
      }
    } catch {
      // Database not answering; try again on the next pass.
    }
    await sleep(5_000);
  }
}

async function recoveryKeeper(ctx: Ctx): Promise<void> {
  for (;;) {
    try {
      await ctx.db.query('SELECT 1');
      if (!ctx.dbUp) {
        ctx.dbUp = true;
        await ensureSchemaSeed(ctx);
      }
    } catch {
      ctx.dbUp = false;
    }
    try {
      await ctx.keycloak.jwks();
      if (!ctx.identityUp) {
        await ensureIdentity(ctx);
      }
    } catch {
      ctx.identityUp = false;
    }
    await sleep(2_000);
  }
}

function shaOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
