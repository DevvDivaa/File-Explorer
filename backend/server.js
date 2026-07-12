const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..', 'explorer_root');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function ensureSampleData() {
  if (!fs.existsSync(ROOT)) {
    fs.mkdirSync(ROOT);
    fs.mkdirSync(path.join(ROOT, 'Documents'));
    fs.mkdirSync(path.join(ROOT, 'Images'));
    fs.writeFileSync(
      path.join(ROOT, 'readme.txt'),
      'Welcome!\nThis is a sample file to get you started.'
    );
    fs.writeFileSync(
      path.join(ROOT, 'Documents', 'notes.txt'),
      'This is a sample note inside Documents folder.'
    );
  }
}
ensureSampleData();

function safeResolve(relPath) {
  const target = path.join(ROOT, relPath || '');
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(ROOT))) return null;
  return resolved;
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.txt': 'text/plain', '.pdf': 'application/pdf', '.ico': 'image/x-icon',
  };
  return types[ext] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!path.resolve(filePath).startsWith(path.resolve(PUBLIC_DIR))) {
    return sendJSON(res, 403, { error: 'Forbidden' });
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    res.end(data);
  });
}

function readBody(req, callback) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => callback(Buffer.concat(chunks)));
}

function handleList(req, res, query) {
  const relPath = query.path || '';
  const target = safeResolve(relPath);
  if (!target) return sendJSON(res, 400, { error: 'Invalid path' });

  fs.readdir(target, { withFileTypes: true }, (err, entries) => {
    if (err) return sendJSON(res, 404, { error: 'Directory not found' });

    const items = entries.map((entry) => {
      try {
        const stats = fs.statSync(path.join(target, entry.name));
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modified: stats.mtime,
        };
      } catch (e) { return null; }
    }).filter(Boolean);

    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    sendJSON(res, 200, { path: relPath, items });
  });
}

function handleMkdir(req, res) {
  readBody(req, (buffer) => {
    try {
      const { path: relPath, name } = JSON.parse(buffer.toString());
      const parent = safeResolve(relPath);
      if (!parent || !name) return sendJSON(res, 400, { error: 'Invalid request' });
      const newDir = path.join(parent, name);
      if (!path.resolve(newDir).startsWith(path.resolve(ROOT))) {
        return sendJSON(res, 400, { error: 'Invalid path' });
      }
      fs.mkdir(newDir, (err) => {
        if (err) return sendJSON(res, 500, { error: err.message });
        sendJSON(res, 200, { success: true });
      });
    } catch (e) { sendJSON(res, 400, { error: 'Invalid JSON' }); }
  });
}

function handleDelete(req, res) {
  readBody(req, (buffer) => {
    try {
      const { path: relPath } = JSON.parse(buffer.toString());
      const target = safeResolve(relPath);
      if (!target || target === path.resolve(ROOT)) {
        return sendJSON(res, 400, { error: 'Invalid path' });
      }
      fs.rm(target, { recursive: true, force: true }, (err) => {
        if (err) return sendJSON(res, 500, { error: err.message });
        sendJSON(res, 200, { success: true });
      });
    } catch (e) { sendJSON(res, 400, { error: 'Invalid JSON' }); }
  });
}

function handleRename(req, res) {
  readBody(req, (buffer) => {
    try {
      const { path: relPath, newName } = JSON.parse(buffer.toString());
      const target = safeResolve(relPath);
      if (!target || !newName) return sendJSON(res, 400, { error: 'Invalid request' });
      const newPath = path.join(path.dirname(target), newName);
      if (!path.resolve(newPath).startsWith(path.resolve(ROOT))) {
        return sendJSON(res, 400, { error: 'Invalid path' });
      }
      fs.rename(target, newPath, (err) => {
        if (err) return sendJSON(res, 500, { error: err.message });
        sendJSON(res, 200, { success: true });
      });
    } catch (e) { sendJSON(res, 400, { error: 'Invalid JSON' }); }
  });
}

function handleDownload(req, res, query) {
  const relPath = query.path || '';
  const target = safeResolve(relPath);
  if (!target) return sendJSON(res, 400, { error: 'Invalid path' });

  fs.stat(target, (err, stats) => {
    if (err || stats.isDirectory()) return sendJSON(res, 404, { error: 'File not found' });
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${path.basename(target)}"`,
      'Content-Length': stats.size,
    });
    fs.createReadStream(target).pipe(res);
  });
}

function parseMultipart(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(boundaryBuffer);

  while (start !== -1) {
    const end = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (end === -1) break;
    parts.push(buffer.slice(start + boundaryBuffer.length, end));
    start = end;
  }

  return parts.map((part) => {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) return null;
    const headerStr = part.slice(0, headerEnd).toString();
    let content = part.slice(headerEnd + 4);
    if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    return filenameMatch ? { filename: filenameMatch[1], content } : null;
  }).filter(Boolean);
}

function handleUpload(req, res, query) {
  const relPath = query.path || '';
  const target = safeResolve(relPath);
  if (!target) return sendJSON(res, 400, { error: 'Invalid path' });

  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'No boundary found' });

  readBody(req, (buffer) => {
    const parts = parseMultipart(buffer, boundaryMatch[1]);
    const filePart = parts.find((p) => p.filename);
    if (!filePart) return sendJSON(res, 400, { error: 'No file found' });

    const destPath = path.join(target, filePart.filename);
    if (!path.resolve(destPath).startsWith(path.resolve(ROOT))) {
      return sendJSON(res, 400, { error: 'Invalid path' });
    }
    fs.writeFile(destPath, filePart.content, (err) => {
      if (err) return sendJSON(res, 500, { error: err.message });
      sendJSON(res, 200, { success: true });
    });
  });
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    return res.end();
  }

  const parsed = url.parse(req.url, true);
  const { pathname, query } = parsed;

  if (pathname === '/api/list' && req.method === 'GET') return handleList(req, res, query);
  if (pathname === '/api/mkdir' && req.method === 'POST') return handleMkdir(req, res);
  if (pathname === '/api/delete' && req.method === 'POST') return handleDelete(req, res);
  if (pathname === '/api/rename' && req.method === 'POST') return handleRename(req, res);
  if (pathname === '/api/download' && req.method === 'GET') return handleDownload(req, res, query);
  if (pathname === '/api/upload' && req.method === 'POST') return handleUpload(req, res, query);
  if (pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'Not found' });

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
