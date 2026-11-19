// Grants and proofs: listing, revocation, proof upload and review (brief: Grants and proofs).
import { config } from "../config.ts";
import { Denied, withDenialAudit } from "../denial.ts";
import { transaction, type Tx } from "../db.ts";
import { ApiError, STORAGE_MESSAGES, forbidden, notFound, storageUnavailable, wrongState } from "../errors.ts";
import { created, ok, type Ctx, type Reply, type Router } from "../http.ts";
import { grantStatusLabel, grantView, holderPrincipals, visibleStatus, type GrantRow } from "../grants.ts";
import { personOf } from "../requestWorkflow.ts";
import { PNG_SIGNATURE } from "../images.ts";
import { StorageUnavailable, proofKey, putObject, readObject } from "../storage.ts";
import { localDate } from "../../shared/dates.ts";
import type { GrantView } from "../../shared/api.ts";
import { REVIEW_ROLES, type ProofStatus } from "../../shared/domain.ts";
import type { Principal } from "../../shared/api.ts";

const PROOF_CEILING = 32 * 1024 * 1024;

interface ProofRow {
  id: string;
  grant_id: string;
  file_name: string;
  status: ProofStatus;
  reason: string | null;
  uploaded_at: string;
}

const isStaff = (p: Principal): boolean => p.role === "owner" || p.role === "legal_reviewer";

async function holds(tx: Tx, principal: Principal, grant: GrantRow): Promise<boolean> {
  return (await holderPrincipals(tx, grant)).includes(principal.id);
}

/** A grant is visible to its holder (or a member of the holding group), the owner and legal reviewers. */
async function visibleGrant(tx: Tx, principal: Principal, id: string, lock = false): Promise<GrantRow> {
  const grant = await tx.one<GrantRow>(`SELECT * FROM grants WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  if (!grant || !(isStaff(principal) || (await holds(tx, principal, grant)))) throw notFound();
  return grant;
}

/** Live messages for a change to a grant: its holders, the owner and legal reviewers, the request page and libraries. */
async function announceGrant(tx: Tx, grant: GrantRow): Promise<void> {
  const holders = await holderPrincipals(tx, grant);
  tx.live({ type: "grant.updated", grantId: grant.id }, { roles: ["owner", "legal_reviewer"], principals: holders });
  tx.live({ type: "library.updated" }, { all: true });
  if (grant.request_id) {
    const requester = (await tx.one<{ requester_id: string }>("SELECT requester_id FROM requests WHERE id = $1", [grant.request_id]))!;
    tx.live({ type: "request.updated", requestId: grant.request_id }, { roles: REVIEW_ROLES, principals: [requester.requester_id] });
  }
}

async function proofContext(tx: Tx, principal: Principal, id: string): Promise<{ proof: ProofRow; grant: GrantRow }> {
  const owner = await tx.one<{ grant_id: string }>("SELECT grant_id FROM proofs WHERE id = $1", [id]);
  const grant = owner && (await tx.one<GrantRow>("SELECT * FROM grants WHERE id = $1 FOR UPDATE", [owner.grant_id]));
  const proof = grant && (await tx.one<ProofRow>("SELECT * FROM proofs WHERE id = $1", [id]));
  if (!proof || !grant || !(REVIEW_ROLES.includes(principal.role) || (grant.holder_type === "principal" && grant.holder_id === principal.id))) throw notFound();
  return { proof, grant };
}

const proofType = (bytes: Buffer): string | null => {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
};

const megabytes = (bytes: number): string => String(Number((bytes / 1_048_576).toFixed(2)));

async function uploadProof(ctx: Ctx): Promise<Reply> {
  const user = ctx.user();
  return transaction(async (tx) => {
    const grant = await visibleGrant(tx, user, ctx.params.id, true);
    if (grant.holder_type !== "principal" || grant.holder_id !== user.id) throw forbidden();
    const waiting = await tx.one("SELECT 1 FROM proofs WHERE grant_id = $1 AND status = 'pending_review'", [grant.id]);
    if (visibleStatus(grant, tx.now) !== "pending_proof" || waiting) {
      throw wrongState(`${grant.id} is ${grantStatusLabel(grant, tx.now)}.`);
    }
    const upload = await ctx.upload(PROOF_CEILING);
    const tooBig = new ApiError(413, "proof_too_large", `Proof must be ${megabytes(config.proofMaxBytes)} MB or smaller.`);
    if (upload?.fields.exceeded) throw tooBig;
    const contentType = upload && proofType(upload.bytes);
    if (!upload || !contentType) throw new ApiError(422, "proof_type", "Proof must be a PNG, JPEG or PDF file.");
    if (upload.bytes.length > config.proofMaxBytes) throw tooBig;
    const id = `PRF-${String(await tx.next("proof")).padStart(4, "0")}`;
    try {
      await putObject(proofKey(grant.id, id), upload.bytes, contentType);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw storageUnavailable(STORAGE_MESSAGES.proof);
      throw error;
    }
    await tx.q("INSERT INTO proofs (id, grant_id, file_name, status, uploaded_at) VALUES ($1,$2,$3,'pending_review',$4)", [id, grant.id, upload.fileName, tx.now]);
    tx.audit({
      actorId: user.id,
      actorRole: user.role,
      action: "proof.uploaded",
      resourceType: "proof",
      resourceId: id,
      requestId: grant.request_id,
      before: null,
      after: { fileName: upload.fileName, status: "pending_review" },
    });
    await announceGrant(tx, grant);
    return created({ id, fileName: upload.fileName, status: "pending_review", uploadedAt: tx.now });
  });
}

async function proofContent(ctx: Ctx): Promise<Reply> {
  const user = ctx.user();
  const { proof, grant } = await transaction((tx) => proofContext(tx, user, ctx.params.id));
  try {
    const bytes = await readObject(proofKey(grant.id, proof.id));
    if (!bytes) throw notFound();
    return { status: 200, raw: bytes, headers: { "content-type": proofType(bytes) ?? "application/octet-stream", "content-disposition": `inline; filename="${proof.file_name.replace(/"/g, "")}"` } };
  } catch (error) {
    if (error instanceof StorageUnavailable) throw storageUnavailable(STORAGE_MESSAGES.proof);
    throw error;
  }
}

