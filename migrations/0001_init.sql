CREATE TABLE IF NOT EXISTS services (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 price TEXT NOT NULL DEFAULT '',
 duration_minutes INTEGER NOT NULL DEFAULT 60,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bookings (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 telegram_user_id TEXT NOT NULL,
 customer_name TEXT NOT NULL,
 phone TEXT NOT NULL,
 service_id INTEGER NOT NULL,
 service_name TEXT NOT NULL,
 price TEXT NOT NULL DEFAULT '',
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'confirmed',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_starts_at ON bookings(starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(telegram_user_id);
CREATE TABLE IF NOT EXISTS sessions (
 telegram_user_id TEXT PRIMARY KEY,
 step TEXT NOT NULL,
 data TEXT NOT NULL DEFAULT '{}',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO services(name,price,duration_minutes)
SELECT 'Консультация','Бесплатно',60
WHERE NOT EXISTS (SELECT 1 FROM services);
