'use strict';
const { e } = require('./html');

function shell(key, name, primary, inner) {
  return `<div class="dialog-backdrop" data-dialog="${e(key)}" hidden>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="${e(name)}" data-dialog-name="${e(name)}">
    <h2 class="panel-title dialog-title">${e(name)}</h2>
    <form class="dialog-form" data-dialog-form="${e(key)}" novalidate>
      <div class="dialog-body">${inner}</div>
      <div class="dialog-actions">
        <button type="button" class="button button-quiet" data-dialog-cancel>Cancel</button>
        <button type="submit" class="button button-primary" data-dialog-primary>${e(primary)}</button>
      </div>
      <p class="dialog-error" data-dialog-error hidden></p>
    </form>
  </div>
</div>`;
}

function newView(columns) {
  const inner = `
<div class="field">
  <label class="control-label" for="view-name">Name</label>
  <input class="control" id="view-name" name="name" type="text">
</div>
<div class="field">
  <label class="control-label" for="view-visibility">Visibility</label>
  <select class="control" id="view-visibility" name="visibility">
    <option value="private">private</option>
    <option value="shared">shared</option>
  </select>
</div>
<div class="dialog-subactions">
  <button type="button" class="button button-quiet" id="add-filter" data-add-filter>Add filter</button>
  <button type="button" class="button button-quiet" id="add-sort" data-add-sort>Add sort</button>
</div>
<div class="filter-groups" id="filter-groups" data-filter-groups></div>
<div class="sort-groups" id="sort-groups" data-sort-groups></div>
<script type="application/json" id="view-columns">${JSON.stringify(columns).replace(/</g, '\\u003c')}</script>`;
  return shell('new-view', 'New view', 'Save view', inner);
}

function editRow(columns) {
  const fields = columns
    .map((c, i) => {
      const id = 'row-field-' + i;
      let control;
      if (c.type === 'flag') {
        control = `<select class="control" id="${id}" data-column="${e(c.caption)}" data-type="flag">
  <option value="">(no value)</option>
  <option value="true">true</option>
  <option value="false">false</option>
</select>`;
      } else if (c.type === 'choice') {
        control = `<select class="control" id="${id}" data-column="${e(c.caption)}" data-type="choice">
  <option value="">(no value)</option>
  ${(c.options || []).map((o) => `<option value="${e(o)}">${e(o)}</option>`).join('')}
</select>`;
      } else {
        control = `<input class="control" id="${id}" type="text" data-column="${e(c.caption)}" data-type="${e(c.type)}">`;
      }
      return `<div class="field"><label class="control-label" for="${id}">${e(c.caption)}</label>${control}</div>`;
    })
    .join('');
  return shell('edit-row', 'Edit row', 'Save row', fields);
}

function decideRequest() {
  const inner = `
<p class="dialog-context" data-request-context></p>
<div class="field">
  <label class="control-label" for="decision">Decision</label>
  <select class="control" id="decision" name="decision">
    <option value="approved">approved</option>
    <option value="declined">declined</option>
  </select>
</div>
<div class="field">
  <label class="control-label" for="decision-reason">Reason</label>
  <input class="control" id="decision-reason" name="reason" type="text">
</div>`;
  return shell('decide-request', 'Decide request', 'Record decision', inner);
}

function publishSnapshot(tables) {
  const inner = `
<div class="field">
  <label class="control-label" for="snapshot-table">Table</label>
  <select class="control" id="snapshot-table" name="table">
    ${tables.map((t) => `<option value="${e(t.slug)}">${e(t.name)}</option>`).join('')}
  </select>
</div>
<div class="field">
  <label class="control-label" for="snapshot-period">Period</label>
  <input class="control" id="snapshot-period" name="period" type="text">
</div>`;
  return shell('publish-snapshot', 'Publish snapshot', 'Publish', inner);
}

function confirmBulkRevoke() {
  const inner = `
<p class="dialog-context">Revoking is permanent. The confirmation phrase is read before the named grants are.</p>
<div class="field">
  <label class="control-label" for="confirmation-phrase">Confirmation phrase</label>
  <input class="control" id="confirmation-phrase" name="confirmation" type="text" autocomplete="off">
</div>`;
  return shell('confirm-bulk-revoke', 'Confirm bulk revoke', 'Revoke', inner);
}

module.exports = { newView, editRow, decideRequest, publishSnapshot, confirmBulkRevoke };
