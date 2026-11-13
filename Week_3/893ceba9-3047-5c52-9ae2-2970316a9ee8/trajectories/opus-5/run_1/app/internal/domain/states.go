package domain

// Segment statuses.
const (
	StatusUntranslated = "untranslated"
	StatusDrafted      = "drafted"
	StatusScored       = "scored"
	StatusNeedsReview  = "needs_review"
	StatusApproved     = "approved"
)

// Branch states.
const (
	BranchOpen      = "open"
	BranchInReview  = "in_review"
	BranchMerged    = "merged"
	BranchAbandoned = "abandoned"
)

// SegmentAction names the moves a caller may ask of a segment.
type SegmentAction string

const (
	ActionSetValue SegmentAction = "set_value"
	ActionScore    SegmentAction = "score"
	ActionApprove  SegmentAction = "approve"
	ActionCorrect  SegmentAction = "correct"
)

// SegmentMoveAllowed decides every legal segment move in one place.
func SegmentMoveAllowed(from string, action SegmentAction) bool {
	switch action {
	case ActionSetValue:
		return true
	case ActionScore:
		return from == StatusDrafted || from == StatusScored || from == StatusNeedsReview
	case ActionApprove:
		return from == StatusScored || from == StatusNeedsReview
	case ActionCorrect:
		return from == StatusNeedsReview
	}
	return false
}

// StatusWord spells a segment status out for people.
func StatusWord(status string) string {
	switch status {
	case StatusUntranslated:
		return "Untranslated"
	case StatusDrafted:
		return "Drafted"
	case StatusScored:
		return "Scored"
	case StatusNeedsReview:
		return "Needs review"
	case StatusApproved:
		return "Approved"
	}
	return status
}

// BranchStateWord spells a branch state out for people.
func BranchStateWord(state string) string {
	switch state {
	case BranchOpen:
		return "Open"
	case BranchInReview:
		return "In review"
	case BranchMerged:
		return "Merged"
	case BranchAbandoned:
		return "Abandoned"
	}
	return state
}

// BranchTransitionAllowed decides every legal branch edge in one place. Merging
// is the only way into `merged`, and `main` never moves.
func BranchTransitionAllowed(from, to string, isMain bool) bool {
	if isMain {
		return false
	}
	switch from {
	case BranchOpen:
		return to == BranchInReview || to == BranchAbandoned
	case BranchInReview:
		return to == BranchOpen || to == BranchAbandoned || to == BranchMerged
	}
	return false
}

// BranchFinal reports whether no change at all is allowed on the branch.
func BranchFinal(state string) bool {
	return state == BranchMerged || state == BranchAbandoned
}
