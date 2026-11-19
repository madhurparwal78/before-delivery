import { F } from '../../shared/feedback.ts';
import { app } from '../config.ts';
import { db, tx } from '../providers/db.ts';
import {
  KeycloakDown,
  changeIdentityPassword,
  currentTotp,
  endUserSessions,
  ensureIdentity,
  ensureRealm,
  revokeIdentity,
  totpSecretOf,
} from '../providers/keycloak.ts';
import { advanceClock, namespaceNow } from '../domain/clock.ts';
import { isValidNamespace } from '../domain/validation.ts';
import { invalid, notFound } from '../http/errors.ts';
import { readJsonBody, sendJson } from '../http/request.ts';
import type { Router } from '../http/router.ts';
import { seedNamespace } from '../fixtures/seed.ts';
import { signInThroughKeycloak, storageStateFor, type StorageState } from '../fixtures/signin.ts';
import { stagedMedia } from '../http/assets.ts';
import { createSession, destroySessionsOfSubject } from '../session.ts';
import { WORKFLOWS, VARIANTS, type Role, type Variant, type Workflow } from '../../shared/types.ts';

/**
 * The grading surface. These routes exist only when FLAN_GRADE_KEY is set and
 * the request carries the matching header; otherwise they answer 404 as unknown
 * paths do, which the router applies before any transport check.
 */

/** Where each role's view of a workflow opens. */
const WORKFLOW_ENTRY: Record<Workflow, string> = {
  intake: 'intake',
  attribution: 'attribution',
  catalog_reconciliation: 'catalog-reconciliation',
  tray_placement: 'tray-placement',
  set_tracking: 'album',
  condition_comparison: 'condition',
  duplicate_selection: 'keepers',
  offer_assembly: 'offers',
  counteroffers: 'counteroffers',
  dispatch: 'dispatch',
  receipt: 'receipt',
  disputes: 'disputes',
  stock_audit: 'stock-audit',
  'cross-cutting': 'condition',
};

/** A counterpart only has a view of the exchange workflows. */
const COUNTERPART_VIEWS = new Set([
  'offer_assembly',
  'counteroffers',
  'dispatch',
  'receipt',
  'disputes',
  'cross-cutting',
]);

function entryFor(ns: string, workflow: Workflow, role: Role): string {
  if (role === 'outsider') return `${app.publicUrl}/desk/${ns}`;
  if (role === 'counterpart' && !COUNTERPART_VIEWS.has(workflow)) {
    return `${app.publicUrl}/desk/${ns}`;
  }
  const workspace = role === 'counterpart' && workflow === 'cross-cutting'
    ? 'offers'
    : WORKFLOW_ENTRY[workflow];
  return `${app.publicUrl}/desk/${ns}/${workspace}`;
}

class SeedFailed extends Error {}

