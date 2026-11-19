import type { LinkView } from '../../shared/types';
import { ApiRefusal, request } from '../shared/api';
import { must } from '../shared/dom';
import { renderBuyer } from './buyer';
import { endedLinkPage } from './endedPage';
import { renderInspector } from './inspector';
import { CaptureQueue } from './queue';

const ROLE_KEY = (token: string): string => `open-bonnet:role:${token}`;

const tokenFromPath = (): string => {
  const match = /^\/l\/([^/]+)/.exec(window.location.pathname);
  if (match === null) throw new Error('That is not a link address');
  return decodeURIComponent(match[1]);
};

/** With no signal the inspector page reads its last panels from the device. */
const offlineView = (token: string): LinkView | null => {
  const queue = new CaptureQueue(token);
  const car = queue.storedCar();
  const panels = queue.panels();
  if (car === null || panels.length === 0) return null;
  return {
    role: 'inspector',
    name: '',
    status: 'active',
    expiresAt: '',
    serverNow: new Date().toISOString(),
    car,
    panels,
  };
};

const start = async (): Promise<void> => {
  const root = must<HTMLElement>(document, '#app');
  const token = tokenFromPath();

  let view: LinkView;
  try {
    view = await request<LinkView>(`/api/link/${token}`);
  } catch (error) {
    if (error instanceof ApiRefusal && error.code === 'link_not_found') {
      endedLinkPage(root, 'unknown');
      return;
    }
    if (error instanceof ApiRefusal && (error.code === 'link_revoked' || error.code === 'link_expired')) {
      endedLinkPage(root, 'ended');
      return;
    }
    // With no signal the inspector page reads its last panels from the device.
    if (window.localStorage.getItem(ROLE_KEY(token)) === 'inspector') {
      const stored = offlineView(token);
      if (stored !== null) {
        renderInspector(root, token, stored);
        return;
      }
    }
    endedLinkPage(root, 'unknown');
    return;
  }

  window.localStorage.setItem(ROLE_KEY(token), view.role);
  if (view.role === 'inspector') {
    renderInspector(root, token, view);
    return;
  }
  renderBuyer(root, token, view);
};

void start();
