#!/usr/bin/env node
/*
 * Verificação de saúde: confere se todas as fontes de dados ainda são lidas corretamente e se continuam
 * atuais. Rode depois de uma atualização do jogo (ou quando algo parecer estranho) — diz o que quebrou,
 * sem precisar caçar no meio dos scripts. Com login, testa também os endpoints da conta e do histórico.
 *
 * Uso: node scripts/health-check.js [--sem-rede]     (com NA_USER/NA_PASS testa conta e histórico)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const SITE = 'https://www.naruto-arena.site';
const SEM_REDE = process.argv.includes('--sem-rede');
const cookiesFrom = r => (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).map(c => c.split(';')[0]).join('; ');
const dias = iso => (Date.now() - new Date(iso).getTime()) / 864e5;
const linhas = [];
const ok = (nome, detalhe) => linhas.push({ nivel: 'ok', nome, detalhe });
const aviso = (nome, detalhe) => linhas.push({ nivel: 'aviso', nome, detalhe });
const falha = (nome, detalhe) => linhas.push({ nivel: 'falha', nome, detalhe });
const carregar = f => { const p = path.join(DATA, f); delete require.cache[require.resolve(p)]; return require(p); };

(async () => {
  // ---- dados locais ----------------------------------------------------------
  let CHARS = null;
  try {
    CHARS = carregar('characters.js');
    const semSkills = CHARS.filter(c => !Array.isArray(c.skills) || c.skills.length < 4).length;
    const semImagem = CHARS.filter(c => !c.url).length;
    if (!CHARS.length) falha('personagens', 'lista vazia');
    else if (semSkills || semImagem) aviso('personagens', `${CHARS.length} personagens · ${semSkills} sem 4 habilidades · ${semImagem} sem imagem`);
    else ok('personagens', `${CHARS.length} personagens, todos com habilidades e imagem`);
  } catch (e) { falha('personagens', e.message); }

  try {
    const E = require(path.join(__dirname, '..', 'js', 'core', 'engine.js'));
    try { E.setOverrides(carregar(path.join('curated', 'skill-overrides.js'))); } catch (e) { /* sem correções */ }
    let total = 0, vazias = 0;
    for (const c of CHARS || []) (c.skills || []).forEach((s, i) => { const p = E.parseSkill(s, i); E.applyOverride(c.name, p); if (p.isPassive || p.genericDodge) return; total++; const nada = !p.dmg && !p.dmgCond && !p.stun && !p.drain && !p.heal && !p.healAlly && !p.dr && !p.drAlly && !p.dd && !p.ddAlly && !p.tags.size; if (nada) vazias++; });
    const pct = total ? 100 * vazias / total : 0;
    if (pct > 5) falha('leitura de habilidades', `${vazias}/${total} sem nada extraído (${pct.toFixed(1)}%) — o site pode ter mudado o formato dos textos`);
    else ok('leitura de habilidades', `${total} habilidades ativas · ${vazias} sem nada extraído (${pct.toFixed(1)}%)`);
  } catch (e) { falha('leitura de habilidades', e.message); }

  try {
    const M = carregar('missions.js');
    const semObjetivo = (M.missions || []).filter(m => !Array.isArray(m.missionGoals) || !m.missionGoals.length).length;
    if (!M.missions || !M.missions.length) falha('missões', 'lista vazia');
    else if (semObjetivo) aviso('missões', `${M.missions.length} missões · ${semObjetivo} sem objetivos`);
    else ok('missões', `${M.missions.length} missões, ${Object.keys(M.groups || {}).length} grupos`);
  } catch (e) { falha('missões', e.message); }

  try {
    const W = carregar('winrate.js');
    const nomes = Object.keys(W).filter(k => k !== '_model');
    const semModelo = !W._model || W._model.intercept == null;
    const medicoes = nomes.reduce((s, n) => s + ((W[n].series || []).length), 0);
    const recentes = nomes.filter(n => W[n].date && dias(W[n].date) < 120).length;
    if (!nomes.length) falha('winrate oficial', 'nenhum personagem');
    else if (semModelo) aviso('winrate oficial', `${nomes.length} personagens, mas sem o modelo de tier (rode build-winrate.js)`);
    else ok('winrate oficial', `${nomes.length} personagens · ${medicoes} medições · ${recentes} medidos nos últimos 4 meses · erro típico ±${W._model.typicalError || '?'}`);
  } catch (e) { falha('winrate oficial', e.message); }

  try {
    const B = carregar('balance-history.js');
    const posts = Array.isArray(B) ? B : (B.posts || []);
    const comWr = posts.filter(p => (p.changes || []).some(c => c.winrate && c.winrate.matches)).length;
    const ultimo = posts.map(p => p.date).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
    if (!posts.length) falha('patch notes', 'nenhum post');
    else if (!comWr) falha('patch notes', `${posts.length} posts, nenhum com winrate — o formato do site pode ter mudado`);
    else ok('patch notes', `${posts.length} posts · ${comWr} com winrate · último: ${String(ultimo).slice(0, 20)}`);
  } catch (e) { falha('patch notes', e.message); }

  try {
    const img = carregar(path.join('img', 'index.js'));
    const faltando = (CHARS || []).filter(c => c.url && !img[c.url]).length;
    if (faltando > 10) aviso('imagens locais', `${Object.keys(img).length} baixadas · ${faltando} personagens sem imagem local (rode download-images.js)`);
    else ok('imagens locais', `${Object.keys(img).length} imagens em data/img`);
  } catch (e) { aviso('imagens locais', 'não geradas (a página usa o imgur): rode scripts/download-images.js'); }

  try {
    const A = carregar('account.js');
    if (!A || !A.username) aviso('conta', 'sem dados (rode download-account.js)');
    else {
      const d = dias(A.fetchedAt);
      const linha = `${A.username} · nível ${A.profile.level ?? '?'} · ${Object.values(A.missions || {}).filter(m => m.isCompleted).length} missões feitas · coletada há ${d.toFixed(1)} dia(s)`;
      d > 7 ? aviso('conta', linha + ' (desatualizada)') : ok('conta', linha);
    }
  } catch (e) { aviso('conta', 'sem dados (rode download-account.js)'); }

  try {
    const R = carregar('results.js');
    const agg = require(path.join(__dirname, '..', 'js', 'core', 'results.js')).aggregate(R);
    const semResultado = agg.rows.reduce((s, r) => s + r.unknown, 0);
    ok('seus resultados', `${agg.observedMatches} partidas (${agg.ladderMatches} ladder, ${agg.quickMatches} quick) · ${agg.rows.length} times · ${semResultado} sem resultado`);
  } catch (e) { aviso('seus resultados', 'ainda sem partidas registradas (ligue o observador)'); }

  // ---- site ------------------------------------------------------------------
  if (!SEM_REDE) {
    try {
      const home = await (await fetch(SITE + '/', { signal: AbortSignal.timeout(20000) })).text();
      const build = (home.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/) || [])[1];
      let local = null; try { local = JSON.parse(fs.readFileSync(path.join(DATA, 'version.json'), 'utf8')); } catch (e) { /* sem registro */ }
      if (!build) falha('site', 'não achei o build do Next (o site mudou de estrutura)');
      else if (local && local.build !== build) aviso('site', `build mudou (${local.build} → ${build}): rode a verificação de atualização`);
      else ok('site', `build ${build}`);

      const cat = await fetch(`${SITE}/api/selection-catalog?v=${local ? local.catalogVersion : ''}`, { signal: AbortSignal.timeout(20000) });
      const j = await cat.json().catch(() => null);
      const lista = j && (j.content || j.characters || j);
      if (!cat.ok || !Array.isArray(lista) || !lista.length) falha('catálogo oficial', `resposta inesperada (HTTP ${cat.status})`);
      else ok('catálogo oficial', `${lista.length} personagens na API`);

      const user = process.env.NA_USER, pass = process.env.NA_PASS;
      if (user && pass) {
        const login = await fetch(SITE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }), signal: AbortSignal.timeout(20000) });
        const cookie = cookiesFrom(login);
        if (!login.ok || !cookie) falha('login', `HTTP ${login.status}`);
        else {
          ok('login', user);
          const prof = await (await fetch(`${SITE}/_next/data/${build}/profile/${encodeURIComponent(user)}.json`, { headers: { cookie }, signal: AbortSignal.timeout(20000) })).json().catch(() => null);
          const info = prof && prof.pageProps && prof.pageProps.userInfor;
          if (!info) falha('histórico do perfil', 'não veio userInfor — a fonte do resultado das partidas pode ter mudado');
          else {
            const l = (info.ladderGames || []).length, q = (info.quickGames || []).length;
            const campos = (info.ladderGames || info.quickGames || [])[0] || {};
            const temCampos = ['historicId', 'date', 'winner'].every(k => k in campos);
            if (!temCampos && (l + q)) falha('histórico do perfil', 'faltam campos (historicId/date/winner)');
            else ok('histórico do perfil', `${l} de ladder + ${q} de quick nas últimas 24 h`);
          }
        }
      } else aviso('login', 'sem NA_USER/NA_PASS: conta e histórico não testados');
    } catch (e) { falha('site', e.message); }
  }

  // ---- resumo ----------------------------------------------------------------
  const icone = { ok: '✔', aviso: '!', falha: '✖' };
  console.log('\nVerificação de saúde do NA Team Builder\n');
  for (const l of linhas) console.log(`  ${icone[l.nivel]} ${l.nome.padEnd(24)} ${l.detalhe}`);
  const falhas = linhas.filter(l => l.nivel === 'falha').length, avisos = linhas.filter(l => l.nivel === 'aviso').length;
  console.log(`\n${linhas.length - falhas - avisos} ok · ${avisos} aviso(s) · ${falhas} falha(s)`);
  if (falhas) console.log('Falha significa que uma fonte de dados parou de ser lida: veja o script correspondente em scripts/.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
