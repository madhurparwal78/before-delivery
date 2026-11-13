import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Entity, Layer } from '../types.ts';
import { arc, block, circle, dimension, drawing, hatch, insert, layer, line, pline } from './fixtures.ts';
import { colourHex, modelSvg, renderDefs, renderEntity, serializeSvg, strokePx, type SvgNode } from './render.ts';
import { buildScene } from './scene.ts';

const render = (entities: Entity[], id: string, extra: Parameters<typeof drawing>[1] = {}, options: Parameters<typeof renderEntity>[2] = {}): SvgNode => {
  const scene = buildScene(drawing(entities, extra));
  return renderEntity(scene, scene.byId.get(id)!, options);
};
const find = (node: SvgNode, predicate: (n: SvgNode) => boolean): SvgNode[] => [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap((child) => find(child, predicate))];

describe('entity elements', () => {
  it('carries the data attributes of a line with the effective look', () => {
    const node = render([line('L1', 0, 0, 10, 0, 'Walls')], 'L1', { layers: { 0: layer('0'), Walls: layer('Walls', 'red', { lineweight: 0.5 }) } });
    assert.equal(node.tag, 'line');
    assert.deepEqual(
      ['data-entity-id', 'data-type', 'data-layer', 'data-x1', 'data-y1', 'data-x2', 'data-y2', 'data-colour', 'data-linetype', 'data-lineweight'].map((k) => node.attrs[k]),
      ['L1', 'line', 'Walls', '0', '0', '10', '0', 'red', 'Continuous', '0.5'],
    );
    assert.equal(node.attrs['stroke'], colourHex('red'));
    assert.equal(node.attrs['stroke-width'], String(strokePx(0.5)));
    assert.equal(node.attrs['vector-effect'], 'non-scaling-stroke');
  });

  it('renders white in the ink colour on the dark ground', () => {
    assert.equal(colourHex('white'), '#ebe6da');
    assert.notEqual(colourHex('red'), colourHex('white'));
  });

  it('prints circle, arc and polyline geometry', () => {
    const c = render([circle('C2', 5, 5, 2)], 'C2');
    assert.deepEqual([c.attrs['data-cx'], c.attrs['data-cy'], c.attrs['data-r']], ['5', '5', '2']);
    const a = render([arc('A3', 0, 0, 5, 0, 90)], 'A3');
    assert.deepEqual([a.attrs['data-start'], a.attrs['data-end']], ['0', '90']);
    assert.equal(a.attrs['d'], 'M 5 0 A 5 5 0 0 1 0 5');
    const p = render([pline('P4', [[0, 20], [3, 20], [3, 24]], false)], 'P4');
    assert.deepEqual([p.attrs['data-points'], p.attrs['data-closed']], ['0,20 3,20 3,24', 'false']);
    assert.equal(render([pline('P5', [[0, 0], [1, 0], [1, 1]], true)], 'P5').tag, 'polygon');
  });

  it('marks a selected entity and a diff state', () => {
    const node = render([line('L1', 0, 0, 1, 0)], 'L1', {}, { selected: true, diff: 'removed' });
    assert.equal(node.attrs['aria-selected'], 'true');
    assert.equal(node.attrs['data-diff'], 'removed');
    assert.ok(node.attrs['stroke-dasharray'] !== undefined);
    assert.equal(render([line('L1', 0, 0, 1, 0)], 'L1', {}, { diff: 'changed' }).attrs['stroke-width'], String(strokePx(0.25) * 1.6));
  });

  it('draws linetype dashes', () => {
    const dashed = render([line('L1', 0, 0, 1, 0, '0', { linetype: 'Dashed' })], 'L1');
    assert.equal(dashed.attrs['stroke-dasharray'], '9 4.5');
    assert.equal(render([line('L1', 0, 0, 1, 0)], 'L1').attrs['stroke-dasharray'], undefined);
  });

  it('expands a block insert with its transform and ByBlock colour', () => {
    const state = { layers: { 0: layer('0'), Doors: layer('Doors', 'green') } as Record<string, Layer>, blocks: { Door: block('Door', [line('L50', 0, 0, 1, 0, '0', { colour: 'ByBlock' })]) } };
    const node = render([insert('I8', 'Door', 5000, 5000, 2, 90, {}, 'Doors')], 'I8', state);
    assert.deepEqual([node.attrs['data-block'], node.attrs['data-x'], node.attrs['data-scale'], node.attrs['data-rotation'], node.attrs['data-colour']], ['Door', '5000', '2', '90', 'green']);
    const child = node.children![0];
    assert.deepEqual([child.attrs['x1'], child.attrs['y1'], child.attrs['x2'], child.attrs['y2'], child.attrs['stroke']], ['5000', '5000', '5000', '5002', colourHex('green')]);
    assert.equal(child.attrs['data-entity-id'], undefined);
  });

  it('fills a hatch with outer minus islands and states its area and association', () => {
    const entities = [pline('P1', [[0, 0], [10, 0], [10, 10], [0, 10]], true), circle('C2', 5, 5, 2), { ...hatch('H6', 1, 1), area: 87.43, boundary: ['P1', 'C2'] }];
    const node = render(entities, 'H6');
    assert.deepEqual([node.attrs['data-area'], node.attrs['data-associative'], node.attrs['fill-rule']], ['87.43', 'true', 'evenodd']);
    assert.match(node.attrs['d'], /^M 0 0 L 10 0 L 10 10 L 0 10 L 0 0 Z M 7 5 A 2 2 0 0 1 3 5 A 2 2 0 0 1 7 5 Z$/);
    assert.equal(node.attrs['fill'], 'url(#plot-hatch-white)');
  });

  it('draws a dimension with lines, arrows and its text at the style precision', () => {
    const node = render([line('L1', 0, 0, 10, 0), dimension('D7', 'linear', [{ handle: 'L1', point: 'start' }, { handle: 'L1', point: 'end' }], 5, -3, 10)], 'D7');
    assert.deepEqual([node.attrs['data-kind'], node.attrs['data-value'], node.attrs['data-associative']], ['linear', '10.00', 'true']);
    const text = find(node, (n) => n.tag === 'text');
    assert.equal(text.length, 1);
    assert.equal(text[0].text, '10.00');
    assert.equal(text[0].attrs['data-text-height-mm'], undefined);
    assert.equal(find(node, (n) => n.tag === 'line').length, 3);
    assert.equal(find(node, (n) => n.tag === 'polygon').length, 2);
  });

  it('puts the annotation heights on a dimension drawn on paper: 2.5 mm and 2.5 * n world units', () => {
    const scene = buildScene(drawing([line('L1', 0, 0, 10, 0), dimension('D3', 'aligned', [{ handle: 'L1', point: 'start' }, { handle: 'L1', point: 'end' }], 5, 2, 10)]));
    const node = renderEntity(scene, scene.byId.get('D3')!, { paperScale: 50 });
    const text = find(node, (n) => n.tag === 'text')[0];
    assert.deepEqual([text.attrs['data-text-height-mm'], text.attrs['data-world-text-height'], text.attrs['font-size']], ['2.5', '125', '125']);
    assert.equal(find(renderEntity(scene, scene.byId.get('L1')!, { paperScale: 50 }), () => true)[0].attrs['stroke-width'], '12.5');
  });

  it('draws a dimension whose geometry is gone as its last text only', () => {
    const node = render([dimension('D7', 'linear', [{ handle: 'L1', point: 'start' }, { handle: 'L1', point: 'end' }], 5, -3, 10)], 'D7');
    assert.equal(find(node, (n) => n.tag === 'line').length, 0);
    assert.equal(find(node, (n) => n.tag === 'text')[0].text, '10.00');
  });
});

