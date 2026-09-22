#!/usr/bin/env node
/*
 * Atualiza os dados do jogo (sem login):
 *   - personagens e habilidades  <- /api/selection-catalog (catálogo oficial do site)
 *   - missões e grupos           <- bundle JavaScript do site (lido como TEXTO, nada é executado)
 *
 * Grava data/characters.js, data/characters.json e data/missions.js e mostra o que mudou.
 *
 * Uso:  node scripts/update-game-data.js [--na-helper]
 *       --na-helper: usa https://na-helper.vercel.app/data/characters.json como fonte dos personagens
 *                    (fallback automático se o catálogo do site falhar)
 *
 * Requer Node 18+ (fetch nativo).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SITE = 'https://www.naruto-arena.site';
const HELPER = 'https://na-helper.vercel.app/data/characters.json';
const DATA = path.join(__dirname, '..', 'data');
const useHelper = process.argv.includes('--na-helper');

const wrap = (global, data, header) =>
  `${header}\n(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.${global} = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(data)});\n`;

async function text(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`); return r.text(); }
async function json(url, opts) { return JSON.parse(await text(url, opts)); }
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Conversão de literal JS minificado -> JSON (sem executar código)
// ---------------------------------------------------------------------------
function extractLiteral(src, start) {
  let depth = 0, inStr = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === '\\') { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('literal não balanceado');
}
const SIMPLE_ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '\\': '\\', '/': '/', '"': '"', "'": "'" };
function jsToJson(lit) {
  let out = '', i = 0;
  const n = lit.length;
  while (i < n) {
    const ch = lit[i];
    if (ch === '"' || ch === "'") {
      const q = ch; let j = i + 1, buf = '';
      while (j < n) {
        const c = lit[j];
        if (c === '\\') {
          const nx = lit[j + 1];
          if (nx === 'x') { buf += String.fromCharCode(parseInt(lit.slice(j + 2, j + 4), 16)); j += 4; continue; }
          if (nx === 'u') { buf += String.fromCharCode(parseInt(lit.slice(j + 2, j + 6), 16)); j += 6; continue; }
          buf += SIMPLE_ESC[nx] !== undefined ? SIMPLE_ESC[nx] : nx; j += 2; continue;
        }
        if (c === q) break;
        buf += c; j++;
      }
      out += JSON.stringify(buf); i = j + 1; continue;
    }
    if (lit.startsWith('!0', i)) { out += 'true'; i += 2; continue; }
    if (lit.startsWith('!1', i)) { out += 'false'; i += 2; continue; }
    if (lit.startsWith('void 0', i)) { out += 'null'; i += 6; continue; }
    const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(lit.slice(i, i + 80));
    if (m && (i === 0 || lit[i - 1] === '{' || lit[i - 1] === ',')) { out += JSON.stringify(m[1]) + ':'; i += m[0].length; continue; }
    out += ch; i++;
  }
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
(async () => {
  console.log('Descobrindo build do site...');
  const home = await text(SITE + '/');
  const build = (home.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/) || [])[1];
  if (!build) throw new Error('não achei o buildId do Next.js na home');
  const manifest = await text(`${SITE}/_next/static/${build}/_buildManifest.js`);

  // ---- notícias / balanceamentos (públicos, na home) -----------------------
  try {
    const nd = home.match(/<script id="__NEXT_DATA__"[^>]*>([^<]*)<\/script>/);
    const posts = nd ? (JSON.parse(nd[1]).props.pageProps.announcementPosts || []) : [];
    const news = posts.map(p => ({
      id: p.id, date: p.stringData, author: p.author,
      title: String((p.content && p.content.title) || '').replace(/^"|"$/g, ''),
      body: String((p.content && p.content.body) || '').replace(/^"|"$/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
      balance: Array.isArray(p.content && p.content.balance) ? p.content.balance.map(b => ({
        name: b.name, type: b.type, skills: (b.skills || []).map(s => ({ name: s.name, text: s.text || [] })),
      })) : [],
    }));
    fs.writeFileSync(path.join(DATA, 'news.js'), wrap('NA_NEWS', news, `// Últimas notícias/balanceamentos da home de ${SITE} (${today()}). Regenerado por scripts/update-game-data.js.`));
    console.log(`  ${news.length} notícias · última: ${news[0] ? news[0].title + ' (' + news[0].date + ')' : '-'}`);
  } catch (e) { console.warn('  aviso: não consegui ler as notícias (' + e.message + ')'); }

  // ---- personagens ---------------------------------------------------------
  let characters = null, source = '';
  if (!useHelper) {
    try {
      const ingameChunk = (manifest.match(/static\/chunks\/pages\/ingame-[a-z0-9]+\.js/) || [])[0];
      const ingame = await text(`${SITE}/_next/${ingameChunk}`);
      const varName = (ingame.match(/selectionCatalogVersion:([A-Za-z_$][A-Za-z0-9_$]*)/) || [])[1];
      const version = varName ? (ingame.match(new RegExp('\\b' + varName.replace(/\$/g, '\\$') + '="([0-9a-f]{20,})"')) || [])[1] : '';
      console.log(`Catálogo oficial (versão ${version || '?'})...`);
      const cat = await json(`${SITE}/api/selection-catalog?v=${version || ''}`);
      if (!Array.isArray(cat.characters) || !cat.characters.length) throw new Error('catálogo sem personagens');
      characters = cat.characters.map(c => ({
        name: c.name, url: c.url, themepic: c.themepic, description: c.description, descriptionBR: c.descriptionBR,
        isSpecial: !!c.isSpecial, isPrivateOnly: !!c.isPrivateOnly, skills: c.skills,
      }));
      source = `${SITE}/api/selection-catalog (versão ${cat.version || version})`;
      fs.writeFileSync(path.join(DATA, 'version.json'), JSON.stringify({ catalogVersion: cat.version || version, build, updatedAt: new Date().toISOString() }, null, 2));
    } catch (e) { console.warn('  catálogo do site falhou (' + e.message + '); usando na-helper'); }
  }
  if (!characters) { characters = await json(HELPER); source = HELPER; }
  console.log(`  ${characters.length} personagens de ${source}`);

  // diff com o arquivo atual
  const oldPath = path.join(DATA, 'characters.json');
  if (fs.existsSync(oldPath)) {
    const old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    const oldMap = new Map(old.map(c => [c.name, c]));
    const newNames = new Set(characters.map(c => c.name));
    const added = characters.filter(c => !oldMap.has(c.name)).map(c => c.name);
    const removed = old.filter(c => !newNames.has(c.name)).map(c => c.name);
    const changed = characters.filter(c => oldMap.has(c.name) && JSON.stringify(oldMap.get(c.name).skills) !== JSON.stringify(c.skills)).map(c => c.name);
    console.log(`  novos: ${added.length ? added.join(', ') : '-'}`);
    console.log(`  removidos: ${removed.length ? removed.join(', ') : '-'}`);
    console.log(`  com habilidades alteradas: ${changed.length ? changed.join(', ') : '-'}`);
  }
  fs.writeFileSync(oldPath, JSON.stringify(characters));
  fs.writeFileSync(path.join(DATA, 'characters.js'), wrap('NA_CHARACTERS', characters,
    `// Fonte: ${source} (baixado em ${today()}). Regenerado por scripts/update-game-data.js.\n// Embutido como JS para funcionar abrindo index.html direto do disco (file://).`));

  // ---- missões -------------------------------------------------------------
  console.log('Missões (bundle do site)...');
  const chunks = [...new Set(manifest.match(/static\/chunks\/[0-9]+-[a-z0-9]+\.js/g) || [])];
  let modSrc = null;
  for (const c of chunks) {
    const s = await text(`${SITE}/_next/${c}`);
    if (s.includes('missionGoals:') && s.includes('"All Characters":[')) { modSrc = s; break; }
  }
  if (!modSrc) throw new Error('não achei o módulo de missões nos chunks');
  const gStart = modSrc.indexOf('{"All Characters":[');
  const groups = jsToJson(extractLiteral(modSrc, gStart));
  const firstGoal = modSrc.indexOf('missionGoals:', gStart);
  const uStart = modSrc.lastIndexOf('=[{', firstGoal) + 1;
  const missions = jsToJson(extractLiteral(modSrc, uStart));
  for (const m of missions) { m.nameId = m.name.toLowerCase().replace(/ /g, '-'); m.animeId = m.anime.toLowerCase().replace(/ /g, '-'); }
  const oldMissions = (() => { try { return require(path.join(DATA, 'missions.js')).missions; } catch (e) { return null; } })();
  if (oldMissions) {
    const oldNames = new Set(oldMissions.map(m => m.name));
    const added = missions.filter(m => !oldNames.has(m.name)).map(m => m.name);
    console.log(`  ${missions.length} missões, ${Object.keys(groups).length} grupos · novas: ${added.length ? added.join(', ') : '-'}`);
  } else console.log(`  ${missions.length} missões, ${Object.keys(groups).length} grupos`);
  fs.writeFileSync(path.join(DATA, 'missions.js'), wrap('NA_MISSIONS', { groups, missions },
    `// Definições das missões e grupos de personagens do Naruto-Arena, extraídas do bundle do site\n// (${SITE}, build ${build}, ${today()}). Regenerado por scripts/update-game-data.js. Sem dados de conta.`));

  console.log('\nOK. Recarregue o index.html. Se você usa dados da conta, rode também scripts/download-account.js.');
  process.exit(0);
})().catch(err => { console.error('Erro:', err.message); process.exit(1); });
