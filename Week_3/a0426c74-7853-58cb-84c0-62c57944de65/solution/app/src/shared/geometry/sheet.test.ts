import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Sheet, Viewport } from '../types.ts';
import { assertClose, assertPoint, dimension, drawing, layer, line } from './fixtures.ts';
import { PAPER_SIZES, paperPoint, sheetNode, sheetSvg, titleBlockFields, viewportScaleDenominator } from './sheet.ts';
import { buildScene } from './scene.ts';
import type { SvgNode } from './render.ts';

const viewport = (id: string, scale: string, x: number, width: number, viewX: number, viewY: number, frozen: string[] = []): Viewport =>
  ({ id, sheet_id: 's1', x, y: 10, width, height: 100, scale, view_x: viewX, view_y: viewY, frozen_layers: frozen });
const sheet = (viewports: Viewport[], attributes: Record<string, string> = {}): Sheet =>
  ({ id: 's1', drawing_id: 'd1', name: 'Stage layout', size: 'A3', number: 1, locked: false, locked_by: null, creator: 'asha', attributes, viewports });
const find = (node: SvgNode, predicate: (n: SvgNode) => boolean): SvgNode[] => [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap((child) => find(child, predicate))];

describe('paper mapping', () => {
  it('maps a world point to paper: 1:50 and 1:20 examples', () => {
    assert.equal(viewportScaleDenominator('1:50'), 50);
    assertPoint(paperPoint(viewport('v1', '1:50', 10, 200, 0, 0), [1000, 500]), [130, 50]);
    assertPoint(paperPoint(viewport('v2', '1:20', 220, 180, 1000, 450), [1000, 400]), [310, 62.5]);
  });

  it('puts the view centre at the middle of the viewport rectangle and counts world Y upwards', () => {
    assertPoint(paperPoint(viewport('v', '1:10', 0, 100, 5, 5), [5, 5]), [50, 60]);
    assertPoint(paperPoint(viewport('v', '1:10', 0, 100, 5, 5), [15, 15]), [51, 59]);
  });

  it('knows the paper sizes in millimetres', () => {
    assert.deepEqual(PAPER_SIZES.A3, { width: 420, height: 297 });
    assert.deepEqual(PAPER_SIZES.A4, { width: 297, height: 210 });
  });
});

describe('title block', () => {
  it('fills Sheet no, Title, Drawn by and Scale itself', () => {
    const fields = titleBlockFields(sheet([viewport('v1', '1:50', 10, 200, 0, 0)], { Project: 'Larch Row' }));
    assert.deepEqual(fields.map((f) => [f.tag, f.value, f.editable]), [
      ['Sheet no', '1', false], ['Title', 'Stage layout', false], ['Drawn by', 'asha', false], ['Scale', '1:50', false],
      ['Project', 'Larch Row', true], ['Checked by', '', true],
    ]);
  });

  it('reads Varies when the viewports differ and nothing when there are none', () => {
    const scale = (viewports: Viewport[]) => titleBlockFields(sheet(viewports)).find((f) => f.tag === 'Scale')!.value;
    assert.equal(scale([viewport('v1', '1:50', 10, 200, 0, 0), viewport('v2', '1:20', 220, 180, 0, 0)]), 'Varies');
    assert.equal(scale([viewport('v1', '1:50', 10, 200, 0, 0), viewport('v2', '1:50', 220, 180, 0, 0)]), '1:50');
    assert.equal(scale([]), '');
  });

  it('lists other tags after the built-in ones', () => {
    const fields = titleBlockFields(sheet([], { Revision: 'B' }));
    assert.deepEqual(fields.slice(-1).map((f) => [f.tag, f.value, f.editable]), [['Revision', 'B', true]]);
  });
});

describe('sheet drawing', () => {
  const model = drawing([
    line('L1', 1000, 500, 1010, 500), line('L2', 1000, 400, 1010, 400, 'Walls'),
    dimension('D3', 'aligned', [{ handle: 'L1', point: 'start' }, { handle: 'L1', point: 'end' }], 1005, 502, 10),
  ], { layers: { 0: layer('0'), Walls: layer('Walls') } });
  const stage = sheet([viewport('v1', '1:50', 10, 200, 0, 0, ['Walls']), viewport('v2', '1:20', 220, 180, 1000, 450)], { Project: 'Larch Row' });
  const root = sheetNode(stage, buildScene(model));
  const group = (scale: string): SvgNode => find(root, (n) => n.attrs['data-scale'] === scale)[0];
  const inside = (scale: string, id: string): SvgNode[] => find(group(scale), (n) => n.attrs['data-entity-id'] === id);

  it('draws one viewport group per viewport with its scale and view centre', () => {
    assert.equal(find(root, (n) => n.attrs['data-scale'] !== undefined).length, 2);
    assert.deepEqual([group('1:20').attrs['data-view-x'], group('1:20').attrs['data-view-y']], ['1000', '450']);
    assert.deepEqual([root.attrs['viewBox'], root.attrs['width'], root.attrs['height']], ['0 0 420 297', '420', '297']);
  });

  it('gives every viewport its own copy of each entity at its paper position', () => {
    const [one] = inside('1:50', 'L1');
    assert.deepEqual([one!.attrs['data-paper-x'], one!.attrs['data-paper-y']], ['130', '50']);
    const [two] = inside('1:20', 'L2');
    assert.deepEqual([two!.attrs['data-paper-x'], two!.attrs['data-paper-y']], ['310', '62.5']);
  });

  it('hides a layer frozen in one viewport only', () => {
    assert.equal(inside('1:50', 'L2').length, 0);
    assert.equal(inside('1:20', 'L2').length, 1);
  });

  it('puts the annotation text heights on the dimension text in each viewport', () => {
    const texts = find(group('1:50'), (n) => n.attrs['data-text-height-mm'] !== undefined);
    assert.equal(texts.length, 1);
    assert.deepEqual([texts[0].attrs['data-text-height-mm'], texts[0].attrs['data-world-text-height']], ['2.5', '125']);
    assertClose(Number(find(group('1:20'), (n) => n.attrs['data-text-height-mm'] !== undefined)[0].attrs['data-world-text-height']), 50);
  });

  it('scales the viewport content by 1/n about the view centre with Y flipped', () => {
    const content = group('1:50').children![1];
    assert.equal(content.attrs['transform'], 'matrix(0.02 0 0 -0.02 110 60)');
  });

  it('shows the title block values as text', () => {
    const values = find(root, (n) => n.tag === 'text' && n.attrs['data-title-value'] !== undefined).map((n) => n.text);
    assert.deepEqual(values, ['1', 'Stage layout', 'asha', 'Varies', 'Larch Row', '']);
  });

  it('serialises to a standalone svg file', () => {
    const svg = sheetSvg(stage, buildScene(model));
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(svg.includes('width="420mm" height="297mm"'));
    assert.ok(svg.includes('data-scale="1:50"') && svg.includes('data-entity-id="L1"'));
    assert.ok(sheetSvg({ ...stage, size: 'A4', viewports: [] }, buildScene(drawing([]))).includes('viewBox="0 0 297 210"'));
  });
});
