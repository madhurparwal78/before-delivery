package sim

// CreditMovement is one credit movement the simulation asks the ledger to
// write: the movement and its ref.
type CreditMovement struct {
	PlayerID string
	Amount  int64
	Kind    string // kill_reward or wave_bonus
	Ref     string
}

// takeCreditMovements drains the movements recorded since the last call.
// The room's Credits fields stay authoritative; the ledger mirrors them.
func (r *Room) takeCreditMovements() []CreditMovement {
	out := r.creditMovements
	r.creditMovements = nil
	return out
}

// recordCredit queues a paired movement for the ledger.
func (r *Room) recordCredit(playerID string, amount int64, kind, ref string) {
	r.creditMovements = append(r.creditMovements, CreditMovement{
		PlayerID: playerID, Amount: amount, Kind: kind, Ref: ref,
	})
}

// TakeCreditMovements drains the movements recorded since the last call.
func (r *Room) TakeCreditMovements() []CreditMovement {
out := r.creditMovements
r.creditMovements = nil
return out
}

// MatchIDPublic returns the room's match id for ledger writes.
func (r *Room) MatchIDPublic() string { return r.MatchID }
