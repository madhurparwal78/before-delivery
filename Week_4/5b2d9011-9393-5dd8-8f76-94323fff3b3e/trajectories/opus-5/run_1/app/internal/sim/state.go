package sim

import (
	"encoding/json"
	"math"
	"time"
)

// Player is one seat's live state.
type Player struct {
	ID       string
	Callsign string
	Seat     int
	Ready    bool

	Connection       string
	LeaseRemainingMS int64
	GraceRemainingMS int64

	Status string
	HP     int
	X, Z   float64
	Aim    float64

	LastInputSeq int64
	MoveX, MoveZ float64

	Mag               int
	Reserve           int
	Grenades          int
	ReloadRemainingMS int64
	ReviveRemainingMS int64

	Score int
	Kills int

	lastShotAt time.Time
	hasShot    bool
}

// Enemy is one live enemy.
type Enemy struct {
	ID    string
	Kind  string
	State string
	HP    int
	X, Z  float64

	spawnX, spawnZ    float64
	patrolDir         float64
	detectRemainingMS int64
	attackCooldownMS  int64
	targetID          string
}

// Barrel is one explosive barrel.
type Barrel struct {
	ID        string
	HP        int
	X, Z      float64
	Destroyed bool
}

// Grenade is one thrown grenade waiting on its fuse.
type Grenade struct {
	ID              string
	Owner           string
	X, Z            float64
	FuseRemainingMS int64
}

// Vehicle is one racer's car.
type Vehicle struct {
	PlayerID string
	State    string
	X, Z     float64
	Heading  float64

	LastSeq          int64
	NextCheckpoint   int
	LapsDone         int
	BestLapMS        int
	ResetRemainingMS int64

	lapStart       time.Time
	lapClockFrozen bool
	lastPoseAt     time.Time
	lastCheckpoint int
}

// Event is one room event. Its type fields merge into the published object.
type Event struct {
	Seq    int64
	Type   string
	Tick   int64
	Fields map[string]any
}

// MarshalJSON merges the event's type fields alongside seq, type and tick.
func (e Event) MarshalJSON() ([]byte, error) {
	out := map[string]any{"seq": e.Seq, "type": e.Type, "tick": e.Tick}
	for k, v := range e.Fields {
		out[k] = v
	}
	return json.Marshal(out)
}

// PlayerView is a player as the room state publishes it.
type PlayerView struct {
	ID                string  `json:"id"`
	Callsign          string  `json:"callsign"`
	Seat              int     `json:"seat"`
	Ready             bool    `json:"ready"`
	Connection        string  `json:"connection"`
	GraceRemainingMS  *int64  `json:"grace_remaining_ms"`
	Status            string  `json:"status"`
	HP                int     `json:"hp"`
	X                 float64 `json:"x"`
	Z                 float64 `json:"z"`
	Aim               float64 `json:"aim"`
	LastInputSeq      int64   `json:"last_input_seq"`
	Mag               int     `json:"mag"`
	Reserve           int     `json:"reserve"`
	Grenades          int     `json:"grenades"`
	ReloadRemainingMS *int64  `json:"reload_remaining_ms"`
	ReviveRemainingMS *int64  `json:"revive_remaining_ms"`
	Credits           int     `json:"credits"`
	Score             int     `json:"score"`
	Kills             int     `json:"kills"`
}

// EnemyView is an enemy as the room state publishes it.
type EnemyView struct {
	ID    string  `json:"id"`
	Kind  string  `json:"kind"`
	State string  `json:"state"`
	HP    int     `json:"hp"`
	X     float64 `json:"x"`
	Z     float64 `json:"z"`
}

// BarrelView is a barrel as the room state publishes it.
type BarrelView struct {
	ID        string  `json:"id"`
	HP        int     `json:"hp"`
	X         float64 `json:"x"`
	Z         float64 `json:"z"`
	Destroyed bool    `json:"destroyed"`
}

// GrenadeView is a grenade as the room state publishes it.
type GrenadeView struct {
	ID              string  `json:"id"`
	Owner           string  `json:"owner"`
	X               float64 `json:"x"`
	Z               float64 `json:"z"`
	FuseRemainingMS int64   `json:"fuse_remaining_ms"`
}

