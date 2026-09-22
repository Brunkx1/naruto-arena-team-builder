#!/usr/bin/env node
/*
 * Baixa as imagens do jogo (retratos dos personagens, ícones das skills, imagens das missões) para
 * data/img/ e gera data/img/index.js — um mapa URL -> arquivo local que a página usa no lugar do imgur
 * (que bloqueia hotlink de localhost e pode sair do ar). O imgur fica só como fallback.
 * Arquivos já baixados são pulados; --forcar baixa tudo de novo.
 * Uso: node scripts/download-images.js [--forcar]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CHARS = require('../data/characters.js');
const MISSIONS = require('../data/missions.js');

const DIR = path.join(__dirname, '..', 'data', 'img');
const INDEX = path.join(DIR, 'index.js');
const force = process.argv.includes('--forcar');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// nome local: id do imgur quando for imgur; senão hash da URL
function localName(url) {
  try {
    const u = new URL(url); const base = path.basename(u.pathname);
    if (/imgur\.com$/i.test(u.hostname) && /^[\w-]+\.(png|jpe?g|gif|webp)$/i.test(base)) return base;
  } catch (e) { /* URL inválida */ }
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + (path.extname(url.split('?')[0]).toLowerCase() || '.png');
}
async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}
async function download(url, file) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/*' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) return 'HTTP ' + r.status;   // 404/403: não adianta insistir
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) throw new Error('vazio');
      fs.writeFileSync(file, buf);
      return null;
    } catch (e) { if (attempt === 3) return e.message; await sleep(1500 * attempt); }
  }
  return 'falhou';
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const urls = new Set();
  for (const c of CHARS) { if (c.url) urls.add(c.url); for (const s of c.skills || []) if (s.url) urls.add(s.url); }
  for (const m of MISSIONS.missions) if (m.url) urls.add(m.url);
  const list = [...urls];
  console.log(`${list.length} imagens (${CHARS.length} personagens, skills e ${MISSIONS.missions.length} missões) -> ${path.relative(process.cwd(), DIR)}/`);
  let ok = 0, skipped = 0, done = 0;
  const failed = [];
  await mapLimit(list, 4, async url => {
    const file = path.join(DIR, localName(url));
    if (!force && fs.existsSync(file) && fs.statSync(file).size > 0) skipped++;
    else { const err = await download(url, file); if (err) failed.push(url + ' (' + err + ')'); else ok++; }
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${list.length}...`);
  });
  // índice: só o que existe no disco
  const index = {};
  for (const url of list) { const name = localName(url); const file = path.join(DIR, name); if (fs.existsSync(file) && fs.statSync(file).size > 0) index[url] = 'data/img/' + name; }
  const js = `// Gerado por scripts/download-images.js em ${new Date().toISOString().slice(0, 10)}: URL -> arquivo local (${Object.keys(index).length} imagens)\n` +
    `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_IMAGES = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(index)});\n`;
  fs.writeFileSync(INDEX, js);
  let bytes = 0; for (const f of fs.readdirSync(DIR)) bytes += fs.statSync(path.join(DIR, f)).size;
  console.log(`OK: ${ok} baixadas, ${skipped} já existiam, ${failed.length} falharam · ${Object.keys(index).length} no índice · ${(bytes / 1048576).toFixed(1)} MB em data/img/`);
  if (failed.length) { console.log('Falhas (a página usa o imgur para estas):'); for (const f of failed.slice(0, 20)) console.log('  ' + f); if (failed.length > 20) console.log(`  ... e mais ${failed.length - 20}`); }
  process.exit(0);
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
