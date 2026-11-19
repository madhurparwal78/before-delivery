import { Link } from "react-router-dom";
import { ArrowUpRight } from "../components/Icons.jsx";

export default function Signin() {
  return (
    <div className="chooser">
      <h1>Sign in to your Wayline account</h1>
      <p className="lede">Choose where your workspace runs. Both open the same console.</p>
      <div className="chooser-cards">
        <section className="chooser-card" aria-labelledby="cloud-title">
          <span className="label" style={{ color: "#b9b0ff" }}>Hosted</span>
          <h2 id="cloud-title">Wayline Cloud</h2>
          <p>Connections, syncs and the warehouse console, run for you.</p>
          <Link to="/login" className="btn btn-primary">Sign in to Cloud <ArrowUpRight width="16" height="16" /></Link>
        </section>
        <section className="chooser-card" aria-labelledby="hybrid-title">
          <span className="label" style={{ color: "#b9b0ff" }}>Self-managed</span>
          <h2 id="hybrid-title">Wayline Hybrid</h2>
          <p>The same console with the data plane running inside your network.</p>
          <Link to="/login" className="btn btn-primary">Sign in to Hybrid <ArrowUpRight width="16" height="16" /></Link>
        </section>
      </div>
    </div>
  );
}
