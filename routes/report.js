const express = require('express');
const { runMonthlyReport, pushLineMessage, isReportConfigured } = require('../monthlyReport');

const router = express.Router();

// POST /api/monthly-report/run?year=2026&month=7（year/month選填，用來手動測試指定月份，預設是上個月）
// 需要在 header 帶 x-cron-secret，跟環境變數 REPORT_CRON_SECRET 相符才能觸發，避免被亂打
router.post('/monthly-report/run', async (req, res) => {
  const secret = req.header('x-cron-secret');
  if (!process.env.REPORT_CRON_SECRET || secret !== process.env.REPORT_CRON_SECRET) {
    return res.status(403).json({ ok: false, message: '缺少或錯誤的密鑰' });
  }

  try {
    const result = await runMonthlyReport({
      overrideYear: req.query.year,
      overrideMonth: req.query.month,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[monthly-report] 產生月報失敗：', err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/monthly-report/send-link  -> 把目前的打卡紀錄表單連結用LINE推播給老闆自己（方便隨時要連結時手動觸發）
// 一樣需要 x-cron-secret 才能觸發
router.post('/monthly-report/send-link', async (req, res) => {
  const secret = req.header('x-cron-secret');
  if (!process.env.REPORT_CRON_SECRET || secret !== process.env.REPORT_CRON_SECRET) {
    return res.status(403).json({ ok: false, message: '缺少或錯誤的密鑰' });
  }

  if (!isReportConfigured()) {
    return res.status(500).json({ ok: false, message: '尚未設定完整的Google/LINE環境變數' });
  }

  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    await pushLineMessage(`📋 打卡紀錄表單連結：\n${url}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[monthly-report] 推送表單連結失敗：', err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
