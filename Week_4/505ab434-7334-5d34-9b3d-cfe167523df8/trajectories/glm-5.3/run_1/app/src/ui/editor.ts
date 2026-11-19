import {
  api,
  el,
  loadMe,
  setAlert,
  setStatus,
  busyButton,
  type Me,
  type VersionSummary,
  type VersionDetail,
  type AssetAdmin,
} from './types';

export async function initEditor(): Promise<void> {
  const me: Me | null = await loadMe();
  const root = document.getElementById('editor-root');
  if (!root) return;
  const match = /\/editor\/([^/]+)$/.exec(window.location.pathname);
  const slug = match ? decodeURIComponent(match[1]) : 'logo';

  const layout = el('div', { class: 'editor-layout' });
  const side = el('section', { class: 'cell' });
  const main = el('section', { class: 'cell' });
  layout.append(side, main);
  root.replaceChildren(layout);

  const versionsSlot = el('div');
  const formSlot = el('div');
  side.append(el('h2', {}, 'Versions'), versionsSlot);
  main.append(formSlot);

  const load = async (): Promise<void> => {
    const { versions } = await api<{ versions: VersionSummary[] }>(`/api/chapters/${slug}/versions`);
    versionsSlot.replaceChildren(el('ul', { role: 'list', 'aria-label': 'Versions' },
      ...versions.map((version) => el('li', {}, `Version ${version.number} — ${version.stateWord}`)),
    ));
    const draft = versions.find((v) => ['draft', 'in_review', 'approved'].includes(v.state));
    const startButton = el('button', { type: 'button' }, `Start version ${(versions.at(-1)?.number ?? 0) + 1}`);
    if (draft || me?.principal.role !== 'author') {
      startButton.disabled = true;
    }
    startButton.addEventListener('click', async () => {
      const restore = busyButton(startButton, 'Saving');
      try {
        await api(`/api/chapters/${slug}/versions`, { method: 'POST', body: '{}' });
        setStatus('Draft saved.');
        await load();
      } catch (err) {
        setAlert(err instanceof Error ? err.message : 'Something went wrong.', null);
      } finally {
        restore();
      }
    });
    versionsSlot.append(startButton);

    if (!draft) {
      const latest = versions.at(-1);
      if (latest) {
        const detail = await api<VersionDetail>(`/api/versions/${latest.id}`);
        formSlot.replaceChildren(readOnlyVersion(detail, load));
      }
      return;
    }
    const detail = await api<VersionDetail>(`/api/versions/${draft.id}`);
    formSlot.replaceChildren(versionForm(detail, me, load));
  };

  await load();
}

function readOnlyVersion(detail: VersionDetail, reload: () => Promise<void>): HTMLElement {
  const wrap = el('div');
  wrap.append(el('h2', {}, `Version ${detail.number} (${detail.stateWord})`));
  wrap.append(el('p', {}, detail.intro));
  const list = el('ul');
  for (const statement of detail.statements) {
    list.append(el('li', {}, `${statement.identifier} — ${statement.text}`));
  }
  wrap.append(list);
  void reload;
  return wrap;
}

