-- Turning the single operator into user one.
--
-- 002 created the tables and left every column nullable. This fills them in
-- from what is already there, so the existing install keeps working with the
-- same data attached to a real user rather than to nobody.
--
-- Idempotent throughout: each statement only touches rows that are still null.

-- The first user is whoever authorised the first Google connection. That is
-- the only identity the installation has ever had.
INSERT INTO users (email, name, role)
SELECT google_email, google_email, 'owner'
  FROM connections
 WHERE kind = 'user_oauth' AND google_email IS NOT NULL
 ORDER BY id
 LIMIT 1
ON CONFLICT (email) DO NOTHING;

-- A refresh token is one human's consent. Attach each connection to the user
-- whose Google address it was granted under.
UPDATE connections c
   SET user_id = u.id
  FROM users u
 WHERE c.google_email = u.email
   AND c.user_id IS NULL;

-- A client belongs to whoever owns the connection that discovered its data.
-- Going through inventory rather than guessing is what makes this correct when
-- a second Google account is added later.
UPDATE clients cl
   SET owner_id = sub.user_id
  FROM (
    SELECT DISTINCT cp.client_id, co.user_id
      FROM client_properties cp
      JOIN inventory i   ON i.id = cp.inventory_id
      JOIN connections co ON co.id = i.connection_id
     WHERE co.user_id IS NOT NULL
  ) sub
 WHERE cl.id = sub.client_id
   AND cl.owner_id IS NULL;

-- Identity provider subject, when one is wired up. Already on the table from
-- 002; the index is what makes the per-request lookup cheap.
CREATE INDEX IF NOT EXISTS users_external_idx ON users (external_id);
