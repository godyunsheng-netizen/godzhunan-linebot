// 每月月報：從各員工的Google試算表分頁彙整上個月的打卡紀錄，
// 在同一份「尬癮茶打卡紀錄」表單裡新增一個月報分頁（總覽+明細），並用LINE推播通知連結。
// 註：不用「另外建立新檔案」的做法，是因為服務帳號在一般Gmail帳號下建立全新檔案會被
// Google擋下權限（沒有Drive儲存空間），改成在既有、已分享的表單裡加分頁就完全沒有這個問題。
const { google } = require('googleapis');
const axios = require('axios');
const { getAuth, isConfigured: isGoogleConfigured } = require('./googleAuth');
const { quoteSheetName, sanitizeSheetName } = require('./sheets');

const LEGACY_SHEET_TITLE = '工作表1'; // 早期還沒分人之前的舊分頁，月報彙整時要排除，避免重複計算
// 月報彙整多位員工的明細時需要姓名欄；員工個人分頁現在把姓名放在最上面一列，不再跟著每天的資料重複，
// 所以月報這裡用分頁名稱（跟姓名同源）補回姓名欄，明細表頭仍保留「姓名」方便一次看多位員工
const REPORT_DETAIL_HEADER = ['姓名', '日期', '星期幾', '上班時間', '下班時間', '備註'];

function isReportConfigured() {
  return !!(
    isGoogleConfigured() &&
    process.env.LINE_CHANNEL_ACCESS_TOKEN &&
    process.env.LINE_OWNER_USER_ID
  );
}

// 台灣時間（UTC+8）現在的年/月，用來算「上個月」
function getTaipeiNow() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

// 回傳要出月報的目標年月（預設是「現在」的上個月；可用參數強制指定，方便手動測試）
function resolveTargetMonth(overrideYear, overrideMonth) {
  if (overrideYear && overrideMonth) {
    return { year: Number(overrideYear), month: Number(overrideMonth) };
  }
  const now = getTaipeiNow();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-indexed 當月，減1就是上個月
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return { year, month }; // month為1-12
}

async function getSpreadsheetMeta(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  return data;
}

// 撈出所有員工分頁裡，時間落在目標月份的資料列
// 員工個人分頁的資料現在從第3列開始（第1列姓名、第2列表頭），欄位為：日期/星期幾/上班時間/下班時間/備註，
// 姓名沒有存在每一列裡，這裡改用分頁名稱（跟姓名同源）補回姓名欄，方便月報彙整多位員工
async function collectMonthRecords(sheets, spreadsheetId, year, month, meta) {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const titles = (meta.sheets || [])
    .map((s) => s.properties.title)
    .filter((title) => title !== LEGACY_SHEET_TITLE && !title.startsWith('月報_'));

  if (titles.length === 0) return [];

  const { data } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: titles.map((t) => `${quoteSheetName(t)}!A3:E`),
  });

  const rows = [];
  (data.valueRanges || []).forEach((vr, idx) => {
    const name = titles[idx];
    (vr.values || []).forEach((row) => {
      const dateStr = row[0] || ''; // 日期欄
      if (dateStr.startsWith(monthPrefix)) {
        rows.push([name, row[0] || '', row[1] || '', row[2] || '', row[3] || '', row[4] || '']);
      }
    });
  });

  rows.sort((a, b) => {
    if (a[0] !== b[0]) return String(a[0]).localeCompare(String(b[0]), 'zh-Hant');
    return String(a[1]).localeCompare(String(b[1]));
  });

  return rows;
}

// rows的欄位為：姓名/日期/星期幾/上班時間/下班時間/備註（一天一列）
function buildOverview(rows) {
  const byName = new Map();
  rows.forEach((row) => {
    const name = row[0] || '（未知）';
    const shangban = row[3];
    const xiaban = row[4];
    const note = row[5];
    if (!byName.has(name)) byName.set(name, { full: 0, missingOut: 0, notes: 0 });
    const stat = byName.get(name);
    if (shangban && xiaban) stat.full += 1;
    else if (shangban && !xiaban) stat.missingOut += 1;
    if (note) stat.notes += 1;
  });

  const overviewRows = [['姓名', '完整出勤天數', '忘記打下班卡天數', '異常次數']];
  byName.forEach((stat, name) => {
    overviewRows.push([name, stat.full, stat.missingOut, stat.notes]);
  });
  return overviewRows;
}

