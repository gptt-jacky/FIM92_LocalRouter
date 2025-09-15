// FIM-92 位元控制伺服器 - 內網版本 (修正版)
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 設定伺服器 - 使用3000端口
const PORT = 3000;
const server = http.createServer();

// WebSocket 伺服器
const wss = new WebSocket.Server({ server });

// 儲存連接的設備
let vibratorDevice = null;
let webClients = [];

// 處理 WebSocket 連接
wss.on('connection', (ws, request) => {
    console.log('新的內網連接:', request.socket.remoteAddress);
    
    ws.on('message', (message) => {
        try {
            const data = message.toString();
            console.log('收到內網資料:', data);
            
            // 判斷是否為設備識別
            if (data === 'vibrator_device' || data === 'stinger_missile') {
                console.log('設備連線 (內網):', data);
                vibratorDevice = ws;
                broadcastToWebClients('vibrator_connected');
                return;
            }
            
            // 判斷是否為網頁客戶端
            if (data.includes('web_monitor')) {
                console.log('網頁客戶端連線 (內網)');
                if (!webClients.includes(ws)) {
                    webClients.push(ws);
                }
                ws.send('web_monitor_connected');
                return;
            }
            
            // 判斷是否為 SET 指令
            if (data.startsWith('SET_')) {
                if (ws === vibratorDevice) {
                    // 來自設備的SET指令，轉發給網頁
                    console.log('設備發送 SET 指令 (內網):', data);
                    broadcastToWebClients(data);
                } else {
                    // 來自網頁的SET指令，轉發給設備
                    console.log('網頁發送 SET 指令 (內網):', data);
                    sendCommandToVibrator(data);
                }
                return;
            }
            
            // 判斷是否為 BIT 指令 (只來自網頁)
            if (data.startsWith('BIT_')) {
                console.log('網頁發送 BIT 指令 (內網):', data);
                sendCommandToVibrator(data);
                return;
            }
            
            // 判斷是否為 CLS 指令 (只來自網頁)
            if (data === 'CLS') {
                console.log('網頁發送 CLS 指令 (內網)');
                sendCommandToVibrator(data);
                return;
            }
            
            // 判斷是否為狀態數字
            if (/^\d+$/.test(data)) {
                const value = parseInt(data);
                if (value >= 0 && value <= 65535) {
                    
                    // 分析啟用的位元
                    const activeBits = [];
                    for (let i = 0; i < 16; i++) {
                        if (value & (1 << i)) {
                            activeBits.push(`BIT${i}`);
                        }
                    }
                    
                    if (activeBits.length > 0) {
                        console.log('啟用位元 (內網):', activeBits.join(', '));
                    } else {
                        console.log('所有位元都是OFF (內網)');
                    }
                    
                    // 來源判斷和處理
                    if (ws === vibratorDevice) {
                        // 來自設備的狀態數字，廣播給網頁
                        console.log('設備狀態數字 (內網):', value);
                        console.log('廣播設備狀態給內網網頁客戶端');
                        broadcastToWebClients(data);
                    } else {
                        // 來自網頁的數字指令，轉發給設備 (但要小心處理)
                        console.log('網頁發送數字指令給設備:', data);
                        sendCommandToVibrator(data);
                    }
                }
                return;
            }
            
            // 其他訊息
            console.log('其他內網訊息:', data);
            
        } catch (error) {
            console.error('處理內網訊息錯誤:', error);
        }
    });
    
    // 處理連接關閉
    ws.on('close', () => {
        console.log('內網連接已關閉');
        if (ws === vibratorDevice) {
            vibratorDevice = null;
            console.log('設備離線 (內網)');
            // 通知所有網頁客戶端設備已離線
            broadcastToWebClients('vibrator_disconnected');
        } else {
            // 移除網頁客戶端
            webClients = webClients.filter(client => client !== ws);
            console.log(`網頁客戶端離線，剩餘: ${webClients.length} 個`);
        }
    });
    
    // 處理錯誤
    ws.on('error', (error) => {
        console.error('內網WebSocket 錯誤:', error);
        // 清理連接
        if (ws === vibratorDevice) {
            vibratorDevice = null;
        } else {
            webClients = webClients.filter(client => client !== ws);
        }
    });
});

// 發送指令到設備
function sendCommandToVibrator(command) {
    if (vibratorDevice && vibratorDevice.readyState === WebSocket.OPEN) {
        vibratorDevice.send(command);
        console.log('指令已發送到內網設備:', command);
    } else {
        console.log('內網設備未連接，無法發送指令');
    }
}

