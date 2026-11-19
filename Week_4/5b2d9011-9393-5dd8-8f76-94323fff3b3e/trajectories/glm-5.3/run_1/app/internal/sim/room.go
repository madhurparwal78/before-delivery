// Package sim is the live room simulation. The server decides every timer,
// hit, credit, lap and deadline here, at a 20 Hz tick.
package sim

import (
	"sync"
	"time"

	"holdfast/internal/clock"
	"holdfast/internal/maps"
)

// TickHz is the simulation tick rate.
const TickHz = 20

// TickMs is one tick in milliseconds.
const TickMs = 1000 / TickHz

// Phase is the room's phase.
type Phase string

const (
	PhaseLobby     Phase = "lobby"
	PhaseCountdown Phase = "countdown"
	PhaseWave      Phase = "wave"
	PhaseIntermission Phase = "intermission"
	PhaseBossWave  Phase = "boss_wave"
	PhaseRace      Phase = "race"
	PhaseOver      Phase = "over"
)

// Connection is a seat's connection state.
type Connection string

const (
	Connected    Connection = "connected"
	Disconnected Connection = "disconnected"
	Left         Connection = "left"
)

// Status is a player's combat status.
type Status string

const (
	Up      Status = "up"
	Downed  Status = "downed"
	Out     Status = "out"
)

// Published timings.
const (
	CountdownMs        = 5000
	IntermissionMs     = 20000
	ReloadMs           = 1800
	GrenadeFuseMs      = 3000
	FireIntervalMs     = 100
	ReviveWindowMs     = 10000
	ReconnectGraceMs   = 30000
	LeaseMs            = 5000
	ResetMs            = 3000
	InviteMs           = 15 * time.Minute
	RoomGoneAfterMs    = 60 * time.Second
)

// Weapon and player constants.
const (
	MagSize       = 30
	ReserveStart  = 90
	ReserveMax    = 270
	GrenadesStart = 2
	GrenadesMax   = 3
	MaxHP         = 100
	RevivedHP     = 50
	ShotDamage    = 20
	ShotRange     = 40.0
	MoveSpeed     = 4.0
)

// Enemy constants.
const (
	GruntHP   = 60
	BruteHP   = 240
	BossHP    = 1000
	GruntSpeed = 2.5
	BruteSpeed = 2.0
	BossSpeed  = 1.5
	DetectRange = 14.0
	AttackRange = 1.5
	AttackCooldownMs = 1000
	GruntDamage  = 10
	BruteDamage  = 20
	BossDamage   = 25
	PatrolSpeed  = 1.0
	PatrolSpan   = 2.0
	DetectDelayMs = 500
)

// Barrel and explosion constants.
const (
	BarrelHP        = 30
	BarrelRadius    = 0.4
	GruntRadius     = 0.5
	BruteRadius     = 0.7
	BossRadius      = 1.0
	GrenadeBlastRadius = 5.0
	GrenadeMaxDamage   = 100
	BarrelBlastRadius = 4.0
	BarrelMaxDamage   = 80
	GrenadeRange    = 15.0
)

// Credit constants.
const (
	GruntKillCredits  = 50
	BruteKillCredits  = 150
	BossKillCredits   = 1000
	WaveBonusCredits  = 100
)

// Convoy constants.
const (
	ConvoyTopSpeed = 30.0
	ConvoyPoseTolerance = 0.5
	CheckpointRadius = 6.0
	LapsPerRace = 3
)

// Room is one live room. The simulation runs in the game server's memory.
type Room struct {
	mu sync.Mutex

	Code string
	Mode string // siege or convoy
	Map  maps.Map

	Phase    Phase
	Wave     int
	PhaseRemainingMs *int64 // countdown and intermission
	Tick     int64

	Clock *clock.Clock

	HostID  string
	NightID string

	CreatedAt       time.Time
	InviteExpiresAt time.Time

	Players map[string]*Player
	Seats   map[int]string // seat number to player id

	Enemies  map[string]*Enemy
	Barrels  map[string]*Barrel
	Grenades map[string]*Grenade

	Events    []Event
	EventSeq  int64

	MatchID    string
	StartedAt  time.Time
	Result     string

	Degraded  string // "" or "room_registry"
	Frozen    bool
	FreezeAtMono int64

	Vehicles map[string]*Vehicle

	OverAt   time.Time
	Gone     bool

	Purchases map[string]*PurchaseRecord

// creditMovements are the credit movements awaiting ledger writes.
creditMovements []CreditMovement

// phaseEndMono is the monotonic instant the countdown or intermission
// timer ends.
phaseEndMono int64
}

// Player is a seated player's live state.
type Player struct {
	ID        string
	Callsign  string
	Seat      int
	Ready     bool
	Connection Connection

	LeaseUntil    int64 // mono ms
	GraceUntil    *int64

	Status Status
	HP     int
	X, Z   float64
	Aim    float64

	MoveX, MoveZ float64
	LastInputSeq  int64

	Mag      int
	Reserve  int
	Grenades int

	ReloadUntil *int64
	LastShotAt  *int64

	ReviveUntil *int64

	Credits int64
	Score   int64
	Kills   int
}

// Enemy is a live enemy.
type Enemy struct {
	ID    string
	Kind  string // grunt, brute, boss
	State string // patrol, detect, pursue, attack, dead
	SpawnX, SpawnZ float64
	X, Z  float64
	HP    int
	DetectSince *int64
	LastAttack  *int64
	TargetID    string
	patrolLeft  bool
}

// Barrel is a live barrel.
type Barrel struct {
	ID     string
	X, Z   float64
	HP     int
	Destroyed bool
}

// Grenade is a live grenade.
type Grenade struct {
	ID     string
	Owner  string
	X, Z   float64
	DetonateAt int64 // mono ms
}

// Vehicle is a convoy racer's vehicle.
type Vehicle struct {
	Player    string
	State     string // running, wrecked, finished
	X, Z      float64
	Heading   float64
	LastSeq   int64
	LastPoseAt int64 // mono ms of last accepted pose, race start or reset
	LastPassedCheckpoint string // last passed this lap
	NextCheckpoint string
	LapsDone  int
	LapStartAt int64 // mono ms
	LapElapsedMs int64
	BestLapMs  *int64
	ResetAt    *int64
}

// Event is one room event.
type Event struct {
	Seq  int64 `json:"seq"`
	Type string `json:"type"`
	Tick int64 `json:"tick"`
	Data map[string]any `json:"-"`
}

// PurchaseRecord is one stored purchase, for idempotency.
type PurchaseRecord struct {
	PurchaseID string
	Item       string
	UnitPrice  int
	PriceEffectiveAt time.Time
	Balance    int64
	PlayerID   string
}

// ReportResult is a stored report result.
type ReportResult struct {
	ReportID string `json:"report_id"`
	Type     string `json:"type"`
	Accepted bool   `json:"accepted"`
	Reason   any    `json:"reason"`
	Tick     int64  `json:"tick"`
	Outcome  any    `json:"outcome"`
	Body     string `json:"-"` // canonical body, for conflict detection
}

// DegradedKey is the degraded value while the room registry is down.
const DegradedKey = "room_registry"
