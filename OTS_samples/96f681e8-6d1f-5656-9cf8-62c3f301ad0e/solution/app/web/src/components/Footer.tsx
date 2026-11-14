import { Link } from "../router";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <p className="site-footer__wordmark">Marlowe Yard Padel Club</p>
        </div>
        <div className="site-footer__columns">
          <nav aria-labelledby="footer-play">
            <h2 id="footer-play">Play</h2>
            <ul>
              <li>
                <Link to="/courts">Courts</Link>
              </li>
              <li>
                <Link to="/matches">Matches</Link>
              </li>
              <li>
                <Link to="/me">My bookings</Link>
              </li>
            </ul>
          </nav>
          <nav aria-labelledby="footer-club">
            <h2 id="footer-club">Club</h2>
            <ul>
              <li>
                <Link to="/#house-rules">House rules</Link>
              </li>
              <li>
                <Link to="/#coaches">Coaches</Link>
              </li>
            </ul>
          </nav>
        </div>
        <p className="site-footer__legal">© 2026 Marlowe Yard Padel Club</p>
      </div>
    </footer>
  );
}
