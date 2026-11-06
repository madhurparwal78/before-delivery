import { useEffect, useState } from 'preact/hooks';
import { StudioLayout } from './StudioLayout';
import { CreditEntry } from './data';
import { api } from '../api';
import { useAuth } from '../store';
import { creditWords, credits, ENTRY_KINDS, planLine, signedCredits, stampUtc } from '../format';

export function Credits() {
  const auth = useAuth();
  const [balance, setBalance] = useState(0);
  const [entries, setEntries] = useState<CreditEntry[]>([]);

  useEffect(() => {
    if (auth.state !== 'signed-in') return;
    void api<{ balance: number; entries: CreditEntry[] }>('/api/credits').then((loaded) => {
      setBalance(loaded.balance);
      setEntries(loaded.entries);
    });
  }, [auth.state]);

  return (
    <StudioLayout current="credits">
      <h1 style="font-size:clamp(1.8rem,3vw,2.3rem)">Credits</h1>
      <p class="balance-big">{creditWords(balance)}</p>
      <p class="muted">{auth.me ? planLine(auth.me.workspace.plan) : ''}</p>

      <div class="panel-soft table-wrap" style="margin-top:22px">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">When (UTC)</th>
              <th scope="col">Kind</th>
              <th scope="col">Who</th>
              <th scope="col" class="num">
                Change
              </th>
              <th scope="col" class="num">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{stampUtc(entry.created_at)}</td>
                <td>{ENTRY_KINDS[entry.kind]}</td>
                <td>{entry.user_name ?? '—'}</td>
                <td class="num">{signedCredits(entry.amount)}</td>
                <td class="num">{credits(entry.balance_after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StudioLayout>
  );
}
