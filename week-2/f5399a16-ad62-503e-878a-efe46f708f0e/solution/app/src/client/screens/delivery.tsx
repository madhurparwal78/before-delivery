import { useState } from 'react';
import { COPY } from '../../shared/copy';
import { announce } from '../announce';
import { api } from '../api';
import { useLive } from '../live';
import type { Cut, Job, PackageRow } from '../types';
import { AsyncButton, BottomBar, EmptyState, Heading, LoadingBars, NotFound, Problems, Select, useForm } from '../ui/kit';
import { JobNav } from './frame';
import { readJob } from './jobshared';

const LINK_TEXT = { boards: 'Download boards PDF', editDecisionList: 'Download edit decision list', shotList: 'Download shot list' } as const;
const STATE_TEXT = { making: 'Making', ready: 'Ready' } as const;

export function Delivery({ jobId }: { jobId: string }) {
  const live = useLive<{ job: Job; cuts: Cut[]; packages: PackageRow[] }>(async () => {
    const [job, cuts, packages] = await Promise.all([
      readJob(jobId),
      api<{ cuts: Cut[] }>(`/api/jobs/${jobId}/cuts`),
      api<{ packages: PackageRow[] }>(`/api/jobs/${jobId}/packages`),
    ]);
    return { job, cuts: cuts.cuts, packages: packages.packages };
  });
  const [chosen, setChosen] = useState<number | null>(null);
  const form = useForm(null, () => ({}));
  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  const { job, cuts, packages } = live.data;
  const signed = cuts.filter((cut) => cut.signedOffAt);
  const cutNumber = chosen ?? signed[signed.length - 1]?.number ?? cuts[cuts.length - 1]?.number ?? 0;
  const held = packages.find((row) => row.cut === cutNumber);
  const make = () =>
    form.submit(async () => {
      await api(`/api/jobs/${jobId}/packages`, { method: 'POST', body: { cut: cutNumber } });
      await live.reload();
      announce(COPY.packageReady);
    });
  return (
    <section className="screen">
      <Heading title={`Delivery for ${job.title}`} refreshFailed={live.refreshFailed} />
      <JobNav jobId={jobId} />
      <Problems form={form} />
      {cuts.length ? (
        <Select label="Cut" value={String(cutNumber)} options={cuts.map((cut) => [String(cut.number), `Cut ${cut.number}`] as const)} onChange={(value) => { setChosen(Number(value)); form.clear(); }} />
      ) : <EmptyState>No cuts on this job yet.</EmptyState>}
      <BottomBar><AsyncButton label="Make package" onPress={make} /></BottomBar>
      {held ? (
        <section className="panel-block" aria-label="Package">
          <h2 className="section-title">{STATE_TEXT[held.state]}</h2>
          <ul className="plain-list link-list">
            {held.files.map((file) => (
              <li key={file.kind}><a href={file.url} download={file.fileName}>{LINK_TEXT[file.kind]}</a></li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
