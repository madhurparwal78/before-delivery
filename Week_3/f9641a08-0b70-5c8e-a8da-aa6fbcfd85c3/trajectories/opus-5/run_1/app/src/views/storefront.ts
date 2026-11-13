import { config } from '../config';
import { db } from '../db/pool';
import { Ctx } from '../http/context';
import { loadWishlist } from '../api/accounts';
import { productPayload, savesCount } from '../api/catalogue';
import {
  ProductRecord,
  SearchResultItem,
  collectionsPayload,
  loadProducts,
  productAvailable
} from '../domain/catalogue';
import {
  AIRLINES,
  COLLECTIONS,
  DEFAULT_AIRLINE,
  findAirline,
  warrantyYearsFor
} from '../domain/constants';
import { groupIndian, rupees } from '../domain/money';
import { cabinFit, hasCabinFit, savePercent, stockBadge } from '../domain/rules';
import { CatalogueResult, catalogueSearch, groupLabel, optionLabel, parseFilters } from '../domain/search-query';
import { FILTER_GROUPS, FilterGroup } from '../domain/catalogue';
import { Shell, attr, escapeHtml, renderPage } from './layout';

const COLOUR_PAGES = ['red', 'blue', 'teal', 'yellow'];

function cardPriceCopy(item: SearchResultItem): string {
  return item.price_varies ? `From ${rupees(item.min_price)}` : rupees(item.min_price);
}

function productCard(
  item: SearchResultItem,
  state: { compared: string[]; saved: string[] }
): string {
  const isCompared = state.compared.includes(item.slug);
  const isSaved = state.saved.includes(item.slug);
  const colours = item.colours;
  const first = colours[0];
  return `
<article class="product-card" aria-label="${attr(item.name)}" data-card="${attr(item.slug)}">
  <img class="card-image" src="${attr(first === undefined ? '' : first.image_url)}" alt="" data-card-image>
  <a class="card-name" href="/products/${attr(item.slug)}">${escapeHtml(item.name)}</a>
  <div role="radiogroup" aria-label="Colour for ${attr(item.name)}" class="swatches" data-card-colours>
    ${colours
      .map(
        (colour, index) => `<button type="button" role="radio" aria-label="${attr(colour.name)}"
        aria-checked="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}"
        class="swatch swatch-${attr(colour.slug)}" data-colour="${attr(colour.slug)}"
        data-image="${attr(colour.image_url)}"><span class="visually-hidden">${escapeHtml(colour.name)}</span></button>`
      )
      .join('')}
  </div>
  <p class="card-price">${escapeHtml(cardPriceCopy(item))}</p>
  ${
    item.compare_at === null
      ? ''
      : `<p class="card-save"><s>${escapeHtml(rupees(item.compare_at))}</s> Save ${item.save_percent}%</p>`
  }
  <p class="card-badge" data-card-badge>${escapeHtml(item.badge)}</p>
  <button type="button" data-quick-add="${attr(item.slug)}">Quick add ${escapeHtml(item.name)}</button>
  <button type="button" data-compare="${attr(item.slug)}" aria-pressed="${isCompared ? 'true' : 'false'}">Compare ${escapeHtml(
    item.name
  )}</button>
  <button type="button" data-save="${attr(item.slug)}" aria-pressed="${isSaved ? 'true' : 'false'}">Save ${escapeHtml(
    item.name
  )} to wishlist</button>
</article>`;
}

function colourBand(name: string, units: number, designs: number, tone: string): string {
  return `
<section class="colour-band tone-${attr(tone)}">
  <h2>${escapeHtml(name)}</h2>
  <p class="band-numeral">${escapeHtml(groupIndian(units))}</p>
  <p class="band-caption">units ready to ship</p>
  <p class="band-caption">${escapeHtml(String(designs))} designs</p>
</section>`;
}