// 在既有的打卡紀錄表單裡新增（或更新）一個「月報_YYYY年MM月」分頁，寫入總覽+明細
// 如果這個月的月報分頁已經存在（例如用關鍵字重複手動觸發），改成清空重寫，不會一直增生新分頁而出錯
async function createReportSheet({ sheetsApi, spreadsheetId, year, month, rows }) {
  const title = sanitizeSheetName(`月報_${year}年${String(month).padStart(2, '0')}月`);

  const meta = await getSpreadsheetMeta(sheetsApi, spreadsheetId);
  const existing = (meta.sheets || []).find((s) => s.properties.title === title);

  let sheetId;
  if (existing) {
    sheetId = existing.properties.sheetId;
    await sheetsApi.spreadsheets.values.clear({
      spreadsheetId,
      range: `${quoteSheetName(title)}!A1:Z10000`,
    });
  } else {
    const { data: batchUpdateResult } = await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
    sheetId = batchUpdateResult.replies[0].addSheet.properties.sheetId;
  }

  const overviewRows = buildOverview(rows);
  const detailStartRow = overviewRows.length + 2; // 總覽下面空一行再放明細

  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${quoteSheetName(title)}!A1`, values: overviewRows },
        { range: `${quoteSheetName(title)}!A${detailStartRow}`, values: [REPORT_DETAIL_HEADER, ...rows] },
      ],
    },
  });

  return {
    title,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
  };
}

async function pushLineMessage(text) {
  await axios.post(
    'https://api.line.me/v2/bot/message/push',
    {
      to: process.env.LINE_OWNER_USER_ID,
      messages: [{ type: 'text', text }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// 主流程：產生月報並用LINE通知；overrideYear/overrideMonth 可用來手動測試指定月份
async function runMonthlyReport({ overrideYear, overrideMonth } = {}) {
  if (!isReportConfigured()) {
    throw new Error(
      '月報功能尚未設定完整環境變數（需要 GOOGLE_*, LINE_CHANNEL_ACCESS_TOKEN, LINE_OWNER_USER_ID）'
    );
  }

  const { year, month } = resolveTargetMonth(overrideYear, overrideMonth);
  const auth = getAuth();
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const meta = await getSpreadsheetMeta(sheetsApi, spreadsheetId);
  const rows = await collectMonthRecords(sheetsApi, spreadsheetId, year, month, meta);

  if (rows.length === 0) {
    await pushLineMessage(`📊 ${year}年${month}月 打卡月報\n這個月沒有任何打卡紀錄。`);
    return { year, month, count: 0, sent: true };
  }

  const report = await createReportSheet({ sheetsApi, spreadsheetId, year, month, rows });

  const uniqueNames = new Set(rows.map((r) => r[0]));
  await pushLineMessage(
    `📊 ${year}年${month}月 打卡月報已產生\n員工人數：${uniqueNames.size}人\n打卡總筆數：${rows.length}筆\n\n${report.url}`
  );

  return { year, month, count: rows.length, sent: true, url: report.url };
}

// 列出目前每位員工分頁的直接連結（跳過「工作表1」這種早期測試留下的舊分頁、以及月報分頁），
// 用來取代「純粹貼整份試算表的連結」——因為那樣打開會停在第一個分頁（工作表1，還是舊格式），
// 不會直接看到真正的打卡紀錄
async function listEmployeeSheetLinks() {
  const auth = getAuth();
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const meta = await getSpreadsheetMeta(sheetsApi, spreadsheetId);

  return (meta.sheets || [])
    .map((s) => s.properties)
    .filter((p) => p.title !== LEGACY_SHEET_TITLE && !p.title.startsWith('月報_'))
    .map((p) => ({
      name: p.title,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${p.sheetId}`,
    }));
}

module.exports = {
  runMonthlyReport,
  resolveTargetMonth,
  isReportConfigured,
  pushLineMessage,
  listEmployeeSheetLinks,
};
