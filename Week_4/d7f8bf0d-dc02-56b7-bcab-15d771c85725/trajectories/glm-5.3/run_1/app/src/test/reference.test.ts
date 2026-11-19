import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReferenceContent, buildReferenceContentWithTt1 } from '../server/referenceLayout';
import { checkLayout } from '../shared/geometry';
import { canonicalHash } from '../shared/canonical';
import type { StandardsProfile } from '../shared/domain';

const profile: StandardsProfile = {
  endplate_single_mm: 610,
  endplate_double_mm: 660,
  double_track_offset_mm: 25,
  end_straight_mm: 152,
  min_radius_mm: 1067,
  max_grade_tenths_percent: 20,
  min_frog_number: 6,
  reverse_curve_straight_mm: 305,
  elevation_step_hundredths_mm: 1905,
  display_units: 'in',
};

test('reference layout passes every rule', () => {
  const content = buildReferenceContent();
  const findings = checkLayout(profile, content.modules);
  assert.deepEqual(findings, []);
});

test('each block piece lengths sum to the block length', () => {
  const content = buildReferenceContent();
  for (const block of content.blocks) {
    let sum = 0;
    for (const m of content.modules) {
      for (const p of m.pieces) {
        if (p.block_id === block.id) sum += p.length_mm;
      }
    }
    assert.equal(sum, block.length_mm, `block ${block.number} sums ${sum} vs ${block.length_mm}`);
  }
});

test('canonical hash is stable', () => {
  const a = canonicalHash(buildReferenceContent());
  const b = canonicalHash(buildReferenceContent());
  assert.equal(a, b);
  const c = canonicalHash(buildReferenceContentWithTt1(60));
  assert.notEqual(a, c);
});

test('modules chain west to east with open ends', () => {
  const content = buildReferenceContent();
  assert.equal(content.modules.length, 5);
  const wren = content.modules.find((m) => m.id === 'mod-wren');
  assert.ok(wren);
  assert.ok(wren.open_ends.length >= 2);
});