export async function homePage(ctx: Ctx, shell: Shell): Promise<string> {
  const collections = await collectionsPayload(db);
  const listed = collections.filter((collection) => collection.slug !== 'all');
  const content = `
<section class="masthead">
  <div class="mosaic" aria-hidden="true">
    <span class="tile study span-2"><img src="/media/masthead/1" alt=""></span>
    <span class="tile flat-blue span-rows"></span>
    <span class="tile study"><img src="/media/masthead/2" alt=""></span>
    <span class="tile flat-red"></span>
    <span class="tile flat-yellow"></span>
    <span class="tile study"><img src="/media/masthead/3" alt=""></span>
    <span class="tile flat-red"></span>
    <span class="tile study"><img src="/media/masthead/4" alt=""></span>
    <span class="tile flat-yellow"></span>
    <span class="tile flat-red"></span>
  </div>
  <h1 class="masthead-title">Carry what the trip needs</h1>
  <p class="standfirst">Cases, packs and small goods, measured against the cabin frame before they reach the gate.</p>
</section>
${listed
  .map(
    (collection, index) => `
<section class="collection-page ${index % 2 === 0 ? 'text-page' : 'flat-page'}">
  ${colourBand(collection.name, collection.units, collection.designs, COLOUR_PAGES[index % COLOUR_PAGES.length])}
  <div class="collection-body">
    <p>${escapeHtml(collection.name)} measured, weighed and listed with the cabin frame in mind.</p>
    <a href="/collections/${attr(collection.slug)}">Open ${escapeHtml(collection.name)}</a>
  </div>
</section>`
  )
  .join('')}`;
  return renderPage(shell, { title: 'Carry what the trip needs', page: 'home', content });
}

function resultCountCopy(total: number): string {
  return total === 1 ? '1 product' : `${total} products`;
}

function filterGroupMarkup(
  group: FilterGroup,
  result: CatalogueResult,
  active: Record<string, string[]>,
  suffix: string
): string {
  const options = result.options[group] ?? [];
  if (options.length === 0) return '';
  return `
<fieldset role="group" aria-label="${attr(groupLabel(group))}" class="filter-group">
  <legend>${escapeHtml(groupLabel(group))}</legend>
  ${options
    .map((option) => {
      const id = `filter-${group}-${option.value}${suffix}`;
      const checked = (active[group] ?? []).includes(option.value);
      const describedBy = option.count === null ? '' : ` aria-describedby="${id}-count"`;
      return `<div class="filter-option">
        <input type="checkbox" id="${attr(id)}" data-filter-group="${attr(group)}" data-filter-value="${attr(
          option.value
        )}" ${checked ? 'checked' : ''}${describedBy}>
        <label for="${attr(id)}">${escapeHtml(option.label)}</label>
        ${
          option.count === null
            ? ''
            : `<span class="filter-count" id="${attr(id)}-count">${escapeHtml(String(option.count))}</span>`
        }
      </div>`;
    })
    .join('')}
</fieldset>`;
}

