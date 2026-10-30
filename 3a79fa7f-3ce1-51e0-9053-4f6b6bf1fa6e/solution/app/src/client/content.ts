// Storefront copy the brief leaves to the shop (lineup blurbs, press quotes, rider questions).
export const BOARD_COPY: Record<string, { anchor: string; rider: string; line: string; material: string }> = {
  Drift: { anchor: "drift", rider: "First flights", line: "A wide, forgiving deck that lifts early and stays level while you learn.", material: "Glass-fibre sandwich" },
  Crest: { anchor: "crest", rider: "Longest range", line: "Built around the bigger pack for long, quiet coastal runs.", material: "Full carbon" },
  Swift: { anchor: "swift", rider: "Lightest carry", line: "The lightest board in the range: quick to turn and easy to take anywhere.", material: "Carbon over a foam core" },
};

export const PRESS = [
  { quote: "The quietest electric foil we have ridden. You hear the water, not the motor.", source: "Glide Quarterly" },
  { quote: "Swapping a wing took less time than pulling on a wetsuit.", source: "Open Water Rider" },
  { quote: "The Drift had a first-timer flying on day one, and level the whole way.", source: "Foil and Fin Review" },
  { quote: "A small workshop that sweats the details the big brands skip.", source: "Shoreline Monthly" },
];

export const QUESTIONS = [
  { q: "How long does it take to learn?", a: "Most riders fly on their first demo day. On a Drift, plan on two or three sessions before you hold long, level flights." },
  { q: "Do I need a licence to ride?", a: "Rules depend on your water. Many lakes and coasts treat an electric foil like a small craft; check with your local authority before you ride." },
  { q: "How does the snap-fit system work?", a: "Masts, wings, pods and packs lock into the board with one lever, with no tools and no bolts. Every SnapFit part fits each board it is listed for." },
  { q: "How long does a battery last?", a: "Ride time depends on the pack, your weight and the water. The configurator shows the exact time for your build, and spare packs add a full charge each." },
  { q: "Can I fly a spare battery?", a: "No. Lithium packs over 300 Wh cannot travel in passenger luggage. We ship spares as regulated dangerous goods by ground or cargo." },
  { q: "What does the warranty cover?", a: "Every board is covered for a year against workshop defects. A protection plan extends that to two or three years." },
  { q: "Can I try a board before I buy?", a: "Yes. Book a seat at one of our demo stations; attending a demo day also earns a credit toward your board." },
  { q: "What happens to my old board?", a: "Send us its details on the trade-in page. Our team quotes a credit you can put toward a Crest." },
];
