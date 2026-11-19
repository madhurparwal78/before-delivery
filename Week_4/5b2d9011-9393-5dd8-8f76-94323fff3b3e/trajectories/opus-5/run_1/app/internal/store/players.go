package store

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"time"
)

// Player identifies itself with a callsign only.
type Player struct {
	ID       string `json:"id"`
	Callsign string `json:"callsign"`
	Role     string `json:"role"`
}

// Settings are a player's stored bindings, volumes and comfort choices.
type Settings struct {
	Bindings      map[string]string `json:"bindings"`
	MasterVolume  int               `json:"master_volume"`
	EffectsVolume int               `json:"effects_volume"`
	ReduceEffects bool              `json:"reduce_effects"`
	ScreenShake   bool              `json:"screen_shake"`
	CameraBob     bool              `json:"camera_bob"`
}

// BindingActions are the remappable actions, in their published order.
var BindingActions = []string{
	"move_up", "move_down", "move_left", "move_right",
	"aim_left", "aim_right", "fire", "reload", "grenade",
	"revive", "shop", "timers",
}

var defaultKeys = []string{
	"KeyW", "KeyS", "KeyA", "KeyD",
	"KeyQ", "KeyE", "Space", "KeyR", "KeyG",
	"KeyF", "KeyB", "KeyT",
}

// DefaultSettings are the settings a new player starts with.
func DefaultSettings() Settings {
	bindings := make(map[string]string, len(BindingActions))
	for i, action := range BindingActions {
		bindings[action] = defaultKeys[i]
	}
	return Settings{
		Bindings:      bindings,
		MasterVolume:  70,
		EffectsVolume: 70,
		ReduceEffects: false,
		ScreenShake:   true,
		CameraBob:     true,
	}
}

func newToken() string {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// CreatePlayer stores a player with a fresh session token and default settings.
func (s *Store) CreatePlayer(ctx context.Context, callsign, role string) (Player, string, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return Player{}, "", err
	}
	defer cancel()

	player := Player{ID: NewID(), Callsign: callsign, Role: role}
	token := newToken()
	now := time.Now().UTC()

	tx, err := s.pool.Begin(c)
	if err != nil {
		return Player{}, "", s.down(c, err)
	}
	defer func() { _ = tx.Rollback(c) }()

	if _, err := tx.Exec(c,
		`INSERT INTO players (id, callsign, role, created_at) VALUES ($1,$2,$3,$4)`,
		player.ID, player.Callsign, player.Role, now); err != nil {
		return Player{}, "", s.down(c, err)
	}
	if _, err := tx.Exec(c,
		`INSERT INTO sessions (token, player_id, created_at) VALUES ($1,$2,$3)`,
		token, player.ID, now); err != nil {
		return Player{}, "", s.down(c, err)
	}
	def := DefaultSettings()
	if _, err := tx.Exec(c,
		`INSERT INTO player_settings (player_id, bindings, master_volume, effects_volume, reduce_effects, screen_shake, camera_bob)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		player.ID, def.Bindings, def.MasterVolume, def.EffectsVolume, def.ReduceEffects, def.ScreenShake, def.CameraBob); err != nil {
		return Player{}, "", s.down(c, err)
	}
	if err := tx.Commit(c); err != nil {
		return Player{}, "", s.down(c, err)
	}
	return player, token, nil
}

// PlayerByToken resolves a session token.
func (s *Store) PlayerByToken(ctx context.Context, token string) (Player, bool, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return Player{}, false, err
	}
	defer cancel()

	var p Player
	err = s.pool.QueryRow(c,
		`SELECT p.id, p.callsign, p.role FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = $1`,
		token).Scan(&p.ID, &p.Callsign, &p.Role)
	if isNoRows(err) {
		return Player{}, false, nil
	}
	if err != nil {
		return Player{}, false, s.down(c, err)
	}
	return p, true, nil
}

// DeleteSession ends a session.
func (s *Store) DeleteSession(ctx context.Context, token string) error {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()
	_, err = s.pool.Exec(c, `DELETE FROM sessions WHERE token = $1`, token)
	return s.down(c, err)
}

// Settings reads a player's settings.
func (s *Store) Settings(ctx context.Context, playerID string) (Settings, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return Settings{}, err
	}
	defer cancel()

	var out Settings
	err = s.pool.QueryRow(c,
		`SELECT bindings, master_volume, effects_volume, reduce_effects, screen_shake, camera_bob
		 FROM player_settings WHERE player_id = $1`, playerID).
		Scan(&out.Bindings, &out.MasterVolume, &out.EffectsVolume, &out.ReduceEffects, &out.ScreenShake, &out.CameraBob)
	if err != nil {
		return Settings{}, s.down(c, err)
	}
	return out, nil
}

// SaveSettings stores a player's full settings object.
func (s *Store) SaveSettings(ctx context.Context, playerID string, in Settings) (Settings, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return Settings{}, err
	}
	defer cancel()

	_, err = s.pool.Exec(c,
		`UPDATE player_settings SET bindings=$2, master_volume=$3, effects_volume=$4,
		 reduce_effects=$5, screen_shake=$6, camera_bob=$7 WHERE player_id=$1`,
		playerID, in.Bindings, in.MasterVolume, in.EffectsVolume, in.ReduceEffects, in.ScreenShake, in.CameraBob)
	if err != nil {
		return Settings{}, s.down(c, err)
	}
	return in, nil
}
