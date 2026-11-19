import type { GuideReading } from '../shared/types.js';
import { startEditor, type EditorBootstrap } from './editor.js';
import { startReader, type ReaderBootstrap } from './reader.js';
import {
  startAuth,
  startCollection,
  startDashboard,
  startHome,
  startSearch,
} from './screens.js';

interface Bootstrap {
  page: string;
  [key: string]: unknown;
}

function readBootstrap(): Bootstrap {
  const element = document.getElementById('bootstrap');
  if (element === null) return { page: 'notice' };
  return JSON.parse(element.textContent ?? '{}') as Bootstrap;
}

export function startPage(): void {
  const data = readBootstrap();
  switch (data.page) {
    case 'home':
      startHome((data['guide'] ?? null) as GuideReading | null);
      break;
    case 'reader':
      startReader(data as unknown as ReaderBootstrap, 'reader');
      break;
    case 'embed':
      startReader(data as unknown as ReaderBootstrap, 'embed');
      break;
    case 'editor':
      startEditor(data as unknown as EditorBootstrap);
      break;
    case 'dashboard':
      startDashboard(data as unknown as Parameters<typeof startDashboard>[0]);
      break;
    case 'search':
      startSearch(data as unknown as Parameters<typeof startSearch>[0]);
      break;
    case 'collection':
      startCollection(data as unknown as Parameters<typeof startCollection>[0]);
      break;
    case 'signin':
    case 'signup':
    case 'confirm':
      startAuth(data as unknown as Parameters<typeof startAuth>[0]);
      break;
    default:
      break;
  }
}
