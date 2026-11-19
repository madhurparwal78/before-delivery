import { clientCopy, clientDate } from "./copy.ts";
import type { Language } from "./towns.ts";

interface ClientMailFacts {
  language: Language;
  clientName: string;
  title: string;
  address: string;
  dueDate: string;
}

/** The client's mail and its reminder differ only in the subject: M1 or M2 over M3, M4 and C19. */
export function clientMail(kind: "M1" | "M2", facts: ClientMailFacts): { subject: string; body: string } {
  const { language } = facts;
  return {
    subject: clientCopy(kind, language, { title: facts.title }),
    body: [
      clientCopy("M3", language, { name: facts.clientName }),
      clientCopy("M4", language, { address: facts.address }),
      clientCopy("C19", language, { date: clientDate(facts.dueDate, language) }),
    ].join("\n\n"),
  };
}
