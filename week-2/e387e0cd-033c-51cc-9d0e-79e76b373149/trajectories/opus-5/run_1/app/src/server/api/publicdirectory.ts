import { query, queryOne } from '../db/pool';
import { nameMatchesSearch } from '../domain/names';
import { failure, invalidFields } from '../http/errors';
import { define, Registered } from '../http/runtime';
import { allJurisdictions, findJurisdiction, JurisdictionRow } from '../store/workspace';

const REGIONS = ['europe', 'asia_pacific', 'middle_east', 'americas', 'africa'] as const;
const STATUSES = ['in_force', 'announced', 'no_rule'] as const;

interface ListingRow {
  slug: string;
  name: string;
  jurisdiction_code: string;
  on_network: boolean;
  workspace_slug: string | null;
  listed: boolean;
  sort_order: number;
}

function jurisdictionBody(row: JurisdictionRow): Record<string, unknown> {
  const inForce = row.reference_status === 'in_force';
  return {
    code: row.code,
    name: row.name,
    region: row.region,
    currency: row.currency,
    status: row.reference_status,
    thresholdCents:
      inForce && row.reference_threshold_cents !== null
        ? BigInt(row.reference_threshold_cents)
        : null,
    inForceSince: inForce ? row.reference_in_force_since : null,
    announcedChange:
      row.reference_change_takes_effect_on === null || row.reference_change_threshold_cents === null
        ? null
        : {
            thresholdCents: BigInt(row.reference_change_threshold_cents),
            takesEffectOn: row.reference_change_takes_effect_on,
          },
  };
}

function exchangeBody(row: ListingRow, jurisdiction: JurisdictionRow | null): Record<string, unknown> {
  return {
    slug: row.slug,
    name: row.name,
    jurisdictionCode: row.jurisdiction_code,
    region: jurisdiction === null ? '' : jurisdiction.region,
    status: jurisdiction === null ? 'no_rule' : jurisdiction.reference_status,
    onNetwork: row.on_network,
  };
}

async function listedExchanges(): Promise<ListingRow[]> {
  return query<ListingRow>('SELECT * FROM listings WHERE listed = true ORDER BY sort_order');
}

function filterChecks(url: URL): { region: string | null; status: string | null } {
  const region = url.searchParams.get('region');
  const status = url.searchParams.get('status');
  const failures: Record<string, string> = {};
  if (region !== null && region !== '' && !(REGIONS as readonly string[]).includes(region)) {
    failures.region = 'Choose a region.';
  }
  if (status !== null && status !== '' && !(STATUSES as readonly string[]).includes(status)) {
    failures.status = 'Choose a status.';
  }
  if (Object.keys(failures).length > 0) throw invalidFields(failures);
  return { region: region === '' ? null : region, status: status === '' ? null : status };
}

export const publicDirectoryRoutes: readonly Registered[] = [
  define({
    kind: 'public',
    method: 'GET',
    path: '/api/public/stats',
    handler: async () => {
      const jurisdictions = await allJurisdictions();
      const exchanges = await listedExchanges();
      return {
        status: 200,
        json: {
          jurisdictions: jurisdictions.length,
          rulesInForce: jurisdictions.filter((row) => row.reference_status === 'in_force').length,
          listedExchanges: exchanges.length,
        },
      };
    },
  }),
  define({
    kind: 'public',
    method: 'GET',
    path: '/api/public/jurisdictions',
    handler: async (context) => {
      const filters = filterChecks(context.url);
      const rows = (await allJurisdictions()).filter((row) => {
        if (filters.region !== null && row.region !== filters.region) return false;
        if (filters.status !== null && row.reference_status !== filters.status) return false;
        return true;
      });
      return { status: 200, json: { jurisdictions: rows.map(jurisdictionBody) } };
    },
  }),
  define({
    kind: 'public',
    method: 'GET',
    path: '/api/public/jurisdictions/:code',
    load: async (context) => {
      const row = await findJurisdiction(context.params.code.toUpperCase());
      if (row === null) throw failure('not_found');
      return row;
    },
    handler: async (context) => {
      const exchanges = (await listedExchanges()).filter(
        (row) => row.jurisdiction_code === context.loaded.code,
      );
      return {
        status: 200,
        json: {
          jurisdiction: jurisdictionBody(context.loaded),
          exchanges: exchanges.map((row) => exchangeBody(row, context.loaded)),
        },
      };
    },
  }),
  define({
    kind: 'public',
    method: 'GET',
    path: '/api/public/exchanges',
    handler: async (context) => {
      const filters = filterChecks(context.url);
      const search = context.url.searchParams.get('q') ?? '';
      const jurisdictions = new Map((await allJurisdictions()).map((row) => [row.code, row]));
      const rows = (await listedExchanges()).filter((row) => {
        const jurisdiction = jurisdictions.get(row.jurisdiction_code);
        if (jurisdiction === undefined) return false;
        if (filters.region !== null && jurisdiction.region !== filters.region) return false;
        if (filters.status !== null && jurisdiction.reference_status !== filters.status) return false;
        return nameMatchesSearch(row.name, search);
      });
      return {
        status: 200,
        json: {
          exchanges: rows.map((row) =>
            exchangeBody(row, jurisdictions.get(row.jurisdiction_code) ?? null),
          ),
        },
      };
    },
  }),
  define({
    kind: 'public',
    method: 'GET',
    path: '/api/public/exchanges/:listingSlug',
    load: async (context) => {
      const row = await queryOne<ListingRow>('SELECT * FROM listings WHERE slug = $1', [
        context.params.listingSlug,
      ]);
      if (row === null) throw failure('not_found');
      if (!row.listed) throw failure('listing_withdrawn');
      return row;
    },
    handler: async (context) => {
      const jurisdiction = await findJurisdiction(context.loaded.jurisdiction_code);
      return { status: 200, json: { exchange: exchangeBody(context.loaded, jurisdiction) } };
    },
  }),
];
