// Landing, sign-up, sign-in, projects, project, invite and share pages.
import { api, ApiFail, el, clear, qs, byId, showErrors, announceAlert, myNumberFormat, myZone, loadConfig, type Me } from './base.js';
import { formatNumber, formatDate, composite, makeColorOf, tagSequence } from '../shared/rules.js';

// ---- landing ----

export function renderLanding(signedIn: boolean): void {
  const app = byId('app');
  clear(app);
  const hero = el('section', { class: 'hero' });
  const headline = el('h1', { class: 'headline' });
  headline.append(el('span', { class: 'headline-grey' }, 'Draw the same sprite, '), el('span', { class: 'headline-white' }, 'at the same time.'));
  hero.append(headline);
  const spriteCanvas = el('canvas', { id: 'hero-sprite', class: 'hero-sprite', 'aria-label': 'Demo sprite' });
  hero.append(spriteCanvas);
  const pill = el('a', { class: 'pill big', href: signedIn ? '/projects' : '/signup', 'aria-label': 'Start a project' }, 'Start a project');
  hero.append(pill);
  const stickers = el('div', { class: 'hero-stickers' });
  hero.append(stickers);
  app.append(hero);
  drawHeroSprite(spriteCanvas as HTMLCanvasElement, stickers);
  const fields: [string, string, string][] = [
    ['mint', 'Live co-editing', 'Two cursors, one sprite, no waiting for a file.'],
    ['cyan', 'The swatch flood', 'A palette change reaches every pixel, everywhere.'],
    ['lemon', 'Tiles that match', 'Edge-matched tilesets snap a courtyard together.'],
    ['orange', 'Pinned review', 'Comments land on the exact pixel and frame.'],
    ['cornflower', 'Stored exports', 'Sheets, PNG and GIF, stored and checksummed.']
  ];
  for (const [tone, title, copy] of fields) {
    const field = el('section', { class: `field field-${tone}` });
    field.append(el('h2', {}, title), el('p', {}, copy));
    app.append(field);
  }
}

function drawHeroSprite(canvas: HTMLCanvasElement, stickers: HTMLElement): void {
  // a procedurally drawn gumdrop that animates once and settles
  const w = 16, h = 16;
  canvas.width = w * 8; canvas.height = h * 8;
  const palette = [
    { index: 1, color: '1a0c22ff' }, { index: 2, color: 'f2e9e4ff' }, { index: 3, color: 'ff5d8fff' },
    { index: 4, color: 'ff8040ff' }, { index: 5, color: 'fff2b2ff' }
  ];
  const colorOf = makeColorOf(palette);
  const frames: number[][][] = [];
  for (let f = 0; f < 4; f++) {
    const rows = Array.from({ length: h }, () => new Array<number>(w).fill(0));
    const top = 3 - (f % 2);
    for (let y = 0; y < 9; y++) {
      const t = y / 8;
      const half = Math.round(6 - t * t * 3);
      for (let x = -half; x <= half; x++) {
        if (3 + x >= 0 && 3 + x < w && top + y < h) rows[top + y][3 + x] = 4;
      }
    }
    for (let x = 0; x < 3; x++) {
      rows[Math.min(h - 1, top + 9)][2 + x] = 3;
      rows[Math.min(h - 1, top + 9)][7 + x] = 3;
    }
    rows[top + 3][2] = 5;
    rows[top + 4][2] = 5;
    frames.push(rows);
  }
  let frame = 0;
  const render = (): void => {
    const buf = composite(w, h, [{ rows: frames[frame], colorOf, opacity: 100, blend: 'normal', visible: true }]);
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    img.data.set(buf);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    frame = 0;
    render();
  } else {
    const iv = window.setInterval(() => {
      frame = (frame + 1) % 4;
      render();
      if (frame === 0) { window.clearInterval(iv); void iv; }
    }, 240);
  }
  for (let i = 0; i < 4; i++) {
    const sticker = el('canvas', { class: `sticker sticker-${i}` });
    sticker.width = 40; sticker.height = 40;
    const rows = frames[i % frames.length];
    const ctx = (sticker as HTMLCanvasElement).getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const img = ctx.createImageData(w, h);
    const buf = composite(w, h, [{ rows, colorOf, opacity: 100, blend: 'normal', visible: true }]);
    img.data.set(buf);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, 40, 40);
    sticker.style.transform = `rotate(${(i * 17 - 20) % 30}deg)`;
    stickers.append(sticker);
  }
}

