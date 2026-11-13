package main

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

var placeholderPattern = regexp.MustCompile(`\{\{[\p{L}\p{N}_]+\}\}|\{[\p{L}\p{N}_]+\}|%\d+\$[sd]|%[sd@]`)

// normalise is the one exact-match rule: NFC, placeholders to {}, full lowercasing, collapsed whitespace.
func normalise(s string) string {
	s = norm.NFC.String(s)
	s = placeholderPattern.ReplaceAllString(s, "{}")
	s = cases.Lower(language.Und).String(s)
	return strings.Join(strings.FieldsFunc(s, unicode.IsSpace), " ")
}

// mapPlaceholders rewrites a TM target for a key source: the i-th placeholder token of the TM source
// becomes the i-th placeholder token of the key source; tokens the TM source lacks stay as they are.
func mapPlaceholders(tmSource, tmTarget, keySource string) string {
	from := placeholderPattern.FindAllString(tmSource, -1)
	to := placeholderPattern.FindAllString(keySource, -1)
	mapping := map[string]string{}
	for i, token := range from {
		if _, seen := mapping[token]; !seen && i < len(to) {
			mapping[token] = to[i]
		}
	}
	return placeholderPattern.ReplaceAllStringFunc(tmTarget, func(token string) string {
		if replacement, ok := mapping[token]; ok {
			return replacement
		}
		return token
	})
}
