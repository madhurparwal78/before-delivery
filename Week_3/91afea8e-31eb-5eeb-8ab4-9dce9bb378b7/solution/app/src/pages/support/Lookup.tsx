import { Search } from "lucide-react";
import { useRef, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { Empty } from "../../components/Empty";
import { useTitle } from "../../lib/hooks";
import { StaffGate } from "../seller/staff";
import "../../styles/support.css";

function LookupPage(): ReactNode {
  useTitle("order lookup");
  const navigate = useNavigate();
  const field = useRef<HTMLInputElement>(null);

  const find = (event: FormEvent): void => {
    event.preventDefault();
    const id = (field.current?.value ?? "").trim();
    if (id === "") {
      field.current?.focus();
      return;
    }
    navigate(`/support/orders/${encodeURIComponent(id)}`);
  };

  return (
    <>
      <section className="panel panel--ground staff-head">
        <h1>order lookup</h1>
      </section>
      <section className="panel panel--yellow lookup-panel">
        <form className="lookup" role="search" onSubmit={find}>
          <input ref={field} type="search" aria-label="Order ID" placeholder="CH-XXXXXXXX" autoComplete="off" />
          <Button type="submit">
            <Search size={22} aria-hidden="true" />
            Find order
          </Button>
        </form>
      </section>
      <div className="support-empty">
        <Empty tone="black" sign="box">
          find an order to see its parcels, payments and refunds.
        </Empty>
      </div>
    </>
  );
}

export default function Lookup(): ReactNode {
  return (
    <StaffGate role="support">
      <LookupPage />
    </StaffGate>
  );
}
