#!/usr/bin/env node
/*
 * Naruto-Arena Team Builder — command line (same engine as the UI)
 *
 *   node cli.js ranking [--top 30] [--search naruto] [--tier-adjusted] [--mine]
 *   node cli.js suggest [--lock "Tsunade" --lock "Uzumaki Naruto"] [--ban "White Zetsu (S)"]
 *                       [--allow-clash] [--allow-variants] [--pool 100] [--n 10] [--missions 3] [--mine]
 *   node cli.js team "Tsunade" "Uzumaki Naruto" "Uchiha Sasuke"   (evaluate one trio)
 *   node cli.js detail "Tsunade"                                   (what the parser read from each skill)
 *   node cli.js missions [--status available|in-progress|done|rank-locked|locked|all] [--search kimimaro]
 *   node cli.js missions --priority                                (available missions by value ÷ effort)
 *   node cli.js community [--n 30] [--mine] [--search name]        (teams mentioned in the forum)
 *
 * Portuguese command names still work (sugerir, time, detalhe, missoes, comunidade), as do the old flags.
 */
'use strict';
const E = require('./js/engine.js');
const NM = require('./js/missions.js');
const CHARS = require('./data/characters.js');
const MISSIONS = require('./data/missions.js');
let ACCOUNT = null;
try { ACCOUNT = require('./data/account.js'); if (!ACCOUNT || !ACCOUNT.missions) ACCOUNT = null; } catch (e) { /* opcional */ }

const args = process.argv.slice(2);
// status de missão: aceita inglês e português
const STATUS_ALIAS = { available: 'disponivel', disponivel: 'disponivel', done: 'concluida', concluida: 'concluida', 'rank-locked': 'falta-rank', 'falta-rank': 'falta-rank', locked: 'bloqueada', bloqueada: 'bloqueada' };
const ALIAS = { sugerir: 'suggest', time: 'team', missoes: 'missions', detalhe: 'detail', comunidade: 'community', ajuda: 'help', ranking: 'ranking' };
const cmd = ALIAS[args[0]] ? ALIAS[args.shift()] : (args.shift() || 'help');
const opt = { trava: [], ban: [], top: 30, n: 10, pool: 100, busca: '', choque: false, variantes: false, missoes: ACCOUNT ? 3 : 0, meus: false, status: 'available' };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--lock' || a === '--trava') opt.trava.push(args[++i]);
  else if (a === '--ban') opt.ban.push(args[++i]);
  else if (a === '--top') opt.top = +args[++i];
  else if (a === '--n') opt.n = +args[++i];
  else if (a === '--pool') opt.pool = +args[++i];
  else if (a === '--search' || a === '--busca') opt.busca = args[++i];
  else if (a === '--allow-clash' || a === '--choque') opt.choque = true;
  else if (a === '--allow-variants' || a === '--variantes') opt.variantes = true;
  else if (a === '--missions' || a === '--missoes') opt.missoes = +args[++i];
  else if (a === '--mine' || a === '--meus') opt.meus = true;
  else if (a === '--status') opt.status = args[++i];
  else if (a === '--priority' || a === '--prioridade') opt.status = 'prioridade';
  else if (a === '--no-trained' || a === '--sem-treinados') opt.semTreinados = true;
  else if (a === '--tier-adjusted' || a === '--ajustado') opt.ajustado = true;
  else opt._ = (opt._ || []).concat(a);
}

try { E.setOverrides(require('./data/skill-overrides.js')); } catch (e) { /* sem correções */ }
let TRAINED = null;
try { TRAINED = require('./data/trained-weights.js'); } catch (e) { /* opcional */ }
if (TRAINED && !opt.semTreinados) E.setTrainedWeights(TRAINED);   // pesos de time treinados (scripts/train-synergy.js --aplicar)
try { E.setKnownCombos(require('./data/community.js').combos); } catch (e) { /* sem comunidade */ }
let WINRATE = null;
try { WINRATE = require('./data/winrate.js'); } catch (e) { /* opcional */ }
if (opt.ajustado) E.setWinrateMode('adjusted');
const profiles = E.scoreChars(CHARS, null, WINRATE);
const q = opt.busca.toLowerCase();
const missionIndex = NM.buildIndex(MISSIONS, CHARS, ACCOUNT, {});
const ownedNames = ACCOUNT && Array.isArray(ACCOUNT.lockedChars) ? CHARS.map(c => c.name).filter(n => !ACCOUNT.lockedChars.includes(n)) : null;
function printGoals(names, indent) {
  const mg = missionIndex.goalsForTeam(names);
  console.log(`${indent}Missões: ${mg.goals.length} objetivo(s) em ${mg.missionsTouched.length} missão(ões)${mg.inRow ? ` · ${mg.inRow} em SEQUÊNCIA` : ''}${ACCOUNT ? '' : ' (sem dados da conta: todas as missões contam)'}`);
  for (const g of mg.goals.slice(0, 12)) console.log(`${indent}  ${g.inRow ? '★' : '-'} ${g.mission.name}: ${g.text}${g.progress ? ` (${g.progress.done}/${g.progress.total})` : ''}`);
  if (mg.goals.length > 12) console.log(`${indent}  ... e mais ${mg.goals.length - 12}`);
}
const find = name => {
  const n = name.toLowerCase();
  return profiles.find(p => p.name.toLowerCase() === n) || profiles.find(p => p.name.toLowerCase().includes(n));
};
const pad = (s, n) => String(s).padEnd(n);
const pct = v => (v * 100).toFixed(0).padStart(3) + '%';

