import { Router } from 'express';
import { h } from './h.js';
import { pool, withClient } from '../db/pool.js';
import { CONFIG } from '../config.js';
import { Errors, configPublic } from '../domain/errors.js';
import { AIRLINES, airlineByCode } from '../services/airlines.js';
import { runSearch, sortRows } from '../services/query.js';
import { loadCatalog, toResultRows, groupVariants, textMatchesFallback, matchesFilters } from '../services/catalog.js';
import type { SearchFilters } from '../services/search.js';
import { stockBadge, fitVerdict, hasCabinFit, savePercent } from '../domain/fit.js';
import { meiliReachable } from '../services/search.js';
import { s3 } from '../services/s3.js';

export const publicRouter = Router();

publicRouter.get('/health', async (_req, res) => {
  const [meili, minio] = await Promise.all([meiliReachable(), s3.health()]);
  res.status(200).json({ status: meili && minio ? 'ok' : 'unavailable' });
});

publicRouter.get('/config', (_req, res) => {
  res.status(200).json(configPublic());
});

publicRouter.get('/collections', async (_req, res) => {
  const rows = await withClient(async (client) => {
    const res = await client.query<{ category: string; designs: string; units: string }>(`
      SELECT p.category, COUNT(DISTINCT p.slug)::TEXT AS designs,
             COALESCE(SUM(av.available), 0)::TEXT AS units
      FROM products p
      JOIN LATERAL (
        SELECT COALESCE(SUM(e.quantity), 0)::INT AS available
        FROM variants v LEFT JOIN stock_entries e ON e.sku = v.sku AND e.account = 'available'
        WHERE v.product_slug = p.slug GROUP BY v.sku
      ) av ON TRUE
      WHERE p.status = 'published'
      GROUP BY p.category`);
    return res.rows;
  });
  const byCategory = new Map(rows.map((r) => [r.category, { designs: Number(r.designs), units: Number(r.units) }]));
  const all = {
    slug: 'all',
    name: 'All bags',
    designs: [...byCategory.values()].reduce((sum, c) => sum + c.designs, 0),
    units: [...byCategory.values()].reduce((sum, c) => sum + c.units, 0),
  };
  const out = [all];
  for (const category of ['luggage', 'backpacks', 'totes', 'wallets', 'accessories']) {
    const entry = byCategory.get(category) ?? { designs: 0, units: 0 };
    out.push({ slug: category, name: COLLECTION_NAMES[category], designs: entry.designs, units: entry.units });
  }
  res.status(200).json(out);
});

const COLLECTION_NAMES: Record<string, string> = {
  all: 'All bags', luggage: 'Luggage', backpacks: 'Backpacks', totes: 'Totes', wallets: 'Wallets', accessories: 'Accessories',
};

publicRouter.get('/search', h(async (req, res) => {
  const filters = parseFilters(req);
  const outcome = await withClient((client) => runSearch(client, filters));
  res.status(200).json(outcome);
}));

publicRouter.get('/search/suggest', h(async (req, res) => {
  const q = String(req.query.q ?? '');
  try {
    const { meiliQuery } = await import('../services/search.js');
    const result = await meiliQuery('products', { q, limit: 6, attributesToRetrieve: ['name', 'slug'] });
    res.status(200).json({
      mode: 'search',
      suggestions: (result.hits as { name: string; slug: string }[]).map((h) => ({ name: h.name, slug: h.slug })),
    });
  } catch {
    res.status(200).json({ mode: 'fallback', suggestions: [] });
  }
}));

export function parseFilters(req: { query: Record<string, unknown> }): SearchFilters {
  const q = String(req.query.q ?? '');
  const collection = req.query.collection ? String(req.query.collection) : null;
  return {
    q,
    collection,
    category: listOf(req.query.category),
    colour: listOf(req.query.colour),
    size: listOf(req.query.size),
    material: listOf(req.query.material),
    price: listOf(req.query.price),
    fit: listOf(req.query.fit),
    sort: String(req.query.sort ?? 'featured'),
    page: Math.max(1, Number(req.query.page ?? 1) || 1),
  };
}

function listOf(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  return String(value).split(',').filter((v) => v.length > 0);
}

publicRouter.get('/airlines', (_req, res) => {
  res.status(200).json(AIRLINES);
});

