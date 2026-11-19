// The availability decision: one six-step server decision for every (viewer, asset, variant) at the app clock
// (brief: Business rules / Availability decision). Library reads, link issue, link use and request creation all call it.
import type { Tx } from "./db.ts";
import { config } from "./config.ts";
import { endOfDay, formatCalendarDate, startOfDay } from "../shared/dates.ts";
import {
  ASSET_CLASS_LABELS,
  AUDIENCE_PLURALS,
  OPEN_REQUEST_STATES,
  audienceOf,
  type Audience,
  type AssetClass,
  type AssetState,
  type Badge,
  type ConditionKind,
  type GrantStatus,
} from "../shared/domain.ts";
import { GRANT_STATUS_LABELS } from "../shared/domain.ts";
import type { CardDerivative, CardGrant, LibraryCard, Principal } from "../shared/api.ts";

interface Viewer {
  principal: Principal;
  audience: Audience;
  organisationTerritory: string;
  engagementEndsOn: string | null;
  groupIds: string[];
}

async function viewerOf(tx: Tx, principal: Principal): Promise<Viewer> {
  const org = (await tx.one<{ territory: string; engagement_ends_on: string | null }>(
    "SELECT territory, engagement_ends_on FROM organisations WHERE id = $1", [principal.organisationId]))!;
  const groups = await tx.q<{ group_id: string }>("SELECT group_id FROM group_members WHERE principal_id = $1", [principal.id]);
  return {
    principal,
    audience: audienceOf(principal.role),
    organisationTerritory: org.territory,
    engagementEndsOn: org.engagement_ends_on,
    groupIds: groups.map((g) => g.group_id),
  };
}

interface AssetRow {
  id: string;
  name: string;
  class: AssetClass;
  state: AssetState;
  successor_name: string | null;
  licence_name: string;
  audiences: Audience[];
  excluded_territories: string[];
}
interface VariantRow { id: string; asset_id: string; label: string }
interface DerivativeRow { id: string; asset_id: string; variant_id: string | null; file_name: string; format: "png" | "svg"; width: number; height: number }
interface GrantRow {
  id: string;
  holder_type: "principal" | "group";
  holder_id: string;
  asset_id: string;
  variant_id: string | null;
  not_before: string | null;
  not_after: string;
  status: GrantStatus;
}
interface OpenRequestRow { id: string; asset_id: string; variant_id: string | null }

/** A grant covers a card for its holder exactly when it is active and the app clock is inside its window. */
function covers(grant: GrantRow, now: string): boolean {
  if (grant.status !== "active") return false;
  const from = grant.not_before ? startOfDay(grant.not_before, config.timeZone) : null;
  return (from === null || from <= now) && now <= endOfDay(grant.not_after, config.timeZone);
}

interface CardSource {
  asset: AssetRow;
  variant: VariantRow | null;
  derivatives: DerivativeRow[];
}

/** Everything the decision needs about one viewer, loaded in a handful of queries. */
interface DecisionData {
  viewer: Viewer;
  now: string;
  grants: GrantRow[];
  grantConditions: Map<string, { kind: ConditionKind; text: string }[]>;
  openRequests: OpenRequestRow[];
}

async function decisionData(tx: Tx, viewer: Viewer): Promise<DecisionData> {
  const holders = [viewer.principal.id, ...viewer.groupIds];
  const grants = await tx.q<GrantRow>(
    `SELECT id, holder_type, holder_id, asset_id, variant_id, not_before, not_after, status FROM grants WHERE holder_id = ANY($1) ORDER BY id`,
    [holders],
  );
  const conditions = await tx.q<{ grant_id: string; kind: ConditionKind; text: string }>(
    "SELECT grant_id, kind, text FROM grant_conditions WHERE grant_id = ANY($1) ORDER BY position",
    [grants.map((g) => g.id)],
  );
  const grantConditions = new Map<string, { kind: ConditionKind; text: string }[]>();
  for (const c of conditions) grantConditions.set(c.grant_id, [...(grantConditions.get(c.grant_id) ?? []), { kind: c.kind, text: c.text }]);
  const openRequests = await tx.q<OpenRequestRow>(
    "SELECT id, asset_id, variant_id FROM requests WHERE requester_id = $1 AND state = ANY($2) ORDER BY id",
    [viewer.principal.id, OPEN_REQUEST_STATES],
  );
  return { viewer, now: tx.now, grants, grantConditions, openRequests };
}

