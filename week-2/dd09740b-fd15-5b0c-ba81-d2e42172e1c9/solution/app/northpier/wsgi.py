"""WSGI entry: start the boot loop and the outbox sender in this worker, then serve Django."""
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "northpier.settings")

from django.core.wsgi import get_wsgi_application  # noqa: E402

from northpier import boot  # noqa: E402

application = get_wsgi_application()
boot.start()
