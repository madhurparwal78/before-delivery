package store

import "encoding/json"

func jsonDecode(b []byte, v any) error { return json.Unmarshal(b, v) }
func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }
