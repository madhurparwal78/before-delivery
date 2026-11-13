// Imported first by server tests: the config module reads DATABASE_URL when it loads, and unit tests never connect.
process.env.DATABASE_URL ??= 'postgresql://unused@127.0.0.1:1/unused';
