import { ApiCallError, getJson, sendJson } from '../api.js';
import { el } from '../dom.js';
import { notFoundPage, type PageContext } from '../main.js';
import { currentSession, setPageStatus } from '../shell.js';
import { VERSION_STATE_WORDS } from '../../shared/labels.js';
import type { Statement, VersionState } from '../../shared/types.js';

interface VersionSummary {
  id: string;
  number: number;
  state: VersionState;
  revision: number;
  publishedAt: string | null;
}

interface VersionDetail extends VersionSummary {
  slug: string;
  assets: { id: string; name: string; state: string }[];
  intro: string;
  statements: Statement[];
  assetIds: string[];
  withdrawn: { identifier: string; replacedBy: string }[];
  reviewComment: string | null;
}

export async function renderEditor(context: PageContext): Promise<void> {
  const { main } = context;
  const slug = context.params['slug'] ?? '';
  let versions: VersionSummary[];
  try {
    versions = (await getJson<{ versions: VersionSummary[] }>(`/api/chapters/${slug}/versions`)).versions;
  } catch {
    notFoundPage(main);
    return;
  }

  const body = el('div', { class: 'editor-page' });
  main.appendChild(body);

  const reload = async (): Promise<void> => {
    versions = (await getJson<{ versions: VersionSummary[] }>(`/api/chapters/${slug}/versions`)).versions;
    await paint();
  };

  const published = await getJson<{ statements: Statement[] }>(`/api/chapters/${slug}`).catch(() => ({
    statements: [] as Statement[],
  }));
  const publishedIdentifiers = published.statements.map((statement) => statement.identifier);

  const paint = async (): Promise<void> => {
    const open = versions.find((version) => ['draft', 'in_review', 'approved'].includes(version.state)) ?? versions[versions.length - 1]!;
    const detail = await getJson<VersionDetail>(`/api/versions/${open.id}`);
    body.replaceChildren(
      el(
        'div',
        { class: 'cell' },
        el('h1', {}, `${slug} versions`),
        el(
          'ul',
          { 'aria-label': 'Versions', class: 'version-list' },
          ...versions.map((version) => el('li', {}, `Version ${version.number} — ${VERSION_STATE_WORDS[version.state]}`)),
        ),
        startButton(slug, versions, reload),
      ),
      versionForm(detail, detail.assets, publishedIdentifiers, reload),
    );
  };

  await paint();
}

function startButton(slug: string, versions: VersionSummary[], reload: () => Promise<void>): HTMLElement {
  const next = (versions[versions.length - 1]?.number ?? 0) + 1;
  const alert = el('p', { class: 'alert', role: 'alert' });
  const button = el(
    'button',
    {
      type: 'button',
      class: 'pill',
      onclick: () => {
        button.disabled = true;
        button.textContent = 'Saving';
        void sendJson('POST', `/api/chapters/${slug}/versions`)
          .then(reload)
          .catch((error: unknown) => {
            alert.textContent = error instanceof ApiCallError ? error.message : 'Something went wrong.';
          })
          .finally(() => {
            button.disabled = false;
            button.textContent = `Start version ${next}`;
          });
      },
    },
    `Start version ${next}`,
  ) as HTMLButtonElement;
  return el('span', { class: 'action' }, button, alert);
}

