// The facts of one sealed figure, as the server returned them (Figure screen and regulator page).

import { minuteDisplay, signed } from "../format";
import type { Figure } from "../types";
import { ContributionsTable, Num } from "./tables";

export function FigureFacts({ figure }: { figure: Figure }) {
  const facts: [string, React.ReactNode][] = [
    ["Interval", <><Num>{minuteDisplay(figure.start)}</Num> to <Num>{minuteDisplay(figure.end)}</Num></>],
    ["Sensors", <span className="id-list">{figure.sensor_ids.map((id) => <Num key={id}>{id}</Num>)}</span>],
    ["Coverage", <Num>{figure.coverage_pct}%</Num>],
    ["Coverage floor", <Num>{figure.floor_pct}%</Num>],
    ["Net tCO2e", <Num className="strong">{signed(figure.net_tco2e)}</Num>],
    ["CO2 tCO2e", <Num>{signed(figure.co2_tco2e)}</Num>],
    ["CH4 tCO2e", <Num>{signed(figure.ch4_tco2e)}</Num>],
    ["Buffer tCO2e", <><Num>{figure.buffer_tco2e}</Num> <span className="muted-note">at <Num>{figure.buffer_pct}%</Num></span></>],
    ["Credited tCO2e", <Num className="strong">{signed(figure.credited_tco2e)}</Num>],
    ["Readings", <Num>{figure.readings_count}</Num>],
  ];
  return (
    <>
      <dl className="facts">
        {facts.map(([label, value]) => (
          <div key={label} className="fact">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="fact fact-wide">
          <dt>Fingerprint</dt>
          <dd className="num fingerprint">{figure.fingerprint}</dd>
        </div>
      </dl>
      <div className="breakdown-section">
        <h2>Unit breakdown</h2>
        <ContributionsTable
          name="Unit breakdown"
          contributions={figure.contributions}
          totals={{ co2: figure.co2_tco2e, ch4: figure.ch4_tco2e, net: figure.net_tco2e }}
        />
      </div>
    </>
  );
}
