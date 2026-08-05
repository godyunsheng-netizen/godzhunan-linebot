require('dotenv').config();
const express = require('express');
const path = require('path');
const punchRoutes = require('./routes/punch');
const reportRoutes = require('./routes/report');
const webhookRoutes = require('./routes/webhook');

const app = express();

// LINE Webhook要掛在全域 express.json() 之前，因為它需要自己保留原始body來驗證簽章
app.use('/api', webhookRoutes);

app.use(express.json());

// LIFF 打卡靜態頁面（正式：透過LINE App開啟，需要真的LIFF ID）
app.use('/liff', express.static(path.join(__dirname, 'public/liff')));

// 測試頁面（不需要LINE，直接用瀏覽器打開測試打卡流程；TEST_MODE=true才能用）
app.use('/test', express.static(path.join(__dirname, 'public/test')));

app.use('/api', punchRoutes);
app.use('/api', reportRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`打卡機器人後端啟動於 port ${port}`);
});
