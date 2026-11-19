import { ASSET_CLASS_LABELS, GRANT_STATUS_LABELS } from '../../shared/labels.js';
import type { Badge, GrantSummary, LibraryCard } from '../../shared/types.js';
import { db, type Queryable } from '../db.js';
import { buildCards, cardNameFor, type Card } from '../domain/cards.js';
import { decideAvailability, effectiveGrantStatus, type AvailabilityDecision } from '../domain/availability.js';
import type { ConditionRecord, DerivativeRecord, GrantRecord, LicenceRecord, Viewer } from '../domain/records.js';
import { OPEN_REQUEST_STATES } from '../domain/transitions.js';
import { repo } from '../repo.js';

export interface CardDecision {
  card: Card;
  decision: AvailabilityDecision;
  licence: LicenceRecord;
  derivatives: DerivativeRecord[];
}

interface Catalogue {
  cards: Card[];
  licences: Map<string, LicenceRecord>;
  derivatives: DerivativeRecord[];
  assetNames: Map<string, string>;
  successorNames: Map<string, string | null>;
}

async function loadCatalogue(source: Queryable): Promise<Catalogue> {
  const [assets, variants, licences, derivatives] = await Promise.all([
    repo.assets(source),
    repo.variants(source),
    repo.licences(source),
    repo.derivatives(source),
  ]);
  const assetNames = new Map(assets.map((asset) => [asset.id, asset.name]));
  const successorNames = new Map(
    assets.map((asset) => [asset.id, asset.successorId ? (assetNames.get(asset.successorId) ?? null) : null]),
  );
  return {
    cards: buildCards(assets, variants),
    licences: new Map(licences.map((licence) => [licence.id, licence])),
    derivatives,
    assetNames,
    successorNames,
  };
}

async function openRequestsByCard(viewer: Viewer, source: Queryable): Promise<Map<string, string>> {
  const requests = await repo.requestsOf(viewer.principal.id, source);
  const map = new Map<string, string>();
  for (const request of requests) {
    if (!OPEN_REQUEST_STATES.includes(request.state)) continue;
    map.set(cardKey(request.assetId, request.variantId), request.id);
  }
  return map;
}

export function cardKey(assetId: string, variantId: string | null): string {
  return `${assetId}|${variantId ?? ''}`;
}

export async function decideAllCards(
  viewer: Viewer,
  now: Date,
  source: Queryable = db,
): Promise<CardDecision[]> {
  const catalogue = await loadCatalogue(source);
  const viewerGrants = await repo.grantsForViewer(viewer, source);
  const openRequests = await openRequestsByCard(viewer, source);

  return catalogue.cards.map((card) => decideOne(card, catalogue, viewer, now, viewerGrants, openRequests));
}

export async function decideOneCard(
  viewer: Viewer,
  now: Date,
  assetId: string,
  variantId: string | null,
  source: Queryable = db,
): Promise<CardDecision | null> {
  const catalogue = await loadCatalogue(source);
  const card = catalogue.cards.find(
    (candidate) => candidate.assetId === assetId && candidate.variantId === variantId,
  );
  if (!card) return null;
  const viewerGrants = await repo.grantsForViewer(viewer, source);
  const openRequests = await openRequestsByCard(viewer, source);
  return decideOne(card, catalogue, viewer, now, viewerGrants, openRequests);
}

function decideOne(
  card: Card,
  catalogue: Catalogue,
  viewer: Viewer,
  now: Date,
  viewerGrants: GrantRecord[],
  openRequests: Map<string, string>,
): CardDecision {
  const licence = catalogue.licences.get(card.asset.licenceId);
  if (!licence) throw new Error(`Licence ${card.asset.licenceId} is missing`);
  const decision = decideAvailability({
    now,
    viewer,
    card,
    licence,
    successorName: catalogue.successorNames.get(card.assetId) ?? null,
    viewerGrants,
    openRequestId: openRequests.get(cardKey(card.assetId, card.variantId)) ?? null,
  });
  const derivatives = catalogue.derivatives.filter(
    (derivative) => derivative.assetId === card.assetId && derivative.variantId === card.variantId,
  );
  return { card, decision, licence, derivatives };
}

export async function loadCard(
  assetId: string,
  variantId: string | null,
  source: Queryable = db,
): Promise<Card | null> {
  const asset = await repo.asset(assetId, source);
  if (!asset) return null;
  const variant = variantId === null ? null : await repo.variant(variantId, source);
  if (variantId !== null && (!variant || variant.assetId !== assetId)) return null;
  return {
    assetId,
    variantId,
    cardName: cardNameFor(asset, variant),
    asset,
    variant,
  };
}

export async function grantSummary(
  grant: GrantRecord,
  now: Date,
  source: Queryable = db,
): Promise<GrantSummary> {
  const conditions = await repo.conditionsOfGrant(grant.id, source);
  return grantSummaryWith(grant, conditions, now);
}

export function grantSummaryWith(grant: GrantRecord, conditions: ConditionRecord[], now: Date): GrantSummary {
  const status = effectiveGrantStatus(grant, now);
  return {
    id: grant.id,
    status,
    statusLabel: GRANT_STATUS_LABELS[status],
    notBefore: grant.notBefore,
    notAfter: grant.notAfter,
    conditions: conditions.map((condition) => ({ kind: condition.kind, text: condition.text })),
  };
}

export async function projectLibraryCard(
  entry: CardDecision,
  viewer: Viewer,
  now: Date,
  source: Queryable = db,
): Promise<LibraryCard> {
  const { card, decision, licence, derivatives } = entry;
  const successorName =
    card.asset.successorId === null ? null : ((await repo.asset(card.asset.successorId, source))?.name ?? null);
  return {
    assetId: card.assetId,
    variantId: card.variantId,
    cardName: card.cardName,
    classLabel: ASSET_CLASS_LABELS[card.asset.assetClass],
    licenceName: licence.name,
    badge: decision.badge,
    reason: decision.reason,
    successorName,
    canRequest: viewer.principal.role === 'agency' ? decision.canRequest : false,
    requestReason: decision.requestReason,
    openRequestId: decision.openRequestId,
    derivatives:
      decision.badge === 'Available'
        ? derivatives.map((derivative) => ({
            id: derivative.id,
            fileName: derivative.fileName,
            format: derivative.format,
            width: derivative.width,
            height: derivative.height,
          }))
        : [],
    grant: decision.grant ? await grantSummary(decision.grant, now, source) : null,
  };
}

export interface LibraryFilters {
  assetClass: string | null;
  badges: string[];
  query: string | null;
}

export function matchesFilters(card: LibraryCard, assetClassKey: string, filters: LibraryFilters): boolean {
  if (filters.assetClass !== null && filters.assetClass !== assetClassKey) return false;
  if (filters.badges.length > 0 && !filters.badges.includes(card.badge as Badge)) return false;
  if (filters.query !== null && filters.query !== '') {
    const needle = filters.query.toLowerCase();
    const matches =
      card.cardName.toLowerCase().includes(needle) || card.classLabel.toLowerCase().includes(needle);
    if (!matches) return false;
  }
  return true;
}
