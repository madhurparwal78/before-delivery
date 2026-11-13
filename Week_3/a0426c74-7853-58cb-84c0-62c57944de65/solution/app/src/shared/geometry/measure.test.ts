import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as copy from '../copy.ts';
import type { Entity, Xref } from '../types.ts';
import { arc, assertClose, block, circle, dimension, drawing, hatch, insert, layer, line, pline } from './fixtures.ts';
import { areaOf, distReport, entityLabel, xrefRow, lengthOf, propertyText } from './measure.ts';
import { buildScene } from './scene.ts';

describe('entity list labels', () => {
  const entities: Entity[] = [
    line('L1', 0, 0, 10, 0, 'Walls'), circle('C2', 5, 5, 2, 'Walls'), arc('A3', 0, 0, 5, 0, 90, 'Walls'),
    pline('P4', [[0, 20], [3, 20], [3, 24]], false), pline('P5', [[20, 0], [24, 0], [24, 3], [20, 3]], true),
    { ...hatch('H6', 21, 1), area: 12 },
    dimension('D7', 'linear', [{ handle: 'L1', point: 'start' }, { handle: 'L1', point: 'end' }], 5, -3, 10),
    insert('I8', 'Door', 5000, 5000, 2, 90),
  ];
  const scene = buildScene(drawing(entities, { layers: { 0: layer('0'), Walls: layer('Walls', 'red') }, blocks: { Door: block('Door', [line('L50', 0, 0, 1, 0)]) } }));
  const label = (id: string): string => entityLabel(scene, scene.byId.get(id)!);

  it('reads every type as the brief prints it', () => {
    assert.equal(label('L1'), 'Line L1, layer Walls, from 0,0 to 10,0, length 10');
    assert.equal(label('C2'), 'Circle C2, layer Walls, centre 5,5, radius 2, area 12.566');
    assert.equal(label('A3'), 'Arc A3, layer Walls, centre 0,0, radius 5, from 0 to 90 degrees, length 7.854');
    assert.equal(label('P4'), 'Polyline P4, layer 0, 3 points, open, length 7');
    assert.equal(label('P5'), 'Polyline P5, layer 0, 4 points, closed, length 14, area 12');
    assert.equal(label('H6'), 'Hatch H6, layer 0, area 12');
    assert.equal(label('D7'), 'Dimension D7, layer 0, linear, value 10.00');
    assert.equal(label('I8'), 'Block I8, layer 0, Door at 5000,5000, scale 2, rotation 90');
  });

  it('uses 3 decimals trimmed and prints -0 as 0', () => {
    const s = buildScene(drawing([line('L1', -0.0001, 0.12345, 1.5, 2, 'Walls')], { layers: { 0: layer('0'), Walls: layer('Walls') } }));
    assert.equal(entityLabel(s, s.byId.get('L1')!), 'Line L1, layer Walls, from 0,0.123 to 1.5,2, length 2.402');
  });

  it('reads an xref entity by its full id and xref layer', () => {
    const site: Xref = { name: 'Site', source: 's', x: 0, y: 0, scale: 1, rotation: 0, clip: null, version_id: null, model: { layers: [layer('Walls')], entities: [line('L1', 0, 0, 10, 0, 'Walls')], blocks: [], xrefs: [] } };
    const s = buildScene(drawing([], { xrefs: { Site: site } }));
    assert.equal(entityLabel(s, s.byId.get('Site|L1')!), 'Line Site|L1, layer Site|Walls, from 0,0 to 10,0, length 10');
  });

  it('reads a dimension value at the style precision', () => {
    const s = buildScene(drawing([dimension('D1', 'aligned', [], 0, 0, 13.60115)], { dim_styles: { Standard: { name: 'Standard', precision: 3, prefix: '', suffix: '', scale: 1, text_height_mm: 2.5 } } }));
    assert.equal(entityLabel(s, s.byId.get('D1')!), 'Dimension D1, layer 0, aligned, value 13.601');
  });
});

describe('lengths and areas', () => {
  it('measures a closed polyline with its closing segment and an arc by its sweep', () => {
    assert.equal(lengthOf(pline('P', [[0, 0], [4, 0], [4, 3]], true)), 12);
    assert.equal(lengthOf(pline('P', [[0, 0], [4, 0], [4, 3]], false)), 7);
    assertClose(lengthOf(arc('A', 0, 0, 5, 0, 90))!, 7.853982, 1e-6);
    assertClose(lengthOf(arc('A', 0, 0, 1, 270, 90))!, Math.PI, 1e-9);
    assert.equal(lengthOf(circle('C', 0, 0, 1)), null);
  });

  it('measures circle and shoelace areas, whichever way the polygon turns', () => {
    assertClose(areaOf(circle('C', 5, 5, 2))!, 12.566371, 1e-6);
    assert.equal(areaOf(pline('P', [[0, 0], [4, 0], [4, 3], [0, 3]], true)), 12);
    assert.equal(areaOf(pline('P', [[0, 0], [0, 3], [4, 3], [4, 0]], true)), 12);
    assert.equal(areaOf(pline('P', [[0, 0], [4, 0]], false)), null);
    assert.equal(areaOf({ ...hatch('H', 0, 0), area: 7.5 }), 7.5);
  });
});

describe('Properties values', () => {
  it('shows one value, or *VARIES* where the selection differs', () => {
    assert.equal(propertyText([line('L1', 0, 0, 10, 0)], 'length'), '10');
    assert.equal(propertyText([line('L1', 0, 0, 10, 0), line('L3', 20, 0, 35, 0)], 'length'), copy.VARIES);
    assert.equal(propertyText([line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 5)], 'length'), '10');
    assert.equal(propertyText([circle('C1', 0, 0, 1)], 'area'), '3.142');
    assert.equal(propertyText([circle('C1', 0, 0, 1), line('L1', 0, 0, 1, 0)], 'area'), copy.VARIES);
  });

  it('shows nothing when no selected entity has the property', () => {
    assert.equal(propertyText([line('L1', 0, 0, 10, 0)], 'area'), null);
    assert.equal(propertyText([], 'length'), null);
  });
});

describe('DIST report', () => {
  it('says the distance and the direction angle in the published format', () => {
    assert.equal(distReport([0, 0], [3, 4]), copy.distResult('5', '53.13'));
    assert.equal(distReport([0, 0], [0, -5]), copy.distResult('5', '270'));
  });
});

describe('Xrefs panel row', () => {
  const xref: Xref = { name: 'Site', source: 'd2', x: 10, y: 0.5, scale: 1, rotation: 90, clip: null, version_id: null, model: { layers: [], entities: [], blocks: [], xrefs: [] } };

  it('says the placement and, when clipped, the clip rectangle', () => {
    assert.deepEqual(xrefRow(xref, 'Site plan'), { placement: copy.xrefPlacement('Site plan', '10', '0.5', '1', '90'), clip: null });
    assert.equal(xrefRow({ ...xref, clip: [0, 0, 5, 2.25] }, 'Site plan').clip, copy.xrefClip('0,0,5,2.25'));
  });
});
