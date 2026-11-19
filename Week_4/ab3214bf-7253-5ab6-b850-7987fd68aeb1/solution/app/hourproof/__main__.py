"""`python -m hourproof` serves the desk on 0.0.0.0 at APP_PUBLIC_PORT."""

import uvicorn

from .config import load_settings

if __name__ == "__main__":
    uvicorn.run(
        "hourproof.server:app", host="0.0.0.0", port=load_settings().port, log_level="warning", access_log=False
    )
