// 將打卡紀錄永久寫入 Google 試算表（作為SQLite以外的永久備份，方便用Excel/Google試算表統計）
// 每位員工會各自有一個分頁（工作表），彼此打卡紀錄不會混在一起。
// 表格格式：姓名放在最上面一列（跟日期等資訊分開），下面才是「一天一列」的打卡表格：
//   第1列：姓名：xxx
//   第2列：日期 / 星期幾 / 上班時間 / 下班時間 / 備註（表頭）
//   第3列開始：每天一列的打卡資料
// 這份表單同時也是「修正機制」：擁有者本來就是這份表單的Google帳號擁有者，
// 打錯時間、忘記打下班卡等狀況，直接打開表單編輯儲存格即可修正，不需要另外做登入系統。
const { google } = require('googleapis');
const { getAuth, isConfigured } = require('./googleAuth');

let sheetsClient = null;
let knownSheetTitles = null; // 快取這份試算表目前有哪些分頁，避免每次打卡都重新查詢
let headerCheckedTitles = new Set(); // 這次程式執行期間，已經確認過表頭是新格式的分頁，避免重複檢查

const NAME_LABEL = '姓名：';
const HEADER_ROW = ['日期', '星期幾', '上班時間', '下班時間', '備註']; // A~E，資料表格的表頭（不含姓名）
const OLD_HEADER_ROW = ['姓名', '日期', '星期幾', '上班時間', '下班時間', '備註']; // 舊格式：姓名跟資料同一列
const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  sheetsClient = google.sheets({ version: 'v4', auth: getAuth() });
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

// 把ISO時間字串轉成台灣時間的日期/時間/星期幾
function toTaipeiParts(isoTimestamp) {
  const shifted = new Date(new Date(isoTimestamp).getTime() + 8 * 60 * 60 * 1000);
  const dateStr = shifted.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = shifted.toISOString().slice(11, 16); // HH:MM
  const weekday = WEEKDAY_NAMES[shifted.getUTCDay()];
  return { dateStr, timeStr, weekday };
}

// 純日期字串（YYYY-MM-DD，手動修正表單用）算出是星期幾，不牽涉時區偏移
function weekdayFromDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return WEEKDAY_NAMES[d.getUTCDay()];
}

async function loadKnownSheetTitles(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  knownSheetTitles = new Set((data.sheets || []).map((s) => s.properties.title));
}

// 寫入「姓名列＋表頭列」（A1:E2），姓名只出現這一次，不會跟著每天的資料重複
async function writeNameAndHeader(sheets, spreadsheetId, title, employeeName) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(title)}!A1:E2`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[NAME_LABEL, employeeName, '', '', ''], HEADER_ROW] },
  });
}

// 如果這位員工還沒有專屬分頁，就自動新增一個並加上姓名列＋表頭列；
// 如果分頁已存在但格式是舊版（姓名跟資料同一列），自動把姓名搬到最上面一列，
// 資料列轉成新格式後重新寫入，盡量保留既有的打卡紀錄，避免資料遺失。
async function ensureSheetExists(sheets, spreadsheetId, title, employeeName) {
  if (!knownSheetTitles) {
    await loadKnownSheetTitles(sheets, spreadsheetId);
  }

  if (!knownSheetTitles.has(title)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
    knownSheetTitles.add(title);
    await writeNameAndHeader(sheets, spreadsheetId, title, employeeName);
    headerCheckedTitles.add(title);
    return;
  }

  if (headerCheckedTitles.has(title)) return;

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(title)}!A1:F2`,
  });
  const values = data.values || [];
  const row1 = values[0] || [];
  const row2 = values[1] || [];

  const isNewFormat = row1[0] === NAME_LABEL && HEADER_ROW.every((col, i) => row2[i] === col);
  if (isNewFormat) {
    headerCheckedTitles.add(title);
    return;
  }

  // 判斷是不是舊格式（第一列就是「姓名/日期/星期幾/上班時間/下班時間/備註」表頭）
  const isOldFormat = OLD_HEADER_ROW.every((col, i) => row1[i] === col);

  let migratedRows = [];
  if (isOldFormat) {
    const { data: oldData } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteSheetName(title)}!A2:F`,
    });
    // 舊格式欄位為：姓名/日期/星期幾/上班時間/下班時間/備註，轉成新格式只留：日期/星期幾/上班時間/下班時間/備註
    migratedRows = (oldData.values || []).map((r) => [r[1] || '', r[2] || '', r[3] || '', r[4] || '', r[5] || '']);
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${quoteSheetName(title)}!A1:Z10000`,
  });

  await writeNameAndHeader(sheets, spreadsheetId, title, employeeName);

  if (migratedRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheetName(title)}!A3`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: migratedRows },
    });
  }

  headerCheckedTitles.add(title);
}

// 資料從第3列開始（第1列姓名、第2列表頭），欄位為：日期/星期幾/上班時間/下班時間/備註
async function getRows(sheets, spreadsheetId, title) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(title)}!A3:E`,
  });
  return data.values || [];
}

function findRowIndexByDate(rows, dateStr) {
  // 從後面找起，同一天理論上只會有一列，但如果表單被手動改過也以最新一筆為準
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][0] === dateStr) return i;
  }
  return -1;
}

// 找「已經打上班卡、還沒打下班卡」的那一列（可能是今天、也可能是忘記打卡的前幾天），
// 用來判斷下班卡可不可以打、以及要更新哪一列
function findOpenShiftIndex(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const shangban = rows[i][2];
    const xiaban = rows[i][3];
    if (shangban && !xiaban) return i;
  }
  return -1;
}

