import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { offlineBanner, leftSelection } from '../../shared/copy.ts';
import { ApiError } from '../../shared/errors.ts';
import { layer, line } from '../../shared/model/testing.ts';
import { DRAWING_ID, FakeServer, ME, OTHER, openStore, settle } from './testing.ts';
import type { DrawingStore } from './drawingStore.ts';
import { CHIP_BAND_BOTTOM_PX, CHIP_BAND_TOP_PX } from './sceneStore.ts';

const PANE = [800, 600] as const;

async function openWith(server: FakeServer, options?: Parameters<typeof openStore>[1]) {
  const opened = openStore(server, options);
  opened.store.setPaneSize(...PANE);
  await opened.store.open();
  await settle();
  return opened;
}

const handles = (store: DrawingStore): string[] => Object.keys(store.getSnapshot().state.entities);
const entity = (store: DrawingStore, handle: string) => store.getSnapshot().state.entities[handle];

describe('loading', () => {
  it('shows the document, fits the entities between the chip bands, and says Live once the socket is open', async () => {
    const server = new FakeServer({ entities: [{ ...line('L1', 0, 0, 100, 50) }] });
    const { store } = await openWith(server);
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.info?.name, 'Plot plan');
    assert.equal(snapshot.connection.text, 'Live');
    assert.equal(snapshot.scene.entities.length, 1);
    const fit = Math.min((PANE[0] - 48) / 100, (PANE[1] - CHIP_BAND_TOP_PX - CHIP_BAND_BOTTOM_PX - 48) / 50);
    assert.ok(Math.abs(snapshot.view.zoom - fit) < 1e-9);
    assert.deepEqual(server.connections[0].sent[0], { type: 'hello', since: 0 });
  });

  it('starts an empty drawing at zoom 10 near the bottom-left', async () => {
    const { store } = await openWith(new FakeServer());
    assert.deepEqual(store.getSnapshot().view, { zoom: 10, panX: 40, panY: 560 });
  });

  it('answers 404 and 401 with a status, and asks to sign in on 401', async () => {
    const server = new FakeServer();
    const { store, spy } = openStore(server);
    server.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: 'unauthenticated', message: 'x' }), { status: 401 }));
    await store.open();
    assert.equal(store.getSnapshot().status, 'unauthenticated');
    assert.equal(spy.signedOut, 1);
  });
});

describe('editing', () => {
  it('draws a line from the command line: optimistic at once, confirmed by the live message, announced with the real handle', async () => {
    const server = new FakeServer();
    const { store, spy } = await openWith(server);
    store.commandEnter('L');
    store.commandEnter('0,0');
    store.commandEnter('@10,0');
    store.commandEnter('');
    assert.deepEqual(handles(store), ['new-1']);
    assert.equal(store.getSnapshot().pendingOps, 1);
    await settle();
    assert.deepEqual(handles(store), ['L1']);
    assert.equal(store.getSnapshot().pendingOps, 0);
    assert.equal(store.getSnapshot().revision, 1);
    assert.deepEqual(spy.announced, ['Line L1 added']);
    assert.equal(server.posts[0].base_revision, 0);
  });

  it('rolls an engine refusal back with the message in the prompt and leaves the stage', async () => {
    const { store } = await openWith(new FakeServer({ entities: [line('L1', 0, 0, 3, 4)], parameters: [{ name: 'd1', expression: '5' }] }));
    store.commandEnter('PM');
    store.commandEnter('d1 = d9');
    assert.equal(store.getSnapshot().prompt, 'Unknown parameter: d9.');
    assert.equal(store.getSnapshot().pendingOps, 0);
  });

  it('refuses edits for a person who can only view', async () => {
    const server = new FakeServer();
    server.role = 'view';
    const { store, spy } = await openWith(server);
    store.commandEnter('L');
    assert.equal(store.getSnapshot().prompt, 'You can view this drawing but not edit it.');
    store.edit('LAYER', [{ type: 'layer_add', name: 'Walls', colour: 'red', linetype: 'Continuous', lineweight: 0.25 }]);
    assert.deepEqual(spy.toasts, ['You can view this drawing but not edit it.']);
    assert.equal(server.posts.length, 0);
  });

  it('rolls back to the server state when the server refuses the group, then toasts and asks for Command focus', async () => {
    const server = new FakeServer({ entities: [line('L1', 0, 0, 10, 0)] });
    const { store, spy } = await openWith(server);
    server.refuseNext = new ApiError('layer_locked', 'Layer 0 is locked.');
    store.edit('NUDGE', [{ type: 'move', handles: ['L1'], dx: 5, dy: 0 }]);
    assert.equal((entity(store, 'L1') as { x1: number }).x1, 5);
    await settle();
    assert.equal((entity(store, 'L1') as { x1: number }).x1, 0);
    assert.deepEqual(spy.toasts, ['Layer 0 is locked.']);
    assert.equal(store.getSnapshot().focus?.target, 'command');
    assert.equal(store.getSnapshot().pendingOps, 0);
  });

  it('keeps the other person\'s change when it arrives while a group is unconfirmed', async () => {
    const server = new FakeServer({ entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 5)] });
    const { store } = await openWith(server);
    store.edit('MOVE', [{ type: 'move', handles: ['L1'], dx: 1, dy: 0 }]);
    server.remote(OTHER, [{ type: 'move', handles: ['L2'], dx: 0, dy: 2 }]);
    await settle();
    assert.equal((entity(store, 'L1') as { x1: number }).x1, 1);
    assert.equal((entity(store, 'L2') as { y1: number }).y1, 7);
    assert.equal(store.getSnapshot().pendingOps, 0);
  });

  it('announces another person\'s change with their name', async () => {
    const server = new FakeServer({ entities: [line('L1', 0, 0, 10, 0)] });
    const { store, spy } = await openWith(server);
    server.remote(OTHER, [{ type: 'move', handles: ['L1'], dx: 1, dy: 0 }]);
    await settle();
    assert.deepEqual(spy.announced, [`${OTHER} moved L1`]);
    assert.equal(store.getSnapshot().revision, 1);
  });

  it('erases the selection as one group and announces it', async () => {
    const server = new FakeServer({ entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 5)] });
    const { store, spy } = await openWith(server);
    store.selectOnly('L1');
    store.toggleSelected('L2');
    store.eraseSelection();
    await settle();
    assert.deepEqual(handles(store), []);
    assert.equal(server.posts.length, 1);
    assert.deepEqual(spy.announced, ['Erased 2 entities']);
    assert.equal(store.getSnapshot().selection.size, 0);
  });

  it('nudges by 1 or 10 as a NUDGE group', async () => {
    const server = new FakeServer({ entities: [line('L1', 0, 0, 10, 0)] });
    const { store } = await openWith(server);
    store.selectOnly('L1');
    store.nudge(1, 0);
    store.nudge(0, 10);
    await settle();
    assert.deepEqual(server.posts.map((post) => post.command), ['NUDGE', 'NUDGE']);
    assert.equal((entity(store, 'L1') as { x1: number; y1: number }).x1, 1);
    assert.equal((entity(store, 'L1') as { x1: number; y1: number }).y1, 10);
  });

  it('refuses a frozen layer as the current layer', async () => {
    const { store, spy } = await openWith(new FakeServer({ layers: [layer('Hidden', { frozen: true })] }));
    store.setCurrentLayer('Hidden');
    assert.deepEqual(spy.toasts, ["Frozen layers can't be current."]);
    assert.equal(store.getSnapshot().currentLayer, '0');
  });
});