export async function collectionPage(ctx: Ctx, shell: Shell, slug: string): Promise<string | null> {
  const collection = COLLECTIONS.find((item) => item.slug === slug);
  if (collection === undefined) return null;
  const filters = parseFilters(ctx.query, slug);
  const result = await catalogueSearch(filters);
  const counts = await collectionsPayload(db);
  const band = counts.find((item) => item.slug === slug)!;

  const compared = (ctx.query.get('compare') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const comparedSlugs = await slugsForSkus(compared);
  const wishlist = await loadWishlist(db, { sessionId: ctx.sessionId, userId: ctx.user?.id ?? null });

  const active: Record<string, string[]> = {};
  for (const group of FILTER_GROUPS) active[group] = filters[group];

  const groups = FILTER_GROUPS.filter((group) => group !== 'category' || slug === 'all');
  const filterMarkup = (suffix: string): string =>
    groups.map((group) => filterGroupMarkup(group, result, active, suffix)).join('');

  const activeChips = groups
    .flatMap((group) =>
      (active[group] ?? []).map(
        (value) =>
          `<li><button type="button" data-remove-filter data-filter-group="${attr(group)}" data-filter-value="${attr(
            value
          )}">Remove filter ${escapeHtml(optionLabel(group, value, result.options))}</button></li>`
      )
    )
    .join('');

  const pages = Math.max(1, Math.ceil(result.total / config.pageSize));
  const pagination = `
<nav aria-label="Pages" class="pagination" data-pagination>
  ${filters.page > 1 ? `<a href="${attr(pageHref(ctx, filters.page - 1))}" data-page-to="${filters.page - 1}">Previous page</a>` : ''}
  ${Array.from({ length: pages }, (_value, index) => index + 1)
    .map(
      (number) =>
        `<a href="${attr(pageHref(ctx, number))}" data-page-to="${number}" ${
          number === filters.page ? 'aria-current="page"' : ''
        }>Page ${number}</a>`
    )
    .join('')}
  ${filters.page < pages ? `<a href="${attr(pageHref(ctx, filters.page + 1))}" data-page-to="${filters.page + 1}">Next page</a>` : ''}
</nav>`;

  const content = `
${colourBand(collection.name, band.units, band.designs, COLOUR_PAGES[COLLECTIONS.findIndex((item) => item.slug === slug) % COLOUR_PAGES.length])}
<div class="collection-layout">
  <div class="left-zone">
    <p role="status" aria-live="polite" aria-label="Result count" data-result-count>${escapeHtml(
      resultCountCopy(result.total)
    )}</p>
    ${
      result.notice === null
        ? '<p role="status" aria-live="polite" aria-label="Search notice" data-search-notice hidden></p>'
        : `<p role="status" aria-live="polite" aria-label="Search notice" data-search-notice>${escapeHtml(
            result.notice
          )}</p>`
    }
    <ul aria-label="Active filters" class="active-filters" data-active-filters>${activeChips}</ul>
    <button type="button" data-clear-filters>Clear all filters</button>
    <a href="/compare?compare=${attr(compared.join(','))}" data-compare-link ${
      comparedSlugs.length > 0 ? '' : 'hidden'
    }>Compare ${comparedSlugs.length} selected</a>
    <div role="region" aria-label="Filters" class="filters-desktop" data-filters-region>
      ${filterMarkup('')}
    </div>
    <button type="button" class="filters-button" data-dialog-open="filters" aria-haspopup="dialog">Filters</button>
  </div>
  <div class="grid-zone">
    <label class="visually-hidden" for="sort-by">Sort by</label>
    <select id="sort-by" aria-label="Sort by" data-sort>
      <option value="featured" ${filters.sort === 'featured' ? 'selected' : ''}>Featured</option>
      <option value="price-asc" ${filters.sort === 'price-asc' ? 'selected' : ''}>Price: low to high</option>
      <option value="price-desc" ${filters.sort === 'price-desc' ? 'selected' : ''}>Price: high to low</option>
      <option value="newest" ${filters.sort === 'newest' ? 'selected' : ''}>Newest</option>
    </select>
    <div class="product-grid" data-grid>
      ${
        result.results.length === 0
          ? '<section class="panel colour-panel"><p>Nothing matches. Remove a filter or try another word.</p></section>'
          : result.results
              .map((item) => productCard(item, { compared: comparedSlugs, saved: wishlist.items.map((entry) => entry.slug) }))
              .join('')
      }
    </div>
    ${pagination}
  </div>
</div>
<dialog class="sheet filters-sheet" aria-label="Filters" data-dialog="filters" data-motion-ms="320" data-state="closed">
  <h2>Filters</h2>
  <div data-filters-sheet-body>${filterMarkup('-sheet')}</div>
  <button type="button" data-dialog-close="filters" data-show-results>Show results</button>
</dialog>`;

  return renderPage(shell, {
    title: collection.name,
    page: 'collection',
    content,
    bodyData: { collection: slug }
  });
}

function pageHref(ctx: Ctx, page: number): string {
  const params = new URLSearchParams(ctx.query);
  if (page === 1) params.delete('page');
  else params.set('page', String(page));
  const query = params.toString().replace(/%2C/g, ',');
  return query === '' ? ctx.pathname : `${ctx.pathname}?${query}`;
}

async function slugsForSkus(skus: string[]): Promise<string[]> {
  if (skus.length === 0) return [];
  const rows = await db.query<{ slug: string; sku: string }>(
    `SELECT p.slug, v.sku FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ANY($1::text[])`,
    [skus]
  );
  return skus.map((sku) => rows.find((row) => row.sku === sku)?.slug ?? '').filter((slug) => slug !== '');
}

function gateGauge(options: {
  variant: { height_cm: number; width_cm: number; depth_cm: number; weight_kg: number } | null;
  airlineCode: string;
  bagRadios?: Array<{ label: string; value: string; checked: boolean }>;
}): string {
  const airline = findAirline(options.airlineCode) ?? findAirline(DEFAULT_AIRLINE)!;
  const verdict =
    options.variant === null
      ? ''
      : cabinFit(
          {
            height: options.variant.height_cm,
            width: options.variant.width_cm,
            depth: options.variant.depth_cm
          },
          airline
        ).verdict;
  const maxValue = 20 + airline.width_cm;
  return `
<section role="group" aria-label="Gate Gauge" class="gate-gauge" data-gauge data-motion-ms="420" data-state="idle"
         data-airline="${attr(airline.code)}">
  <div role="radiogroup" aria-label="Airline" class="airlines" data-airline-group>
    ${AIRLINES.map(
      (item, index) => `<button type="button" role="radio" aria-label="${attr(item.name)}"
      aria-checked="${item.code === airline.code ? 'true' : 'false'}"
      tabindex="${item.code === airline.code ? '0' : index === 0 && airline.code === '' ? '0' : '-1'}"
      data-airline-option="${attr(item.code)}">${escapeHtml(item.name)}</button>`
    ).join('')}
  </div>
  ${
    options.bagRadios === undefined
      ? ''
      : `<div role="radiogroup" aria-label="Bag to fit" class="bag-choices" data-bag-group>
    ${options.bagRadios
      .map(
        (radio, index) => `<button type="button" role="radio" aria-label="${attr(radio.label)}"
      aria-checked="${radio.checked ? 'true' : 'false'}" tabindex="${radio.checked || (index === 0) ? '0' : '-1'}"
      data-bag-option="${attr(radio.value)}">${escapeHtml(radio.label)}</button>`
      )
      .join('')}
  </div>`
  }
  <div class="gauge-stage" data-gauge-stage>
    <div class="frame-outline" data-frame
         style="--frame-h:${airline.height_cm};--frame-w:${airline.width_cm}"></div>
    <div class="gauge-bag" role="slider" aria-label="Bag position" tabindex="0"
         aria-valuemin="0" aria-valuemax="${maxValue}" aria-valuenow="0" aria-valuetext="Outside the frame"
         data-gauge-bag></div>
  </div>
  <p role="status" aria-live="polite" aria-label="Fit verdict" data-verdict>${escapeHtml(verdict)}</p>
  <ul aria-label="Bag dimensions" class="dimension-list" data-dimensions>
    <li data-dimension="height">Height ${options.variant === null ? '0' : escapeHtml(String(options.variant.height_cm))} cm</li>
    <li data-dimension="width">Width ${options.variant === null ? '0' : escapeHtml(String(options.variant.width_cm))} cm</li>
    <li data-dimension="depth">Depth ${options.variant === null ? '0' : escapeHtml(String(options.variant.depth_cm))} cm</li>
    <li data-dimension="weight">Weight ${options.variant === null ? '0' : escapeHtml(String(options.variant.weight_kg))} kg</li>
  </ul>
</section>`;
}

export async function productPage(ctx: Ctx, shell: Shell, slug: string): Promise<string | null> {
  const [product] = await loadProducts(db, { slug, statuses: ['published'] });
  if (product === undefined) return null;
  const payload = productPayload(product, await savesCount(db, product.id));
  const requestedSku = ctx.query.get('sku');
  const variant =
    payload.variants.find((item) => item.sku === requestedSku) ?? payload.variants[0];
  const airlineCode = ctx.query.get('airline') ?? DEFAULT_AIRLINE;
  const colours = [...new Set(payload.variants.map((item) => item.colour))];
  const sizes = [...new Set(payload.variants.map((item) => item.size))];
  const save = savePercent(variant.price, variant.compare_at);
  const images = variant.images;

  const content = `
<div class="product-layout">
  <div class="left-zone">
    <table class="specs" aria-label="Specifications">
      <caption class="visually-hidden">Specifications</caption>
      <tbody>
        <tr><th scope="row">Dimensions</th><td data-spec-dimensions>${escapeHtml(
          `${variant.dimensions_cm.height} × ${variant.dimensions_cm.width} × ${variant.dimensions_cm.depth} cm`
        )}</td></tr>
        <tr><th scope="row">Weight</th><td data-spec-weight>${escapeHtml(`${variant.weight_kg} kg`)}</td></tr>
        <tr><th scope="row">Material</th><td>${escapeHtml(payload.material)}</td></tr>
        <tr><th scope="row">Warranty</th><td>${escapeHtml(
          `${payload.warranty_years} ${payload.warranty_years === 1 ? 'year' : 'years'}`
        )}</td></tr>
      </tbody>
    </table>
    <p data-saves>Saved by ${escapeHtml(String(payload.saves))}</p>
    <button type="button" data-save="${attr(payload.slug)}" aria-pressed="false">Save ${escapeHtml(
      payload.name
    )} to wishlist</button>
  </div>
  <div class="product-main">
    <h1>${escapeHtml(payload.name)}</h1>
    <p class="product-price" data-price>${escapeHtml(rupees(variant.price))}</p>
    ${
      variant.compare_at === null
        ? '<p class="product-save" data-save-copy hidden></p>'
        : `<p class="product-save" data-save-copy><s>${escapeHtml(
            rupees(variant.compare_at)
          )}</s> Save ${save}%</p>`
    }
    <section role="region" aria-label="Gallery" class="gallery" data-gallery data-motion-ms="280" data-state="idle">
      <img data-gallery-image src="${attr(images[0]?.url ?? '')}"
           alt="${attr(`${images[0]?.alt ?? payload.name}, view 1 of ${images.length}`)}">
      <div role="tablist" aria-label="Gallery views" class="thumbs" data-gallery-tabs>
        ${images
          .map(
            (image, index) =>
              `<button type="button" role="tab" aria-label="View ${index + 1}" aria-selected="${
                index === 0 ? 'true' : 'false'
              }" tabindex="${index === 0 ? '0' : '-1'}" data-view="${index + 1}"
                data-url="${attr(image.url)}" data-alt="${attr(image.alt)}">View ${index + 1}</button>`
          )
          .join('')}
      </div>
      <button type="button" data-zoom-open aria-haspopup="dialog">Zoom image</button>
    </section>
    <div class="pickers">
      <div role="radiogroup" aria-label="Colour" data-colour-group>
        ${colours
          .map(
            (colour, index) => `<button type="button" role="radio" aria-label="${attr(colour)}"
          aria-checked="${colour === variant.colour ? 'true' : 'false'}"
          tabindex="${colour === variant.colour ? '0' : '-1'}" data-colour="${attr(colour)}"
          data-index="${index}">${escapeHtml(colour)}</button>`
          )
          .join('')}
      </div>
      <div role="radiogroup" aria-label="Size" data-size-group>
        ${sizes
          .map(
            (size) => `<button type="button" role="radio" aria-label="${attr(size)}"
          aria-checked="${size === variant.size ? 'true' : 'false'}"
          tabindex="${size === variant.size ? '0' : '-1'}" data-size="${attr(size)}">${escapeHtml(size)}</button>`
          )
          .join('')}
      </div>
      <p role="status" aria-live="polite" aria-label="Selected variant" data-selected-variant>${escapeHtml(
        `SKU ${variant.sku} · ${rupees(variant.price)} · ${variant.badge}`
      )}</p>
      <p role="status" aria-live="polite" aria-label="Product updates" data-product-updates data-region="product-updates"></p>
      <button type="button" data-add-to-bag ${variant.badge === 'Out of stock' ? 'disabled' : ''}>${
        variant.badge === 'Out of stock' ? 'Out of stock' : 'Add to bag'
      }</button>
    </div>
    ${hasCabinFit(payload.category) ? gateGauge({ variant: { height_cm: variant.dimensions_cm.height, width_cm: variant.dimensions_cm.width, depth_cm: variant.dimensions_cm.depth, weight_kg: variant.weight_kg }, airlineCode }) : ''}
  </div>
</div>
<dialog aria-label="Zoomed image" data-dialog="zoom" data-motion-ms="320" data-state="closed">
  <img data-zoom-image src="${attr(images[0]?.url ?? '')}" alt="${attr(images[0]?.alt ?? payload.name)}">
  <button type="button" data-dialog-close="zoom">Close zoom</button>
</dialog>
<script type="application/json" id="product-data">${JSON.stringify(payload)}</script>`;

  return renderPage(shell, {
    title: payload.name,
    page: 'product',
    content,
    bodyData: { slug: payload.slug, sku: variant.sku }
  });
}

