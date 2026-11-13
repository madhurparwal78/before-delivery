import { copy, figures } from '../../../shared/copy.js';
import { button, el, iconButton, isPhone } from '../../dom.js';
import { icons } from '../../icons.js';
import { editorUnits } from '../../units.js';

export interface Chrome {
  roomsButton: HTMLButtonElement;
  statusWord: HTMLElement;
  statusDot: HTMLElement;
  roomCode: HTMLElement;
  copyCode: HTMLButtonElement;
  inviteEmail: HTMLInputElement;
  inviteButton: HTMLButtonElement;
  playtestsButton: HTMLButtonElement;
  sessionMenuButton: HTMLButtonElement;
  sessionMenu: HTMLElement;
  serviceStatus: HTMLElement;
  connection: HTMLElement;
  chainFigures: HTMLElement;
  presenceButton: HTMLButtonElement;
  accountButton: HTMLButtonElement;
  inspector: HTMLElement;
  rotation: HTMLInputElement;
  transport: HTMLElement;
  moveButton: HTMLButtonElement;
  rotateButton: HTMLButtonElement;
  scaleButton: HTMLButtonElement;
  playButton: HTMLButtonElement;
  clock: HTMLElement;
  graphButton: HTMLButtonElement;
  libraryButton: HTMLButtonElement;
  nextNodeButton: HTMLButtonElement;
  addPrimitive: HTMLButtonElement;
  primitiveMenu: HTMLElement;
  uploadProp: HTMLButtonElement;
  cueTimelineButton: HTMLButtonElement;
  cueTimeline: HTMLElement;
  unitsButton: HTMLButtonElement;
  scenePanel: HTMLElement;
  sceneTree: HTMLElement;
  editorStatus: HTMLElement;
  toolsButton: HTMLButtonElement;
  toolsMenu: HTMLElement;
  nodes: HTMLElement[];
}

