const express = require('express');
const db = require('../db');
const { getClientIp, isFromCompanyNetwork } = require('../network');
const { verifyLiffToken } = require('../liffAuth');

const router = express.Router();

// POST /api/punch  body: { accessToken, type: 'in'|'out' }
router.post('/punch', async (req, res) => {
  const { accessToken, type } = req.body;

  if (!accessToken || !['in', 'out'].includes(type)) {
    return res.status(400).json({ ok: false, message: '缺少參數，或打卡類型錯誤' });
  }

  // 1. 驗證身份
  const auth = await verifyLiffToken(accessToken);
  if (!auth.ok) {
    return res.status(401).json({ ok: false, message: auth.reason });
  }

  // 2. 驗證是否連上公司網路
  const clientIp = getClientIp(req);
  const skip = process.env.SKIP_NETWORK_CHECK === 'true';
  const netCheck = skip ? { ok: true } : await isFromCompanyNetwork(clientIp);

  if (!netCheck.ok) {
    // 仍記錄一筆失敗紀錄，方便日後查核異常打卡嘗試
    db.prepare(
      `INSERT INTO punches (line_user_id, type, timestamp, source_ip, verified) VALUES (?, ?, ?, ?, 0)`
    ).run(auth.userId, type, new Date().toISOString(), clientIp);

    return res.status(403).json({
      ok: false,
      message: '打卡失敗：請連上公司WiFi後再試一次',
      reason: netCheck.reason,
    });
  }

  // 3. 確保員工存在（第一次打卡自動建檔）
  db.prepare(
    `INSERT INTO employees (line_user_id, name) VALUES (?, ?)
     ON CONFLICT(line_user_id) DO UPDATE SET name = excluded.name`
  ).run(auth.userId, auth.name);

  // 4. 寫入打卡紀錄
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO punches (line_user_id, type, timestamp, source_ip, verified) VALUES (?, ?, ?, ?, 1)`
  ).run(auth.userId, type, timestamp, clientIp);

  return res.json({
    ok: true,
    message: type === 'in' ? '上班打卡成功' : '下班打卡成功',
    timestamp,
  });
});

// GET /api/punch/history?accessToken=xxx  -> 員工查詢自己的打卡紀錄（第二階段功能，先留API）
router.get('/punch/history', async (req, res) => {
  const auth = await verifyLiffToken(req.query.accessToken);
  if (!auth.ok) {
    return res.status(401).json({ ok: false, message: auth.reason });
  }

  const rows = db
    .prepare(`SELECT type, timestamp, verified FROM punches WHERE line_user_id = ? ORDER BY timestamp DESC LIMIT 30`)
    .all(auth.userId);

  return res.json({ ok: true, records: rows });
});

module.exports = router;
