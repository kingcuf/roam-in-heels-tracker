-- Daily revenue targets for the Report's "Daily revenue vs target" section.
--
-- Additive only: a client that predates this migration never calls `targets`
-- or `setTarget`, so it keeps working unchanged.
--
-- One row per scope. `scope` is 'All' for the whole portfolio or a property
-- NAME ('Spira 3028') — the same value the Report's property filter carries,
-- so the target follows whatever the filter is showing. An absent row means
-- no target is set for that scope; there is no inheritance between scopes.

CREATE TABLE IF NOT EXISTS revenue_targets (
  scope       TEXT PRIMARY KEY,
  daily       REAL NOT NULL,              -- ₹ per day, net earned basis
  updated_at  TEXT NOT NULL DEFAULT '',   -- ISO timestamp, UTC
  updated_by  TEXT NOT NULL DEFAULT ''    -- username of the admin who set it
);