function versionForm(detail: VersionDetail, me: Me | null, reload: () => Promise<void>): HTMLElement {
  const wrap = el('div');
  const slot = el('div', { class: 'alert-slot' });
  wrap.append(el('h2', {}, `Version ${detail.number} (${detail.stateWord})`));

  const intro = el('textarea', { id: 'version-intro', rows: '3' });
  intro.value = detail.intro;
  intro.setAttribute('aria-label', 'Introduction');

  const statementsSlot = el('div');
  const statements: { identifier: HTMLInputElement; text: HTMLInputElement }[] = [];

  const addStatement = (identifier = '', text = ''): void => {
    const idInput = el('input', { type: 'text', value: identifier });
    idInput.setAttribute('aria-label', `Rule identifier ${statements.length + 1}`);
    const textInput = el('input', { type: 'text', value: text });
    textInput.setAttribute('aria-label', `Rule text ${statements.length + 1}`);
    const remove = el('button', { type: 'button' });
    remove.textContent = `Remove statement ${statements.length + 1}`;
    remove.setAttribute('aria-label', `Remove statement ${statements.length + 1}`);
    const row = el('div', { class: 'statement-row' }, idInput, textInput, remove);
    remove.addEventListener('click', () => {
      statements.splice(statements.findIndex((s) => s.identifier === idInput), 1);
      row.remove();
      relabel();
    });
    statementsSlot.append(row);
    statements.push({ identifier: idInput, text: textInput });
    relabel();
  };

  const relabel = (): void => {
    statements.forEach((statement, index) => {
      statement.identifier.setAttribute('aria-label', `Rule identifier ${index + 1}`);
      statement.text.setAttribute('aria-label', `Rule text ${index + 1}`);
    });
  };

  for (const statement of detail.statements) addStatement(statement.identifier, statement.text);

  const addStatementButton = el('button', { type: 'button' }, 'Add statement');
  addStatementButton.addEventListener('click', () => addStatement());

  const assetsSlot = el('div', { role: 'group', 'aria-label': 'Referenced assets' });
  const assetBoxes: HTMLInputElement[] = [];
  void api<{ assets: AssetAdmin[] }>('/api/admin/assets').then((data) => {
    for (const asset of data.assets) {
      const box = el('input', { type: 'checkbox', value: asset.id, id: `asset-${asset.id}` });
      if (detail.assetIds.includes(asset.id)) box.checked = true;
      assetBoxes.push(box);
      assetsSlot.append(el('label', { class: 'check', for: `asset-${asset.id}` }, box, ` ${asset.name}`));
    }
  }).catch(() => undefined);

  const withdrawnSlot = el('div');
  const withdrawn: { identifier: HTMLSelectElement }[] = [];
  const addWithdrawn = (identifier: string, replacedBy: string): void => {
    const published = detail.statements.map((s) => s.identifier).filter((id) => id);
    const select = el('select', { 'aria-label': `Replacement for ${identifier}` });
    for (const id of published) select.append(el('option', { value: id }, id));
    if (replacedBy) select.value = replacedBy;
    withdrawn.push({ identifier: select });
    withdrawnSlot.append(el('div', {}, `${identifier} → `), select);
  };
  for (const w of detail.withdrawn) addWithdrawn(w.identifier, w.replacedBy);

  const saveDraft = el('button', { type: 'button' }, 'Save draft');
  const submit = el('button', { type: 'button', class: 'primary' }, 'Submit for review');
  const approve = el('button', { type: 'button' }, `Approve version ${detail.number}`);
  const requestChanges = el('button', { type: 'button' }, `Request changes to version ${detail.number}`);
  const publish = el('button', { type: 'button' }, `Publish version ${detail.number}`);

  const collect = () => ({
    revision: detail.revision,
    intro: intro.value,
    statements: statements.map((s) => ({ identifier: s.identifier.value, text: s.text.value })),
    assetIds: assetBoxes.filter((b) => b.checked).map((b) => b.value),
    withdrawn: detail.withdrawn.map((w) => w),
  });

  saveDraft.addEventListener('click', async () => {
    const restore = busyButton(saveDraft, 'Saving');
    try {
      await api(`/api/versions/${detail.id}`, { method: 'PUT', body: JSON.stringify(collect()) });
      setStatus('Draft saved.');
      await reload();
    } catch (err) {
      setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
    } finally {
      restore();
    }
  });

  submit.addEventListener('click', async () => {
    const restore = busyButton(submit, 'Saving');
    try {
      await api(`/api/versions/${detail.id}`, { method: 'PUT', body: JSON.stringify(collect()) });
      await api(`/api/versions/${detail.id}/submit`, { method: 'POST', body: '{}' });
      setStatus(`Version ${detail.number} submitted for review.`);
      await reload();
    } catch (err) {
      setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
    } finally {
      restore();
    }
  });

  approve.addEventListener('click', async () => {
    const restore = busyButton(approve, 'Saving');
    try {
      await api(`/api/versions/${detail.id}/approve`, { method: 'POST', body: '{}' });
      setStatus(`Version ${detail.number} approved.`);
      await reload();
    } catch (err) {
      setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
    } finally {
      restore();
    }
  });

  const comment = el('input', { type: 'text', 'aria-label': 'Review comment' });
  requestChanges.addEventListener('click', async () => {
    const restore = busyButton(requestChanges, 'Saving');
    try {
      await api(`/api/versions/${detail.id}/request-changes`, {
        method: 'POST',
        body: JSON.stringify({ comment: comment.value }),
      });
      setStatus(`Changes requested on version ${detail.number}.`);
      await reload();
    } catch (err) {
      setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
    } finally {
      restore();
    }
  });

  publish.addEventListener('click', async () => {
    const restore = busyButton(publish, 'Saving');
    try {
      await api(`/api/versions/${detail.id}/publish`, { method: 'POST', body: '{}' });
      setStatus(`Version ${detail.number} published.`);
      await reload();
    } catch (err) {
      setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
    } finally {
      restore();
    }
  });

  wrap.append(
    el('label', { class: 'field' }, el('span', {}, 'Introduction'), intro),
    statementsSlot,
    addStatementButton,
    el('h3', {}, 'Withdrawn identifiers'),
    withdrawnSlot,
    el('h3', {}, 'Referenced assets'),
    assetsSlot,
    saveDraft,
    submit,
  );
  if (me?.principal.role === 'brand_reviewer' || me?.principal.role === 'owner') {
    wrap.append(comment, approve, requestChanges);
  }
  if (me?.principal.role === 'owner') {
    wrap.append(publish);
  }
  wrap.append(slot);
  return wrap;
}
