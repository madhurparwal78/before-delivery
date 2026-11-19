import { latestVersion, pageText } from '../../shared/copy.js';
import { partLabel, partNameCounts } from '../../shared/glb.js';
import {
  CURRENCIES,
  PHASES,
  PHASE_NAMES,
  type GuideWorking,
  type Part,
  type SessionUser,
} from '../../shared/types.js';
import { attr, escapeText, tag } from './html.js';

export interface EditorView {
  working: GuideWorking;
  viewer: SessionUser;
  owner: boolean;
  coauthors: { id: string; name: string }[];
  storageOut: boolean;
}

/** The toolbar Tab order is the published order; every control stays a Tab stop. */
const TOOLBAR_BUTTONS = [
  'Add step',
  'Undo',
  'Redo',
  'Save version',
  'Versions',
  'Choose a model file',
  'Upload model',
  'Co-authors',
  'Publish',
  'Withdraw',
  'Delete guide',
] as const;

function toolbar(): string {
  const buttons = TOOLBAR_BUTTONS.map((name) => {
    const extra: Record<string, string> = {};
    if (name === 'Versions') extra['aria-expanded'] = 'false';
    return tag(
      'button',
      {
        type: 'button',
        class: 'tool-button',
        'aria-label': name,
        'data-tool': name,
        'aria-disabled': 'false',
        ...extra,
      },
      name,
    );
  }).join('');
  return tag('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Editor tools' }, buttons);
}

function labelsFor(parts: readonly Part[]): Map<string, string> {
  const counts = partNameCounts(parts);
  return new Map(parts.map((part) => [part.id, partLabel(part.name, part.node_path, counts)]));
}

function header(view: EditorView): string {
  const credit =
    view.working.forked_from === null
      ? ''
      : tag(
          'p',
          { class: 'fork-credit' },
          escapeText(
            pageText.forkCredit(
              view.working.forked_from.title,
              view.working.forked_from.author_name,
              view.working.forked_from.version,
            ),
          ),
        );
  return tag(
    'header',
    { class: 'editor-header' },
    tag('h1', {}, escapeText(view.working.title)),
    tag(
      'div',
      { class: 'latest-version', role: 'status', 'aria-label': 'Latest version' },
      escapeText(latestVersion(view.working.latest_version)),
    ),
    tag('ul', { class: 'people-editing', 'aria-label': 'People editing' }, ''),
    tag(
      'p',
      { class: 'guide-total', 'data-figure': 'total-cost' },
      escapeText(view.working.guide_total_text),
    ),
    credit,
    tag('div', { class: 'editor-status', role: 'status', 'aria-label': 'Editor status' }, ''),
    tag('div', { class: 'question-alerts', role: 'status', 'aria-label': 'Question alerts' }, ''),
  );
}

function stagePane(view: EditorView): string {
  const model = view.working.model;
  const bbox = model === null ? '' : `${model.bbox_mm.map((value) => value.toFixed(1)).join(' x ')} mm`;
  return tag(
    'section',
    { class: 'pane stage-pane', id: 'pane-stage', role: 'tabpanel', 'aria-label': 'Stage' },
    tag(
      'div',
      {
        class: 'stage',
        role: 'application',
        'aria-label': 'Model stage',
        tabindex: 0,
        'data-step': view.working.steps.length === 0 ? 0 : 1,
        'data-explode': (view.working.steps[0]?.explode ?? 0).toFixed(3),
        'data-yaw': String(view.working.steps[0]?.camera.yaw ?? 30),
        'data-pitch': String(view.working.steps[0]?.camera.pitch ?? 15),
        'data-zoom': '1.00',
        'data-state': 'loading',
        'data-model': model?.id ?? '',
      },
      '<canvas class="stage-canvas"></canvas><div class="callout-layer"></div>',
    ),
    tag('div', { class: 'stage-status', role: 'status', 'aria-label': 'Stage status' }, ''),
    tag('button', {
      type: 'button',
      class: 'free-look',
      role: 'switch',
      'aria-label': 'Free look',
      'aria-checked': 'false',
    }, 'Free look'),
    tag(
      'label',
      { class: 'cell' },
      'Apart amount',
      tag('input', {
        type: 'range',
        'aria-label': 'Apart amount',
        min: '0',
        max: '1',
        step: '0.001',
        value: (view.working.steps[0]?.explode ?? 0).toFixed(3),
      }),
    ),
    tag('button', { type: 'button', 'aria-label': 'Use this view' }, 'Use this view'),
    tag(
      'label',
      { class: 'cell' },
      'Model scale',
      tag('input', {
        type: 'number',
        'aria-label': 'Model scale',
        'data-field': 'model_scale',
        step: '0.001',
        min: '0.001',
        value: String(model?.scale ?? 1),
      }),
    ),
    tag('p', { class: 'bbox' }, escapeText(bbox)),
    tag('button', { type: 'button', 'aria-label': 'Confirm scale' }, 'Confirm scale'),
  );
}

