import { useCallback, useEffect, useRef, useState } from "react";
import type { Report } from "../shared/api";
import { formatMoney } from "../shared/money";
import { get } from "./api";
import { useSequence } from "./hooks";
import { useLive } from "./live";
import { TopBar } from "./Shell";
import { FieldMessage } from "./ui";

const FIGURES: { name: string; read: (report: Report) => string }[] = [
  { name: "Rooms available", read: (report) => String(report.roomsAvailable) },
  { name: "Rooms sold", read: (report) => String(report.roomsSold) },
  { name: "Room revenue", read: (report) => formatMoney(report.roomRevenueCents) },
  { name: "Occupancy", read: (report) => report.occupancy },
  { name: "Average daily rate", read: (report) => report.averageDailyRate },
  { name: "Revenue per available room", read: (report) => report.revenuePerAvailableRoom },
];

export function Reports() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const applied = useRef({ from: "", to: "" });
  const sequence = useSequence();

  const load = useCallback(async (range: { from: string; to: string }) => {
    const id = sequence.next();
    const answer = await get<Report>(`/api/reports?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
    if (!sequence.isNewest(id)) return;
    if (answer.ok) {
      setReport(answer.data);
      setError("");
    } else setError(Object.values(answer.errors)[0] ?? answer.error);
  }, [sequence]);

  useEffect(() => {
    void get<{ hotel: { businessDate: string } }>("/api/desk").then(async (answer) => {
      if (!answer.ok) return;
      const date = answer.data.hotel.businessDate;
      applied.current = { from: date, to: date };
      setFrom(date);
      setTo(date);
      await load(applied.current);
    });
  }, [load]);
  useLive(() => void (applied.current.from && load(applied.current)));

  return (
    <>
      <TopBar />
      <main className="page two-column">
        <div className="column-left">
          <h1>Reports</h1>
          <form
            className="sheet"
            onSubmit={(event) => {
              event.preventDefault();
              applied.current = { from, to };
              void load(applied.current);
            }}
          >
            <label>
              From
              <input type="text" placeholder="YYYY-MM-DD" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label>
              To
              <input type="text" placeholder="YYYY-MM-DD" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <FieldMessage message={error} />
            <button type="submit" className="primary">Show figures</button>
          </form>
          <div className="figures">
            {FIGURES.map((figure) => (
              <div key={figure.name}>
                <span>{figure.name}</span>
                <span role="status" aria-label={figure.name} className="money figure-value">{report ? figure.read(report) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="column-right">
          <h2>Nightly figures</h2>
          <div className="table-frame" tabIndex={0} role="group" aria-label="Nightly figures, scrollable">
            <table aria-label="Nightly figures" className="ledger">
              <thead>
                <tr>
                  {["Date", "Rooms available", "Rooms sold", "Room revenue", "Occupancy", "Average daily rate", "Revenue per available room"].map((heading, index) => (
                    <th key={heading} scope="col" className={index === 0 ? undefined : "money-head"}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report?.nights.map((night) => (
                  <tr key={night.date}>
                    <td>{night.date}</td>
                    <td className="money">{night.roomsAvailable}</td>
                    <td className="money">{night.roomsSold}</td>
                    <td className="money">{formatMoney(night.roomRevenueCents)}</td>
                    <td className="money">{night.occupancy}</td>
                    <td className="money">{night.averageDailyRate}</td>
                    <td className="money">{night.revenuePerAvailableRoom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
