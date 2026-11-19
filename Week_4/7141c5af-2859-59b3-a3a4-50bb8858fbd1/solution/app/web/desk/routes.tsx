import type { ComponentType } from "preact";
import { BenchScreen } from "./screens/Bench.tsx";
import { ClientScreen } from "./screens/Client.tsx";
import { ClientsScreen } from "./screens/Clients.tsx";
import { CollectionScreen } from "./screens/Collection.tsx";
import { ConditionScreen } from "./screens/Condition.tsx";
import { DossierScreen } from "./screens/Dossier.tsx";
import { EstimateScreen } from "./screens/Estimate.tsx";
import { HideScreen } from "./screens/Hide.tsx";
import { LibraryScreen } from "./screens/Library.tsx";
import { PhotographsScreen } from "./screens/Photographs.tsx";
import { PieceScreen } from "./screens/Piece.tsx";
import { PiecesScreen } from "./screens/Pieces.tsx";
import { RatesScreen } from "./screens/Rates.tsx";
import { WorkbookScreen } from "./screens/Workbook.tsx";

export interface ScreenProps {
  /** The `:id` in the address. */
  id: string;
  query: URLSearchParams;
}

const ROUTES: [RegExp, ComponentType<ScreenProps>][] = [
  [/^\/pieces$/, PiecesScreen],
  [/^\/pieces\/([^/]+)$/, PieceScreen],
  [/^\/pieces\/([^/]+)\/condition$/, ConditionScreen],
  [/^\/pieces\/([^/]+)\/photographs$/, PhotographsScreen],
  [/^\/pieces\/([^/]+)\/hide$/, HideScreen],
  [/^\/pieces\/([^/]+)\/estimate$/, EstimateScreen],
  [/^\/pieces\/([^/]+)\/collection$/, CollectionScreen],
  [/^\/pieces\/([^/]+)\/dossier$/, DossierScreen],
  [/^\/clients$/, ClientsScreen],
  [/^\/clients\/([^/]+)$/, ClientScreen],
  [/^\/library$/, LibraryScreen],
  [/^\/bench$/, BenchScreen],
  [/^\/workbook$/, WorkbookScreen],
  [/^\/rates$/, RatesScreen],
];

export function matchRoute(path: string): { Screen: ComponentType<ScreenProps>; id: string } | null {
  for (const [pattern, Screen] of ROUTES) {
    const match = pattern.exec(path);
    if (match) return { Screen, id: match[1] ?? "" };
  }
  return null;
}
