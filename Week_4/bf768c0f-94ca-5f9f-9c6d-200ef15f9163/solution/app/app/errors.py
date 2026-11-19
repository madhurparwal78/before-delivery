from fastapi import HTTPException


def fail(status: int, message: str) -> None:
    raise HTTPException(status_code=status, detail=message)


NOT_HERE = "That game is not here."