// 更新某一列的單一欄位（C=上班時間, D=下班時間, E=備註）
async function updateCell(sheets, spreadsheetId, title, rowNumber, column, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(title)}!${column}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
}

async function appendRow(sheets, spreadsheetId, title, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(title)}!A:E`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

/**
 * 記錄一筆「成功」的打卡（已經通過LINE身份驗證＋公司WiFi驗證）。
 * 內建防呆機制：
 *  - 上班：如果今天已經打過上班卡，回傳 ok:false，不會重複紀錄
 *  - 下班：如果找不到尚未結束的上班紀錄（代表根本沒打上班卡），回傳 ok:false
 * 回傳 { ok, reason? }
 */
async function recordSuccessfulPunch({ name, type, timestamp }) {
  if (!isConfigured()) {
    // 沒設定Google表單環境變數時（例如本機測試），略過防呆檢查，一律放行
    return { ok: true, skipped: true };
  }

  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetTitle = sanitizeSheetName(name);
  await ensureSheetExists(sheets, spreadsheetId, sheetTitle, name);

  const rows = await getRows(sheets, spreadsheetId, sheetTitle);
  const { dateStr, timeStr, weekday } = toTaipeiParts(timestamp);

  if (type === 'in') {
    const todayIndex = findRowIndexByDate(rows, dateStr);
    if (todayIndex !== -1 && rows[todayIndex][2]) {
      return { ok: false, reason: '今天已經打過上班卡囉' };
    }
    if (todayIndex !== -1) {
      await updateCell(sheets, spreadsheetId, sheetTitle, todayIndex + 3, 'C', timeStr);
    } else {
      await appendRow(sheets, spreadsheetId, sheetTitle, [dateStr, weekday, timeStr, '', '']);
    }
    return { ok: true };
  }

  // type === 'out'
  const openIndex = findOpenShiftIndex(rows);
  if (openIndex === -1) {
    return { ok: false, reason: '尚未打上班卡，無法打下班卡' };
  }
  await updateCell(sheets, spreadsheetId, sheetTitle, openIndex + 3, 'D', timeStr);
  return { ok: true };
}

// 記錄一筆「失敗」的打卡嘗試（例如沒連公司WiFi），寫進當天那一列的備註，不影響上/下班時間欄位
async function logFailedAttempt({ name, type, timestamp, reason }) {
  if (!isConfigured()) return;

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetTitle = sanitizeSheetName(name);
    await ensureSheetExists(sheets, spreadsheetId, sheetTitle, name);

    const rows = await getRows(sheets, spreadsheetId, sheetTitle);
    const { dateStr, timeStr, weekday } = toTaipeiParts(timestamp);
    const note = `${timeStr} ${type === 'in' ? '上班' : '下班'}打卡失敗（${reason}）；`;

    const todayIndex = findRowIndexByDate(rows, dateStr);
    if (todayIndex !== -1) {
      const existing = rows[todayIndex][4] || '';
      await updateCell(sheets, spreadsheetId, sheetTitle, todayIndex + 3, 'E', existing + note);
    } else {
      await appendRow(sheets, spreadsheetId, sheetTitle, [dateStr, weekday, '', '', note]);
    }
  } catch (err) {
    console.error('[sheets] 記錄失敗打卡嘗試時發生錯誤：', err.message);
  }
}

/**
 * 管理者手動修正一筆打卡（例如同事出任務提早離開、忘記在公司WiFi打下班卡）。
 * 跟 recordSuccessfulPunch 不同：這裡刻意不做防呆檢查（防呆機制擋下的情況正是要靠這裡修正），
 * 只受 routes/admin.js 的密碼保護。
 * 回傳 { ok, reason? }
 */
async function correctPunch({ name, date, type, time, note, operator }) {
  if (!isConfigured()) {
    return { ok: false, reason: '尚未設定Google表單環境變數' };
  }

  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetTitle = sanitizeSheetName(name);
  await ensureSheetExists(sheets, spreadsheetId, sheetTitle, name);

  // 把「誰改的、何時改的」附進備註，方便日後追查是誰做了手動修正
  const { dateStr: opDate, timeStr: opTime } = toTaipeiParts(new Date().toISOString());
  const operatorTag = operator ? `（由${operator}於${opDate} ${opTime}修改）` : '';
  const fullNote = [note, operatorTag].filter(Boolean).join(' ');

  const rows = await getRows(sheets, spreadsheetId, sheetTitle);
  const todayIndex = findRowIndexByDate(rows, date);
  const column = type === 'in' ? 'C' : 'D';

  if (todayIndex !== -1) {
    await updateCell(sheets, spreadsheetId, sheetTitle, todayIndex + 3, column, time);
    if (fullNote) {
      const existing = rows[todayIndex][4] || '';
      await updateCell(sheets, spreadsheetId, sheetTitle, todayIndex + 3, 'E', existing ? `${existing}；${fullNote}` : fullNote);
    }
  } else {
    const weekday = weekdayFromDate(date);
    const newRow =
      type === 'in' ? [date, weekday, time, '', fullNote] : [date, weekday, '', time, fullNote];
    await appendRow(sheets, spreadsheetId, sheetTitle, newRow);
  }

  return { ok: true };
}

module.exports = {
  isConfigured,
  recordSuccessfulPunch,
  logFailedAttempt,
  correctPunch,
  HEADER_ROW,
  NAME_LABEL,
  sanitizeSheetName,
  quoteSheetName,
  toTaipeiParts,
};
