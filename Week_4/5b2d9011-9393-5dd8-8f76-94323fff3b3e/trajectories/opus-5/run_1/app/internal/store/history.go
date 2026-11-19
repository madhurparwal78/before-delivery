package store

import (
	"context"
	"time"
)

// MatchPlayer is one seated player's result in a finished match.
type MatchPlayer struct {
	Seat          int    `json:"-"`
	PlayerID      string `json:"-"`
	Callsign      string `json:"callsign"`
	Score         int    `json:"score"`
	Kills         int    `json:"kills"`
	CreditsEarned int    `json:"credits_earned"`
	BestLapMS     *int   `json:"best_lap_ms"`
}

// Match is one finished match.
type Match struct {
	ID           string        `json:"id"`
	Code         string        `json:"code"`
	Mode         string        `json:"mode"`
	Result       string        `json:"result"`
	WavesCleared int           `json:"waves_cleared"`
	NightID      *string       `json:"night_id"`
	StartedAt    time.Time     `json:"-"`
	EndedAt      time.Time     `json:"-"`
	Players      []MatchPlayer `json:"players"`
}

// LedgerEntry is one side of a credit movement.
type LedgerEntry struct {
	ID        string
	Code      string
	Account   string
	Amount    int
	Kind      string
	Ref       string
	Item      *string
	UnitPrice *int
	At        time.Time
}

// Lap is one completed convoy lap.
type Lap struct {
	ID       string
	MatchID  string
	Code     string
	PlayerID string
	Callsign string
	LapNo    int
	LapMS    int
	SetAt    time.Time
}

// SaveMatch stores a finished match with its players, laps and ledger entries in
// one transaction.
func (s *Store) SaveMatch(ctx context.Context, m Match, laps []Lap, entries []LedgerEntry) error {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()

	tx, err := s.pool.Begin(c)
	if err != nil {
		return s.down(c, err)
	}
	defer func() { _ = tx.Rollback(c) }()

	if _, err := tx.Exec(c,
		`INSERT INTO matches (id, code, mode, result, waves_cleared, night_id, started_at, ended_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
		m.ID, m.Code, m.Mode, m.Result, m.WavesCleared, m.NightID, m.StartedAt, m.EndedAt); err != nil {
		return s.down(c, err)
	}
	for _, p := range m.Players {
		if _, err := tx.Exec(c,
			`INSERT INTO match_players (match_id, seat, player_id, callsign, score, kills, credits_earned, best_lap_ms)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (match_id, seat) DO NOTHING`,
			m.ID, p.Seat, p.PlayerID, p.Callsign, p.Score, p.Kills, p.CreditsEarned, p.BestLapMS); err != nil {
			return s.down(c, err)
		}
	}
	for _, l := range laps {
		if _, err := tx.Exec(c,
			`INSERT INTO laps (id, match_id, code, player_id, callsign, lap_no, lap_ms, set_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
			l.ID, m.ID, l.Code, l.PlayerID, l.Callsign, l.LapNo, l.LapMS, l.SetAt); err != nil {
			return s.down(c, err)
		}
	}
	for _, e := range entries {
		if _, err := tx.Exec(c,
			`INSERT INTO ledger_entries (id, code, match_id, account, amount, kind, ref, item, unit_price, at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
			e.ID, e.Code, m.ID, e.Account, e.Amount, e.Kind, e.Ref, e.Item, e.UnitPrice, e.At); err != nil {
			return s.down(c, err)
		}
	}
	return s.down(c, tx.Commit(c))
}

// History lists finished matches, newest end instant first.
func (s *Store) History(ctx context.Context, limit int) ([]Match, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	rows, err := s.pool.Query(c,
		`SELECT id, code, mode, result, waves_cleared, night_id, started_at, ended_at
		 FROM matches ORDER BY ended_at DESC, id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, s.down(c, err)
	}
	defer rows.Close()

	matches := []Match{}
	index := map[string]int{}
	for rows.Next() {
		var m Match
		if err := rows.Scan(&m.ID, &m.Code, &m.Mode, &m.Result, &m.WavesCleared, &m.NightID, &m.StartedAt, &m.EndedAt); err != nil {
			return nil, s.down(c, err)
		}
		m.StartedAt, m.EndedAt = m.StartedAt.UTC(), m.EndedAt.UTC()
		m.Players = []MatchPlayer{}
		index[m.ID] = len(matches)
		matches = append(matches, m)
	}
	if err := rows.Err(); err != nil {
		return nil, s.down(c, err)
	}
	if len(matches) == 0 {
		return matches, nil
	}

	ids := make([]string, 0, len(matches))
	for _, m := range matches {
		ids = append(ids, m.ID)
	}
	pRows, err := s.pool.Query(c,
		`SELECT match_id, seat, player_id, callsign, score, kills, credits_earned, best_lap_ms
		 FROM match_players WHERE match_id = ANY($1) ORDER BY seat ASC`, ids)
	if err != nil {
		return nil, s.down(c, err)
	}
	defer pRows.Close()
	for pRows.Next() {
		var matchID string
		var p MatchPlayer
		if err := pRows.Scan(&matchID, &p.Seat, &p.PlayerID, &p.Callsign, &p.Score, &p.Kills, &p.CreditsEarned, &p.BestLapMS); err != nil {
			return nil, s.down(c, err)
		}
		at := index[matchID]
		matches[at].Players = append(matches[at].Players, p)
	}
	return matches, s.down(c, pRows.Err())
}

// BestLap is one row of the Lap board.
type BestLap struct {
	Callsign string
	LapMS    int
	SetAt    time.Time
	MatchID  string
}

// LapBoard lists each callsign's best lap, fastest first, ties by the earlier set
// instant.
func (s *Store) LapBoard(ctx context.Context, limit int) ([]BestLap, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	rows, err := s.pool.Query(c,
		`SELECT callsign, lap_ms, set_at, match_id FROM (
		   SELECT callsign, lap_ms, set_at, match_id,
		          row_number() OVER (PARTITION BY callsign ORDER BY lap_ms ASC, set_at ASC) AS rn
		   FROM laps
		 ) best WHERE rn = 1 ORDER BY lap_ms ASC, set_at ASC LIMIT $1`, limit)
	if err != nil {
		return nil, s.down(c, err)
	}
	defer rows.Close()

	out := []BestLap{}
	for rows.Next() {
		var b BestLap
		if err := rows.Scan(&b.Callsign, &b.LapMS, &b.SetAt, &b.MatchID); err != nil {
			return nil, s.down(c, err)
		}
		b.SetAt = b.SetAt.UTC()
		out = append(out, b)
	}
	return out, s.down(c, rows.Err())
}
