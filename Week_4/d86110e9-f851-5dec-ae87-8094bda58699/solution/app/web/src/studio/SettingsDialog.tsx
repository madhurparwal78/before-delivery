import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from '../ui';
import type { DraftView, Fields, GraphNode, Json, TableView, TriggerNode } from '../types';
import { KIND_LABEL, PORTS, outgoing } from './geometry';

export interface Patch {
  name?: string;
  fields?: Fields;
  sample?: Fields | string;
}

interface Props {
  node: GraphNode | TriggerNode;
  draft: DraftView;
  tables: TableView[];
  canEdit: boolean;
  returnTo: HTMLElement | null;
  onSave: (patch: Patch) => Promise<boolean>;
  onClose: () => void;
}

const text = (value: Json | undefined): string => (typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

interface Lock {
  disabled: boolean;
}

/** Text that saves when it changes: on blur, on Enter in a single line, or when a choice is made. */
function useSaved(server: string, commit: (value: string) => Promise<boolean>) {
  const [value, setValue] = useState(server);
  const [resync, setResync] = useState(0);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setValue(server);
  }, [server, resync]);
  const change = (next: string): void => {
    dirty.current = true;
    setValue(next);
  };
  const save = async (next: string = value): Promise<void> => {
    if (!dirty.current) return;
    if (next === server) {
      dirty.current = false;
      return;
    }
    const ok = await commit(next);
    dirty.current = false;
    if (!ok) setResync((count) => count + 1);
  };
  return { value, change, save };
}

function describe(lock: Lock) {
  return lock.disabled ? { disabled: true, 'aria-describedby': 'reason-viewer' } : {};
}

interface TextFieldProps {
  label: string;
  server: string;
  commit: (value: string) => Promise<boolean>;
  lock: Lock;
  multiline?: boolean;
  type?: 'text' | 'number';
  autoFocus?: boolean;
}

function TextField({ label, server, commit, lock, multiline = false, type = 'text', autoFocus = false }: TextFieldProps) {
  const id = useId();
  const field = useSaved(server, commit);
  const common = {
    id,
    value: field.value,
    onChange: (event: { target: { value: string } }) => field.change(event.target.value),
    onBlur: () => void field.save(),
    ...describe(lock),
    ...(autoFocus ? { 'data-autofocus': true } : {}),
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={3} />
      ) : (
        <input
          {...common}
          type={type}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void field.save();
          }}
        />
      )}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  server: string;
  options: Array<{ value: string; label: string }>;
  commit: (value: string) => Promise<boolean>;
  lock: Lock;
}

