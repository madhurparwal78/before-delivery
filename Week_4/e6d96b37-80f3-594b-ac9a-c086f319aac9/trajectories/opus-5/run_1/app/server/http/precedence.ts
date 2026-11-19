import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { tx } from '../providers/db.ts';
import { publish, type AppendedEvent } from '../store/events.ts';
import { assertIdentityLive, stepUpFresh, type AppSession } from '../session.ts';
import {
  ApiError,
  authenticationRequired,
  commandReused,
  forbidden,
  notFound,
  stepUpRequired,
} from './errors.ts';

/**
 * The published error precedence, stated once.
 *
 *   1. 401 authentication_required
 *   2. 404 not_found        (missing, foreign or hidden resource, keys included)
 *   3. 403 forbidden        (or step_up_required for a missing or stale proof)
 *   4. replay              (same command_id: stored reply, or 409 if different)
 *   5. 409 conflict        (terminal or frozen, then a stale expected_version,
 *                           then F_TRAY_TAKEN, F_OFFER_TAKEN, F_IN_OFFER,
 *                           F_SET_UNCERTAIN, F_SET_OUTBOUND, F_CATALOG_PENDING,
 *                           F_INTAKE_DUP, F_UNDO_NONE)
 *   6. 422 invalid          (or the step-6 413 for an oversized photograph)
 *
 * Steps 5 and 6 belong to `check`, which each command states in that order.
 * Provider errors arise only once every step above has passed, which is why
 * `provide` runs after `check`. They are never stored for replay, so a retry
 * with the same command_id runs again.
 */

export interface CommandResult {
  status: number;
  body: unknown;
  events: AppendedEvent[];
}

export interface CommandContext {
  sql: PoolClient;
  session: AppSession;
  ns: string;
  commandId: string;
}

export interface CommandSpec<Checked = void, Provided = void> {
  session: AppSession | null;
  ns: string;
  commandId: string;
  /** Payload identity for replay. Files contribute their digest, not bytes. */
  fingerprintParts: unknown;
  /** Step 2: the resource must be visible to this caller. */
  visible: () => boolean | Promise<boolean>;
  /** Step 3: this role may perform the action on a visible resource. */
  permitted: () => boolean | Promise<boolean>;
  /** Step 3: the action needs a fresh step-up proof. */
  needsStepUp?: boolean;
  /** Steps 5 and 6, in one transaction, before any provider is called. */
  check?: (context: CommandContext) => Promise<Checked>;
  /**
   * Work that must be committed before the providers run, such as keeping a
   * catalogue correction that has to survive a register outage.
   */
  prepare?: (context: CommandContext, checked: Checked) => Promise<void>;
  /** Provider calls, outside any transaction so none is held open across them. */
  provide?: (checked: Checked) => Promise<Provided>;
  /** The effect, its events and its reply, in one transaction. */
  commit: (
    context: CommandContext,
    checked: Checked,
    provided: Provided,
  ) => Promise<{ status: number; body: unknown; events?: AppendedEvent[] }>;
}

function fingerprint(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts ?? null)).digest('hex');
}

interface StoredReply {
  fingerprint: string;
  status: number;
  body: unknown;
}

/** A command_id is 1 to 64 characters. */
export function isValidCommandId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 64;
}

export async function executeCommand<Checked, Provided>(
  spec: CommandSpec<Checked, Provided>,
): Promise<CommandResult> {
  // 1. no completed session, an expired session, or an ended Keycloak session.
  if (!spec.session) throw authenticationRequired();
  await assertIdentityLive(spec.session);

  // 2. a missing, foreign or hidden resource, including keys inside the body.
  if (!(await spec.visible())) throw notFound();

  // 3. visible, but this role cannot act; a stale proof is its own answer.
  if (!(await spec.permitted())) throw forbidden();
  if (spec.needsStepUp && !stepUpFresh(spec.session)) throw stepUpRequired();

  const print = fingerprint(spec.fingerprintParts);
  const session = spec.session;
  const base = { session, ns: spec.ns, commandId: spec.commandId };

  // 4. replay: an identical payload returns the stored reply with no new side
  // effect; a different payload under the same command_id conflicts.
  const replayed = await tx(async (sql) => {
    const stored = await sql.query<StoredReply>(
      'SELECT fingerprint, status, body FROM command_replies WHERE ns = $1 AND command_id = $2',
      [spec.ns, spec.commandId],
    );
    const previous = stored.rows[0];
    if (!previous) return null;
    if (previous.fingerprint !== print) throw commandReused();
    return { status: previous.status, body: previous.body, events: [] as AppendedEvent[] };
  });
  if (replayed) return replayed;

  // 5 and 6, stated by the command in the published order.
  const checked = await tx(async (sql) =>
    spec.check ? spec.check({ sql, ...base }) : (undefined as Checked),
  );

  if (spec.prepare) {
    const prepare = spec.prepare;
    await tx(async (sql) => prepare({ sql, ...base }, checked));
  }

  const provided = spec.provide ? await spec.provide(checked) : (undefined as Provided);

  const outcome = await tx(async (sql) => {
    const result = await spec.commit({ sql, ...base }, checked, provided);
    await sql.query(
      `INSERT INTO command_replies (ns, command_id, subject, fingerprint, status, body)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (ns, command_id) DO NOTHING`,
      // A 204 stores the JSON value `null`, not a SQL NULL.
      [
        spec.ns,
        spec.commandId,
        session.subject,
        print,
        result.status,
        JSON.stringify(result.body ?? null),
      ],
    );
    return { ...result, events: result.events ?? [] };
  });

  publish(spec.ns, outcome.events);
  return outcome;
}

/**
 * Reads follow steps 1 to 3 only. A dealer-only route answers a counterpart or
 * outsider 404 in the router, before any transport check.
 */
export async function authorizeRead(spec: {
  session: AppSession | null;
  visible: () => boolean | Promise<boolean>;
  permitted: () => boolean | Promise<boolean>;
}): Promise<AppSession> {
  if (!spec.session) throw authenticationRequired();
  if (!(await spec.visible())) throw notFound();
  if (!(await spec.permitted())) throw forbidden();
  return spec.session;
}

export { ApiError, stepUpRequired };
