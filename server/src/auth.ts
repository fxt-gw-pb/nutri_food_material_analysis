// 封闭访问：调研员口令 + 参与者专属链接。替代小程序里的微信 _openid。
//
//  - 调研员：输入口令登录（30 天），可以为任意参与者编号拍照、评估、查看。
//  - 参与者：扫专属链接 /p/<令牌>（180 天，期间每次使用自动续期），只能读写本人编号的数据。
//    令牌只存哈希；重新发码或停用会让旧链接与已登录的设备立刻失效。
//  - 服务端每个接口都按身份校验参与者编号，绝不只凭前端传来的编号返回数据。
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { cookieSecure, ServerConfig } from './config';
import { Store } from './db';
import { HttpError, parseCookies } from './http';

export const COOKIE_NAME = 'fsid';
const DAY = 24 * 3600 * 1000;
const TTL = { researcher: 30 * DAY, participant: 180 * DAY } as const;

export type Role = 'researcher' | 'participant';
export interface Session {
  idHash: string;
  role: Role;
  participantCode: string | null;
  tokenIssuedAt: number | null;
  expiresAt: number;
}

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(24).toString('base64url');

export function normalizeCode(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 32) {
    throw new HttpError(400, '请填写 1–32 个字符的参与者编号', 'INVALID_INPUT');
  }
  return value.trim();
}

function cookieHeader(config: ServerConfig, value: string, maxAgeMs: number): string {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (cookieSecure(config)) parts.push('Secure');
  return parts.join('; ');
}

export class Auth {
  private failures = new Map<string, { count: number; until: number }>();

  constructor(private store: Store, private config: ServerConfig) {}

