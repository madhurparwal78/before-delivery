import { useState } from 'react';
import { COPY, fill, LABELS } from '../../shared/copy';
import { clockIn, printDateTime, TOWN_NAMES, TOWN_ZONES, type Town } from '../../shared/time';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import { navigate } from '../router';
import type { Board, Cut, HistoryEvent, Job, PrivatePageRow, Producer, Render } from '../types';
import { AsyncButton, BottomBar, EmptyState, focusHeading, Heading, LoadingBars, NotFound, Problems, RadioGroup, SelectField, TextField, classOf, useForm, wantHeadingFocus } from '../ui/kit';
import { MenuButton } from '../ui/menu';
import { Overlay, useDialog, type DialogState } from '../ui/overlay';
import { JobNav } from './frame';
import { readJob } from './jobshared';

interface Screen {
  job: Job;
  cuts: Cut[];
  renders: Render[];
  busy: { until: string; message: string } | null;
  reviews: PrivatePageRow[];
  signOffs: PrivatePageRow[];
  history: HistoryEvent[];
  producers: Producer[];
}

function filmStateText(render: Render): string {
  return fill(LABELS.filmState[render.state], { progress: render.progress });
}

function NameForm({ formKey, initial, state, onSave }: { formKey: string; initial: string; state: DialogState; onSave: (name: string) => Promise<void> }) {
  const form = useForm(formKey, () => ({ name: initial }), { focusMessage: true });
  const save = () =>
    form.submit(async () => {
      await onSave(form.values.name);
      state.hide();
    });
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Problems form={form} />
      <TextField form={form} name="name" label="Name" autoComplete="off" />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Save'}</button>
    </form>
  );
}