export async function comparePage(ctx: Ctx, shell: Shell): Promise<string> {
  const skus = (ctx.query.get('compare') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, config.compareMax);
  const airlineCode = ctx.query.get('airline') ?? DEFAULT_AIRLINE;
  const airline = findAirline(airlineCode) ?? findAirline(DEFAULT_AIRLINE)!;

  const rows =
    skus.length === 0
      ? []
      : await db.query<{
          sku: string;
          colour: string;
          size: string;
          price: number;
          height_cm: string;
          width_cm: string;
          depth_cm: string;
          weight_kg: string;
          product: string;
          slug: string;
          category: string;
          material: string;
          image_id: string | null;
        }>(
          `SELECT v.sku, v.colour, v.size, v.price, v.height_cm, v.width_cm, v.depth_cm, v.weight_kg,
                  p.name AS product, p.slug, p.category, p.material,
                  (SELECT id FROM product_images i WHERE i.product_id = p.id AND i.colour = v.colour
                   ORDER BY position ASC LIMIT 1) AS image_id
           FROM variants v JOIN products p ON p.id = v.product_id
           WHERE v.sku = ANY($1::text[]) AND p.status = 'published'`,
          [skus]
        );
  const ordered = skus.map((sku) => rows.find((row) => row.sku === sku)).filter((row) => row !== undefined) as typeof rows;

  const fitRows = ordered.map((row) => {
    if (!hasCabinFit(row.category)) return { sku: row.sku, verdict: 'No cabin fit for this item.' };
    return {
      sku: row.sku,
      verdict: cabinFit(
        { height: Number(row.height_cm), width: Number(row.width_cm), depth: Number(row.depth_cm) },
        airline
      ).verdict
    };
  });

  const fittable = ordered.filter((row) => hasCabinFit(row.category));

  const content = `
<h1>Compare</h1>
<p role="status" aria-live="polite" aria-label="Compare updates" data-compare-updates data-region="compare-updates"></p>
<div class="compare-scroll">
<table aria-label="Compare products" class="compare-table">
  <caption class="visually-hidden">Compare products</caption>
  <thead>
    <tr><td></td>${ordered
      .map(
        (row) =>
          `<th scope="col">${escapeHtml(row.product)}<button type="button" data-remove-compare="${attr(
            row.sku
          )}">Remove ${escapeHtml(row.product)} from comparison</button></th>`
      )
      .join('')}</tr>
  </thead>
  <tbody>
    <tr><th scope="row">Image</th>${ordered
      .map(
        (row) =>
          `<td>${
            row.image_id === null
              ? ''
              : `<img src="/media/products/${attr(row.image_id)}" alt="${attr(`${row.product} in ${row.colour}`)}">`
          }</td>`
      )
      .join('')}</tr>
    <tr><th scope="row">Price</th>${ordered.map((row) => `<td>${escapeHtml(rupees(row.price))}</td>`).join('')}</tr>
    <tr><th scope="row">Dimensions</th>${ordered
      .map(
        (row) => `<td>${escapeHtml(`${Number(row.height_cm)} × ${Number(row.width_cm)} × ${Number(row.depth_cm)} cm`)}</td>`
      )
      .join('')}</tr>
    <tr><th scope="row">Weight</th>${ordered
      .map((row) => `<td>${escapeHtml(`${Number(row.weight_kg)} kg`)}</td>`)
      .join('')}</tr>
    <tr><th scope="row">Material</th>${ordered.map((row) => `<td>${escapeHtml(row.material)}</td>`).join('')}</tr>
    <tr><th scope="row">Warranty</th>${ordered
      .map((row) => {
        const years = warrantyYearsFor(row.category);
        return `<td>${escapeHtml(`${years} ${years === 1 ? 'year' : 'years'}`)}</td>`;
      })
      .join('')}</tr>
    <tr><th scope="row">Cabin verdict</th>${fitRows
      .map((row) => `<td data-verdict-for="${attr(row.sku)}">${escapeHtml(row.verdict)}</td>`)
      .join('')}</tr>
  </tbody>
