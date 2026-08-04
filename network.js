// 核心：解決「公司WiFi是浮動IP」的網路驗證邏輯
// 做法：即時解析公司DDNS網域，取得「當下」的公司公網IP，
// 再跟這次打卡請求的來源IP比對，相符才算「已連上公司網路」。
const dns = require('dns').promises;

/**
 * 從 Express request 取得真實來源 IP。
 * 部署在 Cloud Run / 大部分雲端平台時，真實IP會在 x-forwarded-for。
 */
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    // x-forwarded-for 可能是 "client, proxy1, proxy2"，取第一個
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress;
}

/**
 * 檢查來源IP是否等於公司DDNS網域目前解析出的IP。
 * @param {string} clientIp
 * @returns {Promise<{ok: boolean, companyIp?: string, reason?: string}>}
 */
async function isFromCompanyNetwork(clientIp) {
  const hostname = process.env.COMPANY_DDNS_HOSTNAME;
  if (!hostname) {
    return { ok: false, reason: '尚未設定 COMPANY_DDNS_HOSTNAME' };
  }

  try {
    const addresses = await dns.resolve4(hostname);
    const ok = addresses.includes(clientIp);
    return { ok, companyIp: addresses.join(','), reason: ok ? undefined : '目前打卡的網路不是公司網路' };
  } catch (err) {
    return { ok: false, reason: `DDNS 網域解析失敗：${err.message}` };
  }
}

module.exports = { getClientIp, isFromCompanyNetwork };
