package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Match is one finished match.
type Match struct {
	ID           string
	Code         string
	Mode         string
	Result       string
	WavesCleared int
	NightID      any
	StartedAt    time.Time
	EndedAt      time.Time
	Players      []MatchPlayer
}

// MatchPlayer is one seated player's results.
type MatchPlayer struct {
	Seat           int
	Callsign       string
	Score          int
	Kills          int
	CreditsEarned  int
	BestLapMs      any
}

// SaveMatch stores one finished match, its players and its laps.
func (s *Store) SaveMatch(ctx context.Context, m Match, laps []LapRow) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var nightID any
	if m.NightID == nil {
		nightID = nil
	} else {
		nightID = m.NightID
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO matches (id, code, mode, result, waves_cleared, night_id, started_at, ended_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		m.ID, m.Code, m.Mode, m.Result, m.WavesCleared, nightID, m.StartedAt, m.EndedAt); err != nil {
		return err
	}
	for _, p := range m.Players {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO match_players (match_id, seat, callsign, score, kills, credits_earned, best_lap_ms)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			m.ID, p.Seat, p.Callsign, p.Score, p.Kills, p.CreditsEarned, p.BestLapMs); err != nil {
			return err
		}
	}
	for _, l := range laps {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO laps (match_id, callsign, lap_ms, set_at) VALUES ($1,$2,$3,$4)`,
			l.MatchID, l.Callsign, l.LapMs, l.SetAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// LapRow is one stored lap.
type LapRow struct {
	MatchID  string
	Callsign string
	LapMs    int64
	SetAt    time.Time
}

// HistoryMatch is one match in the history listing.
type HistoryMatch struct {
	ID           string
	Code         string
	Mode         string
	Result       string
	WavesCleared int
	NightID      any
	StartedAt    time.Time
	EndedAt      time.Time
	Players      []HistoryPlayer
}

// HistoryPlayer is one player in a history listing row.
type HistoryPlayer struct {
	Seat          int
	Callsign      string
	Score         int
	Kills         int
	CreditsEarned int
	BestLapMs     any
}

// History lists matches newest ended_at first.
func (s *Store) History(ctx context.Context, limit int) ([]HistoryMatch, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT m.id, m.code, m.mode, m.result, m.waves_cleared, m.night_id, m.started_at, m.ended_at
		 FROM matches m ORDER BY m.ended_at DESC, m.id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HistoryMatch
	for rows.Next() {
		var hm HistoryMatch
		var night sql.NullString
		if err := rows.Scan(&hm.ID, &hm.Code, &hm.Mode, &hm.Result, &hm.WavesCleared, &night, &hm.StartedAt, &hm.EndedAt); err != nil {
			return nil, err
		}
		if night.Valid {
			hm.NightID = night.String
		}
		out = append(out, hm)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		players, err := s.matchPlayers(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Players = players
	}
	return out, nil
}

func (s *Store) matchPlayers(ctx context.Context, matchID string) ([]HistoryPlayer, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT seat, callsign, score, kills, credits_earned, best_lap_ms FROM match_players
		 WHERE match_id=$1 ORDER BY seat`, matchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HistoryPlayer
	for rows.Next() {
		var p HistoryPlayer
		var best sql.NullInt64
		if err := rows.Scan(&p.Seat, &p.Callsign, &p.Score, &p.Kills, &p.CreditsEarned, &best); err != nil {
			return nil, err
		}
		if best.Valid {
			p.BestLapMs = best.Int64
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// BestLap is one row of the lap board.
type BestLap struct {
	Callsign string
	LapMs    int64
	SetAt    time.Time
	MatchID  string
}

// BestLaps lists each callsign's best lap, fastest first, ties by earlier
// set_at.
func (s *Store) BestLaps(ctx context.Context, limit int) ([]BestLap, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT DISTINCT ON (callsign) callsign, lap_ms, set_at, match_id
		 FROM laps ORDER BY callsign, lap_ms, set_at`, )
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var all []BestLap
	for rows.Next() {
		var b BestLap
		if err := rows.Scan(&b.Callsign, &b.LapMs, &b.SetAt, &b.MatchID); err != nil {
			return nil, err
		}
		all = append(all, b)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Sort fastest first, ties by earlier set_at.
	for i := 1; i < len(all); i++ {
		for j := i; j > 0; j-- {
			if all[j].LapMs < all[j-1].LapMs || (all[j].LapMs == all[j-1].LapMs && all[j].SetAt.Before(all[j-1].SetAt)) {
				all[j], all[j-1] = all[j-1], all[j]
			} else {
				break
			}
		}
	}
	if len(all) > limit {
		all = all[:limit]
	}
	return all, nil
}

// ErrConflict is a generic unique-constraint failure.
var ErrConflict = errors.New("store: conflict")

var _ = strings.Contains
