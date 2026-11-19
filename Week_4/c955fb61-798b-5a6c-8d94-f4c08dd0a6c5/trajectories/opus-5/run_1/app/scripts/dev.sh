#!/bin/sh
cd /app || exit 1
export GRADING_KEY=test-key
export PLAN_TODAY=2027-03-04
export PLAN_TIME_ZONE=Europe/London
export ASSIGN_NOTICE_DELAY_SECONDS=6
export PRESENCE_TIMEOUT_SECONDS=5
exec node dist/server/index.js