function guideDetails(view: EditorView): string {
  return tag(
    'div',
    { class: 'guide-details' },
    tag(
      'label',
      { class: 'cell' },
      'Guide title',
      tag('input', {
        type: 'text',
        'aria-label': 'Guide title',
        'data-field': 'title',
        value: view.working.title,
      }),
    ),
    tag(
      'label',
      { class: 'cell' },
      'Currency',
      tag(
        'select',
        { 'aria-label': 'Currency', 'data-field': 'currency' },
        CURRENCIES.map((code) =>
          tag('option', { value: code, selected: code === view.working.currency }, code),
        ).join(''),
      ),
    ),
    tag(
      'label',
      { class: 'cell' },
      'Tags',
      tag('input', {
        type: 'text',
        'aria-label': 'Tags',
        'data-field': 'tags',
        value: view.working.tags.join(', '),
      }),
    ),
    tag(
      'label',
      { class: 'cell' },
      'Visibility',
      tag(
        'select',
        { 'aria-label': 'Visibility', 'data-field': 'visibility' },
        ['public', 'private']
          .map((value) =>
            tag(
              'option',
              { value, selected: value === view.working.visibility },
              value === 'public' ? 'Public' : 'Private',
            ),
          )
          .join(''),
      ),
    ),
  );
}

function stepRows(view: EditorView): string {
  const labels = labelsFor(view.working.parts);
  return view.working.steps
    .map((step) => {
      const focus = new Set(step.focus_parts);
      const calloutText = new Map(step.callouts.map((callout) => [callout.part_id, callout.text]));
      const partChecks = view.working.parts
        .map((part) => {
          const label = labels.get(part.id) ?? part.name;
          const checkbox = tag(
            'label',
            { class: 'cell' },
            tag('input', {
              type: 'checkbox',
              'aria-label': label,
              'data-part': part.id,
              checked: focus.has(part.id),
            }),
            escapeText(label),
          );
          const callout = focus.has(part.id)
            ? tag(
                'label',
                { class: 'cell' },
                `Callout for ${label}`,
                tag('input', {
                  type: 'text',
                  'aria-label': `Callout for ${label}`,
                  'data-callout-part': part.id,
                  value: calloutText.get(part.id) ?? '',
                }),
              )
            : '';
          return checkbox + callout;
        })
        .join('');
      return tag(
        'div',
        { class: 'step-row', role: 'group', 'aria-label': `Step ${step.number}`, 'data-step-id': step.id },
        tag(
          'label',
          { class: 'cell' },
          `Step ${step.number} title`,
          tag('input', {
            type: 'text',
            'aria-label': `Step ${step.number} title`,
            'data-field': `step/${step.id}/title`,
            value: step.title,
          }),
        ),
        tag(
          'label',
          { class: 'cell' },
          `Step ${step.number} text`,
          tag(
            'textarea',
            {
              'aria-label': `Step ${step.number} text`,
              'data-field': `step/${step.id}/text`,
              rows: 4,
            },
            escapeText(step.text),
          ),
        ),
        tag(
          'label',
          { class: 'cell' },
          `Step ${step.number} phase`,
          tag(
            'select',
            { 'aria-label': `Step ${step.number} phase`, 'data-field': `step/${step.id}/phase` },
            PHASES.map((phase) =>
              tag('option', { value: phase, selected: phase === step.phase }, PHASE_NAMES[phase]),
            ).join(''),
          ),
        ),
        tag(
          'button',
          { type: 'button', 'aria-label': `Delete step ${step.number}`, 'data-delete-step': step.id },
          `Delete step ${step.number}`,
        ),
        tag(
          'div',
          { class: 'focus-parts', role: 'group', 'aria-label': 'Parts in this step' },
          partChecks,
        ),
      );
    })
    .join('');
}

