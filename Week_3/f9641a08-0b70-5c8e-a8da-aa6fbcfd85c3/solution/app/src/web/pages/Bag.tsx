import { useEffect } from "react";
import { BagLines, BagSummary, EmptyBag } from "../components/BagContents";
import { announce, refreshCart, useApp } from "../lib/store";

export function Bag() {
  const { cart } = useApp();
  useEffect(() => {
    void refreshCart().then((fresh) => {
      const notice = fresh.notices[fresh.notices.length - 1];
      if (notice) announce(notice);
    });
  }, []);

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="page bag-page">
        <div className="axis">
          <div className="zone" />
          <div className="main">
            <h1>Your bag</h1>
            <EmptyBag />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="page bag-page">
      <div className="axis bag-axis">
        <div className="zone">
          <BagSummary cart={cart} />
        </div>
        <div className="main">
          <h1>Your bag</h1>
          <BagLines cart={cart} />
        </div>
      </div>
    </div>
  );
}
