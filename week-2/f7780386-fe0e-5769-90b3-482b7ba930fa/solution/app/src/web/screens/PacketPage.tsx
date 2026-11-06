// The public packet page at /packet/<token>: read-only visits for the inspector, and the PDF download.

import type { PacketSnapshot } from "../../shared/api.js";
import { longDate } from "../../shared/zone.js";
import { get } from "../api.js";
import { kitchenClock } from "../format.js";
import { Download } from "../icons.js";
import { Cell, useData } from "./shared.js";

const validWord = (valid: boolean) => (valid ? "Valid" : "Not valid");

export function PacketPage({ token }: { token: string }) {
  const packet = useData(() => get<PacketSnapshot>(`/api/packet/${encodeURIComponent(token)}`), [token]);
  if (packet.failed) {
    return (
      <main class="packet" id="main">
        <h1 class="packet__title">Compliance packet</h1>
        <p class="packet__invalid">This packet link is not valid.</p>
      </main>
    );
  }
  const data = packet.data;
  if (!data) return <main class="packet" id="main" aria-busy="true" />;
  return (
    <main class="packet" id="main">
      <header class="packet__head">
        <p class="packet__kitchen">{data.kitchen}</p>
        <h1 class="packet__title">Compliance packet</h1>
        <p class="packet__range">
          {longDate(data.from)} to {longDate(data.to)} ({data.from} to {data.to}) · times are kitchen time ({data.time_zone})
        </p>
        <a class="button button--primary" href={`/api/packet/${encodeURIComponent(token)}/pdf`} download>
          <Download />
          <span>Download PDF</span>
        </a>
      </header>
      <table class="table">
        <caption>Kitchen visits</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Business</th>
            <th scope="col">Station</th>
            <th scope="col">Time</th>
            <th scope="col">Insurance</th>
            <th scope="col">Crew and card</th>
          </tr>
        </thead>
        <tbody>
          {data.days.length === 0 && (
            <tr class="table__empty">
              <td colSpan={6}>No checked-in visits in this date range.</td>
            </tr>
          )}
          {data.days.flatMap((day) =>
            day.visits.map((visit, index) => (
              <tr key={`${day.date}-${index}`}>
                <Cell label="Date" numeric>
                  {day.date}
                </Cell>
                <Cell label="Business">{visit.business_name}</Cell>
                <Cell label="Station">{visit.station}</Cell>
                <Cell label="Time" numeric>
                  {visit.start}–{visit.end}
                </Cell>
                <Cell label="Insurance">
                  <span class={visit.liability_insurance.valid ? "validity" : "validity validity--bad"}>{validWord(visit.liability_insurance.valid)}</span>
                  {visit.liability_insurance.expires_on && <span class="table__note num">expires {visit.liability_insurance.expires_on}</span>}
                </Cell>
                <Cell label="Crew and card">
                  <ul class="items">
                    {visit.crew.map((cook) => (
                      <li key={cook.name + cook.checked_in_at}>
                        <span>
                          {cook.name} <span class="num">(in {kitchenClock(cook.checked_in_at, data.time_zone)})</span>
                        </span>
                        <span class={cook.food_handler_card.valid ? "validity" : "validity validity--bad"}>{validWord(cook.food_handler_card.valid)}</span>
                      </li>
                    ))}
                  </ul>
                </Cell>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </main>
  );
}
