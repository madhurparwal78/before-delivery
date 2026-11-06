import { AssetDto, CommentDto, ReviewLinkDto, VersionDto } from '../../shared/api';
import { formatLocalTime, parseZonedTimestamp } from '../../shared/format';
import { ApiCallError, api } from '../api';
import {
  announce,
  closeDialog,
  el,
  field,
  mount,
  openDialog,
  setFieldError,
} from '../dom';
import { withBusy } from '../motion';
import { EditorModel } from './state';
import { nodeName } from './parts';

export interface PanelContext {
  model: EditorModel;
  timeZone: string;
  status: HTMLElement;
  uploadStatus: HTMLElement;
  reload: () => Promise<void>;
  selectNode: (nodeId: string) => void;
  mentionableUrl: string;
  captureThumbnail: (versionId: string) => Promise<void>;
}

const VERSION_STATE_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  scheduled: 'Scheduled',
  published: 'Published',
  withdrawn: 'Withdrawn',
};

function versionError(error: unknown, context: PanelContext, fallback: string): void {
  if (!(error instanceof ApiCallError)) {
    announce(context.status, fallback);
    return;
  }
  if (error.error === 'not_in_review') {
    announce(context.status, 'Only in-review versions can be approved.');
    return;
  }
  if (error.error === 'approval_required') {
    announce(context.status, 'This version needs an approval from someone other than its author.');
    return;
  }
  if (error.error === 'another_version_scheduled') {
    announce(context.status, 'Another version of this scene is already scheduled.');
    return;
  }
  if (error.error === 'not_published') {
    announce(context.status, 'Only published versions can be exported.');
    return;
  }
  if (error.error === 'review_links_disabled') {
    announce(context.status, 'Review links are turned off for this workspace.');
    return;
  }
  if (error.error === 'version_not_reviewable') {
    announce(context.status, 'Review links are only for versions that are not yet published.');
    return;
  }
  if (error.error === 'workspace_read_only') {
    announce(context.status, 'This workspace is read-only until the overdue invoice is paid.');
    return;
  }
  if (error.errors?.publishAt) {
    announce(context.status, 'Pick a time between 5 seconds and 365 days from now.');
    return;
  }
  if (error.errors) {
    announce(context.status, Object.values(error.errors)[0] ?? fallback);
    return;
  }
  announce(context.status, fallback);
}

function scheduleDialog(version: VersionDto, context: PanelContext, opener: HTMLElement): void {
  const date = el('input', { type: 'text', name: 'publishDate', placeholder: 'YYYY-MM-DD' });
  const time = el('input', { type: 'text', name: 'publishTime', placeholder: 'HH:mm:ss' });
  const schedule = el('button', { type: 'button', class: 'button primary', text: 'Schedule' });
  const dialog = el('div', { class: 'dialog', 'aria-label': 'Schedule publish' }, [
    el('h2', { text: 'Schedule publish' }),
    field('Publish date', date),
    field('Publish time', time),
    el('p', { text: `Time zone: ${context.timeZone}` }),
    el('div', { class: 'dialog-actions' }, [schedule]),
  ]);
  schedule.addEventListener('click', () => {
    const instant = parseZonedTimestamp(`${date.value.trim()} ${time.value.trim()}`, context.timeZone);
    if (!instant) {
      setFieldError(date, 'Use YYYY-MM-DD HH:mm:ss.');
      return;
    }
    setFieldError(date, null);
    void withBusy(schedule, async () => {
      try {
        await api.post(`/api/versions/${version.id}/schedule`, { publishAt: instant });
        closeDialog(dialog);
        announce(
          context.status,
          `Version ${version.number} goes live ${formatLocalTime(instant, context.timeZone)}.`,
        );
        await context.reload();
      } catch (error) {
        versionError(error, context, 'The version could not be scheduled.');
      }
    });
  });
  openDialog(dialog, opener);
}