</table>
</div>
${
  fittable.length === 0
    ? ''
    : gateGauge({
        variant: {
          height_cm: Number(fittable[0].height_cm),
          width_cm: Number(fittable[0].width_cm),
          depth_cm: Number(fittable[0].depth_cm),
          weight_kg: Number(fittable[0].weight_kg)
        },
        airlineCode: airline.code,
        bagRadios: fittable.map((row, index) => ({
          label: row.product,
          value: row.sku,
          checked: index === 0
        }))
      })
}
<script type="application/json" id="compare-data">${JSON.stringify(
    ordered.map((row) => ({
      sku: row.sku,
      product: row.product,
      slug: row.slug,
      category: row.category,
      height_cm: Number(row.height_cm),
      width_cm: Number(row.width_cm),
      depth_cm: Number(row.depth_cm),
      weight_kg: Number(row.weight_kg)
    }))
  )}</script>`;

  return renderPage(shell, { title: 'Compare', page: 'compare', content });
}

export async function wishlistPage(ctx: Ctx, shell: Shell): Promise<string> {
  const wishlist = await loadWishlist(db, { sessionId: ctx.sessionId, userId: ctx.user?.id ?? null });
  const products =
    wishlist.items.length === 0
      ? []
      : await loadProducts(db, { slugs: wishlist.items.map((item) => item.slug), statuses: ['published'] });
  const ordered = wishlist.items
    .map((item) => products.find((product) => product.slug === item.slug))
    .filter((product): product is ProductRecord => product !== undefined);

  const cards = ordered.map((product) => {
    const cheapest = product.variants.reduce((low, variant) => (variant.price < low.price ? variant : low));
    const item: SearchResultItem = {
      slug: product.slug,
      name: product.name,
      category: product.category,
      min_price: cheapest.price,
      price_varies: new Set(product.variants.map((variant) => variant.price)).size > 1,
      compare_at: cheapest.compare_at,
      save_percent: savePercent(cheapest.price, cheapest.compare_at),
      colours: [...new Set(product.variants.map((variant) => variant.colour))].map((colour) => {
        const image = product.images.filter((entry) => entry.colour === colour).sort((a, b) => a.position - b.position)[0];
        return {
          name: colour,
          slug: product.variants.find((variant) => variant.colour === colour)!.colour_slug,
          image_url: image === undefined ? '' : `/media/products/${image.id}`
        };
      }),
      badge: stockBadge(productAvailable(product))
    };
    return productCard(item, { compared: [], saved: wishlist.items.map((entry) => entry.slug) });
  });

  const content = `
