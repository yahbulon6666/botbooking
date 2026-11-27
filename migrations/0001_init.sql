-- BotBooking D1 schema. Compatible with src/index.js.
CREATE TABLE IF NOT EXISTS services (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ame TEXT NOT NULL,
 price REAL NOT NULL DEFAULT 0,
 duration_minutes INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
 telegram_user_id TEXT PRIMARY KEY,
 step TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 telegram_user_id TEXT NOT NULL,
 customer_name TEXT NOT NULL,
 phone TEXT NOT NULL,
 service_id INTEGER NOT NULL,
 service_name TEXT NOT NULL,
 price REAL NOT NULL DEFAULT 0,
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'confirmed',
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE INDEX IF NOT EXISTS idx_bookings_starts_at ON bookings(starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status_starts_at ON bookings(status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_bookings_telegram_user_id ON bookings(telegram_user_id);
