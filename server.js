// FIM-92 位元控制伺服器 - 內網版本
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
            
            // 判斷是否為震動器設備識別
            if (data.includes('vibrator_device')) {
                console.log('震動器設備連線 (內網)');
                vibratorDevice = ws;
                broadcastToWebClients('vibrator_connected');
            }
            // 判斷是否為網頁客戶端
            else if (data.includes('web_monitor')) {
                console.log('網頁客戶端連線 (內網)');
                webClients.push(ws);
                ws.send('web_monitor_connected');
            }
            // 判斷是否為 SET 指令 (網站發送到ESP32)
            else if (data.startsWith('SET_')) {
                console.log('網站發送 SET 指令 (內網):', data);
                sendCommandToVibrator(data);
            }
            // 判斷是否為 BIT 指令 (網站發送到ESP32)
            else if (data.startsWith('BIT_')) {
                console.log('網站發送 BIT 指令 (內網):', data);
                sendCommandToVibrator(data);
            }
            // 判斷是否為 CLS 指令 (網站發送到ESP32)
            else if (data === 'CLS') {
                console.log('網站發送 CLS 指令 (內網)');
                sendCommandToVibrator(data);
            }
            // 判斷是否為ESP32回傳的狀態數字
            else if (/^\d+$/.test(data)) {
                const value = parseInt(data);
                if (value >= 0 && value <= 65535) {
                    console.log('ESP32回傳狀態數字 (內網):', value);
                    
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
                    
                    // 如果是來自ESP32，廣播給所有網頁客戶端
                    if (ws === vibratorDevice) {
                        console.log('廣播ESP32狀態給內網網頁客戶端');
                        broadcastToWebClients(data);
                    }
                    // 如果是來自網頁，轉發給ESP32
                    else {
                        console.log('內網網頁發送數字指令給ESP32:', data);
                        sendCommandToVibrator(data);
                    }
                }
            }
            // 其他訊息
            else {
                console.log('其他內網訊息:', data);
            }
        } catch (error) {
            console.error('處理內網訊息錯誤:', error);
        }
    });
    
    // 處理連接關閉
    ws.on('close', () => {
        console.log('內網連接已關閉');
        if (ws === vibratorDevice) {
            vibratorDevice = null;
            console.log('震動器設備離線 (內網)');
        }
        webClients = webClients.filter(client => client !== ws);
    });
    
    // 處理錯誤
    ws.on('error', (error) => {
        console.error('內網WebSocket 錯誤:', error);
    });
});

// 發送指令到震動器 (ESP32)
function sendCommandToVibrator(command) {
    if (vibratorDevice && vibratorDevice.readyState === WebSocket.OPEN) {
        vibratorDevice.send(command);
        console.log('指令已發送到內網ESP32:', command);
    } else {
        console.log('內網ESP32未連接，無法發送指令');
    }
}

// 廣播給所有網頁客戶端
function broadcastToWebClients(data) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    webClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
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
                        <p><a href="/files">檢視所有檔案</a></p>
                    `);
                }
            });
        }
    } 
    else if (req.url === '/test') {
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
                        <p class="info">內網版本: 3000埠號</p>
                    </div>
                    
                    <div class="status">
                        <h3>數字格式說明 (16位元)</h3>
                        <ul>
                            <li><strong>1</strong> = BIT0 (刺針本體就緒)</li>
                            <li><strong>2</strong> = BIT1 (震動器就緒/LED恆亮)</li>
                            <li><strong>4</strong> = BIT2 (震動器中震動)</li>
                            <li><strong>8</strong> = BIT3 (震動器強震動)</li>
                            <li><strong>32</strong> = BIT5 (洛克開關狀態)</li>
                        </ul>
                        <p class="warning">範例: 34 = BIT1+BIT5 (LED恆亮+開關按下)</p>
                    </div>
                    
                    <div class="status">
                        <h3>連接資訊</h3>
                        <p>ESP32 狀態: ${vibratorDevice ? '已連接' : '未連接'}</p>
                        <p>網頁客戶端: ${webClients.length} 個</p>
                        <p>WebSocket URL: ws://10.0.0.74:${PORT}/</p>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <h1>404 - 頁面不存在</h1>
            <p>請求的路徑: ${req.url}</p>
            <p><a href="/">返回首頁</a> | <a href="/test">測試頁面</a></p>
        `);
    }
});

// 啟動伺服器
server.listen(PORT, () => {
    console.log('=================================');
    console.log('FIM-92 內網位元控制伺服器已啟動!');
    console.log(`內網WebSocket 端口: ${PORT}`);
    console.log(`內網監控頁面: http://localhost:${PORT}`);
    console.log(`測試頁面: http://localhost:${PORT}/test`);
    console.log('=================================');
    console.log('數字格式說明:');
    console.log('  1 = BIT0, 2 = BIT1 (LED), 4 = BIT2 (中震), 8 = BIT3 (強震)');
    console.log('  32 = BIT5 (開關)');
    console.log('  例如: 34 = BIT1+BIT5 (LED恆亮+開關按下)');
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
    console.log(`請將 ESP32 程式的 ws_port 改成 ${PORT}`);
    console.log('=================================');
});
