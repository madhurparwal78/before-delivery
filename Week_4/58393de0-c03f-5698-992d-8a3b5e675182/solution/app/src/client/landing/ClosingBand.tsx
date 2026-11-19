import { Link } from "../lib/router";
import { useDestinations } from "./destinations";
import { ClosingDoodles } from "./doodles";

export function ClosingBand() {
  const { classroom } = useDestinations();
  return (
    <section className="closing-band">
      <ClosingDoodles />
      <div className="column closing-inner">
        <h2>Your first class can start this week</h2>
        <p>Create a classroom, read the join code to the room and watch every child's first model land on your roster. All they need is the code and a nickname.</p>
        <Link to={classroom} className="pill pill--white">Set up your first class</Link>
      </div>
    </section>
  );
}
