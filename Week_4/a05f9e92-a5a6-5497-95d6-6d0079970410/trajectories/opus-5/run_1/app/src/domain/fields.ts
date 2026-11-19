/**
 * The field catalogue. Field order here is table order, which decides which
 * missing field a transition reports first.
 */

export type TableName = 'incident' | 'problem' | 'change' | 'request_item' | 'task';

export const tableNames: readonly TableName[] = ['incident', 'problem', 'change', 'request_item', 'task'];

export type FieldType = 'string' | 'text' | 'number' | 'choice' | 'boolean' | 'reference' | 'time' | 'object';

export type ReferenceTarget = 'user' | 'ci' | 'group' | 'record' | 'catalog_item';

export interface Choice {
  readonly value: string;
  readonly label: string;
}

export interface FieldSpec {
  readonly name: string;
  readonly label: string;
  readonly type: FieldType;
  readonly target?: ReferenceTarget;
  readonly choices?: readonly Choice[];
  /** Never written through the record endpoints. */
  readonly derived?: boolean;
  readonly maxLength?: number;
  readonly default?: string | number | boolean | null;
}

export const typeLabels: Readonly<Record<TableName, string>> = {
  incident: 'Incident',
  problem: 'Problem',
  change: 'Change',
  request_item: 'Request item',
  task: 'Task',
};

/** `<type>` in transition messages. */
export const typeWords: Readonly<Record<TableName, string>> = {
  incident: 'incident',
  problem: 'problem',
  change: 'change',
  request_item: 'request item',
  task: 'task',
};

export const tableLabels: Readonly<Record<TableName, string>> = {
  incident: 'Incident',
  problem: 'Problem',
  change: 'Change',
  request_item: 'Request item',
  task: 'Task',
};

const impactChoices: readonly Choice[] = [
  { value: '1', label: '1 High' },
  { value: '2', label: '2 Medium' },
  { value: '3', label: '3 Low' },
];

export const priorityLabels: Readonly<Record<number, string>> = {
  1: 'Critical',
  2: 'High',
  3: 'Moderate',
  4: 'Low',
  5: 'Planning',
};

export const holdReasonChoices: readonly Choice[] = [
  { value: 'awaiting_requester', label: 'Awaiting requester' },
  { value: 'awaiting_supplier', label: 'Awaiting supplier' },
  { value: 'awaiting_change', label: 'Awaiting change' },
];

export const resolutionCodeChoices: readonly Choice[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'workaround_given', label: 'Workaround given' },
  { value: 'no_fault_found', label: 'No fault found' },
  { value: 'duplicate', label: 'Duplicate' },
];

const incidentFields: readonly FieldSpec[] = [
  { name: 'short_description', label: 'Short description', type: 'string', maxLength: 160 },
  { name: 'description', label: 'Description', type: 'text' },
  { name: 'caller', label: 'Caller', type: 'reference', target: 'user' },
  { name: 'affected_person', label: 'Affected person', type: 'reference', target: 'user' },
  { name: 'configuration_item', label: 'Service or item', type: 'reference', target: 'ci' },
  { name: 'impact', label: 'Impact', type: 'choice', choices: impactChoices, default: 3 },
  { name: 'urgency', label: 'Urgency', type: 'choice', choices: impactChoices, default: 3 },
  { name: 'priority', label: 'Priority', type: 'number', derived: true },
  { name: 'assignment_group', label: 'Assignment group', type: 'reference', target: 'group' },
  { name: 'assigned_to', label: 'Assigned to', type: 'reference', target: 'user' },
  { name: 'hold_reason', label: 'Hold reason', type: 'choice', choices: holdReasonChoices },
  { name: 'resolution_code', label: 'Resolution code', type: 'choice', choices: resolutionCodeChoices },
  { name: 'resolution_note', label: 'Resolution note', type: 'text' },
  { name: 'reopen_reason', label: 'Reopen reason', type: 'text' },
  { name: 'cancel_reason', label: 'Cancel reason', type: 'text' },
  { name: 'confidential', label: 'Confidential', type: 'boolean', default: false },
  { name: 'is_major', label: 'Major incident', type: 'boolean', default: false },
  { name: 'parent', label: 'Parent', type: 'reference', target: 'record' },
  { name: 'problem', label: 'Problem', type: 'reference', target: 'record' },
  { name: 'sla_breached', label: 'SLA breached', type: 'boolean', derived: true, default: false },
  { name: 'created_at', label: 'Created', type: 'time', derived: true },
  { name: 'resolved_at', label: 'Resolved', type: 'time', derived: true },
];

const problemFields: readonly FieldSpec[] = [
  { name: 'short_description', label: 'Short description', type: 'string', maxLength: 160 },
  { name: 'description', label: 'Description', type: 'text' },
  { name: 'configuration_item', label: 'Service or item', type: 'reference', target: 'ci' },
  { name: 'impact', label: 'Impact', type: 'choice', choices: impactChoices, default: 2 },
  { name: 'urgency', label: 'Urgency', type: 'choice', choices: impactChoices, default: 2 },
  { name: 'priority', label: 'Priority', type: 'number', derived: true },
  { name: 'assignment_group', label: 'Assignment group', type: 'reference', target: 'group' },
  { name: 'assigned_to', label: 'Assigned to', type: 'reference', target: 'user' },
  { name: 'workaround', label: 'Workaround', type: 'text' },
  { name: 'fix_change', label: 'Fix change', type: 'reference', target: 'record' },
  { name: 'cancel_reason', label: 'Cancel reason', type: 'text' },
  { name: 'created_at', label: 'Created', type: 'time', derived: true },
  { name: 'resolved_at', label: 'Resolved', type: 'time', derived: true },
];

