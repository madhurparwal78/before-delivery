import { copy, likesText } from '../../shared/copy.js';
import { ISLANDS, islandName } from '../../shared/islands.js';
import { errorMessage } from '../../shared/errors.js';
import type { BoardEntry } from '../domain/boards.js';
import type { Hall } from '../domain/halls.js';
import type { Note } from '../domain/notes.js';
import type { PhotoAnswer } from '../domain/photos.js';
import type { PlayerRow } from '../domain/players.js';
import type { PublicPostcard } from '../domain/postcards.js';
import { figure, header, statusRegion } from './chrome.js';
import { escape, page } from './html.js';

export function signUpPage(): string {
  return page(
    { title: 'Create an account — Hushfoot', bodyClass: 'form-page', bootstrap: { page: 'signup' } },
    `${header(null, 0)}
<main id="main" class="form-main">
<h1>Create an account</h1>
${statusRegion('Account status', 'account-status')}
<form id="signup-form" class="panel-form" novalidate>
<label class="field"><span>Name</span><input type="text" id="signup-name" aria-label="Name" autocomplete="name"></label>
<label class="field"><span>Email</span><input type="email" id="signup-email" aria-label="Email" autocomplete="email"></label>
<label class="field"><span>Password</span><input type="password" id="signup-password" autocomplete="new-password"></label>
<button type="submit" id="create-account">Create account</button>
</form>
</main>`,
  );
}

export function signInPage(next: string): string {
  return page(
    { title: 'Sign in — Hushfoot', bodyClass: 'form-page', bootstrap: { page: 'signin', next } },
    `${header(null, 0)}
<main id="main" class="form-main">
<h1>Sign in</h1>
${statusRegion('Account status', 'account-status')}
<form id="signin-form" class="panel-form" novalidate>
<label class="field"><span>Email</span><input type="email" id="signin-email" aria-label="Email" autocomplete="email"></label>
<label class="field"><span>Password</span><input type="password" id="signin-password" autocomplete="current-password"></label>
<button type="submit" id="sign-in">Sign in</button>
</form>
<p><a href="/signup">Create an account</a></p>
</main>`,
  );
}

export function confirmPage(player: PlayerRow, film: number): string {
  return page(
    { title: 'Confirm your email — Hushfoot', bodyClass: 'form-page', bootstrap: { page: 'confirm' } },
    `${header(player, film)}
<main id="main" class="form-main">
<h1>Confirm your email</h1>
${statusRegion('Account status', 'account-status')}
<form id="confirm-form" class="panel-form" novalidate>
<label class="field"><span>Confirmation code</span><input type="text" id="confirm-code" aria-label="Confirmation code" autocomplete="one-time-code" inputmode="numeric"></label>
<button type="submit" id="confirm-submit">Confirm</button>
</form>
<p><button type="button" id="resend-code">Send a new code</button></p>
<p><a href="/play">Later</a></p>
</main>`,
  );
}

