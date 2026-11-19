export interface PublicForm {
  name: string;
  fields: Array<{ name: string; label: string; type: 'text' | 'number' }>;
}

interface Settings {
  canvasBreakpointPx: number;
  timeZone: string;
  form: PublicForm | null;
}

/** The two values the server lets the browser know, plus the live form when the address names one. */
export const settings: Settings = JSON.parse(document.getElementById('switchyard-settings')?.textContent ?? '{}') as Settings;
