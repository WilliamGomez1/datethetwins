const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const STATUSES = ['new', 'liked', 'maybe', 'passed'];

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS applications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      status      TEXT    NOT NULL DEFAULT 'new',
      email       TEXT    NOT NULL,
      profile     TEXT    NOT NULL,  -- JSON (see src/validate.js)
      notes       TEXT    NOT NULL DEFAULT ''
    );
  `);

  const insertStmt = db.prepare('INSERT INTO applications (email, profile) VALUES (?, ?)');
  const listStmt = db.prepare('SELECT id, created_at, status, email, profile, notes FROM applications ORDER BY id DESC');
  const getStmt = db.prepare('SELECT id, created_at, status, email, profile, notes FROM applications WHERE id = ?');
  const updateStmt = db.prepare('UPDATE applications SET status = ?, notes = ? WHERE id = ?');
  const deleteStmt = db.prepare('DELETE FROM applications WHERE id = ?');

  const hydrate = (row) => row && { ...row, profile: JSON.parse(row.profile) };

  return {
    insert(profile) {
      const info = insertStmt.run(profile.contact.email, JSON.stringify(profile));
      return Number(info.lastInsertRowid);
    },
    list: () => listStmt.all().map(hydrate),
    get: (id) => hydrate(getStmt.get(id)),
    update(id, { status, notes }) {
      const current = getStmt.get(id);
      if (!current) return null;
      updateStmt.run(status ?? current.status, notes ?? current.notes, id);
      return hydrate(getStmt.get(id));
    },
    remove: (id) => deleteStmt.run(id).changes > 0,
    close: () => db.close(),
  };
}

module.exports = { openDb, STATUSES };
