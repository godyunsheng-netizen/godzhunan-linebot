// 手動修正打卡紀錄的後端：每位登入者（老闆、店長...）都有自己專屬的帳號密碼，不共用。
// 使用情境：同事出任務提早離開、忘記在公司WiFi打下班卡等，防呆機制正確擋下但需要人工補登的狀況。
const express = require('express');
const { correctPunch, sortEmployeeSheet } = require('../sheets');
const { listEmployeeSheetLinks } = require('../monthlyReport');

const router = express.Router();

// 環境變數 ADMIN_USERS 格式：姓名1:密碼1,姓名2:密碼2 （逗號分隔多組帳密，冒號分隔姓名跟密碼）
// 例如：ADMIN_USERS=老闆:aaa111,店長:bbb222
function parseAdminUsers() {
  const raw = process.env.ADMIN_USERS || '';
  const map = {};
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf(':');
      if (idx === -1) return;
      const name = pair.slice(0, idx).trim();
      const pass = pair.slice(idx + 1).trim();
      if (name && pass) map[name] = pass;
    });
  return map;
}

// 驗證「姓名＋密碼」是否為 ADMIN_USERS 裡登記的其中一組，回傳 { ok, operator }
// operator 一律用伺服器這邊比對成功的姓名（不是前端亂打的），確保備註欄記錄的身份可信
function authenticate(req) {
  const operator =
    req.header('x-admin-user') || req.query.operator || (req.body && req.body.operator);
  const password =
    req.header('x-admin-password') || req.query.password || (req.body && req.body.password);

  if (!operator || !password) return { ok: false };

  const users = parseAdminUsers();
  const trimmedOperator = String(operator).trim();
  if (users[trimmedOperator] && users[trimmedOperator] === password) {
    return { ok: true, operator: trimmedOperator };
  }
  return { ok: false };
}

// GET /api/admin/employees?operator=xxx&password=xxx  -> 給修正頁面的下拉選單用，列出目前有打卡紀錄的員工姓名
router.get('/admin/employees', async (req, res) => {
  const auth = authenticate(req);
  if (!auth.ok) {
    return res.status(401).json({ ok: false, message: '姓名或密碼錯誤' });
  }
  try {
    const links = await listEmployeeSheetLinks();
    return res.json({ ok: true, names: links.map((l) => l.name) });
  } catch (err) {
    console.error('[admin] 讀取員工清單失敗：', err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/admin/correct  body: { operator, password, name, date, type, time, note }
router.post('/admin/correct', async (req, res) => {
  const auth = authenticate(req);
  if (!auth.ok) {
    return res.status(401).json({ ok: false, message: '姓名或密碼錯誤' });
  }

  const { name, date, type, time, note } = req.body || {};
  if (!name || !date || !['in', 'out'].includes(type) || !time) {
    return res.status(400).json({ ok: false, message: '缺少必要欄位（姓名/日期/類型/時間）' });
  }

  try {
    const result = await correctPunch({ name, date, type, time, note, operator: auth.operator });
    if (!result.ok) {
      return res.status(500).json({ ok: false, message: result.reason || '修正失敗' });
    }
    console.log(`[admin] 修正成功：操作人=${auth.operator} 對象=${name} 日期=${date} 類型=${type} 時間=${time}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] 修正打卡紀錄失敗：', err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/admin/sort  body: { operator, password }  -> 把所有員工分頁都依日期新→舊重新排序
router.post('/admin/sort', async (req, res) => {
  const auth = authenticate(req);
  if (!auth.ok) {
    return res.status(401).json({ ok: false, message: '姓名或密碼錯誤' });
  }
  try {
    const links = await listEmployeeSheetLinks();
    for (const link of links) {
      await sortEmployeeSheet(link.name);
    }
    console.log(`[admin] 重新排序完成：操作人=${auth.operator} 共${links.length}位員工`);
    return res.json({ ok: true, count: links.length });
  } catch (err) {
    console.error('[admin] 重新排序失敗：', err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
