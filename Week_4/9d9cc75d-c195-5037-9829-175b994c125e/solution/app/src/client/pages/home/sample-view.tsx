// The home page's live sample: the engine runs in the browser on the bundled sample, so the page needs no account or request.
import { useMemo } from 'react';
import { sampleView } from '../../../server/engine/index.ts';
import { ChartView, DataTable } from '../../chart/index.ts';
import { usePhone } from '../../ui/phone.ts';

export function SampleView() {
  const { sheet, result } = useMemo(() => sampleView(), []);
  const phone = usePhone();
  return (
    <>
      <ChartView sheetName={sheet.name} sheet={sheet} result={result} touch={phone} compact={phone} />
      <DataTable sheetName={sheet.name} result={result} />
    </>
  );
}
