export const seedSql = `
INSERT INTO venues (code, name, address) VALUES
  ('MH', 'Maison Halide', '1450 rue de la Pellicule, Montréal'),
  ('AC', 'Annexe Clark', '62 rue Argentique, Montréal')
ON CONFLICT (code) DO NOTHING;

INSERT INTO auditoriums (code, venue_code, name, rows, seats_per_row, capacity) VALUES
  ('MH1', 'MH', 'Salle Lumière', 'ABCDEFGHIJ', 14, 140),
  ('MH2', 'MH', 'Salle Nitrate', 'ABCD', 6, 24),
  ('AC1', 'AC', 'Studio Clark', 'ABCDEF', 8, 48)
ON CONFLICT (code) DO NOTHING;
`;
