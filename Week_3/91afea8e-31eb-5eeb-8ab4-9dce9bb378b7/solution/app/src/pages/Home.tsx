import type { ReactNode } from "react";
import { useTitle } from "../lib/hooks";
import { usePincode } from "../lib/pincode";
import { Categories } from "./home/Categories";
import { Deals } from "./home/Deals";
import { Hero } from "./home/Hero";
import { useDeals } from "./home/useDeals";
import "../styles/home.css";

export default function Home(): ReactNode {
  useTitle("everything. one cart.");
  const { pin } = usePincode();
  const deals = useDeals(pin);
  return (
    <>
      <Hero deals={deals} />
      <Deals state={deals} />
      <Categories counts={deals.counts} />
    </>
  );
}
