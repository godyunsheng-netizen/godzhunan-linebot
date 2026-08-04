// 驗證前端傳來的 LIFF Access Token 是不是真的、屬於哪個LINE使用者。
// 目的：防止有人偽造 line_user_id 直接打API幫別人打卡。
const axios = require('axios');

async function verifyLiffToken(accessToken) {
  // TEST_MODE：還沒申請LINE官方帳號/LIFF ID時，先用假使用者測試整條打卡流程
  // 正式上線前務必在 .env 把 TEST_MODE 改成 false 或刪掉
  if (process.env.TEST_MODE === 'true') {
    return { ok: true, userId: 'test-user-001', name: '測試員工' };
  }

  try {
    const { data } = await axios.get('https://api.line.me/oauth2/v2.1/verify', {
      params: { access_token: accessToken },
    });
    // data.client_id 應等於你的 LIFF/Channel ID
    if (String(data.client_id) !== String(process.env.LINE_CHANNEL_ID)) {
      return { ok: false, reason: 'token不屬於本頻道' };
    }

    // 取得使用者 profile 以拿到 userId
    const profileRes = await axios.get('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return { ok: true, userId: profileRes.data.userId, name: profileRes.data.displayName };
  } catch (err) {
    return { ok: false, reason: 'LIFF token 驗證失敗或已過期' };
  }
}

module.exports = { verifyLiffToken };