describe('svg strings', () => {
  it('serialises attributes in double quotes with escaping and self-closing empty elements', () => {
    const node: SvgNode = { tag: 'g', attrs: { 'data-x': 'a"b<&' }, children: [{ tag: 'line', attrs: { x1: '0' } }, { tag: 'text', attrs: {}, text: 'a < b & c' }] };
    assert.equal(serializeSvg(node), '<g data-x="a&quot;b&lt;&amp;"><line x1="0"/><text>a &lt; b &amp; c</text></g>');
  });

  it('writes only characters XML can hold: control characters become U+FFFD, a tab, line feed and carriage return survive as references', () => {
    const node: SvgNode = { tag: 'text', attrs: { 'data-layer': 'a\u0001b\tc\nd\re\u0000' }, text: 'x\u000by\r\nz\ufffe' };
    assert.equal(serializeSvg(node), '<text data-layer="a\ufffdb&#9;c&#10;d&#13;e\ufffd">x\ufffdy&#13;\nz\ufffd</text>');
  });

  it('exports a standalone svg with every entity as one element, hidden layers display none', () => {
    const scene = buildScene(drawing([line('L1', 0, 0, 10, 0), line('L2', 0, 1, 10, 1, 'Off')], { layers: { 0: layer('0'), Off: layer('Off', 'white', { on: false }) } }));
    const svg = modelSvg(scene);
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(svg.includes('data-entity-id="L1"'));
    assert.equal(svg.match(/data-entity-id="/g)!.length, 2);
    assert.match(svg, /data-entity-id="L2"[^>]*display="none"|display="none"[^>]*data-entity-id="L2"/);
  });

  it('defines hatch patterns and xref clips once', () => {
    const defs = renderDefs(buildScene(drawing([])));
    assert.equal(defs.tag, 'defs');
    assert.equal(defs.children!.filter((n) => n.tag === 'pattern').length, 8);
  });
});
