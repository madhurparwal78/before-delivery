// Usage (operator): daily usage totals by kitchen date and the monthly usage CSV export.

import { useState } from "preact/hooks";
import type { Usage } from "../../shared/api.js";
import { formatHours } from "../../shared/rules.js";
import type { Session } from "../App.js";
import { get } from "../api.js";
import { Download } from "../icons.js";
import { Cell, EmptyRow, ScreenHead, useData } from "./shared.js";

export function UsageScreen({ session }: { session: Session }) {
  const [date, setDate] = useState(session.kitchen.today);
  const [month, setMonth] = useState(session.kitchen.today.slice(0, 7));
  const usage = useData(() => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? get<Usage>(`/api/usage?date=${date}`) : Promise.resolve(null)), [date]);
  const rows = usage.data?.stations ?? [];
  return (
    <section class="screen">
      <ScreenHead title="Usage">
        <p class="screen-head__note">Bookings count on their kitchen date ({session.kitchen.time_zone}).</p>
      </ScreenHead>
      <div class="panel form-inline">
        <label class="field">
          <span class="field__label">Usage date</span>
          <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
        </label>
      </div>
      <table class="table">
        <caption>Daily usage</caption>
        <thead>
          <tr>
            <th scope="col">Station</th>
            <th scope="col" class="num">
              Booked
            </th>
            <th scope="col" class="num">
              Cleaning
            </th>
            <th scope="col" class="num">
              Bookings
            </th>
          </tr>
        </thead>
        <tbody>
          {!usage.data && <EmptyRow columns={4}>Loading…</EmptyRow>}
          {rows.map((s) => (
            <tr key={s.station_id}>
              <Cell label="Station">{s.station_name}</Cell>
              <Cell label="Booked" numeric>
                {formatHours(s.booked_minutes)} h
              </Cell>
              <Cell label="Cleaning" numeric>
                {formatHours(s.cleaning_minutes)} h
              </Cell>
              <Cell label="Bookings" numeric>
                {s.bookings}
              </Cell>
            </tr>
          ))}
        </tbody>
        {usage.data && (
          <tfoot>
            <tr>
              <Cell label="Station">Total</Cell>
              <Cell label="Booked" numeric>
                {formatHours(usage.data.total_booked_minutes)} h
              </Cell>
              <Cell label="Cleaning" numeric>
                {formatHours(rows.reduce((sum, s) => sum + s.cleaning_minutes, 0))} h
              </Cell>
              <Cell label="Bookings" numeric>
                {rows.reduce((sum, s) => sum + s.bookings, 0)}
              </Cell>
            </tr>
          </tfoot>
        )}
      </table>
      <div class="panel form-inline">
        <label class="field">
          <span class="field__label">Export month</span>
          <input type="month" value={month} onInput={(e) => setMonth(e.currentTarget.value)} />
        </label>
        <a class="button" href={`/api/exports/usage.csv?month=${month}`} download={`passboard-usage-${month}.csv`}>
          <Download />
          <span>Export month CSV</span>
        </a>
      </div>
    </section>
  );
}
