/** The revision JSON as an archive stores it. */
export function revisionJsonOf(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    label: `r${row.label}`,
    partSlug: row.part_slug,
    parentRevisionId: row.parent_id,
    authorId: row.author_id,
    createdAt: (row.created_at as Date).toISOString(),
    values: row.values,
    sourceRef: row.source_key,
    evaluationId: row.evaluation_id,
    geometryDigest: row.geometry_digest,
    message: row.message,
    restoredFrom: row.restored_from,
    forkedFrom: row.forked_from,
  };
}
