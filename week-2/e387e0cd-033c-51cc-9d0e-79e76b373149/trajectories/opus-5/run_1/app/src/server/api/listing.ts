import { query, queryOne } from '../db/pool';
import { failure } from '../http/errors';
import { define, Registered, Role } from '../http/runtime';
import { FieldCheck, readFlag } from '../http/validate';

const OFFICER: readonly Role[] = ['compliance_officer'];

interface OwnListingRow {
  slug: string;
  listed: boolean;
}

async function loadOwnListing(workspaceSlug: string): Promise<OwnListingRow> {
  const row = await queryOne<OwnListingRow>(
    'SELECT slug, listed FROM listings WHERE workspace_slug = $1',
    [workspaceSlug],
  );
  if (row === null) throw failure('not_found');
  return row;
}

export const listingRoutes: readonly Registered[] = [
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/listing',
    roles: OFFICER,
    load: (context) => loadOwnListing(context.workspace.slug),
    handler: async (context) => ({
      status: 200,
      json: { listing: { slug: context.loaded.slug, listed: context.loaded.listed } },
    }),
  }),
  define({
    kind: 'staff',
    method: 'PUT',
    path: '/api/w/:slug/listing',
    roles: OFFICER,
    content: 'json',
    load: (context) => loadOwnListing(context.workspace.slug),
    handler: async (context) => {
      const listed = readFlag(context.body, 'listed');
      const check = new FieldCheck();
      if (listed === null) check.add('listed', 'Choose whether the listing is shown.');
      check.settle();
      await query('UPDATE listings SET listed = $2 WHERE slug = $1', [context.loaded.slug, listed]);
      return { status: 200, json: { listing: { slug: context.loaded.slug, listed } } };
    },
  }),
];
