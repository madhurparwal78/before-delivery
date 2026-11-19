import { api, refusalText, type ApiFailure } from '../api.js';
import {
  button,
  clear,
  combobox,
  el,
  field,
  fieldError,
  spinbutton,
  textbox,
  trapDialog,
} from '../dom.js';
import { openChannel } from '../live.js';
import { mountRegions, type Regions } from '../regions.js';
import { go, onLeave } from '../router.js';
import { date, num, person } from '../session.js';

interface Member {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface ProjectBody {
  id: number;
  name: string;
  role: string;
  members: Member[];
  sprites: { id: number; name: string }[];
}

interface InviteBody {
  invites: { id: number; email: string; role: string; state: string; expires_at: string }[];
}

interface LinkBody {
  links: {
    id: number;
    sprite: number;
    label: string;
    token: string;
    url: string;
    state: string;
    expires_at: string | null;
  }[];
}

interface ExportBody {
  exports: {
    id: number;
    job: number;
    label: string;
    state: string;
    seq: number;
    files: { name: string; size: number; sha256: string }[];
  }[];
}

interface ImportRecord {
  id: number;
  file_name: string;
}

export async function projectPage(params: string[]): Promise<HTMLElement> {
  if (person() === null) {
    go(`/signin?next=${window.location.pathname}`);
    return el('main', { class: 'column' });
  }
  const projectId = Number(params[0]);
  const regions = mountRegions();
  const result = await api.get<ProjectBody>(`/api/projects/${projectId}`);
  if (!result.ok) {
    return el('main', { class: 'column' }, [
      regions.root,
      el('div', { class: 'card' }, [el('h1', { text: 'That project is not here' })]),
    ]);
  }
  let project = result.body;
  const isOwner = project.role === 'owner';
  const canEdit = project.role === 'owner' || project.role === 'editor';

  const spritesCard = el('div', { class: 'card' });
  const membersCard = el('div', { class: 'card' });
  const invitesCard = el('div', { class: 'card' });
  const linksCard = el('div', { class: 'card' });
  const exportsCard = el('div', { class: 'card' });
  const importsCard = el('div', { class: 'card' });
  const imports: ImportRecord[] = [];

  const reloadProject = async (): Promise<void> => {
    const fresh = await api.get<ProjectBody>(`/api/projects/${projectId}`);
    if (!fresh.ok) {
      go('/projects');
      return;
    }
    project = fresh.body;
    drawSprites();
    drawMembers();
  };

  function drawSprites(): void {
    clear(spritesCard);
    spritesCard.append(el('h1', { text: project.name }));
    spritesCard.append(
      project.sprites.length === 0
        ? el('div', { class: 'empty' }, [el('p', { text: 'No sprites yet' })])
        : el(
            'ul',
            { class: 'plain-list' },
            project.sprites.map((sprite) =>
              el('li', {}, [
                el('a', { href: `/projects/${projectId}/sprites/${sprite.id}` }, [sprite.name]),
              ]),
            ),
          ),
    );
    if (canEdit) spritesCard.append(button('New sprite', () => openSpriteDialog(projectId, regions, reloadProject)));
  }

  function drawMembers(): void {
    clear(membersCard);
    membersCard.append(el('h2', { text: 'Members' }));
    const table = el('table', { 'aria-label': 'Members' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Name' }),
          el('th', { text: 'Email' }),
          el('th', { text: 'Role' }),
          el('th', { text: 'Remove' }),
        ]),
      ]),
    ]);
    const body = el('tbody');
    for (const member of project.members) {
      const roleSelect = combobox(
        `Role for ${member.name}`,
        [
          { value: 'editor', label: 'Editor' },
          { value: 'reviewer', label: 'Reviewer' },
        ],
        member.role,
      );
      if (member.role === 'owner' || !isOwner) roleSelect.disabled = true;
      roleSelect.addEventListener('change', async () => {
        const change = await api.patch<ApiFailure>(
          `/api/projects/${projectId}/members/${member.id}`,
          { role: roleSelect.value },
        );
        if (!change.ok) regions.alert(refusalText(change));
        await reloadProject();
      });
      const row = el('tr', { 'aria-label': member.name }, [
        el('td', { text: member.name }),
        el('td', { text: member.email }),
        el('td', {}, [member.role === 'owner' ? el('span', { text: 'Owner' }) : roleSelect]),
        el('td'),
      ]);
      if (isOwner && member.role !== 'owner') {
        (row.lastElementChild as HTMLElement).append(
          button(`Remove ${member.name}`, async () => {
            const removed = await api.remove<ApiFailure>(
              `/api/projects/${projectId}/members/${member.id}`,
            );
            if (!removed.ok) regions.alert(refusalText(removed));
            await reloadProject();
          }),
        );
      }
      body.append(row);
    }
    table.append(body);
    membersCard.append(table);
  }

  async function drawInvites(): Promise<void> {
    clear(invitesCard);
    invitesCard.append(el('h2', { text: 'Invites' }));
    const list = await api.get<InviteBody>(`/api/projects/${projectId}/invites`);
    const invites = list.ok ? list.body.invites : [];
    const table = el('table', { 'aria-label': 'Invites' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Email' }),
          el('th', { text: 'Role' }),
          el('th', { text: 'State' }),
          el('th', { text: 'Expires' }),
          el('th', { text: 'Revoke' }),
        ]),
      ]),
    ]);
    const body = el('tbody');
    for (const invite of invites) {
      const row = el('tr', { 'aria-label': invite.email }, [
        el('td', { text: invite.email }),
        el('td', { text: invite.role === 'editor' ? 'Editor' : 'Reviewer' }),
        el('td', { text: invite.state }),
        el('td', { text: date(invite.expires_at) }),
        el('td'),
      ]);
      if (isOwner && invite.state === 'pending') {
        (row.lastElementChild as HTMLElement).append(
          button('Revoke invite', async () => {
            const revoked = await api.remove<ApiFailure>(`/api/invites/${invite.id}`);
            if (!revoked.ok) regions.alert(refusalText(revoked));
            await drawInvites();
          }),
        );
      }
      body.append(row);
    }
    table.append(body);
    invitesCard.append(table);
    if (!isOwner) return;

    const emailInput = textbox('Invite email', { type: 'email' });
    const emailField = field('Invite email', emailInput);
    const roleSelect = combobox('Invite role', [
      { value: 'editor', label: 'Editor' },
      { value: 'reviewer', label: 'Reviewer' },
    ]);
    invitesCard.append(
      emailField,
      field('Invite role', roleSelect),
      button('Invite', async () => {
        fieldError(emailField, null);
        regions.notice('Sending invite…');
        const made = await api.post<ApiFailure>(`/api/projects/${projectId}/invites`, {
          email: emailInput.value.trim(),
          role: roleSelect.value,
        });
        if (!made.ok) {
          fieldError(emailField, made.body.errors?.email ?? refusalText(made));
          regions.alert(refusalText(made));
          regions.notice('');
          return;
        }
        regions.notice(`Invite created for ${emailInput.value.trim()}`);
        emailInput.value = '';
        await drawInvites();
      }),
    );
  }

  async function drawLinks(): Promise<void> {
    clear(linksCard);
    linksCard.append(el('h2', { text: 'Read-only links' }));
    const list = await api.get<LinkBody>(`/api/projects/${projectId}/links`);
    const links = list.ok ? list.body.links : [];
    const table = el('table', { 'aria-label': 'Read-only links' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Label' }),
          el('th', { text: 'URL' }),
          el('th', { text: 'State' }),
          el('th', { text: 'Ends' }),
          el('th', { text: 'Actions' }),
        ]),
      ]),
    ]);
    const body = el('tbody');
    for (const link of links) {
      const actions = el('td');
      if (isOwner && link.state === 'active') {
        actions.append(
          button('Revoke link', async () => {
            const revoked = await api.remove<ApiFailure>(`/api/links/${link.id}`);
            if (!revoked.ok) regions.alert(refusalText(revoked));
            else regions.notice('Link revoked');
            await drawLinks();
          }),
          button('Regenerate link', async () => {
            const made = await api.post<ApiFailure>(`/api/links/${link.id}/regenerate`);
            if (!made.ok) regions.alert(refusalText(made));
            else regions.notice('Link regenerated');
            await drawLinks();
          }),
        );
      }
      body.append(
        el('tr', { 'aria-label': link.label }, [
          el('td', { text: link.label }),
          el('td', {}, [el('a', { href: link.url, target: '_blank', rel: 'noreferrer' }, [link.url])]),
          el('td', { text: link.state }),
          el('td', { text: link.expires_at === null ? 'No end' : date(link.expires_at) }),
          actions,
        ]),
      );
    }
    table.append(body);
    linksCard.append(table);
    if (!isOwner) return;

    const spriteSelect = combobox(
      'Link sprite',
      project.sprites.map((sprite) => ({ value: String(sprite.id), label: sprite.name })),
    );
    const labelInput = textbox('Link label');
    const hoursInput = spinbutton('Link hours', 24, { min: '1', max: '720' });
    const hoursField = field('Link hours', hoursInput);
    linksCard.append(
      field('Link sprite', spriteSelect),
      field('Link label', labelInput),
      hoursField,
      button('Create link', async () => {
        fieldError(hoursField, null);
        const raw = hoursInput.value.trim();
        let expiresAt: string | null = null;
        if (raw !== '') {
          const hours = Number(raw);
          if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
            fieldError(hoursField, 'Use 1 to 720 hours');
            regions.alert('Use 1 to 720 hours');
            return;
          }
          const clock = await api.get<{ now: string }>('/api/config');
          const base = new Date(clock.body.now).getTime();
          expiresAt = new Date(base + hours * 3600000).toISOString();
        }
        regions.notice('Creating link…');
        const made = await api.post<ApiFailure>(`/api/sprites/${spriteSelect.value}/links`, {
          label: labelInput.value.trim(),
          expires_at: expiresAt,
        });
        if (!made.ok) {
          regions.alert(refusalText(made));
          regions.notice('');
          return;
        }
        regions.notice('Link created');
        labelInput.value = '';
        await drawLinks();
      }),
    );
  }

  async function drawExports(): Promise<void> {
    clear(exportsCard);
    exportsCard.append(el('h2', { text: 'Exports' }));
    const list = await api.get<ExportBody>(`/api/projects/${projectId}/exports`);
    const records = list.ok ? list.body.exports : [];
    const table = el('table', { 'aria-label': 'Exports' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Label' }),
          el('th', { text: 'State' }),
          el('th', { text: 'Files' }),
        ]),
      ]),
    ]);
    const body = el('tbody');
    for (const record of records) {
      body.append(
        el('tr', { 'aria-label': record.label === '' ? `Export ${record.id}` : record.label }, [
          el('td', { text: record.label === '' ? `Export ${record.id}` : record.label }),
          el('td', { text: record.state }),
          el(
            'td',
            {},
            record.files.map((file) =>
              el(
                'a',
                {
                  href: `/api/exports/${record.id}/files/${encodeURIComponent(file.name)}`,
                  download: file.name,
                  'aria-label': `Download ${file.name}`,
                },
                [`Download ${file.name}`],
              ),
            ),
          ),
        ]),
      );
    }
    table.append(body);
    exportsCard.append(table);
    if (!canEdit) return;

    const jobStatus = el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Job progress',
      class: 'live-region',
    });
    const cancelHost = el('div', { class: 'row' });
    exportsCard.append(
      button('Export project', async () => {
        const made = await api.post<ApiFailure & { job: number }>(
          `/api/projects/${projectId}/exports`,
          { scale: 1, padding: 2, extrude: 0, label: 'Project sheets' },
        );
        if (!made.ok) {
          regions.alert(refusalText(made));
          return;
        }
        watchJob(made.body.job, jobStatus, cancelHost, regions, drawExports);
      }),
      jobStatus,
      cancelHost,
    );
  }

  function drawImports(): void {
    clear(importsCard);
    importsCard.append(el('h2', { text: 'Imported images' }));
    if (!canEdit) return;
    const fileInput = el('input', { type: 'file', 'aria-label': 'Image file', accept: 'image/png,image/gif' });
    const fileField = field('Image file', fileInput);
    importsCard.append(
      fileField,
      button('Import image', async () => {
        fieldError(fileField, null);
        const file = fileInput.files?.[0];
        if (file === undefined) {
          fieldError(fileField, 'Choose a PNG or GIF image');
          return;
        }
        regions.notice('Importing…');
        const made = await api.upload<ApiFailure & { import: number; sprite: number; file_name: string }>(
          `/api/projects/${projectId}/imports`,
          file,
        );
        if (!made.ok) {
          const text = refusalText(made);
          fieldError(fileField, text);
          regions.alert(text);
          regions.notice('');
          return;
        }
        regions.notice(`Imported ${made.body.file_name}`);
        imports.push({ id: made.body.import, file_name: made.body.file_name });
        drawImports();
        await reloadProject();
      }),
      el(
        'ul',
        { class: 'plain-list' },
        imports.map((record) =>
          el('li', {}, [
            el(
              'a',
              {
                href: `/api/imports/${record.id}/original`,
                download: record.file_name,
                'aria-label': `Download original ${record.file_name}`,
              },
              [`Download original ${record.file_name}`],
            ),
          ]),
        ),
      ),
    );
  }

  drawSprites();
  drawMembers();
  await drawInvites();
  await drawLinks();
  await drawExports();
  drawImports();

  const channel = openChannel('/api/me/live', (message) => {
    if (message.type === 'removed' && Number(message.project) === projectId) {
      go('/projects');
      return;
    }
    if (message.type === 'role') void reloadProject();
  });
  onLeave(() => channel.close());

  return el('main', { class: 'columns' }, [
    regions.root,
    spritesCard,
    membersCard,
    invitesCard,
    linksCard,
    exportsCard,
    importsCard,
  ]);
}