<h1>Wishlist</h1>
${
  cards.length === 0
    ? '<section class="panel colour-panel"><p>Nothing saved yet.</p></section>'
    : `<div class="product-grid">${cards.join('')}</div>`
}`;
  return renderPage(shell, { title: 'Wishlist', page: 'wishlist', content });
}

function holdCopy(): string {
  const seconds = config.reservationTtlSeconds;
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  return `${seconds} seconds`;
}

function yearsCopy(years: number): string {
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}

export function carePage(ctx: Ctx, shell: Shell): string {
  const content = `
<h1>Care</h1>
<p>Your bag is held for ${escapeHtml(holdCopy())} once you press Pay.</p>
<p>Returns are open for ${escapeHtml(String(config.returnWindowDays))} days after delivery.</p>
<p>Trial returns are open for ${escapeHtml(
    String(config.trialWindowDays)
  )} days after delivery on luggage, backpacks and totes.</p>
<p>Luggage is covered for ${escapeHtml(yearsCopy(config.warrantyYearsLuggage))} from delivery.</p>
<p>Backpacks and totes are covered for ${escapeHtml(yearsCopy(config.warrantyYearsBags))} from delivery.</p>
<p>Wallets and accessories are covered for ${escapeHtml(
    yearsCopy(config.warrantyYearsAccessories)
  )} from delivery.</p>`;
  return renderPage(shell, { title: 'Care', page: 'care', content });
}

export function signInPage(ctx: Ctx, shell: Shell): string {
  const content = `
