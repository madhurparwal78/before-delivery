#!/bin/sh
# Reset the database, restart an instance and run every check in order.
# The last three suites start and stop instances of their own.
set -u
cd /app || exit 1
.venv/bin/python -c "import sys; sys.path.insert(0, 'tests'); import support; support.reset_database()"
tests/run_instance.sh start 4173
cd tests || exit 1
echo "== units =="
/app/.venv/bin/python unit_checks.py
echo "== api =="
/app/.venv/bin/python api_checks.py
echo "== domain =="
/app/.venv/bin/python domain_checks.py
echo "== browser =="
/tmp/pw/bin/python browser_checks.py
echo "== journeys =="
/tmp/pw/bin/python journey_checks.py
echo "== accessibility =="
/tmp/pw/bin/python a11y_checks.py
echo "== cluster, restart and outage =="
/app/.venv/bin/python cluster_checks.py
echo "== load and outage timing =="
/app/.venv/bin/python load_checks.py
echo "== pages during an outage =="
/tmp/pw/bin/python outage_browser_checks.py
cd /app || exit 1
tests/run_instance.sh start 4173
