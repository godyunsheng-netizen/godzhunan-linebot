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

// spreadsheets：讀寫試算表內容
// drive.file：只能建立/管理「這個服務帳號自己建立」的檔案，用來每月產生新的月報檔案並分享出去
function getAuth() {
  if (authClient) return authClient;

  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  authClient = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });

  return authClient;
}

module.exports = { getAuth, isConfigured };
