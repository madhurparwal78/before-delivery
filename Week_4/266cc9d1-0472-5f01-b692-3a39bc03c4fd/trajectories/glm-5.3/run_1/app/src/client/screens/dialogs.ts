import { api, ApiRequestError, type Corridor, type Finding, type SetRecord } from '../api.js';
import { kindLabel, summaryLine, findingNoun, violationNoun } from '../format.js';

/**
 * Dialogs: the finding editor, submit, and upload. Focus is trapped inside
 * every open dialog; Escape closes; focus returns to the opener.
 */

type EditorContext = {
  mode: 'new' | 'edit' | 'new-at-point';
  finding?: Finding;
  point?: { lon: number; lat: number; height: number };
  chainage?: number;
  corridorLength: number;
  groundHeight?: number;
  terrainLevel?: number | null;
  onSaved(): Promise<void> | void;
};

type Field = 'ground' | 'offset' | 'canopy' | 'radius' | 'comment';

function openDialog(shell: HTMLElement, label: string, closeRef?: HTMLElement): { dialog: HTMLElement; close(): void } {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', label);
  dialog.className = 'dialog';
  overlay.append(dialog);
  shell.append(overlay);
  const opener = closeRef ?? document.activeElement as HTMLElement | null;
  const close = (): void => {
    overlay.remove();
    if (opener && document.body.contains(opener)) opener.focus();
    else (document.activeElement as HTMLElement | null)?.focus();
  };
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  const trap = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      document.removeEventListener('keydown', trap);
      return;
    }
    if (e.key === 'Tab') {
      const focusables = dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const list = [...focusables].filter((el) => !el.hasAttribute('disabled'));
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', trap);
  dialog.dataset.trap = 'on';
  return { dialog, close };
}