// ShopItemView is one ammo-station item with the price in effect now.
type ShopItemView struct {
	Item           string `json:"item"`
	Name           string `json:"name"`
	Price          int    `json:"price"`
	NextPrice      *int   `json:"next_price"`
	NextChangeInMS *int64 `json:"next_change_in_ms"`
}

// ShopView is the ammo station as the room state publishes it.
type ShopView struct {
	Open  bool           `json:"open"`
	Items []ShopItemView `json:"items"`
}

// VehicleView is a vehicle as the room state publishes it.
type VehicleView struct {
	Player           string  `json:"player"`
	State            string  `json:"state"`
	X                float64 `json:"x"`
	Z                float64 `json:"z"`
	Heading          float64 `json:"heading"`
	LastSeq          int64   `json:"last_seq"`
	NextCheckpoint   int     `json:"next_checkpoint"`
	LapsDone         int     `json:"laps_done"`
	LapElapsedMS     int64   `json:"lap_elapsed_ms"`
	BestLapMS        *int    `json:"best_lap_ms"`
	ResetRemainingMS *int64  `json:"reset_remaining_ms"`
}

// StateView is the room state, always in this shape.
type StateView struct {
	Code              string        `json:"code"`
	Mode              string        `json:"mode"`
	Phase             string        `json:"phase"`
	Wave              int           `json:"wave"`
	PhaseRemainingMS  *int64        `json:"phase_remaining_ms"`
	Tick              int64         `json:"tick"`
	ServerTime        string        `json:"server_time"`
	Host              string        `json:"host"`
	NightID           *string       `json:"night_id"`
	InviteExpiresAt   string        `json:"invite_expires_at"`
	InviteRemainingMS *int64        `json:"invite_remaining_ms"`
	Degraded          *string       `json:"degraded"`
	Result            *string       `json:"result"`
	Players           []PlayerView  `json:"players"`
	Enemies           []EnemyView   `json:"enemies"`
	Barrels           []BarrelView  `json:"barrels"`
	Grenades          []GrenadeView `json:"grenades"`
	Shop              ShopView      `json:"shop"`
	Vehicles          []VehicleView `json:"vehicles"`
	Events            []Event       `json:"events"`
}

// ReportResult is one report's judgement, stored so a replay returns it unchanged.
type ReportResult struct {
	ReportID string  `json:"report_id"`
	Type     string  `json:"type"`
	Accepted bool    `json:"accepted"`
	Reason   *string `json:"reason"`
	Tick     int64   `json:"tick"`
	Outcome  any     `json:"outcome"`
}

// ShotHit is the enemy or barrel a shot struck.
type ShotHit struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Damage  int    `json:"damage"`
	HPAfter int    `json:"hp_after"`
	Killed  bool   `json:"killed"`
}

// ShotOutcome is an accepted shot's outcome.
type ShotOutcome struct {
	Hit *ShotHit `json:"hit"`
	Mag int      `json:"mag"`
}

// ReloadOutcome is an accepted reload's outcome.
type ReloadOutcome struct {
	ReloadMS int64 `json:"reload_ms"`
}

// GrenadeOutcome is an accepted grenade's outcome.
type GrenadeOutcome struct {
	GrenadeID     string `json:"grenade_id"`
	DetonatesInMS int64  `json:"detonates_in_ms"`
}

// ReviveOutcome is an accepted revive's outcome.
type ReviveOutcome struct {
	Revived string `json:"revived"`
}

// PoseResult is one pose's judgement.
type PoseResult struct {
	Seq      int64       `json:"seq"`
	Accepted bool        `json:"accepted"`
	Reason   *string     `json:"reason"`
	Vehicle  VehicleView `json:"vehicle"`
}

// PurchaseResult is one purchase's stored response.
type PurchaseResult struct {
	PurchaseID       string     `json:"purchase_id"`
	Item             string     `json:"item"`
	UnitPrice        int        `json:"unit_price"`
	PriceEffectiveAt string     `json:"price_effective_at"`
	Balance          int        `json:"balance"`
	Player           PlayerView `json:"player"`
}

func round4(v float64) float64 { return math.Round(v*10000) / 10000 }

func ptrInt64(v int64) *int64 { return &v }

func ptrString(v string) *string { return &v }

func ptrInt(v int) *int { return &v }
