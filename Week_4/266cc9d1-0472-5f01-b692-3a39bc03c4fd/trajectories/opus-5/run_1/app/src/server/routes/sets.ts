import { Router } from "express";
import { LIMITS } from "../config.js";
import { notFound } from "../errors.js";
import { defineRoute, requireRole, type RouteContext } from "../http.js";
import type { StaffAuth } from "../auth.js";
import { corridorGeometry, requireTenantCorridor, type CorridorRow } from "../domain/corridors.js";
import {
  createFinding,
  deleteFinding,
  findFinding,
  findingPayload,
  listFindings,
  patchFinding,
  reResolveTerrain,
  validateCreate,
  validatePatch,
  validateTerrain,
  type FindingRow,
} from "../domain/findings.js";
import {
  closeSet,
  completeReview,
  createSet,
  findSet,
  regenerateLink,
  resendLink,
  reviewLinkPayload,
  reviseSet,
  revokeLink,
  setPayload,
  submitSet,
  type SetRow,
} from "../domain/sets.js";
import { attemptDelivery } from "../services/mail.js";
import { readEvidence } from "../domain/sets.js";

export const setRouter = Router();

const ANALYST_ONLY = "Only the vegetation analyst may change findings.";

interface SetContext {
  set: SetRow;
  corridor: CorridorRow;
}

async function tenantSet(setId: string, tenantId: string): Promise<SetContext> {
  const set = await findSet(setId);
  if (!set || set.tenant_id !== tenantId) throw notFound();
  const corridor = await requireTenantCorridor(set.corridor_id, tenantId);
  return { set, corridor };
}

interface FindingContext extends SetContext {
  finding: FindingRow;
}

async function tenantFinding(findingId: string, tenantId: string): Promise<FindingContext> {
  const finding = await findFinding(findingId);
  if (!finding) throw notFound();
  const context = await tenantSet(finding.set_id, tenantId);
  return { ...context, finding };
}

setRouter.post(
  "/corridors/:id/findings-sets",
  defineRoute<"staff", CorridorRow>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    load: ({ params, auth }) => requireTenantCorridor(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle({ auth }, corridor) {
      const set = await createSet(auth.staff.tenant_id, corridor.id);
      return { status: 201, body: { set: await setPayload(set) } };
    },
  }),
);

setRouter.get(
  "/findings-sets/:id",
  defineRoute<"staff", SetContext>({
    auth: "staff",
    load: ({ params, auth }) => tenantSet(params.id, auth.staff.tenant_id),
    async handle(_context, { set }) {
      const findings = await listFindings(set.id);
      return {
        status: 200,
        body: { set: await setPayload(set), findings: findings.map(findingPayload) },
      };
    },
  }),
);

setRouter.post(
  "/findings-sets/:id/findings",
  defineRoute<"staff", SetContext>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    load: ({ params, auth }) => tenantSet(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle({ body }, { set, corridor }) {
      const geometry = await corridorGeometry(corridor);
      const input = validateCreate(body, geometry);
      const finding = await createFinding(set.id, geometry, input);
      return { status: 201, body: { finding: findingPayload(finding) } };
    },
  }),
);

setRouter.patch(
  "/findings/:id",
  defineRoute<"staff", FindingContext>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    load: ({ params, auth }) => tenantFinding(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle({ body }, { finding, corridor }) {
      const geometry = await corridorGeometry(corridor);
      const input = validatePatch(body, geometry);
      const updated = await patchFinding(finding, geometry, input);
      return { status: 200, body: { finding: findingPayload(updated) } };
    },
  }),
);

setRouter.delete(
  "/findings/:id",
  defineRoute<"staff", FindingContext>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    load: ({ params, auth }) => tenantFinding(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle(_context, { finding }) {
      await deleteFinding(finding);
      return { status: 204 };
    },
  }),
);

setRouter.post(
  "/findings/:id/terrain",
  defineRoute<"staff", FindingContext>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    load: ({ params, auth }) => tenantFinding(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle({ body }, { finding, corridor }) {
      const geometry = await corridorGeometry(corridor);
      const input = validateTerrain(body);
      const result = await reResolveTerrain(finding, geometry, input);
      return {
        status: 200,
        body: { finding: findingPayload(result.finding), previous: result.previous },
      };
    },
  }),
);

setRouter.post(
  "/findings-sets/:id/submit",
  defineRoute<"staff", SetContext>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    idempotencyRoute: "submit",
    load: ({ params, auth }) => tenantSet(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle({ auth }, { set, corridor }) {
      const result = await submitSet(set, corridor, auth.staff.id);
      const email = await attemptDelivery(result.emailId);
      return {
        status: 200,
        body: {
          set: await setPayload(result.set),
          review_link: await reviewLinkPayload(result.link),
          email,
        },
      };
    },
  }),
);

setRouter.post(
  "/findings-sets/:id/close",
  defineRoute<"staff", SetContext>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    load: ({ params, auth }) => tenantSet(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle(_context, { set }) {
      return { status: 200, body: { set: await setPayload(await closeSet(set)) } };
    },
  }),
);

setRouter.post(
  "/findings-sets/:id/revisions",
  defineRoute<"staff", SetContext>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    load: ({ params, auth }) => tenantSet(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle(_context, { set }) {
      return { status: 201, body: { set: await setPayload(await reviseSet(set)) } };
    },
  }),
);

setRouter.post(
  "/findings-sets/:id/review-link/resend",
  defineRoute<"staff", SetContext>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    idempotencyRoute: "review-link/resend",
    load: ({ params, auth }) => tenantSet(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle(_context, { set, corridor }) {
      const result = await resendLink(set, corridor);
      const email = await attemptDelivery(result.emailId);
      return {
        status: 200,
        body: { review_link: await reviewLinkPayload(result.link), email },
      };
    },
  }),
);

setRouter.post(
  "/findings-sets/:id/review-link/revoke",
  defineRoute<"staff", SetContext>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    load: ({ params, auth }) => tenantSet(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle(_context, { set }) {
      return { status: 200, body: { review_link: await reviewLinkPayload(await revokeLink(set)) } };
    },
  }),
);

setRouter.post(
  "/findings-sets/:id/review-link/regenerate",
  defineRoute<"staff", SetContext>({
    auth: "staff",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    idempotencyRoute: "review-link/regenerate",
    load: ({ params, auth }) => tenantSet(params.id, auth.staff.tenant_id),
    role: ({ auth }) => requireRole(auth, "vegetation_analyst", ANALYST_ONLY),
    async handle(_context, { set, corridor }) {
      const result = await regenerateLink(set, corridor);
      const email = await attemptDelivery(result.emailId);
      return {
        status: 201,
        body: { review_link: await reviewLinkPayload(result.link), email },
      };
    },
  }),
);

setRouter.get(
  "/findings-sets/:id/evidence",
  defineRoute<"staff", SetContext>({
    auth: "staff",
    load: ({ params, auth }) => tenantSet(params.id, auth.staff.tenant_id),
    async handle(_context, { set }) {
      const bytes = await readEvidence(set);
      if (!bytes) throw notFound();
      return {
        status: 200,
        raw: {
          bytes,
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(bytes.byteLength),
            "Cache-Control": "no-transform",
          },
        },
      };
    },
  }),
);
