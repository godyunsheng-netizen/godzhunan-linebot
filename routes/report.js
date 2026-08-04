const express = require('express');
const { runMonthlyReport } = require('../monthlyReport');

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

module.exports = router;
