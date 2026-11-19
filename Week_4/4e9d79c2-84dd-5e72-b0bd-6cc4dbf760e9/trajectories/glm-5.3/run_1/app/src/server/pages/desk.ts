export function deskScreenBody(path: string): string {
  const map: Record<string, string> = {
    "/enquiries": "enquiries",
    "/operators": "operators",
    "/payments": "payments",
    "/diary": "diary",
    "/documents": "documents",
    "/rates": "rates",
    "/customers": "customers",
    "/aftercare/complaints": "complaints",
    "/aftercare/lost-property": "lost",
  };
  const screen = map[path] ?? "enquiries";
  return `<div class="desk-screen" data-screen="${screen}"><div class="desk-main"></div></div>`;
}

export function enquiryDetailBody(ref: string): string {
  return `<div class="desk-screen" data-screen="enquiry" data-ref="${ref}"><div class="desk-main"></div></div>`;
}

export function tripBody(ref: string): string {
  return `<div class="desk-screen" data-screen="trip" data-ref="${ref}"><div class="desk-main"></div></div>`;
}

export function bidsBody(ref: string): string {
  return `<div class="desk-screen" data-screen="bids" data-ref="${ref}"><div class="desk-main"></div></div>`;
}

export function hireScreenBody(suffix: string, ref: string): string {
  const map: Record<string, string> = {
    "/quote": "quote",
    "/hours": "hours",
    "/seats": "seats",
    "/changes": "changes",
  };
  const screen = map[suffix] ?? "quote";
  return `<div class="desk-screen" data-screen="${screen}" data-ref="${ref}"><div class="desk-main"></div></div>`;
}
