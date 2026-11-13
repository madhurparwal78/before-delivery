import { plural } from "../../shared/format";
import { useConfig } from "../lib/store";
import "../styles/shop.css";

function holdLength(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${plural(minutes, "minute", "minutes")}`;
  }
  return `${seconds} seconds`;
}

function years(n: number): string {
  return `${n} ${plural(n, "year", "years")}`;
}

export function Care(_props: object) {
  const config = useConfig();
  return (
    <div className="page">
      <div className="axis">
        <div className="zone" />
        <div className="main prose">
          <h1>Care</h1>
          <p>Your bag is held for {holdLength(config.reservation_ttl_seconds)} once you press Pay.</p>
          <p>Returns are open for {config.return_window_days} days after delivery.</p>
          <p>Trial returns are open for {config.trial_window_days} days after delivery on luggage, backpacks and totes.</p>
          <p>Luggage is covered for {years(config.warranty_years_luggage)} from delivery.</p>
          <p>Backpacks and totes are covered for {years(config.warranty_years_bags)} from delivery.</p>
          <p>Wallets and accessories are covered for {years(config.warranty_years_accessories)} from delivery.</p>
        </div>
      </div>
    </div>
  );
}
