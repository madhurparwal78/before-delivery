import { api } from './api';
import { installMotionFlag, installRail } from './chrome';
import { installSheetDismissal } from './dom';
import { seedStatus, startLive } from './live';
import { startGuestsPage } from './pages/guests';
import { startLogPage } from './pages/log';
import { startNoticesPage } from './pages/notices';
import { startPlanPage } from './pages/plan';
import { startSchedulesPage } from './pages/schedules';
import { startScenesPage } from './pages/scenes';
import type { Room, Scene, StatusBody } from '../shared/types';

async function boot(): Promise<void> {
  installMotionFlag();
  installRail();
  installSheetDismissal();

  const page = document.body.dataset['page'] ?? 'plan';
  const status = await api.get<StatusBody>('/api/status');
  seedStatus(status);
  startLive();

  if (page === 'plan') {
    const scenes = (await api.get<{ scenes: Scene[] }>('/api/scenes')).scenes;
    await startPlanPage({ status, scenes });
    return;
  }
  if (page === 'schedules') {
    const [scenes, rooms] = await Promise.all([
      api.get<{ scenes: Scene[] }>('/api/scenes'),
      api.get<{ rooms: Room[] }>('/api/rooms'),
    ]);
    await startSchedulesPage({ status, scenes: scenes.scenes, rooms: rooms.rooms });
    return;
  }
  if (page === 'scenes') {
    await startScenesPage();
    return;
  }
  if (page === 'guests') {
    const [scenes, rooms] = await Promise.all([
      api.get<{ scenes: Scene[] }>('/api/scenes'),
      api.get<{ rooms: Room[] }>('/api/rooms'),
    ]);
    await startGuestsPage({ rooms: rooms.rooms, scenes: scenes.scenes });
    return;
  }
  if (page === 'log') {
    const scenes = (await api.get<{ scenes: Scene[] }>('/api/scenes')).scenes;
    await startLogPage({ status, scenes });
    return;
  }
  await startNoticesPage({ status });
}

void boot();
