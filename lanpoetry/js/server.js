const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3002;
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const SITE_ROOT = path.join(__dirname, '..');
const POEMS_FILE = path.join(PROJECT_ROOT, 'json', 'lanpoetry', 'poems.json');
const ADMIN_FILE = path.join(PROJECT_ROOT, 'json', 'admin.json');

/* ========== 数据读写函数 ========== */
function readPoemsData() {
    try {
        const data = fs.readFileSync(POEMS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('读取诗篇数据失败:', error);
        return null;
    }
}

function writePoemsData(data) {
    try {
        fs.writeFileSync(POEMS_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('写入诗篇数据失败:', error);
        return false;
    }
}

function readAdminData() {
    try {
        const data = fs.readFileSync(ADMIN_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('读取管理员数据失败:', error);
        return null;
    }
}

function getNextPoemId(poems) {
    if (!poems || poems.length === 0) return 1;
    return Math.max(...poems.map(p => p.id)) + 1;
}

/* ========== 管理员验证函数 ========== */
function verifyAdmin(username, password) {
    const adminData = readAdminData();
    if (!adminData) return false;
    return adminData.username === username && adminData.password === password;
}

/* ========== 服务器处理 ========== */
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    /* ========== 获取诗篇数据 ========== */
    if (url.pathname === '/json/lanpoetry/poems.json' && req.method === 'GET') {
        const data = readPoemsData();
        if (data) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '读取数据失败' }));
        }
        return;
    }

    /* ========== 获取管理员数据（用于前端验证） ========== */
    if (url.pathname === '/json/admin.json' && req.method === 'GET') {
        const data = readAdminData();
        if (data) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '读取数据失败' }));
        }
        return;
    }

    /* ========== 新建诗篇 ========== */
    if (url.pathname === '/api/poems' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const newPoem = JSON.parse(body);
                const data = readPoemsData();

                if (!data) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '读取数据失败' }));
                    return;
                }

                const poemId = getNextPoemId(data.poems);

                data.poems.push({
                    id: poemId,
                    chapterId: newPoem.chapterId,
                    number: newPoem.number,
                    title: newPoem.title,
                    content: newPoem.content,
                    date: newPoem.date,
                    note: newPoem.note || ''
                });

                if (writePoemsData(data)) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, id: poemId }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '保存数据失败' }));
                }
            } catch (error) {
                console.error('处理请求失败:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请求数据格式错误' }));
            }
        });
        return;
    }

    /* ========== 编辑诗篇 ========== */
    if (url.pathname === '/api/poems/edit' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const editData = JSON.parse(body);
                
                if (!verifyAdmin(editData.username, editData.password)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '管理员验证失败' }));
                    return;
                }

                const data = readPoemsData();
                if (!data) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '读取数据失败' }));
                    return;
                }

                const poemIndex = data.poems.findIndex(p => p.id === editData.id);
                if (poemIndex === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '诗篇不存在' }));
                    return;
                }

                data.poems[poemIndex] = {
                    id: editData.id,
                    chapterId: editData.chapterId,
                    number: editData.number,
                    title: editData.title,
                    content: editData.content,
                    date: editData.date,
                    note: editData.note || ''
                };

                if (writePoemsData(data)) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '保存数据失败' }));
                }
            } catch (error) {
                console.error('处理请求失败:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请求数据格式错误' }));
            }
        });
        return;
    }

    /* ========== 删除诗篇 ========== */
    if (url.pathname === '/api/poems/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const deleteData = JSON.parse(body);
                
                if (!verifyAdmin(deleteData.username, deleteData.password)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '管理员验证失败' }));
                    return;
                }

                const data = readPoemsData();
                if (!data) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '读取数据失败' }));
                    return;
                }

                const poemIndex = data.poems.findIndex(p => p.id === deleteData.id);
                if (poemIndex === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '诗篇不存在' }));
                    return;
                }

                data.poems.splice(poemIndex, 1);

                if (writePoemsData(data)) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '保存数据失败' }));
                }
            } catch (error) {
                console.error('处理请求失败:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请求数据格式错误' }));
            }
        });
        return;
    }

    /* ========== 新建章节 ========== */
    if (url.pathname === '/api/chapters' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const newChapter = JSON.parse(body);
                const data = readPoemsData();

                if (!data) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '读取数据失败' }));
                    return;
                }

                const chapterId = Math.max(...data.chapters.map(c => c.id)) + 1;

                data.chapters.push({
                    id: chapterId,
                    title: newChapter.title,
                    description: newChapter.description || ''
                });

                if (writePoemsData(data)) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, id: chapterId }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '保存数据失败' }));
                }
            } catch (error) {
                console.error('处理请求失败:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请求数据格式错误' }));
            }
        });
        return;
    }

    /* ========== 编辑章节 ========== */
    if (url.pathname === '/api/chapters/edit' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const editData = JSON.parse(body);
                
                if (!verifyAdmin(editData.username, editData.password)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '管理员验证失败' }));
                    return;
                }

                const data = readPoemsData();
                if (!data) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '读取数据失败' }));
                    return;
                }

                const chapterIndex = data.chapters.findIndex(c => c.id === editData.id);
                if (chapterIndex === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '章节不存在' }));
                    return;
                }

                data.chapters[chapterIndex].title = editData.title;
                data.chapters[chapterIndex].description = editData.description || '';

                if (writePoemsData(data)) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '保存数据失败' }));
                }
            } catch (error) {
                console.error('处理请求失败:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请求数据格式错误' }));
            }
        });
        return;
    }

    /* ========== 删除章节 ========== */
    if (url.pathname === '/api/chapters/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const deleteData = JSON.parse(body);
                
                if (!verifyAdmin(deleteData.username, deleteData.password)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '管理员验证失败' }));
                    return;
                }

                const data = readPoemsData();
                if (!data) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '读取数据失败' }));
                    return;
                }

                const chapterIndex = data.chapters.findIndex(c => c.id === deleteData.id);
                if (chapterIndex === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '章节不存在' }));
                    return;
                }

                // 删除章节及其所有诗篇
                data.chapters.splice(chapterIndex, 1);
                data.poems = data.poems.filter(p => p.chapterId !== deleteData.id);

                if (writePoemsData(data)) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '保存数据失败' }));
                }
            } catch (error) {
                console.error('处理请求失败:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请求数据格式错误' }));
            }
        });
        return;
    }

    /* ========== 静态文件服务 ========== */
    let filePath = path.join(SITE_ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
    const extname = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
    };
    const contentType = contentTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('文件未找到');
            } else {
                res.writeHead(500);
                res.end('服务器错误');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`诗歌网站服务器运行在 http://localhost:${PORT}`);
    console.log(`数据文件: ${POEMS_FILE}`);
});