describe('working offline', () => {
  it('queues groups, shows them at once, survives a reload, and sends them in order with the counts', async () => {
    const server = new FakeServer({ entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 10, 10, 10)] });
    const first = await openWith(server);
    await first.store.setOffline(true);
    assert.equal(first.store.getSnapshot().connection.text, "You're working offline. 0 changes waiting.");
    first.store.commandEnter('L');
    first.store.commandEnter('0,20');
    first.store.commandEnter('5,20');
    first.store.commandEnter('');
    first.store.edit('MOVE', [{ type: 'move', handles: ['L1'], dx: 1, dy: 0 }]);
    first.store.edit('MOVE', [{ type: 'move', handles: ['L2'], dx: 2, dy: 0 }]);
    assert.equal(first.store.getSnapshot().connection.text, offlineBanner(3));
    assert.equal(server.posts.length, 0);
    assert.equal(first.store.getSnapshot().pendingOps, 3);

    server.remote(OTHER, [{ type: 'move', handles: ['L1'], dx: 0, dy: 4 }]);
    server.remote(OTHER, [{ type: 'delete', handles: ['L2'] }]);

    const reloaded = await openWith(server, { storage: first.storage });
    assert.equal(reloaded.store.getSnapshot().connection.text, offlineBanner(3));
    assert.equal(server.posts.length, 0);
    await reloaded.store.setOffline(false);
    await settle();
    assert.equal(reloaded.store.getSnapshot().connection.text, 'Back online: 3 changes sent, 2 conflicts.');
    assert.deepEqual(server.posts.map((post) => post.base_revision), [0, 0, 0]);
    assert.equal(reloaded.store.getSnapshot().pendingOps, 0);
    assert.equal(first.storage.getItem(`plotfold.offline.${DRAWING_ID}.${ME}`), null);
  });

  it('undoes the last queued group while offline', async () => {
    const { store } = await openWith(new FakeServer());
    await store.setOffline(true);
    for (const y of ['1,1', '3,3']) {
      store.commandEnter('L');
      store.commandEnter(y);
      store.commandEnter(y);
      store.commandEnter('');
    }
    assert.equal(store.getSnapshot().pendingOps, 2);
    await store.undo();
    assert.equal(store.getSnapshot().connection.text, offlineBanner(1));
    assert.equal(handles(store).length, 1);
  });
});

