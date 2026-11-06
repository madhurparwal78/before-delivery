import { Asset, assetDecimals, isAsset, parseAmount } from '../../shared/assets';
import { businessDate } from '../../shared/businesstime';
import { FIELD_COPY } from '../../shared/copy';
import { query } from '../db/pool';
import { isClosed, releaseAllowed } from '../domain/case';
import { failure } from '../http/errors';
import {
  ALL_STAFF,
  BodyContext,
  define,
  Registered,
  Role,
  WorkspaceRecord,
} from '../http/runtime';
import { asRecord, codePoints, FieldCheck, isAddress, readText } from '../http/validate';
import {
  CaseInput,
  closeCase,
  createCase,
  endRequestPage,
  lapseAnswers,
  newRequestPageFor,
  requestPageSendable,
} from '../store/caseengine';
import {
  CaseRow,
  findCase,
  presentArchivedCase,
  presentCase,
  reloadCase,
  statusOf,
} from '../store/cases';
import { findCustomer } from '../store/customers';

const OFFICER: readonly Role[] = ['compliance_officer'];
const OFFICER_ANALYST: readonly Role[] = ['compliance_officer', 'compliance_analyst'];
const OPERATIONS: readonly Role[] = ['operations_lead'];

/** One reading of the case-creation body, shared by the desk and the partner API. */
export async function readCaseCreation(
  context: BodyContext & { workspace: WorkspaceRecord },
): Promise<CaseInput> {
  const body = asRecord(context.body);
  const assetValue = body.asset;
  const amountValue = body.amount;
  const destinationAddress = readText(context.body, 'destinationAddress');
  const customerId = readText(context.body, 'customerId');
  const beneficiaryName = readText(context.body, 'beneficiaryName');
  const check = new FieldCheck();
  const asset: Asset | null = isAsset(assetValue) ? assetValue : null;
  if (asset === null) check.add('asset', 'Choose an asset.');
  let amountScaled: bigint | null = null;
  if (typeof amountValue === 'number') {
    check.add('amount', FIELD_COPY.amountString);
  } else if (typeof amountValue !== 'string') {
    check.add('amount', FIELD_COPY.amount(asset === null ? 18 : assetDecimals(asset)));
  } else if (asset !== null) {
    amountScaled = parseAmount(amountValue, asset);
    if (amountScaled === null) check.add('amount', FIELD_COPY.amount(assetDecimals(asset)));
  }
  if (destinationAddress === null || !isAddress(destinationAddress)) {
    check.add('destinationAddress', FIELD_COPY.address);
  }
  const customer =
    customerId === null ? null : await findCustomer(context.workspace.slug, customerId);
  if (customer === null) check.add('customerId', FIELD_COPY.customerId);
  if (
    beneficiaryName === null ||
    codePoints(beneficiaryName) < 1 ||
    codePoints(beneficiaryName) > 140
  ) {
    check.add('beneficiaryName', FIELD_COPY.beneficiaryName);
  }
  check.settle();
  return {
    asset: asset as Asset,
    amountScaled: amountScaled as bigint,
    destinationAddress: destinationAddress as string,
    customer: customer as NonNullable<typeof customer>,
    beneficiaryName: beneficiaryName as string,
  };
}

async function loadOwnCase(context: { workspace: WorkspaceRecord; now: Date; params: Readonly<Record<string, string>> }): Promise<CaseRow> {
  await lapseAnswers(context.workspace.slug, context.now);
  const row = await findCase(context.workspace.slug, context.params.caseId);
  if (row === null) throw failure('not_found');
  return row;
}

async function caseReply(row: CaseRow, role: Role, now: Date, status = 200): Promise<{
  status: number;
  json: unknown;
}> {
  if (row.archived) return { status, json: { case: presentArchivedCase(row) } };
  return { status, json: { case: await presentCase(row, role, now) } };
}

