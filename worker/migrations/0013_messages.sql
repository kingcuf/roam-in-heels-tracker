-- Message library: reusable WhatsApp messages with {variables}, the per-unit
-- facts they draw on (Wi-Fi, address, contacts…), and a record of each send.
CREATE TABLE IF NOT EXISTS message_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  stage       TEXT NOT NULL DEFAULT 'any',      -- before | checkin | stay | checkout | any
  audience    TEXT NOT NULL DEFAULT 'guest',    -- guest | host
  properties  TEXT NOT NULL DEFAULT '[]',       -- JSON array of property names; [] = every unit
  preset      TEXT NOT NULL DEFAULT '',         -- checklist preset ticked when sent
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT '',
  updated_by  TEXT NOT NULL DEFAULT '',
  removed_at  TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS property_facts (
  property    TEXT NOT NULL,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT '',
  updated_by  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (property, key)
);
CREATE TABLE IF NOT EXISTS message_sends (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_row  INTEGER NOT NULL,
  template_id  INTEGER NOT NULL,
  recipient    TEXT NOT NULL DEFAULT '',        -- guest | host | manager | other
  sent_by      TEXT NOT NULL DEFAULT '',
  sent_at      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS message_sends_row ON message_sends (booking_row);