function stepsPane(view: EditorView): string {
  return tag(
    'section',
    { class: 'pane steps-pane', id: 'pane-steps', role: 'tabpanel', 'aria-label': 'Steps' },
    guideDetails(view),
    tag('div', { class: 'step-rows' }, stepRows(view)),
  );
}

function partsPane(view: EditorView): string {
  const labels = labelsFor(view.working.parts);
  const treeItems = view.working.parts
    .map((part) =>
      tag(
        'div',
        {
          role: 'treeitem',
          tabindex: -1,
          'aria-label': labels.get(part.id) ?? part.name,
          'data-part': part.id,
          'aria-selected': 'false',
        },
        escapeText(labels.get(part.id) ?? part.name),
      ),
    )
    .join('');
  const unbound = view.working.parts
    .filter((part) => part.unbound)
    .map((part) => tag('li', {}, escapeText(part.name)))
    .join('');
  const stepOptions = [
    tag('option', { value: '' }, 'Not fitted new'),
    ...view.working.steps.map((step) =>
      tag('option', { value: step.id }, `Step ${step.number}`),
    ),
  ].join('');
  const nodeOptions = [
    tag('option', { value: '' }, ''),
    ...view.working.parts
      .filter((part) => part.node_path !== null)
      .map((part) => tag('option', { value: part.node_path ?? '' }, part.node_path ?? '')),
  ].join('');
  return tag(
    'section',
    { class: 'pane parts-pane', id: 'pane-parts', role: 'tabpanel', 'aria-label': 'Parts' },
    tag('div', { role: 'tree', 'aria-label': 'Model parts', class: 'part-tree' }, treeItems),
    tag('ul', { class: 'unbound-parts', 'aria-label': 'Unbound parts' }, unbound),
    tag(
      'div',
      { class: 'part-fields' },
      tag('label', { class: 'cell' }, 'Part name', tag('input', { type: 'text', 'aria-label': 'Part name' })),
      tag(
        'label',
        { class: 'cell' },
        'Apart axis',
        tag(
          'select',
          { 'aria-label': 'Apart axis' },
          ['x', 'y', 'z'].map((axis) => tag('option', { value: axis }, axis.toUpperCase())).join(''),
        ),
      ),
      tag(
        'label',
        { class: 'cell' },
        'Apart distance in millimetres',
        tag('input', { type: 'number', 'aria-label': 'Apart distance in millimetres', step: '1' }),
      ),
      tag(
        'label',
        { class: 'cell' },
        'Quantity',
        tag('input', { type: 'number', 'aria-label': 'Quantity', min: '1', max: '999', step: '1' }),
      ),
      tag('label', { class: 'cell' }, 'Unit price', tag('input', { type: 'text', 'aria-label': 'Unit price' })),
      tag(
        'label',
        { class: 'cell' },
        'Fitted at step',
        tag('select', { 'aria-label': 'Fitted at step' }, stepOptions),
      ),
      tag('button', { type: 'button', 'aria-label': 'Remove part' }, 'Remove part'),
      tag(
        'label',
        { class: 'cell' },
        'Bind to node',
        tag('select', { 'aria-label': 'Bind to node' }, nodeOptions),
      ),
    ),
  );
}