function openSpriteDialog(projectId: number, regions: Regions, done: () => Promise<void>): void {
  const nameInput = textbox('Sprite name');
  const widthInput = spinbutton('Width', 32, { min: '1' });
  const heightInput = spinbutton('Height', 32, { min: '1' });
  const nameField = field('Sprite name', nameInput);
  const widthField = field('Width', widthInput);
  const heightField = field('Height', heightInput);
  const dialog = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'New sprite',
    class: 'dialog',
  });
  const shade = el('div', { class: 'shade' }, [dialog]);
  let release: (() => void) | null = null;
  const close = (): void => {
    release?.();
    shade.remove();
  };
  dialog.append(
    el('h2', { text: 'New sprite' }),
    nameField,
    widthField,
    heightField,
    el('div', { class: 'row' }, [
      button('Create sprite', async () => {
        for (const wrap of [nameField, widthField, heightField]) fieldError(wrap, null);
        const made = await api.post<ApiFailure>(`/api/projects/${projectId}/sprites`, {
          name: nameInput.value.trim(),
          width: Number(widthInput.value),
          height: Number(heightInput.value),
        });
        if (!made.ok) {
          const errors = made.body.errors ?? {};
          if (errors.name !== undefined) fieldError(nameField, errors.name);
          if (errors.width !== undefined) fieldError(widthField, errors.width);
          if (errors.height !== undefined) fieldError(heightField, errors.height);
          regions.alert(refusalText(made));
          return;
        }
        close();
        await done();
      }),
      button('Close', close),
    ]),
  );
  document.body.append(shade);
  release = trapDialog(dialog, close);
}

