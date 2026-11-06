"""The fixed vocabulary of Mela: cities, categories, themes and time zones."""

CITIES = [
    ("new-delhi", "New Delhi"),
    ("gurugram", "Gurugram"),
    ("noida", "Noida"),
    ("bengaluru", "Bengaluru"),
    ("mumbai", "Mumbai"),
    ("tokyo", "Tokyo"),
]
CITY_NAMES = dict(CITIES)
REGION = "South & East Asia"

# Tile order, with the tint of each tile's icon.
CATEGORIES = [
    ("family", "Family", "#c2410c"),
    ("books", "Books", "#7c3aed"),
    ("games", "Games", "#b45309"),
    ("tech", "Tech", "#0369a1"),
    ("food-drink", "Food & Drink", "#be123c"),
    ("ai", "AI", "#4338ca"),
    ("running", "Running", "#15803d"),
    ("arts-culture", "Arts & Culture", "#a21caf"),
    ("climate", "Climate", "#047857"),
    ("fitness", "Fitness", "#b91c1c"),
    ("wellness", "Wellness", "#0f766e"),
    ("crypto", "Crypto", "#6d28d9"),
]
CATEGORY_NAMES = {slug: name for slug, name, _ in CATEGORIES}

STATUSES = ("pending", "approved", "declined", "waitlisted", "cancelled")

THEMES = ["amber", "harbor", "moss", "plum", "ember", "night"]

TIME_ZONES = [
    ("Asia/Kolkata", "GMT+05:30 Kolkata"),
    ("Asia/Tokyo", "GMT+09:00 Tokyo"),
]

REPORT_REASONS = [("spam", "Spam"), ("misleading", "Misleading"), ("inappropriate", "Inappropriate"), ("other", "Other")]