export const caseRoutes: readonly Registered[] = [
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/cases',
    roles: ALL_STAFF,
    handler: async (context) => {
      await lapseAnswers(context.workspace.slug, context.now);
      const show = context.url.searchParams.get('show') ?? 'open';
      const condition =
        show === 'archived'
          ? 'archived = true'
          : show === 'closed'
            ? "archived = false AND status IN ('released','returned')"
            : "archived = false AND status NOT IN ('released','returned')";
      const rows = await query<CaseRow>(
        `SELECT * FROM cases WHERE workspace_slug = $1 AND ${condition} ORDER BY created_at DESC, reference DESC`,
        [context.workspace.slug],
      );
      const cases = await Promise.all(
        rows.map((row) =>
          row.archived
            ? Promise.resolve(presentArchivedCase(row) as unknown as Record<string, unknown>)
            : presentCase(row, context.member.role, context.now),
        ),
      );
      return { status: 200, json: { cases } };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/cases/:caseId',
    roles: ALL_STAFF,
    load: loadOwnCase,
    handler: async (context) => caseReply(context.loaded, context.member.role, context.now),
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/cases',
    roles: OFFICER_ANALYST,
    content: 'json',
    handler: async (context) => {
      const input = await readCaseCreation(context);
      const row = await createCase(
        context.workspace,
        { kind: 'member', name: context.member.name },
        input,
        context.now,
      );
      return caseReply(row, context.member.role, context.now, 201);
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/cases/:caseId/release',
    roles: OPERATIONS,
    content: 'json',
    load: loadOwnCase,
    handler: async (context) => {
      const row = context.loaded;
      const status = statusOf(row);
      if (isClosed(status)) throw failure('case_closed');
      if (!releaseAllowed(status, row.release_reason_text !== null)) {
        throw failure('release_not_allowed');
      }
      const closed = await closeCase(row, 'released', context.now);
      return caseReply(closed, context.member.role, context.now);
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/cases/:caseId/return',
    roles: OPERATIONS,
    content: 'json',
    load: loadOwnCase,
    handler: async (context) => {
      const row = context.loaded;
      if (isClosed(statusOf(row))) throw failure('case_closed');
      const reason = readText(context.body, 'reason');
      const check = new FieldCheck();
      if (reason === null || codePoints(reason) < 1 || codePoints(reason) > 1000) {
        check.add('reason', FIELD_COPY.reason);
      }
      check.settle();
      const closed = await closeCase(row, 'returned', context.now);
      return caseReply(closed, context.member.role, context.now);
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/cases/:caseId/release-reason',
    roles: OFFICER,
    content: 'json',
    load: loadOwnCase,
    handler: async (context) => {
      const row = context.loaded;
      if (statusOf(row) !== 'no_response') throw failure('reason_not_needed');
      const reason = readText(context.body, 'reason');
      const check = new FieldCheck();
      if (reason === null || codePoints(reason) < 1 || codePoints(reason) > 1000) {
        check.add('reason', FIELD_COPY.reason);
      }
      check.settle();
      await query(
        `UPDATE cases SET release_reason_text = $2, release_reason_by = $3, release_reason_at = $4
         WHERE id = $1`,
        [row.id, reason, context.member.name, context.now],
      );
      return caseReply(await reloadCase(row.id), context.member.role, context.now);
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/cases/:caseId/ownership',
    roles: OFFICER_ANALYST,
    content: 'json',
    load: loadOwnCase,
    handler: async (context) => {
      const row = context.loaded;
      if (statusOf(row) !== 'awaiting_ownership') throw failure('ownership_not_pending');
      const confirmedOn = readText(context.body, 'confirmedOn');
      const today = businessDate(context.now, context.workspace.timeZone);
      const caseDate = businessDate(row.created_at, context.workspace.timeZone);
      const check = new FieldCheck();
      if (confirmedOn === null || confirmedOn > today || confirmedOn < caseDate) {
        check.add('confirmedOn', 'Choose a date from the case date up to today.');
      }
      check.settle();
      await query(
        `UPDATE cases SET status = 'cleared', ownership_confirmed_on = $2,
           ownership_recorded_at = $3, ownership_recorded_by = $4 WHERE id = $1`,
        [row.id, confirmedOn, context.now, context.member.name],
      );
      return caseReply(await reloadCase(row.id), context.member.role, context.now);
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/cases/:caseId/request-page',
    roles: OFFICER_ANALYST,
    content: 'json',
    load: loadOwnCase,
    handler: async (context) => {
      const row = context.loaded;
      if (isClosed(statusOf(row)) || !requestPageSendable(row)) {
        throw failure('request_page_not_open');
      }
      const updated = await newRequestPageFor(context.workspace, row, context.now);
      return caseReply(updated, context.member.role, context.now, 201);
    },
  }),
  define({
    kind: 'staff',
    method: 'DELETE',
    path: '/api/w/:slug/cases/:caseId/request-page',
    roles: OFFICER_ANALYST,
    load: loadOwnCase,
    handler: async (context) => {
      const updated = await endRequestPage(context.loaded, context.now);
      return caseReply(updated, context.member.role, context.now);
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/cases/:caseId/archive',
    roles: OFFICER,
    content: 'json',
    load: loadOwnCase,
    handler: async (context) => {
      const row = context.loaded;
      if (!isClosed(statusOf(row)) || row.archived) throw failure('case_not_closed');
      await query('UPDATE cases SET archived = true, archived_at = $2 WHERE id = $1', [
        row.id,
        context.now,
      ]);
      return { status: 200, json: { case: presentArchivedCase(await reloadCase(row.id)) } };
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/cases/:caseId/restore',
    roles: OFFICER,
    content: 'json',
    load: loadOwnCase,
    handler: async (context) => {
      const row = context.loaded;
      if (!row.archived) throw failure('case_not_archived');
      await query('UPDATE cases SET archived = false, archived_at = NULL WHERE id = $1', [row.id]);
      const restored = await reloadCase(row.id);
      return { status: 200, json: { case: await presentCase(restored, context.member.role, context.now) } };
    },
  }),
];
