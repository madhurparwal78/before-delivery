import { h } from "./dom.js";

interface RadioOption { value: string; label: string }

interface RadioConfig {
  label: string;
  name: string;
  className: string;
  options: readonly RadioOption[];
  checked: string;
  onChange(value: string): void;
}

/**
 * Native radios in a labelled group: one Tab stop, arrow keys check the next radio, a click checks one.
 * `setChecked` checks a radio without calling `onChange`; `setOptions` replaces the radios (the Moments change with the mode).
 */
export function createRadioGroup({ label, name, className, options, checked, onChange }: RadioConfig) {
  const element = h("div", { class: `radio-group ${className}`, role: "radiogroup", "aria-label": label });
  let current = checked;

  const build = (choices: readonly RadioOption[], value: string): void => {
    current = value;
    element.replaceChildren(...choices.map((choice) => {
      const input = h("input", { type: "radio", name, value: choice.value });
      input.checked = choice.value === value;
      input.addEventListener("change", () => {
        if (!input.checked || current === choice.value) return;
        current = choice.value;
        onChange(choice.value);
      });
      return h("label", { class: "radio" }, input, h("span", { class: "radio-label" }, choice.label));
    }));
  };

  build(options, checked);
  return {
    element,
    checked: () => current,
    setChecked(value: string): void {
      current = value;
      for (const input of element.querySelectorAll("input")) input.checked = input.value === value;
    },
    setOptions: build,
  };
}
