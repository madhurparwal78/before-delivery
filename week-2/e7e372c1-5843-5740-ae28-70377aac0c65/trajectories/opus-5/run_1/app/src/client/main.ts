import { getSessionUser } from './api';
import { mountBoard } from './board';
import { mountCitation } from './citation';
import { mountEditor } from './editor';
import { mountOperator } from './operator';
import { mountRestatementList, mountSignIn } from './staff';

const CITE_PATTERN = /^\/cite\/([^/]+)\/([^/]+)$/;
const EDITOR_PATTERN = /^\/staff\/restatements\/([^/]+)$/;

async function mount(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) return;
  const path = window.location.pathname;

  if (path === '/') {
    mountBoard(root);
    return;
  }

  const cite = CITE_PATTERN.exec(path);
  if (cite !== null) {
    mountCitation(root, decodeURIComponent(cite[1] as string), decodeURIComponent(cite[2] as string));
    return;
  }

  if (path === '/staff') {
    mountSignIn(root);
    return;
  }

  const session = await getSessionUser();
  if (session.kind !== 'success') {
    window.location.assign('/staff');
    return;
  }
  const user = session.value.user;

  if (path === '/staff/restatements') {
    mountRestatementList(root, user);
    return;
  }
  const editor = EDITOR_PATTERN.exec(path);
  if (editor !== null) {
    mountEditor(root, user, decodeURIComponent(editor[1] as string));
    return;
  }
  if (path === '/operator') {
    mountOperator(root, user);
  }
}

void mount();