<h1>Sign in</h1>
<form data-sign-in novalidate>
  <label for="sign-in-email">Email</label>
  <input id="sign-in-email" type="text" aria-label="Email" autocomplete="email">
  <label for="sign-in-password">Password</label>
  <input id="sign-in-password" type="password" autocomplete="current-password">
  <div role="alert" data-form-error></div>
  <button type="submit">Sign in</button>
</form>
<a href="/register">Create an account</a>`;
  return renderPage(shell, { title: 'Sign in', page: 'sign-in', content });
}

export function registerPage(ctx: Ctx, shell: Shell): string {
  const content = `
<h1>Create account</h1>
<form data-register novalidate>
  <label for="register-name">Name</label>
  <input id="register-name" type="text" aria-label="Name" autocomplete="name" aria-describedby="register-name-error">
  <p class="field-error" id="register-name-error" data-error-for="name"></p>
  <label for="register-email">Email</label>
  <input id="register-email" type="text" aria-label="Email" autocomplete="email" aria-describedby="register-email-error">
  <p class="field-error" id="register-email-error" data-error-for="email"></p>
  <label for="register-password">Password</label>
  <input id="register-password" type="password" autocomplete="new-password" aria-describedby="register-password-error">
  <p class="field-error" id="register-password-error" data-error-for="password"></p>
  <div role="alert" data-form-error></div>
  <button type="submit">Create account</button>
</form>`;
  return renderPage(shell, { title: 'Create account', page: 'register', content });
}
