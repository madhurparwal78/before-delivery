-- A session lasts until sign-out on any instance; no instant ends it, whatever an instance's clock offset.
ALTER TABLE sessions DROP COLUMN expires_at;
