/**
 * 树洞后端API服务器
 * 提供树洞数据的实时读写功能
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT_DIR, 'json', 'tree_hole_data.json');
const ADMIN_FILE = path.join(ROOT_DIR, 'json', 'admin.json');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

function readDataFile() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const initialData = {
                posts: [],
                metadata: { version: "1.0", lastUpdated: Date.now(), totalPosts: 0 }
            };
            fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
            return initialData;
        }
        const content = fs.readFileSync(DATA_FILE, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        console.error('读取数据文件失败:', e);
        return { posts: [], metadata: { version: "1.0", lastUpdated: Date.now(), totalPosts: 0 } };
    }
}

function writeDataFile(data) {
    try {
        data.metadata = {
            version: "1.0",
            lastUpdated: Date.now(),
            totalPosts: data.posts ? data.posts.length : 0
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error('写入数据文件失败:', e);
        return false;
    }
}

function readAdminConfig() {
    try {
        if (!fs.existsSync(ADMIN_FILE)) {
            console.error('管理员配置文件不存在:', ADMIN_FILE);
            return null;
        }
        const content = fs.readFileSync(ADMIN_FILE, 'utf-8');
        const config = JSON.parse(content);
        console.log('管理员配置读取成功, 用户名:', config.username);
        return config;
    } catch (e) {
        console.error('读取管理员配置失败:', e);
        return null;
    }
}

function verifyAdmin(username, password) {
    const admin = readAdminConfig();
    if (!admin) {
        console.log('无法读取管理员配置');
        return false;
    }
    const result = admin.username === username && admin.password === password;
    console.log('验证管理员 - 用户名:', username, '结果:', result);
    return result;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // 处理OPTIONS预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end();
        return;
    }

    // ========== 服务器状态监控API ==========
    if (url.pathname === '/api/status' && req.method === 'GET') {
        const os = require('os');
        const { exec } = require('child_process');
        
        // --- 1. 获取内存信息 ---
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memUsage = Math.round((usedMem / totalMem) * 100);
        
        // --- 2. 获取CPU实时使用率 ---
        const currentCpus = os.cpus();
        let currentIdle = 0;
        let currentTotal = 0;
        for (const cpu of currentCpus) {
            for (const type in cpu.times) {
                currentTotal += cpu.times[type];
            }
            currentIdle += cpu.times.idle;
        }
        
        let cpuUsage = 0;
        if (typeof global.lastCpuInfo !== 'undefined') {
            const idleDiff = currentIdle - global.lastCpuInfo.idle;
            const totalDiff = currentTotal - global.lastCpuInfo.total;
            cpuUsage = totalDiff === 0 ? 0 : Math.round((1 - idleDiff / totalDiff) * 100);
        } else {
            cpuUsage = currentTotal === 0 ? 0 : Math.round((1 - currentIdle / currentTotal) * 100);
        }
        global.lastCpuInfo = { idle: currentIdle, total: currentTotal };

        // --- 3. 异步获取真实的硬盘使用率 ---
        function getDiskUsage() {
            return new Promise((resolve) => {
                if (os.platform() === 'win32') {
                    // Windows 获取C盘占用
                    exec('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace', (err, stdout) => {
                        if (err) return resolve(45); // 获取失败则返回默认值
                        const lines = stdout.trim().split('\n');
                        if (lines.length > 1) {
                            const parts = lines[1].trim().split(/\s+/);
                            if (parts.length === 2) {
                                const free = parseInt(parts[0], 10);
                                const total = parseInt(parts[1], 10);
                                return resolve(Math.round(((total - free) / total) * 100));
                            }
                        }
                        resolve(45);
                    });
                } else {
                    // Linux/macOS 获取根目录占用
                    exec("df -k / | awk '{print $5}' | tail -n 1", (err, stdout) => {
                        if (err) return resolve(45);
                        const percent = parseInt(stdout.replace('%', ''), 10);
                        resolve(isNaN(percent) ? 45 : percent);
                    });
                }
            });
        }

        const diskUsage = await getDiskUsage();

        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cpu: cpuUsage, memory: memUsage, disk: diskUsage }));
        return;
    }

    // ========== 树洞API路由 ==========
    if (url.pathname.startsWith('/api/treehole')) {
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        
        try {
            if (url.pathname === '/api/treehole' && req.method === 'GET') {
                const data = readDataFile();
                res.end(JSON.stringify({ success: true, data }));

            } else if (url.pathname === '/api/treehole' && req.method === 'POST') {
                const body = await parseBody(req);
                
                if (!body.posts || !Array.isArray(body.posts)) {
                    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '无效的数据格式' }));
                    return;
                }

                if (body.posts.length > 100) {
                    body.posts = body.posts.slice(0, 100);
                }

                const success = writeDataFile({ posts: body.posts });
                res.end(JSON.stringify({ success, message: success ? '保存成功' : '保存失败' }));

            } else if (url.pathname === '/api/treehole/post' && req.method === 'POST') {
                const body = await parseBody(req);
                
                if (!body.content || typeof body.content !== 'string') {
                    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '内容不能为空' }));
                    return;
                }

                const data = readDataFile();
                const newPost = {
                    id: Date.now(),
                    username: body.username || '匿名用户',
                    content: body.content.trim(),
                    timestamp: Date.now()
                };

                data.posts.unshift(newPost);
                
                if (data.posts.length > 100) {
                    data.posts = data.posts.slice(0, 100);
                }

                const success = writeDataFile(data);
                res.end(JSON.stringify({ 
                    success, 
                    post: newPost,
                    message: success ? '发布成功' : '发布失败' 
                }));

            } else if (url.pathname === '/api/treehole/delete' && req.method === 'POST') {
                const body = await parseBody(req);
                
                if (!body.id) {
                    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '缺少帖子ID' }));
                    return;
                }

                // 验证管理员权限
                if (!verifyAdmin(body.username, body.password)) {
                    res.writeHead(403, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '无权限删除' }));
                    return;
                }

                const data = readDataFile();
                const index = data.posts.findIndex(p => p.id === body.id);
                
                if (index === -1) {
                    res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '帖子不存在' }));
                    return;
                }

                data.posts.splice(index, 1);
                const success = writeDataFile(data);
                res.end(JSON.stringify({ success, message: success ? '删除成功' : '删除失败' }));

            } else if (url.pathname === '/api/treehole/admin' && req.method === 'POST') {
                const body = await parseBody(req);
                console.log('收到管理员验证请求 - 用户名:', body.username, '密码:', body.password);
                console.log('admin.json中的配置 - 用户名:', readAdminConfig()?.username, '密码:', readAdminConfig()?.password);
                
                const isAdmin = verifyAdmin(body.username, body.password);
                console.log('验证结果:', isAdmin);
                res.end(JSON.stringify({ 
                    success: true, 
                    isAdmin: isAdmin,
                    message: isAdmin ? '验证成功' : '验证失败'
                }));

            } else {
                res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: '接口不存在' }));
            }

        } catch (e) {
            console.error('请求处理错误:', e);
            res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '服务器内部错误' }));
        }
        return;
    }

    // 静态文件服务
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = path.join(ROOT_DIR, filePath);
    
    // 安全检查：防止目录遍历攻击
    if (!filePath.startsWith(ROOT_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error');
            }
            return;
        }
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`树洞API服务器运行在 http://localhost:${PORT}`);
    console.log(`数据文件: ${DATA_FILE}`);
});
