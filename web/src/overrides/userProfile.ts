// 网页版参与者编号：替换 miniprogram/services/userProfile.ts。
// 调研员登录时与小程序完全一样（本机记住上次填写的编号）；
// 参与者用专属链接登录时，编号由服务端绑定，读到的永远是本人编号，填别的编号也会被改回。
import {
  getUserProfile as originalGet,
  normalizeParticipantCode,
  saveUserProfile as originalSave,
} from '@mp-original/services/userProfile';
import type { UserProfile } from '@mp-original/services/userProfile';
import { isParticipant, session } from '../session';

export { normalizeParticipantCode };
export type { UserProfile };

export function getUserProfile(): UserProfile | null {
  if (isParticipant()) return { participantCode: session.participantCode as string };
  return originalGet();
}

export function saveUserProfile(input: { participantCode: string }): UserProfile {
  if (isParticipant()) return originalSave({ participantCode: session.participantCode as string });
  return originalSave(input);
}
