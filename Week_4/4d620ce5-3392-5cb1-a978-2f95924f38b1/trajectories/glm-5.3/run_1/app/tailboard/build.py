"""build: a no-op step. It receives only APP_PUBLIC_PORT and APP_PUBLIC_URL and
must never contact the database, object storage or the mail sink."""


def main():
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
