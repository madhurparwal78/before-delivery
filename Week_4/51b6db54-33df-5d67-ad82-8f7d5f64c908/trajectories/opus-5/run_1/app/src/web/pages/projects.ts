import { api, refusalText, type ApiFailure } from '../api.js';
import { button, combobox, el, field, fieldError, textbox } from '../dom.js';
import { openChannel } from '../live.js';
import { mountRegions } from '../regions.js';
import { go, onLeave } from '../router.js';
import { loadMe, person, setViewerSettings, viewerSettings } from '../session.js';

interface ProjectSummary {
  id: number;
  name: string;
  role: string;
}

export async function projectsPage(): Promise<HTMLElement> {
  const me = person();
  if (me === null) {
    go('/signin?next=/projects');
    return el('main', { class: 'column' });
  }
  const regions = mountRegions();
  const listCard = el('div', { class: 'card' });
  const nameInput = textbox('Project name');
  const nameField = field('Project name', nameInput);

  const draw = async (): Promise<void> => {
    const result = await api.get<{ projects: ProjectSummary[] }>('/api/projects');
    const projects = result.ok ? result.body.projects : [];
    listCard.replaceChildren(
      el('h1', { text: 'Projects' }),
      projects.length === 0
        ? el('div', { class: 'empty' }, [
            el('div', { class: 'empty-sticker', 'aria-hidden': 'true' }),
            el('p', { text: 'No projects yet' }),
          ])
        : el(
            'ul',
            { class: 'plain-list' },
            projects.map((project) =>
              el('li', {}, [
                el('a', { href: `/projects/${project.id}` }, [project.name]),
                el('span', { class: 'role-tag', text: project.role }),
              ]),
            ),
          ),
    );
  };

  const create = button('New project', async () => {
    fieldError(nameField, null);
    const result = await api.post<ApiFailure & { id: number }>('/api/projects', {
      name: nameInput.value.trim(),
    });
    if (!result.ok) {
      fieldError(nameField, result.body.errors?.name ?? refusalText(result));
      regions.alert(refusalText(result));
      return;
    }
    nameInput.value = '';
    await draw();
  });

  const settings = viewerSettings();
  const numberFormat = combobox(
    'Number format',
    [
      { value: 'en-US', label: 'en-US' },
      { value: 'en-IN', label: 'en-IN' },
    ],
    settings.number_format,
  );
  const timeZone = combobox(
    'Time zone',
    [
      { value: 'UTC', label: 'UTC' },
      { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
      { value: 'America/New_York', label: 'America/New_York' },
    ],
    settings.time_zone,
  );
  const save = button('Save settings', async () => {
    const result = await api.patch<ApiFailure>('/api/me', {
      number_format: numberFormat.value,
      time_zone: timeZone.value,
    });
    if (!result.ok) {
      regions.alert(refusalText(result));
      return;
    }
    setViewerSettings({
      number_format: numberFormat.value as 'en-US' | 'en-IN',
      time_zone: timeZone.value as 'UTC' | 'Asia/Kolkata' | 'America/New_York',
    });
    await loadMe();
    regions.notice('Settings saved');
  });

  await draw();

  const channel = openChannel('/api/me/live', (message) => {
    if (message.type === 'removed') {
      regions.alert(`You no longer have access to ${String(message.project_name)}`);
      void draw();
      return;
    }
    if (message.type === 'role') void draw();
  });
  onLeave(() => channel.close());

  return el('main', { class: 'column' }, [
    regions.root,
    listCard,
    el('div', { class: 'card' }, [el('h2', { text: 'Start a project' }), nameField, create]),
    el('div', { class: 'card' }, [
      el('h2', { text: 'How you read numbers and dates' }),
      field('Number format', numberFormat),
      field('Time zone', timeZone),
      save,
    ]),
  ]);
}