function PreviewFilm({ jobId, cut, state, reload }: { jobId: string; cut: number; state: DialogState; reload: () => Promise<void> }) {
  const form = useForm(`previewFilm:${jobId}`, () => ({ width: '640', burnTimecode: false }), { focusMessage: true });
  const ask = () =>
    form.submit(async () => {
      const response = await fetch(`/api/jobs/${jobId}/renders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cut, width: Number(form.values.width), burnTimecode: form.values.burnTimecode }),
      });
      if (!response.ok) {
        const { error } = (await response.json()) as { error: { code: string; message: string } };
        throw new ApiError(response.status, error.code, error.message);
      }
      await reload();
      announce(response.status === 202 ? COPY.filmAsked : COPY.filmStoredShown);
      state.hide();
    });
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void ask(); }}>
      <Problems form={form} />
      <RadioGroup label="Width" name="film-width" value={form.values.width} options={[['640', '640'], ['1280', '1280']]} onChange={(value) => form.set('width', value)} />
      <label className="choice check">
        <input type="checkbox" checked={form.values.burnTimecode} onChange={(event) => form.set('burnTimecode', event.target.checked)} />
        <span>Burn in timecode</span>
      </label>
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Ask for film'}</button>
    </form>
  );
}

function SendPage({ formKey, producers, state, onSend }: { formKey: string; producers: Producer[]; state: DialogState; onSend: (producer: Producer) => Promise<void> }) {
  const form = useForm(formKey, () => ({ producerId: producers[0]?.id ?? '' }), { focusMessage: true });
  const send = () =>
    form.submit(async () => {
      await onSend(producers.find((producer) => producer.id === form.values.producerId) as Producer);
      state.hide();
    });
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <Problems form={form} />
      <SelectField form={form} name="producerId" label="Producer" options={producers.map((producer) => [producer.id, producer.name] as const)} />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Send'}</button>
    </form>
  );
}

export function Cuts({ jobId }: { jobId: string }) {
  const live = useLive<Screen>(
    async () => {
      const job = await readJob(jobId);
      const [cuts, renders, reviews, signOffs, history, producers] = await Promise.all([
        api<{ cuts: Cut[] }>(`/api/jobs/${jobId}/cuts`),
        api<{ renders: Render[]; busy: Screen['busy'] }>(`/api/jobs/${jobId}/renders`),
        api<{ reviews: PrivatePageRow[] }>(`/api/jobs/${jobId}/reviews`),
        api<{ signOffs: PrivatePageRow[] }>(`/api/jobs/${jobId}/sign-offs`),
        api<{ events: HistoryEvent[] }>(`/api/jobs/${jobId}/history`),
        api<{ producers: Producer[] }>(`/api/clients/${job.clientId}/producers`),
      ]);
      return { job, cuts: cuts.cuts, renders: renders.renders, busy: renders.busy, reviews: reviews.reviews, signOffs: signOffs.signOffs, history: history.events, producers: producers.producers };
    },
    (before, after) => {
      for (const render of after.renders) {
        const was = before.renders.find((held) => held.id === render.id);
        if (render.state === 'ready' && was && was.state !== 'ready' && was.state !== 'outdated') announce(fill(COPY.filmReady, { number: render.cut }));
      }
      for (const cut of after.cuts) {
        const was = before.cuts.find((held) => held.number === cut.number);
        if (cut.signedOffAt && was && !was.signedOffAt) {
          const town = (after.producers.find((producer) => producer.name === cut.signedOffBy)?.town ?? 'amsterdam') as Town;
          const at = new Date(cut.signedOffAt).getTime();
          announce(fill(COPY.signOffArrived, { number: cut.number, name: cut.signedOffBy as string, time: clockIn(at, TOWN_ZONES[town]), town: TOWN_NAMES[town] }));
        }
      }
    },
  );
  const [target, setTarget] = useState(0);
  const make = useDialog('makeCut');
  const rename = useDialog('renameCut');
  const film = useDialog('previewFilm');
  const review = useDialog('sendReview');
  const signOff = useDialog('askSignOff');

  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  const { job, cuts, renders, busy, reviews, signOffs, history, producers } = live.data;
  const latest = cuts[cuts.length - 1]?.number ?? 1;

  const refuse = (error: unknown) => {
    if (error instanceof ApiError && error.status !== 401) announce(error.message);
  };
  const open = (number: number, dialog: DialogState) => {
    setTarget(number);
    dialog.show();
  };
  const bringBack = async (number: number) => {
    try {
      const board = await api<Board>(`/api/jobs/${jobId}/board`);
      await api(`/api/jobs/${jobId}/cuts/${number}/bring-back`, { method: 'POST', body: { stamp: board.stamp } });
      await live.reload();
      announce(fill(COPY.cutBack, { number }));
    } catch (error) {
      refuse(error);
    }
  };
  const remove = async (number: number) => {
    try {
      await api(`/api/jobs/${jobId}/cuts/${number}`, { method: 'DELETE' });
      await live.reload();
      announce(fill(COPY.cutDeleted, { number }));
      focusHeading();
    } catch (error) {
      refuse(error);
    }
  };
  const producerName = (id: string) => producers.find((producer) => producer.id === id)?.name ?? '';
  const endPage = async (path: string) => {
    try {
      await api(path, { method: 'POST' });
      await live.reload();
      announce(COPY.pageEnded);
      focusHeading();
    } catch (error) {
      refuse(error);
    }
  };
  const pageRow = (page: PrivatePageRow, kind: string, path: string) => {
    const town = producers.find((producer) => producer.id === page.producerId)?.town ?? 'amsterdam';
    return (
      <li key={page.id}>
        <p><strong>{kind}</strong> · Cut {page.cut} · {producerName(page.producerId)} · {page.state === 'open' ? 'Open' : 'Ended'}</p>
        <p className="muted tabular">{printDateTime(new Date(page.endsAt).getTime(), town)}</p>
        {page.state === 'open' ? <AsyncButton kind="plain" label="End page" onPress={() => endPage(path)} /> : null}
      </li>
    );
  };
  const pages = [
    ...reviews.map((page) => pageRow(page, 'Review', `/api/reviews/${page.id}/end`)),
    ...signOffs.map((page) => pageRow(page, 'Sign-off', `/api/sign-offs/${page.id}/end`)),
  ];

  return (
    <section className="screen">
      <Heading title={`Cuts for ${job.title}`} refreshFailed={live.refreshFailed} />
      <JobNav jobId={jobId} />
      <BottomBar><button type="button" className={classOf('primary')} onClick={make.show}>Make cut</button></BottomBar>
      <Overlay state={make} title="Make cut">
        <NameForm
          formKey={`makeCut:${jobId}`}
          initial=""
          state={make}
          onSave={async (name) => {
            const cut = await api<Cut>(`/api/jobs/${jobId}/cuts`, { method: 'POST', body: { name } });
            await live.reload();
            announce(fill(COPY.cutMade, { number: cut.number }));
          }}
        />
      </Overlay>
      <Overlay state={rename} title={`Rename Cut ${target}`}>
        <NameForm
          key={target}
          formKey={`renameCut:${jobId}:${target}`}
          initial={cuts.find((cut) => cut.number === target)?.name ?? ''}
          state={rename}
          onSave={async (name) => {
            await api(`/api/jobs/${jobId}/cuts/${target}`, { method: 'PATCH', body: { name } });
            await live.reload();
            announce(fill(COPY.cutSaved, { number: target }));
          }}
        />
      </Overlay>
      <Overlay state={film} title="Preview film"><PreviewFilm jobId={jobId} cut={target} state={film} reload={live.reload} /></Overlay>
      <Overlay state={review} title="Send review page">
        <SendPage
          formKey={`sendReview:${jobId}`}
          producers={producers}
          state={review}
          onSend={async (producer) => {
            await api(`/api/jobs/${jobId}/reviews`, { method: 'POST', body: { producerId: producer.id, cut: target } });
            await live.reload();
            announce(fill(COPY.reviewReady, { name: producer.name }));
          }}
        />
      </Overlay>
      <Overlay state={signOff} title="Ask for sign-off">
        <SendPage
          formKey={`askSignOff:${jobId}`}
          producers={producers}
          state={signOff}
          onSend={async (producer) => {
            await api(`/api/jobs/${jobId}/sign-offs`, { method: 'POST', body: { producerId: producer.id, cut: target } });
            await live.reload();
            announce(fill(COPY.signOffReady, { name: producer.name }));
          }}
        />
      </Overlay>
      {cuts.length ? (
        <section role="region" aria-label="Cuts table" className="table-frame" tabIndex={0}>
          <table>
            <thead><tr><th>Cut</th><th>Name</th><th>Rate</th><th>Made</th><th>Sign-off</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {cuts.map((cut) => (
                <tr key={cut.number}>
                  <td className="tabular">Cut {cut.number}</td>
                  <td className="name">{cut.name}</td>
                  <td className="tabular">{cut.frameRate}</td>
                  <td className="tabular">{printDateTime(new Date(cut.createdAt).getTime(), 'amsterdam')}</td>
                  <td className="name sign-cell">{cut.signedOffAt ? `Signed off by ${cut.signedOffBy}, ${printDateTime(new Date(cut.signedOffAt).getTime(), 'amsterdam')}` : ''}</td>
                  <td>
                    <MenuButton
                      label={`Actions for Cut ${cut.number}`}
                      items={[
                        { label: 'Preview film', onSelect: () => open(cut.number, film) },
                        { label: 'Send review page', onSelect: () => open(cut.number, review) },
                        { label: 'Ask for sign-off', onSelect: () => open(cut.number, signOff) },
                        { label: 'Compare', onSelect: () => { wantHeadingFocus(); navigate(`/desk/jobs/${jobId}/compare?a=${cut.number}&b=${latest}&wipe=50`); } },
                        { label: 'Bring back', onSelect: () => void bringBack(cut.number) },
                        { label: 'Rename', onSelect: () => open(cut.number, rename) },
                        { label: 'Delete', onSelect: () => void remove(cut.number) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : <EmptyState>No cuts on this job yet.</EmptyState>}
      <section role="region" aria-label="Preview films" className="panel-block">
        <h2 className="section-title">Preview films</h2>
        {busy ? <p className="notice"><span className="err-bar" aria-hidden="true" />{busy.message}</p> : null}
        {renders.length ? (
          <ul className="plain-list">
            {renders.map((render) => (
              <li key={render.id}>
                <p><strong>Cut {render.cut}</strong> · <span className="tabular">{render.width}</span> · {filmStateText(render)}</p>
                {render.message ? <p className="field-message"><span className="err-bar" aria-hidden="true" />{render.message}</p> : null}
                {render.filmUrl ? <a href={render.filmUrl} download>Download film</a> : null}
              </li>
            ))}
          </ul>
        ) : <EmptyState>No films asked for yet.</EmptyState>}
      </section>
      <section role="region" aria-label="Private pages" className="panel-block">
        <h2 className="section-title">Private pages</h2>
        {pages.length ? <ul className="plain-list">{pages}</ul> : <EmptyState>No private pages sent yet.</EmptyState>}
      </section>
      <section role="region" aria-label="Job history" className="panel-block">
        <h2 className="section-title">Job history</h2>
        {history.length ? (
          <ol className="plain-list history">
            {history.map((event) => (
              <li key={`${event.at}-${event.action}-${event.text}`}>
                <span className="muted tabular">{printDateTime(new Date(event.at).getTime(), 'amsterdam')}</span> <strong>{event.actor}</strong> {event.text}
              </li>
            ))}
          </ol>
        ) : <EmptyState>Nothing has happened on this job yet.</EmptyState>}
      </section>
    </section>
  );
}