// ---- sign-up and sign-in ----

export function renderSignup(): void {
  const app = byId('app');
  clear(app);
  const card = el('div', { class: 'white-card card-form' });
  card.append(el('h1', { class: 'page-title' }, 'Create your account'));
  const alertBox = el('div', { class: 'alert-box' });
  const name = el('input', { id: 'signup-name', class: 'text-input', 'aria-label': 'Name' });
  const email = el('input', { id: 'signup-email', class: 'text-input', 'aria-label': 'Email', type: 'email' });
  const password = el('input', { id: 'signup-password', class: 'text-input', 'aria-label': 'Password', type: 'password' });
  const create = el('button', { id: 'create-account', class: 'pill', 'aria-label': 'Create account' }, 'Create account');
  const codeWrap = el('div', { class: 'code-wrap hidden' });
  const code = el('input', { id: 'signup-code', class: 'text-input', 'aria-label': 'Code' });
  const confirm = el('button', { id: 'confirm-code', class: 'pill', 'aria-label': 'Confirm' }, 'Confirm');
  codeWrap.append(code, confirm);
  const notice = el('div', { id: 'notices', role: 'status', class: 'notice' });
  create.addEventListener('click', async () => {
    try {
      await api.post('/api/auth/signup', {
        name: (name as HTMLInputElement).value,
        email: (email as HTMLInputElement).value,
        password: (password as HTMLInputElement).value
      });
      codeWrap.classList.remove('hidden');
      notice.textContent = `We are sending your code to ${(email as HTMLInputElement).value}`;
    } catch (e) {
      if (e instanceof ApiFail) showErrors(card, e);
    }
  });
  confirm.addEventListener('click', async () => {
    try {
      await api.post('/api/auth/confirm', {
        email: (email as HTMLInputElement).value,
        code: (code as HTMLInputElement).value
      });
      window.location.href = '/projects';
    } catch (e) {
      if (e instanceof ApiFail) showErrors(card, e);
    }
  });
  card.append(alertBox, name, email, password, create, codeWrap, notice);
  app.append(card);
}

export function renderSignin(): void {
  const app = byId('app');
  clear(app);
  const card = el('div', { class: 'white-card card-form' });
  card.append(el('h1', { class: 'page-title' }, 'Sign in'));
  const alertBox = el('div', { class: 'alert-box' });
  const email = el('input', { class: 'text-input', 'aria-label': 'Email', type: 'email' });
  const password = el('input', { class: 'text-input', 'aria-label': 'Password', type: 'password' });
  const submit = el('button', { class: 'pill', 'aria-label': 'Sign in' }, 'Sign in');
  submit.addEventListener('click', async () => {
    try {
      await api.post('/api/auth/login', {
        email: (email as HTMLInputElement).value,
        password: (password as HTMLInputElement).value
      });
      window.location.href = '/projects';
    } catch (e) {
      if (e instanceof ApiFail) showErrors(card, e);
    }
  });
  card.append(alertBox, email, password, submit);
  app.append(card);
}

// ---- projects list ----

