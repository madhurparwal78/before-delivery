import type { Bootstrap } from '../shared/types';
import { api } from './api';
import { BoardView } from './board/view';
import { renderSignIn, renderSignUp } from './screens/auth';
import { renderDashboard } from './screens/dashboard';
import { renderLanding } from './screens/landing';
import { renderInvite, renderNotFound, renderPasswordScreen } from './screens/simple';

declare global {
  interface Window {
    __PINSHEET__: Bootstrap;
  }
}

const boot = window.__PINSHEET__;
const root = document.getElementById('app');
if (root === null) throw new Error('app root missing');

const screen = boot.screen;

switch (screen.name) {
  case 'landing':
    renderLanding(root, screen.frames);
    break;
  case 'signup':
    renderSignUp(root);
    break;
  case 'signin':
    renderSignIn(root);
    break;
  case 'dashboard':
    if (boot.user !== null) void renderDashboard(root, boot.user);
    break;
  case 'board':
    void new BoardView(root, { kind: 'board', boardId: screen.board_id }, boot.user, boot.services, boot.upload_max_bytes).start();
    break;
  case 'share':
    if (boot.user === null) {
      void new BoardView(root, { kind: 'share', token: screen.token }, null, boot.services, boot.upload_max_bytes).start();
    } else {
      void api
        .post<{ board_id: string }>(`/api/links/${screen.token}/join`)
        .then((result) => window.location.assign(`/b/${result.board_id}`));
    }
    break;
  case 'embed':
    void new BoardView(root, { kind: 'embed', token: screen.token }, boot.user, boot.services, boot.upload_max_bytes).start();
    break;
  case 'invite':
    void renderInvite(root, screen.token, boot.user);
    break;
  case 'password':
    renderPasswordScreen(root, { boardId: screen.board_id, token: screen.token });
    break;
  case 'not_found':
    renderNotFound(root);
    break;
  default:
    renderNotFound(root);
}