export function versionsPanel(context: PanelContext): HTMLElement {
  const panel = el('section', { class: 'panel', 'aria-label': 'Versions' });
  const save = el('button', { type: 'button', class: 'button primary', text: 'Save version' });
  save.addEventListener('click', () => {
    const label = el('input', { type: 'text', name: 'label' });
    const confirm = el('button', { type: 'button', class: 'button primary', text: 'Save' });
    const dialog = el('div', { class: 'dialog', 'aria-label': 'Save version' }, [
      el('h2', { text: 'Save version' }),
      field('Version label', label),
      el('div', { class: 'dialog-actions' }, [confirm]),
    ]);
    confirm.addEventListener('click', () => {
      void withBusy(confirm, async () => {
        try {
          const version = await api.post<VersionDto>(
            `/api/scenes/${context.model.scene.id}/versions`,
            { label: label.value },
          );
          closeDialog(dialog);
          announce(context.status, `Version ${version.number} saved.`);
          await context.captureThumbnail(version.id);
          await context.reload();
        } catch (error) {
          if (error instanceof ApiCallError && error.errors?.label) {
            setFieldError(label, error.errors.label);
            return;
          }
          versionError(error, context, 'The version could not be saved.');
        }
      });
    });
    openDialog(dialog, save);
  });

  const rows = context.model.versions.map((version) => {
    const actions = el('div', { class: 'row-actions' });
    const act = (
      label: string,
      run: (button: HTMLButtonElement) => Promise<void>,
      className = 'button',
    ): void => {
      const button = el('button', { type: 'button', class: className, text: label });
      button.addEventListener('click', () => void withBusy(button, () => run(button)));
      actions.append(button);
    };

    if (version.state === 'draft') {
      act('Submit for review', async () => {
        try {
          await api.post(`/api/versions/${version.id}/submit`);
          announce(context.status, 'Submitted for review.');
          await context.reload();
        } catch (error) {
          versionError(error, context, 'The version could not be submitted.');
        }
      });
    }
    if (version.state === 'in_review') {
      act('Approve', async () => {
        try {
          await api.post(`/api/versions/${version.id}/approve`);
          announce(context.status, 'Approved.');
          await context.reload();
        } catch (error) {
          versionError(error, context, 'Only in-review versions can be approved.');
        }
      });
      const scheduleButton = el('button', {
        type: 'button',
        class: 'button',
        text: 'Schedule publish',
      });
      scheduleButton.addEventListener('click', () =>
        scheduleDialog(version, context, scheduleButton),
      );
      actions.append(scheduleButton);
    }
    if (version.state === 'scheduled') {
      act('Unschedule', async () => {
        try {
          await api.post(`/api/versions/${version.id}/unschedule`);
          announce(context.status, 'Back in review.');
          await context.reload();
        } catch (error) {
          versionError(error, context, 'The version could not be unscheduled.');
        }
      });
    }
    if (version.state === 'published') {
      act('Withdraw', async () => {
        try {
          await api.post(`/api/versions/${version.id}/withdraw`);
          announce(context.status, 'Withdrawn. The embed no longer shows this version.');
          await context.reload();
        } catch (error) {
          versionError(error, context, 'The version could not be withdrawn.');
        }
      }, 'button danger');
      act('Create export', async () => {
        try {
          const bundle = await api.post<{ id: string }>(`/api/versions/${version.id}/exports`);
          announce(context.status, 'Export ready.');
          actions.append(
            el('a', {
              href: `/api/exports/${bundle.id}`,
              text: 'Download export',
              download: `export-${version.number}.zip`,
            }),
          );
        } catch (error) {
          versionError(error, context, 'Only published versions can be exported.');
        }
      });
      if (version.embedId) {
        actions.append(
          el('a', { href: `/embed/${version.embedId}`, target: '_blank', text: 'Open embed' }),
        );
      }
    }

    const waiting =
      version.state === 'scheduled' &&
      version.publishAt !== null &&
      new Date(version.publishAt).getTime() <= Date.now();

    return el('li', { class: 'version-row' }, [
      el('p', {
        class: 'version-label',
        text: `v${version.number} · ${version.label} · ${VERSION_STATE_LABELS[version.state] ?? version.state}`,
      }),
      version.publishAt
        ? el('p', {
            class: 'figure muted',
            text: `Goes live ${formatLocalTime(version.publishAt, context.timeZone)}`,
          })
        : null,
      waiting ? el('p', { class: 'muted', text: 'Waiting for file storage' }) : null,
      version.approvals.length > 0
        ? el('p', {
            class: 'muted',
            text: `Approved by ${version.approvals.map((entry) => entry.member.name).join(', ')}`,
          })
        : null,
      actions,
    ]);
  });

  mount(
    panel,
    el('h2', { text: 'Versions' }),
    save,
    el('ul', { class: 'version-list' }, rows),
  );
  return panel;
}

