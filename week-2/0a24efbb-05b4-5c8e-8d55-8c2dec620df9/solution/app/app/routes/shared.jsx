import { data, useLoaderData } from "react-router";
import { Legend, MonthGrid, monthName } from "../month.jsx";
import { SharedPage } from "../page.jsx";

export async function loader({ params, context }) {
  const shared = await context.desk.sharedMonth(params.token);
  if (shared.status !== 200) throw data(null, { status: shared.status });
  return shared;
}

/** One person's month, read-only: the name and the counts, nothing else about them. */
export default function SharedMonth() {
  const { name, month, days } = useLoaderData();
  const title = `${name}, ${monthName(month)}`;
  return (
    <SharedPage title={title}>
      <h1>{title}</h1>
      <MonthGrid month={month} days={days} />
      <Legend />
    </SharedPage>
  );
}
