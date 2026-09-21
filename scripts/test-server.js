'use strict';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(rootDir, reqPath);

  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(8080, async () => {
  console.log('[test-server] Server listening on http://localhost:8080');

  // Verify endpoints
  const endpoints = ['/index.html', '/debug.html', '/style.css', '/src/app.js', '/src/debug.js', '/src/adapter.js', '/data/history.json'];
  let allOk = true;

  for (const ep of endpoints) {
    try {
      const res = await fetch(`http://localhost:8080${ep}`);
      if (res.ok) {
        console.log(`✓ ${ep} (HTTP ${res.status})`);
      } else {
        console.error(`✗ ${ep} (HTTP ${res.status})`);
        allOk = false;
      }
    } catch (err) {
      console.error(`✗ ${ep} fetch failed:`, err.message);
      allOk = false;
    }
  }

  server.close(() => {
    console.log('[test-server] Server closed.');
    if (!allOk) process.exit(1);
    console.log('[test-server] ALL ENDPOINTS VERIFIED OK');
    process.exit(0);
  });
});
