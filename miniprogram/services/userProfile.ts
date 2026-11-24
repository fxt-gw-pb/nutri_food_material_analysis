/** 本机保存的参与者信息。当前只收集参与者编码，后续可在此扩展字段。 */
export interface UserProfile {
  participantCode: string;
}

const USER_PROFILE_KEY = 'user_profile_v1';
const MAX_PARTICIPANT_CODE_LENGTH = 32;

/**
 * 规范化参与者编码。
 * 编码可能包含前导零，因此这里只做 trim 和长度校验，不转换成数字，
 * 也不额外限制字符集。非法输入直接抛错，避免调用方把空编码当成成功。
 */
export function normalizeParticipantCode(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('参与者编码必须是文本');
  }
  const code = value.trim();
  if (!code) {
    throw new Error('请填写参与者编码');
  }
  if (code.length > MAX_PARTICIPANT_CODE_LENGTH) {
    throw new Error(`参与者编码不能超过 ${MAX_PARTICIPANT_CODE_LENGTH} 个字符`);
  }
  return code;
}

/** 读取本机上次保存的编码；存储内容损坏时按未填写处理并记录错误。 */
export function getUserProfile(): UserProfile | null {
  try {
    const value = wx.getStorageSync(USER_PROFILE_KEY) as Partial<UserProfile> | '' | null | undefined;
    if (!value || typeof value !== 'object') return null;
    if (typeof value.participantCode !== 'string') return null;
    try {
      return { participantCode: normalizeParticipantCode(value.participantCode) };
    } catch (err) {
      console.error('[userProfile] invalid stored profile', err);
      return null;
    }
  } catch (err) {
    console.error('[userProfile] read failed', err);
    return null;
  }
}

/** 保存并返回规范化后的编码。存储失败必须向上抛出，不能提示保存成功。 */
export function saveUserProfile(input: { participantCode: string }): UserProfile {
  const profile: UserProfile = {
    participantCode: normalizeParticipantCode(input.participantCode),
  };
  try {
    wx.setStorageSync(USER_PROFILE_KEY, profile);
  } catch (err) {
    console.error('[userProfile] write failed', err);
    throw new Error('参与者编码保存失败，请重试');
  }
  return profile;
}
