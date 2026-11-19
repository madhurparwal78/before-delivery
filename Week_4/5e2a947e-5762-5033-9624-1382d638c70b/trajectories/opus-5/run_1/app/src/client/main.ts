import { notFoundScreen, screen, startRouter } from './router.js';
import { announcements, noticesRegion } from './shell.js';
import { signinScreen, signupScreen } from './pages/account.js';
import { audienceScreen } from './pages/audience.js';
import { editorScreen } from './pages/editor.js';
import { homeScreen } from './pages/home.js';
import { mapListScreen } from './pages/maplist.js';
import { notFoundScreenView, shareEntryScreen, versionScreen } from './pages/misc.js';

announcements();
noticesRegion();

screen('/', () => homeScreen());
screen('/signup', () => signupScreen());
screen('/signin', () => signinScreen());
screen('/maps', () => mapListScreen());
screen('/m/:id', (params, url) => editorScreen(params, url));
screen('/m/:id/versions/:vid', (params, url) => versionScreen(params, url));
screen('/s/:code', (params) => shareEntryScreen(params));
screen('/p/:code', (params) => audienceScreen(params));
notFoundScreen(() => notFoundScreenView());

startRouter();
