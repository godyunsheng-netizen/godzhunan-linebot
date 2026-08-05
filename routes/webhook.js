// LINE Messaging API的Webhook：讓老闆直接在LINE跟機器人聊天視窗打關鍵字，
// 就能手動誘發「推送月報」或「推送表單連結」，不用跑去GitHub Actions點按鈕。
// 只有老闆自己（LINE_OWNER_USER_ID）傳的訊息才會被處理，避免任何加這個官方帳號好友的人亂觸發。
const express = require('express');
const crypto = require('crypto');
const {
  runMonthlyReport,
  pushLineMessage,
  listEmployeeSheetLinks,
  isReportConfigured,
} = require('../monthlyReport');

const router = express.Router();

// LINE Webhook需要用「原始body」計算簽章才能驗證是不是LINE真的送來的，
// 這裡用專屬的json parser把rawBody保留下來，注意要在server.js全域的express.json()之前掛載
const jsonWithRawBody = express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
});

function isValidSignature(req) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !req.rawBody) return false;
  const signature = crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64');
  return signature === req.header('x-line-signature');
}

// 打「月報」類關鍵字：立刻產生/更新上個月的月報並推播（跟每月1日自動觸發的內容一樣）
const MONTHLY_REPORT_KEYWORDS = ['月報', '打卡月報', '本月月報'];
// 打「連結」類關鍵字：直接推送目前每位員工的打卡表單連結
const SHEET_LINK_KEYWORDS = ['連結', '表單', '表單連結', '打卡表單'];

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  // 只回應老闆本人傳的訊息
  if (!process.env.LINE_OWNER_USER_ID || event.source.userId !== process.env.LINE_OWNER_USER_ID) {
    return;
  }

  const text = (event.message.text || '').trim();

  try {
    if (MONTHLY_REPORT_KEYWORDS.some((kw) => text.includes(kw))) {
      if (!isReportConfigured()) {
        await pushLineMessage('⚠️ 月報功能尚未設定完整環境變數');
        return;
      }
      await runMonthlyReport({});
      return;
    }

    if (SHEET_LINK_KEYWORDS.some((kw) => text.includes(kw))) {
      const links = await listEmployeeSheetLinks();
      let msg;
      if (links.length === 0) {
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        msg = `📋 打卡紀錄表單連結：\nhttps://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
      } else if (links.length === 1) {
        msg = `📋 打卡紀錄表單連結：\n${links[0].url}`;
      } else {
        msg = `📋 打卡紀錄表單連結：\n${links.map((l) => `${l.name}：\n${l.url}`).join('\n\n')}`;
      }
      await pushLineMessage(msg);
    }
  } catch (err) {
    console.error('[line-webhook] 處理關鍵字觸發時發生錯誤：', err);
    await pushLineMessage(`⚠️ 處理指令時發生錯誤：${err.message}`).catch(() => {});
  }
}

// POST /api/line-webhook
router.post('/line-webhook', jsonWithRawBody, (req, res) => {
  // 先馬上回200，避免LINE覺得逾時而重送同一個事件；實際處理放到背景做
  res.sendStatus(200);

  if (!isValidSignature(req)) {
    console.warn('[line-webhook] 簽章驗證失敗，忽略這次請求');
    return;
  }

  const events = (req.body && req.body.events) || [];
  events.forEach((event) => {
    handleEvent(event).catch((err) => console.error('[line-webhook] 處理事件失敗：', err));
  });
});

module.exports = router;
