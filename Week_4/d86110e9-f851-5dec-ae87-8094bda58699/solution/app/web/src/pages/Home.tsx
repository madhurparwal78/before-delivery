import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, ApiFailure, uploadFile, w } from '../api';
import { formatTime } from '../format';
import { Link, navigate, useTitle } from '../router';
import { useShell } from '../shell';
import { Button, Chip, EmptyState, Modal, Problem, Skeleton, useAccess } from '../ui';
import type { AutomationItem, TriggerKind, WorkspaceInfo } from '../types';
import '../build/styles/site.css';

const TRIGGERS: Array<{ kind: TriggerKind; label: string }> = [
  { kind: 'form', label: 'Form' },
  { kind: 'schedule', label: 'Schedule' },
  { kind: 'webhook', label: 'Webhook' },
  { kind: 'row_added', label: 'Row added' },
  { kind: 'manual', label: 'Manual' },
];

function NewAutomation({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TriggerKind>('form');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string } | null>(null);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    api.post<{ id: string }>(w(workspaceId, '/automations'), { name, trigger_kind: kind }).then(
      (created) => navigate(`/w/${workspaceId}/automations/${created.id}`),
      (error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setProblem({ message: error.message });
        setBusy(false);
      },
    );
  };
  return (
    <Modal label="New automation" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="modal-head">
          <h2>New automation</h2>
        </div>
        <Problem message={problem?.message ?? null} field="name" />
        <div className="field">
          <label htmlFor="field-name">Automation name</label>
          <input id="field-name" type="text" data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="field-trigger">Trigger</label>
          <select id="field-trigger" value={kind} onChange={(event) => setKind(event.target.value as TriggerKind)}>
            {TRIGGERS.map((trigger) => (
              <option key={trigger.kind} value={trigger.kind}>
                {trigger.label}
              </option>
            ))}
          </select>
        </div>
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button type="submit" busy={busy}>Create automation</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Home({ workspace }: { workspace: WorkspaceInfo }) {
  useTitle('Automations');
  const { say, raise, subscribe, epoch } = useShell();
  const { locked } = useAccess();
  const [items, setItems] = useState<AutomationItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const answer = await api.get<{ automations: AutomationItem[] }>(w(workspace.id, '/automations'));
    setItems(answer.automations);
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load, epoch]);
  useEffect(() => subscribe((event) => {
    if (event.type === 'version' || event.type === 'drain') void load();
  }), [subscribe, load]);

  const upload = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.target;
    const file = input.files?.[0];
    if (file === undefined) return;
    say('Saving import...');
    uploadFile<{ automation_id: string }>(w(workspace.id, '/imports'), file).then(
      (saved) => navigate(`/w/${workspace.id}/automations/${saved.automation_id}`, { state: { draftNotice: 'Import saved. This is a draft.' } }),
      (error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        input.value = '';
        if (error.status === 503) {
          say('');
          raise('Storage is unavailable. Nothing was saved.');
        } else say(error.message);
      },
    );
  };

  return (
    <div className="home">
      <div className="page-head">
        <h1>Automations</h1>
      </div>
      <div className="actions-row">
        <Button {...locked()} onClick={() => setCreating(true)}>New automation</Button>
        <Button variant="secondary" {...locked()} aria-expanded={importing} onClick={() => setImporting(!importing)}>
          Import automation
        </Button>
      </div>
      {importing ? (
        <div className="import-panel">
          <label>
            Automation file
            <input type="file" accept="application/json,.json" onChange={upload} />
          </label>
        </div>
      ) : null}
      {items === null ? (
        <Skeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyState>No automations yet. Create one to start wiring steps.</EmptyState>
      ) : (
        <ul aria-label="Automations" className="row-list">
          {items.map((item) => (
            <li key={item.id} className="row-item">
              <Link to={`/w/${workspace.id}/automations/${item.id}`} className="row-main">
                {item.name}
              </Link>
              <span className="row-meta mono-label">{item.trigger_kind.replace('_', ' ')}</span>
              <Chip status={item.live_version === null ? 'draft' : 'live'}>{item.live_version === null ? 'Draft only' : `Live v${item.live_version}`}</Chip>
              {item.next_run_at ? <span className="row-meta">Next run {formatTime(item.next_run_at)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {creating ? <NewAutomation workspaceId={workspace.id} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
