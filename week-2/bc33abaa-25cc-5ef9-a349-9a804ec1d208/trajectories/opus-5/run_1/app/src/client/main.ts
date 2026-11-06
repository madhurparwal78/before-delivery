import { addRoute, startRouter } from './router';
import { editorScreen } from './editor/editor';
import {
  agentsScreen,
  auditScreen,
  billingScreen,
  dashboardScreen,
  membersScreen,
  scenesScreen,
  settingsScreen,
} from './screens/app';
import {
  homeScreen,
  inviteScreen,
  loginScreen,
  pricingScreen,
  signupScreen,
} from './screens/public';
import { embedScreen, reviewScreen } from './screens/viewer';

addRoute('/', (root) => homeScreen(root));
addRoute('/pricing', (root) => pricingScreen(root));
addRoute('/signup', (root) => signupScreen(root));
addRoute('/login', (root) => loginScreen(root));
addRoute('/invite/:token', (root, params) => inviteScreen(root, params.token ?? ''));
addRoute('/app', (root) => dashboardScreen(root));
addRoute('/app/scenes', (root) => scenesScreen(root));
addRoute('/app/scenes/:sceneId', (root, params) => editorScreen(root, params.sceneId ?? ''));
addRoute('/app/members', (root) => membersScreen(root));
addRoute('/app/agents', (root) => agentsScreen(root));
addRoute('/app/audit', (root) => auditScreen(root));
addRoute('/app/billing', (root) => billingScreen(root));
addRoute('/app/settings', (root) => settingsScreen(root));
addRoute('/review/:token', (root, params) => reviewScreen(root, params.token ?? ''));
addRoute('/embed/:embedId', (root, params) => embedScreen(root, params.embedId ?? ''));

startRouter();
