package main

import (
	"regexp"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// placeholderRe matches every placeholder style the desk recognises.
var placeholderRe = regexp.MustCompile(`\{\{?[A-Za-z0-9_]+\}?\}|%[0-9]+\$[sd]|%[@sd]`)

// Placeholders returns the placeholder tokens of a string in order.
func Placeholders(s string) []string {
	return placeholderRe.FindAllString(s, -1)
}

// Normalise is the one exact-match rule: NFC, placeholders to {}, Unicode
// lowercasing, whitespace runs collapsed to one space, both ends trimmed.
func Normalise(s string) string {
	nfc := norm.NFC.String(s)
	nfc = placeholderRe.ReplaceAllString(nfc, "{}")
	lower := strings.ToLower(nfc)
	return collapse(lower)
}

func collapse(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\v' || r == '\f' || r == 0x00A0 || r == 0x2028 || r == 0x2029 {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteRune(' ')
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}

// MapPlaceholders rewrites the TM target for the key source: every occurrence
// of the TM source's i-th placeholder token becomes the key source's i-th token.
// Tokens the TM source does not have stay as they are.
func MapPlaceholders(tmSource, tmTarget, keySource string) string {
	from := Placeholders(tmSource)
	to := Placeholders(keySource)
	if len(from) == 0 || len(to) == 0 {
		return tmTarget
	}
	out := tmTarget
	for i, f := range from {
		if i < len(to) {
			out = strings.ReplaceAll(out, f, to[i])
		}
	}
	return out
}
