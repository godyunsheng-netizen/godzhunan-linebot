// 共用的 Google 服務帳號授權（給 sheets.js 跟 monthlyReport.js 一起用）
const { google } = require('googleapis');

let authClient = null;

function isConfigured() {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_SHEET_ID
  );
}

// spreadsheets：讀寫試算表內容（包含新增分頁），打卡紀錄跟月報都是在同一份既有表單裡操作，
// 不需要額外的Drive權限
function getAuth() {
  if (authClient) return authClient;

  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  authClient = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return authClient;
}

module.exports = { getAuth, isConfigured };
