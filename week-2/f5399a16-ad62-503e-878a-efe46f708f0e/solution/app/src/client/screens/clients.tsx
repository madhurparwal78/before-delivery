import { COPY, fill, LABELS } from '../../shared/copy';
import { dateIn, printDate, TOWN_NAMES, TOWN_ZONES, type Town } from '../../shared/time';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import { navigate } from '../router';
import type { Client, ClientList, Job, JobPage, Producer } from '../types';
import { AsyncButton, BottomBar, EmptyState, Heading, Link, LoadingBars, NotFound, Problems, SelectField, TextField, classOf, useForm, wantHeadingFocus } from '../ui/kit';
import { Overlay, useDialog, type DialogState } from '../ui/overlay';

const PLACES = Object.entries(LABELS.place);
const TOWNS = Object.entries(TOWN_NAMES);
const LANGUAGE_OPTIONS = Object.entries(LABELS.language);

function ClientForm({ client, onSaved }: { client: Client | null; onSaved: (client: Client) => Promise<void> }) {
  const form = useForm(client ? `renameClient:${client.id}` : 'newClient', () => ({ name: client?.name ?? '', place: client?.place ?? 'netherlands' }), { focusMessage: true });
  const save = () =>
    form.submit(async () => {
      const saved = await api<Client>(client ? `/api/clients/${client.id}` : '/api/clients', { method: client ? 'PATCH' : 'POST', body: form.values });
      await onSaved(saved);
    });
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Problems form={form} />
      <TextField form={form} name="name" label="Name" autoComplete="off" />
      <SelectField form={form} name="place" label="Place" options={PLACES} />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Save'}</button>
    </form>
  );
}

