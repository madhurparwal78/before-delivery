import { COPY, LABELS, say } from '../../domain/copy.js';
import { longDateIn } from '../../domain/time.js';
import type { Town } from '../../domain/time.js';
import {
  announce,
  api,
  closeSurface,
  focusBack,
  focusHeading,
  go,
  isRefusal,
  openSurface,
  redraw,
  refreshOnce,
  registerScreen,
  run,
  state,
} from '../app.js';
import type { Surface } from '../app.js';
import type { Child } from '../dom.js';
import { h } from '../dom.js';
import { registerSurface } from '../shell.js';
import {
  button,
  combobox,
  emptyState,
  field,
  link,
  loadingBars,
  problemsRegion,
  surfaceView,
  tableFrame,
} from '../ui.js';
import type { Client, Job, Producer } from './jobs.js';

const PLACE_OPTIONS = Object.entries(LABELS.place).map(([value, label]) => ({ value, label }));
const TOWN_OPTIONS = Object.entries(LABELS.town).map(([value, label]) => ({ value, label }));
const LANGUAGE_OPTIONS = Object.entries(LABELS.language).map(([value, label]) => ({
  value,
  label,
}));

type ClientsData = {
  clients: Client[];
  total: number;
  erasedClients: { id: string; name: string; erasedAt: string }[];
};

registerScreen({
  name: 'clients',
  frame: 'desk',
  refreshes: true,
  heading: () => 'Clients',
  load: async () =>
    (await api<ClientsData>('/api/clients')) as unknown as Record<string, unknown>,
  mainAction: () =>
    button({
      id: 'new-client',
      label: 'New client',
      kind: 'primary',
      onPress: () => openSurface('New client', 'new-client', { values: { place: 'netherlands' } }),
    }),
  view: (raw) => {
    const data = raw as unknown as ClientsData;
    if (state.loading) return [loadingBars('Reading the clients')];
    return [
      data.clients.length === 0
        ? emptyState('No client on this desk yet.')
        : tableFrame(
            'Clients table',
            h(
              'table',
              {},
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h('th', { scope: 'col' }, 'Name'),
                  h('th', { scope: 'col' }, 'Place'),
                  h('th', { scope: 'col' }, 'State'),
                ),
              ),
              h(
                'tbody',
                {},
                ...data.clients.map((client) =>
                  h(
                    'tr',
                    { key: client.id },
                    h('td', {}, link(`/desk/clients/${client.id}`, client.name)),
                    h('td', {}, LABELS.place[client.place as keyof typeof LABELS.place]),
                    h(
                      'td',
                      {},
                      LABELS.clientState[client.state as keyof typeof LABELS.clientState],
                    ),
                  ),
                ),
              ),
            ),
          ),
      h(
        'section',
        { key: 'erased', class: 'section' },
        h('h2', {}, 'Erased clients'),
        data.erasedClients.length === 0
          ? h('p', {}, 'None.')
          : h(
              'ul',
              { class: 'list-plain' },
              ...data.erasedClients.map((client) =>
                h('li', { key: client.id }, `${client.name} — ${LABELS.clientState.erased}`),
              ),
            ),
      ),
    ];
  },
});

type ClientData = {
  client: Client;
  producers: Producer[];
  jobs: Job[];
};

