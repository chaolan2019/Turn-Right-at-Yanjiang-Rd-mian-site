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
const NAVIGATION_FILE = path.join(ROOT_DIR, 'json', 'navigation.json');

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

function readNavigationFile() {
    try {
        if (!fs.existsSync(NAVIGATION_FILE)) {
            const initialData = {
                items: [],
                metadata: { version: '1.0', lastUpdated: Date.now(), totalItems: 0 }
            };
            fs.writeFileSync(NAVIGATION_FILE, JSON.stringify(initialData, null, 2));
            return initialData;
        }
        const content = fs.readFileSync(NAVIGATION_FILE, 'utf-8');
        const data = JSON.parse(content);
        if (!Array.isArray(data.items)) {
            return { items: [], metadata: { version: '1.0', lastUpdated: Date.now(), totalItems: 0 } };
        }
        return data;
    } catch (e) {
        console.error('读取导航数据失败:', e);
        return { items: [], metadata: { version: '1.0', lastUpdated: Date.now(), totalItems: 0 } };
    }
}

function writeNavigationFile(data) {
    try {
        data.metadata = {
            version: '1.0',
            lastUpdated: Date.now(),
            totalItems: Array.isArray(data.items) ? data.items.length : 0
        };
        fs.writeFileSync(NAVIGATION_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error('写入导航数据失败:', e);
        return false;
    }
}

function fetchWebsiteTitle(targetUrl, depth = 0) {
    return new Promise((resolve) => {
        if (depth > 2) {
            resolve('');
            return;
        }

        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            resolve('');
            return;
        }

        const client = parsed.protocol === 'https:' ? require('https') : require('http');
        const req = client.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 Node.js Navigation Bot',
                'Accept': 'text/html,application/xhtml+xml'
            },
            timeout: 2000  // 缩短超时到2秒
        }, (resp) => {
            const statusCode = resp.statusCode || 0;

            if (statusCode >= 300 && statusCode < 400 && resp.headers.location) {
                const redirected = new URL(resp.headers.location, targetUrl).toString();
                resp.resume();
                fetchWebsiteTitle(redirected, depth + 1).then(resolve);
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                resp.resume();
                resolve('');
                return;
            }

            let html = '';
            resp.on('data', (chunk) => {
                if (html.length < 50000) {  // 只需要HEAD部分
                    html += chunk.toString('utf8');
                }
            });

            resp.on('end', () => {
                const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                if (!match || !match[1]) {
                    resolve('');
                    return;
                }
                const clean = match[1].replace(/\s+/g, ' ').trim();
                // 限制标题长度
                resolve(clean.slice(0, 80));
            });
        });

        req.on('error', () => resolve(''));
        req.on('timeout', () => {
            req.destroy();
            resolve('');
        });
    });
}

function fetchBinary(targetUrl, depth = 0) {
    return new Promise((resolve) => {
        if (depth > 3) {
            resolve(null);
            return;
        }

        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            resolve(null);
            return;
        }

        const client = parsed.protocol === 'https:' ? require('https') : require('http');
        const req = client.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 Node.js Navigation Icon Proxy',
                'Accept': 'image/*,*/*;q=0.8'
            },
            timeout: 3000  // 缩短到3秒以加快故障转移
        }, (resp) => {
            const statusCode = resp.statusCode || 0;

            if (statusCode >= 300 && statusCode < 400 && resp.headers.location) {
                const redirected = new URL(resp.headers.location, targetUrl).toString();
                resp.resume();
                fetchBinary(redirected, depth + 1).then(resolve);
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                resp.resume();
                resolve(null);
                return;
            }

            const chunks = [];
            let size = 0;
            const maxSize = 256 * 1024;  // 限制到256KB（图标不应该这么大）
            resp.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxSize) {
                    req.destroy();
                    resolve(null);
                    return;
                }
                chunks.push(chunk);
            });

            resp.on('end', () => {
                const buffer = Buffer.concat(chunks);
                if (!buffer || buffer.length === 0) {
                    resolve(null);
                    return;
                }
                resolve({
                    buffer,
                    contentType: (resp.headers['content-type'] || '').toString()
                });
            });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
    });
}

