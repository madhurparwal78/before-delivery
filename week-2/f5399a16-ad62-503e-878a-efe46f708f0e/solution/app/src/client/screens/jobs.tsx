import { useLayoutEffect, useRef, useState } from 'react';
import { COPY, fill, LABELS } from '../../shared/copy';
import { printDate } from '../../shared/time';
import { FRAME_RATES } from '../../shared/timecode';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import { navigate, remember, useRoute, withParams } from '../router';
import type { ClientList, Job, JobPage } from '../types';
import { BottomBar, EmptyState, focusHeading, Heading, Link, LoadingBars, NotFound, Problems, Select, SelectField, TextField, WIDE, classOf, useForm, useMedia, wantHeadingFocus } from '../ui/kit';
import { MenuButton } from '../ui/menu';
import { Overlay, useDialog, type DialogState } from '../ui/overlay';

interface SearchAnswer {
  jobs: { id: string; title: string }[];
  clients: { id: string; name: string }[];
  producers: { id: string; name: string; clientId: string }[];
  total: number;
}

const PAUSE_MS = 300;

function SearchBox() {
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef(0);
  const change = (words: string) => {
    if (timer.current) clearTimeout(timer.current);
    const mine = ++asked.current;
    if (!words.trim()) {
      setAnswer(null);
      return;
    }
    timer.current = setTimeout(() => {
      void api<SearchAnswer>(`/api/search?q=${encodeURIComponent(words)}`).then(
        (found) => {
          if (mine !== asked.current) return;
          setAnswer(found);
          announce(found.total === 1 ? COPY.searchOne : found.total === 0 ? COPY.searchNone : fill(COPY.searchMany, { count: found.total }));
        },
        () => undefined,
      );
    }, PAUSE_MS);
  };
  return (
    <div className="search">
      <div className="field">
        <label htmlFor="job-search">Search jobs and clients</label>
        <input id="job-search" type="search" autoComplete="off" onChange={(event) => change(event.target.value)} />
      </div>
      {answer ? (
        <ul aria-label="Search results" className="search-results">
          {answer.jobs.map((job) => <li key={job.id}><Link href={`/desk/jobs/${job.id}`}>{job.title}</Link></li>)}
          {answer.clients.map((client) => <li key={client.id}><Link href={`/desk/clients/${client.id}`}>{client.name}</Link></li>)}
          {answer.producers.map((producer) => <li key={producer.id}><Link href={`/desk/clients/${producer.clientId}`}>{producer.name}</Link></li>)}
        </ul>
      ) : null}
    </div>
  );
}

function clientOptions(list: ClientList | null, first?: [string, string]): (readonly [string, string])[] {
  const options = (list?.clients ?? []).map((client) => [client.id, client.name] as const);
  return first ? [first, ...options] : options;
}

function JobFilters({ clients }: { clients: ClientList | null }) {
  const route = useRoute();
  const set = (key: string, value: string) => navigate(withParams(route, { [key]: value, cursor: null }));
  return (
    <div className="filters">
      <Select label="Client" value={route.search.get('client') ?? ''} options={clientOptions(clients, ['', 'All clients'])} onChange={(value) => set('client', value)} />
      <Select
        label="State"
        value={route.search.get('state') ?? ''}
        options={[['', 'All states'], ...Object.entries(LABELS.jobState)]}
        onChange={(value) => set('state', value)}
      />
      <Select
        label="Frame rate"
        value={route.search.get('frameRate') ?? ''}
        options={[['', 'All frame rates'], ...FRAME_RATES.map((rate) => [rate, rate] as const)]}
        onChange={(value) => set('frameRate', value)}
      />
      <Select label="Sort by" value={route.search.get('sort') ?? 'dueDate'} options={Object.entries(LABELS.sort)} onChange={(value) => set('sort', value)} />
    </div>
  );
}

function NewJobForm({ state, clients }: { state: DialogState; clients: ClientList | null }) {
  const form = useForm('newJob', () => ({
    clientId: clients?.clients.find((client) => client.state === 'active')?.id ?? '',
    title: '',
    adId: '',
    dueDate: '',
    targetSeconds: '30',
    frameRate: '25',
    aspect: '16:9',
  }), { focusMessage: true });
  const save = () =>
    form.submit(async () => {
      const job = await api<Job>('/api/jobs', { method: 'POST', body: { ...form.values, targetSeconds: Number(form.values.targetSeconds) } });
      announce(COPY.jobAdded);
      state.hide('none');
      wantHeadingFocus();
      navigate(`/desk/jobs/${job.id}`);
    });
  const active = (clients?.clients ?? []).filter((client) => client.state === 'active').map((client) => [client.id, client.name] as const);
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Problems form={form} />
      <SelectField form={form} name="clientId" label="Client" options={active} />
      <TextField form={form} name="title" label="Title" />
      <TextField form={form} name="adId" label="Ad-ID" />
      <TextField form={form} name="dueDate" label="Due date" />
      <SelectField form={form} name="targetSeconds" label="Target length" options={Object.entries(LABELS.target)} />
      <SelectField form={form} name="frameRate" label="Frame rate" options={FRAME_RATES.map((rate) => [rate, rate] as const)} />
      <SelectField form={form} name="aspect" label="Aspect" options={[['16:9', '16:9'], ['1:1', '1:1'], ['9:16', '9:16']]} />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Save'}</button>
    </form>
  );
}

