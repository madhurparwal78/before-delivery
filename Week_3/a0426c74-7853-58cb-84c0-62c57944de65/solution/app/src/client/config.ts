// The three published settings the page needs, injected by the server shell as JSON.

interface ClientConfig {
  /** how long a toast stays (PLOT_TOAST_MS) */
  toastMs: number;
  /** margin around the view inside which entities keep a DOM element (PLOT_DOM_MARGIN_PX) */
  domMarginPx: number;
  /** most entity elements kept in the page (PLOT_DOM_CEILING) */
  domCeiling: number;
}

interface PlotConfigJson { toast_ms: number; dom_margin_px: number; dom_ceiling: number }

function readConfig(): PlotConfigJson {
  const text = document.getElementById('plot-config')?.textContent;
  if (!text) throw new Error('the page shell carries no #plot-config settings');
  return JSON.parse(text) as PlotConfigJson;
}

const json = readConfig();

export const config: ClientConfig = {
  toastMs: json.toast_ms,
  domMarginPx: json.dom_margin_px,
  domCeiling: json.dom_ceiling,
};
