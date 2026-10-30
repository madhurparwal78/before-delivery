"""Money is whole cents everywhere; this is the only place it becomes text."""


def dollars(cents):
    return "${:,.2f}".format(cents / 100)
