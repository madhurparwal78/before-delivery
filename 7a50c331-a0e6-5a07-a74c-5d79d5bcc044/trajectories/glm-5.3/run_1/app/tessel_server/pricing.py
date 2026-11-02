"""The pricing arithmetic, in whole cents, decided here and used everywhere."""
import math

from .textutil import plan_rate, plan_minimum_cents


def bill_cents(month_tokens, storage_bytes, plan):
    """Return the usage bill as a dict of whole cents."""
    ontology = math.ceil(month_tokens * 500 / 1000000)
    storage = math.ceil(storage_bytes * plan_rate(plan) / 1000000000)
    usage = ontology + storage
    minimum = plan_minimum_cents(plan)
    return {
        "ontology_cents": ontology,
        "storage_cents": storage,
        "usage_cents": usage,
        "minimum_cents": minimum,
        "billed_cents": max(usage, minimum),
        "minimum_applied": usage < minimum,
    }


def estimate_cents(gb, millions, plan):
    """The landing calculator: gb and millions are decimal numbers."""
    g_x10 = int(math.floor(gb * 10 + 0.5))
    m_x10 = int(math.floor(millions * 10 + 0.5))
    storage = math.ceil(g_x10 * plan_rate(plan) / 10)
    ontology = math.ceil(m_x10 * 500 / 10)
    usage = storage + ontology
    minimum = plan_minimum_cents(plan)
    return {"usage_cents": usage, "billed_cents": max(usage, minimum), "minimum_applied": usage < minimum}
