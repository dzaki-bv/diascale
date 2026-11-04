CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE measurements (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  measured_at TEXT NOT NULL,
  bmi REAL NOT NULL,
  fat_mass_kg REAL NOT NULL,
  visceral REAL NOT NULL,
  muscle_kg REAL NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  category TEXT NOT NULL CHECK (category IN ('Aman', 'Meningkat', 'Waspada')),
  body_version TEXT NOT NULL,
  score_version TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  received_at TEXT NOT NULL
);

CREATE INDEX measurements_account_time ON measurements(account_id, measured_at);
