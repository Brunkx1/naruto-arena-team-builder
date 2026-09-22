#!/usr/bin/env node
/*
 * Baixa tópicos e posts do fórum oficial (naruto-boards.site) das seções sobre times e balanceamento
 * e grava data/forum.js. A listagem das seções exige login (mesma conta do jogo); os tópicos são públicos.
 *
 * Uso: NA_USER=usuario NA_PASS=senha node scripts/download-forum.js [--secoes a,b,c] [--max-topicos N]
 * Seções padrão: team-strategies-and-missions, naruto-arena-guides, balance-discussion, history-of-balance, brazil
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SITE = 'https://www.naruto-boards.site';
const OUT = path.join(__dirname, '..', 'data', 'forum.js');
const args = process.argv.slice(2);
const argv = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const SECTIONS = (argv('--secoes') || 'team-strategies-and-missions,naruto-arena-guides,balance-discussion,history-of-balance,brazil').split(',');
const MAX_TOPICS = +(argv('--max-topicos') || 2000);

function ask(q, hidden) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) { const h = () => { readline.cursorTo(process.stdout, q.length); readline.clearLine(process.stdout, 1); }; process.stdin.on('data', h); rl.question(q, a => { process.stdin.off('data', h); rl.close(); process.stdout.write('\n'); res(a); }); }
    else rl.question(q, a => { rl.close(); res(a); });
  });
}
const cookiesFrom = res => (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)).map(c => c.split(';')[0]).join('; ');
const strip = h => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
async function getJson(url, cookie) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { cookie }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429) { const espera = (+r.headers.get('retry-after') || 30) + 1; console.warn(`  (limite do site: esperando ${espera}s)`); await new Promise(res => setTimeout(res, espera * 1000)); continue; }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (attempt === 3) throw e; await new Promise(res => setTimeout(res, 1500 * (attempt + 1))); }
  }
  return null;
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

(async () => {
  const username = process.env.NA_USER || await ask('Usuário Naruto-Arena: ');
  const password = process.env.NA_PASS || await ask('Senha: ', true);
  process.stdout.write('Login no fórum... ');
  const login = await fetch(SITE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(30000) });
  const cookie = cookiesFrom(login);
  if (!login.ok || !cookie) { console.error('falhou:', login.status); process.exit(1); }
  console.log('ok');

  const home = await (await fetch(SITE + '/', { headers: { cookie }, signal: AbortSignal.timeout(30000) })).text();
  const build = (home.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/) || [])[1];
  if (!build) { console.error('não achei o build do fórum'); process.exit(1); }

  // ---- lista de tópicos por seção -------------------------------------------
  const topics = [];
  for (const sec of SECTIONS) {
    process.stdout.write(`Seção ${sec}... `);
    let page = 1, max = 1, count = 0;
    while (page <= max && topics.length < MAX_TOPICS) {
      const j = await getJson(`${SITE}/_next/data/${build}/forum/${sec}/${page}.json`, cookie);
      const pp = j && j.pageProps;
      if (!pp || !Array.isArray(pp.forumTopics)) break;
      max = pp.forumMaxPage || 1;
      for (const t of pp.forumTopics) { topics.push({ id: t.pubId, section: sec, title: t.title, author: t.author, createdAt: t.createdAt, views: t.views, replies: t.replies, isSticky: !!t.isSticky, isAnnouncement: !!t.isAnnouncement }); count++; }
      page++;
    }
    console.log(`${count} tópicos (${max} páginas)`);
  }

  // ---- posts de cada tópico (todas as páginas) --------------------------------
  process.stdout.write(`Baixando posts de ${topics.length} tópicos... `);
  let posts = 0, failed = 0;
  await mapLimit(topics, 4, async t => {
    t.posts = [];
    try {
      let page = 1, max = 1;
      while (page <= max && page <= 30) {
        const j = await getJson(`${SITE}/_next/data/${build}/topic/${t.id}/${page}.json`, cookie);
        const pp = j && j.pageProps;
        if (!pp) break;
        max = pp.forumMaxPage || 1;
        for (const p of pp.dataPosts || []) { t.posts.push({ id: p.pubId, author: p.author, role: p.authorMembertype || 'Member', date: p.createdDate, text: strip(p.bodyHtml).slice(0, 6000) }); posts++; }
        page++;
      }
    } catch (e) { failed++; t.error = e.message; }
  });
  console.log(`${posts} posts (${failed} tópicos com falha)`);

  const data = { fetchedAt: new Date().toISOString(), sections: SECTIONS, topics };
  const js = `// Tópicos do fórum ${SITE} (seções: ${SECTIONS.join(', ')}), baixados em ${data.fetchedAt.slice(0, 10)} por scripts/download-forum.js\n` +
    `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_FORUM = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(data)});\n`;
  fs.writeFileSync(OUT, js);
  console.log(`OK: gravado em data/forum.js (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
  process.exit(0);
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
