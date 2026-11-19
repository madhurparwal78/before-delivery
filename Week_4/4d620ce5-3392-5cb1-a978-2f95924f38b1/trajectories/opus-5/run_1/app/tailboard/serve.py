"""The serve step: apply the schema and seed, then serve the app."""

import sys

from . import api, background, seed, storage, web
from .config import config
from .errors import ApiError


def main():
    seed.apply_schema()
    seed.seed()
    try:
        storage.ensure_bucket()
    except ApiError:
        print("Object storage is unreachable; the bucket will be created when it returns.",
              file=sys.stderr)
    background.start()
    print(f"Tailboard serving on 0.0.0.0:{config.public_port}", flush=True)
    web.serve_forever(api.handle, config.public_port)


if __name__ == "__main__":
    main()