/** Accepting or rejecting: reviewers only, and only for a pending proof on a grant still waiting for one. */
async function reviewProof(ctx: Ctx, accept: boolean): Promise<Reply> {
  const user = ctx.user();
  return transaction(async (tx) => {
    const { proof, grant } = await proofContext(tx, user, ctx.params.id);
    if (!REVIEW_ROLES.includes(user.role)) throw forbidden();
    if (proof.status !== "pending_review" || grant.status !== "pending_proof") throw wrongState(`${grant.id} is ${grantStatusLabel(grant, tx.now)}.`);
    const actor = { actorId: user.id, actorRole: user.role, requestId: grant.request_id };
    if (accept) {
      const today = localDate(tx.now, config.timeZone);
      await tx.q("UPDATE proofs SET status = 'accepted' WHERE id = $1", [proof.id]);
      await tx.q("UPDATE grants SET status = 'active', not_before = $2 WHERE id = $1", [grant.id, today]);
      tx.audit({ ...actor, action: "proof.accepted", resourceType: "proof", resourceId: proof.id, before: { status: "pending_review" }, after: { status: "accepted" } });
      tx.audit({ ...actor, action: "grant.activated", resourceType: "grant", resourceId: grant.id, before: { status: "pending_proof" }, after: { notBefore: today, status: "active" } });
    } else {
      const body = await ctx.json();
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason) throw new ApiError(422, "reason_required", "Give a reason.");
      await tx.q("UPDATE proofs SET status = 'rejected', reason = $2 WHERE id = $1", [proof.id, reason]);
      tx.audit({ ...actor, action: "proof.rejected", resourceType: "proof", resourceId: proof.id, before: { status: "pending_review" }, after: { reason, status: "rejected" } });
    }
    await announceGrant(tx, grant);
    return ok(await grantView(tx, (await tx.one<GrantRow>("SELECT * FROM grants WHERE id = $1", [grant.id]))!));
  });
}

async function revoke(ctx: Ctx): Promise<Reply> {
  const user = ctx.user();
  return withDenialAudit(async (tx) => {
    const grant = await visibleGrant(tx, user, ctx.params.id, true);
    if (!isStaff(user)) {
      throw new Denied("forbidden", "You can't do that.", { actorId: user.id, actorRole: user.role, action: "grant.revoked", resourceType: "grant", resourceId: grant.id, requestId: grant.request_id });
    }
    if (grant.status !== "active" && grant.status !== "pending_proof") throw wrongState(`${grant.id} is ${grantStatusLabel(grant, tx.now)}.`);
    if (visibleStatus(grant, tx.now) === "expired") throw wrongState(`${grant.id} is ${grantStatusLabel(grant, tx.now)}.`);
    const body = await ctx.json();
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) throw new ApiError(422, "reason_required", "Give a reason.");
    await tx.q("UPDATE grants SET status = 'revoked', revoked_reason = $2 WHERE id = $1", [grant.id, reason]);
    tx.audit({
      actorId: user.id,
      actorRole: user.role,
      action: "grant.revoked",
      resourceType: "grant",
      resourceId: grant.id,
      requestId: grant.request_id,
      before: { status: grant.status },
      after: { reason, status: "revoked" },
    });
    for (const holderId of await holderPrincipals(tx, grant)) {
      const person = await personOf(tx, holderId);
      const link = grant.request_id ? `\n\n${config.publicUrl}/requests/${grant.request_id}` : "";
      await tx.mail(person.email, `Grant ${grant.id} revoked`, `${reason}${link}\n`);
    }
    await announceGrant(tx, grant);
    return ok(await grantView(tx, (await tx.one<GrantRow>("SELECT * FROM grants WHERE id = $1", [grant.id]))!));
  });
}

export function registerGrants(router: Router): void {
  router.get("/api/grants", async (ctx) => {
    const user = ctx.user();
    if (!isStaff(user) && user.role !== "agency" && user.role !== "press") throw forbidden();
    return transaction(async (tx) => {
      const own = await tx.q<GrantRow>(
        `SELECT g.* FROM grants g WHERE $1 OR g.holder_id = $2
            OR g.holder_id IN (SELECT group_id FROM group_members WHERE principal_id = $2) ORDER BY g.id`,
        [isStaff(user), user.id],
      );
      // One at a time: every query here shares the transaction's single connection.
      const grants: GrantView[] = [];
      for (const grant of own) grants.push(await grantView(tx, grant));
      return ok({ grants });
    });
  });
  router.get("/api/grants/:id", async (ctx) => {
    const user = ctx.user();
    return transaction(async (tx) => ok(await grantView(tx, await visibleGrant(tx, user, ctx.params.id))));
  });
  router.post("/api/grants/:id/revoke", revoke);
  router.post("/api/grants/:id/proofs", uploadProof);
  router.get("/api/proofs/:id/content", proofContent);
  router.post("/api/proofs/:id/accept", (ctx) => reviewProof(ctx, true));
  router.post("/api/proofs/:id/reject", (ctx) => reviewProof(ctx, false));
}
