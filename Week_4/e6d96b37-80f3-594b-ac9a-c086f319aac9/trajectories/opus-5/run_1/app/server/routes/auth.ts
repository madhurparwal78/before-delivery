import { randomBytes } from 'node:crypto';
import { app, limits } from '../config.ts';
import { db } from '../providers/db.ts';
import {
  KeycloakDown,
  authorizeUrl,
  clearStepUpChallenge,
  ensureRealm,
  exchangeCode,
  lookupNamespaceAttribute,
  requestStepUpChallenge,
} from '../providers/keycloak.ts';
import { ensureNamespace, namespaceNow } from '../domain/clock.ts';
import { sendJson, sendNoContent, sendRedirect } from '../http/request.ts';
import { serviceUnavailable } from '../http/errors.ts';
import type { Router } from '../http/router.ts';
import {
  attachSessionCookie,
  createSession,
  destroySession,
  detachSessionCookie,
  recordStepUp,
  roleFromRealmRoles,
  sessionIdOf,
  stepUpExpiresAt,
  stepUpFresh,
} from '../session.ts';
import type { SessionInfo } from '../../shared/types.ts';

const CALLBACK_PATH = '/auth/callback';

function redirectUri(): string {
  return `${app.publicUrl}${CALLBACK_PATH}`;
}

/** Only in-app paths are ever returned to. */
function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export function registerAuthRoutes(router: Router): void {
  router.add({
    method: 'GET',
    path: '/auth/login',
    handler: async ({ url, response, session }) => {
      const returnTo = safeReturnTo(url.searchParams.get('return_to'));
      try {
        await ensureRealm();
        // An abandoned step-up must not make the next plain sign-in ask for a
        // code, so the marker is cleared on the way in.
        if (session) await clearStepUpChallenge(session.subject).catch(() => undefined);
        const state = randomBytes(24).toString('base64url');
        const sql = await db();
        await sql.query(
          `INSERT INTO auth_flows (state, ns, return_to, step_up, verifier, session_id, created_at)
           VALUES ($1,$2,$3,false,$4,$5,now())`,
          [state, app.defaultNamespace, returnTo, randomBytes(16).toString('hex'), null],
        );
        sendRedirect(
          response,
          authorizeUrl({
            state,
            nonce: randomBytes(16).toString('base64url'),
            redirectUri: redirectUri(),
            stepUp: false,
          }),
        );
      } catch (error) {
        if (error instanceof KeycloakDown) throw serviceUnavailable();
        throw error;
      }
    },
  });

  router.add({
    method: 'GET',
    path: '/auth/step-up',
    handler: async ({ url, response, session }) => {
      const returnTo = safeReturnTo(url.searchParams.get('return_to'));
      if (!session) {
        sendRedirect(response, `/auth/login?return_to=${encodeURIComponent(returnTo)}`);
        return;
      }
      try {
        await ensureRealm();
        // Marking the identity is what makes Keycloak ask for the code.
        await requestStepUpChallenge(session.subject);
        const state = randomBytes(24).toString('base64url');
        const sql = await db();
        await sql.query(
          `INSERT INTO auth_flows (state, ns, return_to, step_up, verifier, session_id, created_at)
           VALUES ($1,$2,$3,true,$4,$5,now())`,
          [state, session.ns, returnTo, randomBytes(16).toString('hex'), session.id],
        );
        sendRedirect(
          response,
          authorizeUrl({
            state,
            nonce: randomBytes(16).toString('base64url'),
            redirectUri: redirectUri(),
            stepUp: true,
            loginHint: session.username,
          }),
        );
      } catch (error) {
        if (error instanceof KeycloakDown) throw serviceUnavailable();
        throw error;
      }
    },
  });

  router.add({
    method: 'GET',
    path: CALLBACK_PATH,
    handler: async ({ url, response }) => {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        sendRedirect(response, '/');
        return;
      }

      const sql = await db();
      const flow = await sql.query<{
        ns: string;
        return_to: string;
        step_up: boolean;
        session_id: string | null;
      }>('DELETE FROM auth_flows WHERE state = $1 RETURNING ns, return_to, step_up, session_id', [
        state,
      ]);
      const pending = flow.rows[0];
      if (!pending) {
        sendRedirect(response, '/');
        return;
      }

      try {
        const { claims } = await exchangeCode(code, redirectUri());
        await clearStepUpChallenge(claims.subject).catch(() => undefined);

        if (pending.step_up && pending.session_id) {
          // The proof is dated now: Keycloak has just finished the challenge.
          await recordStepUp(pending.session_id, new Date());
          sendRedirect(response, pending.return_to);
          return;
        }

        // The namespace attribute is admin-only, so it is read from Keycloak
        // rather than from a token claim no protocol mapper emits.
        const ns =
          claims.namespaceAttribute ??
          (await lookupNamespaceAttribute(claims.subject)) ??
          app.defaultNamespace;
        await ensureNamespace(sql, ns, ns === app.defaultNamespace ? 'real' : 'grading');
        const session = await createSession(sql, {
          ns,
          subject: claims.subject,
          username: claims.username,
          role: roleFromRealmRoles(claims.realmRoles),
          kcSession: claims.sessionId,
          // A sign-in never grants a step-up proof.
          stepUpAt: null,
        });
        attachSessionCookie(response, session);
        sendRedirect(response, pending.return_to);
      } catch (error) {
        if (error instanceof KeycloakDown) throw serviceUnavailable();
        throw error;
      }
    },
  });

  router.add({
    method: 'POST',
    path: '/auth/logout',
    handler: async ({ request, response }) => {
      const id = sessionIdOf(request);
      if (id) await destroySession(id);
      detachSessionCookie(response);
      sendNoContent(response);
    },
  });

  router.add({
    method: 'GET',
    path: '/api/session',
    handler: async ({ response, session }) => {
      if (!session) {
        const anonymous: SessionInfo = {
          subject: '',
          username: '',
          role: 'outsider',
          namespace: app.defaultNamespace,
          step_up_fresh: false,
          step_up_expires_at: null,
        };
        sendJson(response, 200, anonymous);
        return;
      }
      const info: SessionInfo = {
        subject: session.subject,
        username: session.username,
        role: session.role,
        namespace: session.ns,
        step_up_fresh: stepUpFresh(session),
        step_up_expires_at: stepUpExpiresAt(session),
      };
      sendJson(response, 200, info);
    },
  });

  // The browser needs the server's own clock and limits, never its own.
  router.add({
    method: 'GET',
    path: '/api/desks/:ns/now',
    handler: async ({ response, params }) => {
      const sql = await db();
      const now = await namespaceNow(sql, params['ns'] as string);
      sendJson(response, 200, { now: now.toISOString(), session_ttl_s: limits.sessionTtlS });
    },
  });
}