export function hallEditorPage(player: PlayerRow, film: number, hall: Hall, photos: PhotoAnswer[]): string {
  const frames = hall.frames
    .map(
      (frame, index) => `<li class="hall-item" tabindex="0" data-photo="${escape(frame.photo.id)}"
  data-creature="${escape(frame.photo.creature_name)}"
  aria-label="${escape(`${frame.photo.creature_name} photo, frame ${index + 1}`)}">
<img src="/api/photos/${escape(frame.photo.id)}/image" alt="${escape(frame.photo.creature_name)} photo" width="160" height="90">
<p class="hall-frame-name">${escape(`${frame.photo.creature_name} photo, frame ${index + 1}`)}</p>
<p>${figure('likes', likesText(frame.likes))}</p>
<label class="field"><span>Caption for ${escape(frame.photo.creature_name)} photo</span>
<input type="text" aria-label="Caption for ${escape(frame.photo.creature_name)} photo" value="${escape(frame.caption)}" class="hall-caption"></label>
<div class="hall-item-actions">
<button type="button" class="hall-up">Move ${escape(frame.photo.creature_name)} photo up</button>
<button type="button" class="hall-down">Move ${escape(frame.photo.creature_name)} photo down</button>
<button type="button" class="hall-remove">Take down ${escape(frame.photo.creature_name)} photo</button>
</div>
</li>`,
    )
    .join('');

  const hung = new Set(hall.frames.map((frame) => frame.photo.id));
  const yours = photos
    .filter((photo) => !hung.has(photo.id))
    .map(
      (photo) => `<li class="your-photo" data-photo="${escape(photo.id)}" data-creature="${escape(photo.creature_name)}">
<img src="/api/photos/${escape(photo.id)}/image" alt="${escape(photo.creature_name)} photo" width="120" height="68">
<p>${escape(photo.creature_name)} — ${photo.score.total} / 100</p>
<button type="button" class="hall-hang">Hang ${escape(photo.creature_name)} photo</button>
</li>`,
    )
    .join('');

  return page(
    {
      title: 'Your hall — Hushfoot',
      bodyClass: 'hall-editor',
      bootstrap: { page: 'hall-editor', hall, photos, handle: player.handle },
    },
    `${header(player, film)}
<main id="main" class="hall-main">
<h1>Your hall</h1>
${statusRegion('Gallery status', 'gallery-status')}
<div class="hall-editor-grid">
<section class="hall-order-section">
<h2>Hall order</h2>
<ul role="list" aria-label="Hall order" id="hall-order" class="hall-order">${frames}</ul>
<div class="hall-controls">
<button type="button" id="public-hall" role="switch" aria-checked="${hall.public ? 'true' : 'false'}">Public hall</button>
<button type="button" id="save-hall">Save hall</button>
<button type="button" id="sound" aria-pressed="false">Sound</button>
</div>
<p><a href="/hall/${escape(player.handle)}">Walk your hall</a></p>
</section>
<section class="your-photos-section">
<h2>Your photos</h2>
<ul role="list" aria-label="Your photos" id="your-photos" class="your-photos">${yours || `<li>${escape(copy.emptyHall)}</li>`}</ul>
</section>
</div>
</main>`,
  );
}

export function hallVisitPage(player: PlayerRow | null, film: number, hall: Hall, preset: string): string {
  const items = hall.frames
    .map(
      (frame) => `<li class="hung-photo" data-photo="${escape(frame.photo.id)}" data-creature="${escape(frame.photo.creature_name)}">
<img src="/api/photos/${escape(frame.photo.id)}/image" alt="${escape(frame.photo.creature_name)} photo" width="240" height="135">
<h3>${escape(frame.photo.creature_name)}</h3>
<p class="hung-score">${frame.photo.score.total} / 100</p>
<p class="hung-caption">${escape(frame.caption)}</p>
<p>${figure('likes', likesText(frame.likes))}</p>
<button type="button" class="like-photo" aria-pressed="${frame.liked_by_me ? 'true' : 'false'}">Like ${escape(frame.photo.creature_name)} photo</button>
<button type="button" class="view-photo">View ${escape(frame.photo.creature_name)} photo</button>
</li>`,
    )
    .join('');

  return page(
    {
      title: `${hall.owner_name}'s hall — Hushfoot`,
      bodyClass: 'hall-visit',
      bootstrap: { page: 'hall-visit', hall, preset, viewer: player ? { id: player.id, name: player.name } : null },
    },
    `${header(player, film)}
<main id="main" class="hall-visit-main">
<h1>${escape(hall.owner_name)}'s hall</h1>
${statusRegion('Gallery status', 'gallery-status')}
<div class="hall-visit-grid">
<div id="gallery-hall" role="application" aria-label="Gallery hall" tabindex="0"
  data-step="0" data-tile="2,13" data-heading="N" data-gait="idle" data-preset="${escape(preset)}" data-state="loading">
<canvas id="hall-scene" aria-hidden="true"></canvas>
</div>
<section>
<h2>Hung photos</h2>
<ul role="list" aria-label="Hung photos" id="hung-photos" class="hung-photos">${items || `<li>${escape(copy.emptyHall)}</li>`}</ul>
</section>
</div>
<div id="photo-viewer" class="dialog" role="dialog" aria-label="Photo viewer" aria-modal="true" data-zoom="1" hidden>
<h2>Photo viewer</h2>
<img id="photo-viewer-image" alt="" width="480" height="270">
<p><button type="button" id="photo-viewer-close">Close</button></p>
</div>
</main>`,
  );
}

