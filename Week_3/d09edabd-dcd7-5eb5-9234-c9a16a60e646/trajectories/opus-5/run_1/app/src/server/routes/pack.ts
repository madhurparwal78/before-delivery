import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { sendDownload } from '../domain/download.js';
import { packBody, versionColumns, versionPropKey } from '../domain/versions.js';
import type { VersionRow } from '../domain/versions.js';
import { one } from '../services/db.js';
import { getObject } from '../services/storage.js';

async function versionByToken(token: string): Promise<VersionRow> {
  const row = await one<VersionRow>(
    `select ${versionColumns} from room_versions where link_token = $1`,
    [token],
  );
  if (!row) throw errors.notFound();
  return row;
}

export const packRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/pack/:token',
    body: 'none',
    async handler(ctx) {
      return packBody(await versionByToken(ctx.params.token));
    },
  },
  {
    method: 'GET',
    pattern: '/api/pack/:token/snapshot',
    body: 'none',
    async handler(ctx) {
      const row = await versionByToken(ctx.params.token);
      const bytes = await getObject(row.snapshot_key);
      if (bytes === null) throw errors.storageUnavailable();
      ctx.res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(bytes.length),
      });
      ctx.res.end(bytes);
      return null;
    },
  },
  {
    method: 'GET',
    pattern: '/api/pack/:token/props/:propId',
    body: 'none',
    async handler(ctx) {
      const row = await versionByToken(ctx.params.token);
      const prop = row.props.find((entry) => entry.id === ctx.params.propId);
      if (!prop) throw errors.notFound();
      const bytes = await getObject(versionPropKey(row.id, prop.id, prop.contentType));
      if (bytes === null) throw errors.storageUnavailable();
      sendDownload(
        ctx.res,
        {
          name: prop.name,
          contentType: prop.contentType,
          bytes: prop.bytes,
          sha256: prop.sha256,
        },
        bytes,
        ctx.header('if-none-match'),
      );
      return null;
    },
  },
];
