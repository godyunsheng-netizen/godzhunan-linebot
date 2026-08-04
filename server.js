require('dotenv').config();
const express = require('express');
const path = require('path');
const punchRoutes = require('./routes/punch');

const app = express();
app.use(express.json());

// LIFF 打卡靜態頁面（正式：透過LINE App開啟，需要真的LIFF ID）
app.use('/liff', express.static(path.join(__dirname, 'public/liff')));

// 測試頁面（不需要LINE，直接用瀏覽器打開測試打卡流程；TEST_MODE=true才能用）
app.use('/test', express.static(path.join(__dirname, 'public/test')));

app.use('/api', punchRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`打卡機器人後端啟動於 port ${port}`);
});