registerScreen({
  name: 'client',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => (raw as unknown as ClientData).client?.name ?? '',
  load: async () => {
    const id = state.screen.clientId ?? '';
    const [client, producers, jobs] = await Promise.all([
      api<Client>(`/api/clients/${id}`),
      api<{ producers: Producer[] }>(`/api/clients/${id}/producers`),
      api<{ jobs: Job[] }>(`/api/jobs?clientId=${id}`),
    ]);
    return { client, producers: producers.producers, jobs: jobs.jobs } as unknown as Record<
      string,
      unknown
    >;
  },
  mainAction: () =>
    button({
      id: 'new-producer',
      label: 'New producer',
      kind: 'primary',
      onPress: () =>
        openSurface('New producer', 'new-producer', {
          values: { town: 'amsterdam', language: 'en' },
        }),
    }),
  view: (raw) => {
    const data = raw as unknown as ClientData;
    if (state.loading || data.client === undefined) return [loadingBars('Reading the client')];
    const client = data.client;
    return [
      h(
        'p',
        { key: 'place' },
        `${LABELS.place[client.place as keyof typeof LABELS.place]} · `,
        h(
          'span',
          { 'data-part': 'client-state' },
          LABELS.clientState[client.state as keyof typeof LABELS.clientState],
        ),
      ),
      client.closesAt === null
        ? null
        : h(
            'p',
            { key: 'closes' },
            say.closing(client.name, longDateIn(new Date(client.closesAt), 'amsterdam')),
          ),
      h(
        'div',
        { key: 'client-actions', class: 'row-actions' },
        client.state === 'active'
          ? button({
              id: 'rename-client',
              label: 'Rename client',
              onPress: () =>
                openSurface('Rename client', 'rename-client', {
                  values: { name: client.name, place: client.place },
                }),
            })
          : null,
        client.state === 'active'
          ? button({
              id: 'delete-client',
              label: 'Delete client',
              pendingKey: 'delete-client',
              onPress: () =>
                void run('delete-client', async () => {
                  try {
                    await api(`/api/clients/${client.id}`, { method: 'DELETE' });
                    announce(COPY.clientDeleted);
                    await go('/desk/clients');
                  } catch (error) {
                    if (isRefusal(error)) {
                      state.problems = { client: error.failure.message };
                      announce(error.failure.message);
                      redraw();
                      return;
                    }
                    throw error;
                  }
                }),
            })
          : null,
        client.state === 'active'
          ? button({
              id: 'close-client',
              label: 'Close client',
              onPress: () => openSurface('Close client', 'close-client'),
            })
          : null,
        client.state === 'closing'
          ? button({
              id: 'bring-back',
              label: 'Bring back',
              pendingKey: 'bring-back',
              onPress: () =>
                void run('bring-back', async () => {
                  try {
                    await api(`/api/clients/${client.id}/bring-back`, { method: 'POST' });
                    announce(say.broughtBack(client.name));
                    await refreshOnce();
                    focusHeading();
                  } catch (error) {
                    if (isRefusal(error)) {
                      state.problems = { client: error.failure.message };
                      announce(error.failure.message);
                      redraw();
                      return;
                    }
                    throw error;
                  }
                }),
            })
          : null,
      ),
      h(
        'section',
        { key: 'producers', class: 'section' },
        h('h2', {}, 'Producers'),
        data.producers.length === 0
          ? emptyState('No producer on this client yet.')
          : h(
              'ul',
              { class: 'list-plain' },
              ...data.producers.map((producer) =>
                h(
                  'li',
                  { key: producer.id },
                  h('p', {}, `${producer.name} · ${producer.email}`),
                  h(
                    'p',
                    {},
                    `${LABELS.town[producer.town as keyof typeof LABELS.town]} · ${
                      LABELS.language[producer.language as keyof typeof LABELS.language]
                    }`,
                  ),
                  button({
                    id: `edit-producer-${producer.id}`,
                    label: `Edit producer ${producer.name}`,
                    onPress: () =>
                      openSurface('Edit producer', `edit-producer-${producer.id}`, {
                        values: {
                          id: producer.id,
                          name: producer.name,
                          email: producer.email,
                          town: producer.town,
                          language: producer.language,
                        },
                      }),
                  }),
                ),
              ),
            ),
      ),
      h(
        'section',
        { key: 'jobs', class: 'section' },
        h('h2', {}, 'Jobs'),
        data.jobs.length === 0
          ? emptyState('No job for this client yet.')
          : h(
              'ul',
              { class: 'list-plain' },
              ...data.jobs.map((job) =>
                h('li', { key: job.id }, link(`/desk/jobs/${job.id}`, job.title)),
              ),
            ),
      ),
    ];
  },
});

registerSurface('New client', (surface) =>
  clientDialog(surface, 'New client', async () => {
    const made = await api<Client>('/api/clients', {
      method: 'POST',
      body: { name: surface.values['name'] ?? '', place: surface.values['place'] ?? '' },
    });
    closeSurface('New client');
    announce(COPY.clientAdded);
    await go(`/desk/clients/${made.id}`);
  }),
);

registerSurface('Rename client', (surface) =>
  clientDialog(surface, 'Rename client', async () => {
    await api(`/api/clients/${state.screen.clientId ?? ''}`, {
      method: 'PATCH',
      body: { name: surface.values['name'] ?? '', place: surface.values['place'] ?? '' },
    });
    closeSurface('Rename client');
    announce(COPY.clientSaved);
    await refreshOnce();
  }),
);

