package main

// Segment status words.
const (
	StatusUntranslated = "untranslated"
	StatusDrafted      = "drafted"
	StatusScored       = "scored"
	StatusNeedsReview  = "needs_review"
	StatusApproved     = "approved"
)

// Branch state words.
const (
	BranchOpen      = "open"
	BranchInReview  = "in_review"
	BranchMerged    = "merged"
	BranchAbandoned = "abandoned"
)

var validSegmentStatuses = map[string]bool{
	StatusUntranslated: true, StatusDrafted: true, StatusScored: true,
	StatusNeedsReview: true, StatusApproved: true,
}

// segmentTransition decides the one legal-move table for segment statuses.
// from -> what the action requires.
//
//	manual value:   any -> drafted (when a value is written)
//	TM fill:        untranslated -> drafted
//	AI draft:      untranslated -> scored | needs_review (drafted recorded first)
//	score:         drafted -> scored | needs_review
//	rescore/issue: scored -> needs_review (below threshold) or stays scored
//	source change: scored | approved -> needs_review
//	approve:       scored | needs_review -> approved
//	correct:       needs_review -> approved
//
// segmentCanScore: the published refusals are scoring untranslated or approved;
// a scored or needs-review segment can be rescored, and an added issue below
// threshold counts as a rescore.
func segmentCanScore(from string) bool {
	return from == StatusDrafted || from == StatusScored || from == StatusNeedsReview
}

func segmentCanApprove(from string) bool {
	return from == StatusScored || from == StatusNeedsReview
}

func segmentCanCorrect(from string) bool {
	return from == StatusNeedsReview
}

// branchTransition decides the one legal-move table for branch states.
// The bool says whether the move is legal.
func branchTransition(from, to string) bool {
	switch from {
	case BranchOpen:
		return to == BranchInReview || to == BranchAbandoned
	case BranchInReview:
		return to == BranchOpen || to == BranchAbandoned
	default:
		return false
	}
}

// branchEditable: key edits, translation values, drafts and source uploads
// need an open branch.
func branchEditable(state string) bool { return state == BranchOpen }

// branchReviewable: scoring, approving, correcting, comments, holds and
// resolutions are allowed in open and in review.
func branchReviewable(state string) bool {
	return state == BranchOpen || state == BranchInReview
}

func branchFinal(state string) bool { return state == BranchMerged || state == BranchAbandoned }
