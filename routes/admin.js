// 手動修正打卡紀錄的後端：給老闆用的，需要密碼（ADMIN_PASSWORD）才能查詢/修正。
// 使用情境：同事出任務提早離開、忘記在公司WiFi打下班卡等，防呆機制正確擋下但需要人工補登的狀況。
const express = require('express');
const { correctPunch } = require('../sheets');
const { listEmployeeSheetLinks } = require('../monthlyReport');

const router = express.Router();

function checkPassword(req) {
  const password = req.header('x-admin-password') || req.query.password || (req.body && req.body.password);
  return !!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
}

// GET /api/admin/employees?password=xxx  -> 給修正頁面的下拉選單用，列出目前有打卡紀錄的員工姓名
router.get('/admin/employees', async (req, res) => {
  if (!checkPassword(req)) {
    return res.status(401).json({ ok: false, message: '密碼錯誤' });
  }
  try {
    const links = await listEmployeeSheetLinks();
    return res.json({ ok: true, names: links.map((l) => l.name) });
  } catch (err) {
    console.error('[admin] 讀取員工清單失敗：', err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/admin/correct  body: { password, name, date, type, time, note }
router.post('/admin/correct', async (req, res) => {
  if (!checkPassword(req)) {
    return res.status(401).json({ ok: false, message: '密碼錯誤' });
  }

  const { name, date, type, time, note } = req.body || {};
  if (!name || !date || !['in', 'out'].includes(type) || !time) {
    return res.status(400).json({ ok: false, message: '缺少必要欄位（姓名/日期/類型/時間）' });
  }

  try {
    const result = await correctPunch({ name, date, type, time, note });
    if (!result.ok) {
      return res.status(500).json({ ok: false, message: result.reason || '修正失敗' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] 修正打卡紀錄失敗：', err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