if (cmd === 'ranking') {
  console.log(pad('#', 4) + pad('Nota', 6) + pad('Nome', 32) + pad('Winrate oficial', 24) + pad('Heur', 6) + pad('Dano', 6) + pad('Ctrl', 6) + pad('Def', 6) + pad('Sup', 6) + pad('Chakra', 18) + 'Papéis');
  let shown = 0;
  for (const p of profiles) {
    if (q && !p.name.toLowerCase().includes(q)) continue;
    if (opt.meus && ownedNames && !ownedNames.includes(p.name)) continue;
    if (shown++ >= opt.top) break;
    const wr = p.winrate ? `${p.winrate.winrate.toFixed(1)}% (${p.winrate.matches})${p.winrate.adjusted != null ? ' ' + (p.winrate.winrate - p.winrate.expected >= 0 ? '+' : '') + (p.winrate.winrate - p.winrate.expected).toFixed(0) : ''}` : p.tierWinrate ? `≈${p.tierWinrate.winrate.toFixed(0)}% (tier nv ${p.tierWinrate.unlockLevel})` : 'sem dados';
    console.log(pad(p.rank, 4) + pad(p.score.toFixed(1), 6) + pad(p.name, 32) + pad(wr, 24) + pad(p.heuristicScore.toFixed(0), 6) + pad(pct(p.norm.offense), 6) + pad(pct(p.norm.control), 6) +
      pad(pct(p.norm.defense), 6) + pad(pct(p.norm.support), 6) + pad([...p.specificTypes].join('/') || 'Random', 18) + p.roles.join('/'));
  }
} else if (cmd === 'suggest') {
  const locked = opt.trava.map(find).filter(Boolean).map(p => p.name);
  const t0 = Date.now();
  const sopts = {
    locked, banned: opt.ban, allowClash: opt.choque, allowVariants: opt.variantes,
    poolSize: opt.pool, limit: opt.n, diverse: true, maxPerChar: locked.length ? 99 : 3,
  };
  if (opt.meus) { if (!ownedNames) { console.error('Sem dados da conta (rode scripts/download-account.js) para usar --meus.'); process.exit(1); } sopts.allowed = ownedNames; }
  if (opt.missoes > 0) sopts.extra = (a, b, c) => opt.missoes / 3 * missionIndex.weightForNames(a.name, b.name, c.name);
  const teams = E.suggestTeams(profiles, sopts);
  console.log(`${teams.length} times (${Date.now() - t0} ms)${locked.length ? ' | travados: ' + locked.join(', ') : ''}${opt.missoes ? ` | missões: ${opt.missoes} pts/objetivo` : ''}\n`);
  teams.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${r.total.toFixed(1)}${r.bonus ? ` (força ${(r.total - r.bonus).toFixed(1)} + missões ${r.bonus})` : ''}  ${r.members.map(m => `${m.name} (${m.score})`).join(' + ')}`);
    for (const l of E.explainTeam(r)) console.log('      ' + l);
    if (opt.missoes > 0) printGoals(r.members.map(m => m.name), '      ');
    console.log();
  });
  if (!teams.length) console.log('Nenhum time encontrado. Tente --choque, --variantes ou --pool 216.');
} else if (cmd === 'team') {
  const team = (opt._ || []).map(find);
  if (team.length !== 3 || team.some(x => !x)) { console.error('Informe exatamente 3 personagens válidos.'); process.exit(1); }
  const r = E.scoreTeam(team);
  console.log(`Nota do time: ${r.total.toFixed(1)} (média individual ${r.base.toFixed(1)})`);
  team.forEach(m => console.log(`  - ${m.name}: ${m.score} · ${m.roles.join('/')} · chakra ${[...m.specificTypes].join('/') || 'Random'}`));
  for (const l of E.explainTeam(r)) console.log('  ' + l);
  printGoals(team.map(m => m.name), '  ');
} else if (cmd === 'community') {
  let C = null; try { C = require('./data/community.js'); } catch (e) { console.error('Sem data/community.js. Rode: node scripts/build-community.js'); process.exit(1); }
  console.log(`Times recomendados no fórum (${C.forumTopics} tópicos, ${C.forumPosts} posts; ${C.balancePosts} patch notes)\n`);
  let shown = 0;
  for (const ct of C.teams) {
    const team = ct.members.map(n => profiles.find(p => p.name === n));
    if (team.some(x => !x)) continue;
    if (opt.meus && !ownedNames) { console.error('Sem dados da conta para --meus.'); process.exit(1); }
    if (opt.meus && !ct.members.every(n => ownedNames.includes(n))) continue;
    if (q && !ct.members.join(' ').toLowerCase().includes(q)) continue;
    const r = E.scoreTeam(team);
    console.log(`${String(ct.count).padStart(3)}x${ct.staff ? '*' : ' '} nota ${r.total.toFixed(1).padStart(5)}  ${ct.members.map(n => { const p = profiles.find(x => x.name === n); return `${n} (${p.winrate ? p.winrate.winrate.toFixed(0) + '%' : '?'})`; }).join(' + ')}  · ${(ct.lastDate || '').slice(0, 12)}`);
    if (++shown >= opt.n) break;
  }
} else if (cmd === 'missions') {
  const q0 = opt.busca.toLowerCase();
  const LABEL = { disponivel: 'DISPONÍVEL', concluida: 'concluída', 'falta-rank': 'FALTA RANK', bloqueada: 'bloqueada' };
  if (!ACCOUNT) console.log('(sem dados da conta: todas as missões aparecem como disponíveis; rode scripts/download-account.js)\n');
  let shown = 0;
  let seq = missionIndex.missions, prio = null;
  if (opt.status === 'prioridade') {
    const scoreByName = new Map(profiles.map(p => [p.name, p.score]));
    // taxa real: melhor time seu (5+ partidas decididas) que avança a missão, em vez dos 55% fixos
    let agg = null;
    try { const RES = require('./data/results.js'); if (RES && ACCOUNT && RES.username && RES.username.toLowerCase() === ACCOUNT.username.toLowerCase()) agg = require('./js/results.js').aggregate(RES); } catch (e) { /* sem resultados */ }
    const pFor = (mi, g) => {
      if (!agg) return null;
      let best = null;
      for (const row of agg.rows) { if (row.games < 5 || row.wr == null) continue; const set = new Set(row.team); const adv = g.anyOf ? g.anyOf.some(n => set.has(n)) : !!(g.allOf && g.allOf.length && g.allOf.every(n => set.has(n))); if (adv && (!best || row.wr > best.wr)) best = row; }
      return best ? { p: Math.min(0.85, Math.max(0.35, best.wr / 100)), team: best.team } : null;
    };
    const rows = missionIndex.priority({ scoreOf: n => (scoreByName.has(n) ? scoreByName.get(n) : null), pFor });
    prio = new Map(rows.map((r, i) => [r.mi, { ...r, pos: i + 1 }])); seq = rows.map(r => r.mi);
    console.log('Prioridade = valor (nota acima de 40 do personagem liberado + o que a missão destrava na cadeia, metade por nível) ÷ esforço (partidas esperadas do objetivo mais caro, a 55% de vitória)\n');
  }
  for (const mi of seq) {
    const m = mi.mission;
    if (opt.status === 'prioridade') { /* já filtrado e ordenado */ }
    else if (opt.status === 'in-progress' || opt.status === 'andamento') { if (mi.status !== 'disponivel' || !mi.goals.some(g => g.progress && g.progress.done > 0)) continue; }
    else if (opt.status !== 'all' && opt.status !== 'todas' && mi.status !== STATUS_ALIAS[opt.status]) continue;
    if (q0 && !(m.name + ' ' + (m.unlockedCharacter || '') + ' ' + mi.goals.map(g => (g.anyOf || g.allOf || []).join(' ')).join(' ')).toLowerCase().includes(q0)) continue;
    shown++;
    console.log(`${prio ? '#' + prio.get(mi).pos + ' ' : ''}${m.name} [${LABEL[mi.status]}] ${m.anime} · nível ${m.levelRequirement || 1}+${m.unlockedCharacter ? ' → libera ' + m.unlockedCharacter : ''}${m.completedRequeriments && m.completedRequeriments.length ? ' · requer: ' + m.completedRequeriments.join(', ') : ''}`);
    if (prio) { const r = prio.get(mi); console.log(`   valor ${r.value} ÷ ≈${r.effort} partidas = ${r.ratio}${r.rate && r.rate.real ? ` (a ${Math.round(r.rate.p * 100)}% com seu time ${r.rate.team.join(' + ')})` : ''}${r.ownScore != null ? ` · libera ${m.unlockedCharacter} (nota ${r.ownScore})` : ''}${r.opens ? ` · abre caminho para ${r.opens} missões${r.best ? ` (a melhor libera ${r.best.name}, nota ${r.best.score})` : ''}` : ''}${r.hardest ? ` · o mais caro: ${r.hardest.text}` : ''}`); }
    if (mi.dependents && mi.dependents.length) { const pend = mi.downstream.filter(d => d.mi.status !== 'concluida').length; console.log(`   pré-requisito de: ${mi.dependents.map(d => d.mission.name).join(', ')}${pend > mi.dependents.length ? ` (+${pend} na cadeia)` : ''}`); }
    for (const g of mi.goals) console.log(`   ${g.done ? '✓' : g.inRow ? '★' : '·'} ${g.text}${g.progress ? ` (${g.progress.done}/${g.progress.total})` : (g.progressText ? ' — ' + g.progressText : '')}`);
  }
  console.log(`\n${shown} missão(ões)`);
} else if (cmd === 'detail') {
  const p = find((opt._ || []).join(' '));
  if (!p) { console.error('Personagem não encontrado.'); process.exit(1); }
  console.log(`${p.name} — #${p.rank} · nota ${p.score} · ${p.roles.join('/')}`);
  console.log(`dano ${pct(p.norm.offense)} | controle ${pct(p.norm.control)} | defesa ${pct(p.norm.defense)} | suporte ${pct(p.norm.support)} | economia ${pct(p.norm.economy)} | tempo ${pct(p.norm.tempo)}`);
  console.log(`chakra específico: ${[...p.specificTypes].join('/') || 'nenhum (só Random)'} · custos Random: ${(p.randomRatio * 100).toFixed(0)}% · setup: ${(p.setupRatio * 100).toFixed(0)}%\n`);
  const c = CHARS.find(x => x.name === p.name);
  c.skills.forEach((s, i) => {
    const ps = p.skills[i];
    const facts = [];
    if (ps.dmg) facts.push(`dano ${Math.round(ps.dmg)}`);
    if (ps.dmgCond) facts.push(`dano cond. ${Math.round(ps.dmgCond)}`);
    if (ps.stun) facts.push(`stun ${ps.stun.toFixed(1)}`);
    if (ps.drain) facts.push(`drena ${ps.drain.toFixed(1)}`);
    if (ps.debuff) facts.push(`-${ps.debuff} dano inimigo`);
    if (ps.dr || ps.drAlly) facts.push(`RD ${Math.round(ps.dr + ps.drAlly)}`);
    if (ps.dd || ps.ddAlly) facts.push(`DD ${Math.round(ps.dd + ps.ddAlly)}`);
    if (ps.heal || ps.healAlly) facts.push(`cura ${Math.round(ps.heal + ps.healAlly)}`);
    for (const t of ps.tags) if (!['stun', 'drain', 'debuff', 'dr', 'dd', 'heal'].includes(t)) facts.push(t);
    if (ps.setup) facts.push('SETUP');
    console.log(`[${i}] ${s.name}${ps.isPassive ? ' (passiva)' : ps.isHidden ? ' (oculta)' : ''} | ${s.energy.join('+') || 'sem custo'} | cd ${s.cooldown}`);
    console.log(`    ${E.cleanText(s.description)}`);
    console.log(`    => ${facts.join(', ') || '(nada extraído)'}\n`);
  });
} else {
  console.log(`Usage:
  node cli.js ranking [--top 30] [--search naruto] [--tier-adjusted] [--mine]
  node cli.js suggest [--lock "Name"]... [--ban "Name"]... [--allow-clash] [--allow-variants] [--pool 100] [--n 10]
  node cli.js suggest --missions 3 --mine     (weigh missions; only characters unlocked on the account)
  node cli.js team "Name1" "Name2" "Name3"    (evaluate one trio)
  node cli.js detail "Name"                   (what the parser read from each skill)
  node cli.js missions [--status available|in-progress|done|rank-locked|locked|all] [--search name]
  node cli.js missions --priority             (available missions by value ÷ expected effort)
  node cli.js community [--n 30] [--mine] [--search name]   (teams mentioned in the forum, scored)

  Team weights trained from your own matches (data/trained-weights.js) are used automatically; --no-trained
  falls back to the defaults. Portuguese command names and flags still work.

  The full interface, with missions, your results and the maintenance tasks: node start.js`);
}