export async function renderProjects(me: Me): Promise<void> {
  const app = byId('app');
  clear(app);
  const data = await api.get('/api/projects') as { projects: { id: number; name: string; role: string }[] };
  const wrap = el('div', { class: 'page-projects' });
  wrap.append(el('h1', { class: 'page-title' }, 'Projects'));
  const newProject = el('button', { id: 'new-project', class: 'pill', 'aria-label': 'New project' }, 'New project');
  const projectName = el('input', { id: 'project-name', class: 'text-input', 'aria-label': 'Project name' });
  const alertBox = el('div', { class: 'alert-box' });
  newProject.addEventListener('click', async () => {
    try {
      const res = await api.post('/api/projects', { name: (projectName as HTMLInputElement).value }) as { id: number };
      window.location.href = `/projects/${res.id}`;
    } catch (e) { if (e instanceof ApiFail) showErrors(wrap, e); }
  });
  wrap.append(newProject, projectName, alertBox);
  const listCard = el('ul', { class: 'white-card project-list' });
  if (!data.projects.length) listCard.append(el('li', { class: 'empty' }, 'No projects yet'));
  for (const project of data.projects) {
    const li = el('li', {});
    li.append(el('a', { class: 'project-link', href: `/projects/${project.id}` }, project.name));
    li.append(el('span', { class: 'project-role' }, project.role));
    listCard.append(li);
  }
  wrap.append(listCard);

  // settings card
  const settings = el('div', { class: 'white-card card-form' });
  settings.append(el('h2', {}, 'Settings'));
  const numberFormat = el('select', { id: 'number-format', class: 'select-input', 'aria-label': 'Number format' });
  numberFormat.append(el('option', { value: 'en-US' }, 'en-US'), el('option', { value: 'en-IN' }, 'en-IN'));
  (numberFormat as HTMLSelectElement).value = me.number_format;
  const timeZone = el('select', { id: 'time-zone', class: 'select-input', 'aria-label': 'Time zone' });
  timeZone.append(el('option', { value: 'UTC' }, 'UTC'), el('option', { value: 'Asia/Kolkata' }, 'Asia/Kolkata'), el('option', { value: 'America/New_York' }, 'America/New_York'));
  (timeZone as HTMLSelectElement).value = me.time_zone;
  const saveSettings = el('button', { id: 'save-settings', class: 'pill', 'aria-label': 'Save settings' }, 'Save settings');
  const notice = el('div', { id: 'notices', role: 'status', class: 'notice' });
  saveSettings.addEventListener('click', async () => {
    try {
      await api.patch('/api/me', {
        number_format: (numberFormat as HTMLSelectElement).value,
        time_zone: (timeZone as HTMLSelectElement).value
      });
      notice.textContent = 'Settings saved';
    } catch (e) { if (e instanceof ApiFail) showErrors(settings, e); }
  });
  settings.append(numberFormat, timeZone, saveSettings, notice);
  wrap.append(settings);
  app.append(wrap);
}

// ---- project page ----

