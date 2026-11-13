"""The one step transition rule, including order within a holding and the cascade."""
from __future__ import annotations

from .exposure import NextStep, VaultView, is_holding_level_step


class StepConflict(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _sibling(view: VaultView, step: NextStep, number: int) -> NextStep | None:
    for other in view.steps:
        if (
            other.holding_id == step.holding_id
            and other.data_kind == step.data_kind
            and other.number == number
            and is_holding_level_step(other)
        ):
            return other
    return None


def plan_done(view: VaultView, step: NextStep) -> list[str]:
    """Step ids to mark done, or a conflict."""
    if step.status == "done":
        raise StepConflict("step_already_done")
    if is_holding_level_step(step) and step.number == 2:
        first = _sibling(view, step, 1)
        if first is not None and first.status == "open":
            raise StepConflict("step_out_of_order")
    return [step.id]


def plan_reopen(view: VaultView, step: NextStep) -> list[str]:
    """Step ids to reopen: reopening step 1 also reopens a done step 2."""
    if step.status == "open":
        raise StepConflict("step_already_open")
    reopened = [step.id]
    if is_holding_level_step(step) and step.number == 1:
        second = _sibling(view, step, 2)
        if second is not None and second.status == "done":
            reopened.append(second.id)
    return reopened
