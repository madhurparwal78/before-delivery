export interface FormFieldSetting {
  name: string;
  label: string;
  type: 'text' | 'number';
}

export interface FormBootstrap {
  name: string;
  fields: FormFieldSetting[];
}

export interface Settings {
  canvas_breakpoint_px: number;
  time_zone: string;
  form: FormBootstrap | null;
}

function read(): Settings {
  const element = document.getElementById('switchyard-settings');
  if (element === null || element.textContent === null) {
    return { canvas_breakpoint_px: 720, time_zone: 'UTC', form: null };
  }
  return JSON.parse(element.textContent) as Settings;
}

export const settings: Settings = read();

export function isWideViewport(): boolean {
  return window.innerWidth >= settings.canvas_breakpoint_px;
}
