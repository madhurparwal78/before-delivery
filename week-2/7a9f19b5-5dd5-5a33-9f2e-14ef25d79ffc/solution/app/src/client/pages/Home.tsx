import { ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { FittingStage } from "../components/Fitting3D";
import { Link } from "../lib/router";

export function Home() {
  useEffect(() => {
    document.title = "Lightfall · Southerly Light Works";
  }, []);
  return (
    <div className="home">
      <div className="home__scene">
        <FittingStage productName="Kauri Downlight" code="KDL-WH-36-3000" finish="WH" beam={36} cct={3000} interactive={false} fixedLight="night" />
      </div>
      <div className="home__overlay">
        <p className="home__eyebrow">Southerly Light Works</p>
        <h1 className="home__title">Lightfall</h1>
        <p className="home__intro">Choose a fitting down to its finish, beam and colour, see exactly where its light falls, and quote it at the right price.</p>
        <div className="home__links">
          <Link href="/catalogue" className="button button--primary">
            Browse the catalogue
            <ArrowRight aria-hidden="true" size={18} strokeWidth={1.5} />
          </Link>
          <Link href="/signup?account=trade" className="button button--quiet">
            Apply for a trade account
          </Link>
        </div>
      </div>
    </div>
  );
}
