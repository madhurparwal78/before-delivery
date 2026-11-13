import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { LiveMessage } from '../../shared/types.ts';
import { LiveChannel } from './liveChannel.ts';
import type { LiveHandlers } from './liveChannel.ts';

const notice = (seq: number): LiveMessage => ({ seq, type: 'notice', data: { username: 'a', text: `n${seq}` } });

function setup() {
  const sockets: { handlers: LiveHandlers; sent: string[]; closed: boolean }[] = [];
  const events = { opened: 0, lost: 0, resyncs: 0, seen: [] as number[] };
  const channel = new LiveChannel('/live', (_path, handlers) => {
    const socket = { handlers, sent: [] as string[], closed: false };
    sockets.push(socket);
    return { send: (data) => socket.sent.push(data), close: () => { socket.closed = true; } };
  }, {
    opened: () => { events.opened += 1; },
    lost: () => { events.lost += 1; },
    message: (message) => events.seen.push(message.seq),
    resync: () => { events.resyncs += 1; },
  });
  const deliver = (message: LiveMessage): void => sockets[sockets.length - 1].handlers.message(JSON.stringify(message));
  return { channel, sockets, events, deliver };
}

describe('LiveChannel', () => {
  it('says hello since the given number and delivers consecutive messages once each', () => {
    const { channel, sockets, events, deliver } = setup();
    channel.connect(4);
    sockets[0].handlers.open();
    assert.deepEqual(sockets[0].sent.map((text) => JSON.parse(text)), [{ type: 'hello', since: 4 }]);
    deliver(notice(5));
    deliver(notice(6));
    assert.deepEqual(events.seen, [5, 6]);
    assert.equal(channel.seq, 6);
  });

  it('asks for a reload on a gap or a number that went back, holds what follows, and carries on from the reloaded number', () => {
    const { channel, sockets, events, deliver } = setup();
    channel.connect(0);
    sockets[0].handlers.open();
    deliver(notice(1));
    deliver(notice(4));
    deliver(notice(5));
    assert.equal(events.resyncs, 1);
    assert.deepEqual(events.seen, [1]);
    channel.resynced(4);
    assert.deepEqual(events.seen, [1, 5]);
    deliver(notice(2));
    assert.equal(events.resyncs, 2);
    channel.resynced(1);
    assert.deepEqual(events.seen, [1, 5, 2]);
  });

  it('reconnects on a page timer after the socket closes by itself, but not after a disconnect', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const { channel, sockets, events, deliver } = setup();
    channel.connect(0);
    sockets[0].handlers.open();
    deliver(notice(1));
    sockets[0].handlers.close();
    assert.equal(events.lost, 1);
    assert.equal(channel.isOpen, false);
    mock.timers.tick(500);
    assert.equal(sockets.length, 2);
    sockets[1].handlers.open();
    assert.deepEqual(JSON.parse(sockets[1].sent[0]), { type: 'hello', since: 1 });
    channel.disconnect();
    assert.equal(sockets[1].closed, true);
    sockets[1].handlers.close();
    mock.timers.tick(10_000);
    assert.equal(sockets.length, 2);
    mock.timers.reset();
  });
});