export function registerGradingRoutes(router: Router): void {
  router.add({
    method: 'POST',
    path: '/__grade/seed',
    grading: true,
    handler: async ({ request, response }) => {
      const body = await readJsonBody(request);
      const ns = typeof body['namespace'] === 'string' ? body['namespace'] : '';
      const workflow = body['workflow'];
      const variant = body['variant'];

      if (!isValidNamespace(ns)) {
        throw invalid({ namespace: F.INVALID });
      }
      if (typeof workflow !== 'string' || !WORKFLOWS.includes(workflow as Workflow)) {
        throw invalid({ workflow: F.INVALID });
      }
      if (typeof variant !== 'string' || !VARIANTS.includes(variant as Variant)) {
        throw invalid({ variant: F.INVALID });
      }

      try {
        // On the postgres-down instance nothing can be seeded at all.
        await db();
        await seedNamespace(ns, workflow as Workflow, true);

        const entries: Record<string, string> = {};
        const sessions: Record<string, StorageState> = {};
        const roles: { label: string; role: Role }[] = [
          { label: 'dealer', role: 'dealer' },
          { label: 'dealer_peer', role: 'dealer' },
          { label: 'counterpart', role: 'counterpart' },
          { label: 'outsider', role: 'outsider' },
        ];

        let keycloakReachable = true;
        const identities = new Map<Role, Awaited<ReturnType<typeof ensureIdentity>>>();
        try {
          await ensureRealm();
          for (const role of ['dealer', 'counterpart', 'outsider'] as const) {
            identities.set(role, await ensureIdentity(ns, role));
            // A reseed must not inherit an earlier run's Keycloak session.
            await endUserSessions(`${ns}-${role}`);
          }
        } catch (error) {
          if (!(error instanceof KeycloakDown)) throw error;
          keycloakReachable = false;
        }

        for (const { label, role } of roles) {
          entries[label] = entryFor(ns, workflow as Workflow, role);
          // The dealer and dealer_peer are two tabs of the same dealer, so the
          // peer reuses the dealer's application and Keycloak sign-in.
          const dealerState = sessions['dealer'];
          if (label === 'dealer_peer' && dealerState) {
            sessions[label] = dealerState;
            continue;
          }
          const identity = identities.get(role);
          if (!identity) {
            // Without Keycloak the storage state holds only an application
            // session cookie, so reads succeed and every write follows the
            // published Keycloak outage behaviour.
            const session = await tx((sql) =>
              createSession(sql, {
                ns,
                subject: `${ns}-${role}`,
                username: `${ns}-${role}`,
                role,
                kcSession: null,
                stepUpAt: null,
                bypassKeycloak: true,
              }),
            );
            sessions[label] = storageStateFor([], session.id);
            continue;
          }

          // Genuine, separate application and Keycloak sign-ins, each without
          // a step-up proof. The dealer and dealer_peer are two tabs of the
          // same dealer, so they share one Keycloak session.
          let cookies: Awaited<ReturnType<typeof signInThroughKeycloak>>['cookies'] = [];
          let kcSession: string | null = null;
          if (keycloakReachable) {
            try {
              const signedIn = await signInThroughKeycloak(identity.username, identity.password);
              cookies = signedIn.cookies;
              kcSession = signedIn.claims.sessionId;
            } catch (error) {
              if (!(error instanceof KeycloakDown)) throw error;
            }
          }
          const session = await tx((sql) =>
            createSession(sql, {
              ns,
              subject: identity.subject,
              username: identity.username,
              role,
              kcSession,
              stepUpAt: null,
              bypassKeycloak: kcSession === null,
            }),
          );
          sessions[label] = storageStateFor(cookies, session.id);
        }

        const media = stagedMedia();
        const clock = await namespaceNow(await db(), ns);
        sendJson(response, 201, {
          namespace: ns,
          entries,
          sessions,
          state_url: `${app.publicUrl}/api/desks/${ns}/state`,
          media: {
            obverse: `${app.publicUrl}/static/${media.obverse}`,
            reverse: `${app.publicUrl}/static/${media.reverse}`,
          },
          clock: clock.toISOString(),
        });
      } catch (error) {
        if (error instanceof SeedFailed) {
          sendJson(response, 500, { error: 'seed_failed', message: error.message });
          return;
        }
        const api = error as { status?: number; body?: () => unknown };
        if (api.status === 503 && typeof api.body === 'function') {
          sendJson(response, 503, api.body());
          return;
        }
        throw error;
      }
    },
  });

  router.add({
    method: 'POST',
    path: '/__grade/:ns/clock',
    grading: true,
    handler: async ({ request, response, params }) => {
      const ns = params['ns'] as string;
      const body = await readJsonBody(request);
      const advance = body['advance_seconds'];
      if (typeof advance !== 'number' || !Number.isInteger(advance) || advance < 0) {
        throw invalid({ advance_seconds: F.INVALID });
      }
      const sql = await db();
      const found = await sql.query('SELECT 1 FROM namespaces WHERE ns = $1', [ns]);
      if (found.rowCount === 0) throw notFound();
      const clock = await advanceClock(sql, ns, advance);
      sendJson(response, 200, { clock: clock.toISOString() });
    },
  });

  router.add({
    method: 'GET',
    path: '/__grade/:ns/otp',
    grading: true,
    handler: async ({ response, params, url }) => {
      const ns = params['ns'] as string;
      const role = url.searchParams.get('role') ?? 'dealer';
      if (role !== 'dealer' && role !== 'counterpart' && role !== 'outsider') {
        throw invalid({ role: F.INVALID });
      }
      // Codes follow Keycloak's real clock, so this is the code valid now.
      sendJson(response, 200, { code: currentTotp(totpSecretOf(ns, role)) });
    },
  });

  router.add({
    method: 'POST',
    path: '/__grade/:ns/identity',
    grading: true,
    handler: async ({ request, response, params }) => {
      const ns = params['ns'] as string;
      const body = await readJsonBody(request);
      const role = body['role'];
      const action = body['action'];
      if (role !== 'counterpart') throw invalid({ role: F.INVALID });
      if (action !== 'revoke' && action !== 'password_change') {
        throw invalid({ action: F.INVALID });
      }

      const username = `${ns}-counterpart`;
      try {
        if (action === 'revoke') await revokeIdentity(username);
        else await changeIdentityPassword(username);
      } catch (error) {
        if (!(error instanceof KeycloakDown)) throw error;
      }
      // The desk session ends with the identity, so no later write succeeds.
      const sql = await db();
      const subjects = await sql.query<{ subject: string }>(
        'SELECT DISTINCT subject FROM app_sessions WHERE ns = $1 AND role = $2',
        [ns, 'counterpart'],
      );
      for (const row of subjects.rows) await destroySessionsOfSubject(row.subject);
      sendJson(response, 200, { role, action });
    },
  });
}