export function Clients() {
  const live = useLive(() => api<ClientList>('/api/clients'));
  const newClient = useDialog('newClient');
  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  const { clients, erasedClients } = live.data;
  return (
    <section className="screen">
      <Heading title="Clients" refreshFailed={live.refreshFailed} />
      <BottomBar><button type="button" className={classOf('primary')} onClick={newClient.show}>New client</button></BottomBar>
      <Overlay state={newClient} title="New client">
        <ClientForm
          client={null}
          onSaved={async (saved) => {
            announce(COPY.clientAdded);
            newClient.hide('none');
            wantHeadingFocus();
            navigate(`/desk/clients/${saved.id}`);
          }}
        />
      </Overlay>
      {clients.length ? (
        <section role="region" aria-label="Clients table" className="table-frame" tabIndex={0}>
          <table>
            <thead><tr><th>Name</th><th>Place</th><th>State</th></tr></thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td className="name"><Link href={`/desk/clients/${client.id}`}>{client.name}</Link></td>
                  <td>{LABELS.place[client.place]}</td>
                  <td>{LABELS.clientState[client.state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : <EmptyState>No clients here yet.</EmptyState>}
      {erasedClients.length ? (
        <section className="panel-block" aria-label="Erased clients">
          <h2 className="section-title">Erased</h2>
          <ul className="plain-list">
            {erasedClients.map((client) => <li key={client.id}>{client.name} · {LABELS.clientState.erased}</li>)}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function ProducerForm({ client, producer, state, onSaved }: { client: Client; producer: Producer | null; state: DialogState; onSaved: () => Promise<void> }) {
  const form = useForm(producer ? `editProducer:${producer.id}` : `newProducer:${client.id}`, () => ({
    name: producer?.name ?? '',
    email: producer?.email ?? '',
    town: producer?.town ?? 'amsterdam',
    language: producer?.language ?? 'en',
  }), { focusMessage: true });
  const save = () =>
    form.submit(async () => {
      await api(producer ? `/api/producers/${producer.id}` : `/api/clients/${client.id}/producers`, { method: producer ? 'PATCH' : 'POST', body: form.values });
      await onSaved();
      announce(producer ? COPY.producerSaved : COPY.producerAdded);
      state.hide();
    });
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Problems form={form} />
      <TextField form={form} name="name" label="Name" autoComplete="off" />
      <TextField form={form} name="email" label="Email" autoComplete="off" inputMode="email" />
      <SelectField form={form} name="town" label="Town" options={TOWNS} />
      <SelectField form={form} name="language" label="Language" options={LANGUAGE_OPTIONS} />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Save'}</button>
    </form>
  );
}

function ProducerRow({ client, producer, reload }: { client: Client; producer: Producer; reload: () => Promise<void> }) {
  const edit = useDialog(`editProducer:${producer.id}`);
  return (
    <tr>
      <td className="name">{producer.name}</td>
      <td className="name">{producer.email}</td>
      <td>{TOWN_NAMES[producer.town as Town]}</td>
      <td>{LABELS.language[producer.language]}</td>
      <td>
        <button type="button" className="btn btn-plain" onClick={edit.show} aria-label={`Edit producer ${producer.name}`}><span aria-hidden="true">Edit</span></button>
        <Overlay state={edit} title="Edit producer"><ProducerForm client={client} producer={producer} state={edit} onSaved={reload} /></Overlay>
      </td>
    </tr>
  );
}

export function ClientScreen({ clientId }: { clientId: string }) {
  const live = useLive(async () => {
    const [client, producers, jobs] = await Promise.all([
      api<Client>(`/api/clients/${clientId}`),
      api<{ producers: Producer[] }>(`/api/clients/${clientId}/producers`),
      api<JobPage>(`/api/jobs?clientId=${clientId}`),
    ]);
    return { client, producers: producers.producers, jobs: jobs.jobs };
  });
  const newProducer = useDialog(`newProducer:${clientId}`);
  const rename = useDialog(`renameClient:${clientId}`);
  const closeClient = useDialog(`closeClient:${clientId}`);
  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  const { client, producers, jobs } = live.data as { client: Client; producers: Producer[]; jobs: Job[] };

  const startClosing = async () => {
    try {
      const closing = await api<Client>(`/api/clients/${clientId}/close`, { method: 'POST' });
      await live.reload();
      const date = printDate(dateIn(new Date(closing.closesAt as string).getTime(), TOWN_ZONES.amsterdam));
      announce(fill(COPY.closing, { name: client.name, date }));
      closeClient.hide();
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) announce(error.message);
    }
  };

  const bringBack = async () => {
    try {
      await api(`/api/clients/${clientId}/bring-back`, { method: 'POST' });
      await live.reload();
      announce(fill(COPY.isBack, { name: client.name }));
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) announce(error.message);
    }
  };

  const remove = async () => {
    try {
      await api(`/api/clients/${clientId}`, { method: 'DELETE' });
      announce(COPY.clientDeleted);
      wantHeadingFocus();
      navigate('/desk/clients');
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) announce(error.message);
    }
  };

  return (
    <section className="screen">
      <Heading title={client.name} refreshFailed={live.refreshFailed} />
      <p className="facts">{LABELS.place[client.place]} · <strong>{LABELS.clientState[client.state]}</strong></p>
      <div className="tools">
        <button type="button" className="btn btn-plain" onClick={rename.show}>Rename client</button>
        <AsyncButton kind="plain" label="Delete client" onPress={remove} />
        {client.state === 'active' ? (
          <button key="close" type="button" className="btn btn-ink" onClick={closeClient.show}>Close client</button>
        ) : client.state === 'closing' ? (
          <AsyncButton key="back" kind="ink" label="Bring back" onPress={bringBack} />
        ) : null}
      </div>
      <BottomBar><button type="button" className={classOf('primary')} onClick={newProducer.show}>New producer</button></BottomBar>
      <Overlay state={rename} title="Rename client">
        <ClientForm
          client={client}
          onSaved={async () => {
            await live.reload();
            announce(COPY.clientSaved);
            rename.hide();
          }}
        />
      </Overlay>
      <Overlay state={newProducer} title="New producer"><ProducerForm client={client} producer={null} state={newProducer} onSaved={live.reload} /></Overlay>
      <Overlay state={closeClient} title="Close client">
        <p>Closing starts the wait. You can bring this client back until it ends; after that everything under it is erased.</p>
        <AsyncButton kind="ink" label="Start closing" onPress={startClosing} />
      </Overlay>
      <h2 className="section-title">Producers</h2>
      {producers.length ? (
        <section role="region" aria-label="Producers table" className="table-frame" tabIndex={0}>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Town</th><th>Language</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{producers.map((producer) => <ProducerRow key={producer.id} client={client} producer={producer} reload={live.reload} />)}</tbody>
          </table>
        </section>
      ) : <EmptyState>No producers on this client yet.</EmptyState>}
      <h2 className="section-title">Jobs</h2>
      {jobs.length ? (
        <ul className="plain-list link-list">
          {jobs.map((job) => <li key={job.id}><Link href={`/desk/jobs/${job.id}`}>{job.title}</Link> · {LABELS.jobState[job.state]}</li>)}
        </ul>
      ) : <EmptyState>No jobs on this client yet.</EmptyState>}
    </section>
  );
}