describe('presence and selection', () => {
  it('draws remote crosshairs with their colour index and sends its own cursor on every move', async () => {
    const server = new FakeServer({ entities: [line('L1', 0, 0, 10, 0)] });
    const { store } = await openWith(server);
    server.broadcast('presence', { kind: 'members', members: [{ username: ME, colour: 1 }, { username: OTHER, colour: 2 }] });
    server.broadcast('presence', { kind: 'cursor', username: OTHER, x: 5, y: 5, selection: ['L1'], zoom: 10, pan_x: 100, pan_y: 300, width: 800, height: 600 });
    await settle();
    const [cursor] = store.getSnapshot().cursors;
    assert.deepEqual([cursor.username, cursor.colour, cursor.x, cursor.y], [OTHER, 2, 5, 5]);
    store.pointerMove([100, 100]);
    const sent = server.connections[0].sent.filter((message) => (message as { type: string }).type === 'cursor');
    assert.equal(sent.length, 1);
  });

  it('follows a person until the follower zooms, and says so', async () => {
    const server = new FakeServer({ entities: [line('L1', 0, 0, 10, 0)] });
    const { store, spy } = await openWith(server);
    server.broadcast('presence', { kind: 'members', members: [{ username: ME, colour: 1 }, { username: OTHER, colour: 2 }] });
    store.follow(OTHER);
    server.broadcast('presence', { kind: 'cursor', username: OTHER, x: null, y: null, selection: [], zoom: 20, pan_x: 100, pan_y: 300, width: 800, height: 600 });
    await settle();
    const { view } = store.getSnapshot();
    assert.equal(view.zoom, 20);
    assert.equal(view.panX, 400 - ((400 - 100) / 20) * 20);
    store.wheel([10, 10], 120);
    assert.equal(store.getSnapshot().followed, null);
    assert.deepEqual(spy.announced, [`Stopped following ${OTHER}.`]);
    server.broadcast('presence', { kind: 'cursor', username: OTHER, x: null, y: null, selection: [], zoom: 30, pan_x: 0, pan_y: 0, width: 800, height: 600 });
    await settle();
    assert.notEqual(store.getSnapshot().view.zoom, 30);
  });

  it('takes locked entities out of the selection with the person who locked the layer named', async () => {
    const server = new FakeServer({ layers: [layer('Walls')], entities: [line('L1', 0, 0, 10, 0, 'Walls'), line('L2', 0, 2, 10, 2, 'Walls'), line('L3', 0, 20, 10, 20)] });
    const { store, spy } = await openWith(server);
    store.selectOnly('L1');
    store.toggleSelected('L2');
    store.toggleSelected('L3');
    server.remote(OTHER, [{ type: 'layer_set', name: 'Walls', set: { locked: true } }], { command: 'LAYER' });
    await settle();
    assert.deepEqual([...store.getSnapshot().selection], ['L3']);
    assert.deepEqual(spy.toasts, [leftSelection(OTHER, 'Walls', 2)]);
  });

  it('toasts notices for this person only, shows a role change, and clears the drawing on revoke', async () => {
    const server = new FakeServer({ entities: [line('L1', 0, 0, 10, 0)] });
    const { store, spy } = await openWith(server);
    server.broadcast('notice', { username: OTHER, text: 'not mine' });
    server.broadcast('notice', { username: ME, text: 'mine' });
    server.broadcast('role', { username: ME, role: 'view' });
    await settle();
    assert.deepEqual(spy.toasts, ['mine', 'Your role is now view.']);
    assert.equal(store.getSnapshot().canEdit, false);
    assert.equal(store.getSnapshot().focus?.target, 'drawing');
    server.broadcast('role', { username: ME, role: null });
    await settle();
    assert.equal(store.getSnapshot().status, 'revoked');
    assert.equal(store.getSnapshot().scene.entities.length, 0);
  });
});

describe('xrefs, exports and sheets', () => {
  it('keeps a live feed for the panels and tracks an own export job', async () => {
    const server = new FakeServer();
    const { store, spy } = await openWith(server);
    const seen: string[] = [];
    store.onLive((message) => seen.push(message.type));
    store.trackExport({ id: 'e1', format: 'svg', state: 'queued', progress: 0, download_url: null });
    assert.equal(store.getSnapshot().storageNotice, 'Export started.');
    server.broadcast('export', { username: ME, job: { id: 'e1', format: 'svg', state: 'ready', progress: 100, download_url: '/x' } });
    server.broadcast('issue', { issue: { id: 'i1', version_id: 'v', drawing_id: DRAWING_ID, title: 't', x: 0, y: 0, state: 'open', creator: ME, rfi_ids: [] } });
    await settle();
    assert.deepEqual(seen, ['export', 'issue']);
    assert.equal(store.getSnapshot().storageNotice, 'Export ready.');
    assert.deepEqual(spy.announced, ['Export started.', 'Export ready.']);
  });
});

describe('adding through a panel', () => {
  it('numbers the ops and keeps one group per edit', async () => {
    const server = new FakeServer();
    const { store } = await openWith(server);
    store.edit('LAYER', [{ type: 'layer_add', name: 'Walls', colour: 'red', linetype: 'Continuous', lineweight: 0.25 }]);
    await settle();
    assert.equal(server.posts.length, 1);
    assert.equal(server.posts[0].ops[0].op_id.length > 0, true);
    assert.equal(store.getSnapshot().state.layers.Walls.colour, 'red');
  });
});
