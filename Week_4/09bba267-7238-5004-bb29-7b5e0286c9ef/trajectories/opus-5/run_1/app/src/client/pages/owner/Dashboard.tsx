import { useCallback, useState, type ReactNode } from 'react';
import type { OwnerTier, Performance } from '../../../shared/api';
import { api } from '../../lib/api';
import { useLiveUpdates } from '../../lib/live';
import { OwnerFrame } from './OwnerFrame';

export function OwnerDashboard(): ReactNode {
  const [performances, setPerformances] = useState<Performance<OwnerTier>[]>([]);
  const load = useCallback(async () => {
    const result = await api.ownerPerformances();
    if (result.data !== undefined) setPerformances(result.data.performances);
    return result.status;
  }, []);

  useLiveUpdates({ owner: true }, () => {
    void load();
  });

  return (
    <OwnerFrame load={load}>
      <h1>Performances</h1>
      {performances.map((performance) => (
        <div className="owner-performance" key={performance.id}>
          <h2>{performance.title}</h2>
          <p className="start-label figures">{performance.startsAtVenue}</p>
          <div className="table-frame">
            <table aria-label={performance.title}>
              <thead>
                <tr>
                  <th scope="col">Tier</th>
                  <th scope="col">On sale</th>
                  <th scope="col">Held</th>
                  <th scope="col">Sold</th>
                  <th scope="col">Offered</th>
                  <th scope="col">Waitlist</th>
                </tr>
              </thead>
              <tbody>
                {performance.tiers.map((tier) => (
                  <tr key={tier.id}>
                    <th scope="row">{tier.name}</th>
                    <td className="figures">{tier.onSale}</td>
                    <td className="figures">{tier.held}</td>
                    <td className="figures">{tier.sold}</td>
                    <td className="figures">{tier.offered}</td>
                    <td className="figures">{tier.waitlistLength}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </OwnerFrame>
  );
}