export function openEditor(shell: HTMLElement, ctx: EditorContext): void {
  const isEdit = ctx.mode === 'edit' && ctx.finding;
  const label = isEdit ? `Edit finding ${ctx.finding?.label}` : 'New finding';
  const { dialog, close } = openDialog(shell, label);
  const heading = document.createElement('h2');
  heading.textContent = label;
  const info = document.createElement('p');
  info.className = 'mono dialog-info';
  if (isEdit && ctx.finding) {
    info.textContent = `chainage ${ctx.finding.chainage_m.toFixed(1)} m · ${ctx.finding.span.label} · terrain level ${ctx.finding.terrain_level ?? 'hand-entered'}`;
  } else if (ctx.mode === 'new-at-point' && ctx.point) {
    info.textContent = `picked at ${ctx.point.lat.toFixed(6)}, ${ctx.point.lon.toFixed(6)}`;
  } else {
    info.textContent = `chainage ${(ctx.chainage ?? 0).toFixed(1)} m · terrain level ${ctx.terrainLevel ?? 'hand-entered'}`;
  }
  dialog.append(heading, info);

  const fields: Record<Field, { wrap: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement; hint: HTMLElement }> = {
    ground: mkInput('Ground height (m)', 'number', isEdit ? String(ctx.finding?.ground_height_m ?? '') : String(ctx.groundHeight ?? '')),
    offset: mkInput('Offset from centreline (m)', 'number', isEdit ? String(ctx.finding?.offset_m ?? 0) : '0'),
    canopy: mkInput('Canopy height above ground (m)', 'number', isEdit ? String(ctx.finding?.canopy_height_m ?? '') : ''),
    radius: mkInput('Canopy radius (m)', 'number', isEdit ? String(ctx.finding?.canopy_radius_m ?? 3) : '3.00'),
    comment: mkArea('Comment', isEdit ? String(ctx.finding?.comment ?? '') : ''),
  };
  for (const f of Object.values(fields)) dialog.append(f.wrap);
  const errorSummary = document.createElement('div');
  errorSummary.className = 'error-summary';
  dialog.append(errorSummary);

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save finding';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', close);
  actions.append(save, cancel);
  if (isEdit) {
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete finding';
    let armed = false;
    del.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        del.textContent = 'Confirm delete';
        return;
      }
      try {
        await api(`/api/findings/${ctx.finding?.id}`, { method: 'DELETE' });
        const status = document.getElementById('save-status');
        if (status) status.textContent = `Deleted ${ctx.finding?.label}.`;
        await ctx.onSaved();
      } catch (err) {
        const status = document.getElementById('save-status');
        if (status && err instanceof ApiRequestError) status.textContent = err.message;
      }
      close();
    });
    actions.append(del);
  }
  dialog.append(actions);

  const handEntered = (): void => {
    info.textContent = info.textContent.replace(/terrain level \S+.*$/, 'terrain level hand-entered');
  };
  fields.ground.input.addEventListener('input', handEntered);

  save.addEventListener('click', async () => {
    const status = document.getElementById('save-status');
    const pendingLabel = isEdit ? ctx.finding?.label ?? '' : 'new finding';
    if (status) status.textContent = `Saving ${pendingLabel}...`;
    const body: Record<string, unknown> = {
      chainage_m: isEdit ? ctx.finding?.chainage_m : (ctx.mode === 'new-at-point' ? ctx.chainage : ctx.chainage),
      offset_m: Number(fields.offset.input.value || 0),
      ground_height_m: Number(fields.ground.input.value || 0),
      terrain_level: null,
      canopy_height_m: Number(fields.canopy.input.value || NaN),
      canopy_radius_m: Number(fields.radius.input.value || 3),
      comment: fields.comment.input.value,
    };
    const errMap: Record<string, string> = {};
    const validate = (): boolean => {
      let ok = true;
      const ground = Number(fields.ground.input.value);
      const canopy = Number(fields.canopy.input.value);
      const radius = Number(fields.radius.input.value);
      const offset = Number(fields.offset.input.value);
      const comment = fields.comment.input.value;
      const setErr = (field: Field, msg: string, hint: HTMLElement): void => {
        errMap[field] = msg;
        hint.textContent = msg;
        ok = false;
      };
      clearErrors();
      if (!Number.isFinite(ground) || ground < -500 || ground > 9000) setErr('ground', 'Ground height must be between -500 and 9,000 metres.', fields.ground.hint);
      if (!Number.isFinite(offset) || offset < -60 || offset > 60) setErr('offset', 'Offset must be between -60 and 60 metres.', fields.offset.hint);
      if (!Number.isFinite(canopy) || canopy < 0.5 || canopy > 80) setErr('canopy', 'Canopy height must be between 0.5 and 80 metres.', fields.canopy.hint);
      if (!Number.isFinite(radius) || radius < 0.5 || radius > 20) setErr('radius', 'Canopy radius must be between 0.5 and 20 metres.', fields.radius.hint);
      if (comment.length > 2000) setErr('comment', 'Comment must be 2,000 characters or fewer.', fields.comment.hint);
      return ok;
    };
    const clearErrors = (): void => {
      for (const f of Object.values(fields)) f.hint.textContent = '';
      errorSummary.replaceChildren();
    };
    if (!validate()) {
      renderSummary(errMap, fields);
      return;
    }
    try {
      let saved: Finding;
      if (isEdit) {
        const r = await api<{ finding: Finding }>(`/api/findings/${ctx.finding?.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            canopy_height_m: body.canopy_height_m,
            canopy_radius_m: body.canopy_radius_m,
            comment: body.comment,
          }),
        });
        saved = r.finding;
      } else {
        const payload: Record<string, unknown> = { ...body };
        if (ctx.mode === 'new-at-point' && ctx.point) {
          payload['lon_deg'] = ctx.point.lon;
          payload['lat_deg'] = ctx.point.lat;
          delete payload['chainage_m'];
          delete payload['offset_m'];
        }
        if (!ctx.finding) {
          payload['set_id'] = undefined;
        }
        const setRes = await currentSetId();
        const r = await api<{ finding: Finding }>(`/api/findings-sets/${setRes}/findings`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        saved = r.finding;
      }
      if (status) status.textContent = `Saved ${saved.label}. Clearance ${saved.clearance_m.toFixed(2)} m, ${saved.status === 'violation' ? 'Violation' : 'Clear'}.`;
      await ctx.onSaved();
      close();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const byField: Record<Field, string[]> = { ground: [], offset: [], canopy: [], radius: [], comment: [] };
        const map: Record<string, Field> = {
          ground_height_m: 'ground', offset_m: 'offset', canopy_height_m: 'canopy',
          canopy_radius_m: 'radius', comment: 'comment',
        };
        const msgs: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) {
          msgs[k] = v;
          const f = map[k];
          if (f) byField[f].push(v);
        }
        clearErrors();
        const summaryErrs: Record<string, string> = {};
        for (const [f, list] of Object.entries(byField)) {
          if (list.length > 0) {
            fields[f as Field].hint.textContent = list[0];
            summaryErrs[f] = list[0];
          }
        }
        renderSummary(summaryErrs, fields);
        if (status) status.textContent = `Could not save ${pendingLabel}. Check the highlighted fields.`;
      } else if (status) {
        status.textContent = `Could not save ${pendingLabel}. Check the highlighted fields.`;
      }
    }
  });

  const first = fields.ground.input as HTMLInputElement;
  first.focus();
  first.select();
}

async function currentSetId(): Promise<string> {
  const path = location.pathname;
  const corridorId = decodeURIComponent(/\/corridors\/([^/]+)/.exec(path)?.[1] ?? '');
  const detail = await api<{ corridor: { current_set: { id: string } | null } }>(`/api/corridors/${corridorId}`);
  if (!detail.corridor.current_set) throw new Error('no open set');
  return detail.corridor.current_set.id;
}

function renderSummary(errs: Record<string, string>, fields: Record<Field, { input: HTMLInputElement | HTMLTextAreaElement; hint: HTMLElement }>): void {
  const summary = document.querySelector('[role="dialog"] .error-summary');
  if (!summary) return;
  summary.replaceChildren();
  const entries = Object.entries(errs).filter(([, v]) => v);
  if (entries.length === 0) return;
  const h = document.createElement('h3');
  h.textContent = 'Fix these fields';
  summary.append(h);
  for (const [key, msg] of entries) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = msg;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      fields[key as Field].input.focus();
    });
    summary.append(a);
  }
}

function mkInput(label: string, type: string, value: string): { wrap: HTMLElement; input: HTMLInputElement; hint: HTMLElement } {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const name = document.createElement('span');
  name.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.step = 'any';
  input.setAttribute('aria-label', label);
  const hint = document.createElement('span');
  hint.className = 'field-error';
  hint.setAttribute('aria-live', 'polite');
  wrap.append(name, input, hint);
  return { wrap, input, hint };
}

function mkArea(label: string, value: string): { wrap: HTMLElement; input: HTMLTextAreaElement; hint: HTMLElement } {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const name = document.createElement('span');
  name.textContent = label;
  const input = document.createElement('textarea');
  input.rows = 3;
  input.value = value;
  input.setAttribute('aria-label', label);
  const hint = document.createElement('span');
  hint.className = 'field-error';
  wrap.append(name, input, hint);
  return { wrap, input, hint };
}

export function openSubmitDialog(
  shell: HTMLElement,
  data: { set: SetRecord | null; findings: Finding[] },
  corridor: Corridor,
  onDone: (result: { set: SetRecord }) => void
): void {
  if (!data.set) return;
  const n = data.findings.length;
  const v = data.findings.filter((f) => f.status === 'violation').length;
  const { dialog, close } = openDialog(shell, 'Submit findings set');
  const h = document.createElement('h2');
  h.textContent = 'Submit findings set';
  const body = document.createElement('p');
  body.textContent = `${n} ${findingNoun(n)}, ${v} ${violationNoun(v)} will be frozen and sent to ${corridor.utility.forester_email}.`;
  dialog.append(h, body);
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.textContent = 'Confirm submit';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', close);
  actions.append(confirm, cancel);
  dialog.append(actions);

  let pending = false;
  const idemKey = `submit-${data.set.id}-${Date.now()}`;
  confirm.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    confirm.textContent = 'Submitting...';
    confirm.setAttribute('aria-disabled', 'true');
    const status = document.getElementById('submit-status');
    if (status) status.textContent = `Submitting revision ${data.set?.revision}...`;
    try {
      const r = await api<{ set: SetRecord; email: 'sent' | 'queued' }>(`/api/findings-sets/${data.set?.id}/submit`, {
        method: 'POST',
        body: '{}',
        idempotencyKey: idemKey,
      });
      if (status) {
        status.textContent = r.email === 'sent'
          ? `Submitted revision ${r.set.revision}. Review link emailed to ${corridor.utility.forester_email}.`
          : `Submitted revision ${r.set.revision}. The email to ${corridor.utility.forester_email} is queued and will send when mail is back.`;
      }
      onDone({ set: r.set });
      close();
    } catch (err) {
      pending = false;
      confirm.textContent = 'Confirm submit';
      confirm.removeAttribute('aria-disabled');
      if (err instanceof ApiRequestError) {
        if (err.code === 'illegal_transition' && status) {
          status.textContent = 'This findings set was already submitted.';
          close();
          return;
        }
        if (err.code === 'storage_unavailable' && status) {
          status.textContent = 'Submit needs tile storage to write the evidence pack. Try again when storage is back.';
          return;
        }
        const fieldMsg = Object.values(err.fields)[0];
        if (status) status.textContent = fieldMsg ?? err.message;
      } else if (status) {
        status.textContent = 'Something went wrong. Try again.';
      }
    }
  });
  confirm.focus();
}

export async function openUploadDialog(shell: HTMLElement, corridorId: string, onDone: () => Promise<void> | void): Promise<void> {
  const { dialog, close } = openDialog(shell, 'Upload survey assets');
  const h = document.createElement('h2');
  h.textContent = 'Upload survey assets';
  const kindGroup = document.createElement('div');
  kindGroup.setAttribute('role', 'radiogroup');
  kindGroup.setAttribute('aria-label', 'Asset kind');
  const kinds: Array<{ value: 'tileset' | 'terrain' | 'czml'; label: string }> = [
    { value: 'tileset', label: 'Tileset' },
    { value: 'terrain', label: 'Terrain' },
    { value: 'czml', label: 'Flight track' },
  ];
  let kind: string = 'tileset';
  for (const k of kinds) {
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'asset-kind';
    radio.id = `kind-${k.value}`;
    radio.value = k.value;
    radio.checked = k.value === 'tileset';
    radio.addEventListener('change', () => { kind = k.value; });
    const label = document.createElement('label');
    label.htmlFor = radio.id;
    label.textContent = k.label;
    kindGroup.append(radio, label);
  }
  const fileLabel = document.createElement('label');
  fileLabel.className = 'field';
  const name = document.createElement('span');
  name.textContent = 'Files';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.setAttribute('aria-label', 'Files');
  fileLabel.append(name, fileInput);
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const upload = document.createElement('button');
  upload.type = 'button';
  upload.textContent = 'Upload';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', close);
  actions.append(upload, closeBtn);
  dialog.append(h, kindGroup, fileLabel, actions);

  upload.addEventListener('click', async () => {
    const status = document.getElementById('upload-status');
    const files = [...fileInput.files ?? []];
    if (files.length === 0) {
      if (status) status.textContent = 'Choose files to upload.';
      return;
    }
    const crypto = window.crypto;
    const digests = await Promise.all(files.map(async (f) => {
      const buf = await f.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }));
    const manifest = files.map((f, i) => ({
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath?.replace(/^[^/]*\//, '') || f.name,
      size_bytes: f.size,
      sha256: digests[i],
    }));
    if (status) status.textContent = `Verifying ${manifest.length} ${manifest.length === 1 ? 'file' : 'files'} with storage`;
    try {
      const declared = await api<{ asset: { id: string } }>(`/api/corridors/${corridorId}/assets`, {
        method: 'POST',
        body: JSON.stringify({ kind, files: manifest }),
      });
      const assetId = declared.asset.id;
      let done = 0;
      for (let i = 0; i < files.length; i++) {
        if (status) status.textContent = `Uploading ${done} of ${files.length} files for ${kindLabel(kind)}`;
        const body = await files[i].arrayBuffer();
        await fetch(`/api/assets/${assetId}/files/${encodeURIComponent(manifest[i].path)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body,
          credentials: 'same-origin',
        });
        done++;
      }
      if (status) status.textContent = `${kindLabel(kind)} stored: ${manifest.length} ${manifest.length === 1 ? 'file' : 'files'} verified.`;
      await onDone();
      close();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'storage_unavailable') {
          if (status) status.textContent = 'Tile storage is unreachable. Upload paused; nothing was stored.';
        } else if (err.code === 'invalid_czml') {
          if (status) status.textContent = 'Flight track rejected: no position samples with an epoch and availability.';
        } else if (err.code === 'checksum_mismatch') {
          const field = err.fields['sha256'] ? 'sha256' : 'size_bytes';
          void field;
          if (status) status.textContent = `${kindLabel(kind)} rejected: a file did not match its checksum.`;
        } else {
          const first = Object.values(err.fields)[0];
          if (status) status.textContent = first ?? err.message;
        }
      } else if (status) {
        status.textContent = 'Something went wrong. Try again.';
      }
    }
  });
}

export { summaryLine };
