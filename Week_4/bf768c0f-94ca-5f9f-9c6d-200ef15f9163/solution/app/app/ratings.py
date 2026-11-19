"""Rating arithmetic: symmetric, from pre-game numbers, rounded half away from zero."""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

RATING_FLOOR = 100


def step_factor(rating: int, rated_games: int) -> int:
    if rated_games < 30:
        return 40
    if rating < 2400:
        return 20
    return 10


def expected(rating: int, opponent_rating: int) -> float:
    return 1.0 / (1.0 + 10 ** ((opponent_rating - rating) / 400.0))


def round_half_away(value: float) -> int:
    return int(
        Decimal(repr(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        if value >= 0
        else -Decimal(repr(-value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )


def change(rating: int, rated_games: int, opponent_rating: int, score: float) -> int:
    k = step_factor(rating, rated_games)
    return round_half_away(k * (score - expected(rating, opponent_rating)))


def apply_result(
    white_rating: int,
    white_games: int,
    black_rating: int,
    black_games: int,
    result: str,
) -> tuple[int, int]:
    """Returns the pair of new ratings, each computed from both pre-game numbers."""
    if result == "1-0":
        white_score, black_score = 1.0, 0.0
    elif result == "0-1":
        white_score, black_score = 0.0, 1.0
    else:
        white_score = black_score = 0.5
    new_white = white_rating + change(white_rating, white_games, black_rating, white_score)
    new_black = black_rating + change(black_rating, black_games, white_rating, black_score)
    return max(RATING_FLOOR, new_white), max(RATING_FLOOR, new_black)
