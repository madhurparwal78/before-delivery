-- Excusing a horse, appended trip-share adjustments and the stored cancellation decision instant
-- (brief: Business rules, Excusing a horse; Trip-fee split; Bookings, Cancelling).
ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('held', 'confirmed', 'cancelled_in_time', 'cancelled_late', 'worked', 'no_show', 'excused',
                    'released', 'lapsed', 'removed'));

-- The share fixed at start; the current share is it plus the booking's adjustments.
ALTER TABLE bookings ADD COLUMN initial_share_cents integer;
UPDATE bookings SET initial_share_cents = trip_share_cents;
ALTER TABLE bookings ADD COLUMN decided_at timestamptz;

CREATE TABLE trip_share_adjustments (
  barn_day_id text NOT NULL REFERENCES barn_days (id),
  seq integer NOT NULL,
  booking_id text NOT NULL REFERENCES bookings (id),
  delta_cents integer NOT NULL,
  cause_booking_id text NOT NULL REFERENCES bookings (id),
  at timestamptz NOT NULL,
  PRIMARY KEY (barn_day_id, seq)
);

CREATE FUNCTION trip_share_adjustments_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trip_share_adjustments is append-only';
END
$$;
CREATE TRIGGER trip_share_adjustments_append_only BEFORE UPDATE OR DELETE ON trip_share_adjustments
  FOR EACH ROW EXECUTE FUNCTION trip_share_adjustments_append_only();
