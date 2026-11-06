import { formatCount, formatTime, formatTimeInput, shortVersion } from '../src/format';
import { ApiFailure, api, buildQuery, queryOf } from './api';
import { button, el, field, openDialog, prefersReducedMotion, replace, setStatus, statusRegion, textbox } from './dom';
import { shareStatus, storageOutage, versionStatus } from './copy';
import { ReplicaWake, type ReplicaView } from './wake';
import { withStepUp } from './stepup';
import type { Bucket, ConsoleContext, VersionRow } from './types';

interface ObjectDetail {
  key: string;
  version_id: string;
  etag: string;
  size: number;
  content_type: string;
  last_modified: string;
  metadata: Record<string, string>;
  tags: Record<string, string>;
}

export interface InspectorHandles {
  root: HTMLElement;
  stop: () => void;
  focusHeading: () => void;
}

/** The right-hand drawer: identity, replica wake, readiness, actions and version history. */
export async function mountInspector(options: {
  context: ConsoleContext;
  bucket: Bucket;
  objectKey: string;
  onClose: () => void;
  onDeleted: () => void;
  onNewVersion: () => void;
  uploadNewVersion: (detail: { key: string; versionId: string; etag: string }) => void;
}): Promise<InspectorHandles | null> {
  const { context, bucket, objectKey } = options;
  const base = `/api/w/${context.slug}/buckets/${encodeURIComponent(bucket.name)}`;
  const keyQuery = buildQuery([queryOf('key', objectKey)]);
  let detail: ObjectDetail;
  try {
    detail = (await api.get<ObjectDetail>(`${base}/object${keyQuery}`)).body;
  } catch {
    return null;
  }

  const heading = el('h3', { class: 'inspector-key', tabindex: '-1', text: objectKey });
  const closeButton = button('Close inspector', { focusKey: 'close-inspector', onClick: () => options.onClose() });
  const identity = el('dl', { class: 'inspector-identity' });
  const figure = el('figure', { 'aria-label': 'Replica map', class: 'replica-figure' });
  const statusList = el('ul', { class: 'visually-hidden', 'aria-label': 'Replica status' });
  const retryHolder = el('div', { class: 'retry-holder', 'data-retry-holder': 'true' });
  const announcements = el('p', { class: 'visually-hidden', role: 'status', 'aria-label': 'Replica announcements' });
  const readinessStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Release readiness' });
  const versionStatusRegion = statusRegion('Version status');
  const shareStatusRegion = statusRegion('Share status');
  const versionList = el('ul', { class: 'versions', 'aria-label': 'Versions' });

  const canWrite = context.role === 'developer' || context.role === 'owner';
  const downloadButton = button('Download', {
    focusKey: 'download',
    onClick: () => {
      window.location.assign(`${base}/object/content${keyQuery}`);
    },
  });
  const shareButton = button('Share link', { focusKey: 'share-link' });
  const actions = el('div', { class: 'inspector-actions' }, [downloadButton, shareButton]);

  const wake = new ReplicaWake(
    figure,
    statusList,
    announcements,
    readinessStatus,
    context.regions,
    bucket.placement,
    async (region) => {
      try {
        await api.post(`${base}/object/replicas/${region}/retry${keyQuery}`);
      } catch (error) {
        if (error instanceof ApiFailure) setStatus(versionStatusRegion, error.message);
      }
    },
    canWrite,
  );
  wake.mount();

  function renderIdentity(current: ObjectDetail): void {
    replace(identity, [
      el('div', {}, [el('dt', { text: 'Version' }), el('dd', { class: 'mono', text: current.version_id })]),
      el('div', {}, [el('dt', { text: 'ETag' }), el('dd', { class: 'mono', text: current.etag })]),
      el('div', {}, [el('dt', { text: 'Size (bytes)' }), el('dd', { class: 'mono num', text: formatCount(current.size) })]),
      el('div', {}, [el('dt', { text: 'Content type' }), el('dd', { text: current.content_type })]),
      el('div', {}, [
        el('dt', { text: 'Tags' }),
        el('dd', {
          text:
            Object.keys(current.tags).length === 0
              ? '\u2014'
              : Object.entries(current.tags)
                  .map(([name, value]) => `${name}=${value}`)
                  .join(', '),
        }),
      ]),
      el('div', {}, [
        el('dt', { text: 'Metadata' }),
        el('dd', {
          text:
            Object.keys(current.metadata).length === 0
              ? '\u2014'
              : Object.entries(current.metadata)
                  .map(([name, value]) => `${name}=${value}`)
                  .join(', '),
        }),
      ]),
    ]);
  }
  renderIdentity(detail);

  shareButton.addEventListener('click', () => {
    openDialog({
      name: 'Share link',
      opener: shareButton,
      build: (dialog) => {
        const expiry = el('select', { 'aria-label': 'Expires in' }, [
          el('option', { value: '3600', text: '1 hour' }),
          el('option', { value: '86400', text: '24 hours' }),
          el('option', { value: '604800', text: '7 days' }),
          el('option', { value: 'custom', text: 'Custom' }),
        ]);
        const seconds = el('input', { type: 'number', 'aria-label': 'Seconds', min: '1', max: '604800', value: '3600' });
        const secondsField = field('Seconds', seconds);
        secondsField.hidden = true;
        expiry.addEventListener('change', () => {
          secondsField.hidden = expiry.value !== 'custom';
        });
        const url = textbox('Link URL', { readOnly: true });
        const urlField = field('Link URL', url);
        urlField.hidden = true;
        const copy = button('Copy link', {
          onClick: () => {
            url.select();
            void navigator.clipboard?.writeText(url.value);
            setStatus(shareStatusRegion, shareStatus.copied);
          },
        });
        copy.hidden = true;
        const create = button('Create link', { className: 'primary' });
        create.addEventListener('click', async () => {
          setStatus(shareStatusRegion, shareStatus.pending);
          const chosen = expiry.value === 'custom' ? Number(seconds.value) : Number(expiry.value);
          try {
            const created = await api.post<{ url: string; expires_at: string }>(
              `${base}/object/links${buildQuery([queryOf('key', objectKey), queryOf('version', detail.version_id)])}`,
              { expires_in_seconds: chosen },
            );
            url.value = created.body.url;
            urlField.hidden = false;
            copy.hidden = false;
            create.disabled = true;
            setStatus(shareStatusRegion, shareStatus.success(created.body.expires_at));
          } catch (error) {
            if (!(error instanceof ApiFailure)) throw error;
            if (error.code === 'validation_failed') {
              dialog.setStatus(shareStatus.expiryError);
              setStatus(shareStatusRegion, shareStatus.expiryError);
              return;
            }
            setStatus(shareStatusRegion, error.code === 'storage_unavailable' ? storageOutage : error.message);
            dialog.close();
          }
        });
        dialog.body.append(
          el('h2', { text: 'Share link' }),
          field('Expires in', expiry),
          secondsField,
          urlField,
          el('div', { class: 'dialog-actions' }, [create, copy, button('Cancel', { onClick: () => dialog.close() })]),
        );
      },
    });
  });

  if (canWrite) {
    actions.append(
      button('Upload new version', {
        focusKey: 'upload-new-version',
        onClick: () => options.uploadNewVersion({ key: objectKey, versionId: detail.version_id, etag: detail.etag }),
      }),
      button('Delete object', {
        focusKey: 'delete-object',
        onClick: async () => {
          try {
            await api.delete(`${base}/object${keyQuery}`);
            options.onDeleted();
          } catch (error) {
            if (error instanceof ApiFailure) setStatus(versionStatusRegion, error.message);
          }
        },
      }),
    );
  }

  function retentionDialog(version: VersionRow, opener: HTMLElement): void {
    openDialog({
      name: 'Retention',
      opener,
      build: (dialog) => {
        const input = textbox('Retain until (UTC)', {
          value: version.retain_until === null ? '' : formatTimeInput(version.retain_until),
        });
        const save = button('Save retention', { className: 'primary' });
        save.addEventListener('click', async () => {
          setStatus(versionStatusRegion, versionStatus.pending(version.version_id));
          const typed = input.value.trim();
          try {
            await api.put(
              `${base}/object/retention${buildQuery([queryOf('key', objectKey), queryOf('version', version.version_id)])}`,
              { retain_until: `${typed.replace(' ', 'T')}Z` },
            );
            setStatus(versionStatusRegion, versionStatus.retentionSet(version.version_id, `${typed.replace(' ', 'T')}Z`));
            dialog.close();
            await refreshVersions();
          } catch (error) {
            if (!(error instanceof ApiFailure)) throw error;
            if (error.code === 'retention_locked') {
              dialog.setStatus(versionStatus.shorteningRefused);
              setStatus(versionStatusRegion, versionStatus.shorteningRefused);
              return;
            }
            const message = error.errors.retain_until ?? error.message;
            dialog.setStatus(message);
            setStatus(versionStatusRegion, message);
          }
        });
        dialog.body.append(
          el('h2', { text: 'Retention' }),
          field('Retain until (UTC)', input, 'YYYY-MM-DD HH:MM:SS'),
          el('div', { class: 'dialog-actions' }, [save, button('Cancel', { onClick: () => dialog.close() })]),
        );
      },
    });
  }

  function renderVersions(versions: VersionRow[]): void {
    replace(
      versionList,
      versions.map((version) => {
        const parts = [`${shortVersion(version.version_id)} \u00b7 ${formatCount(version.size)} bytes \u00b7 ${formatTime(version.created_at)}`];
        parts.push(version.current ? 'current' : `noncurrent since ${formatTime(version.noncurrent_since ?? version.created_at)}`);
        if (version.retain_until !== null && new Date(version.retain_until).getTime() > Date.now()) {
          parts.push(`held until ${formatTime(version.retain_until)}`);
        }
        if (version.legal_hold) parts.push('legal hold');
        const item = el('li', {}, [el('span', { text: parts.join(' \u00b7 ') })]);
        const locked = version.legal_hold || (version.retain_until !== null && new Date(version.retain_until).getTime() > Date.now());
        if (canWrite && !version.current && !locked) {
          item.append(
            button(`Delete version ${shortVersion(version.version_id)}`, {
              focusKey: `delete-version:${version.version_id}`,
              onClick: () =>
                openDialog({
                  name: 'Delete version',
                  opener: null,
                  build: (dialog) => {
                    const confirm = button('Delete version', { className: 'primary' });
                    confirm.addEventListener('click', async () => {
                      try {
                        await api.delete(
                          `${base}/object/version${buildQuery([queryOf('key', objectKey), queryOf('version', version.version_id)])}`,
                        );
                        setStatus(versionStatusRegion, versionStatus.deleted(version.version_id));
                        dialog.close();
                        await refreshVersions();
                      } catch (error) {
                        if (!(error instanceof ApiFailure)) throw error;
                        const message =
                          error.code === 'object_locked'
                            ? version.legal_hold
                              ? versionStatus.holdRefused(version.version_id)
                              : versionStatus.retentionRefused(version.version_id, String(error.extra.retain_until))
                            : error.message;
                        setStatus(versionStatusRegion, message);
                        dialog.close();
                      }
                    });
                    dialog.body.append(
                      el('p', { text: `Delete version ${shortVersion(version.version_id)} for good? This can't be undone.` }),
                      el('div', { class: 'dialog-actions' }, [confirm, button('Keep it', { onClick: () => dialog.close() })]),
                    );
                  },
                }),
            }),
          );
        }
        if (canWrite) {
          const retention = button(`Retention for ${shortVersion(version.version_id)}`, {
            focusKey: `retention:${version.version_id}`,
          });
          retention.addEventListener('click', () => retentionDialog(version, retention));
          item.append(retention);
        }
        if (context.role === 'owner') {
          const holdId = `hold-${version.version_id}`;
          const hold = el('input', {
            type: 'checkbox',
            id: holdId,
            'aria-label': `Legal hold on ${shortVersion(version.version_id)}`,
            'data-focus-key': `legal-hold:${version.version_id}`,
          });
          (hold as HTMLInputElement).checked = version.legal_hold;
          hold.addEventListener('change', async () => {
            const wanted = (hold as HTMLInputElement).checked;
            setStatus(versionStatusRegion, versionStatus.pending(version.version_id));
            try {
              const send = (): Promise<unknown> =>
                api.put(
                  `${base}/object/legal-hold${buildQuery([queryOf('key', objectKey), queryOf('version', version.version_id)])}`,
                  { on: wanted },
                );
              const outcome = wanted ? await send() : await withStepUp(send, { opener: hold, status: versionStatusRegion });
              if (outcome === null) {
                (hold as HTMLInputElement).checked = version.legal_hold;
                return;
              }
              setStatus(versionStatusRegion, versionStatus.legalHold(version.version_id, wanted));
              await refreshVersions();
            } catch (error) {
              (hold as HTMLInputElement).checked = version.legal_hold;
              if (error instanceof ApiFailure) setStatus(versionStatusRegion, error.message);
            }
          });
          item.append(hold, el('label', { for: holdId, text: 'Legal hold' }));
        }
        return item;
      }),
    );
  }

  async function refreshVersions(): Promise<void> {
    const versions = await api.get<{ versions: VersionRow[] }>(`${base}/object/versions${keyQuery}`);
    renderVersions(versions.body.versions);
  }

  let stopped = false;
  let knownVersion = detail.version_id;
  async function poll(): Promise<void> {
    if (stopped) return;
    let wait = 2000;
    try {
      const view = await api.get<ReplicaView>(`${base}/object/replicas${keyQuery}`);
      const reason = view.body.version_id === knownVersion ? 'poll' : 'new';
      if (reason === 'new') {
        knownVersion = view.body.version_id;
        detail = (await api.get<ObjectDetail>(`${base}/object${keyQuery}`)).body;
        renderIdentity(detail);
        options.onNewVersion();
      }
      wake.update(view.body, reason);
      await refreshVersions();
      const busy = view.body.replicas.some((replica) => replica.state === 'pending' || replica.state === 'failed');
      wait = busy ? 900 : 2000;
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'not_found') {
        options.onDeleted();
        return;
      }
    }
    if (!stopped) window.setTimeout(() => void poll(), wait);
  }

  const first = await api.get<ReplicaView>(`${base}/object/replicas${keyQuery}`);
  wake.update(first.body, 'load');
  await refreshVersions();
  window.setTimeout(() => void poll(), prefersReducedMotion() ? 900 : 900);

  const root = el('aside', { class: 'inspector', role: 'region', 'aria-label': 'Object inspector' }, [
    closeButton,
    heading,
    identity,
    figure,
    statusList,
    retryHolder,
    announcements,
    readinessStatus,
    actions,
    shareStatusRegion,
    versionList,
    versionStatusRegion,
  ]);

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (document.querySelector('.overlay') !== null) return;
    options.onClose();
  };
  document.addEventListener('keydown', onEscape);

  return {
    root,
    stop: () => {
      stopped = true;
      document.removeEventListener('keydown', onEscape);
    },
    focusHeading: () => heading.focus(),
  };
}
