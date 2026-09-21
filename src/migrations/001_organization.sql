CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  color TEXT NOT NULL DEFAULT 'sand'
);
CREATE TABLE IF NOT EXISTS note_organization (
  note_id INTEGER PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  manual_tags TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_note_organization_category ON note_organization(category_id);
