import { mountLanguagePicker } from './language.js';
import { mountAuthPage } from './pages-auth.js';
import { mountHangar } from './pages-hangar.js';
import { mountBuilder } from './pages-builder.js';
import { mountForge } from './pages-forge.js';
import { mountArmoury, mountModels, mountStories } from './pages-craft.js';
import { mountLobby, mountParty, mountInvite } from './pages-lobby.js';
import { mountPlay, mountComplete } from './pages-play.js';
import { openRealtime } from './realtime-client.js';
import './app.css';

async function main(): Promise<void> {
  mountLanguagePicker();
  const kind = window.__lwKind ?? 'home';
  const path = location.pathname;
  if (kind === 'home' || kind === 'signup' || kind === 'signin' || kind === 'forgot-password' || kind === 'reset-password' || kind === 'verify') {
    mountAuthPage(kind as 'home');
    return;
  }
  if (kind === 'not-found') {
    const root = document.getElementById('root');
    if (root) {
      root.replaceChildren();
      const heading = document.createElement('h1');
      heading.textContent = document.title;
      root.append(heading);
      mountLanguagePicker();
    }
    return;
  }
  if (kind === 'hangar') await mountHangar();
  else if (kind === 'builder') await mountBuilder();
  else if (kind === 'forge') await mountForge();
  else if (kind === 'armoury') await mountArmoury();
  else if (kind === 'models') await mountModels();
  else if (kind === 'stories') await mountStories();
  else if (kind === 'lobby') await mountLobby();
  else if (kind === 'party-lobby') await mountParty(path.split('/')[2] ?? '');
  else if (kind === 'invite') await mountInvite(path.split('/')[2] ?? '');
  else if (kind === 'play') await mountPlay(path.split('/')[2] ?? '');
  else if (kind === 'chapter-complete') {
    const match = path.match(/^\/stories\/([^/]+)\/chapters\/(\d+)\/complete$/);
    await mountComplete(match?.[1] ?? '', match?.[2] ? parseInt(match[2], 10) : 0);
  }
  if (window.__lwSignedIn) openRealtime();
}

void main();
