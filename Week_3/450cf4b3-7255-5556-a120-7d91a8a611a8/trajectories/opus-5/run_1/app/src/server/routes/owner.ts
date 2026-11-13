import { query, queryOne, transactionNow, withTransaction, type Db } from '../db';
import { instantOfKitchenLocal, kitchenDate, kitchenTimeZone } from '../kitchen-time';
import { serverMessage } from '../../shared/copy';
import { coversDate, currentDocuments } from '../domain/documents';
import { tenantById, tenantStanding, TENANT_COLUMNS, type TenantRow } from '../domain/tenants';
import { conflict, notFound } from '../http/errors';
import { readDateQuery } from '../http/validate';
import { loadStations, tenantDetailView, tenantView } from '../views';
import type { Ctx, Reply, Route } from '../http/route';
import type { ReportResponse, ReportStationRow, ReportTenantRow } from '../../shared/types';

const REPORT_STATUSES = ['confirmed', 'checked_in', 'completed', 'no_show'];

async function tenantOr404(ctx: Ctx, client: Db): Promise<void> {
  const tenant = await queryOne<{ id: string }>(client, 'select id from tenants where id = $1', [
    ctx.params.id ?? '',
  ]);
  if (tenant === null) throw notFound();
}

const listTenants: Route = {
  method: 'GET',
  pattern: '/api/tenants',
  roles: ['owner'],
  handler: async (): Promise<Reply> =>
    withTransaction(async (client) => {
      const now = await transactionNow(client);
      const today = kitchenDate(now);
      const tenants = await query<TenantRow>(
        client,
        `select ${TENANT_COLUMNS} from tenants order by business_name`,
      );
      const views = [];
      for (const tenant of tenants) views.push(await tenantView(client, tenant, today));
      return { status: 200, body: { tenants: views } };
    }),
};

const tenantDetail: Route = {
  method: 'GET',
  pattern: '/api/tenants/:id',
  roles: ['owner'],
  resolve: tenantOr404,
  handler: async (ctx: Ctx): Promise<Reply> =>
    withTransaction(async (client) => {
      const now = await transactionNow(client);
      const tenant = await tenantById(client, ctx.params.id ?? '');
      if (tenant === null) throw notFound();
      return { status: 200, body: await tenantDetailView(client, tenant, kitchenDate(now), now) };
    }),
};

const approve: Route = {
  method: 'POST',
  pattern: '/api/tenants/:id/approve',
  roles: ['owner'],
  resolve: tenantOr404,
  handler: async (ctx: Ctx): Promise<Reply> =>
    withTransaction(async (client) => {
      const now = await transactionNow(client);
      const today = kitchenDate(now);
      const tenant = await queryOne<TenantRow>(
        client,
        `select ${TENANT_COLUMNS} from tenants where id = $1 for update`,
        [ctx.params.id ?? ''],
      );
      if (tenant === null) throw notFound();
      const documents = await currentDocuments(client, tenant.id);
      const standing = tenantStanding(tenant, documents, today);
      if (standing.status !== 'documents_pending') {
        throw conflict('invalid_transition', serverMessage.invalidTransition);
      }
      if (!coversDate(documents.insurance, today) || !coversDate(documents.foodHandler, today)) {
        throw conflict('documents_not_valid', serverMessage.documentsNotValid);
      }
      await query(client, `update tenants set base_status = 'approved' where id = $1`, [tenant.id]);
      const approved = await tenantById(client, tenant.id);
      if (approved === null) throw notFound();
      return { status: 200, body: await tenantView(client, approved, today) };
    }),
};

const dailyReport: Route = {
  method: 'GET',
  pattern: '/api/reports/daily',
  roles: ['owner'],
  originSensitive: true,
  handler: async (ctx: Ctx): Promise<Reply> =>
    withTransaction(async (client) => {
      const now = await transactionNow(client);
      const date = readDateQuery(ctx, true, kitchenDate(now));
      const from = instantOfKitchenLocal(date, 0);
      const to = instantOfKitchenLocal(date, 24 * 60);

      const stations = await loadStations(client);
      const stationRows = await query<{ station_id: string; booked: string; bookings: string }>(
        client,
        `select o.station_id,
                coalesce(sum(extract(epoch from (b.end_at - b.start_at)) / 60), 0)::text as booked,
                count(*)::text as bookings
         from bookings b
         join booking_occupancies o on o.booking_id = b.id
         where b.start_at >= $1 and b.start_at < $2 and b.status = any($3::text[])
         group by o.station_id`,
        [from, to, REPORT_STATUSES],
      );
      const stationTotals = new Map(
        stationRows.map((row) => [
          row.station_id,
          { bookedMinutes: Math.round(Number(row.booked)), bookingCount: Number(row.bookings) },
        ]),
      );

      const tenantRows = await query<{
        tenant_id: string;
        business_name: string;
        booked: string;
        bookings: string;
        no_shows: string;
      }>(
        client,
        `select b.tenant_id, t.business_name,
                coalesce(sum(
                  (extract(epoch from (b.end_at - b.start_at)) / 60) *
                  (case when b.shelf_id is null then 1 else 2 end)
                ), 0)::text as booked,
                count(*)::text as bookings,
                count(*) filter (where b.status = 'no_show')::text as no_shows
         from bookings b
         join tenants t on t.id = b.tenant_id
         where b.start_at >= $1 and b.start_at < $2 and b.status = any($3::text[])
         group by b.tenant_id, t.business_name
         order by t.business_name`,
        [from, to, REPORT_STATUSES],
      );

      const stationList: ReportStationRow[] = stations.map((station) => ({
        stationId: station.id,
        stationName: station.name,
        bookedMinutes: stationTotals.get(station.id)?.bookedMinutes ?? 0,
        bookingCount: stationTotals.get(station.id)?.bookingCount ?? 0,
      }));
      const tenantList: ReportTenantRow[] = tenantRows.map((row) => ({
        tenantId: row.tenant_id,
        businessName: row.business_name,
        bookedMinutes: Math.round(Number(row.booked)),
        bookingCount: Number(row.bookings),
        noShowCount: Number(row.no_shows),
      }));

      const body: ReportResponse = {
        date,
        timeZone: kitchenTimeZone,
        totalBookedMinutes: stationList.reduce((total, row) => total + row.bookedMinutes, 0),
        stations: stationList,
        tenants: tenantList,
      };
      return { status: 200, body };
    }),
};

export const ownerRoutes: ReadonlyArray<Route> = [listTenants, tenantDetail, approve, dailyReport];
