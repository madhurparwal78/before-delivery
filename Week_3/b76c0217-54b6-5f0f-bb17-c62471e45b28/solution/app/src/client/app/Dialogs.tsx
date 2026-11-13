import { useState } from 'preact/hooks';
import { copy } from '../../shared/copy';
import type { NavigationJson, PageJson, PageSummary, PreviewLinkJson, VersionJson } from '../../shared/types';
import { api, type Failure } from './api';
import { announce, copyText, setBusy, tell } from '../shared/dom';
import { FieldError, fieldProps, Modal } from './ui';

/** Which field a refusal concerns: the server names it, or the code does. */
function fieldErrors(failure: Failure, byCode: Record<string, string>): Record<string, string> {
  return failure.fields ?? { [byCode[failure.code] ?? '']: failure.message };
}

function firstInvalid(errors: Record<string, string>, ids: Record<string, string>): void {
  const [name] = Object.keys(errors);
  const message = name === undefined ? undefined : errors[name];
  if (name !== undefined && message !== undefined) {
    document.getElementById(ids[name] ?? '')?.focus();
    announce(message);
  }
}

export function NewPageDialog(props: { versionId: string; nav: NavigationJson; defaultGroupId: string | null; onClose: () => void; onCreated: (page: PageJson) => void }) {
  const groups = props.nav.tabs.flatMap((tab) => tab.groups);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusyState] = useState(false);
  const ids = { title: 'np-title', path: 'np-path', groupId: 'np-group' };
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const path = String(form.get('path')).trim().replace(/^\/+/, '');
    setBusyState(true);
    const result = await api<PageJson>('POST', `/api/versions/${props.versionId}/pages`, { title: form.get('title'), path, groupId: form.get('groupId') });
    setBusyState(false);
    if (result.ok) {
      props.onCreated(result.data);
    } else {
      const found = fieldErrors(result.failure, { path_taken: 'path' });
      setErrors(found);
      firstInvalid(found, ids);
    }
  };
  return (
    <Modal title="New page" onClose={props.onClose}>
      <form onSubmit={submit} noValidate>
        <div class="field">
          <label for={ids.title}>Title</label>
          <input id={ids.title} name="title" type="text" autocomplete="off" {...fieldProps(ids.title, errors.title)} />
          <FieldError id={ids.title} message={errors.title} />
        </div>
        <div class="field">
          <label for={ids.path}>Path</label>
          <input id={ids.path} name="path" type="text" class="mono" autocomplete="off" spellcheck={false} {...fieldProps(ids.path, errors.path)} />
          <FieldError id={ids.path} message={errors.path} />
        </div>
        <div class="field">
          <label for={ids.groupId}>Group</label>
          <select id={ids.groupId} name="groupId" {...fieldProps(ids.groupId, errors.groupId)}>
            {groups.map((group) => (
              <option key={group.id} value={group.id} selected={group.id === props.defaultGroupId}>
                {group.title}
              </option>
            ))}
          </select>
          <FieldError id={ids.groupId} message={errors.groupId} />
        </div>
        <div class="actions">
          <button type="button" class="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="button primary" aria-busy={busy ? 'true' : undefined}>
            Create page
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function NewGroupDialog(props: { versionId: string; nav: NavigationJson; onClose: () => void; onCreated: (nav: NavigationJson) => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusyState] = useState(false);
  const ids = { title: 'ng-title', tabId: 'ng-tab' };
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setBusyState(true);
    const result = await api<NavigationJson>('POST', `/api/versions/${props.versionId}/groups`, { title: form.get('title'), tabId: form.get('tabId') });
    setBusyState(false);
    if (result.ok) {
      props.onCreated(result.data);
    } else {
      const found = fieldErrors(result.failure, {});
      setErrors(found);
      firstInvalid(found, ids);
    }
  };
  return (
    <Modal title="New group" onClose={props.onClose}>
      <form onSubmit={submit} noValidate>
        <div class="field">
          <label for={ids.title}>Title</label>
          <input id={ids.title} name="title" type="text" autocomplete="off" {...fieldProps(ids.title, errors.title)} />
          <FieldError id={ids.title} message={errors.title} />
        </div>
        <div class="field">
          <label for={ids.tabId}>Tab</label>
          <select id={ids.tabId} name="tabId" {...fieldProps(ids.tabId, errors.tabId)}>
            {props.nav.tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.title}
              </option>
            ))}
          </select>
          <FieldError id={ids.tabId} message={errors.tabId} />
        </div>
        <div class="actions">
          <button type="button" class="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="button primary" aria-busy={busy ? 'true' : undefined}>
            Create group
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function NewVersionDialog(props: { siteId: string; versions: VersionJson[]; currentId: string; onClose: () => void; onCreated: (version: VersionJson) => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusyState] = useState(false);
  const ids = { fromVersionId: 'nv-from', slug: 'nv-slug', title: 'nv-title' };
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setBusyState(true);
    const result = await api<VersionJson>('POST', `/api/sites/${props.siteId}/versions`, { fromVersionId: form.get('fromVersionId'), slug: form.get('slug'), title: form.get('title') });
    setBusyState(false);
    if (result.ok) {
      props.onCreated(result.data);
    } else {
      const found = fieldErrors(result.failure, { slug_taken: 'slug' });
      setErrors(found);
      firstInvalid(found, ids);
    }
  };
  return (
    <Modal title="New version" onClose={props.onClose}>
      <form onSubmit={submit} noValidate>
        <div class="field">
          <label for={ids.fromVersionId}>Copy from</label>
          <select id={ids.fromVersionId} name="fromVersionId" {...fieldProps(ids.fromVersionId, errors.fromVersionId)}>
            {props.versions.map((version) => (
              <option key={version.id} value={version.id} selected={version.id === props.currentId}>
                {version.title}
              </option>
            ))}
          </select>
          <FieldError id={ids.fromVersionId} message={errors.fromVersionId} />
        </div>
        <div class="field">
          <label for={ids.slug}>Slug</label>
          <input id={ids.slug} name="slug" type="text" class="mono" autocomplete="off" spellcheck={false} {...fieldProps(ids.slug, errors.slug)} />
          <FieldError id={ids.slug} message={errors.slug} />
        </div>
        <div class="field">
          <label for={ids.title}>Title</label>
          <input id={ids.title} name="title" type="text" autocomplete="off" {...fieldProps(ids.title, errors.title)} />
          <FieldError id={ids.title} message={errors.title} />
        </div>
        <div class="actions">
          <button type="button" class="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="button primary" aria-busy={busy ? 'true' : undefined}>
            Create version
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ShareDialog(props: { link: PreviewLinkJson; onClose: () => void }) {
  const [revoked, setRevoked] = useState(false);
  const full = `${location.origin}${props.link.url}`;
  return (
    <Modal title="Share preview" onClose={props.onClose}>
      <div class="field">
        <label for="share-link">Preview link</label>
        <input
          id="share-link"
          type="text"
          class="mono"
          readOnly
          value={full}
          ref={(element) => {
            element?.select();
          }}
        />
      </div>
      {revoked && <p class="field-error">{copy.previewLinkRevoked}</p>}
      <div class="actions">
        <button
          type="button"
          class="button"
          onClick={async () => {
            await copyText(full);
            tell(copy.copied);
          }}
        >
          Copy link
        </button>
        <button
          type="button"
          class="button"
          onClick={async (event) => {
            const button = event.currentTarget;
            setBusy(button, true);
            const result = await api('DELETE', `/api/preview-links/${props.link.id}`);
            setBusy(button, false);
            if (result.ok) {
              setRevoked(true);
              tell(copy.previewLinkRevoked);
            }
          }}
        >
          Revoke
        </button>
        <button type="button" class="button primary" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function RemoveDialog(props: { page: PageSummary; onClose: () => void; onRemove: () => Promise<void> }) {
  const [busy, setBusyState] = useState(false);
  return (
    <Modal title={`Remove ${props.page.title}?`} onClose={props.onClose}>
      <p>
        <span class="mono">/{props.page.path}</span> leaves the sidebar and its path becomes free. Redirects that led to it are dropped.
      </p>
      <div class="actions">
        <button type="button" class="button" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          class="button primary"
          aria-busy={busy ? 'true' : undefined}
          onClick={async () => {
            setBusyState(true);
            await props.onRemove();
            setBusyState(false);
          }}
        >
          Remove
        </button>
      </div>
    </Modal>
  );
}
