module rungmark

go 1.23

require github.com/jackc/pgx/v5 v5.7.2

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/crypto v0.31.0 // indirect
	golang.org/x/sync v0.10.0 // indirect
	golang.org/x/text v0.21.0 // indirect
)

// Every linked module ships in this tree with its own licence file, so the build needs no network.
replace (
	github.com/jackc/pgpassfile => ./third_party/github.com/jackc/pgpassfile
	github.com/jackc/pgservicefile => ./third_party/github.com/jackc/pgservicefile
	github.com/jackc/pgx/v5 => ./third_party/github.com/jackc/pgx/v5
	github.com/jackc/puddle/v2 => ./third_party/github.com/jackc/puddle/v2
	golang.org/x/crypto => ./third_party/golang.org/x/crypto
	golang.org/x/sync => ./third_party/golang.org/x/sync
	golang.org/x/text => ./third_party/golang.org/x/text
)
