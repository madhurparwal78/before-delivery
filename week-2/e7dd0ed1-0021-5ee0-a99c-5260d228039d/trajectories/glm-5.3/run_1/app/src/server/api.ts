import type { Router } from './http.js';
import { registerApiRoutes } from './api-session.js';
import { registerAccountRoutes } from './api-account.js';
import { registerWorkspaceRoutes } from './api-ws.js';
import { registerObjectRoutes } from './api-objects.js';
import { registerObjectRoutes2 } from './api-objects2.js';
import { registerWorkspaceRoutes2 } from './api-team.js';
import { registerKeyRoutes, registerWebhookRoutes } from './api-keys-webhooks.js';
import { registerEncryptionRoutes, registerAuditRoutes } from './api-audit.js';
import { registerUsageRoutes, registerOpsRoutes } from './api-usage-ops.js';

/** Registers every JSON API route on the router. */
export function registerAll(json: Router): void {
  registerApiRoutes(json);
  registerAccountRoutes(json);
  registerWorkspaceRoutes(json);
  registerObjectRoutes(json);
  registerObjectRoutes2(json);
  registerWorkspaceRoutes2(json);
  registerKeyRoutes(json);
  registerWebhookRoutes(json);
  registerEncryptionRoutes(json);
  registerAuditRoutes(json);
  registerUsageRoutes(json);
  registerOpsRoutes(json);
}