function versionForm(
  detail: VersionDetail,
  assets: { id: string; name: string }[],
  publishedIdentifiers: string[],
  reload: () => Promise<void>,
): HTMLElement {
  const role = currentSession().principal?.role;
  const alert = el('p', { class: 'alert', role: 'alert' });
  const intro = el('textarea', { id: 'version-intro', 'aria-label': 'Introduction', rows: '3' }) as HTMLTextAreaElement;
  intro.value = detail.intro;

  const statementHolder = el('div', { class: 'statement-rows' });
  let statements: Statement[] = detail.statements.map((statement) => ({ ...statement }));

  const paintStatements = (): void => {
    statementHolder.replaceChildren(
      ...statements.map((statement, index) => {
        const identifier = el('input', {
          type: 'text',
          id: `rule-identifier-${index + 1}`,
          'aria-label': `Rule identifier ${index + 1}`,
          value: statement.identifier,
        }) as HTMLInputElement;
        identifier.addEventListener('input', () => {
          statements[index] = { ...statements[index]!, identifier: identifier.value };
        });
        identifier.addEventListener('change', () => paintWithdrawals());
        const text = el('input', {
          type: 'text',
          id: `rule-text-${index + 1}`,
          'aria-label': `Rule text ${index + 1}`,
          value: statement.text,
        }) as HTMLInputElement;
        text.addEventListener('input', () => {
          statements[index] = { ...statements[index]!, text: text.value };
        });
        return el(
          'div',
          { class: 'statement-row' },
          el('label', { for: identifier.id }, `Rule identifier ${index + 1}`),
          identifier,
          el('label', { for: text.id }, `Rule text ${index + 1}`),
          text,
          el(
            'button',
            {
              type: 'button',
              class: 'pill ghost',
              'aria-label': `Remove statement ${index + 1}`,
              onclick: () => {
                statements = statements.filter((_, candidate) => candidate !== index);
                paintStatements();
                paintWithdrawals();
              },
            },
            `Remove statement ${index + 1}`,
          ),
        );
      }),
    );
  };
  const withdrawals = el('div', { class: 'withdrawal-rows' });
  const replacementChoices = new Map<string, HTMLSelectElement>();

  const paintWithdrawals = (): void => {
    const present = statements.map((statement) => statement.identifier.trim()).filter((value) => value !== '');
    const missing = publishedIdentifiers.filter((identifier) => !present.includes(identifier));
    replacementChoices.clear();
    withdrawals.replaceChildren(
      ...missing.map((identifier) => {
        const previous =
          detail.withdrawn.find((entry) => entry.identifier === identifier)?.replacedBy ?? present[0] ?? '';
        const choice = el(
          'select',
          { id: `replacement-${identifier}`, 'aria-label': `Replacement for ${identifier}` },
          ...present.map((candidate) => el('option', { value: candidate, selected: candidate === previous }, candidate)),
        ) as HTMLSelectElement;
        choice.value = previous;
        replacementChoices.set(identifier, choice);
        return el(
          'div',
          { class: 'withdrawal-row' },
          el('label', { for: choice.id }, `Replacement for ${identifier}`),
          choice,
        );
      }),
    );
  };

  paintStatements();
  paintWithdrawals();

  const assetBoxes = assets.map((asset) => {
    const box = el('input', {
      type: 'checkbox',
      id: `asset-${asset.id}`,
      value: asset.id,
      'aria-label': asset.name,
      checked: detail.assetIds.includes(asset.id),
    }) as HTMLInputElement;
    box.checked = detail.assetIds.includes(asset.id);
    return { box, asset };
  });

  const run = async (label: string, work: () => Promise<void>, button: HTMLButtonElement): Promise<void> => {
    alert.textContent = '';
    button.disabled = true;
    button.textContent = 'Saving';
    try {
      await work();
    } catch (error) {
      alert.textContent = error instanceof ApiCallError ? error.message : 'Something went wrong.';
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  };

  const saveBody = (): Record<string, unknown> => ({
    revision: detail.revision,
    intro: intro.value,
    statements,
    assetIds: assetBoxes.filter((entry) => entry.box.checked).map((entry) => entry.asset.id),
    withdrawn: [...replacementChoices.entries()].map(([identifier, choice]) => ({
      identifier,
      replacedBy: choice.value,
    })),
  });

  const button = (label: string, work: () => Promise<void>): HTMLButtonElement => {
    const node = el(
      'button',
      { type: 'button', class: 'pill', onclick: () => void run(label, work, node) },
      label,
    ) as HTMLButtonElement;
    return node;
  };

  const actions = el('div', { class: 'editor-actions' });
  if (role === 'author') {
    actions.append(
      button('Save draft', async () => {
        await sendJson('PUT', `/api/versions/${detail.id}`, saveBody());
        setPageStatus('Draft saved.');
        await reload();
      }),
      button('Add statement', async () => {
        statements = [...statements, { identifier: '', text: '' }];
        paintStatements();
        paintWithdrawals();
      }),
      button('Submit for review', async () => {
        await sendJson('PUT', `/api/versions/${detail.id}`, saveBody());
        await sendJson('POST', `/api/versions/${detail.id}/submit`);
        setPageStatus(`Version ${detail.number} submitted for review.`);
        await reload();
      }),
    );
  }

  const reviewComment = el('textarea', { id: 'review-comment', 'aria-label': 'Review comment', rows: '2' }) as HTMLTextAreaElement;
  if (role === 'brand_reviewer') {
    actions.append(
      el('label', { for: 'review-comment' }, 'Review comment'),
      reviewComment,
      button(`Approve version ${detail.number}`, async () => {
        await sendJson('POST', `/api/versions/${detail.id}/approve`);
        setPageStatus(`Version ${detail.number} approved.`);
        await reload();
      }),
      button(`Request changes to version ${detail.number}`, async () => {
        await sendJson('POST', `/api/versions/${detail.id}/request-changes`, { comment: reviewComment.value });
        setPageStatus(`Changes requested on version ${detail.number}.`);
        await reload();
      }),
    );
  }

  if (role === 'owner') {
    actions.append(
      button(`Publish version ${detail.number}`, async () => {
        await sendJson('POST', `/api/versions/${detail.id}/publish`);
        setPageStatus(`Version ${detail.number} published.`);
        await reload();
      }),
      button(`Republish version ${detail.number}`, async () => {
        const created = await sendJson<{ number: number }>('POST', `/api/chapters/${detail.slug}/republish`, {
          version: detail.number,
        });
        setPageStatus(`Version ${created.number} published from version ${detail.number}.`);
        await reload();
      }),
    );
  }

  return el(
    'div',
    { class: 'cell editor-form' },
    el('h2', {}, `Version ${detail.number} — ${VERSION_STATE_WORDS[detail.state]}`),
    detail.reviewComment ? el('p', { class: 'review-comment' }, detail.reviewComment) : null,
    el('label', { for: 'version-intro' }, 'Introduction'),
    intro,
    statementHolder,
    withdrawals,
    el(
      'div',
      { role: 'group', 'aria-label': 'Referenced assets', class: 'check-group' },
      ...assetBoxes.flatMap((entry) => [
        el('span', { class: 'check-row' }, entry.box, el('label', { for: entry.box.id }, entry.asset.name)),
      ]),
    ),
    actions,
    alert,
  );
}
