import { useDecimals } from "../state.tsx";
import { Fig, Mono, widestDecimals } from "../ui.tsx";
import { STATE_LABEL, type Leg, type PositionState } from "../types.ts";
import { displayHealth } from "../../shared/format.ts";

// Pieces several views share: the state stamp, the health factor plumb line and the legs table.

export const LIQUIDATION_STATES: PositionState[] = ["liquidatable_grace", "liquidatable", "partially_liquidated"];

export function StateLabel({ state, role }: { state: PositionState; role?: "status" }) {
  const tone = LIQUIDATION_STATES.includes(state) ? "stamp-signal" : state === "warned" ? "stamp-caution" : state === "closed" ? "stamp-closed" : "stamp-ink";
  return role ? (
    <span role="status" aria-label="Position state" className={`stamp ${tone}`}>
      {STATE_LABEL[state]}
    </span>
  ) : (
    <span className={`stamp ${tone}`}>{STATE_LABEL[state]}</span>
  );
}

/** Splits a 4-decimal health factor string into whole units and ten-thousandths, without floating point. */
function scaledHealthFactor(hf: string): number {
  const [whole = "0", fraction = "0000"] = hf.split(".");
  return Number.parseInt(whole, 10) * 10_000 + Number.parseInt(fraction.padEnd(4, "0").slice(0, 4), 10);
}

/**
 * The health factor plumb line: a horizontal line from 0 to 2 with a heavy rule at 1.00, a thin rule at the
 * warning level and a marker at the server's health factor (pinned at the right end above 2; absent with no debt).
 */
/** `below` comes from the server's position state, never from comparing figures in the browser. */
export function PlumbLine({ healthFactor, warning, below }: { healthFactor: string | null; warning: string; below: boolean }) {
  // Positions along the line in per-mille of its width, from health factor 0 to 2.
  const at = (scaled: number) => (Math.min(scaled, 20_000) / 20_000) * 1000;
  const warn = at(scaledHealthFactor(warning));
  const marker = healthFactor === null ? null : at(scaledHealthFactor(healthFactor));
  const left = (permille: number) => ({ left: `${permille / 10}%` });
  return (
    <div className="plumb" role="img" aria-label={healthFactor === null ? "Health factor: no debt" : `Health factor ${displayHealth(healthFactor)}`}>
      <svg viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="1000" y1="30" y2="30" className="plumb-line" />
        {[0, 5_000, 15_000, 20_000].map((scaled) => (
          <line key={scaled} x1={at(scaled)} x2={at(scaled)} y1="24" y2="36" className="plumb-tick" />
        ))}
        <line x1={at(10_000)} x2={at(10_000)} y1="4" y2="56" className="plumb-one" />
        <line x1={warn} x2={warn} y1="12" y2="48" className="plumb-warn" />
        {marker === null ? null : <line x1={marker} x2={marker} y1="14" y2="34" className={below ? "plumb-bob plumb-marker-signal" : "plumb-bob"} />}
      </svg>
      <span className="plumb-label plumb-label-top" style={left(at(10_000))}>1,00</span>
      <span className="plumb-label plumb-label-top plumb-label-after" style={left(warn)}>{displayHealth(warning).slice(0, 4)}</span>
      <span className="plumb-label plumb-label-start" style={left(0)}>0</span>
      <span className="plumb-label plumb-label-end" style={left(1000)}>2,00</span>
      {marker === null ? null : (
        <svg className={`plumb-marker${below ? " plumb-marker-signal" : ""}`} style={left(marker)} viewBox="0 0 16 14" width="16" height="14" aria-hidden="true">
          <path d="M8 0 L16 14 H0 Z" />
        </svg>
      )}
    </div>
  );
}

export function LegsTable({ legs, label }: { legs: Leg[]; label: string }) {
  const decimalsOf = useDecimals();
  const pad = widestDecimals(legs.map((l) => l.asset), decimalsOf);
  return (
    <table aria-label={label} className="ledger-table legs-table">
      <thead>
        <tr>
          <th scope="col">Account</th>
          <th scope="col">Asset</th>
          <th scope="col" className="num">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {legs.map((leg, index) => (
          <tr key={`${leg.account}-${leg.asset}-${index}`}>
            <td data-label="Account">
              <Mono>{leg.account}</Mono>
            </td>
            <td data-label="Asset">{leg.asset}</td>
            <td data-label="Amount" className="num">
              <Fig minor={leg.amount} decimals={decimalsOf(leg.asset)} pad={pad} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