function fetchHtml(targetUrl, depth = 0) {
    return new Promise((resolve) => {
        if (depth > 3) {
            resolve({ html: '', finalUrl: targetUrl });
            return;
        }

        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            resolve({ html: '', finalUrl: targetUrl });
            return;
        }

        const client = parsed.protocol === 'https:' ? require('https') : require('http');
        const req = client.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 Node.js Navigation Icon Proxy',
                'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8'
            },
            timeout: 5000
        }, (resp) => {
            const statusCode = resp.statusCode || 0;

            if (statusCode >= 300 && statusCode < 400 && resp.headers.location) {
                const redirected = new URL(resp.headers.location, targetUrl).toString();
                resp.resume();
                fetchHtml(redirected, depth + 1).then(resolve);
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                resp.resume();
                resolve({ html: '', finalUrl: targetUrl });
                return;
            }

            let html = '';
            const maxSize = 300000;
            resp.on('data', (chunk) => {
                if (html.length < maxSize) {
                    html += chunk.toString('utf8');
                }
            });
            resp.on('end', () => {
                resolve({ html, finalUrl: targetUrl });
            });
        });

        req.on('error', () => resolve({ html: '', finalUrl: targetUrl }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ html: '', finalUrl: targetUrl });
        });
    });
}

async function resolveIconFromHtml(siteUrl) {
    const { html } = await fetchHtml(siteUrl);
    if (!html) return '';

    const head = html.slice(0, 120000);
    const linkRegex = /<link\s+[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi;
    const links = head.match(linkRegex) || [];
    for (const tag of links) {
        const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
        if (!hrefMatch || !hrefMatch[1]) continue;
        try {
            return new URL(hrefMatch[1], siteUrl).toString();
        } catch (e) {
            // ignore malformed href and continue trying
        }
    }
    return '';
}

async function getNavigationIconCandidates(siteUrl) {
    try {
        const parsed = new URL(siteUrl);
        const host = parsed.hostname;
        const fromHtml = await resolveIconFromHtml(parsed.origin + '/');
        const list = [
            fromHtml,
            `${parsed.origin}/favicon.ico`,
            `${parsed.origin}/favicon.png`,
            `${parsed.origin}/favicon.jpg`,
            `${parsed.origin}/apple-touch-icon.png`,
            `${parsed.origin}/apple-touch-icon-precomposed.png`,
            `https://www.google.com/s2/favicons?sz=128&domain=${host}`,
            `https://icon.horse/icon/${host}`,
            `https://icons.duckduckgo.com/ip3/${host}.ico`,
            `https://v1.savefavicon.com/${host}`
        ];
        return list.filter(Boolean).filter((u, i, arr) => arr.indexOf(u) === i);  // 去重
    } catch (e) {
        return [];
    }
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

    if (url.pathname === '/api/navigation/icon' && req.method === 'GET') {
        const raw = url.searchParams.get('url') || '';
        if (!raw) {
            res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('missing url');
            return;
        }

        let parsed;
        try {
            parsed = new URL(raw);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                throw new Error('invalid protocol');
            }
        } catch (e) {
            res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('invalid url');
            return;
        }

        const candidates = await getNavigationIconCandidates(parsed.toString());
        for (const candidate of candidates) {
            const result = await fetchBinary(candidate);
            if (!result || !result.buffer || result.buffer.length === 0) {
                continue;
            }
            const type = result.contentType.toLowerCase();
            if (type && !type.startsWith('image/')) {
                continue;
            }
            res.writeHead(200, {
                ...CORS_HEADERS,
                'Content-Type': type || 'image/x-icon',
                'Cache-Control': 'public, max-age=21600'
            });
            res.end(result.buffer);
            return;
        }

        res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('icon not found');
        return;
    }

    // ========== 导航站点API路由 ==========
    if (url.pathname.startsWith('/api/navigation')) {
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });

        try {
            if (url.pathname === '/api/navigation' && req.method === 'GET') {
                const data = readNavigationFile();
                res.end(JSON.stringify({ success: true, data }));

            } else if (url.pathname === '/api/navigation/add' && req.method === 'POST') {
                const body = await parseBody(req);
                if (!verifyAdmin(body.username, body.password)) {
                    res.writeHead(403, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '无权限添加' }));
                    return;
                }

                const title = typeof body.title === 'string' ? body.title.trim() : '';
                const targetUrl = typeof body.url === 'string' ? body.url.trim() : '';
                if (!targetUrl) {
                    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '链接不能为空' }));
                    return;
                }

                let parsedUrl;
                try {
                    parsedUrl = new URL(targetUrl);
                    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                        throw new Error('invalid protocol');
                    }
                } catch (e) {
                    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '链接格式不正确，必须以http://或https://开头' }));
                    return;
                }

                // 快速返回：如果用户提供了标题就用用户的，否则用网址的主机名
                const finalTitle = title || parsedUrl.hostname;

                const data = readNavigationFile();
                const item = {
                    id: Date.now(),
                    title: finalTitle,
                    url: parsedUrl.toString(),
                    createdAt: Date.now()
                };
                data.items.unshift(item);
                if (data.items.length > 200) {
                    data.items = data.items.slice(0, 200);
                }

                const success = writeNavigationFile(data);
                res.end(JSON.stringify({ success, item, message: success ? '添加成功' : '添加失败' }));

                // 后台异步尝试获取真实标题并更新（非阻塞）
                if (!title) {
                    setTimeout(async () => {
                        try {
                            const realTitle = await fetchWebsiteTitle(parsedUrl.toString());
                            if (realTitle && realTitle !== finalTitle) {
                                const Updated = readNavigationFile();
                                const foundItem = Updated.items.find(it => it.id === item.id);
                                if (foundItem && foundItem.title === finalTitle) {
                                    foundItem.title = realTitle;
                                    writeNavigationFile(Updated);
                                }
                            }
                        } catch (e) {
                            // 忽略后台更新失败
                        }
                    }, 0);
                }


            } else if (url.pathname === '/api/navigation/delete' && req.method === 'POST') {
                const body = await parseBody(req);
                if (!verifyAdmin(body.username, body.password)) {
                    res.writeHead(403, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '无权限删除' }));
                    return;
                }

                const id = Number(body.id);
                if (!id || Number.isNaN(id)) {
                    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '无效的导航ID' }));
                    return;
                }

                const data = readNavigationFile();
                const index = data.items.findIndex(item => item.id === id);
                if (index === -1) {
                    res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '导航不存在' }));
                    return;
                }

                data.items.splice(index, 1);
                const success = writeNavigationFile(data);
                res.end(JSON.stringify({ success, message: success ? '删除成功' : '删除失败' }));

            } else if (url.pathname === '/api/navigation/reorder' && req.method === 'POST') {
                const body = await parseBody(req);
                if (!verifyAdmin(body.username, body.password)) {
                    res.writeHead(403, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '无权限排序' }));
                    return;
                }

                if (!Array.isArray(body.ids) || body.ids.length === 0) {
                    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '排序数据无效' }));
                    return;
                }

                const data = readNavigationFile();
                const byId = new Map(data.items.map(item => [item.id, item]));
                const ordered = [];

                body.ids.forEach((rawId) => {
                    const id = Number(rawId);
                    if (!Number.isNaN(id) && byId.has(id)) {
                        ordered.push(byId.get(id));
                        byId.delete(id);
                    }
                });

                // 兜底：把未包含在ids里的旧数据追加在末尾，避免异常请求导致数据丢失。
                byId.forEach((item) => ordered.push(item));

                data.items = ordered;
                const success = writeNavigationFile(data);
                res.end(JSON.stringify({ success, message: success ? '排序已更新' : '排序保存失败' }));

            } else {
                res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: '接口不存在' }));
            }
        } catch (e) {
            console.error('导航接口处理错误:', e);
            res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '服务器内部错误' }));
        }
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