interface Decision {
  badge: Badge;
  reason: string | null;
  /** The covering grant, or "implicit" for an employee's implicit grant on a released asset. */
  coveredBy: string | null;
  canRequest: boolean;
  requestReason: string | null;
}

/** The six steps; the first matching step wins. */
function decide(data: DecisionData, source: CardSource): Decision {
  const { viewer, now } = data;
  const { asset, variant } = source;
  const none = { coveredBy: null, canRequest: false, requestReason: null };
  const plural = AUDIENCE_PLURALS[viewer.audience];

  if (asset.state === "retired") {
    return { badge: "Retired", reason: asset.successor_name ? `Retired. Use ${asset.successor_name} instead.` : "Retired.", ...none };
  }
  if (asset.state === "restricted") return { badge: "Restricted", reason: "Restricted by the brand team.", ...none };

  if (!asset.audiences.includes(viewer.audience)) return { badge: "Restricted", reason: `Not licensed for ${plural}.`, ...none };
  if (asset.excluded_territories.includes(viewer.organisationTerritory)) {
    return { badge: "Restricted", reason: `Not licensed in ${viewer.organisationTerritory}.`, ...none };
  }
  if (viewer.audience === "agency" && viewer.engagementEndsOn && endOfDay(viewer.engagementEndsOn, config.timeZone) < now) {
    return { badge: "Restricted", reason: `Your engagement ended on ${formatCalendarDate(viewer.engagementEndsOn)}.`, ...none };
  }

  const onCard = (g: GrantRow): boolean => g.asset_id === asset.id && g.variant_id === (variant?.id ?? null);
  const covering = data.grants.filter(onCard).filter((g) => covers(g, now)).sort((a, b) => (a.not_after < b.not_after ? 1 : -1))[0];
  if (covering) return { badge: "Available", reason: null, coveredBy: covering.id, canRequest: false, requestReason: null };
  if (viewer.audience === "employee") return { badge: "Available", reason: null, coveredBy: "implicit", canRequest: false, requestReason: null };

  if (viewer.principal.role === "agency") {
    const open = data.openRequests.find((r) => r.asset_id === asset.id && r.variant_id === (variant?.id ?? null));
    const pending = data.grants.find((g) => onCard(g) && g.status === "pending_proof");
    const requestReason = open ? `You already have ${open.id} open.` : pending ? `Upload your proof for ${pending.id} first.` : null;
    return { badge: "Request required", reason: "Request use to download.", coveredBy: null, canRequest: requestReason === null, requestReason };
  }
  return { badge: "Restricted", reason: `Not licensed for ${plural}.`, ...none };
}

/** The card name as SQL over aliases `a` (asset) and `v` (variant, possibly null): one rule beside `cardName`. */
export const CARD_NAME_SQL = "CASE WHEN v.id IS NULL THEN a.name ELSE a.name || ' — ' || v.label END";

const cardName = (source: CardSource): string => (source.variant ? `${source.asset.name} — ${source.variant.label}` : source.asset.name);

/** Every card that exists for released, restricted and retired assets, one per variant (drafts have no card). */
async function cardSources(tx: Tx): Promise<CardSource[]> {
  const assets = await tx.q<AssetRow>(
    `SELECT a.id, a.name, a.class, a.state, s.name AS successor_name, l.name AS licence_name, l.audiences, l.excluded_territories
       FROM assets a JOIN licences l ON l.id = a.licence_id LEFT JOIN assets s ON s.id = a.successor_id
      WHERE a.state <> 'draft' ORDER BY a.position`,
  );
  const variants = await tx.q<VariantRow>("SELECT id, asset_id, label FROM variants ORDER BY asset_id, position");
  const derivatives = await tx.q<DerivativeRow>(
    "SELECT id, asset_id, variant_id, file_name, format, width, height FROM derivatives ORDER BY asset_id, position",
  );
  return assets.flatMap((asset): CardSource[] => {
    const own = variants.filter((v) => v.asset_id === asset.id);
    if (own.length === 0) return [{ asset, variant: null, derivatives: derivatives.filter((d) => d.asset_id === asset.id && d.variant_id === null) }];
    return own.map((variant) => ({ asset, variant, derivatives: derivatives.filter((d) => d.variant_id === variant.id) }));
  });
}