export function noGalleryPage(player: PlayerRow | null, film: number): string {
  return page(
    { title: 'No gallery here — Hushfoot', bodyClass: 'hall-visit', bootstrap: { page: 'no-gallery' } },
    `${header(player, film)}
<main id="main" class="form-main">
<h1>${escape(copy.noGalleryHere)}</h1>
${statusRegion('Gallery status', 'gallery-status')}
</main>`,
  );
}

export function noteItem(note: Note, viewerId: string, authorId: string | null, ranger: boolean): string {
  const own = authorId === viewerId;
  return `<li class="note" data-note="${escape(note.id)}" data-status="${escape(note.status)}">
<p class="note-text">${escape(note.text)}</p>
<p class="note-author">${escape(note.author_name)}</p>
${note.status !== 'approved' && own ? `<p class="note-waiting">${escape(copy.waitingForRanger)}</p>` : ''}
${ranger && note.status === 'approved' ? '<button type="button" class="remove-note">Remove note</button>' : ''}
</li>`;
}

export function boardPage(
  player: PlayerRow,
  film: number,
  notes: (Note & { author_id?: string })[],
): string {
  const items = notes
    .map((note) =>
      noteItem(
        note,
        player.id,
        note.author_id ?? (note.author_name === player.name ? player.id : null),
        player.ranger,
      ),
    )
    .join('');
  return page(
    {
      title: 'Notice board — Hushfoot',
      bodyClass: 'board-page',
      bootstrap: { page: 'board', notes, viewer: player.id },
    },
    `${header(player, film)}
<main id="main" class="board-main">
<h1>Notice board</h1>
${statusRegion('Notes status', 'notes-status')}
<form id="note-form" class="panel-form" novalidate>
<label class="field"><span>Your note</span><input type="text" id="note-text" aria-label="Your note" autocomplete="off"></label>
<button type="submit" id="pin-note">Pin note</button>
</form>
<ul role="list" aria-label="Notice board" id="notice-board" class="notice-board">${items || `<li>${escape(copy.emptyNotes)}</li>`}</ul>
</main>`,
  );
}

export function rangerPage(player: PlayerRow, film: number, notes: Note[]): string {
  const allowed = player.ranger;
  const items = notes
    .map(
      (note) => `<li class="waiting-note" data-note="${escape(note.id)}">
<p class="note-text">${escape(note.text)}</p>
<p class="note-author">${escape(note.author_name)}</p>
<button type="button" class="approve-note">Approve</button>
<button type="button" class="decline-note">Decline</button>
</li>`,
    )
    .join('');
  return page(
    {
      title: 'Ranger — Hushfoot',
      bodyClass: 'ranger-page',
      bootstrap: { page: 'ranger', notes, allowed, notRanger: allowed ? null : errorMessage('not_ranger') },
    },
    `${header(player, film)}
<main id="main" class="ranger-main">
<h1>Waiting notes</h1>
${statusRegion('Notes status', 'notes-status')}
${
  allowed
    ? `<ul role="list" aria-label="Waiting notes" id="waiting-notes" class="waiting-notes">${items || `<li>${escape(copy.emptyRanger)}</li>`}</ul>
<div id="decline-dialog" class="dialog" role="dialog" aria-label="Decline note" aria-modal="true" hidden>
<h2>Decline note</h2>
<fieldset role="radiogroup" aria-label="Reason">
<legend>Reason</legend>
<label><input type="radio" name="reason" value="Not about the islands"> Not about the islands</label>
<label><input type="radio" name="reason" value="Unkind"> Unkind</label>
<label><input type="radio" name="reason" value="Shares personal details"> Shares personal details</label>
</fieldset>
<div class="dialog-actions"><button type="button" id="decline-confirm">Decline note</button></div>
</div>`
    : ''
}
</main>`,
  );
}

