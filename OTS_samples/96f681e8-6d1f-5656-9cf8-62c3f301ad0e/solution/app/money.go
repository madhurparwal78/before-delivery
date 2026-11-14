package main

import "fmt"

// euros writes whole cents as €<euros>.<cents>.
func euros(cents int) string { return fmt.Sprintf("€%d.%02d", cents/100, cents%100) }

// splitEvenly is the one place a total is divided among payers: each gets floor(total / parts) and the
// remainder goes on the first.
func splitEvenly(total, parts int) []int {
	each := total / parts
	shares := make([]int, parts)
	for i := range shares {
		shares[i] = each
	}
	shares[0] += total - each*parts
	return shares
}

const placesPerMatch = 4

// splitFourWays divides a booking or match total among its four players.
func splitFourWays(total int) []int { return splitEvenly(total, placesPerMatch) }

// creatorShare is what the player who opens a match pays: the first share, remainder included.
func creatorShare(total int) int { return splitFourWays(total)[0] }

// joinerShare is what every other player of a match pays.
func joinerShare(total int) int { return splitFourWays(total)[1] }

// lateFee is the one place the cancellation fee is decided.
func lateFee(paidCents, percent int) int { return paidCents * percent / 100 }
