import { usePage } from '../deskData.jsx';
import { monthTitle } from '../../shared/businessTime.js';
import { ui } from '../../shared/copy.js';
import { MonthGrid, MonthLegend } from '../components/MonthGrid.jsx';

export function SharedMonthScreen() {
  const page = usePage();
  return (
    <section className="shared-month">
      <h1>{ui.sharedMonthHeading(page.name, monthTitle(page.month))}</h1>
      <MonthGrid month={page.month} days={page.days} />
      <MonthLegend />
    </section>
  );
}
