/** Where a photograph is kept in the store. */
export function photographKey(deskId: string, pieceId: string, sha256: string): string {
  return `photographs/${deskId}/${pieceId}/${sha256}`;
}

/** Where a collection's label is kept in the store. */
export function labelKey(deskId: string, pieceId: string, collectionId: string): string {
  return `labels/${deskId}/${pieceId}/${collectionId}.pdf`;
}

/** A stored photograph was judged on its way in, so its first byte is enough. */
export function storedPictureType(file: Buffer): "image/png" | "image/jpeg" {
  return file[0] === 0xff ? "image/jpeg" : "image/png";
}
