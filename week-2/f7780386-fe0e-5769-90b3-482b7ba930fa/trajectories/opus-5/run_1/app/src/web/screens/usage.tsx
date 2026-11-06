import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { UsageResponse } from '../../shared/api.js';
import { formatHours } from '../../shared/format.js';
import { api } from '../api.js';
import { useApp } from '../app-state.js';

export function UsageScreen(): ReactNode {
  const app = useApp();
  const today = app.kitchen?.today ?? '';
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [usage, setUsage] = useState<UsageResponse | null>(null);

  useEffect(() => {
    if (date === '' && today !== '') {
      setDate(today);
      setMonth(today.slice(0, 7));
    }
  }, [today, date]);

  const refresh = useCallback(async (): Promise<void> => {
    if (date === '') return;
    setUsage(await api<UsageResponse>(`/api/usage?date=${date}`));
  }, [date]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  return (
    <>
      <h1>Usage</h1>

      <div className="inline-form">
        <span>
          <label htmlFor="usage-date">Usage date</label>
          <input
            id="usage-date"
            type="text"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </span>
      </div>

      <table>
        <caption>Daily usage</caption>
        <thead>
          <tr>
            <th scope="col">Station</th>
            <th scope="col">Booked</th>
            <th scope="col">Cleaning</th>
            <th scope="col">Bookings</th>
          </tr>
        </thead>
        <tbody>
          {(usage?.stations ?? []).map((station) => (
            <tr key={station.station_id}>
              <td data-label="Station">{station.station_name}</td>
              <td data-label="Booked" className="num">
                {formatHours(station.booked_minutes)} h
              </td>
              <td data-label="Cleaning" className="num">
                {formatHours(station.cleaning_minutes)} h
              </td>
              <td data-label="Bookings" className="num">
                {station.bookings}
              </td>
            </tr>
          ))}
          <tr>
            <td data-label="Station">
              <strong>Total</strong>
            </td>
            <td data-label="Booked" className="num">
              <strong>{formatHours(usage?.total_booked_minutes ?? 0)} h</strong>
            </td>
            <td data-label="Cleaning" />
            <td data-label="Bookings" />
          </tr>
        </tbody>
      </table>

      <div className="inline-form">
        <span>
          <label htmlFor="usage-month">Export month</label>
          <input
            id="usage-month"
            type="text"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </span>
        <a href={`/api/exports/usage.csv?month=${month}`}>Export month CSV</a>
      </div>
    </>
  );
}
