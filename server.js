const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'index.html');

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function decodeHtml(value) {
  return value.replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function extractImage(html) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (property && content && ['og:image', 'twitter:image'].includes(property.toLowerCase())) {
      const image = decodeHtml(content);
      if (/^https:\/\/[a-z0-9.-]+\//i.test(image)) return image;
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/health') return send(res, 200, JSON.stringify({ ok: true }));

  if (url.pathname === '/api/nft') {
    const slug = url.searchParams.get('slug') || '';
    if (!/^[A-Za-z0-9]+-\d{1,9}$/.test(slug)) {
      return send(res, 400, JSON.stringify({ error: 'Некорректная ссылка на NFT.' }));
    }
    try {
      const response = await fetch(`https://t.me/nft/${slug}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NFTGiftImage/1.0)' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`Telegram ответил с кодом ${response.status}`);
      const html = await response.text();
      const imageUrl = extractImage(html);
      if (!imageUrl) return send(res, 404, JSON.stringify({ error: 'Telegram не предоставил публичное изображение для этого подарка.' }));
      return send(res, 200, JSON.stringify({ imageUrl }));
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: 'Не удалось получить страницу Telegram. Попробуй позже.' }));
    }
  }

  if (url.pathname === '/api/image') {
    const imageUrl = url.searchParams.get('url') || '';
    let parsed;
    try { parsed = new URL(imageUrl); } catch { return send(res, 400, 'Invalid image URL', 'text/plain'); }
    if (parsed.protocol !== 'https:' || !/(^|\.)telegram\.org$|(^|\.)telesco\.pe$|(^|\.)telegram-cdn\.org$/i.test(parsed.hostname)) {
      return send(res, 400, 'Image host is not allowed', 'text/plain');
    }
    try {
      const response = await fetch(parsed, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NFTGiftImage/1.0)' },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) return send(res, 502, 'Image source unavailable', 'text/plain');
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      if (!contentType.startsWith('image/')) return send(res, 415, 'Source is not an image', 'text/plain');
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Disposition': 'inline; filename="telegram-nft-gift"', 'Cache-Control': 'public, max-age=300' });
      const buffer = Buffer.from(await response.arrayBuffer());
      return res.end(buffer);
    } catch {
      return send(res, 502, 'Could not fetch image', 'text/plain');
    }
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (!fs.existsSync(INDEX)) return send(res, 500, 'index.html is missing', 'text/plain');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(INDEX).pipe(res);
  }

  return send(res, 404, 'Not found', 'text/plain');
});

server.listen(PORT, '0.0.0.0', () => console.log(`NFT Gift Image server listening on ${PORT}`));
