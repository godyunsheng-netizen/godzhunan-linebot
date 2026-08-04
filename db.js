// 資料庫初始化（MVP先用SQLite，正式上線建議換成 Cloud SQL / Firestore，
// 因為 Cloud Run 檔案系統重啟後會清空，SQLite檔案會不見）
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'checkin.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    line_user_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    department TEXT DEFAULT '',
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS punches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('in', 'out')),
    timestamp TEXT NOT NULL,
    source_ip TEXT,
    verified INTEGER NOT NULL DEFAULT 0
  );
`);

module.exports = db;
