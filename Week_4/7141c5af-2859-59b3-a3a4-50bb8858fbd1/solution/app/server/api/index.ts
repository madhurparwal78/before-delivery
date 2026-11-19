import { register as access } from "./access.ts";
import { register as clients } from "./clients.ts";
import { register as pieces } from "./pieces.ts";
import { register as pins } from "./pins.ts";
import { register as photographs } from "./photographs.ts";
import { register as search } from "./search.ts";
import { register as materials } from "./materials.ts";
import { register as layout } from "./layout.ts";
import { register as estimates } from "./estimates.ts";
import { register as rates } from "./rates.ts";
import { register as clientPages } from "./clientPages.ts";
import { register as bench } from "./bench.ts";
import { register as collections } from "./collections.ts";
import { register as workbook } from "./workbook.ts";
import { register as dossier } from "./dossier.ts";
import { register as enquiries } from "./enquiries.ts";

export function registerApi(): void {
  for (const register of [access, clients, pieces, pins, photographs, search, materials, layout, estimates, rates, clientPages, bench, collections, workbook, dossier, enquiries]) register();
}
