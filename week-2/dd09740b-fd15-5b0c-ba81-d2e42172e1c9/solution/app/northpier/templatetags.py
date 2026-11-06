"""Template helpers: letter spans for the header roll and the shared status pill."""
from django import template
from django.utils.html import escape
from django.utils.safestring import SafeString, mark_safe

from northpier.domain import STATUS_LABELS

register = template.Library()


@register.filter
def letters(text: str) -> SafeString:
    """Each letter in its own span with its index; spaces stay plain text so names read whole."""
    out, index = [], 0
    for char in text:
        if char == " ":
            out.append(" ")
            continue
        out.append(f'<span class="l" style="--i:{index}">{escape(char)}</span>')
        index += 1
    return mark_safe("".join(out))


@register.inclusion_tag("_pill.html")
def pill(status: str) -> dict[str, str]:
    return {"status": status, "label": STATUS_LABELS[status]}
