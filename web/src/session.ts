// 当前登录身份（启动时从 /api/session 读取）。参与者身份的编号由服务端绑定，页面不能改。
import type { SessionInfo } from './api';

export const session: SessionInfo = { role: 'researcher', participantCode: null, label: '' };

export function setSession(info: SessionInfo): void {
  Object.assign(session, info);
}

export function isParticipant(): boolean {
  return session.role === 'participant' && !!session.participantCode;
}