// 廣播給所有網頁客戶端
function broadcastToWebClients(data) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    let activeClients = 0;
    
    webClients.forEach((client, index) => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
                activeClients++;
            } catch (error) {
                console.error(`廣播給客戶端 ${index} 失敗:`, error);
            }
        }
    });
    
    // 清理已關閉的連接
    webClients = webClients.filter(client => client.readyState === WebSocket.OPEN);
    
    if (activeClients > 0) {
        console.log(`已廣播給 ${activeClients} 個網頁客戶端: ${message}`);
    }
}

// 取得連接狀態
function getConnectionStatus() {
    return {
        deviceConnected: vibratorDevice !== null && vibratorDevice.readyState === WebSocket.OPEN,
        webClientsCount: webClients.filter(client => client.readyState === WebSocket.OPEN).length,
        serverUptime: process.uptime()
    };
}

// HTTP 伺服器處理網頁請求
server.on('request', (req, res) => {
    console.log(`HTTP 請求: ${req.method} ${req.url}`);
    
    if (req.url === '/') {
        // 提供內網監控頁面
        const possibleFiles = [
            'FIM92LOCAL.html',
            'FIM92_LOCAL.html', 
            'fim92_local.html',
            'index.html'
        ];
        
        let fileFound = false;
        
        for (let fileName of possibleFiles) {
            const htmlPath = path.join(__dirname, fileName);
            
            if (fs.existsSync(htmlPath)) {
                console.log(`找到HTML檔案: ${fileName}`);
                fs.readFile(htmlPath, 'utf8', (err, data) => {
                    if (err) {
                        console.error('讀取檔案錯誤:', err);
                        res.writeHead(500);
                        res.end('Internal Server Error');
                    } else {
                        res.writeHead(200, { 
                            'Content-Type': 'text/html; charset=utf-8',
                            'Cache-Control': 'no-cache'
                        });
                        res.end(data);
                    }
                });
                fileFound = true;
                break;
            }
        }
        
        if (!fileFound) {
            console.log('找不到HTML檔案，顯示檔案列表');
            fs.readdir(__dirname, (err, files) => {
                if (err) {
                    res.writeHead(500);
                    res.end('Error reading directory');
                } else {
                    const htmlFiles = files.filter(f => f.endsWith('.html'));
                    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(`
                        <h1>找不到內網監控頁面</h1>
                        <p>嘗試尋找的檔案: ${possibleFiles.join(', ')}</p>
                        <p>目錄中的HTML檔案: ${htmlFiles.length > 0 ? htmlFiles.join(', ') : '無'}</p>
                        <p>所有檔案: ${files.join(', ')}</p>
                        <hr>
                        <p><a href="/test">點此進入測試頁面</a></p>
                        <p><a href="/status">檢視連接狀態</a></p>
                    `);
                }
            });
        }
    } 
    else if (req.url === '/test') {
        const status = getConnectionStatus();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>FIM-92 內網測試頁面</title>
                <style>
                    body { font-family: monospace; background: #1a1a1a; color: #00ff00; padding: 20px; }
                    .container { max-width: 800px; margin: 0 auto; }
                    .status { background: #2a2a2a; padding: 10px; margin: 10px 0; border-left: 4px solid #00ff00; }
                    .info { color: #00aaff; }
                    .warning { color: #ff6600; }
                    .success { color: #00ff00; }
                    .error { color: #ff4444; }
                    ul { background: #2a2a2a; padding: 15px; }
                    a { color: #00ff00; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>FIM-92 內網位元控制測試頁面</h1>
                    
                    <div class="status">
                        <h3>內網伺服器運行狀態</h3>
                        <p class="info">WebSocket 端口: ${PORT}</p>
                        <p class="info">伺服器時間: ${new Date().toLocaleString()}</p>
                        <p class="info">運行時間: ${Math.floor(status.serverUptime / 60)} 分鐘</p>
                        <p class="info">內網版本: 3000埠號 (修正版)</p>
                    </div>
                    
                    <div class="status">
                        <h3>指令格式說明</h3>
                        <ul>
                            <li><strong>SET_X_Y</strong> - 設定第X位元為Y (SET_3_1 = 設定BIT3為1)</li>
                            <li><strong>BIT_W</strong> - 整體設定為數字W (BIT_65535 = 全開, BIT_0 = 全關)</li>
                            <li><strong>CLS</strong> - 清除所有位元 (等同BIT_0)</li>
                            <li><strong>數字</strong> - 直接設定狀態值 (0-65535)</li>
                        </ul>
                    </div>
                    
                    <div class="status">
                        <h3>位元對應說明</h3>
                        <ul>
                            <li><strong>BIT0 (1)</strong> = 刺針本體就緒</li>
                            <li><strong>BIT1 (2)</strong> = 震動器就緒/LED恆亮</li>
                            <li><strong>BIT2 (4)</strong> = 震動器中震動</li>
                            <li><strong>BIT3 (8)</strong> = 震動器強震動</li>
                            <li><strong>BIT4 (16)</strong> = 鎖定鍵</li>
                            <li><strong>BIT5 (32)</strong> = BCU</li>
                            <li><strong>BIT6 (64)</strong> = 板機</li>
                            <li><strong>BIT7 (128)</strong> = 保險</li>
                            <li><strong>BIT8 (256)</strong> = 瞄準模組</li>
                        </ul>
                        <p class="warning">範例: 34 = BIT1+BIT5 (震動器就緒+BCU開啟)</p>
                    </div>
                    
                    <div class="status">
                        <h3>即時連接狀態</h3>
                        <p>設備狀態: <span class="${status.deviceConnected ? 'success' : 'error'}">${status.deviceConnected ? '✓ 已連接' : '✗ 未連接'}</span></p>
                        <p>網頁客戶端: <span class="info">${status.webClientsCount} 個</span></p>
                        <p>WebSocket URL: <span class="info">ws://10.0.0.74:${PORT}/</span></p>
                    </div>
                    
                    <div class="status">
                        <h3>問題排除</h3>
                        <ul>
                            <li>如果設備顯示未連接，檢查設備是否發送 'vibrator_device' 識別</li>
                            <li>如果指令無法發送，確認設備WebSocket連接狀態</li>
                            <li>如果狀態同步異常，檢查訊息格式是否正確</li>
                            <li>按鈕訊號立即歸零：檢查WebSocket frame解析</li>
                        </ul>
                    </div>
                    
                    <p><a href="/">返回監控頁面</a> | <a href="/status">詳細狀態</a></p>
                </div>
            </body>
            </html>
        `);
    }
    else if (req.url === '/status') {
        const status = getConnectionStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            deviceConnected: status.deviceConnected,
            webClientsCount: status.webClientsCount,
            serverUptime: status.serverUptime,
            timestamp: new Date().toISOString()
        }, null, 2));
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <h1>404 - 頁面不存在</h1>
            <p>請求的路徑: ${req.url}</p>
            <p><a href="/">返回首頁</a> | <a href="/test">測試頁面</a> | <a href="/status">狀態API</a></p>
        `);
    }
});

// 啟動伺服器
server.listen(PORT, () => {
    console.log('=================================');
    console.log('FIM-92 內網位元控制伺服器已啟動! (修正版)');
    console.log(`內網WebSocket 端口: ${PORT}`);
    console.log(`內網監控頁面: http://localhost:${PORT}`);
    console.log(`測試頁面: http://localhost:${PORT}/test`);
    console.log(`狀態API: http://localhost:${PORT}/status`);
    console.log('=================================');
    console.log('指令格式說明:');
    console.log('  SET_X_Y = 設定第X位元為Y');
    console.log('  BIT_W = 整體設定為數字W');
    console.log('  CLS = 清除所有位元');
    console.log('  數字 = 狀態回報 (0-65535)');
    console.log('=================================');
    console.log('位元對應:');
    console.log('  BIT0(1)=刺針就緒, BIT1(2)=震動器/LED');
    console.log('  BIT4(16)=鎖定鍵, BIT5(32)=BCU, BIT6(64)=板機');
    console.log('  BIT7(128)=保險, BIT8(256)=瞄準模組');
    console.log('=================================');
    console.log('等待內網設備連接...');
    
    // 顯示本機 IP
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    
    console.log('可用的內網 IP 位址:');
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`   ${name}: ${net.address}:${PORT}`);
            }
        }
    }
    console.log('=================================');
});

// 定期清理無效連接
setInterval(() => {
    // 清理斷開的網頁客戶端
    const activeBefore = webClients.length;
    webClients = webClients.filter(client => client.readyState === WebSocket.OPEN);
    const activeAfter = webClients.length;
    
    if (activeBefore !== activeAfter) {
        console.log(`清理無效連接: ${activeBefore - activeAfter} 個`);
    }
    
    // 檢查設備連接狀態
    if (vibratorDevice && vibratorDevice.readyState !== WebSocket.OPEN) {
        console.log('檢測到設備連接異常，清理連接');
        vibratorDevice = null;
    }
}, 30000); // 每30秒清理一次