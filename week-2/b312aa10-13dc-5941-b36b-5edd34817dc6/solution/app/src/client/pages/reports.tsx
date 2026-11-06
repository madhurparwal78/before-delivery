import { useEffect, useState } from "preact/hooks";
import { ApiFailure, get } from "../api.js";
import { MonthField, useLatest } from "../ui.js";
import { useMonthAddress } from "./bookings.js";
import type { Utilisation } from "../types.js";
import { hoursText, money, quartersOf } from "../../shared/format.js";
import { monthName } from "../../shared/time.js";

const hours = (n: number): string => hoursText(quartersOf(n));

export function ReportsScreen() {
  const { month, set } = useMonthAddress("/reports");
  const [report, setReport] = useState<Utilisation | null>(null);
  const [monthError, setMonthError] = useState<string | undefined>();
  const begin = useLatest();
  useEffect(() => {
    // Only the answer for the month in the address is drawn; an earlier month's late answer is dropped.
    const current = begin();
    setReport(null);
    setMonthError(undefined);
    get<Utilisation>(`/api/reports/utilisation?month=${encodeURIComponent(month)}`).then(({ data }) => {
      if (!current() || data.month !== month) return;
      setReport(data);
    }, (error: unknown) => {
      if (!current()) return;
      if (error instanceof ApiFailure && error.fieldErrors.month) setMonthError(error.fieldErrors.month);
    });
  }, [month]);
  const shown = report && report.month === month ? report : null;
  return (
    <div class="screen">
      <h1>Reports</h1>
      <section class="panel">
        <div class="toolbar">
          <MonthField label="Month" value={month} error={monthError} onCommit={set} />
        </div>
        <div role="region" aria-label="Utilisation report" aria-busy={!monthError && !shown ? "true" : "false"}>
        {!monthError && !shown && <p class="loading">Loading…</p>}
        {!monthError && shown && <h2>Utilisation for {monthName(shown.month)}</h2>}
        {!monthError && shown && (
          <table class="table" aria-label="Utilisation">
            <thead><tr><th scope="col">Station</th><th scope="col" class="num">Booked hours</th><th scope="col" class="num">Peak hours</th><th scope="col" class="num">Shelf days</th><th scope="col" class="num">Revenue</th><th scope="col" class="num">Adjustments</th></tr></thead>
            <tbody>
              {shown.stations.map((r) => (
                <tr>
                  <th scope="row" data-label="Station">{r.name}</th>
                  <td data-label="Booked hours" class="num">{hours(r.bookedHours)}</td>
                  <td data-label="Peak hours" class="num">{hours(r.peakHours)}</td>
                  <td data-label="Shelf days" class="num">{r.shelfDays}</td>
                  <td data-label="Revenue" class="num">{money(r.revenueCents)}</td>
                  <td data-label="Adjustments" class="num">—</td>
                </tr>
              ))}
              <tr class="totals">
                <th scope="row" data-label="Station">Totals</th>
                <td data-label="Booked hours" class="num">{hours(shown.totals.bookedHours)}</td>
                <td data-label="Peak hours" class="num">{hours(shown.totals.peakHours)}</td>
                <td data-label="Shelf days" class="num">{shown.totals.shelfDays}</td>
                <td data-label="Revenue" class="num">{money(shown.totals.revenueCents)}</td>
                <td data-label="Adjustments" class="num">Adjustments {money(shown.totals.adjustmentCents)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {!monthError && shown && <p><a class="btn btn-link" href={`/api/exports/usage.csv?month=${shown.month}`}>Export usage CSV</a></p>}
        </div>
      </section>
    </div>
  );
}