export function reviewLinksPanel(context: PanelContext, links: Map<string, ReviewLinkDto[]>): HTMLElement {
  const panel = el('section', { class: 'panel', 'aria-label': 'Review links' });
  const reviewable = context.model.versions.filter((version) =>
    ['draft', 'in_review', 'scheduled'].includes(version.state),
  );
  const target = reviewable[0];
  const create = el('button', { type: 'button', class: 'button', text: 'Create review link' });
  create.disabled = target === undefined;
  create.addEventListener('click', () => {
    if (!target) return;
    const expires = el('input', {
      type: 'text',
      name: 'expiresAt',
      placeholder: 'YYYY-MM-DD HH:mm:ss',
    });
    const confirm = el('button', { type: 'button', class: 'button primary', text: 'Create link' });
    const dialog = el('div', { class: 'dialog', 'aria-label': 'Create review link' }, [
      el('h2', { text: 'Create review link' }),
      field('Expires', expires, { hint: `Time zone: ${context.timeZone}` }),
      el('div', { class: 'dialog-actions' }, [confirm]),
    ]);
    confirm.addEventListener('click', () => {
      const instant = parseZonedTimestamp(expires.value, context.timeZone);
      if (!instant) {
        setFieldError(expires, 'Use YYYY-MM-DD HH:mm:ss.');
        return;
      }
      setFieldError(expires, null);
      void withBusy(confirm, async () => {
        try {
          const link = await api.post<{ url: string; expiresAt: string }>(
            `/api/versions/${target.id}/review-links`,
            { expiresAt: instant },
          );
          closeDialog(dialog);
          announce(
            context.status,
            `Review link created. It expires ${formatLocalTime(link.expiresAt, context.timeZone)}.`,
          );
          window.sessionStorage.setItem(`review-link:${target.id}`, link.url);
          await context.reload();
        } catch (error) {
          versionError(error, context, 'The review link could not be created.');
        }
      });
    });
    openDialog(dialog, create);
  });

  const rows: HTMLElement[] = [];
  for (const version of context.model.versions) {
    for (const link of links.get(version.id) ?? []) {
      const copy = el('button', { type: 'button', class: 'button quiet', text: 'Copy link' });
      copy.addEventListener('click', () => {
        const stored = window.sessionStorage.getItem(`review-link:${version.id}`) ?? '';
        void navigator.clipboard?.writeText(`${window.location.origin}${stored}`).catch(() => undefined);
        announce(context.status, 'Review link copied.');
      });
      const regenerate = el('button', { type: 'button', class: 'button', text: 'Regenerate link' });
      regenerate.addEventListener('click', () => {
        void withBusy(regenerate, async () => {
          try {
            const fresh = await api.post<{ url: string }>(
              `/api/review-links/${link.id}/regenerate`,
            );
            window.sessionStorage.setItem(`review-link:${version.id}`, fresh.url);
            announce(context.status, 'New link created. The old link no longer works.');
            await context.reload();
          } catch (error) {
            versionError(error, context, 'The link could not be regenerated.');
          }
        });
      });
      const revoke = el('button', { type: 'button', class: 'button danger', text: 'Revoke link' });
      revoke.addEventListener('click', () => {
        void withBusy(revoke, async () => {
          try {
            await api.del(`/api/review-links/${link.id}`);
            announce(context.status, 'Link revoked.');
            await context.reload();
          } catch (error) {
            versionError(error, context, 'The link could not be revoked.');
          }
        });
      });
      rows.push(
        el('li', {}, [
          el('p', {
            class: 'figure',
            text: `v${version.number} · ${link.status} · expires ${formatLocalTime(
              link.expiresAt,
              context.timeZone,
            )}`,
          }),
          el('div', { class: 'row-actions' }, [copy, regenerate, revoke]),
        ]),
      );
    }
  }

  mount(
    panel,
    el('h2', { text: 'Review links' }),
    create,
    el('ul', { class: 'link-list' }, rows),
  );
  return panel;
}