export function buildChrome(): Chrome {
  const phone = isPhone();

  const roomsButton = iconButton('Rooms', icons.key, { class: 'cluster panel top-left' });

  const statusDot = el('span', { class: 'status-dot', 'aria-hidden': 'true' });
  const statusWord = el('span', { text: 'Live' });
  const roomCode = el('span', { class: 'mono' });
  const copyCode = iconButton('Copy room code', icons.copy);
  const inviteEmail = el('input', { type: 'email', 'aria-label': 'Invite tester email' });
  const inviteButton = button('Invite');
  inviteButton.textContent = 'Invite';
  inviteButton.disabled = true;
  const playtestsButton = button('Playtests');
  playtestsButton.textContent = 'Playtests';
  const sessionMenuButton = button('Session menu', { 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [
    document.createTextNode('⌄'),
  ]);
  const sessionMenu = el('div', { role: 'menu', class: 'sheet small', hidden: true });
  const serviceStatus = el('span', { role: 'status', 'aria-label': 'Service status' });
  const connection = el('span', {
    role: 'status',
    'aria-label': 'Connection',
    text: copy.connectionSaved,
  });

  const middle = el('div', { class: 'middle' });
  const pill = el(
    'div',
    { class: 'cluster panel top-centre session-pill', role: 'toolbar', 'aria-label': 'Live session' },
    [statusDot, statusWord, middle],
  );

  const chainFigures = el('div', { role: 'group', 'aria-label': 'Chain figures' });
  const presenceButton = button('Presence');
  presenceButton.textContent = '1 here';
  const accountButton = button('Account');
  const topRight = el('div', { class: 'cluster panel top-right' }, [
    chainFigures,
    presenceButton,
    accountButton,
  ]);

  const rotation = el('input', {
    type: 'number',
    role: 'spinbutton',
    'aria-label': 'Rotation',
    min: '0',
    max: '359',
  });
  const inspector = el('div', { class: 'inspector', role: 'region', 'aria-label': 'Inspector', hidden: true });

  const moveButton = iconButton('Move', icons.move, { 'aria-pressed': 'true' });
  const rotateButton = iconButton('Rotate', icons.rotate, { 'aria-pressed': 'false' });
  const scaleButton = iconButton('Scale', icons.scale, { 'aria-pressed': 'false' });
  const playButton = iconButton('Start playtest', icons.play, {
    class: phone ? 'raised' : 'play-button',
  });
  const clock = el('span', { class: 'mono', role: 'timer', 'aria-label': 'Playtest clock', hidden: true });
  const graphButton = iconButton('Trigger graph', icons.graph);
  const libraryButton = iconButton('Prop library', icons.props);
  const nextNodeButton = iconButton('Next node', icons.next);

  const toolsButton = button('Tools');
  toolsButton.textContent = 'Tools';
  const toolsMenu = el('div', { role: 'menu', class: 'sheet small', hidden: true });
  const phoneGraph = button('Graph');
  phoneGraph.textContent = 'Graph';
  const phoneProps = button('Props');
  phoneProps.textContent = 'Props';
  const phoneRooms = button('Rooms');
  phoneRooms.textContent = 'Rooms';

  const transport = phone
    ? el('div', { role: 'toolbar', 'aria-label': 'Transport', class: 'tabbar' }, [
        toolsButton,
        phoneGraph,
        el('span', {}),
        phoneProps,
        phoneRooms,
        playButton,
      ])
    : el('div', { role: 'toolbar', 'aria-label': 'Transport', class: 'cluster bottom-centre transport' }, [
        moveButton,
        rotateButton,
        scaleButton,
        playButton,
        graphButton,
        libraryButton,
        nextNodeButton,
        clock,
      ]);

  const addPrimitive = iconButton('Add primitive', icons.plus, { 'aria-haspopup': 'menu' });
  const primitiveMenu = el('div', { role: 'menu', class: 'sheet small', hidden: true });
  const uploadProp = iconButton('Upload prop', icons.upload);
  const bottomLeft = el('div', { class: 'cluster bottom-left' }, [addPrimitive, uploadProp]);

  const cueTimelineButton = iconButton('Cue timeline', icons.layers);
  const unitsButton = button(editorUnits() === 'ft' ? 'ft' : 'm', {
    'aria-label': 'Units',
    'aria-pressed': editorUnits() === 'ft' ? 'true' : 'false',
  });
  const bottomRight = el('div', { class: 'cluster bottom-right' }, [cueTimelineButton, unitsButton]);
  const cueTimeline = el('div', {
    class: 'cue-timeline',
    role: 'region',
    'aria-label': 'Cue timeline',
    hidden: true,
  });

  const sceneTree = el('ul', { role: 'tree', 'aria-label': 'Scene' });
  const scenePanel = el('div', { class: 'scene-panel', role: 'region', 'aria-label': 'Scene' }, [
    sceneTree,
  ]);

  const editorStatus = el('p', {
    role: 'status',
    'aria-label': 'Editor status',
    class: 'visually-hidden',
  });

  if (phone) {
    middle.append(roomCode, clock, sessionMenuButton);
    sessionMenu.append(
      connection,
      serviceStatus,
      copyCode,
      el('div', { class: 'row' }, [inviteEmail, inviteButton]),
      playtestsButton,
    );
    toolsMenu.append(
      moveButton,
      rotateButton,
      scaleButton,
      addPrimitive,
      uploadProp,
      cueTimelineButton,
      unitsButton,
    );
    phoneGraph.addEventListener('click', () => graphButton.click());
    phoneProps.addEventListener('click', () => libraryButton.click());
    phoneRooms.addEventListener('click', () => roomsButton.click());
  } else {
    middle.append(
      connection,
      roomCode,
      copyCode,
      serviceStatus,
      inviteEmail,
      inviteButton,
      playtestsButton,
      sessionMenuButton,
    );
  }

  chainFigures.append(
    el('span', { text: figures.solved({ solved: 0, total: 0, longestRun: 0, props: 0 }) }),
    el('span', { text: figures.run({ solved: 0, total: 0, longestRun: 0, props: 0 }) }),
    el('span', { text: figures.props({ solved: 0, total: 0, longestRun: 0, props: 0 }) }),
  );

  return {
    roomsButton,
    statusWord,
    statusDot,
    roomCode,
    copyCode,
    inviteEmail,
    inviteButton,
    playtestsButton,
    sessionMenuButton,
    sessionMenu,
    serviceStatus,
    connection,
    chainFigures,
    presenceButton,
    accountButton,
    inspector,
    rotation,
    transport,
    moveButton,
    rotateButton,
    scaleButton,
    playButton,
    clock,
    graphButton,
    libraryButton,
    nextNodeButton,
    addPrimitive,
    primitiveMenu,
    uploadProp,
    cueTimelineButton,
    cueTimeline,
    unitsButton,
    scenePanel,
    sceneTree,
    editorStatus,
    toolsButton,
    toolsMenu,
    nodes: [
      roomsButton,
      pill,
      topRight,
      inspector,
      transport,
      bottomLeft,
      bottomRight,
      cueTimeline,
      scenePanel,
      editorStatus,
      sessionMenu,
      primitiveMenu,
      toolsMenu,
    ],
  };
}
