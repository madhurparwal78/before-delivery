import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api } from '../lib/api.js';
import { navigate, usePath } from '../lib/router.js';
import { announce, LoadingPanel, ErrorPanel } from '../app.js';
import { GateGauge, type GaugeBag } from '../components/gauge.js';
import type { ProductDetail } from './collection.js';

const FIT_CATEGORIES = new Set(['luggage', 'backpacks', 'totes']);

export function Compare(): JSX.Element {
  const path = usePath();
  const url = useMemo(() => new URL(path, location.origin), [path]);
  const [skus, setSkus] = useState<string[]>([]);
  const [details, setDetails] = useState<ProductDetail[]>([]);
  const [failed, setFailed] = useState(false);
  const [airline, setAirline] = useState('skyline-indus');
  const [selectedBag, setSelectedBag] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const compareParam = url.searchParams.get('compare') ?? '';
    const list = compareParam === '' ? [] : compareParam.split(',').filter(Boolean);
    setSkus(list);
    setLoaded(false);
    const products = new Map<string, ProductDetail>();
    void Promise.all(list.map(async (sku) => {
      const row = await api.get<{ product_slug: string }>(`/api/products/variant-lookup/${sku}`).catch(() => null);
      return row;
    })).then(() => undefined);
    // Each SKU resolves to its product; the product endpoint lists all variants.
    void (async () => {
      const gathered: ProductDetail[] = [];
      const seen = new Set<string>();
      for (const sku of list) {
        const detail = await findProduct(sku);
        if (detail !== null && !seen.has(detail.slug)) {
          seen.add(detail.slug);
          gathered.push(detail);
        }
      }
      setDetails(gathered);
      setLoaded(true);
    })().catch(() => setFailed(true));
  }, [path]);

  const rows = details.map((detail) => {
    const variant = detail.variants.find((v) => skus.some((s) => v.sku === s)) ?? detail.variants[0];
    return { detail, variant };
  });

  const gaugeBags: GaugeBag[] = rows
    .filter((r) => FIT_CATEGORIES.has(r.detail.category))
    .map((r) => ({ sku: r.variant.sku, name: r.detail.name, height: r.variant.dimensions_cm.height, width: r.variant.dimensions_cm.width, depth: r.variant.dimensions_cm.depth, weight: r.variant.weight_kg, colour: r.variant.colour }));

  const activeSku = selectedBag ?? gaugeBags[0]?.sku ?? null;

  const remove = (slug: string): void => {
    const next = new URL(location.href);
    const remaining = rows.filter((r) => r.detail.slug !== slug).map((r) => r.variant.sku).join(',');
    if (remaining === '') next.searchParams.delete('compare');
    else next.searchParams.set('compare', remaining);
    announce('compare-updates', `Removed ${rows.find((r) => r.detail.slug === slug)?.detail.name} from comparison.`);
    navigate(next.pathname + (next.search === '' ? '' : next.search), false);
  };

  if (failed) return <ErrorPanel message="Something went wrong on our side. Try again." />;
  if (!loaded) return <LoadingPanel />;

  if (rows.length === 0) {
    return (
      <section class="panel empty-panel">
        <h1>Compare</h1>
        <p>Nothing to compare yet. Choose a few bags from a collection.</p>
      </section>
    );
  }

  return (
    <div class="compare-page">
      <h1>Compare</h1>
      {gaugeBags.length > 0 ? (
        <GateGauge
          airline={airline}
          bags={gaugeBags}
          selectedSku={activeSku ?? ''}
          onAirlineChange={setAirline}
          onSelectBag={setSelectedBag}
          showPicker
        />
      ) : null}
      <div class="compare-scroll">
        <table aria-label="Compare products" class="compare-table">
          <thead>
            <tr>
              <th scope="col"><span class="visually-hidden">Property</span></th>
              {rows.map((r) => (
                <th key={r.detail.slug} scope="col">
                  {r.detail.name}
                  <button aria-label={`Remove ${r.detail.name} from comparison`} onClick={() => remove(r.detail.slug)}>Remove</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Image</th>
              {rows.map((r) => (
                <td key={r.detail.slug}><img src={r.variant.images[0]?.url} alt={`${r.detail.name} in ${r.variant.colour}`} /></td>
              ))}
            </tr>
            <tr>
              <th scope="row">Price</th>
              {rows.map((r) => <td key={r.detail.slug}>₹{r.variant.price}</td>)}
            </tr>
            <tr>
              <th scope="row">Dimensions</th>
              {rows.map((r) => <td key={r.detail.slug}>{r.variant.dimensions_cm.height} × {r.variant.dimensions_cm.width} × {r.variant.dimensions_cm.depth} cm</td>)}
            </tr>
            <tr>
              <th scope="row">Weight</th>
              {rows.map((r) => <td key={r.detail.slug}>{r.variant.weight_kg} kg</td>)}
            </tr>
            <tr>
              <th scope="row">Material</th>
              {rows.map((r) => <td key={r.detail.slug}>{r.detail.material}</td>)}
            </tr>
            <tr>
              <th scope="row">Warranty</th>
              {rows.map((r) => <td key={r.detail.slug}>{r.detail.warranty_years} {r.detail.warranty_years === 1 ? 'year' : 'years'}</td>)}
            </tr>
            <tr>
              <th scope="row">Cabin verdict</th>
              {rows.map((r) => (
                <td key={r.detail.slug}>
                  <FitCell sku={r.variant.sku} airline={airline} fitsCategory={FIT_CATEGORIES.has(r.detail.category)} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FitCell(props: { sku: string; airline: string; fitsCategory: boolean }): JSX.Element {
  const [verdict, setVerdict] = useState<string | null>(null);
  useEffect(() => {
    if (!props.fitsCategory) return;
    void api.get<{ verdict: string }>(`/api/fit?sku=${props.sku}&airline=${props.airline}`)
      .then((v) => setVerdict(v.verdict))
      .catch(() => setVerdict(null));
  }, [props.sku, props.airline]);
  if (!props.fitsCategory) return <td>No cabin fit for this item.</td>;
  return <td>{verdict ?? ''}</td>;
}

type SearchList = { results: { slug: string }[]; total: number };

async function findProduct(sku: string): Promise<ProductDetail | null> {
  const all = await api.get<SearchList>('/api/search?collection=all&page_size=200');
  for (const candidate of all.results) {
    const detail = await api.get<ProductDetail>(`/api/products/${candidate.slug}`).catch(() => null);
    if (detail !== null && detail.variants.some((v) => v.sku === sku)) return detail;
  }
  return null;
}
