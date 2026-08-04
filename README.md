# 尬癮茶 LINE 打卡機器人（MVP 骨架）

完整規劃請見同層目錄的「尬癮茶_LINE打卡機器人_規劃文件.md」。這裡只是可執行的程式骨架。

## 在你自己電腦上打開瀏覽器測試（第一步，還不用申請LINE、還不用管公司網路）

我這邊的沙盒環境沒辦法生出一個你電腦瀏覽器可以連到的網址，所以這一步要請你在**自己的電腦**上跑起來，步驟如下（Mac，開啟「終端機」App）：

```bash
cd "/Users/matchbox/Library/Application Support/Claude/local-agent-mode-sessions/254e8c11-e534-4d0e-877d-c62b198c8b48/cf2adbfe-2391-4e2f-8cb2-6abfa7ca2aaa/local_5a371124-d7b6-4bf0-83bb-76bb53f554de/outputs/line-checkin-bot"
cp .env.example .env
npm install
npm start
```

看到 `打卡機器人後端啟動於 port 8080` 就代表成功了。接著打開瀏覽器，輸入：

```
http://localhost:8080/test/index.html
```

按「上班打卡」「下班打卡」，畫面會顯示打卡結果的JSON。這個測試頁**沒有經過真的LINE登入**（`.env.example` 已預設 `TEST_MODE=true`、`SKIP_NETWORK_CHECK=true`），純粹先確認打卡→寫入資料庫這條路能跑通，不受你目前所在的網路影響。

如果 `npm install` 卡住或報錯，把錯誤訊息貼給我，我再幫你排除。

## 測試成功後，下一步：加上網路限制

確認上面能正常打卡後，把 `.env` 的 `SKIP_NETWORK_CHECK` 改成 `false`，並依照規劃文件第6節設定公司路由器的DDNS、填入 `COMPANY_DDNS_HOSTNAME`，重新 `npm start`。這時在公司WiFi外打卡應該會失敗，在公司WiFi內才會成功——這樣就驗證了網路限制生效。

## 之後（正式串接LINE、部署上線）必做

1. 在 LINE Developers Console 建立 Messaging API 頻道 + LIFF App，把 `public/liff/index.html` 裡的 `YOUR_LIFF_ID` 換掉，`.env` 填入 `LINE_CHANNEL_ID`，並把 `TEST_MODE` 改成 `false`。
2. 把 SQLite 換成 Cloud SQL / Firestore（`db.js` 是唯一需要改的檔案），因為部署到 Cloud Run 之類的平台後本機檔案不會保留。
3. 部署到 Cloud Run（或 Render），設定好 HTTPS 網域，並在 LIFF App 設定裡填入正式網址——這一步之後你的手機才能透過LINE打開真正的打卡頁面。
