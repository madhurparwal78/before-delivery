import { useEffect, useState } from "react";
import { api, RequestError } from "../lib/api";
import { Link } from "../lib/router";
import { useSession } from "../session";
import { COPY } from "../../shared/copy";
import { longDate, type Order, type Plan, type ProjectSummary } from "../../shared/domain";
import { money } from "../../shared/money";
import { FoldMotif } from "./FoldMotif";
import { planLabel } from "./Plan";

export function stateWord(state: string): string {
  return state.replace(/_/g, " ");
}

type PlanView = { state: "none" | "outage" | "ok"; plan: Plan | null };
type OverviewData = { orders: Order[] | null; plan: PlanView; projects: ProjectSummary[] };

function Orders({ orders }: { orders: Order[] | null }) {
  return (
    <section aria-labelledby="orders-title" className="ledger-section">
      <h2 id="orders-title">Orders</h2>
      {orders === null ? <p className="notice">We couldn't load your orders. Try again in a moment.</p> : null}
      {orders && orders.length === 0 ? <p className="muted">No orders yet.</p> : null}
      {orders && orders.length ? (
        <div className="table-frame">
          <table className="ledger-table" aria-label="Orders">
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Plan</th>
                <th scope="col">State</th>
                <th scope="col" className="num">Total</th>
                <th scope="col">Next step</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="mono">{order.number}</td>
                  <td>{order.planName}</td>
                  <td><span className={`pill pill--${order.state}`}>{stateWord(order.state)}</span></td>
                  <td className="num mono">{money(order.total, order.currency)}</td>
                  <td>
                    {order.state === "balance_invoiced" ? (
                      <Link href={`/checkout/${order.id}`} className="button button--primary button--small">Pay launch balance</Link>
                    ) : order.state === "quoted" || order.state === "accepted" ? (
                      <Link href={`/checkout/${order.id}`}>Continue checkout</Link>
                    ) : order.payments.length ? (
                      <Link href={`/orders/${order.id}/receipt`}>Latest receipt</Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function PlanSummary({ view }: { view: PlanView }) {
  const { state, plan } = view;
  return (
    <section aria-labelledby="plan-summary-title" className="ledger-section">
      <h2 id="plan-summary-title">Care plan</h2>
      {state === "outage" ? <p className="notice notice--seam">{COPY.planReadOutage}</p> : null}
      {state === "none" ? (
        <p className="muted">
          No care plan yet. <Link href="/#pricing">See the care plans</Link>.
        </p>
      ) : null}
      {plan ? (
        <div className="summary-row">
          <p>
            <strong>{plan.planName}</strong> · <span className="mono">{money(plan.monthlyPrice, plan.currency)}</span> a month
          </p>
          <p>Status: {planLabel(plan)}</p>
          {plan.chargedThrough ? <p className="muted">Paid through {longDate(plan.chargedThrough)}</p> : null}
          <p><Link href="/portal/plan">Manage your plan</Link></p>
        </div>
      ) : null}
    </section>
  );
}

function Projects({ projects }: { projects: ProjectSummary[] }) {
  return (
    <section id="projects" aria-labelledby="projects-title" className="ledger-section">
      <h2 id="projects-title">Projects</h2>
      {projects.length === 0 ? (
        <div className="empty">
          <FoldMotif />
          <p>No projects to show yet. A project opens when a build's deposit is paid.</p>
        </div>
      ) : (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/portal/projects/${project.id}`} className="project-link">
                <span className="project-link__name">{project.businessName}</span>
                <span className="project-link__meta">
                  <span className="mono">{project.orderNumber}</span> · {project.planName} · {stateWord(project.state)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One load for every section, so no section pushes another down as its data arrives. */
function loadOverview(owner: boolean): Promise<OverviewData> {
  const orders = owner
    ? api<{ orders: Order[] }>("/api/orders").then((body) => body.orders, () => null)
    : Promise.resolve([]);
  const plan: Promise<PlanView> = owner
    ? api<{ plan: Plan }>("/api/plan").then(
        (body) => ({ state: "ok", plan: body.plan }),
        (error) => ({ state: error instanceof RequestError && error.status === 404 ? "none" : "outage", plan: null }),
      )
    : Promise.resolve({ state: "none", plan: null });
  const projects = api<{ projects: ProjectSummary[] }>("/api/projects").then((body) => body.projects, () => []);
  return Promise.all([orders, plan, projects]).then(([o, p, pr]) => ({ orders: o, plan: p, projects: pr }));
}

export function Overview() {
  const { user } = useSession();
  const owner = user?.role === "client_owner";
  const [data, setData] = useState<OverviewData | null>(null);
  useEffect(() => {
    let live = true;
    void loadOverview(owner).then((loaded) => {
      if (live) setData(loaded);
    });
    return () => {
      live = false;
    };
  }, [owner]);
  return (
    <div className="ledger-page">
      <p className="eyebrow">Overview</p>
      <h1>{user?.role === "contractor" ? "Your assigned projects" : `Hello, ${user?.name.split(" ")[0] ?? ""}`}</h1>
      {data === null ? (
        <p className="muted">Loading your portal…</p>
      ) : (
        <>
          {owner ? <Orders orders={data.orders} /> : null}
          {owner ? <PlanSummary view={data.plan} /> : null}
          <Projects projects={data.projects} />
        </>
      )}
    </div>
  );
}
