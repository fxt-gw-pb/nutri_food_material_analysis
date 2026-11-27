// SQLite 存储（Node 内置 node:sqlite，无需安装数据库）。
//
// meal_records / questionnaire_responses 两张表都把**完整文档**原样存在 doc 列（JSON），
// 字段与微信云开发同名集合一致，导出后可直接交给 scripts/export/ 处理、与小程序数据合并分析。
// 其余列只是从文档里抄出来的查询索引，每次写入时同步更新。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Doc = Record<string, unknown> & { _id: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meal_records (
  _id TEXT PRIMARY KEY,
  participantCode TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  evaluationStatus TEXT NOT NULL DEFAULT '',
  mealSessionId TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meal_by_code_time ON meal_records (participantCode, createdAt);
CREATE INDEX IF NOT EXISTS meal_by_status_time ON meal_records (status, createdAt);
CREATE INDEX IF NOT EXISTS meal_by_session ON meal_records (mealSessionId);

CREATE TABLE IF NOT EXISTS questionnaire_responses (
  _id TEXT PRIMARY KEY,
  participantCode TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questionnaire_by_code_time ON questionnaire_responses (participantCode, createdAt);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  ownerKey TEXT NOT NULL,
  participantCode TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  code TEXT PRIMARY KEY,
  tokenHash TEXT,
  tokenIssuedAt INTEGER,
  revokedAt INTEGER,
  note TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS participants_by_token ON participants (tokenHash);

CREATE TABLE IF NOT EXISTS sessions (
  idHash TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  participantCode TEXT,
  tokenIssuedAt INTEGER,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  lastSeenAt INTEGER NOT NULL
);
`;

export class Store {
  readonly db: DatabaseSync;
  readonly imageDir: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.imageDir = path.join(dataDir, 'images');
    fs.mkdirSync(this.imageDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'app.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void { this.db.close(); }

  /** 同步执行的事务。node:sqlite 是同步接口，事务内不要 await。 */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- meal_records ---------------------------------------------------------
  getMeal(id: string): Doc | null {
    const row = this.db.prepare('SELECT doc FROM meal_records WHERE _id = ?').get(id) as { doc: string } | undefined;
    return row ? (JSON.parse(row.doc) as Doc) : null;
  }

  putMeal(doc: Doc): void {
    this.db.prepare(`INSERT INTO meal_records (_id, participantCode, status, evaluationStatus, mealSessionId, createdAt, updatedAt, doc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(_id) DO UPDATE SET participantCode = excluded.participantCode, status = excluded.status,
        evaluationStatus = excluded.evaluationStatus, mealSessionId = excluded.mealSessionId,
        createdAt = excluded.createdAt, updatedAt = excluded.updatedAt, doc = excluded.doc`).run(
      doc._id, String(doc.participantCode || ''), String(doc.status || ''), String(doc.evaluationStatus || ''),
      String(doc.mealSessionId || ''), Number(doc.createdAt) || 0, Number(doc.updatedAt) || 0, JSON.stringify(doc),
    );
  }

  /** 读-改-写一条记录（同步，中间没有 await，不会与其他请求交错）。 */
  updateMeal(id: string, mutate: (doc: Doc) => Doc | void): Doc {
    return this.tx(() => {
      const doc = this.getMeal(id);
      if (!doc) throw new Error(`meal ${id} not found`);
      const next = mutate(doc) || doc;
      this.putMeal(next);
      return next;
    });
  }

  deleteMeal(id: string): void {
    this.db.prepare('DELETE FROM meal_records WHERE _id = ?').run(id);
  }

  queryMeals(where: string, params: (string | number)[], order = 'createdAt DESC', limit = 30): Doc[] {
    const rows = this.db.prepare(`SELECT doc FROM meal_records WHERE ${where} ORDER BY ${order} LIMIT ?`).all(...params, limit) as { doc: string }[];
    return rows.map((r) => JSON.parse(r.doc) as Doc);
  }

  allMeals(): Doc[] {
    return (this.db.prepare('SELECT doc FROM meal_records ORDER BY createdAt ASC').all() as { doc: string }[]).map((r) => JSON.parse(r.doc) as Doc);
  }

  // ---- questionnaire_responses ---------------------------------------------
  insertQuestionnaire(doc: Doc): boolean {
    const result = this.db.prepare('INSERT OR IGNORE INTO questionnaire_responses (_id, participantCode, createdAt, doc) VALUES (?, ?, ?, ?)')
      .run(doc._id, String(doc.participantCode), Number(doc.createdAt), JSON.stringify(doc));
    return Number(result.changes) === 1;
  }

  getQuestionnaire(id: string): Doc | null {
    const row = this.db.prepare('SELECT doc FROM questionnaire_responses WHERE _id = ?').get(id) as { doc: string } | undefined;
    return row ? (JSON.parse(row.doc) as Doc) : null;
  }

  listQuestionnaires(code: string, offset: number, limit: number): Doc[] {
    const rows = this.db.prepare('SELECT doc FROM questionnaire_responses WHERE participantCode = ? ORDER BY createdAt DESC, _id DESC LIMIT ? OFFSET ?')
      .all(code, limit, offset) as { doc: string }[];
    return rows.map((r) => JSON.parse(r.doc) as Doc);
  }

  allQuestionnaires(): Doc[] {
    return (this.db.prepare('SELECT doc FROM questionnaire_responses ORDER BY createdAt ASC').all() as { doc: string }[]).map((r) => JSON.parse(r.doc) as Doc);
  }
}
