// 將打卡紀錄永久寫入 Google 試算表（作為SQLite以外的永久備份，方便用Excel/Google試算表統計）
const { google } = require('googleapis');

let sheetsClient = null;

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

// 寫入一筆打卡紀錄；失敗時只印log、不擋住打卡流程（SQLite已經是即時的正式紀錄）
async function appendPunchRecord({ name, lineUserId, type, timestamp, sourceIp, verified }) {
  if (!isConfigured()) {
    console.warn('[sheets] 尚未設定Google服務帳號環境變數，略過寫入Google試算表');
    return;
  }

  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: '工作表1!A:F',
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
