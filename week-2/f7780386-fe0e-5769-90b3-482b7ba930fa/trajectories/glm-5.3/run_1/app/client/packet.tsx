// The public compliance packet page: no navigation, no sign-in, read-only.

import { useEffect, useState } from 'react';
import { getPacketContent } from './api';

interface Visit {
  business_name: string;
  station: string;
  start: string;
  end: string;
  liability_insurance: { valid: boolean; expires_on: string | null };
  crew: { name: string; checked_in_at: string; food_handler_card: { valid: boolean; expires_on: string | null } }[];
}

export function PacketScreen({ token, signedOut = false }: { token: string; signedOut?: boolean }) {
  const [content, setContent] = useState<{
    kitchen: string;
    time_zone: string;
    from: string;
    to: string;
    generated_at: string;
    days: { date: string; visits: Visit[] }[];
  } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading');

  useEffect(() => {
    let cancelled = false;
    void getPacketContent(token).then((res) => {
      if (cancelled) return;
      if (res.ok && res.body) {
        setContent(res.body as unknown as {
          kitchen: string;
          time_zone: string;
          from: string;
          to: string;
          generated_at: string;
          days: { date: string; visits: Visit[] }[];
        });
        setState('ready');
      } else {
        setState('invalid');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === 'loading') {
    return (
      <main style={{ maxWidth: 900, margin: '0 auto', padding: 12 }}>
        <p className="hint">Loading…</p>
      </main>
    );
  }

  if (state === 'invalid' || !content) {
    return (
      <main style={{ maxWidth: 900, margin: '0 auto', padding: 12 }}>
        <h1>Compliance packet</h1>
        <p>This packet link is not valid.</p>
      </main>
    );
  }

  const rows: { date: string; visit: Visit }[] = [];
  for (const day of content.days) {
    for (const visit of day.visits) rows.push({ date: day.date, visit });
  }

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 12 }}>
      <h1>Compliance packet</h1>
      <p>
        {content.kitchen} — {content.from} to {content.to}
      </p>
      <p>
        <a href={`/api/packet/${token}/pdf`}>Download PDF</a>
      </p>
      {signedOut && null}
      <table className="cards" aria-label="Kitchen visits">
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
          {rows.map((row, i) => (
            <tr key={i}>
              <td data-label="Date" className="num">{row.date}</td>
              <td data-label="Business">{row.visit.business_name}</td>
              <td data-label="Station">{row.visit.station}</td>
              <td data-label="Time" className="num">{row.visit.start}–{row.visit.end}</td>
              <td data-label="Insurance">{row.visit.liability_insurance.valid ? 'Valid' : 'Not valid'}</td>
              <td data-label="Crew and card">
                {row.visit.crew.map((c) => (
                  <span key={c.name} style={{ display: 'block' }}>
                    {c.name} — {c.food_handler_card.valid ? 'Valid' : 'Not valid'}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