export async function renderProject(projectId: number, me: Me): Promise<void> {
  const app = byId('app');
  clear(app);
  const project = await api.get(`/api/projects/${projectId}`) as {
    id: number; name: string; role: string;
    members: { id: number; name: string; email: string; role: string }[];
    sprites: { id: number; name: string }[];
  };
  const links = project.role === 'owner' ? await api.get(`/api/projects/${projectId}/links`) as { links: { id: number; sprite: number; label: string; token: string; url: string; state: string; expires_at: string | null }[] } : { links: [] };
  const invites = project.role === 'owner' ? await api.get(`/api/projects/${projectId}/invites`) as { invites: { id: number; email: string; role: string; state: string; expires_at: string | null }[] } : { invites: [] };
  const exportsData = await api.get(`/api/projects/${projectId}/exports`) as { exports: { id: number; job: number; label: string | null; seq: number; files: { name: string; size: number; sha256: string }[] }[] };
  const wrap = el('div', { class: 'page-project' });
  wrap.append(el('h1', { class: 'page-title' }, project.name));

  // sprites card
  const spritesCard = el('div', { class: 'white-card' });
  spritesCard.append(el('h2', {}, 'Sprites'));
  for (const sprite of project.sprites) {
    spritesCard.append(el('p', {}, ''), (() => { const a = el('a', { class: 'project-link', href: `/projects/${projectId}/sprites/${sprite.id}` }, sprite.name); return a; })());
  }
  if (!project.sprites.length) spritesCard.append(el('p', { class: 'empty' }, 'No sprites yet'));
  if (project.role !== 'reviewer') {
    const newSprite = el('button', { id: 'new-sprite', class: 'pill', 'aria-label': 'New sprite' }, 'New sprite');
    const dialog = el('div', { role: 'dialog', 'aria-label': 'New sprite', class: 'dialog' });
    const name = el('input', { id: 'sprite-name', class: 'text-input', 'aria-label': 'Sprite name' });
    const width = el('input', { id: 'sprite-width', type: 'number', class: 'number-input', 'aria-label': 'Width', value: '16' });
    const height = el('input', { id: 'sprite-height', type: 'number', class: 'number-input', 'aria-label': 'Height', value: '16' });
    const create = el('button', { id: 'create-sprite', class: 'pill', 'aria-label': 'Create sprite' }, 'Create sprite');
    create.addEventListener('click', async () => {
      try {
        const res = await api.post(`/api/projects/${projectId}/sprites`, {
          name: (name as HTMLInputElement).value,
          width: Number((width as HTMLInputElement).value),
          height: Number((height as HTMLInputElement).value)
        }) as { id: number };
        window.location.href = `/projects/${projectId}/sprites/${res.id}`;
      } catch (e) { if (e instanceof ApiFail) showErrors(dialog, e); }
    });
    dialog.append(name, width, height, create);
    newSprite.addEventListener('click', () => {
      document.body.append(dialog);
      if (pageDialog.openDialog) pageDialog.openDialog(dialog, newSprite);
    });
    spritesCard.append(newSprite);
    // import image
    const importImage = el('button', { id: 'import-image', class: 'pill', 'aria-label': 'Import image' }, 'Import image');
    const fileInput = el('input', { type: 'file', id: 'image-file', class: 'visually-hidden', 'aria-label': 'Image file' });
    const notice = el('div', { id: 'notices', role: 'status', class: 'notice' });
    fileInput.addEventListener('change', async () => {
      const file = (fileInput as HTMLInputElement).files?.[0];
      if (!file) return;
      notice.textContent = 'Importing…';
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/projects/${projectId}/imports`, { method: 'POST', body: form, credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json() as { sprite: number; file_name: string };
        notice.textContent = `Imported ${data.file_name}`;
        const link = el('a', { href: `/api/imports/original/${data.sprite}` }, '');
        void link;
        spritesCard.append(el('p', {}, ''), el('a', { class: 'project-link', href: `/projects/${projectId}/sprites/${data.sprite}` }, data.file_name));
      } else {
        const body = await res.json() as Record<string, unknown>;
        if (res.status === 503) announceAlert(spritesCard, 'Storage is unavailable. Your artwork is safe.');
        else showErrors(spritesCard, new ApiFail(res.status, body));
      }
    });
    importImage.addEventListener('click', () => fileInput.click());
    spritesCard.append(importImage, fileInput, notice);
  }
  wrap.append(spritesCard);

  // members card
  const membersCard = el('div', { class: 'white-card' });
  membersCard.append(el('h2', {}, 'Members'));
  const table = el('table', { 'aria-label': 'Members', class: 'table' });
  const tbody = el('tbody', {});
  for (const member of project.members) {
    const tr = el('tr', { 'aria-label': member.name });
    const roleCell = el('td', {});
      if (member.role === 'owner') {
        roleCell.append(el('span', {}, 'Owner'));
      } else if (project.role === 'owner') {
        const select = el('select', { class: 'select-input', 'aria-label': `Role for ${member.name}` });
        select.append(el('option', { value: 'editor' }, 'Editor'), el('option', { value: 'reviewer' }, 'Reviewer'));
        (select as HTMLSelectElement).value = member.role;
        select.addEventListener('change', async () => {
          try {
            await api.patch(`/api/projects/${projectId}/members/${member.id}`, { role: (select as HTMLSelectElement).value });
          } catch (e) { if (e instanceof ApiFail) showErrors(membersCard, e); }
        });
        roleCell.append(select);
      } else {
        roleCell.append(el('span', {}, member.role));
      }
      tr.append(el('td', {}, member.name), roleCell);
      if (project.role === 'owner' && member.role !== 'owner') {
        const removeCell = el('td', {});
        const remove = el('button', { class: 'pill small', 'aria-label': `Remove ${member.name}` }, `Remove ${member.name}`);
        remove.addEventListener('click', async () => {
          try {
            await api.del(`/api/projects/${projectId}/members/${member.id}`);
            tr.remove();
          } catch (e) { if (e instanceof ApiFail) showErrors(membersCard, e); }
        });
        removeCell.append(remove);
        tr.append(removeCell);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    membersCard.append(table);
    wrap.append(membersCard);

  // invites card (owner)
  if (project.role === 'owner') {
    const invitesCard = el('div', { class: 'white-card' });
    invitesCard.append(el('h2', {}, 'Invites'));
    const inviteEmail = el('input', { id: 'invite-email', class: 'text-input', 'aria-label': 'Invite email', type: 'email' });
    const inviteRole = el('select', { id: 'invite-role', class: 'select-input', 'aria-label': 'Invite role' });
    inviteRole.append(el('option', { value: 'editor' }, 'Editor'), el('option', { value: 'reviewer' }, 'Reviewer'));
    const inviteBtn = el('button', { id: 'send-invite', class: 'pill', 'aria-label': 'Invite' }, 'Invite');
    const notice = el('div', { id: 'invite-notice', role: 'status', class: 'notice' });
    inviteBtn.addEventListener('click', async () => {
      notice.textContent = 'Sending invite…';
      try {
        const res = await api.post(`/api/projects/${projectId}/invites`, {
          email: (inviteEmail as HTMLInputElement).value,
          role: (inviteRole as HTMLSelectElement).value
        }) as { id: number };
        notice.textContent = `Invite created for ${(inviteEmail as HTMLInputElement).value}`;
        void res;
      } catch (e) { if (e instanceof ApiFail) showErrors(invitesCard, e); }
    });
    invitesCard.append(inviteEmail, inviteRole, inviteBtn, notice);
    const inviteTable = el('table', { 'aria-label': 'Invites', class: 'table' });
    const inviteBody = el('tbody', {});
    for (const invite of invites.invites) {
      const tr = el('tr', {});
      tr.append(el('td', {}, invite.email), el('td', {}, invite.role), el('td', {}, invite.state),
        el('td', {}, formatDate(invite.expires_at ?? '', myNumberFormat(), myZone())));
      if (invite.state === 'pending') {
        const revokeCell = el('td', {});
        const revoke = el('button', { class: 'pill small', 'aria-label': 'Revoke invite' }, 'Revoke invite');
        revoke.addEventListener('click', async () => {
          try {
            await api.del(`/api/invites/${invite.id}`);
            tr.remove();
          } catch (e) { if (e instanceof ApiFail) showErrors(invitesCard, e); }
        });
        revokeCell.append(revoke);
        tr.append(revokeCell);
      }
      inviteBody.append(tr);
    }
    inviteTable.append(inviteBody);
    invitesCard.append(inviteTable);
    wrap.append(invitesCard);

    // links card (owner)
    const linksCard = el('div', { class: 'white-card' });
    linksCard.append(el('h2', {}, 'Read-only links'));
    const linkSprite = el('select', { id: 'link-sprite', class: 'select-input', 'aria-label': 'Link sprite' });
    for (const sprite of project.sprites) linkSprite.append(el('option', { value: String(sprite.id) }, sprite.name));
    const linkLabel = el('input', { id: 'link-label', class: 'text-input', 'aria-label': 'Link label' });
    const linkHours = el('input', { id: 'link-hours', type: 'number', min: 1, max: 720, value: 24, class: 'number-input', 'aria-label': 'Link hours' });
    const createLink = el('button', { id: 'create-link', class: 'pill', 'aria-label': 'Create link' }, 'Create link');
    const notice2 = el('div', { id: 'link-notice', role: 'status', class: 'notice' });
    createLink.addEventListener('click', async () => {
      notice2.textContent = 'Creating link…';
      const hoursValue = (linkHours as HTMLInputElement).value;
      const cfg = await api.get('/api/config') as { now: string };
      let expiresAt: string | null = null;
      if (hoursValue === '') expiresAt = null;
      else {
        const hours = Number(hoursValue);
        if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
          announceAlert(linksCard, 'Use 1 to 720 hours');
          return;
        }
        expiresAt = new Date(Date.parse(cfg.now) + hours * 3600000).toISOString();
      }
      try {
        await api.post(`/api/sprites/${(linkSprite as HTMLSelectElement).value}/links`, {
          label: (linkLabel as HTMLInputElement).value, expires_at: expiresAt
        });
        notice2.textContent = 'Link created';
        window.location.reload();
      } catch (e) { if (e instanceof ApiFail) showErrors(linksCard, e); }
    });
    linksCard.append(linkSprite, linkLabel, linkHours, createLink, notice2);
    const linksTable = el('table', { 'aria-label': 'Read-only links', class: 'table' });
    const linksBody = el('tbody', {});
    for (const link of links.links) {
      const tr = el('tr', { 'aria-label': link.label });
      tr.append(el('td', {}, link.label), el('td', {}, link.url), el('td', {}, link.state),
        el('td', {}, link.expires_at ? formatDate(link.expires_at, myNumberFormat(), myZone()) : ''));
      const revokeCell = el('td', {});
      const revoke = el('button', { class: 'pill small', 'aria-label': 'Revoke link' }, 'Revoke link');
      revoke.addEventListener('click', async () => {
        try { await api.del(`/api/links/${link.id}`); notice2.textContent = 'Link revoked'; tr.remove(); }
        catch (e) { if (e instanceof ApiFail) showErrors(linksCard, e); }
      });
      revokeCell.append(revoke);
      tr.append(revokeCell);
      const regenCell = el('td', {});
      const regen = el('button', { class: 'pill small', 'aria-label': 'Regenerate link' }, 'Regenerate link');
      regen.addEventListener('click', async () => {
        try { await api.post(`/api/links/${link.id}/regenerate`); notice2.textContent = 'Link regenerated'; window.location.reload(); }
        catch (e) { if (e instanceof ApiFail) showErrors(linksCard, e); }
      });
      regenCell.append(regen);
      tr.append(regenCell);
      linksBody.append(tr);
    }
    linksTable.append(linksBody);
    linksCard.append(linksTable);
    wrap.append(linksCard);
  }

  // exports card
  const exportsCard = el('div', { class: 'white-card' });
  exportsCard.append(el('h2', {}, 'Exports'));
  if (project.role !== 'reviewer') {
    const exportProject = el('button', { id: 'export-project', class: 'pill', 'aria-label': 'Export project' }, 'Export project');
    const progress = el('div', { id: 'project-job-progress', role: 'status', class: 'notice' });
    exportProject.addEventListener('click', async () => {
      try {
        const res = await api.post(`/api/projects/${projectId}/exports`, { scale: 1, padding: 0, extrude: 0 }) as { job: number };
        trackProjectJob(res.job, progress, exportsCard);
      } catch (e) { if (e instanceof ApiFail) showErrors(exportsCard, e); }
    });
    exportsCard.append(exportProject, progress);
  }
  const exportsTable = el('table', { 'aria-label': 'Exports', class: 'table' });
  const exportsBody = el('tbody', {});
  if (!exportsData.exports.length) {
    const emptyRow = el('tr', {});
    emptyRow.append(el('td', { class: 'empty' }, 'No exports yet'));
    exportsBody.append(emptyRow);
  }
  for (const ex of exportsData.exports) {
    const tr = el('tr', {});
    tr.append(el('td', {}, ex.label ?? `Export ${ex.id}`));
    const filesCell = el('td', {});
    for (const file of ex.files) {
      filesCell.append(el('a', { class: 'project-link', href: `/api/exports/${ex.id}/files/${encodeURIComponent(file.name)}`, 'aria-label': `Download ${file.name}` }, `Download ${file.name}`));
    }
    tr.append(filesCell);
    exportsBody.append(tr);
  }
  exportsTable.append(exportsBody);
  exportsCard.append(exportsTable);
  wrap.append(exportsCard);
  app.append(wrap);
}

function trackProjectJob(jobId: number, progress: HTMLElement, card: HTMLElement): void {
  progress.textContent = 'Processing 0 of 0';
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (ev) => {
    const data = JSON.parse(ev.data) as { state: string; done: number; total: number; files: { name: string }[] };
    if (data.state === 'stored') {
      progress.textContent = `Stored: ${data.files.map((f) => f.name).join(', ')}`;
      source.close();
      return;
    }
    if (data.state === 'cancelled') { progress.textContent = `Cancelled at ${data.done} of ${data.total}: nothing stored`; source.close(); return; }
    if (data.state === 'failed') { progress.textContent = 'Export failed: nothing stored'; source.close(); return; }
    progress.textContent = `Processing ${data.done} of ${data.total}`;
  };
  source.onerror = () => source.close();
  void card;
}

export const pageDialog: { openDialog?: (d: HTMLElement, opener?: HTMLElement) => void } = {};

// ---- invite page ----

export async function renderInvite(token: string, me: Me | null): Promise<void> {
  const app = byId('app');
  clear(app);
  let invite: { project: number; role: string; state: string; expires_at: string | null };
  try {
    invite = await api.get(`/api/invites/${token}`) as typeof invite;
  } catch {
    app.append(el('h1', { class: 'page-title' }, 'This invite is not available'));
    return;
  }
  const card = el('div', { class: 'white-card card-form' });
  card.append(el('h1', { class: 'page-title' }, 'You have been invited'));
  card.append(el('p', {}, `Role: ${invite.role}`));
  card.append(el('p', {}, `Expires: ${formatDate(invite.expires_at ?? '', myNumberFormat(), myZone())}`));
  const accept = el('button', { id: 'accept-invite', class: 'pill', 'aria-label': 'Accept invite' }, 'Accept invite');
  const notice = el('div', { id: 'invite-notice', role: 'status', class: 'notice' });
  accept.addEventListener('click', async () => {
    if (!me) {
      window.location.href = `/signin?then=/invites/${token}`;
      return;
    }
    try {
      const res = await api.post(`/api/invites/${token}/accept`) as { project: number };
      notice.textContent = `You joined project ${res.project}`;
      window.location.href = `/projects/${res.project}`;
    } catch (e) { if (e instanceof ApiFail) showErrors(card, e); }
  });
  card.append(accept, notice);
  app.append(card);
}

// ---- read-only share view ----

export async function renderShare(token: string): Promise<void> {
  const app = byId('app');
  clear(app);
  let share: { sprite: { name: string; width: number; height: number; seq: number; frames: { number: number; duration_ms: number }[]; tags: { name: string; from: number; to: number; direction: string; repeat: number }[] }; state: string };
  try {
    share = await api.get(`/api/share/${token}`) as typeof share;
  } catch {
    app.append(el('h1', { class: 'page-title ended-heading' }, 'This link has ended'));
    return;
  }
  const name = el('h1', { class: 'page-title' }, share.sprite.name);
  const stageWrap = el('div', { class: 'share-stage' });
  const canvas = el('canvas', { id: 'stage', role: 'application', 'aria-label': 'Sprite stage', 'data-sprite-id': String(share.sprite.width) });
  canvas.setAttribute('data-frame', '1');
  canvas.setAttribute('data-zoom', '4');
  canvas.setAttribute('data-seq', String(share.sprite.seq));
  stageWrap.append(canvas);
  const zoomRow = el('div', { class: 'zoom-row' });
  for (const [dir, label] of [['in', 'Zoom in'], ['out', 'Zoom out']] as [string, string][]) {
    zoomRow.append(el('button', { class: 'pill small', 'aria-label': label, 'data-zoom-dir': dir }, label));
  }
  zoomRow.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-zoom-dir]');
    if (!btn) return;
    const dir = btn.getAttribute('data-zoom-dir');
    zoom = dir === 'in' ? Math.min(32, zoom * 2) : Math.max(1, Math.floor(zoom / 2));
    drawFrame(currentFrame);
  });
  const preview = el('section', { id: 'preview-region', role: 'region', 'aria-label': 'Preview', class: 'share-preview panel candy-cyan' });
  const previewCanvas = el('canvas', { id: 'preview-canvas', class: 'preview-canvas' });
  previewCanvas.setAttribute('data-preview-frame', '1');
  previewCanvas.setAttribute('data-preview-mode', window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'step' : 'autoplay');
  const stepPrev = el('button', { class: 'pill small', 'aria-label': 'Previous frame' }, 'Previous frame');
  const stepNext = el('button', { class: 'pill small', 'aria-label': 'Next frame' }, 'Next frame');
  preview.append(previewCanvas, stepPrev, stepNext);
  app.append(name, stageWrap, zoomRow, preview);

  let zoom = 4;
  let currentFrame = 1;
  const w = share.sprite.width, h = share.sprite.height;
  const framesData = new Map<number, string[][]>();
  for (const frame of share.sprite.frames) {
    const data = await api.get(`/api/share/${token}/frames/${frame.number}/pixels`) as { rows: string[][] };
    framesData.set(frame.number, data.rows);
  }
  const drawFrame = (frameNo: number): void => {
    const rows = framesData.get(frameNo);
    canvas.width = w * zoom; canvas.height = h * zoom;
    canvas.style.width = `${w * zoom}px`;
    canvas.style.height = `${h * zoom}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (rows) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const color = rows[y][x];
          if (color.slice(6) === '00') continue;
          ctx.fillStyle = `#${color}`;
          ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
        }
      }
    }
    canvas.setAttribute('data-frame', String(frameNo));
    void composite;
  };
  drawFrame(1);
  const previewDraw = (frameNo: number): void => {
    const rows = framesData.get(frameNo);
    previewCanvas.width = w * 2; previewCanvas.height = h * 2;
    const ctx = previewCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    if (rows) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const color = rows[y][x];
          if (color.slice(6) === '00') continue;
          ctx.fillStyle = `#${color}`;
          ctx.fillRect(x * 2, y * 2, 2, 2);
        }
      }
    }
    previewCanvas.setAttribute('data-preview-frame', String(frameNo));
  };
  previewDraw(1);
  const allFrames = share.sprite.frames.map((f) => f.number);
  let position = 0;
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const tick = (): void => {
      const frameNo = allFrames[position % allFrames.length];
      const ms = share.sprite.frames.find((f) => f.number === frameNo)?.duration_ms ?? 100;
      window.setTimeout(() => {
        position = (position + 1) % allFrames.length;
        previewDraw(allFrames[position]);
        tick();
      }, ms);
    };
    tick();
  }
  stepPrev.addEventListener('click', () => {
    position = (position - 1 + allFrames.length) % allFrames.length;
    currentFrame = allFrames[position];
    previewDraw(currentFrame);
    drawFrame(currentFrame);
  });
  stepNext.addEventListener('click', () => {
    position = (position + 1) % allFrames.length;
    currentFrame = allFrames[position];
    previewDraw(currentFrame);
    drawFrame(currentFrame);
  });
  void tagSequence;
}

// ---- ended link page ----

export function renderEnded(): void {
  const app = byId('app');
  clear(app);
  app.append(el('h1', { class: 'page-title ended-heading' }, 'This link has ended'));
}
