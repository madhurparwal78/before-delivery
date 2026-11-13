package store

import "context"

// MetaGet reads a metadata value from the meta table.
func (s *Store) MetaGet(ctx context.Context, k string) (string, error) {
	var v string
	err := s.pool.QueryRow(ctx, `SELECT v FROM meta WHERE k = $1`, k).Scan(&v)
	if err != nil {
		return "", err
	}
	return v, nil
}

// MetaSet stores a metadata value.
func (s *Store) MetaSet(ctx context.Context, k, v string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO meta (k, v) VALUES ($1,$2)
		ON CONFLICT (k) DO UPDATE SET v = $2`, k, v)
	return err
}