function paneTabs(): string {
  return tag(
    'div',
    { class: 'pane-tabs', role: 'tablist', 'aria-label': 'Editor panes' },
    ...['Stage', 'Steps', 'Parts'].map((name, index) =>
      tag(
        'button',
        {
          type: 'button',
          role: 'tab',
          'aria-label': name,
          'aria-selected': index === 0 ? 'true' : 'false',
          tabindex: index === 0 ? 0 : -1,
          'aria-controls': `pane-${name.toLowerCase()}`,
          'data-pane': name.toLowerCase(),
        },
        name,
      ),
    ),
  );
}

function versionsRegion(): string {
  return `${tag(
    'section',
    { class: 'versions', role: 'region', 'aria-label': 'Versions', hidden: true },
    tag('div', { class: 'version-list' }, ''),
    tag('button', { type: 'button', 'aria-label': 'Compare', 'aria-disabled': 'true' }, 'Compare'),
    tag('button', { type: 'button', 'aria-label': 'Load more versions' }, 'Load more versions'),
  )}${tag(
    'section',
    { class: 'version-compare', role: 'region', 'aria-label': 'Version compare', hidden: true },
    '',
  )}`;
}

function editorDialogs(view: EditorView): string {
  const coauthorRows = view.coauthors
    .map((person) =>
      tag(
        'button',
        { type: 'button', 'aria-label': `Remove ${person.name}`, 'data-remove-coauthor': person.id },
        `Remove ${person.name}`,
      ),
    )
    .join('');
  return `${tag(
    'div',
    { class: 'dialog', role: 'alertdialog', 'aria-label': 'Edit conflict', 'aria-modal': 'true', hidden: true },
    tag('p', { class: 'conflict-message' }, ''),
    tag('h3', {}, 'Yours'),
    tag('p', { class: 'conflict-yours' }, ''),
    tag('h3', {}, 'Theirs'),
    tag('p', { class: 'conflict-theirs' }, ''),
    tag('button', { type: 'button', 'data-action': 'keep-mine' }, 'Keep mine'),
    tag('button', { type: 'button', 'data-action': 'take-theirs' }, 'Take theirs'),
  )}${tag(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-label': 'Co-authors', 'aria-modal': 'true', hidden: true },
    tag(
      'label',
      { class: 'cell' },
      'Co-author email',
      tag('input', { type: 'email', 'aria-label': 'Co-author email' }),
    ),
    tag('button', { type: 'button', 'data-action': 'add-coauthor' }, 'Add co-author'),
    tag('div', { class: 'coauthor-rows' }, coauthorRows),
    tag('button', { type: 'button', 'data-action': 'cancel' }, 'Close'),
  )}${tag(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-label': 'Delete guide', 'aria-modal': 'true', hidden: true },
    tag('button', { type: 'button', 'data-action': 'confirm-delete' }, 'Delete'),
    tag('button', { type: 'button', 'data-action': 'cancel' }, 'Cancel'),
  )}${tag(
    'div',
    { class: 'dialog restore-dialog', role: 'dialog', 'aria-label': 'Restore version', 'aria-modal': 'true', hidden: true },
    tag('button', { type: 'button', 'data-action': 'confirm-restore' }, 'Restore'),
    tag('button', { type: 'button', 'data-action': 'cancel' }, 'Cancel'),
  )}`;
}

export function renderEditorBody(view: EditorView): string {
  return `<main class="editor" data-guide="${attr(view.working.id)}">
${header(view)}
${toolbar()}
${paneTabs()}
<div class="panes">
${stagePane(view)}
${tag('div', {
    class: 'pane-separator',
    role: 'separator',
    'aria-label': 'Resize stage and steps',
    tabindex: 0,
    'aria-valuenow': 50,
    'aria-valuemin': 30,
    'aria-valuemax': 70,
    'aria-orientation': 'vertical',
  })}
${stepsPane(view)}
${partsPane(view)}
</div>
${versionsRegion()}
${editorDialogs(view)}
<input type="file" class="model-file" accept=".glb,model/gltf-binary" tabindex="-1" aria-hidden="true">
</main>`;
}
