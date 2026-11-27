// 菜品照片：存在 DATA_DIR/images/年-月/<id>.<ext>，只有有权查看对应编号的人能读取。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { canAccessCode, Session } from './auth';
import { Store } from './db';
import { HttpError } from './http';

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export interface ImageRow { id: string; path: string; mime: string; bytes: number; ownerKey: string; participantCode: string; createdAt: number }

function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

export function sessionOwnerKey(session: Session): string {
  return session.role === 'participant' ? `participant:${session.participantCode}` : 'researcher';
}

export class Images {
  constructor(private store: Store) {}

  save(session: Session, buf: Buffer): ImageRow {
    const type = sniff(buf);
    if (!type) throw new HttpError(415, '只支持 JPEG、PNG 或 WebP 照片', 'UNSUPPORTED_IMAGE');
    const id = crypto.randomBytes(16).toString('hex');
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const rel = path.join(month, `${id}.${type.ext}`);
    const abs = path.join(this.store.imageDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf, { flag: 'wx' });
    const row: ImageRow = { id, path: rel, mime: type.mime, bytes: buf.length, ownerKey: sessionOwnerKey(session),
      participantCode: session.role === 'participant' ? String(session.participantCode) : '', createdAt: now.getTime() };
    this.store.db.prepare('INSERT INTO images (id, path, mime, bytes, ownerKey, participantCode, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.path, row.mime, row.bytes, row.ownerKey, row.participantCode, row.createdAt);
    return row;
  }

  get(id: string): ImageRow | null {
    if (!/^[a-f0-9]{32}$/.test(id)) return null;
    return (this.store.db.prepare('SELECT * FROM images WHERE id = ?').get(id) as ImageRow | undefined) || null;
  }

  /** 上传者本人，或有权查看照片所属编号的人。 */
  canRead(session: Session, img: ImageRow): boolean {
    if (session.role === 'researcher') return true;
    if (img.ownerKey === sessionOwnerKey(session)) return true;
    return !!img.participantCode && canAccessCode(session, img.participantCode);
  }

  /** 建识别记录时把照片绑定到该记录的编号。 */
  attach(session: Session, id: string, participantCode: string): ImageRow {
    const img = this.get(id);
    if (!img || !this.canRead(session, img)) throw new HttpError(400, '照片不存在，请重新上传', 'IMAGE_NOT_FOUND');
    if (img.participantCode && img.participantCode !== participantCode && session.role !== 'researcher') {
      throw new HttpError(403, '这张照片不属于当前编号', 'FORBIDDEN');
    }
    this.store.db.prepare('UPDATE images SET participantCode = ? WHERE id = ?').run(participantCode, id);
    return { ...img, participantCode };
  }

  readBase64DataUrl(id: string): string {
    const img = this.get(id);
    if (!img) throw new Error('记录里的照片不存在，可能上传步骤没成功');
    const buf = fs.readFileSync(path.join(this.store.imageDir, img.path));
    return `data:${img.mime};base64,${buf.toString('base64')}`;
  }

  /** 没有任何识别记录再引用时，删除照片文件。 */
  removeIfUnused(id: string): void {
    const img = this.get(id);
    if (!img) return;
    const used = this.store.db.prepare("SELECT 1 FROM meal_records WHERE json_extract(doc, '$.imageFileId') = ? LIMIT 1").get(id);
    if (used) return;
    this.store.db.prepare('DELETE FROM images WHERE id = ?').run(id);
    fs.rmSync(path.join(this.store.imageDir, img.path), { force: true });
  }

  send(res: ServerResponse, img: ImageRow): void {
    const abs = path.join(this.store.imageDir, img.path);
    let stat: fs.Stats;
    try { stat = fs.statSync(abs); } catch { throw new HttpError(404, '照片不存在', 'NOT_FOUND'); }
    res.writeHead(200, { 'Content-Type': img.mime, 'Content-Length': stat.size, 'Cache-Control': 'private, max-age=31536000, immutable' });
    fs.createReadStream(abs).pipe(res);
  }
}