  // ---- 会话 -------------------------------------------------------------------
  createSession(res: ServerResponse, role: Role, participantCode: string | null, tokenIssuedAt: number | null): void {
    const raw = randomToken();
    const now = Date.now();
    this.store.db.prepare('INSERT INTO sessions (idHash, role, participantCode, tokenIssuedAt, createdAt, expiresAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sha256(raw), role, participantCode, tokenIssuedAt, now, now + TTL[role], now);
    res.setHeader('Set-Cookie', cookieHeader(this.config, raw, TTL[role]));
  }

  /** 读取并校验会话；参与者会话还要核对令牌没被停用或重新签发。 */
  session(req: IncomingMessage, res?: ServerResponse): Session | null {
    const raw = parseCookies(req)[COOKIE_NAME];
    if (!raw) return null;
    const idHash = sha256(raw);
    const row = this.store.db.prepare('SELECT idHash, role, participantCode, tokenIssuedAt, expiresAt FROM sessions WHERE idHash = ?').get(idHash) as Session | undefined;
    const now = Date.now();
    if (!row || row.expiresAt <= now) {
      if (row) this.store.db.prepare('DELETE FROM sessions WHERE idHash = ?').run(idHash);
      return null;
    }
    if (row.role === 'participant') {
      const p = this.store.db.prepare('SELECT tokenIssuedAt, revokedAt FROM participants WHERE code = ?').get(row.participantCode) as
        { tokenIssuedAt: number | null; revokedAt: number | null } | undefined;
      if (!p || p.revokedAt || p.tokenIssuedAt !== row.tokenIssuedAt) {
        this.store.db.prepare('DELETE FROM sessions WHERE idHash = ?').run(idHash);
        return null;
      }
    }
    // 滑动续期：剩余不到一半时顺延，并刷新 Cookie。
    const ttl = TTL[row.role];
    if (row.expiresAt - now < ttl / 2) {
      row.expiresAt = now + ttl;
      this.store.db.prepare('UPDATE sessions SET expiresAt = ?, lastSeenAt = ? WHERE idHash = ?').run(row.expiresAt, now, idHash);
      if (res) res.setHeader('Set-Cookie', cookieHeader(this.config, raw, ttl));
    }
    return row;
  }

  require(req: IncomingMessage, res: ServerResponse): Session {
    const s = this.session(req, res);
    if (!s) throw new HttpError(401, '请先登录', 'UNAUTHENTICATED');
    return s;
  }

  logout(req: IncomingMessage, res: ServerResponse): void {
    const raw = parseCookies(req)[COOKIE_NAME];
    if (raw) this.store.db.prepare('DELETE FROM sessions WHERE idHash = ?').run(sha256(raw));
    res.setHeader('Set-Cookie', cookieHeader(this.config, '', 0));
  }

  // ---- 调研员口令 ---------------------------------------------------------------
  checkPasscode(ip: string, passcode: string): boolean {
    const now = Date.now();
    const f = this.failures.get(ip);
    if (f && f.until > now && f.count >= 8) throw new HttpError(429, '尝试次数过多，请 15 分钟后再试', 'RATE_LIMITED');
    if (!this.config.researcherPasscode) throw new HttpError(503, '服务器未设置调研员口令', 'NOT_CONFIGURED');
    const ok = crypto.timingSafeEqual(Buffer.from(sha256(passcode)), Buffer.from(sha256(this.config.researcherPasscode)));
    if (ok) { this.failures.delete(ip); return true; }
    const next = f && f.until > now ? { count: f.count + 1, until: f.until } : { count: 1, until: now + 15 * 60 * 1000 };
    this.failures.set(ip, next);
    return false;
  }

  // ---- 参与者链接 ---------------------------------------------------------------
  /** 签发（或重新签发）专属链接令牌；旧令牌和用旧令牌登录的设备随即失效。 */
  issueParticipantToken(code: string, note = ''): string {
    const participantCode = normalizeCode(code);
    const token = randomToken();
    const now = Date.now();
    this.store.db.prepare(`INSERT INTO participants (code, tokenHash, tokenIssuedAt, revokedAt, note, createdAt) VALUES (?, ?, ?, NULL, ?, ?)
      ON CONFLICT(code) DO UPDATE SET tokenHash = excluded.tokenHash, tokenIssuedAt = excluded.tokenIssuedAt, revokedAt = NULL,
        note = CASE WHEN excluded.note = '' THEN participants.note ELSE excluded.note END`).run(participantCode, sha256(token), now, note, now);
    this.store.db.prepare("DELETE FROM sessions WHERE role = 'participant' AND participantCode = ?").run(participantCode);
    return token;
  }

  revokeParticipant(code: string): boolean {
    const result = this.store.db.prepare('UPDATE participants SET revokedAt = ?, tokenHash = NULL WHERE code = ?').run(Date.now(), normalizeCode(code));
    this.store.db.prepare("DELETE FROM sessions WHERE role = 'participant' AND participantCode = ?").run(code.trim());
    return Number(result.changes) > 0;
  }

  participantByToken(token: string): { code: string; tokenIssuedAt: number } | null {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    const row = this.store.db.prepare('SELECT code, tokenIssuedAt FROM participants WHERE tokenHash = ? AND revokedAt IS NULL').get(sha256(token)) as
      { code: string; tokenIssuedAt: number } | undefined;
    return row || null;
  }

  participantLink(token: string): string {
    return `${this.config.publicOrigin || `http://localhost:${this.config.port}`}/p/${token}`;
  }
}

// ---- 数据访问权限 -------------------------------------------------------------
/** 这个身份能否读写该编号的数据。调研员不限；参与者只能是本人编号。 */
export function canAccessCode(session: Session, code: string): boolean {
  return session.role === 'researcher' || session.participantCode === code;
}

export function assertCode(session: Session, code: string): void {
  if (!canAccessCode(session, code)) throw new HttpError(403, '只能查看本人编号的记录', 'FORBIDDEN');
}

/** 写进文档 _openid 字段的创建者标识（导出脚本据此区分账号）。 */
export function actorKey(session: Session): string {
  return session.role === 'participant' ? `web:participant:${session.participantCode}` : 'web:researcher';
}