export function boardsPage(
  player: PlayerRow,
  film: number,
  island: number,
  entries: BoardEntry[],
  total: number,
  photos: PhotoAnswer[],
): string {
  const rows = entries
    .map(
      (entry) => `<tr data-handle="${escape(entry.handle)}">
<td>${entry.rank}</td><td>${escape(entry.player)}</td><td>${escape(entry.creature_name)}</td><td>${entry.total}</td>
</tr>`,
    )
    .join('');
  const radios = photos
    .map(
      (photo, index) => `<label class="radio"><input type="radio" name="board-photo" value="${escape(photo.id)}"
  aria-label="${escape(`${photo.creature_name} photo, ${photo.score.total}`)}"${index === 0 ? ' checked' : ''}> ${escape(photo.creature_name)} photo, ${photo.score.total}</label>`,
    )
    .join('');
  return page(
    {
      title: `${islandName(island)} board — Hushfoot`,
      bodyClass: 'boards-page',
      bootstrap: { page: 'boards', island, entries, total, photos },
    },
    `${header(player, film)}
<main id="main" class="boards-main">
<h1>${escape(islandName(island))} challenge board</h1>
${statusRegion('Board status', 'board-status')}
<div class="board-controls">
<label class="field"><span>Filter players</span><input type="search" id="filter-players" role="searchbox" aria-label="Filter players" autocomplete="off"></label>
<button type="button" id="open-enter-photo">Enter a photo</button>
</div>
<table class="board-table" id="board-table" aria-label="Challenge board">
<thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Creature</th><th scope="col">Score</th></tr></thead>
<tbody id="board-body">${rows || `<tr><td colspan="4">${escape(copy.emptyBoard)}</td></tr>`}</tbody>
</table>
<nav class="board-links" aria-label="Boards">${ISLANDS.map(
      (other) => `<a href="/boards/${other.id}">${escape(other.name)}</a>`,
    ).join('')}</nav>
<div id="enter-photo-dialog" class="dialog" role="dialog" aria-label="Enter a photo" aria-modal="true" hidden>
<h2>Enter a photo</h2>
<fieldset role="radiogroup" aria-label="Your photos" id="your-photos-group">
<legend>Your photos</legend>
${radios || '<p>No photos from this island yet.</p>'}
</fieldset>
<div class="dialog-actions"><button type="button" id="enter-photo">Enter photo</button></div>
</div>
</main>`,
  );
}

export function postcardPage(postcard: PublicPostcard): string {
  return page(
    { title: 'A postcard — Hushfoot', bodyClass: 'postcard-page', bootstrap: { page: 'postcard' } },
    `<header class="site-header"><a class="wordmark" href="/">Hushfoot</a></header>
<main id="main" class="postcard-main">
<h1>A postcard from ${escape(postcard.island_name)}</h1>
<img src="${escape(postcard.image_url)}" alt="${escape(postcard.creature_name)} photo" width="480" height="270">
<p class="postcard-line">${escape(postcard.line)}</p>
<ul class="postcard-facts">
<li>${escape(postcard.creature_name)}</li>
<li>${postcard.total} / 100</li>
<li>${escape(postcard.island_name)}</li>
</ul>
<p class="postcard-sender">Sent by ${escape(postcard.sender_name)}</p>
</main>`,
  );
}

export function noPostcardPage(): string {
  return page(
    { title: 'No postcard here — Hushfoot', bodyClass: 'postcard-page', bootstrap: { page: 'no-postcard' } },
    `<header class="site-header"><a class="wordmark" href="/">Hushfoot</a></header>
<main id="main" class="postcard-main"><h1>${escape(copy.noPostcardHere)}</h1></main>`,
  );
}
