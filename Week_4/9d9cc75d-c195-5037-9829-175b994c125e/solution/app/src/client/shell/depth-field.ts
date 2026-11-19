import { useLayoutEffect } from 'react';

type DepthField = 'pale' | 'sheet' | 'dashboard' | 'plum';

/**
 * Paints the page's floor-to-ceiling colour: `pale` for raw data pages (the default), `sheet` for editable sheets,
 * `dashboard` for dashboards, `plum` for published views a viewer opens. Call it from the page component.
 */
export function useDepthField(field: DepthField): void {
  useLayoutEffect(() => {
    document.body.dataset.field = field;
    return () => {
      document.body.dataset.field = 'pale';
    };
  }, [field]);
}
