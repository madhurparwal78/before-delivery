import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { line } from '../model/testing.ts';
import { Bench } from './testing.ts';

const SRC = 'src-id';
const OTHER = 'other-id';

describe('XATTACH and XBIND', () => {
  it('attaches a drawing of the folder at a point, scale and rotation as one xref_attach op', () => {
    const b = new Bench({}, { drawings: [{ id: SRC, name: 'Source', xref_sources: [] }, { id: OTHER, name: 'Other', xref_sources: [] }] });
    b.run('XA', 'Source', 'Site', '5,5', '2', '90');
    assert.deepEqual(b.groups[0].ops.map(({ op_id: _id, ...op }) => op), [{ type: 'xref_attach', name: 'Site', source: SRC, x: 5, y: 5, scale: 2, rotation: 90 }]);
    assert.equal(b.groups[0].command, 'XATTACH');
    b.run('XA', 'Source', 'Back', '0,0', '', '');
    assert.deepEqual(b.groups[1].ops.map(({ op_id: _id, ...op }) => op), [{ type: 'xref_attach', name: 'Back', source: SRC, x: 0, y: 0, scale: 1, rotation: 0 }]);
  });

  it('matches drawing names exactly and takes Space in a drawing name', () => {
    const b = new Bench({}, { drawings: [{ id: SRC, name: 'Plot plan', xref_sources: [] }] });
    b.run('XA');
    assert.equal(b.type('Plot', 'space').consumed, false);
    b.run('plot plan');
    assert.equal(b.promptText, 'No drawing named plot plan in this folder.');
    b.run('Plot plan');
    assert.equal(b.promptText, 'XATTACH: xref name');
  });

  it('refuses a chain that loops back to the host at the name stage, naming it', () => {
    const b = new Bench({}, {
      host: { id: SRC, name: 'Source' },
      drawings: [{ id: SRC, name: 'Source', xref_sources: [] }, { id: OTHER, name: 'Hostish', xref_sources: [SRC] }],
    });
    b.run('XA', 'Hostish');
    assert.equal(b.promptText, 'Circular reference: Source -> Hostish -> Source.');
    b.escape();
    b.run('XA', 'Source');
    assert.equal(b.promptText, 'Circular reference: Source -> Source.');
  });

  it('binds a named xref and refuses an unknown one', () => {
    const b = new Bench({ entities: [line('L1', 0, 0, 1, 0)] });
    b.run('XB', 'Site');
    assert.equal(b.promptText, 'No xref named Site.');
    b.state = { ...b.state, xrefs: { Site: { name: 'Site', source: SRC, x: 0, y: 0, scale: 1, rotation: 0, clip: null, version_id: null, model: { layers: [], entities: [], blocks: [], xrefs: [] } } } };
    b.run('XB', 'Site');
    assert.deepEqual(b.groups[0].ops.map(({ op_id: _id, ...op }) => op), [{ type: 'xref_bind', name: 'Site' }]);
  });
});
