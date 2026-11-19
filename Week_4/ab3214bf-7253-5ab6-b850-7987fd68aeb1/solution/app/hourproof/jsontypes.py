"""The shapes JSON bodies and replies take."""

from __future__ import annotations

Json = str | int | float | bool | None | list["Json"] | dict[str, "Json"]
JsonObject = dict[str, Json]