export function commentsPanel(context: PanelContext): HTMLElement {
  const panel = el('section', { class: 'panel', 'aria-label': 'Comments' });
  const input = el('textarea', { 'aria-label': 'Comment', rows: '3' });
  const mentions: string[] = [];
  const mentionList = el('div', {
    role: 'listbox',
    'aria-label': 'Mention a teammate',
    class: 'mention-list',
  });
  mentionList.hidden = true;
  let mentionIndex = 0;

  const closeMentions = (): void => {
    mentionList.hidden = true;
    mentionIndex = 0;
  };

  const renderMentions = (members: { id: string; name: string }[]): void => {
    mount(
      mentionList,
      ...members.map((member, index) =>
        el('div', {
          role: 'option',
          'aria-selected': index === mentionIndex ? 'true' : 'false',
          'data-member-id': member.id,
          text: member.name,
          tabindex: '-1',
        }),
      ),
    );
    mentionList.hidden = members.length === 0;
  };

  const insertMention = (option: Element | null): void => {
    if (!option) return;
    const id = option.getAttribute('data-member-id');
    const name = option.textContent ?? '';
    if (id && !mentions.includes(id)) mentions.push(id);
    input.value = input.value.replace(/@([^@\s]*)$/, `@${name} `);
    closeMentions();
    input.focus();
  };

  input.addEventListener('input', () => {
    const match = /@([^@\s]*)$/.exec(input.value);
    if (!match) {
      closeMentions();
      return;
    }
    void api
      .get<{ members: { id: string; name: string }[] }>(
        `${context.mentionableUrl}?q=${encodeURIComponent(match[1] ?? '')}`,
      )
      .then((data) => renderMentions(data.members));
  });

  input.addEventListener('keydown', (event) => {
    if (mentionList.hidden) return;
    const options = [...mentionList.querySelectorAll('[role="option"]')];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      mentionIndex =
        event.key === 'ArrowDown'
          ? Math.min(options.length - 1, mentionIndex + 1)
          : Math.max(0, mentionIndex - 1);
      options.forEach((option, index) =>
        option.setAttribute('aria-selected', index === mentionIndex ? 'true' : 'false'),
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      insertMention(options[mentionIndex] ?? null);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMentions();
    }
  });

  mentionList.addEventListener('click', (event) => {
    const option = (event.target as HTMLElement).closest('[role="option"]');
    insertMention(option);
  });

  const post = el('button', { type: 'button', class: 'button primary', text: 'Post comment' });
  post.addEventListener('click', () => {
    const nodeId = context.model.selection;
    if (!nodeId) {
      announce(context.status, 'Select an object to pin the comment to.');
      return;
    }
    void withBusy(post, async () => {
      try {
        await api.post(`/api/scenes/${context.model.scene.id}/comments`, {
          nodeId,
          body: input.value,
          mentions,
        });
        input.value = '';
        mentions.length = 0;
        announce(context.status, 'Comment posted.');
        await context.reload();
      } catch (error) {
        if (error instanceof ApiCallError && error.errors?.body) {
          announce(context.status, error.errors.body);
          return;
        }
        versionError(error, context, 'The comment could not be posted.');
      }
    });
  });

  const graph = context.model.graphAt(context.model.playhead);
  const threads = context.model.comments.map((comment: CommentDto) => {
    const resolve = el('button', {
      type: 'button',
      class: 'button quiet',
      text: comment.resolved ? 'Reopen' : 'Resolve',
    });
    resolve.addEventListener('click', () => {
      void withBusy(resolve, async () => {
        await api.patch(`/api/comments/${comment.id}`, { resolved: !comment.resolved });
        await context.reload();
      });
    });
    const open = el('button', {
      type: 'button',
      class: 'button quiet',
      text: nodeName(graph, comment.nodeId),
    });
    open.addEventListener('click', () => context.selectNode(comment.nodeId));
    return el('li', { class: comment.resolved ? 'thread resolved' : 'thread' }, [
      el('p', { class: 'thread-body', text: comment.body }),
      el('p', {
        class: 'muted',
        text: `${comment.author.name}${
          comment.mentions.length > 0
            ? ` · mentions ${comment.mentions.map((mention) => mention.name).join(', ')}`
            : ''
        }`,
      }),
      el('div', { class: 'row-actions' }, [open, resolve]),
    ]);
  });

  mount(
    panel,
    el('h2', { text: 'Comments' }),
    el('ul', { class: 'thread-list' }, threads),
    input,
    mentionList,
    post,
  );
  return panel;
}