function SelectField({ label, server, options, commit, lock }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={server} onChange={(event) => void commit(event.target.value)} {...describe(lock)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface Pair {
  name: string;
  value: string;
}

const pairsOf = (object: Fields): Pair[] => Object.entries(object).map(([name, value]) => ({ name, value: text(value) }));
const objectOf = (pairs: Pair[]): Fields => Object.fromEntries(pairs.map((pair) => [pair.name, pair.value]));

interface PairRowsProps {
  group: string;
  nameLabel: string;
  valueLabel: string;
  addLabel: string;
  server: Fields;
  commit: (value: Fields) => Promise<boolean>;
  lock: Lock;
}

/** Name and value rows that save the whole object whenever one of them changes. */
function PairRows({ group, nameLabel, valueLabel, addLabel, server, commit, lock }: PairRowsProps) {
  const [rows, setRows] = useState<Pair[]>(() => pairsOf(server));
  useEffect(() => {
    setRows((current) => (same(objectOf(current), server) ? current : pairsOf(server)));
  }, [server]);
  const send = async (next: Pair[]): Promise<void> => {
    if (same(objectOf(next), server)) return;
    if (!(await commit(objectOf(next)))) setRows(pairsOf(server));
  };
  const edit = (index: number, part: Partial<Pair>): void => setRows(rows.map((row, at) => (at === index ? { ...row, ...part } : row)));
  return (
    <div role="group" aria-label={group} className="rows">
      {rows.map((row, index) => (
        <div className="row-pair" key={index}>
          <RowInput label={`${nameLabel} ${index + 1}`} value={row.name} lock={lock} onChange={(value) => edit(index, { name: value })} onCommit={() => void send(rows)} />
          <RowInput label={`${valueLabel} ${index + 1}`} value={row.value} lock={lock} onChange={(value) => edit(index, { value })} onCommit={() => void send(rows)} />
        </div>
      ))}
      <Button
        variant="secondary"
        {...describe(lock)}
        onClick={() => {
          const next = [...rows, { name: '', value: '' }];
          setRows(next);
          void send(next);
        }}
      >
        {addLabel}
      </Button>
    </div>
  );
}

function RowInput({ label, value, lock, onChange, onCommit }: { label: string; value: string; lock: Lock; onChange: (value: string) => void; onCommit: () => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value} onChange={(event) => onChange(event.target.value)} onBlur={onCommit} onKeyDown={(event) => event.key === 'Enter' && onCommit()} {...describe(lock)} />
    </div>
  );
}

interface FormField {
  name: string;
  label: string;
  type: string;
}

function FormFieldRows({ server, commit, lock }: { server: Json; commit: (value: Json) => Promise<boolean>; lock: Lock }) {
  const initial = (Array.isArray(server) ? server : []) as unknown as FormField[];
  const [rows, setRows] = useState<FormField[]>(initial);
  useEffect(() => {
    const next = (Array.isArray(server) ? server : []) as unknown as FormField[];
    setRows((current) => (same(current, next) ? current : next));
  }, [server]);
  const send = async (next: FormField[]): Promise<void> => {
    if (same(next, server)) return;
    if (!(await commit(next as unknown as Json))) setRows(initial);
  };
  const edit = (index: number, part: Partial<FormField>): FormField[] => rows.map((row, at) => (at === index ? { ...row, ...part } : row));
  return (
    <div role="group" aria-label="Form fields" className="rows">
      {rows.map((row, index) => (
        <div className="row-triple" key={index}>
          <RowInput label={`Field name ${index + 1}`} value={row.name} lock={lock} onChange={(value) => setRows(edit(index, { name: value }))} onCommit={() => void send(rows)} />
          <RowInput label={`Field label ${index + 1}`} value={row.label} lock={lock} onChange={(value) => setRows(edit(index, { label: value }))} onCommit={() => void send(rows)} />
          <div className="field">
            <label htmlFor={`ft-${index}`}>{`Field type ${index + 1}`}</label>
            <select
              id={`ft-${index}`}
              value={row.type}
              onChange={(event) => {
                const next = edit(index, { type: event.target.value });
                setRows(next);
                void send(next);
              }}
              {...describe(lock)}
            >
              <option value="text">text</option>
              <option value="number">number</option>
            </select>
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        {...describe(lock)}
        onClick={() => {
          const next = [...rows, { name: '', label: '', type: 'text' }];
          setRows(next);
          void send(next);
        }}
      >
        Add form field
      </Button>
    </div>
  );
}

function Expander({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="expander">
      <h3 className="expander-head">
        <button type="button" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
          {title}
          <span aria-hidden="true" className="expander-mark">{open ? '−' : '+'}</span>
        </button>
      </h3>
      {open ? (
        <div id={id} className="expander-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}

const OPERATORS = ['equals', 'not equals', 'contains', 'greater than', 'less than', 'is empty', 'is not empty'];

function KindFields({ node, tables, lock, save }: { node: GraphNode | TriggerNode; tables: TableView[]; lock: Lock; save: (patch: Patch) => Promise<boolean> }) {
  const f = node.fields;
  const field = (key: string, value: Json) => save({ fields: { [key]: value } });
  const textField = (label: string, key: string) => (
    <TextField label={label} server={text(f[key])} lock={lock} commit={(value) => field(key, value)} />
  );
  const tableOptions = [{ value: '', label: 'Choose a table' }, ...tables.map((table) => ({ value: table.id, label: table.name }))];
  const sample = (
    <TextField
      label="Sample data (JSON)"
      multiline
      server={JSON.stringify((node as TriggerNode).sample ?? {}, null, 2)}
      lock={lock}
      commit={(value) => {
        let parsed: Fields | string = value;
        try {
          parsed = JSON.parse(value) as Fields;
        } catch {
          parsed = value;
        }
        return save({ sample: parsed });
      }}
    />
  );
  const columns = (): ReactNode => {
    const table = tables.find((candidate) => candidate.id === f.table);
    const values = (typeof f.values === 'object' && f.values !== null && !Array.isArray(f.values) ? f.values : {}) as Fields;
    return table?.columns.map((column) => (
      <TextField key={column.name} label={`Column ${column.name}`} server={text(values[column.name])} lock={lock} commit={(value) => field('values', { ...values, [column.name]: value })} />
    ));
  };
  switch (node.kind) {
    case 'form':
      return (
        <>
          {textField('Form path', 'path')}
          <FormFieldRows server={f.form_fields ?? []} lock={lock} commit={(value) => field('form_fields', value)} />
          {sample}
        </>
      );
    case 'schedule':
      return (
        <>
          {textField('Schedule', 'schedule')}
          {sample}
        </>
      );
    case 'webhook':
      return (
        <>
          {textField('Hook path', 'path')}
          {sample}
        </>
      );
    case 'row_added':
      return (
        <>
          <SelectField label="Table" server={text(f.table)} options={tableOptions} lock={lock} commit={(value) => field('table', value)} />
          {sample}
        </>
      );
    case 'manual':
      return sample;
    case 'set':
      return <PairRows group="Values" nameLabel="Value name" valueLabel="Value" addLabel="Add value" server={(f.values ?? {}) as Fields} lock={lock} commit={(value) => field('values', value)} />;
    case 'filter':
    case 'branch':
      return (
        <>
          {textField('Left', 'left')}
          <SelectField label="Operator" server={text(f.operator) || 'equals'} options={OPERATORS.map((value) => ({ value, label: value }))} lock={lock} commit={(value) => field('operator', value)} />
          {textField('Right', 'right')}
        </>
      );
    case 'loop':
      return (
        <>
          <SelectField
            label="Loop over"
            server={text(f.source) || 'list'}
            options={[{ value: 'list', label: 'A list' }, { value: 'table', label: 'All rows of a table' }]}
            lock={lock}
            commit={(value) => field('source', value)}
          />
          {f.source === 'table' ? (
            <SelectField label="Table" server={text(f.table)} options={tableOptions} lock={lock} commit={(value) => field('table', value)} />
          ) : (
            textField('List', 'list')
          )}
        </>
      );
    case 'wait':
      return (
        <TextField
          label="Seconds"
          type="number"
          server={text(f.seconds)}
          lock={lock}
          commit={(value) => field('seconds', value.trim() === '' ? null : Number(value))}
        />
      );
    case 'send_email':
      return (
        <>
          {textField('To', 'to')}
          {textField('Subject', 'subject')}
          <TextField label="Body" multiline server={text(f.body)} lock={lock} commit={(value) => field('body', value)} />
        </>
      );
    case 'add_row':
      return (
        <>
          <SelectField label="Table" server={text(f.table)} options={tableOptions} lock={lock} commit={(value) => field('table', value)} />
          {columns()}
        </>
      );
    case 'update_row':
      return (
        <>
          <SelectField label="Table" server={text(f.table)} options={tableOptions} lock={lock} commit={(value) => field('table', value)} />
          {textField('Row id', 'row_id')}
          {columns()}
        </>
      );
    case 'call_webhook':
      return (
        <>
          {textField('URL', 'url')}
          <PairRows group="Body" nameLabel="Body name" valueLabel="Body value" addLabel="Add body value" server={(f.body ?? {}) as Fields} lock={lock} commit={(value) => field('body', value)} />
        </>
      );
  }
}

function TemplateHelp({ node, draft }: { node: GraphNode | TriggerNode; draft: DraftView }) {
  const trigger = draft.trigger;
  const names = [
    ...(Array.isArray(trigger.fields.form_fields) ? (trigger.fields.form_fields as unknown as FormField[]).map((entry) => entry.name).filter(Boolean) : []),
    ...Object.keys(trigger.sample ?? {}),
  ];
  const triggerPaths = [...new Set(names)];
  const others = draft.steps.filter((step) => step.id !== node.id);
  return (
    <div className="help">
      <p>
        Write <code>{'{{path}}'}</code> in any text field. A field that is one whole expression keeps its type; anything else becomes text. An unknown path is empty text.
      </p>
      <ul>
        <li><code>{'{{trigger.<field>}}'}</code>{triggerPaths.length ? ` — ${triggerPaths.map((name) => `trigger.${name}`).join(', ')}` : ''}</li>
        <li><code>{'{{steps.<id>.<path>}}'}</code>{others.length ? ` — ${others.map((step) => `steps.${step.id}`).join(', ')}` : ''}</li>
        <li><code>{'{{loop.item.<path>}}'}</code> and <code>{'{{loop.index}}'}</code> inside a loop body</li>
        <li><code>{'{{run.id}}'}</code></li>
      </ul>
    </div>
  );
}

export function SettingsDialog({ node, draft, tables, canEdit, returnTo, onSave, onClose }: Props) {
  const lock: Lock = { disabled: !canEdit };
  const [open, setOpen] = useState({ settings: true, connections: false, help: false });
  const edges = outgoing(node.kind, node.id, draft.edges);
  const nameOf = (id: string): string => (id === 'trigger' ? draft.trigger.name : draft.steps.find((step) => step.id === id)?.name ?? id);
  return (
    <Modal label={`Step settings: ${node.name}`} onClose={onClose} returnTo={returnTo} className="settings-dialog">
      <div className="modal-head">
        <h2>{KIND_LABEL[node.kind]}</h2>
      </div>
      <div className="field">
        <StepName server={node.name} lock={lock} commit={(value) => onSave({ name: value })} />
      </div>
      <Expander title="Settings" open={open.settings} onToggle={() => setOpen({ ...open, settings: !open.settings })}>
        <KindFields node={node} tables={tables} lock={lock} save={onSave} />
      </Expander>
      <Expander title="Connections" open={open.connections} onToggle={() => setOpen({ ...open, connections: !open.connections })}>
        {edges.length === 0 ? (
          <p className="muted">No outgoing edges.</p>
        ) : (
          <ul className="connections">
            {edges.map((edge) => (
              <li key={edge.id}>
                <span className="mono-label">{edge.port}</span> {`#${edge.order} to ${nameOf(edge.to)}`}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">Ports: {PORTS[node.kind].join(', ')}</p>
      </Expander>
      <Expander title="Template help" open={open.help} onToggle={() => setOpen({ ...open, help: !open.help })}>
        <TemplateHelp node={node} draft={draft} />
      </Expander>
      <div className="modal-foot">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

function StepName({ server, lock, commit }: { server: string; lock: Lock; commit: (value: string) => Promise<boolean> }) {
  const id = useId();
  const field = useSaved(server, commit);
  return (
    <>
      <label htmlFor={id}>Step name</label>
      <input
        id={id}
        type="text"
        data-autofocus
        value={field.value}
        onChange={(event) => field.change(event.target.value)}
        onBlur={() => void field.save()}
        onKeyDown={(event) => event.key === 'Enter' && void field.save()}
        {...describe(lock)}
      />
    </>
  );
}

