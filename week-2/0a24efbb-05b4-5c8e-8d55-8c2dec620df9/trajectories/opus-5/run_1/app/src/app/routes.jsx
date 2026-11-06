import { Shell } from './root.jsx';
import { CalendarScreen } from './screens/Calendar.jsx';
import { LoginScreen } from './screens/Login.jsx';
import { PolicyScreen } from './screens/Policy.jsx';
import { QueueScreen } from './screens/Queue.jsx';
import { SharedMonthScreen } from './screens/SharedMonth.jsx';

/** The desk's routes, and the screen each one draws inside the shell. */
const SCREEN_LIST = [
  { id: 'login', path: '/login', Screen: LoginScreen },
  { id: 'queue', path: '/requests', Screen: QueueScreen },
  { id: 'draft', path: '/requests/new', Screen: QueueScreen },
  { id: 'detail', path: '/requests/:id', Screen: QueueScreen },
  { id: 'calendar', path: '/calendar', Screen: CalendarScreen },
  { id: 'policy', path: '/policy', Screen: PolicyScreen },
  { id: 'share', path: '/share/:token', Screen: SharedMonthScreen },
];

export const SCREENS = Object.fromEntries(SCREEN_LIST.map(({ id, Screen }) => [id, Screen]));

export const routes = SCREEN_LIST.map(({ path, Screen }) => ({
  path,
  Component: () => (
    <Shell>
      <Screen />
    </Shell>
  ),
}));
