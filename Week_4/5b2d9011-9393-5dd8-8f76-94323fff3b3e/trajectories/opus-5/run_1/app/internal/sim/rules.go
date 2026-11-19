// Package sim runs the live rooms: the siege and convoy state machines, combat,
// enemies, the credit ledger and the convoy lap clock. The server decides every
// rule here; the browser only sends intents and reports.
package sim

import "time"

// The server tick.
const (
	TickHz       = 20
	TickInterval = time.Second / TickHz
	tickMS       = int64(50)
)

// Phase names.
const (
	PhaseLobby        = "lobby"
	PhaseCountdown    = "countdown"
	PhaseWave         = "wave"
	PhaseIntermission = "intermission"
	PhaseBossWave     = "boss_wave"
	PhaseRace         = "race"
	PhaseOver         = "over"
)

// Match results.
const (
	ResultVictory  = "victory"
	ResultDefeat   = "defeat"
	ResultEnded    = "ended"
	ResultFinished = "finished"
)

// Connection states.
const (
	ConnConnected    = "connected"
	ConnDisconnected = "disconnected"
	ConnLeft         = "left"
)

// Player statuses.
const (
	StatusUp     = "up"
	StatusDowned = "downed"
	StatusOut    = "out"
)

// Phase and room timings.
const (
	CountdownMS      int64 = 5000
	IntermissionMS   int64 = 20000
	InviteTTL              = 15 * time.Minute
	SeatLeaseMS      int64 = 5000
	ReconnectGraceMS int64 = 30000
	OverLinger             = 60 * time.Second
	BossWave               = 4
	Seats                  = 4
)

// Movement.
const (
	PlayerSpeed = 4.0
)

// Weapon rules, one rifle per player.
const (
	MagSize        = 30
	StartReserve   = 90
	MaxReserve     = 270
	StartGrenades  = 2
	MaxGrenades    = 3
	StartHP        = 100
	FireIntervalMS = 100
	ShotRange      = 40.0
	ShotDamage     = 20
	ReloadMS       = int64(1800)
)

// Grenades.
const (
	GrenadeThrowRange = 15.0
	GrenadeFuseMS     = int64(3000)
	GrenadeRadius     = 5.0
	GrenadeMaxDamage  = 100.0
)

// Barrels.
const (
	BarrelHP        = 30
	BarrelRadius    = 4.0
	BarrelMaxDamage = 80.0
)

// Explosion falloff holds full damage inside this distance.
const BlastCoreRadius = 1.0

// Entity circle radii a shot ray crosses.
const (
	RadiusGrunt  = 0.5
	RadiusBrute  = 0.7
	RadiusBoss   = 1.0
	RadiusBarrel = 0.4
)

// Enemy kinds.
const (
	KindGrunt = "grunt"
	KindBrute = "brute"
	KindBoss  = "boss"
)

// Enemy states.
const (
	EnemyPatrol = "patrol"
	EnemyDetect = "detect"
	EnemyPursue = "pursue"
	EnemyAttack = "attack"
	EnemyDead   = "dead"
)

// Enemy behaviour.
const (
	PatrolSpan       = 2.0
	PatrolSpeed      = 1.0
	DetectRange      = 14.0
	DetectDelayMS    = int64(500)
	AttackRange      = 1.5
	AttackIntervalMS = int64(1000)
)

// Downed, revive and out.
const (
	ReviveWindowMS = int64(10000)
	ReviveRange    = 2.0
	ReviveHP       = 50
)

// Credits.
const (
	WaveBonus = 100
)

// Ledger accounts and kinds.
const (
	AccountRewards     = "studio:rewards"
	AccountAmmoStation = "studio:ammo_station"
	KindKillReward     = "kill_reward"
	KindWaveBonus      = "wave_bonus"
	KindPurchase       = "purchase"
)

// Shop items and their effects.
const (
	ItemAmmoPack   = "ammo_pack"
	ItemGrenade    = "grenade"
	ItemMedKit     = "med_kit"
	AmmoPackRounds = 90
	MedKitHeal     = 50
)

// Convoy.
const (
	VehicleTopSpeed    = 30.0
	PoseTolerance      = 0.5
	CheckpointRadius   = 6.0
	VehicleResetMS     = int64(3000)
	LapsToFinish       = 3
	VehicleRunning     = "running"
	VehicleWrecked     = "wrecked"
	VehicleFinished    = "finished"
	StartFinishIndex   = 0
	LastCheckpointIdx  = 4
	DegradedRoomRegist = "room_registry"
)

// enemyHP reports an enemy kind's health.
func enemyHP(kind string) int {
	switch kind {
	case KindBrute:
		return 240
	case KindBoss:
		return 1000
	default:
		return 60
	}
}

// enemyPursueSpeed reports an enemy kind's pursuit speed.
func enemyPursueSpeed(kind string) float64 {
	switch kind {
	case KindBrute:
		return 2.0
	case KindBoss:
		return 1.5
	default:
		return 2.5
	}
}

// enemyAttackDamage reports an enemy kind's attack damage.
func enemyAttackDamage(kind string) int {
	switch kind {
	case KindBrute:
		return 20
	case KindBoss:
		return 25
	default:
		return 10
	}
}

// enemyKillReward reports the credits a kill pays.
func enemyKillReward(kind string) int {
	switch kind {
	case KindBrute:
		return 150
	case KindBoss:
		return 1000
	default:
		return 50
	}
}

// enemyRadius reports an enemy kind's circle radius.
func enemyRadius(kind string) float64 {
	switch kind {
	case KindBrute:
		return RadiusBrute
	case KindBoss:
		return RadiusBoss
	default:
		return RadiusGrunt
	}
}

// Report rejection reasons.
const (
	ReasonFireInterval    = "fire_interval"
	ReasonReloading       = "reloading"
	ReasonEmpty           = "empty"
	ReasonNotUp           = "not_up"
	ReasonNotInWave       = "not_in_wave"
	ReasonNothingToReload = "nothing_to_reload"
	ReasonNoGrenades      = "no_grenades"
	ReasonOutOfRange      = "out_of_range"
	ReasonNotDowned       = "not_downed"
	ReasonTooFar          = "too_far"
	ReasonWindowClosed    = "window_closed"
	ReasonSelfRevive      = "self_revive"
)

// Pose rejection reasons.
const (
	ReasonStaleSeq  = "stale_seq"
	ReasonNotRacing = "not_racing"
	ReasonFinished  = "finished"
	ReasonWrecked   = "wrecked"
	ReasonTooFast   = "too_fast"
)
