#!/usr/bin/env node
/**
 * Gotenberg-compatible HTML -> PDF service.
 *
 * Implements the endpoints the product uses:
 *   GET  /health                       -> 200 {"status":"ok"} when Chromium can print
 *   POST /forms/chromium/convert/html  -> PDF bytes from a multipart "files" field
 *
 * Rendering spawns headless Chromium with --print-to-pdf, matching the
 * Gotenberg chromium route semantics used by the crew packet pipeline.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT ?? '4070');
const CHROMIUM = process.env.CHROMIUM_BIN ?? 'chromium';
const RENDER_TIMEOUT_MS = 20000;

function parseMultipart(buffer, contentType) {
  const match = /boundary=(.+)$/.exec(contentType);
  if (!match) return null;
  const boundary = Buffer.from(`--${match[1]}`);
  const parts = [];
  let start = 0;
  for (;;) {
    const idx = buffer.indexOf(boundary, start);
    if (idx === -1) break;
    if (idx > start) parts.push(buffer.subarray(start, idx));
    start = idx + boundary.length;
  }
  const files = [];
  for (const raw of parts) {
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = raw.subarray(0, headerEnd).toString('utf8');
    const data = raw.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(headerText);
    const fileMatch = /filename="([^"]+)"/.exec(headerText);
    if (nameMatch) {
      files.push({
        name: nameMatch[1],
        filename: fileMatch ? fileMatch[1] : null,
        data: data.subarray(0, data.length - 2),
      });
    }
  }
  return files;
}

function renderPdf(htmlPath) {
  return new Promise((resolve, reject) => {
    const outPath = `${htmlPath}.pdf`;
    const child = spawn(CHROMIUM, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-pdf-header-footer',
      `--print-to-pdf=${outPath}`,
      `file://${htmlPath}`,
    ], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('render timeout'));
    }, RENDER_TIMEOUT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outPath)) {
        resolve(fs.readFileSync(outPath));
      } else {
        reject(new Error(`chromium exit ${code}`));
      }
    });
  });
}

let healthy = true;
async function probeHealth() {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gotenberg-probe-'));
    const probe = path.join(dir, 'probe.html');
    fs.writeFileSync(probe, '<html><body>ok</body></html>');
    await renderPdf(probe);
    fs.rmSync(dir, { recursive: true, force: true });
    healthy = true;
  } catch {
    healthy = false;
  }
}
void probeHealth();
setInterval(() => void probeHealth(), 5000);

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    if (healthy) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{"status":"unavailable"}');
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/forms/chromium/convert/html') {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 10000000) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const files = parseMultipart(body, req.headers['content-type'] ?? '');
    const doc = files?.find((f) => f.name === 'files' || f.name === 'file');
    if (!doc) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"missing files field"}');
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gotenberg-'));
    const htmlPath = path.join(dir, doc.filename ?? 'document.html');
    fs.writeFileSync(htmlPath, doc.data);
    try {
      const pdf = await renderPdf(htmlPath);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.length,
      });
      res.end(pdf);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"error":"not found"}');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`gotenberg-compatible service on ${PORT}`);
});