export function assetsPanel(context: PanelContext): HTMLElement {
  const panel = el('section', { class: 'panel', 'aria-label': 'Assets' });

  const uploadInput = el('input', { type: 'file', class: 'visually-hidden' });
  let kind: 'model' | 'texture' = 'model';
  uploadInput.addEventListener('change', () => {
    const file = uploadInput.files?.[0];
    if (!file) return;
    announce(context.uploadStatus, `Uploading ${file.name}…`);
    const form = new FormData();
    form.set('kind', kind);
    form.set('file', file, file.name);
    void api
      .upload('/api/assets', form)
      .then(async () => {
        announce(context.uploadStatus, `${file.name} uploaded.`);
        await context.reload();
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiCallError)) {
          announce(context.uploadStatus, `${file.name} could not be uploaded.`);
          return;
        }
        if (error.error === 'file_too_large') {
          announce(
            context.uploadStatus,
            `${file.name} is too large. The limit is ${String(error.body.limitBytes)} bytes.`,
          );
          return;
        }
        if (error.error === 'unsupported_type') {
          announce(
            context.uploadStatus,
            `${file.name} is not a binary glTF model or a PNG or JPEG texture.`,
          );
          return;
        }
        if (error.errors?.file === 'Texture is larger than 4096 by 4096 pixels') {
          announce(context.uploadStatus, 'Textures can be at most 4096 by 4096 pixels.');
          return;
        }
        if (error.errors?.file === 'File name is not allowed') {
          announce(context.uploadStatus, `${file.name} has a name that is not allowed.`);
          return;
        }
        if (error.service === 'file_storage') {
          announce(
            context.uploadStatus,
            'File storage is unavailable. Your edits are saved; uploads, versions and publishing will resume when it is back.',
          );
          return;
        }
        announce(context.uploadStatus, `${file.name} could not be uploaded.`);
      })
      .finally(() => {
        uploadInput.value = '';
      });
  });

  const uploadModel = el('button', { type: 'button', class: 'button', text: 'Upload model' });
  uploadModel.addEventListener('click', () => {
    kind = 'model';
    uploadInput.accept = '.glb';
    uploadInput.click();
  });
  const uploadTexture = el('button', { type: 'button', class: 'button', text: 'Upload texture' });
  uploadTexture.addEventListener('click', () => {
    kind = 'texture';
    uploadInput.accept = '.png,.jpg,.jpeg';
    uploadInput.click();
  });

  const items = context.model.assets.map((asset: AssetDto) => {
    const add = el('button', {
      type: 'button',
      class: 'button quiet',
      text: `Add ${asset.name} to scene`,
    });
    if (asset.kind !== 'model') add.disabled = true;
    add.addEventListener('click', () => {
      void withBusy(add, async () => {
        const graph = context.model.latestGraph();
        const parentId =
          context.model.selection ?? graph.nodes.find((node) => node.parentId === null)?.id ?? null;
        if (!parentId) return;
        const id = `n_${Math.random().toString(36).slice(2, 10)}`;
        try {
          await api.post(`/api/scenes/${context.model.scene.id}/ops`, {
            ops: [
              {
                type: 'node.add',
                payload: {
                  node: {
                    id,
                    name: asset.name,
                    kind: 'mesh',
                    parentId,
                    primitive: null,
                    assetId: asset.id,
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                    materialLayers: [],
                    visible: true,
                  },
                },
              },
            ],
          });
          announce(context.status, `${asset.name} added to the scene.`);
          await context.reload();
        } catch (error) {
          versionError(error, context, 'The asset could not be added.');
        }
      });
    });
    return el('li', {}, [
      el('p', { class: 'figure', text: `${asset.name} · ${asset.kind} · ${asset.bytes} bytes` }),
      add,
    ]);
  });

  mount(
    panel,
    el('h2', { text: 'Assets' }),
    el('div', { class: 'row-actions' }, [uploadModel, uploadTexture, uploadInput]),
    context.uploadStatus,
    el('ul', { class: 'asset-list', 'aria-label': 'Assets' }, items),
  );
  return panel;
}
