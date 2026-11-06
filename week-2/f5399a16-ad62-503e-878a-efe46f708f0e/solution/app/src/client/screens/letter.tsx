import { useEffect, useRef, useState } from 'react';
import { COPY, fill } from '../../shared/copy';
import { printDateTime } from '../../shared/time';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import type { Job, Letter, Producer } from '../types';
import { AsyncButton, BottomBar, Heading, LoadingBars, NotFound, Problems, Select, SelectField, TextArea, TextField, useForm } from '../ui/kit';
import { JobNav } from './frame';
import { readJob } from './jobshared';

const CURRENCIES = [['EUR', 'EUR'], ['CAD', 'CAD'], ['USD', 'USD']] as const;
const STATE_TEXT = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted' } as const;

function feeOfMinor(minor: number): string {
  return `${(minor - (minor % 100)) / 100}.${String(minor % 100).padStart(2, '0')}`;
}

export function LetterScreen({ jobId }: { jobId: string }) {
  const live = useLive<{ job: Job; letter: Letter | null; producers: Producer[] }>(
    async () => {
      const job = await readJob(jobId);
      const [letter, producers] = await Promise.all([
        api<Letter>(`/api/jobs/${jobId}/letter`).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }),
        api<{ producers: Producer[] }>(`/api/clients/${job.clientId}/producers`),
      ]);
      return { job, letter, producers: producers.producers };
    },
    (before, after) => {
      if (before.letter?.state !== 'accepted' && after.letter?.state === 'accepted') {
        const name = after.producers.find((producer) => producer.id === after.letter?.producerId)?.name ?? '';
        announce(fill(COPY.letterAccepted, { name }));
      }
    },
  );
  const form = useForm(`letter:${jobId}`, () => ({ currency: 'EUR', fee: '', scope: '' }));
  const [producerId, setProducerId] = useState<string | null>(null);
  const filled = useRef(false);
  const letter = live.data?.letter ?? null;

  useEffect(() => {
    if (letter && !filled.current) {
      filled.current = true;
      form.setAll({ currency: letter.currency, fee: feeOfMinor(letter.feeMinor), scope: letter.scope });
    }
    // The form takes the stored letter once; afterwards what is typed stays.
  }, [letter]);

  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  const { job, producers } = live.data;
  const chosenProducer = producerId ?? letter?.producerId ?? producers[0]?.id ?? '';

  const save = () =>
    form.submit(async () => {
      if (letter) await api(`/api/letters/${letter.id}`, { method: 'PATCH', body: { ...form.values, stamp: letter.stamp } });
      else await api(`/api/jobs/${jobId}/letter`, { method: 'POST', body: form.values });
      filled.current = true;
      await live.reload();
      announce(COPY.letterSaved);
    });

  const send = () =>
    form.submit(async () => {
      if (!letter) {
        form.refuse(COPY.typeAmount, { fee: COPY.typeAmount });
        return;
      }
      await api(`/api/letters/${letter.id}/send`, { method: 'POST', body: { producerId: chosenProducer } });
      await live.reload();
      announce(fill(COPY.feeReady, { name: producers.find((producer) => producer.id === chosenProducer)?.name ?? '' }));
    });

  const endPage = () =>
    form.submit(async () => {
      if (!letter) return;
      await api(`/api/letters/${letter.id}/end-page`, { method: 'POST' });
      await live.reload();
      announce(COPY.pageEnded);
    });

  const town = producers.find((producer) => producer.id === letter?.producerId)?.town ?? 'amsterdam';

  return (
    <section className="screen">
      <Heading title={`Fee letter for ${job.title}`} refreshFailed={live.refreshFailed} />
      <JobNav jobId={jobId} />
      <Problems form={form} />
      <div className="letter-layout">
        <div className="letter-form">
          <SelectField form={form} name="currency" label="Currency" options={CURRENCIES} />
          <TextField form={form} name="fee" label="Fee" inputMode="decimal" numeric />
          <TextArea form={form} name="scope" label="Scope" />
          <BottomBar><AsyncButton label="Save letter" onPress={save} /></BottomBar>
          <div className="panel-block">
            <p className="facts">
              {letter ? <>State: <strong>{STATE_TEXT[letter.state]}</strong>{letter.endsAt ? <span className="tabular"> · {printDateTime(new Date(letter.endsAt).getTime(), town)}</span> : null}</> : 'No letter saved yet.'}
            </p>
            <Select label="Producer" value={chosenProducer} options={producers.map((producer) => [producer.id, producer.name] as const)} onChange={setProducerId} />
            <div className="tools">
              <AsyncButton kind="ink" label="Send letter" onPress={send} />
              {letter?.pageUrl ? <AsyncButton kind="plain" label="End page" onPress={endPage} /> : null}
              {letter ? <a className="nav-link" href={letter.pdfUrl}>Open the PDF</a> : null}
            </div>
          </div>
        </div>
        {letter ? (
          <section role="region" aria-label="Amounts" className="table-frame amounts" tabIndex={0}>
            <table>
              <thead><tr><th>Milestone</th><th>Amount</th><th>Tax</th></tr></thead>
              <tbody>
                {letter.milestones.map((milestone) => (
                  <tr key={milestone.number}><td className="tabular">{milestone.number}</td><td className="tabular">{milestone.amountText}</td><td className="tabular">{milestone.taxText}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th scope="row">Fee</th><td className="tabular" colSpan={2}>{letter.feeText}</td></tr>
                <tr><th scope="row">Tax</th><td className="tabular" colSpan={2}>{letter.taxText}</td></tr>
                <tr><th scope="row">Total</th><td className="tabular" colSpan={2}>{letter.totalText}</td></tr>
              </tfoot>
            </table>
          </section>
        ) : null}
      </div>
    </section>
  );
}
