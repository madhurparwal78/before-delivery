import {
  REGION_LABELS,
  SECTOR_LABELS,
  SECTORS,
  type Region,
  type Sector,
} from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { config } from '../config.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, transact } from '../db/pool.js';
import { nextCounter } from '../db/seed.js';
import { Fields } from '../domain/validate.js';
import { parseMonth } from '../../shared/zoned.js';
import { jsonReply, type Reply } from '../http/context.js';
import { notFound, rateLimited } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { coverSvg } from '../services/procedural.js';
import { nudgeMailDelivery, queueMail } from '../services/mail.js';

const MAX_ENQUIRIES_PER_WINDOW = 3;

interface PublicRow {
  slug: string;
  title: string;
  sector: Sector;
  location: string;
  summary: string;
  body: string;
}

function publicPayload(row: PublicRow): unknown {
  return {
    slug: row.slug,
    title: row.title,
    sector: row.sector,
    location: row.location,
    summary: row.summary,
    coverUrl: `/media/covers/${row.slug}.svg`,
  };
}

export function registerPublicRoutes(router: Router): void {
  router.get('/api/public/case-studies', async (context): Promise<Reply> => {
    const sector = context.queryParam('sector');
    const filtered = sector !== null && SECTORS.includes(sector as Sector);
    const found = await rows<PublicRow>(
      pool,
      `SELECT slug, title, sector, location, summary, body FROM case_studies
        WHERE state = 'published' AND ($1::text IS NULL OR sector = $1)
        ORDER BY published_at DESC, title`,
      [filtered ? sector : null],
    );
    return jsonReply(200, { caseStudies: found.map(publicPayload) });
  });

  router.get('/api/public/case-studies/:slug', async (context): Promise<Reply> => {
    const row = await firstRow<PublicRow>(
      pool,
      `SELECT slug, title, sector, location, summary, body FROM case_studies
        WHERE slug = $1 AND state = 'published'`,
      [context.param('slug')],
    );
    if (!row) throw notFound();
    return jsonReply(200, {
      caseStudy: { ...(publicPayload(row) as object), body: row.body },
    });
  });

  router.get('/api/public/sectors', async (): Promise<Reply> => {
    const counts = await rows<{ sector: Sector; count: number }>(
      pool,
      `SELECT sector, COUNT(*)::int AS count FROM case_studies WHERE state = 'published'
        GROUP BY sector`,
    );
    const total = counts.reduce((sum, row) => sum + row.count, 0);
    return jsonReply(200, {
      total,
      sectors: SECTORS.map((key) => ({
        key,
        label: SECTOR_LABELS[key],
        count: counts.find((row) => row.sector === key)?.count ?? 0,
      })),
    });
  });

  router.get('/api/public/featured', async (): Promise<Reply> => {
    const found = await rows<PublicRow>(
      pool,
      `SELECT slug, title, sector, location, summary, body FROM case_studies
        WHERE state = 'published' AND featured = true
        ORDER BY featured_order NULLS LAST, published_at DESC`,
    );
    return jsonReply(200, { caseStudies: found.map(publicPayload) });
  });

  router.get('/media/covers/:file', async (context): Promise<Reply> => {
    const file = context.param('file');
    if (!file.endsWith('.svg')) throw notFound();
    const slug = file.slice(0, -4);
    const row = await firstRow<{ slug: string; title: string }>(
      pool,
      `SELECT slug, title FROM case_studies WHERE slug = $1 AND state <> 'withdrawn'`,
      [slug],
    );
    if (!row) throw notFound();
    return {
      status: 200,
      bytes: Buffer.from(coverSvg(row.slug, row.title), 'utf8'),
      contentType: 'image/svg+xml',
      headers: { 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'no-store' },
    };
  });

  router.get('/api/enquiries', async (context): Promise<Reply> => {
    await context.memberWithRole('director');
    const found = await rows<{
      id: string;
      reference: string;
      name: string;
      company: string;
      email: string;
      phone: string;
      sector: Sector;
      region: Region;
      sites: number;
      opening_month: string;
      message: string;
      created_at: string;
    }>(
      pool,
      `SELECT id, reference, name, company, email, phone, sector, region, sites, opening_month,
              message, created_at
         FROM enquiries ORDER BY created_at DESC`,
    );
    return jsonReply(200, {
      enquiries: found.map((row) => ({
        id: row.id,
        reference: row.reference,
        name: row.name,
        company: row.company,
        email: row.email,
        phone: row.phone,
        sector: row.sector,
        region: row.region,
        sites: row.sites,
        openingMonth: row.opening_month,
        message: row.message,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    });
  });

  router.post('/api/enquiries', async (context): Promise<Reply> => {
    const body = await context.json();
    const fields = new Fields();

    const name = fields.text('name', body.name, { label: 'Your name', max: 120, oneLine: true });
    const company = fields.text('company', body.company, {
      label: 'Company',
      max: 120,
      oneLine: true,
    });
    const email = fields.email('email', body.email);
    const phone =
      body.phone === undefined || body.phone === null
        ? ''
        : fields.text('phone', body.phone, {
            label: 'Phone (optional)',
            min: 0,
            max: 30,
            oneLine: true,
          });
    const sector = fields.enumeration<Sector>('sector', body.sector, 'Sector', SECTORS);
    const region = fields.enumeration<Region>('region', body.region, 'Region', ['HK', 'SG', 'MO']);
    const sites = fields.integer('sites', body.sites, 'Number of sites', 1, 200);
    const monthText = typeof body.openingMonth === 'string' ? body.openingMonth : '';
    const month = parseMonth(monthText);
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!month) {
      fields.add('openingMonth', fieldErrorCopy.required('Target opening month'));
    } else if (monthText < currentMonth) {
      fields.add('openingMonth', fieldErrorCopy.outOfRange('Target opening month', currentMonth, '2099-12'));
    }
    const message = fields.text('message', body.message, {
      label: 'Tell us about the rollout',
      max: 2000,
    });
    fields.finish();

    const normalisedEmail = email.trim().toLowerCase();
    const earlier = await rows<{ created_at: string }>(
      pool,
      `SELECT created_at FROM enquiries
        WHERE lower(btrim(email)) = $1
          AND created_at > now() - ($2 || ' seconds')::interval
        ORDER BY created_at`,
      [normalisedEmail, String(config.enquiryRateWindowSeconds)],
    );
    if (earlier.length >= MAX_ENQUIRIES_PER_WINDOW) {
      const oldest = new Date(earlier[0]?.created_at ?? now);
      const freeAt = oldest.getTime() + config.enquiryRateWindowSeconds * 1000;
      const seconds = Math.max(1, Math.ceil((freeAt - now.getTime()) / 1000));
      throw rateLimited(seconds);
    }

    const reference = await transact(async (client) => {
      const sequence = await nextCounter(client, 'enquiry_reference');
      const value = `ENQ-${String(sequence).padStart(4, '0')}`;
      await client.query(
        `INSERT INTO enquiries (id, reference, name, company, email, phone, sector, region, sites,
                                opening_month, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          newId(),
          value,
          name,
          company,
          email,
          phone,
          sector,
          region,
          sites,
          monthText,
          message,
        ],
      );

      const detail = [
        `Reference: ${value}`,
        `Name: ${name}`,
        `Company: ${company}`,
        `Email: ${email}`,
        `Phone: ${phone === '' ? '(not given)' : phone}`,
        `Sector: ${SECTOR_LABELS[sector]}`,
        `Region: ${REGION_LABELS[region]}`,
        `Number of sites: ${sites}`,
        `Target opening month: ${monthText}`,
        '',
        'Message',
        message,
      ].join('\n');

      const directors = await rows<{ email: string }>(
        client,
        `SELECT email FROM members WHERE role = 'director' AND status = 'active' ORDER BY name`,
      );
      for (const director of directors) {
        await queueMail(client, {
          to: director.email,
          subject: `New enquiry from ${name} at ${company}`,
          body: detail,
          replyTo: email,
        });
      }

      await queueMail(client, {
        to: email,
        subject: "We've received your enquiry",
        body: [
          `Thanks ${name}, your enquiry is with our studio.`,
          '',
          `Your reference is ${value}.`,
          '',
          'This is what you told us:',
          message,
          '',
          'Marrow Hall Interiors',
        ].join('\n'),
      });

      return value;
    });
    nudgeMailDelivery();

    return jsonReply(201, { enquiry: { reference } });
  });
}
