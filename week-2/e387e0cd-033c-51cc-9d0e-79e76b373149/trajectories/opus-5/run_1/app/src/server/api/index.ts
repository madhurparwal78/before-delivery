import { businessDate, toInstant } from '../../shared/businesstime';
import { ALL_STAFF, define, Registered, RouteTable } from '../http/runtime';
import { caseRoutes } from './cases';
import { counterpartyRoutes } from './counterparties';
import { fileRoutes } from './files';
import { listingRoutes } from './listing';
import { memberRoutes } from './members';
import { messageRoutes } from './messages';
import { monthRoutes } from './months';
import { partnerRoutes } from './partner';
import { publicDirectoryRoutes } from './publicdirectory';
import { requestPageRoutes } from './requestpages';
import { reviewRoutes } from './review';
import { ruleRoutes } from './rules';
import { sessionRoutes } from './session';

const coreRoutes: readonly Registered[] = [
  define({
    kind: 'public',
    method: 'GET',
    path: '/api/health',
    handler: async () => ({ status: 200, json: { status: 'ok' } }),
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug',
    roles: ALL_STAFF,
    handler: async (context) => ({
      status: 200,
      json: {
        workspace: {
          slug: context.workspace.slug,
          name: context.workspace.name,
          legalName: context.workspace.legalName,
          lei: context.workspace.lei,
          jurisdictionCode: context.workspace.jurisdictionCode,
          timeZone: context.workspace.timeZone,
          city: context.workspace.city,
          currency: context.workspace.currency,
          confirmationLimitCents: context.workspace.confirmationLimitCents,
          today: businessDate(context.now, context.workspace.timeZone),
          now: toInstant(context.now),
        },
      },
    }),
  }),
];

export function buildRouteTable(): RouteTable {
  const table = new RouteTable();
  table.add(...coreRoutes);
  table.add(...sessionRoutes);
  table.add(...memberRoutes);
  table.add(...publicDirectoryRoutes);
  table.add(...listingRoutes);
  table.add(...ruleRoutes);
  table.add(...counterpartyRoutes);
  table.add(...caseRoutes);
  table.add(...reviewRoutes);
  table.add(...messageRoutes);
  table.add(...requestPageRoutes);
  table.add(...monthRoutes);
  table.add(...fileRoutes);
  table.add(...partnerRoutes);
  return table;
}
