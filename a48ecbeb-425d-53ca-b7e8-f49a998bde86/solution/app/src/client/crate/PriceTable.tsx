import { money, rateText } from "../../shared/format";

interface Figures {
  goods_cents: number;
  discount_cents: number;
  deposit_cents: number;
  shipping_cents: number;
  taxes: { name: string; rate: string; cents: number }[];
  total_cents: number;
}

/** The price breakdown rows, showing the server's figures exactly. */
export function PriceTable({ figures, subscribed, hasCans, stale = false }: { figures: Figures; subscribed: boolean; hasCans: boolean; stale?: boolean }) {
  return (
    <table className={`price-table ${stale ? "is-stale" : ""}`} aria-label="Price breakdown">
      <tbody>
        <tr>
          <th scope="row">Subtotal</th>
          <td className="num">{money(figures.goods_cents)}</td>
        </tr>
        {subscribed && (
          <tr className="discount">
            <th scope="row">Subscribe &amp; save (10%)</th>
            <td className="num">{money(-figures.discount_cents)}</td>
          </tr>
        )}
        <tr>
          <th scope="row">Deposit</th>
          <td className="num">{money(figures.deposit_cents)}</td>
        </tr>
        <tr>
          <th scope="row">Shipping</th>
          <td className="num">{figures.shipping_cents === 0 && hasCans ? "Free" : money(figures.shipping_cents)}</td>
        </tr>
        {figures.taxes.map((t) => (
          <tr key={t.name}>
            <th scope="row">{`${t.name} (${rateText(t.rate)}%)`}</th>
            <td className="num">{money(t.cents)}</td>
          </tr>
        ))}
        <tr className="total-row">
          <th scope="row">Total</th>
          <td className="num">{money(figures.total_cents)}</td>
        </tr>
      </tbody>
    </table>
  );
}
