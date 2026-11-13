import { carriageLine, partAmountLine, partLine, partNumberLine, paidLine, totalLine } from "../shared/copy";

interface DispatchNote {
  reference: string;
  bookletNumber: number;
  partName: string;
  partNumber: string;
  quantity: number;
  partLineMinor: number;
  carriageBand: string;
  carriageMinor: number;
  totalMinor: number;
  paidMinor: number;
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The dispatch note: English, English money format, every figure read back from billing, no private field. */
export function renderDispatchNote(note: DispatchNote): Buffer {
  const lines = [
    `Claim ${note.reference}`,
    partLine(note.bookletNumber, note.partName, "en-GB"),
    partNumberLine(note.partNumber, "en-GB"),
    partAmountLine(note.partLineMinor, "en-GB"),
    carriageLine(note.carriageBand, note.carriageMinor, "en-GB"),
    totalLine(note.totalMinor, "en-GB"),
    paidLine(note.paidMinor, "en-GB"),
    `Quantity ${note.quantity}`,
  ];
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Dispatch note ${escapeHtml(note.reference)}</title>
<style>body{font-family:"IBM Plex Sans",system-ui,sans-serif;color:#101a33;background:#f5eedd;max-width:36rem;margin:2rem auto;padding:0 1rem}h1{font-family:"Space Grotesk",system-ui,sans-serif}p{margin:.4rem 0;border-bottom:1px solid #b9ae9a;padding-bottom:.4rem}</style>
</head>
<body>
<h1>Dispatch note</h1>
${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
</body>
</html>
`;
  return Buffer.from(html, "utf8");
}
