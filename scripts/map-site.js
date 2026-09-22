#!/usr/bin/env node
/*
 * Mapeia TODAS as páginas do site do jogo: pega a lista de rotas no manifesto do Next, tenta ler os dados de
 * cada uma com a sua conta e anota o que cada uma devolve (status, campos, tamanho dos arrays). Serve para
 * descobrir fontes de dados que o programa ainda não usa — foi assim que apareceu o histórico de partidas
 * do perfil (/profile/<usuario>: ladderGames, quickGames, privateGames com data, adversário e vencedor).
 *
 * Uso: NA_USER=usuario NA_PASS=senha node scripts/map-site.js [--sem-login]
 *      Resultado legível no terminal e em data/site-map.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SITE = 'https://www.naruto-arena.site';
const OUT = path.join(__dirname, '..', 'data', 'site-map.json');
const semLogin = process.argv.includes('--sem-login');
const cookiesFrom = r => (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).map(c => c.split(';')[0]).join('; ');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ask(q, hidden) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) { const h = () => { readline.cursorTo(process.stdout, q.length); readline.clearLine(process.stdout, 1); }; process.stdin.on('data', h); rl.question(q, a => { process.stdin.off('data', h); rl.close(); process.stdout.write('\n'); res(a); }); }
    else rl.question(q, a => { rl.close(); res(a); });
  });
}
// descreve a forma do que veio, sem despejar o conteúdo
function shape(v, depth = 0) {
  if (v == null) return 'null';
  if (Array.isArray(v)) return `array(${v.length})` + (v.length && depth < 1 ? ' de { ' + Object.keys(v[0] || {}).slice(0, 8).join(', ') + ' }' : '');
  if (typeof v === 'object') return depth < 1 ? '{ ' + Object.entries(v).slice(0, 10).map(([k, x]) => k + ': ' + shape(x, depth + 1)).join(', ') + ' }' : '{…}';
  return typeof v;
}

(async () => {
  let cookie = '';
  if (!semLogin) {
    const user = process.env.NA_USER || await ask('Usuário Naruto-Arena: ');
    const pass = process.env.NA_PASS || await ask('Senha: ', true);
    const r = await fetch(SITE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }), signal: AbortSignal.timeout(30000) });
    cookie = cookiesFrom(r);
    console.log('Login:', r.ok && cookie ? 'ok' : 'falhou (seguindo sem login)');
    process.env.NA_USER = user;
  }
  const home = await (await fetch(SITE + '/', { headers: { cookie } })).text();
  const build = (home.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/) || [])[1];
  const man = await (await fetch(`${SITE}/_next/static/${build}/_buildManifest.js`)).text();
  const rotas = [...new Set((man.match(/"\/[^"]*"/g) || []).map(s => s.slice(1, -1)))].filter(r => !r.includes('.js') && !['/_app', '/_error'].includes(r));
  console.log(`build ${build} · ${rotas.length} rotas\n`);

  // substitui parâmetros por valores reais quando dá
  const user = process.env.NA_USER || '';
  const exemplos = { '[id]': user, '[postId]': 'the-first-post', '[balanceId]': '1', '[historicId]': '', '[replayId]': '' };
  const resultado = [];
  for (const rota of rotas.sort()) {
    let alvo = rota, pular = false;
    for (const [param, val] of Object.entries(exemplos)) { if (!alvo.includes(param)) continue; if (val) alvo = alvo.replace(param, val); else { pular = true; break; } }
    if (pular || /\[/.test(alvo)) { resultado.push({ rota, status: 'pulada (precisa de um id específico)' }); continue; }
    const url = `${SITE}/_next/data/${build}${alvo === '/' ? '/index' : alvo}.json`;
    try {
      const r = await fetch(url, { headers: { cookie }, signal: AbortSignal.timeout(20000) });
      const txt = await r.text();
      let j = null; try { j = JSON.parse(txt); } catch (e) { /* html/redirect */ }
      const pp = j && (j.pageProps || j);
      const redirect = pp && pp.__N_REDIRECT;
      const campos = {};
      if (pp && !redirect) for (const [k, v] of Object.entries(pp)) { if (['SERVER_URL', 'PATHNAME', 'userPlayer'].includes(k)) continue; campos[k] = shape(v); }
      resultado.push({ rota, alvo, status: r.status, redirect: redirect || null, bytes: txt.length, campos });
    } catch (e) { resultado.push({ rota, alvo, status: 'erro: ' + e.message }); }
    await sleep(120);
  }
  fs.writeFileSync(OUT, JSON.stringify({ build, geradoEm: new Date().toISOString(), rotas: resultado }, null, 1));

  const interessantes = resultado.filter(r => r.campos && Object.keys(r.campos).length);
  console.log(`=== ${interessantes.length} páginas com dados para esta conta ===`);
  for (const r of interessantes) {
    console.log(`\n${r.rota}${r.alvo !== r.rota ? ' (' + r.alvo + ')' : ''} — ${r.bytes} bytes`);
    for (const [k, v] of Object.entries(r.campos)) console.log('   ', k + ':', String(v).slice(0, 160));
  }
  const bloqueadas = resultado.filter(r => r.redirect || (typeof r.status === 'number' && r.status >= 300));
  console.log(`\n=== ${bloqueadas.length} páginas restritas/redirecionadas ===`);
  for (const r of bloqueadas) console.log('  ', r.rota, '->', r.redirect || r.status);
  console.log(`\nDetalhe completo em ${path.relative(process.cwd(), OUT)}`);
  process.exit(0);
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