const toCardDerivative = (d: DerivativeRow): CardDerivative => ({ id: d.id, fileName: d.file_name, format: d.format, width: d.width, height: d.height });

function cardGrant(data: DecisionData, source: CardSource, decision: Decision): CardGrant | null {
  const onCard = (g: GrantRow): boolean => g.asset_id === source.asset.id && g.variant_id === (source.variant?.id ?? null);
  const grant =
    (decision.coveredBy && decision.coveredBy !== "implicit" ? data.grants.find((g) => g.id === decision.coveredBy) : undefined) ??
    data.grants.find((g) => onCard(g) && g.status === "pending_proof");
  if (!grant) return null;
  return {
    id: grant.id,
    status: grant.status,
    statusLabel: GRANT_STATUS_LABELS[grant.status],
    notBefore: grant.not_before,
    notAfter: grant.not_after,
    conditions: data.grantConditions.get(grant.id) ?? [],
  };
}

function toCard(data: DecisionData, source: CardSource): LibraryCard {
  const decision = decide(data, source);
  return {
    assetId: source.asset.id,
    variantId: source.variant?.id ?? null,
    cardName: cardName(source),
    classLabel: ASSET_CLASS_LABELS[source.asset.class],
    licenceName: source.asset.licence_name,
    badge: decision.badge,
    reason: decision.reason,
    successorName: source.asset.state === "retired" ? source.asset.successor_name : null,
    canRequest: decision.canRequest,
    requestReason: decision.requestReason,
    openRequestId: data.openRequests.find((r) => r.asset_id === source.asset.id && r.variant_id === (source.variant?.id ?? null))?.id ?? null,
    derivatives: decision.badge === "Available" ? source.derivatives.map(toCardDerivative) : [],
    grant: cardGrant(data, source, decision),
  };
}

/** All cards for one viewer, in code point order of card name. */
export async function libraryFor(tx: Tx, principal: Principal): Promise<LibraryCard[]> {
  const data = await decisionData(tx, await viewerOf(tx, principal));
  return (await cardSources(tx))
    .map((source) => toCard(data, source))
    .sort((a, b) => (a.cardName < b.cardName ? -1 : a.cardName > b.cardName ? 1 : 0));
}

/** One card by asset and variant id, or null when no such card exists (a draft asset has none). */
export async function cardOf(tx: Tx, principal: Principal, assetId: string, variantId: string | null): Promise<LibraryCard | null> {
  const data = await decisionData(tx, await viewerOf(tx, principal));
  const source = (await cardSources(tx)).find((s) => s.asset.id === assetId && (s.variant?.id ?? null) === variantId);
  return source ? toCard(data, source) : null;
}

/** The decision for the card holding a derivative, for link issue and link use. Null when the derivative has no card. */
export async function accessToDerivative(tx: Tx, principal: Principal, derivativeId: string): Promise<{ decision: Decision; derivative: CardDerivative; assetId: string; variantKey: string | null; fileName: string } | null> {
  const data = await decisionData(tx, await viewerOf(tx, principal));
  const source = (await cardSources(tx)).find((s) => s.derivatives.some((d) => d.id === derivativeId));
  if (!source) return null;
  const derivative = source.derivatives.find((d) => d.id === derivativeId)!;
  const variantKey = source.variant ? (await tx.one<{ key: string }>("SELECT key FROM variants WHERE id = $1", [source.variant.id]))!.key : null;
  return { decision: decide(data, source), derivative: toCardDerivative(derivative), assetId: source.asset.id, variantKey, fileName: derivative.file_name };
}