function clientDialog(surface: Surface, title: string, save: () => Promise<void>): Child {
  const set = (name: string) => (value: string) => {
    surface.values[name] = value;
    redraw();
  };
  return surfaceView(surface, {
    title,
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      field({
        id: 'client-name',
        label: 'Name',
        value: surface.values['name'] ?? '',
        onInput: set('name'),
        problem: surface.problems['name'],
      }),
      combobox({
        id: 'client-place',
        label: 'Place',
        value: surface.values['place'] ?? 'netherlands',
        options: PLACE_OPTIONS,
        onChange: set('place'),
        problem: surface.problems['place'],
      }),
    ],
    footer: [
      button({
        id: 'save-client',
        label: 'Save',
        kind: 'primary',
        pendingKey: `client-${title}`,
        onPress: () => void run(`client-${title}`, guard(surface, save)),
      }),
    ],
  });
}

registerSurface('New producer', (surface) =>
  producerDialog(surface, 'New producer', async () => {
    await api(`/api/clients/${state.screen.clientId ?? ''}/producers`, {
      method: 'POST',
      body: producerBody(surface),
    });
    closeSurface('New producer');
    announce(COPY.producerAdded);
    await refreshOnce();
    focusBack('new-producer');
  }),
);

registerSurface('Edit producer', (surface) =>
  producerDialog(surface, 'Edit producer', async () => {
    await api(`/api/producers/${surface.values['id'] ?? ''}`, {
      method: 'PATCH',
      body: producerBody(surface),
    });
    closeSurface('Edit producer');
    announce(COPY.producerSaved);
    await refreshOnce();
  }),
);

function producerBody(surface: Surface): Record<string, string> {
  return {
    name: surface.values['name'] ?? '',
    email: surface.values['email'] ?? '',
    town: surface.values['town'] ?? 'amsterdam',
    language: surface.values['language'] ?? 'en',
  };
}

function producerDialog(surface: Surface, title: string, save: () => Promise<void>): Child {
  const set = (name: string) => (value: string) => {
    surface.values[name] = value;
    redraw();
  };
  return surfaceView(surface, {
    title,
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      field({
        id: 'producer-name',
        label: 'Name',
        autocomplete: 'name',
        value: surface.values['name'] ?? '',
        onInput: set('name'),
        problem: surface.problems['name'],
      }),
      field({
        id: 'producer-email',
        label: 'Email',
        kind: 'email',
        autocomplete: 'email',
        value: surface.values['email'] ?? '',
        onInput: set('email'),
        problem: surface.problems['email'],
      }),
      combobox({
        id: 'producer-town',
        label: 'Town',
        value: surface.values['town'] ?? 'amsterdam',
        options: TOWN_OPTIONS,
        onChange: set('town'),
      }),
      combobox({
        id: 'producer-language',
        label: 'Language',
        value: surface.values['language'] ?? 'en',
        options: LANGUAGE_OPTIONS,
        onChange: set('language'),
      }),
    ],
    footer: [
      button({
        id: 'save-producer',
        label: 'Save',
        kind: 'primary',
        pendingKey: `producer-${title}`,
        onPress: () => void run(`producer-${title}`, guard(surface, save)),
      }),
    ],
  });
}

registerSurface('Close client', (surface) => {
  const data = state.data as unknown as ClientData;
  return surfaceView(surface, {
    title: 'Close client',
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      h(
        'p',
        {},
        'Closing starts a wait. Until it ends you can bring the client back exactly as it was.',
      ),
    ],
    footer: [
      button({
        id: 'start-closing',
        label: 'Start closing',
        kind: 'primary',
        pendingKey: 'close-client',
        onPress: () =>
          void run(
            'close-client',
            guard(surface, async () => {
              const closed = await api<Client>(`/api/clients/${data.client.id}/close`, {
                method: 'POST',
              });
              closeSurface('Close client');
              announce(
                say.closing(
                  closed.name,
                  longDateIn(new Date(closed.closesAt as string), 'amsterdam' as Town),
                ),
              );
              await refreshOnce();
            }),
          ),
      }),
    ],
  });
});

/** A dialog refused by the server stays open as typed with focus on the message. */
export function guard(surface: Surface, work: () => Promise<void>): () => Promise<void> {
  return async () => {
    surface.problems = {};
    surface.message = null;
    try {
      await work();
    } catch (error) {
      if (isRefusal(error)) {
        surface.problems = error.failure.fields;
        surface.message = error.failure.message;
        announce(error.failure.message);
        redraw();
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(
              `[data-surface-name="${surface.name}"] .problems`,
            )
            ?.focus();
        });
        return;
      }
      throw error;
    }
  };
}
