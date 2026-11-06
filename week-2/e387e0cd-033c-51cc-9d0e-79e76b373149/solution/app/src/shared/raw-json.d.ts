// JSON.rawJSON (Node 22 and current browsers): writes BigInt cents as plain JSON integers.
interface JSON {
  rawJSON(text: string): unknown;
}
