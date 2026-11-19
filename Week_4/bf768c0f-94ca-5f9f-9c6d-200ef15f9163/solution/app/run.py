import os
import uvicorn
from app.config import APP_PUBLIC_PORT

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=APP_PUBLIC_PORT,
        access_log=False,
        log_level=os.environ.get("LOG_LEVEL", "warning"),
        workers=1,
    )
