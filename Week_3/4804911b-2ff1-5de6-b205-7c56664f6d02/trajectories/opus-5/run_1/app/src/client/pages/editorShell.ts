import { copy, openRowsSentence, slides } from '../copy.js';

/** The editor call sheet markup: one place for its named regions and controls. */
export const EDITOR_SKELETON = `
<main class="editor">
  <header class="desk-head">
    <h1>Price desk</h1>
    <p class="counts" data-counts></p>
    <button type="button" data-sign-out>Sign out</button>
  </header>
  <div role="alert" aria-label="Message status" data-message-alert hidden></div>
  <div role="alert" aria-label="Work status" data-work-alert hidden></div>
  <div role="region" aria-label="Held work" data-held-work></div>
  <div role="status" aria-label="Work status" data-work-status></div>

  <div class="editor-grid">
    <section class="panel call-sheet">
      <h2>Import desk</h2>
      <form class="form-block" data-import-form>
        <div class="field">
          <label for="price-sheet-file">Price sheet file</label>
          <input id="price-sheet-file" type="file" data-sheet-file>
        </div>
        <button type="submit" data-import-sheet>Import sheet</button>
      </form>
      <div role="status" aria-label="Import status" data-import-status></div>
      <div role="region" aria-label="Matched" data-matched></div>
      <div role="region" aria-label="Ambiguous" data-ambiguous></div>
      <div role="region" aria-label="Unmatched" data-unmatched></div>

      <h2>Sheets on file</h2>
      <div data-sheets></div>
      <form class="form-block" data-draft-form>
        <div class="field">
          <label for="draft-title">Draft title</label>
          <input id="draft-title" type="text" aria-label="Draft title" data-draft-title>
        </div>
        <div class="field">
          <label for="draft-effective">Draft effective date</label>
          <input id="draft-effective" type="text" aria-label="Draft effective date" placeholder="YYYY-MM-DD" data-draft-effective>
        </div>
        <div data-draft-buttons></div>
      </form>
    </section>

    <section class="panel">
      <h2>Drafts</h2>
      <div role="status" aria-label="Publish status" data-publish-status></div>
      <div data-drafts></div>

      <h2>Published notices</h2>
      <div role="status" aria-label="Print status" data-print-status></div>
      <div data-notices></div>

      <h2>Renames and history</h2>
      <form class="form-block" data-rename-drink-form>
        <div class="field">
          <label for="drink-select">Drink</label>
          <select id="drink-select" aria-label="Drink" data-drink-select></select>
        </div>
        <div class="field">
          <label for="new-drink-name">New drink name</label>
          <input id="new-drink-name" type="text" aria-label="New drink name" data-new-drink-name>
        </div>
        <button type="submit" data-rename-drink>Rename drink</button>
      </form>
      <form class="form-block" data-rename-pack-form>
        <div class="field">
          <label for="pack-select">Pack</label>
          <select id="pack-select" aria-label="Pack" data-pack-select></select>
        </div>
        <div class="field">
          <label for="new-pack-wording">New pack wording</label>
          <input id="new-pack-wording" type="text" aria-label="New pack wording" data-new-pack-wording>
        </div>
        <button type="submit" data-rename-pack>Rename pack</button>
      </form>
      <div role="status" aria-label="Rename status" data-rename-status></div>
      <div role="region" aria-label="Pack history" data-pack-history></div>

      <h2>Batches</h2>
      <form class="form-block" data-batch-form>
        <div class="field">
          <label for="new-batch-code">New batch code</label>
          <input id="new-batch-code" type="text" aria-label="New batch code" data-new-batch-code>
        </div>
        <div class="field">
          <label for="batch-pack">Batch pack</label>
          <select id="batch-pack" aria-label="Batch pack" data-batch-pack></select>
        </div>
        <div class="field checkbox">
          <input id="old-wrapper" type="checkbox" aria-label="Old wrapper" data-old-wrapper>
          <label for="old-wrapper">Old wrapper</label>
        </div>
        <button type="submit" data-register-batch>Register batch</button>
      </form>
      <div role="status" aria-label="Batch status" data-batch-status></div>
    </section>
  </div>

  <div class="desk-bar" role="region" aria-label="Desk bar" data-desk-bar hidden>
    <p data-open-rows></p>
    <button type="button" data-next-open-row>Next open row</button>
  </div>

  <div class="modal" role="dialog" aria-modal="true" aria-label="Confirm publish" data-confirm-dialog hidden>
    <div class="modal-body">
      <h2>Confirm publish</h2>
      <ul aria-label="Packs that take the sticker" data-sticker-packs></ul>
      <p class="italic">${copy.confirmWarning}</p>
      <div role="status" aria-label="Confirm status" data-confirm-status></div>
      <button type="button" data-publish-now>Publish notice now</button>
      <button type="button" data-keep-editing>Keep editing</button>
    </div>
  </div>

  <div class="modal" role="dialog" aria-modal="true" aria-label="Correct notice" data-correct-dialog hidden>
    <div class="modal-body">
      <h2>Correct notice</h2>
      <div data-correct-fields></div>
      <div role="region" aria-label="Publish preview correction" data-correct-preview></div>
      <div role="status" aria-label="Preview status correction" data-correct-preview-status></div>
      <div data-correct-refused></div>
      <button type="button" data-publish-correction>Publish correction</button>
    </div>
  </div>
</main>
`;

export const EMPTY_SHEETS = `<div class="slide"><p class="slide-line">${slides.noSheets.line}</p><p class="slide-note">${slides.noSheets.note}</p></div>`;
export const EMPTY_DRAFTS = `<div class="slide"><p class="slide-line">${slides.noDrafts.line}</p><p class="slide-note">${slides.noDrafts.note}</p></div>`;

export function openRowsText(count: number): string {
  return openRowsSentence(count);
}