publicRouter.get('/fit', h(async (req, res) => {
  const sku = String(req.query.sku ?? '');
  const airlineCode = String(req.query.airline ?? '');
  const fields: Record<string, string> = {};
  const airline = airlineByCode(airlineCode);
  if (!airline) fields.airline = 'Choose a listed airline.';
  if (!sku) fields.sku = 'Choose a luggage, backpack or tote variant.';
  if (Object.keys(fields).length > 0) throw Errors.validationFailed(fields);
  const row = await withClient((client) => client.query<{ height_cm: number; width_cm: number; depth_cm: number; category: string }>(
    `SELECT v.height_cm, v.width_cm, v.depth_cm, p.category FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.sku = $1`, [sku]));
  if (row.rows.length === 0) throw Errors.validationFailed({ sku: 'Choose a luggage, backpack or tote variant.' });
  const variant = row.rows[0];
  if (!hasCabinFit(variant.category)) throw Errors.validationFailed({ sku: 'Choose a luggage, backpack or tote variant.' });
  const verdict = fitVerdict(variant, airline!);
  res.status(200).json({ sku, airline: airline!.code, ...verdict });
}));

publicRouter.get('/products/:slug', h(async (req, res) => {
  const slug = req.params.slug;
  const data = await withClient(async (client) => {
    const product = await client.query<{ slug: string; name: string; category: string; material: string; description: string; status: string; published_at: Date }>(
      `SELECT slug, name, category, material, description, status, published_at FROM products WHERE slug = $1`, [slug]);
    if (product.rows.length === 0) throw Errors.notFound();
    const p = product.rows[0];
    if (p.status !== 'published') throw Errors.notFound();
    const variants = await client.query<{
      sku: string; colour: string; colour_slug: string; size: string; size_slug: string;
      height_cm: number; width_cm: number; depth_cm: number; weight_kg: string; price: number; compare_at: number | null; position: number;
      available: string;
    }>(`
      SELECT v.sku, v.colour, v.colour_slug, v.size, v.size_slug, v.height_cm, v.width_cm, v.depth_cm, v.weight_kg::TEXT AS weight_kg,
             v.price, v.compare_at, v.position,
             COALESCE(SUM(e.quantity) FILTER (WHERE e.account = 'available'), 0)::TEXT AS available
      FROM variants v LEFT JOIN stock_entries e ON e.sku = v.sku
      WHERE v.product_slug = $1 GROUP BY v.sku ORDER BY v.position`, [slug]);
    const images = await client.query<{ id: string; colour_slug: string; alt: string; position: number }>(
      `SELECT id, colour_slug, alt, position FROM product_images WHERE product_slug = $1 ORDER BY colour_slug, position`, [slug]);
    const saves = await client.query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n FROM wishlist_items WHERE product_slug = $1`, [slug]);
    return { p, variants: variants.rows, images: images.rows, saves: Number(saves.rows[0].n) };
  });
  const imagesByColour = new Map<string, { id: string; url: string; alt: string; position: number }[]>();
  for (const img of data.images) {
    const list = imagesByColour.get(img.colour_slug) ?? [];
    list.push({ id: img.id, url: `/media/products/${img.id}`, alt: img.alt, position: img.position });
    imagesByColour.set(img.colour_slug, list);
  }
  res.status(200).json({
    slug: data.p.slug,
    name: data.p.name,
    category: data.p.category,
    collection: data.p.category,
    material: data.p.material,
    description: data.p.description,
    warranty_years: warrantyYearsFor(data.p.category),
    saves: data.saves,
    variants: data.variants.map((v) => ({
      sku: v.sku,
      colour: v.colour,
      colour_slug: v.colour_slug,
      size: v.size,
      size_slug: v.size_slug,
      dimensions_cm: { height: v.height_cm, width: v.width_cm, depth: v.depth_cm },
      weight_kg: Number(v.weight_kg),
      price: v.price,
      compare_at: v.compare_at,
      save_percent: savePercent(v.price, v.compare_at),
      available: Number(v.available),
      badge: stockBadge(Number(v.available)),
      images: (imagesByColour.get(v.colour_slug) ?? []).sort((a, b) => a.position - b.position),
    })),
  });
}));

export function warrantyYearsFor(category: string): number {
  if (category === 'luggage') return CONFIG.warrantyYearsLuggage;
  if (category === 'backpacks' || category === 'totes') return CONFIG.warrantyYearsBags;
  return CONFIG.warrantyYearsAccessories;
}

publicRouter.get('/variants/:sku/stock', h(async (req, res) => {
  const sku = req.params.sku;
  const row = await withClient(async (client) => {
    const res = await client.query<{ available: string }>(
      `SELECT COALESCE(SUM(e.quantity), 0)::TEXT AS available FROM stock_entries e WHERE e.sku = $1 AND e.account = 'available'`, [sku]);
    if (res.rows.length === 0) throw Errors.notFound();
    return Number(res.rows[0].available);
  });
  res.status(200).json({ sku, available: row, badge: stockBadge(row) });
}));
