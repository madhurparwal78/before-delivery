import { databaseIsUp, query } from '../../db/pool.js';
import { sampleFiles } from '../../media/samples.js';
import { mailIsUp, storageIsUp } from '../../services/probes.js';
import { StorageObjectMissing, getObject } from '../../services/storage.js';
import { errors } from '../errors.js';
import { bytesReply, jsonReply, textReply } from '../reply.js';
import { route } from '../server.js';
import {
  benefitsData,
  feedXml,
  homeData,
  modelRouteData,
  modelsData,
  newsData,
  newsPostData,
  parseAsOf,
  parseNewsPage,
  roleData,
  rolesData,
  searchData,
  sitemapXml,
} from './publicdata.js';

export function registerPublicApi(): void {
  route('GET', '/api/health', null, async () => jsonReply(200, { status: 'ok' }));

  route('GET', '/api/ready', null, async () => {
    const database = await databaseIsUp();
    const storage = storageIsUp();
    const mail = mailIsUp();
    if (!database) {
      return jsonReply(503, {
        status: 'unavailable',
        dependencies: {
          database: 'down',
          storage: storage ? 'up' : 'down',
          mail: mail ? 'up' : 'down',
        },
        degraded_features: ['everything'],
      });
    }
    const degraded: string[] = [];
    if (!storage) degraded.push('applications', 'resume_downloads', 'samples');
    if (!mail) degraded.push('mail_delivery');
    degraded.sort();
    return jsonReply(200, {
      status: degraded.length === 0 ? 'ready' : 'degraded',
      dependencies: {
        database: 'up',
        storage: storage ? 'up' : 'down',
        mail: mail ? 'up' : 'down',
      },
      degraded_features: degraded,
    });
  });

  route('GET', '/api/public/home', 'public', async () => jsonReply(200, await homeData()));

  route('GET', '/api/public/models', 'public', async (ctx) =>
    jsonReply(200, await modelsData(parseAsOf(ctx.url))),
  );

  route('GET', '/api/public/models/:slug', 'public', async (ctx) =>
    jsonReply(200, await modelRouteData(ctx.params.slug as string, parseAsOf(ctx.url))),
  );

  route('GET', '/api/public/news', 'public', async (ctx) =>
    jsonReply(
      200,
      await newsData({
        subject: ctx.url.searchParams.get('subject'),
        tag: ctx.url.searchParams.get('tag'),
        page: parseNewsPage(ctx.url),
        asOf: parseAsOf(ctx.url),
      }),
    ),
  );

  route('GET', '/api/public/news/:slug', 'public', async (ctx) =>
    jsonReply(200, await newsPostData(ctx.params.slug as string, parseAsOf(ctx.url))),
  );

  route('GET', '/api/public/search', 'public', async (ctx) =>
    jsonReply(200, await searchData(ctx.url)),
  );

  route('GET', '/api/public/roles', 'public', async (ctx) =>
    jsonReply(
      200,
      await rolesData({
        discipline: ctx.url.searchParams.get('discipline'),
        office: ctx.url.searchParams.get('office'),
        region: ctx.url.searchParams.get('region'),
      }),
    ),
  );

  route('GET', '/api/public/roles/:slug', 'public', async (ctx) =>
    jsonReply(200, await roleData(ctx.params.slug as string)),
  );

  route('GET', '/api/public/benefits', 'public', async () => jsonReply(200, await benefitsData()));

  route('GET', '/feed.xml', 'public', async () =>
    textReply(200, 'application/atom+xml; charset=utf-8', await feedXml()),
  );

  route('GET', '/sitemap.xml', 'public', async () =>
    textReply(200, 'application/xml; charset=utf-8', await sitemapXml()),
  );

  route('GET', '/media/samples/:slug/:sample/:file', 'public', async (ctx) => {
    const slug = ctx.params.slug as string;
    const sampleId = ctx.params.sample as string;
    const file = ctx.params.file as string;
    const sample = await query<{ kind: 'audio' | 'image_sequence'; frames: number }>(
      'SELECT kind, frames FROM model_samples WHERE model_slug = $1 AND id = $2',
      [slug, sampleId],
    );
    const found = sample.rows[0];
    if (found === undefined || !sampleFiles(found.kind, found.frames).includes(file)) {
      throw errors.publicNotFound();
    }
    if (!storageIsUp()) {
      throw errors.storageUnavailable('Samples are unavailable right now.');
    }
    try {
      const object = await getObject(`samples/${slug}/${sampleId}/${file}`);
      return bytesReply(200, object.contentType, object.body, {
        'Cache-Control': 'public, max-age=3600',
      });
    } catch (error) {
      if (error instanceof StorageObjectMissing) throw errors.publicNotFound();
      throw errors.storageUnavailable('Samples are unavailable right now.');
    }
  });
}
