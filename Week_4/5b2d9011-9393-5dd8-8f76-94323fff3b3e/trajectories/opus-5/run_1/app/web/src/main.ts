// Holdfast Nights, in the browser. The server decides every rule; this renders
// its values and sends intents and reports.

import './styles.css';

import { RoomState, api } from './api';
import { App } from './app';
import { openCallsign, openHistory, openJoin, openSettings } from './panels';
import { openNights } from './nights';
import { RoomSession } from './room';

const root = document.getElementById('app');
const stageHost = document.getElementById('stage-layer');
if (!root || !stageHost) throw new Error('the app shell is missing its layers');

const app = new App(root, stageHost);

app.openCallsign = (next) => openCallsign(app, next);
app.openJoin = (code) => openJoin(app, code);
app.openNights = () => openNights(app);
app.openHistory = () => openHistory(app);
app.openSettings = () => openSettings(app);

app.enterRoom = async (state: RoomState) => {
  const session = new RoomSession(app, state);
  session.open();
};

app.startRoom = async (mode) => {
  await app.requireSession(async () => {
    app.notify('Starting room…');
    try {
      const state = await api.createRoom(mode);
      app.notify(`Room ${state.code} is open.`);
      await app.enterRoom(state);
    } catch (error) {
      app.notify(
        app.errorCopy(error, {
          rooms_unavailable: 'Rooms are offline right now. Try again in a minute.',
          already_in_room: `You're already in room ${
            (error as { extra?: Record<string, unknown> }).extra?.room_code ?? ''
          }.`,
        }),
      );
    }
  });
};

void app.boot();
