import { html, raw, type Html } from '../html.js';

export type ActionForm = {
  readonly label: string;
  readonly path: string;
  readonly success: string;
  readonly submit: string;
  readonly version?: number;
  readonly fields?: Html;
  readonly method?: 'POST' | 'PATCH';
};

/** A console write: one form the browser sends as JSON with its version and a fresh key. */
export function actionForm(action: ActionForm): Html {
  return html`
    <form class="console-action" data-console-form data-path="${action.path}"
      data-method="${action.method ?? 'POST'}" data-success="${action.success}"
      ${raw(action.version === undefined ? '' : `data-version="${action.version}"`)}
      aria-label="${action.label}" method="post" action="${action.path}">
      ${action.fields ?? html``}
      <button type="submit">${action.submit}</button>
    </form>
  `;
}

export function dialogAction(input: {
  readonly openLabel: string;
  readonly dialogLabel: string;
  readonly heading: string;
  readonly action: ActionForm;
}): Html {
  return html`
    <div class="dialog-host">
      <button type="button" data-dialog-open>${input.openLabel}</button>
      <dialog aria-label="${input.dialogLabel}" data-dialog>
        <h3>${input.heading}</h3>
        ${actionForm(input.action)}
        <button type="button" data-dialog-cancel>Cancel</button>
      </dialog>
    </div>
  `;
}

export function textField(input: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly multiline?: boolean;
  readonly value?: string;
  readonly placeholder?: string;
}): Html {
  return html`
    <p class="field">
      <label for="${input.id}">${input.label}</label>
      ${input.multiline === true
        ? html`<textarea id="${input.id}" name="${input.name}" rows="10"
            aria-label="${input.label}">${input.value ?? ''}</textarea>`
        : html`<input id="${input.id}" name="${input.name}" type="text"
            value="${input.value ?? ''}" aria-label="${input.label}"
            placeholder="${input.placeholder ?? ''}">`}
    </p>
  `;
}

export function selectField(input: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}): Html {
  return html`
    <p class="field">
      <label for="${input.id}">${input.label}</label>
      <select id="${input.id}" name="${input.name}" aria-label="${input.label}">
        ${input.options.map(
          (option) => html`<option value="${option.value}">${option.label}</option>`,
        )}
      </select>
    </p>
  `;
}
