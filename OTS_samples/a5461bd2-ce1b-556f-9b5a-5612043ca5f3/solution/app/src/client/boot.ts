import type { Boot, Catalog, World } from "../shared/types";

/** The catalog and limit values the server embedded in the page. */
const element = document.getElementById("boot");
if (!element?.textContent) throw new Error("the page carries no boot data");

export const boot: Boot = JSON.parse(element.textContent);
export const catalog: Catalog = boot.catalog;

/** The gallery page size is the server's: the first unfiltered page it embedded holds that many tiles. */
export const GALLERY_PAGE_SIZE = Math.max(1, boot.firstPage.next_offset ?? boot.firstPage.total);

/** World k (1 to 8) in ring order. */
export function worldAt(index: number): World {
  return catalog.worlds[index - 1] as World;
}
