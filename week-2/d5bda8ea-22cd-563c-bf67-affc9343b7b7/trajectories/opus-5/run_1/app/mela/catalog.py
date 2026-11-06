"""The fixed vocabularies of Mela: cities, categories, themes and time zones."""

CITIES = (
    ("new-delhi", "New Delhi"),
    ("gurugram", "Gurugram"),
    ("noida", "Noida"),
    ("bengaluru", "Bengaluru"),
    ("mumbai", "Mumbai"),
    ("tokyo", "Tokyo"),
)

CATEGORIES = (
    ("family", "Family"),
    ("books", "Books"),
    ("games", "Games"),
    ("tech", "Tech"),
    ("food-drink", "Food & Drink"),
    ("ai", "AI"),
    ("running", "Running"),
    ("arts-culture", "Arts & Culture"),
    ("climate", "Climate"),
    ("fitness", "Fitness"),
    ("wellness", "Wellness"),
    ("crypto", "Crypto"),
)

THEMES = ("amber", "harbor", "moss", "plum", "ember", "night")

TIMEZONES = (
    ("Asia/Kolkata", "GMT+05:30 Kolkata"),
    ("Asia/Tokyo", "GMT+09:00 Tokyo"),
)

CITY_NAME = dict(CITIES)
CATEGORY_NAME = dict(CATEGORIES)
REGION_NAME = "South & East Asia"

VISIBILITIES = ("public", "private")
LOCATION_TYPES = ("offline", "virtual")
GUEST_STATUSES = ("pending", "approved", "waitlisted", "declined", "cancelled")
REPORT_REASONS = ("spam", "misleading", "inappropriate", "other")
REPORT_REASON_LABELS = (
    ("spam", "Spam"),
    ("misleading", "Misleading"),
    ("inappropriate", "Inappropriate"),
    ("other", "Other"),
)
