import { copy } from './copy.js';
import { el } from './dom.js';
import { stamp } from './format.js';
import { api, RequestFailed } from './net.js';
import { StatusBoard } from './workspace/status.js';

interface ReviewFile {
  path: string;
  content: string;
}

interface ReviewPayload {
  checkpoint: {
    name: string;
    saved_at: string;
    expires_at: string;
    files: ReviewFile[];
  };
}

const root = document.getElementById('root');
const statuses = new StatusBoard();

function message(cause: RequestFailed): string {
  if (cause.code === 'link_expired') return copy.review.expired;
  if (cause.code === 'link_revoked') return copy.review.revoked;
  if (cause.code === 'link_not_found') return copy.review.notFound;
  if (cause.code === 'checkpoint_damaged') return copy.review.damaged;
  if (cause.code === 'storage_unavailable') return copy.review.storageOutage;
  return copy.generic;
}

async function render(): Promise<void> {
  if (root === null) return;
  const heading = el('h1', {});
  const stamps = el('div', { class: 'stamps' });
  const paths = el('div', { class: 'paths' });
  const files = el('div', { role: 'list', 'aria-label': 'Files' });
  const status = statuses.create('Review status');
  const page = el('div', { class: 'review' }, [heading, stamps, status, paths, files]);
  root.replaceChildren(page);
  statuses.set('Review status', copy.review.loading);

  const token = location.pathname.slice('/review/'.length);
  try {
    const loaded = await api<ReviewPayload>(`/api/review/${token}`);
    const checkpoint = loaded.checkpoint;
    heading.append(checkpoint.name);
    stamps.append(
      el('div', {}, [stamp(checkpoint.saved_at)]),
      el('div', {}, [`Link expires ${stamp(checkpoint.expires_at)}`]),
    );
    for (const file of checkpoint.files) {
      paths.append(el('div', {}, [file.path]));
      files.append(
        el('div', { role: 'listitem' }, [
          el('div', { role: 'region', 'aria-label': file.path, class: 'file-block' }, [
            el('h3', {}, [file.path]),
            el('pre', {}, [el('code', {}, [file.content])]),
          ]),
        ]),
      );
    }
    statuses.clear('Review status');
  } catch (cause) {
    if (!(cause instanceof RequestFailed)) throw cause;
    statuses.error('Review status', message(cause));
  }
}

void render();
