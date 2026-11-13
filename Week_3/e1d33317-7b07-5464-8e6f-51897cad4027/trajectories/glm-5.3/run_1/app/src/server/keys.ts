export function bankKey(scoreId: string, bankId: string, fileName: string): string {
  return `scores/${scoreId}/banks/${bankId}/${fileName}`;
}

export function partPageKey(scoreId: string, partId: string, revision: number, page: number): string {
  return `scores/${scoreId}/parts/${partId}/r${revision}/page-${page}.svg`;
}

export function partPdfKey(scoreId: string, partId: string, revision: number): string {
  return `scores/${scoreId}/parts/${partId}/r${revision}/part.pdf`;
}
