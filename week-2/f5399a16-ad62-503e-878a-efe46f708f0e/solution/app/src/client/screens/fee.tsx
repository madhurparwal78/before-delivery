import { useState } from 'react';
import { LETTER_ACCEPTED_LINE, PRIVATE_COPY } from '../../shared/copy';
import { announce } from '../announce';
import { api } from '../api';
import { useLive } from '../live';
import type { MilestoneRow } from '../types';
import { AsyncButton, BottomBar, Heading, LoadingBars, NotFound, Problems, TextField, useForm } from '../ui/kit';
import { EndedPage, PrivateShell } from './private';

interface FeeRead {
  jobTitle: string;
  currency: string;
  feeText: string;
  taxText: string;
  totalText: string;
  milestones: MilestoneRow[];
  state: 'draft' | 'sent' | 'accepted';
  stamp: string;
  endsAt: string;
  pdfUrl: string;
}

export function FeePage({ token }: { token: string }) {
  const copy = PRIVATE_COPY.en;
  const live = useLive(() => api<FeeRead>(`/api/f/${token}`), undefined, [], false);
  const form = useForm(null, () => ({ name: '' }));
  const [accepted, setAccepted] = useState(false);
  if (live.failedStatus === 410) return <EndedPage token={token} canAsk={false} />;
  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <PrivateShell copy={copy}><LoadingBars /></PrivateShell>;
  const { data } = live;
  const done = accepted || data.state === 'accepted';
  const accept = () =>
    form.submit(async () => {
      await api(`/api/f/${token}/accept`, { method: 'POST', body: { name: form.values.name, stamp: data.stamp } });
      setAccepted(true);
      announce(LETTER_ACCEPTED_LINE);
    });
  return (
    <PrivateShell copy={copy}>
      <Heading title={`Fee letter for ${data.jobTitle}`} />
      <Problems form={form} />
      <section role="region" aria-label="Amounts" className="table-frame amounts" tabIndex={0}>
        <table>
          <thead><tr><th>Milestone</th><th>Amount</th><th>Tax</th></tr></thead>
          <tbody>
            {data.milestones.map((milestone) => (
              <tr key={milestone.number}><td className="tabular">{milestone.number}</td><td className="tabular">{milestone.amountText}</td><td className="tabular">{milestone.taxText}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row">Fee</th><td className="tabular" colSpan={2}>{data.feeText}</td></tr>
            <tr><th scope="row">Tax</th><td className="tabular" colSpan={2}>{data.taxText}</td></tr>
            <tr><th scope="row">Total</th><td className="tabular" colSpan={2}>{data.totalText}</td></tr>
          </tfoot>
        </table>
      </section>
      <p><a className="nav-link pdf-link" href={data.pdfUrl}>Open the letter</a></p>
      {done ? <p className="signed-line">{LETTER_ACCEPTED_LINE}</p> : <TextField form={form} name="name" label={copy.nameField} autoComplete="name" />}
      {done ? null : <BottomBar><AsyncButton label="Accept letter" onPress={accept} /></BottomBar>}
    </PrivateShell>
  );
}
