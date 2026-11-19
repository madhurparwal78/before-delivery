import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DashboardAction, ParameterDef } from '../../../shared/model.ts';
import type { MarkInfo } from '../../chart/props.ts';
import { ACTION_WORDS, planSelection, selectionCopy } from './selection.ts';

const east: MarkInfo = {
  id: 'East',
  index: 0,
  dims: ['East'],
  dimensions: ['Region'],
  values: ['East'],
  tooltip: 'Region: East; Sales: 435',
};

function action(name: string, type: DashboardAction['type'], targets: string[], extra: Partial<DashboardAction> = {}): DashboardAction {
  return { name, type, source: 'regions', targets, field: 'Region', parameter: null, set: null, ...extra };
}

const picked: ParameterDef = { id: 'p1', name: 'Picked', type: 'text', value: 'West', values: [] };

test('actions run set parameter, change set, filter, highlight, alphabetically within a type', () => {
  const selection = planSelection(
    [
      action('Glow', 'highlight', ['mix']),
      action('B filter', 'filter', ['categories']),
      action('Swap set', 'change_set', ['mix'], { set: 'Chosen' }),
      action('A filter', 'filter', ['categories']),
      action('Pick region', 'set_parameter', ['categories'], { parameter: 'Picked' }),
      action('Elsewhere', 'filter', ['mix'], { source: 'other' }),
    ],
    'regions',
    east,
    [picked],
  );
  assert.deepEqual(selection.log, [
    `1. ${ACTION_WORDS.set_parameter}: Pick region`,
    `2. ${ACTION_WORDS.change_set}: Swap set`,
    `3. ${ACTION_WORDS.filter}: A filter`,
    `4. ${ACTION_WORDS.filter}: B filter`,
    `5. ${ACTION_WORDS.highlight}: Glow`,
  ]);
  assert.deepEqual(selection.parameters, { Picked: 'East' });
  assert.deepEqual(selection.sets, { Chosen: ['East'] });
  assert.deepEqual(selection.targets, ['categories', 'mix']);
  assert.equal(selection.filters['categories']?.length, 2);
  assert.deepEqual(selection.highlights['mix'], [{ field: 'Region', value: 'East' }]);
});

test('the announcement names the first effect that ran and counts the target sheets', () => {
  const filtered = planSelection([action('Narrow', 'filter', ['a', 'b', 'c'])], 'regions', east, []);
  assert.equal(selectionCopy(filtered, filtered.targets.length), 'Filtered to East: 3 sheets updated');
  const lit = planSelection([action('Glow', 'highlight', ['a'])], 'regions', east, []);
  assert.equal(selectionCopy(lit, lit.targets.length), 'Highlighted East: 1 sheets updated');
  const plain = planSelection([action('Pick', 'set_parameter', ['a'], { parameter: 'Picked' })], 'regions', east, [picked]);
  assert.equal(selectionCopy(plain, plain.targets.length), 'Selected East: 1 sheets updated');
  assert.equal(selectionCopy(null, 3), 'Selection cleared: 3 sheets updated');
});

test('a number parameter takes the mark value as a number and a null mark sets nothing', () => {
  const count: ParameterDef = { id: 'p2', name: 'Top count', type: 'number', value: 2, values: [] };
  const year: MarkInfo = { ...east, dims: ['2027'], dimensions: ['Year'], values: ['2027'] };
  const set = planSelection([action('Pick', 'set_parameter', [], { field: 'Year', parameter: 'Top count' })], 'regions', year, [count]);
  assert.deepEqual(set.parameters, { 'Top count': 2027 });
  const empty: MarkInfo = { ...east, values: [null] };
  assert.deepEqual(planSelection([action('Pick', 'set_parameter', [], { parameter: 'Picked' })], 'regions', empty, [picked]).log, []);
});
