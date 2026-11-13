package main

import (
	"sort"
	"strconv"
)

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