export function Jobs() {
  const route = useRoute();
  const wide = useMedia(WIDE);
  const filters = useDialog('jobFilters');
  const newJob = useDialog('newJob');
  const params = new URLSearchParams();
  for (const [from, to] of [['client', 'clientId'], ['state', 'state'], ['frameRate', 'frameRate'], ['sort', 'sort'], ['cursor', 'cursor']] as const) {
    const value = route.search.get(from);
    if (value) params.set(to, value);
  }
  const query = params.toString();
  const live = useLive(
    async () => {
      const [page, clients] = await Promise.all([api<JobPage>(`/api/jobs${query ? `?${query}` : ''}`), api<ClientList>('/api/clients')]);
      return { page, clients };
    },
    undefined,
    [query],
  );
  const cursors = route.memory.cursors ?? [];
  const cameBack = useRef(route.by === 'pop' ? route.memory.focusLink : undefined);

  useLayoutEffect(() => {
    if (!live.data || !cameBack.current) return;
    const link = document.querySelector<HTMLElement>(`a[data-job="${cameBack.current}"]`);
    cameBack.current = undefined;
    link?.focus({ preventScroll: true });
  }, [live.data]);

  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  const { page, clients } = live.data;

  const act = async (work: () => Promise<unknown>, after: () => void) => {
    try {
      await work();
      await live.reload();
      after();
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) announce(error.message);
    }
  };

  const previous = cursors.length ? withParams(route, { cursor: cursors[cursors.length - 1] || null }) : null;

  return (
    <section className="screen">
      <Heading title="Jobs" refreshFailed={live.refreshFailed} />
      <SearchBox />
      {wide ? <JobFilters clients={clients} /> : <button type="button" className="btn btn-plain" onClick={filters.show}>Filters</button>}
      {!wide ? (
        <Overlay state={filters} title="Filters" sheet>
          <JobFilters clients={clients} />
        </Overlay>
      ) : null}
      <BottomBar>
        <button type="button" className={classOf('primary')} onClick={newJob.show}>New job</button>
      </BottomBar>
      <Overlay state={newJob} title="New job">
        <NewJobForm state={newJob} clients={clients} />
      </Overlay>
      {page.jobs.length ? (
        <section role="region" aria-label="Jobs table" className="table-frame" tabIndex={0}>
          <table className="jobs-table">
            <thead>
              <tr><th>Title</th><th>Client</th><th>State</th><th>Frame rate</th><th>Due date</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {page.jobs.map((job) => (
                <tr key={job.id}>
                  <td className="name"><Link href={`/desk/jobs/${job.id}`} data-job={job.id} onClick={() => remember({ focusLink: job.id })}>{job.title}</Link></td>
                  <td className="name">{job.clientName}</td>
                  <td className="state">{LABELS.jobState[job.state]}</td>
                  <td className="tabular">{job.frameRate}</td>
                  <td className="tabular">{printDate(job.dueDate)}</td>
                  <td>
                    <MenuButton
                      label={`Actions for ${job.title}`}
                      items={[
                        { label: 'Open', onSelect: () => { remember({ focusLink: job.id }); wantHeadingFocus(); navigate(`/desk/jobs/${job.id}`); } },
                        { label: 'Duplicate', onSelect: () => void act(() => api(`/api/jobs/${job.id}/duplicate`, { method: 'POST' }), () => announce(COPY.jobDuplicated)) },
                        {
                          label: 'Archive',
                          onSelect: () => void act(() => api(`/api/jobs/${job.id}/archive`, { method: 'POST' }), () => {
                            announce(fill(COPY.jobArchived, { title: job.title }));
                            focusHeading();
                          }),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <EmptyState>No jobs here yet.</EmptyState>
      )}
      <div className="pager">
        {previous ? <Link href={previous} memory={{ cursors: cursors.slice(0, -1) }}>Previous page</Link> : null}
        {page.nextCursor ? (
          <Link href={withParams(route, { cursor: page.nextCursor })} memory={{ cursors: [...cursors, route.search.get('cursor') ?? ''] }}>Next page</Link>
        ) : null}
      </div>
    </section>
  );
}
