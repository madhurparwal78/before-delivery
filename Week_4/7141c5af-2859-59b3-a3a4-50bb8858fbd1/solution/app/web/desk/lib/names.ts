import type { Language, Town } from "../../../server/domain/towns.ts";
import type { Choice } from "./forms.tsx";
import { get } from "./api.ts";

export const PIECE_STATES: readonly Choice[] = [
  { value: "received", label: "Received" },
  { value: "inSurvey", label: "In survey" },
  { value: "onTheBench", label: "On the bench" },
  { value: "ready", label: "Ready" },
  { value: "collected", label: "Collected" },
  { value: "archived", label: "Archived" },
];

export function stateName(state: string): string {
  return PIECE_STATES.find((choice) => choice.value === state)?.label ?? state;
}

export const LANGUAGE_CHOICES: readonly Choice[] = [
  { value: "en", label: "English" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ar", label: "Arabic" },
];

export interface Piece {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  maker: string | null;
  year: string | null;
  stampNumber: string | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  weightKg: number | null;
  dueDate: string | null;
  notes: string | null;
  state: string;
}

export interface Client {
  id: string;
  name: string;
  state: string;
  town?: Town;
  language?: Language;
  email?: string | null;
  closesAt?: string | null;
}

/** Clients a piece can still go to: the rows from `erasing` on have no address. */
export function liveClients(clients: readonly Client[]): Client[] {
  return clients.filter((client) => client.state === "active" || client.state === "closing");
}

interface PiecesPage {
  pieces: Piece[];
  nextCursor: string | null;
}

/** Reads every page of a filtered list, or stops early once `enough` holds for a page. */
export async function readPieces(params: URLSearchParams, enough: (page: Piece[]) => boolean = () => false): Promise<Piece[]> {
  const all: Piece[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams(params);
    if (cursor) query.set("cursor", cursor);
    const page: PiecesPage = await get<PiecesPage>(`/api/pieces?${query}`);
    all.push(...page.pieces);
    cursor = enough(page.pieces) ? null : page.nextCursor;
  } while (cursor);
  return all;
}
