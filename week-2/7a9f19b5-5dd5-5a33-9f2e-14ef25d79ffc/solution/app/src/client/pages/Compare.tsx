import { useEffect, useState } from "react";
import type { ComparisonItem } from "../../shared/types";
import { EmptyDrawing } from "../components/Drawings";
import { request } from "../lib/api";
import { plusGst, tierPrice } from "../lib/format";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";
import { useTray } from "../lib/tray";

const ROWS: { label: string; value: (item: ComparisonItem, seesTrade: boolean) => string; mono?: boolean }[] = [
  { label: "Code", value: (i) => i.code, mono: true },
  { label: "Finish", value: (i) => i.finish_name },
  { label: "Beam", value: (i) => `${i.beam_deg}°`, mono: true },
  { label: "Colour temperature", value: (i) => `${i.cct_k}K`, mono: true },
  { label: "Lumens", value: (i) => String(i.lumens), mono: true },
  { label: "Candela", value: (i) => String(i.candela), mono: true },
  { label: "Watts", value: (i) => `${i.watts} W`, mono: true },
  { label: "CRI", value: (i) => String(i.cri), mono: true },
  { label: "IP rating", value: (i) => i.ip_rating, mono: true },
  { label: "Price", value: (i, trade) => plusGst(tierPrice(i, trade)), mono: true },
  { label: "Pool diameter at 2.7 m", value: (i) => `${i.pool_diameter_mm_at_2700} mm`, mono: true },
  { label: "Centre lux at 2.7 m", value: (i) => `${i.centre_lux_at_2700} lux`, mono: true },
];

export function Compare() {
  const { items: tray } = useTray();
  const { seesTrade } = useSession();
  const [items, setItems] = useState<ComparisonItem[] | null>(null);
  const codes = tray.map((item) => item.code).join(",");

  useEffect(() => {
    document.title = "Comparison · Lightfall";
  }, []);

  useEffect(() => {
    if (!codes) {
      setItems([]);
      return;
    }
    void request<{ items: ComparisonItem[] }>(`/api/compare?codes=${encodeURIComponent(codes)}`).then(
      (reply) => reply.ok && setItems(reply.data.items),
    );
  }, [codes, seesTrade]);

  return (
    <div className="compare">
      <header className="page-head">
        <p className="eyebrow">Side by side</p>
        <h1>Comparison</h1>
      </header>
      {items && items.length === 0 && (
        <div className="empty-state">
          <EmptyDrawing />
          <p>Choose Compare on up to four fittings in the catalogue to see them here.</p>
          <Link href="/catalogue" className="button button--primary">
            Browse the catalogue
          </Link>
        </div>
      )}
      {items && items.length > 0 && (
        <table aria-label="Comparison" className="data-table compare__table">
          <thead>
            <tr>
              <th scope="col">Product</th>
              {items.map((item) => (
                <th scope="col" key={item.code}>
                  <Link href={`/products/${item.product_slug}?variant=${item.code}`}>{item.product_name}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {items.map((item) => (
                  <td key={item.code} className={row.mono ? "mono" : undefined}>
                    {row.value(item, seesTrade)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
