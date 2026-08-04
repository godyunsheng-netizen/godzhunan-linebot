// 將打卡紀錄永久寫入 Google 試算表（作為SQLite以外的永久備份，方便用Excel/Google試算表統計）
// 每位員工會各自有一個分頁（工作表），彼此打卡紀錄不會混在一起
const { google } = require('googleapis');

let sheetsClient = null;
let knownSheetTitles = null; // 快取這份試算表目前有哪些分頁，避免每次打卡都重新查詢

const HEADER_ROW = ['姓名', 'LINE User ID', '類型', '時間', 'IP位址', '驗證結果'];

function isConfigured() {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_SHEET_ID
  );
}

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  // Render環境變數不支援直接貼多行文字，私鑰會用 \n 代表換行，這裡要還原成真正的換行字元
  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

// Google試算表的分頁名稱不能包含 [ ] * ? / \ : ，長度也有上限，這裡做基本清理
function sanitizeSheetName(rawName) {
  const cleaned = String(rawName || '未命名員工').replace(/[[\]*?/\\:]/g, '_').trim();
  return cleaned.slice(0, 90) || '未命名員工';
}

// 分頁名稱如果含空白或單引號，要加引號並跳脫，A1 range才能正確指到那個分頁
function quoteSheetName(title) {
  return `'${title.replace(/'/g, "''")}'`;
}

async function loadKnownSheetTitles(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  knownSheetTitles = new Set((data.sheets || []).map((s) => s.properties.title));
}

// 如果這位員工還沒有專屬分頁，就自動新增一個並加上標題列
async function ensureSheetExists(sheets, spreadsheetId, title) {
  if (!knownSheetTitles) {
    await loadKnownSheetTitles(sheets, spreadsheetId);
  }
  if (knownSheetTitles.has(title)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });
  knownSheetTitles.add(title);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(title)}!A1:F1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADER_ROW] },
  });
}

// 寫入一筆打卡紀錄到該員工專屬分頁；失敗時只印log、不擋住打卡流程（SQLite已經是即時的正式紀錄）
async function appendPunchRecord({ name, lineUserId, type, timestamp, sourceIp, verified }) {
  if (!isConfigured()) {
    console.warn('[sheets] 尚未設定Google服務帳號環境變數，略過寫入Google試算表');
    return;
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetTitle = sanitizeSheetName(name || lineUserId);

    await ensureSheetExists(sheets, spreadsheetId, sheetTitle);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${quoteSheetName(sheetTitle)}!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          name || '',
          lineUserId || '',
          type === 'in' ? '上班' : '下班',
          timestamp,
          sourceIp || '',
          verified ? '成功' : '失敗（未連上公司網路）',
        ]],
      },
    });
  } catch (err) {
    console.error('[sheets] 寫入Google試算表失敗：', err.message);
  }
}

module.exports = { appendPunchRecord, isConfigured };
