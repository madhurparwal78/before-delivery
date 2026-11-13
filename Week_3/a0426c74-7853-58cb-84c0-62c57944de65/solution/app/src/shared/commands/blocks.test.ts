import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as copy from '../copy.ts';
import { insert, layer, line } from '../model/testing.ts';
import { Bench } from './testing.ts';

describe('BLOCK and INSERT', () => {
  it('defines a block from picked entities, replaces them by one insert and asks for attributes until Enter', () => {
    const b = new Bench({ entities: [line('L1', 0, 0, 1, 0), line('L2', 5, 5, 6, 5)] });
    b.run('B', 'Door', '0,0', 'L1', '');
    assert.equal(b.promptText, 'BLOCK: attribute TAG=default (Enter for none)');
    b.run('MARK=A1');
    assert.equal(b.promptText, 'BLOCK: attribute TAG=default (Enter for none)');
    b.run('');
    assert.equal(b.announced, 'Block Door defined');
    assert.ok(!('L1' in b.state.entities));
    assert.deepEqual(b.state.blocks.Door.attributes, [{ tag: 'MARK', default: 'A1' }]);
    const inserts = Object.values(b.state.entities).filter((entity) => entity.type === 'insert');
    assert.equal(inserts.length, 1);
    assert.equal(b.groups.length, 1);
  });

  it('takes Space as a character in a block name and in an attribute value', () => {
    const b = new Bench({ entities: [line('L1', 0, 0, 1, 0)] });
    b.run('B');
    b.type('Front door', 'space');
    assert.equal(b.promptText, 'BLOCK: name');
    b.run('Front door', '0,0', 'L1', '', 'NOTE=two words', '');
    assert.ok('Front door' in b.state.blocks);
    assert.deepEqual(b.state.blocks['Front door'].attributes, [{ tag: 'NOTE', default: 'two words' }]);
  });

  it('inserts with a scale and a rotation, the attributes filled from the definition', () => {
    const b = new Bench({ blocks: [{ name: 'Door', base: [0, 0], entities: [line('L50', 0, 0, 1, 0)], attributes: [{ tag: 'MARK', default: 'A1' }] }] });
    b.run('I', 'Door', '10,0', '2', '90');
    const [made] = Object.values(b.state.entities);
    assert.ok(made.type === 'insert' && made.x === 10 && made.scale === 2 && made.rotation === 90 && made.attributes.MARK === 'A1');
    assert.equal(b.announced, `Block ${made.handle} added`);
    b.run('I', 'Door', '3,3', '', '');
    const [, second] = Object.values(b.state.entities);
    assert.ok(second.type === 'insert' && second.scale === 1 && second.rotation === 0);
  });

  it('refuses a self-containing block with its chain and reopens the attribute stage', () => {
    const b = new Bench({ entities: [line('L1', 0, 0, 1, 0), line('L2', 5, 5, 6, 5), line('L3', 0, 0, 0, 2)] });
    b.run('B', 'Door', '0,0', 'L1', '', '');
    const door = Object.keys(b.state.entities).find((handle) => b.entity(handle).type === 'insert') ?? '';
    b.run('B', 'Frame', '0,0', door, 'L2', '', '');
    const frame = Object.keys(b.state.entities).find((handle) => b.entity(handle).type === 'insert') ?? '';
    b.run('B', 'Door', '0,0', 'L3', '', '');
    assert.equal(b.announced, 'Block Door redefined');
    const groups = b.groups.length;
    b.run('B', 'Door', '0,0', frame, '', '');
    assert.equal(b.promptText, "Block Door can't contain itself: Door -> Frame -> Door.");
    assert.equal(b.groups.length, groups);
    b.session.clearMessage();
    assert.equal(b.session.feed({ kind: 'text', text: '', terminator: 'enter' }, b.env()).prompt, 'Ready. Type a command.');
  });
});

describe('EXPLODE and PURGE', () => {
  const bench = () => new Bench({
    layers: [layer('E1'), layer('E2')],
    blocks: [
      { name: 'Door', base: [0, 0], entities: [line('L50', 0, 0, 1, 0)], attributes: [] },
      { name: 'Outer', base: [0, 0], entities: [insert('I51', 'Door', 0, 0)], attributes: [] },
      { name: 'Spare1', base: [0, 0], entities: [line('L52', 0, 0, 1, 1)], attributes: [] },
      { name: 'Spare2', base: [0, 0], entities: [line('L53', 0, 0, 1, 1)], attributes: [] },
    ],
    entities: [insert('I1', 'Door', 10, 0, 2, 90), insert('I2', 'Door', 20, 0), insert('I4', 'Outer', 50, 50)],
  });

  it('explodes the picked inserts into their definition entities and announces them', () => {
    const b = bench();
    b.run('X', 'I2', '');
    assert.equal(b.announced, copy.exploded('I2', 1));
    assert.ok(!('I2' in b.state.entities));
  });

  it('refuses a pick that is not an insert', () => {
    const b = new Bench({ entities: [line('L1', 0, 0, 1, 0)] });
    b.run('X', 'L1');
    assert.equal(b.promptText, 'Nothing there to pick.');
  });

  it('purges unused blocks and empty layers and prints the counts in the prompt', () => {
    const b = bench();
    b.run('PU');
    assert.equal(b.promptText, 'Purged 2 blocks, 2 layers.');
    assert.deepEqual(Object.keys(b.state.blocks).sort(), ['Door', 'Outer']);
    assert.equal(b.groups.length, 1);
    b.run('I', 'Spare1');
    assert.equal(b.promptText, 'No block named Spare1.');
  });
});
