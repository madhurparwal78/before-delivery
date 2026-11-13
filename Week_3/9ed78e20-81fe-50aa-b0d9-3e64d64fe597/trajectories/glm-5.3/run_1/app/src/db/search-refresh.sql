-- Search index population for the current record. The platform keeps this table
-- in step with publication, withdrawal and requisition changes. Claim-marker
-- replacement happens in the application layer, which writes body_text here.
DELETE FROM search_index
WHERE (kind = 'model' OR kind = 'news') AND NOT EXISTS (
  SELECT 1 FROM content_items c
  WHERE c.id = search_index.ref_id::uuid AND c.status = 'published'
);

UPDATE search_index s SET live = false
WHERE (s.kind = 'model' OR s.kind = 'news') AND NOT EXISTS (
  SELECT 1 FROM content_items c WHERE c.id = s.ref_id::uuid AND c.status = 'published'
);

DELETE FROM search_index WHERE kind = 'role';

INSERT INTO search_index (kind, ref_id, title, summary, body, published_at, live)
SELECT 'role', r.slug, r.title, '', r.description, r.opened_at, true
FROM requisitions r WHERE r.status = 'open';