export const changeModelChoices: readonly Choice[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'standard', label: 'Standard' },
  { value: 'emergency', label: 'Emergency' },
];

export const changeOutcomeChoices: readonly Choice[] = [
  { value: 'successful', label: 'Successful' },
  { value: 'failed', label: 'Failed' },
  { value: 'backed_out', label: 'Backed out' },
];

const changeFields: readonly FieldSpec[] = [
  { name: 'title', label: 'Title', type: 'string', maxLength: 160 },
  { name: 'model', label: 'Model', type: 'choice', choices: changeModelChoices, default: 'normal' },
  { name: 'configuration_item', label: 'Configuration item', type: 'reference', target: 'ci' },
  { name: 'planned_start', label: 'Planned start', type: 'time' },
  { name: 'planned_end', label: 'Planned end', type: 'time' },
  { name: 'implementation_plan', label: 'Implementation plan', type: 'text' },
  { name: 'backout_plan', label: 'Backout plan', type: 'text' },
  { name: 'backout_tested', label: 'Backout tested', type: 'boolean', default: false },
  { name: 'standard_template', label: 'Standard template', type: 'string' },
  { name: 'freeze_override_reason', label: 'Freeze override reason', type: 'text' },
  { name: 'outcome', label: 'Outcome', type: 'choice', choices: changeOutcomeChoices },
  { name: 'close_note', label: 'Close note', type: 'text' },
  { name: 'cancel_reason', label: 'Cancel reason', type: 'text' },
  { name: 'priority', label: 'Priority', type: 'number', derived: true, default: 5 },
  { name: 'created_at', label: 'Created', type: 'time', derived: true },
];

const requestItemFields: readonly FieldSpec[] = [
  { name: 'short_description', label: 'Short description', type: 'string', derived: true },
  { name: 'request', label: 'Request', type: 'reference', target: 'record' },
  { name: 'item', label: 'Catalog item', type: 'reference', target: 'catalog_item' },
  { name: 'quantity', label: 'Quantity', type: 'number', default: 1 },
  { name: 'variables', label: 'Variables', type: 'object' },
  { name: 'requested_for', label: 'Requested for', type: 'reference', target: 'user' },
  { name: 'impact', label: 'Impact', type: 'choice', choices: impactChoices, default: 3 },
  { name: 'urgency', label: 'Urgency', type: 'choice', choices: impactChoices, default: 2 },
  { name: 'priority', label: 'Priority', type: 'number', derived: true },
  { name: 'assignment_group', label: 'Assignment group', type: 'reference', target: 'group' },
  { name: 'assigned_to', label: 'Assigned to', type: 'reference', target: 'user' },
  { name: 'cancel_reason', label: 'Cancel reason', type: 'text' },
  { name: 'created_at', label: 'Created', type: 'time', derived: true },
];

const taskFields: readonly FieldSpec[] = [
  { name: 'short_description', label: 'Short description', type: 'string', maxLength: 160 },
  { name: 'description', label: 'Description', type: 'text' },
  { name: 'parent', label: 'Parent', type: 'reference', target: 'record' },
  { name: 'assignment_group', label: 'Assignment group', type: 'reference', target: 'group' },
  { name: 'assigned_to', label: 'Assigned to', type: 'reference', target: 'user' },
  { name: 'close_note', label: 'Close note', type: 'text' },
  { name: 'cancel_reason', label: 'Cancel reason', type: 'text' },
  { name: 'priority', label: 'Priority', type: 'number', derived: true, default: 4 },
  { name: 'created_at', label: 'Created', type: 'time', derived: true },
];

export const tableFields: Readonly<Record<TableName, readonly FieldSpec[]>> = {
  incident: incidentFields,
  problem: problemFields,
  change: changeFields,
  request_item: requestItemFields,
  task: taskFields,
};

const specIndex: Record<TableName, Map<string, FieldSpec>> = {
  incident: new Map(incidentFields.map((f) => [f.name, f])),
  problem: new Map(problemFields.map((f) => [f.name, f])),
  change: new Map(changeFields.map((f) => [f.name, f])),
  request_item: new Map(requestItemFields.map((f) => [f.name, f])),
  task: new Map(taskFields.map((f) => [f.name, f])),
};

/** `state` and `number` are readable everywhere a field is. */
export const stateField: FieldSpec = { name: 'state', label: 'State', type: 'string', derived: true };
export const numberField: FieldSpec = { name: 'number', label: 'Number', type: 'string', derived: true };

export function fieldSpec(table: TableName, name: string): FieldSpec | undefined {
  if (name === 'state') return stateField;
  if (name === 'number') return numberField;
  return specIndex[table].get(name);
}

export function hasField(table: TableName, name: string): boolean {
  return fieldSpec(table, name) !== undefined;
}

/** A field's label, falling back to the field name in sentence case with spaces. */
export function fieldLabel(table: TableName, name: string): string {
  const spec = fieldSpec(table, name);
  if (spec) return spec.label;
  return sentenceCase(name);
}

export function sentenceCase(name: string): string {
  const words = name.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function isTimeField(table: TableName, name: string): boolean {
  return fieldSpec(table, name)?.type === 'time';
}

export function choiceLabel(table: TableName, name: string, value: unknown): string | null {
  const spec = fieldSpec(table, name);
  if (!spec?.choices) return null;
  const found = spec.choices.find((c) => c.value === String(value));
  return found ? found.label : null;
}

/** Fields a requester may read on their own records, per the baseline grant. */
export const requesterReadableFields: readonly string[] = [
  'number',
  'state',
  'short_description',
  'description',
  'priority',
  'caller',
  'created_at',
  'resolved_at',
  'request',
  'item',
  'quantity',
  'variables',
  'requested_for',
  'resolution_code',
  'resolution_note',
  'reopen_reason',
  'cancel_reason',
  'parent',
];
