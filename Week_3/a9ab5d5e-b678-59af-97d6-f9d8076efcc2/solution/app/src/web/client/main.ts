import { mountApp, registerNotFound, registerScreen } from './app';
import { joinScreen, notFoundScreen, signInScreen, startScreen } from './screens/entry';
import { calendarScreen } from './screens/calendar';
import { planScreen } from './screens/plan';
import { requestsScreen } from './screens/requests';
import { costsScreen } from './screens/costs';
import { recordsScreen } from './screens/records';
import { shareScreen } from './screens/share';

registerScreen(/^\/$/, false, async () => signInScreen);
registerScreen(/^\/start$/, false, async () => startScreen);
registerScreen(/^\/join\/(?<token>[^/]+)$/, false, async () => joinScreen);
registerScreen(/^\/share\/(?<token>[^/]+)$/, false, async () => shareScreen);
registerScreen(/^\/calendar$/, true, async () => calendarScreen);
registerScreen(/^\/plan$/, true, async () => planScreen);
registerScreen(/^\/requests$/, true, async () => requestsScreen);
registerScreen(/^\/costs$/, true, async () => costsScreen);
registerScreen(/^\/records$/, true, async () => recordsScreen);
registerNotFound(async () => notFoundScreen);

mountApp();