/** One place turns a job's live state into the published progress copy. */
export function watchJob(
  jobId: number,
  status: HTMLElement,
  cancelHost: HTMLElement,
  regions: Regions,
  onStored: () => Promise<void>,
): void {
  clear(cancelHost);
  const cancel = button('Cancel job', async () => {
    const stopped = await api.post<ApiFailure>(`/api/jobs/${jobId}/cancel`);
    if (!stopped.ok) regions.alert(refusalText(stopped));
  });
  cancelHost.append(cancel);
  status.textContent = 'Processing 0 of 0';
  const source = new EventSource(`/api/jobs/${jobId}/events`, { withCredentials: true });
  source.onmessage = (event) => {
    const message = JSON.parse(event.data) as {
      state: string;
      done: number;
      total: number;
      files: { name: string }[];
    };
    if (message.state === 'queued' || message.state === 'rendering') {
      status.textContent = `Processing ${num(message.done)} of ${num(message.total)}`;
      return;
    }
    if (message.state === 'cancelled') {
      status.textContent = `Cancelled at ${num(message.done)} of ${num(message.total)}: nothing stored`;
    } else if (message.state === 'failed') {
      status.textContent = 'Export failed: nothing stored';
    } else {
      status.textContent = `Stored: ${message.files.map((file) => file.name).join(', ')}`;
      void onStored();
    }
    clear(cancelHost);
    source.close();
  };
}
