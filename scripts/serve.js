// Tiny static file server for local development. Mimics GitHub Pages:
// serves public/, resolves /apply → apply.html, and uses 404.html for misses.
// Usage: npm start   (PORT=4000 npm start to change the port)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function resolve(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  const full = path.normalize(path.join(ROOT, p));
  if (!full.startsWith(ROOT)) return null;
  const candidates = [full, path.join(full, 'index.html'), full + '.html'];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

http.createServer((req, res) => {
  const file = resolve(req.url);
  const target = file || path.join(ROOT, '404.html');
  res.writeHead(file ? 200 : 404, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(target).pipe(res);
}).listen(PORT, () => console.log(`Date the Twins (static) at http://localhost:${PORT}`));
