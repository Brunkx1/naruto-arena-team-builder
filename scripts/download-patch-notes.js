#!/usr/bin/env node
/*
 * Baixa o histórico completo de balanceamentos do site (público, sem login) e grava data/balance-history.js:
 *   [{ date, title, slug, changes: [{ name, type: 'Nerfs'|'Buffs'|..., skills: [{ name, text: [...] }] }] }]
 * Fonte: /news-archive (lista de posts) + /news/<slug> (conteúdo). Regenerar de tempos em tempos.
 * Uso: node scripts/download-patch-notes.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SITE = 'https://www.naruto-arena.site';
const OUT = path.join(__dirname, '..', 'data', 'balance-history.js');

const slugify = t => t.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
const nextData = html => { const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]*)<\/script>/); return m ? JSON.parse(m[1]).props.pageProps : null; };
async function get(url) { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

(async () => {
  process.stdout.write('Lista de posts... ');
  const archive = nextData(await get(SITE + '/news-archive'));
  const list = [];
  for (const [month, posts] of Object.entries(archive.newsArchive || {})) for (const p of posts) list.push({ month, title: p.title, date: p.stringDate, characters: p.characters || [] });
  console.log(list.length + ' posts');

  process.stdout.write('Baixando posts... ');
  let done = 0, failed = 0;
  const posts = await mapLimit(list, 4, async item => {
    const slug = slugify(item.title);
    try {
      const pp = nextData(await get(`${SITE}/news/${slug}`));
      const post = pp && (pp.mainPost || pp.homepagePost);
      const c = post && post.content ? post.content : {};
      // winrate: string "Wins: 7463 (76.49%) Matches: 9757 (5.25%)" ou objeto; guardamos o bruto e o parseado
      const parseWr = w => {
        if (!w) return null;
        if (typeof w === 'object') {
          // {"matchesPlayed":"26920 (4.24%)","wins":"16645 (61.83%)"}
          const pv = s => { const m = String(s || '').match(/([\d,\.]+)\s*\(([\d\.]+)%\)/); return m ? [+m[1].replace(/[,\.]/g, ''), +m[2]] : [null, null]; };
          const [wins, winrate] = pv(w.wins), [matches, usage] = pv(w.matchesPlayed || w.matches);
          return { wins, winrate, matches, usage, raw: w };
        }
        const m = String(w).match(/Wins:\s*([\d,\.]+)\s*\(([\d\.]+)%\)\s*Matches:\s*([\d,\.]+)\s*\(([\d\.]+)%\)/);
        return m ? { wins: +m[1].replace(/[,\.]/g, ''), winrate: +m[2], matches: +m[3].replace(/[,\.]/g, ''), usage: +m[4], raw: String(w) } : { raw: String(w) };
      };
      const changes = Array.isArray(c.balance) ? c.balance.map(b => ({
        name: String(b.name || '').trim(), type: b.type || '',
        skills: (b.skills || []).map(s => ({ name: s.name, text: (s.text || []).map(x => String(x).replace(/<[^>]+>/g, '')) })),
        winrate: parseWr(b.winrate),
      })) : [];
      done++;
      return { date: item.date, month: item.month, title: item.title, slug, hasNewCharacters: String(c.hasNewCharacters) === 'true', charactersListed: item.characters, changes };
    } catch (e) { failed++; return { date: item.date, month: item.month, title: item.title, slug, error: e.message, charactersListed: item.characters, changes: [] }; }
  });
  console.log(`${done} ok, ${failed} falhas`);

  const js = `// Histórico de balanceamentos de ${SITE} (público), baixado em ${new Date().toISOString().slice(0, 10)} por scripts/download-patch-notes.js\n` +
    `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_BALANCE = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(posts)});\n`;
  fs.writeFileSync(OUT, js);
  const types = {}; let total = 0;
  for (const p of posts) for (const ch of p.changes) { types[ch.type] = (types[ch.type] || 0) + 1; total++; }
  console.log(`OK: ${posts.length} posts, ${total} mudanças de personagem gravadas em data/balance-history.js`);
  console.log('tipos:', JSON.stringify(types));
  process.exit(0);
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
