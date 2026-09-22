#!/usr/bin/env node
/*
 * Testes de regressão do NA Team Builder.  Rode:  node test.js
 * Cobre: parser de habilidades, notas, busca de times, missões e integridade dos dados.
 * Útil depois de `scripts/update-game-data.js` para garantir que nada quebrou.
 */
'use strict';
const assert = require('assert');
const E = require('./js/engine.js');
const NM = require('./js/missions.js');
const CHARS = require('./data/characters.js');
const MISSIONS = require('./data/missions.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.message || e).toString().split('\n')[0]); }
}
const skillOf = (charName, skillName) => {
  const c = CHARS.find(x => x.name === charName); assert(c, 'personagem não encontrado: ' + charName);
  const i = c.skills.findIndex(s => s.name === skillName); assert(i >= 0, 'skill não encontrada: ' + skillName);
  return E.parseSkill(c.skills[i], i);
};
const parse = (desc, energy, cd) => E.parseSkill({ name: 'x', description: desc, energy: energy || ['Random'], classes: [], cooldown: cd || 0 }, 0);

console.log('\n# Parser de habilidades (descrições sintéticas)');
test('dano simples', () => { const p = parse('Deals 30 damage to one enemy.'); assert.strictEqual(p.dmg, 30); assert.strictEqual(p.dmgCond, 0); });
test('dano em área multiplica', () => { const p = parse('Deals 10 damage to all enemies.'); assert(p.aoe); assert(p.dmg > 20 && p.dmg < 23); });
test('dano por N turnos multiplica', () => { const p = parse('Deals 10 damage to one enemy for 3 turns.'); assert.strictEqual(p.multiTurn, 3); assert.strictEqual(p.dmg, 30); });
test('piercing e aflição valem mais e marcam tag', () => { assert(parse('Deals 20 piercing damage.').dmg > 20); const a = parse('Deals 20 affliction damage.'); assert(a.affliction && a.dmg > 20); });
test('dano adicional é condicional', () => { const p = parse('Deals 20 damage. During X, this skill deals 10 additional damage.'); assert.strictEqual(p.dmg, 20); assert.strictEqual(p.dmgCond, 10); });
test('"if" na frase seguinte não contamina', () => { const p = parse('Deals 20 damage to one enemy. For 1 turn, if that enemy uses a skill, they lose 1 chakra.'); assert.strictEqual(p.dmg, 20); });
test('auto-dano é ignorado', () => { const p = parse('Deals 25 piercing damage. Afterwards, Lee will take 5 affliction damage which cannot kill him.'); assert(p.dmg < 30); });
test('"20/40/60" vira média', () => { const p = parse('Deals 20/40/60 piercing damage to one enemy.'); assert(Math.abs(p.dmg - 46) < 1); });
test('"permanent" de outra cláusula não multiplica o dano', () => { const p = parse('Hidan attacks one enemy dealing 15 damage to them and he gains 10 permanent destructible defense.'); assert.strictEqual(p.dmg, 15); assert(p.dd > 10); });
test('dano permanente por turno continua multiplicando', () => { const p = parse('Deals 25 damage to them each turn permanently.'); assert.strictEqual(p.dmg, 100); });
test('damage reduction não é dano', () => { const p = parse('Gains 15 points of damage reduction for 2 turns.'); assert.strictEqual(p.dmg, 0); assert.strictEqual(p.dr, 30); });
test('stun com turnos e negação', () => { assert.strictEqual(parse('Stuns one enemy for 2 turns.').stun, 2); assert.strictEqual(parse('This skill ignores stun effects.').stun, 0); assert(parse('This skill ignores stun effects.').ignoreStun); });
test('sinônimos de stun ("unable to use a skill", "two rounds")', () => { assert.strictEqual(parse('The target is unable to use a skill for two rounds.').stun, 2); });
test('stun parcial vale menos', () => { assert(parse("Stuns that enemy's physical skills for 1 turn.").stun < 1); });
test('stun em si mesmo não é controle', () => { assert.strictEqual(parse('If stunned, he will gain 15 damage reduction.').stun, 0); });
test('roubo/remoção de chakra', () => { assert(parse('Steals 1 random chakra from one enemy.').drain > 1); assert.strictEqual(parse('Removes 2 chakra from one enemy.').drain, 2); assert(parse('Shino directs bugs to one enemy, stealing 20 health and 1 taijutsu or genjutsu chakra from them.').drain > 0); });
test('cura própria e de aliado', () => { assert.strictEqual(parse('Heals one ally for 25 health.').healAlly, 25); assert.strictEqual(parse('Heals himself for 10 health.').heal, 10); });
test('defesa destrutível permanente', () => { const p = parse('Granting his allies 25 points of permanent destructible defense.'); assert(p.ddAlly > 25); });
test('invulnerabilidade: esquiva genérica vs. aliado', () => { const g = parse('This skill makes Naruto invulnerable for 1 turn.'); assert(g.genericDodge); const a = parse('One ally becomes invulnerable for 1 turn.'); assert(a.invulnAlly && !a.invulnSelf); });
test('contra-ataque no inimigo é controle', () => { const p = parse('For 1 turn, if that enemy uses a new harmful skill they will be countered.'); assert(p.counter && p.counterEnemy); });
test('"cannot be countered" não é contra-ataque', () => { const p = parse('Deals 25 damage. This skill cannot be countered or reflected.'); assert(!p.counter && p.uncounterable); });
test('debuff de dano inimigo', () => { const p = parse('For 2 turns, that enemy will deal 5 less non-affliction damage.'); assert.strictEqual(p.debuff, 5); assert.strictEqual(p.dmg, 0); });
test('preparação ("requires")', () => { assert(parse("This skill requires 'Shadow Clones'.").setup); assert(!parse('Deals 10 damage.').setup); });
test('efeito condicional na frase vale metade', () => { assert.strictEqual(parse("If 'X' is active, that enemy will be stunned for 2 turns.").stun, 1); });

console.log('\n# Mecânicas adicionais');
test('invulnerabilidade por classe é parcial', () => { assert.strictEqual(parse('For 1 turn, Temari becomes invulnerable to non-mental skills.').invulnScope, 0.85); assert.strictEqual(parse('Becomes invulnerable to physical skills for 1 turn.').invulnScope, 0.4); assert.strictEqual(parse('One ally becomes invulnerable for 1 turn.').invulnScope, 1); });
test('cooldown: redução para o time (suporte) e aumento para inimigos (controle)', () => { const a = parse('For 3 turns, Kakashi and his team will have the cooldown of their skills reduced by 1.'); assert.strictEqual(a.cdDown, 1); const b = parse('Asuma exhales ash on all enemies, increasing the cooldown of their skills by 1 turn.'); assert.strictEqual(b.cdUp, 1); });
test('reviver aliado', () => { assert(parse('Nagato revives one dead ally with 30 health.').revive); assert(!parse('This enemy cannot be revived.').revive); });
test('dano percentual da vida', () => { const p = parse("This skill deals 30% of one enemy's current health as damage."); assert(p.pctDmg > 10 && p.dmg > 10); });
test('stacks: dano por stack é condicional', () => { const p = parse('Deals 10 damage for each Rain Stack. Each turn Yota gains 1 Rain Stack.'); assert(p.tags.has('stacks')); assert.strictEqual(p.dmg, 0); assert(p.dmgCond > 0); });
test('não pode morrer / quebra de defesa / cópia / custo menor', () => { assert(parse('Hidan cannot be killed while this skill is active.').unkillable); assert(parse("Neji destroys all destructible defense of one enemy and deals 30 damage.").shieldBreak); assert(parse('Kakashi will copy a random harmful skill from that enemy.').copy); assert(parse("For 2 turns, his team's skills will cost 1 less random chakra.").costDown); });
test('Action multi-turno vale menos que Instant (mesmo texto)', () => { const mk = cls => E.parseSkill({ name: 'x', description: 'Deals 15 damage to one enemy for 3 turns.', energy: ['Random'], classes: cls, cooldown: 0 }, 0); const ci = { name: 'A', skills: [] }; const pi = E.profileChar({ name: 'A', skills: [{ name: 'x', description: 'Deals 15 damage to one enemy for 3 turns.', energy: ['Random'], classes: ['Chakra', 'Instant'], cooldown: 0 }] }); const pa = E.profileChar({ name: 'B', skills: [{ name: 'x', description: 'Deals 15 damage to one enemy for 3 turns.', energy: ['Random'], classes: ['Chakra', 'Action'], cooldown: 0 }] }); assert(pa.raw.offense < pi.raw.offense); void mk; void ci; });

test('amplificação "receive an additional N damage from affliction skills"', () => { const p = parse('For the rest of the game, the enemy team will receive an additional 5 damage from affliction skills.'); assert.strictEqual(p.amplify, 5); assert(p.amplifyAffl); assert.strictEqual(p.dmg, 0); });
test('classe Affliction declarada marca o dano como aflição', () => { const p = E.parseSkill({ name: 'x', description: 'Deals 20 damage to one enemy.', energy: ['Random'], classes: ['Affliction', 'Instant', 'Ranged'], cooldown: 0 }, 0); assert(p.affliction); });

test('"if a skill that has counter/reflect/invulnerability is used on that enemy" não é defesa própria', () => { const p = parse('Aoba targets one enemy for 2 turns. If a new skill that has counter, reflect, or invulnerability is used on that enemy, they will ignore helpful effects for 1 turn.'); assert(!p.counter && !p.reflect && !p.invulnSelf && !p.invulnAlly); });

console.log('\n# Parser em personagens reais');
test('Naruto: Rasengan 45 dano + stun + requer preparação', () => { const p = skillOf('Uzumaki Naruto', 'Rasengan'); assert.strictEqual(p.dmg, 45); assert(p.stun >= 1); assert(p.setup); });
test('Naruto: Shadow Clones dá redução de dano', () => { assert(skillOf('Uzumaki Naruto', 'Shadow Clones').dr > 0); });
test('Naruto: passiva é detectada', () => { const c = CHARS.find(x => x.name === 'Uzumaki Naruto'); assert(E.parseSkill(c.skills[4], 4).isPassive); });
test('Shino: Bug Wall é suporte (defesa destrutível para aliados)', () => { assert(skillOf('Aburame Shino', 'Bug Wall').ddAlly > 0); });
test('Tsunade tem cura de aliado', () => { const c = CHARS.find(x => x.name === 'Tsunade'); assert(c.skills.some((s, i) => E.parseSkill(s, i).healAlly > 0)); });

console.log('\n# Notas e busca de times');
const profiles = E.scoreChars(CHARS);
test('todos os personagens têm nota 0-100 e papéis', () => { for (const p of profiles) { assert(p.score >= 0 && p.score <= 100, p.name); assert(p.roles.length >= 1); } });
test('ranking ordenado e ranks únicos', () => { for (let i = 1; i < profiles.length; i++) assert(profiles[i - 1].score >= profiles[i].score); assert.strictEqual(new Set(profiles.map(p => p.rank)).size, profiles.length); });
test('tier manual altera a nota', () => { const a = E.scoreChars(CHARS, { 'Rock Lee': 'S' }).find(p => p.name === 'Rock Lee'); const b = profiles.find(p => p.name === 'Rock Lee'); assert(a.score > b.score); });
test('winrate entra na nota só com partidas suficientes', () => {
  const w = E.scoreChars(CHARS, null, { Tsunade: { winrate: 80, matches: 2000, date: '2026-09-01' }, 'Rock Lee': { winrate: 80, matches: 5 } });
  assert(w.find(p => p.name === 'Tsunade').score > profiles.find(p => p.name === 'Tsunade').score);
  assert.strictEqual(w.find(p => p.name === 'Rock Lee').score, profiles.find(p => p.name === 'Rock Lee').score);
  const w2 = E.scoreChars(CHARS, null, { Tsunade: { winrate: 35, matches: 2000, date: '2026-09-01' } });
  assert(w2.find(p => p.name === 'Tsunade').score < profiles.find(p => p.name === 'Tsunade').score, 'winrate baixo derruba a nota');
});
test('variantes do mesmo personagem são detectadas', () => { assert.strictEqual(E.variantKey('Tsunade'), E.variantKey('Tsunade (S)')); assert.strictEqual(E.variantKey('Uzumaki Naruto'), E.variantKey('Sennin Naruto (S)')); assert.notStrictEqual(E.variantKey('Shodai Hokage'), E.variantKey('Nidaime Hokage')); assert.notStrictEqual(E.variantKey('Animal Path Pein (S)'), E.variantKey('Deva Path Pein (S)')); });
test('busca devolve trios distintos e ordenados', () => { const t = E.suggestTeams(profiles, { poolSize: 60, limit: 10 }); assert(t.length === 10); for (let i = 1; i < t.length; i++) assert(t[i - 1].total >= t[i].total); for (const r of t) assert.strictEqual(new Set(r.members.map(m => m.name)).size, 3); });
test('sem choque: nenhum par compartilha tipo específico', () => { for (const r of E.suggestTeams(profiles, { poolSize: 80, limit: 20, allowClash: false })) assert.strictEqual(r.clash.sharedPairs, 0); });
test('sem variantes: nenhum trio repete personagem', () => { for (const r of E.suggestTeams(profiles, { poolSize: 216, limit: 30, allowClash: true })) assert.strictEqual(new Set(r.members.map(m => m.vkey)).size, 3); });
test('travar 2 personagens devolve só complementos', () => { const t = E.suggestTeams(profiles, { locked: ['Tsunade', 'Kimimaro'], poolSize: 216, limit: 5 }); assert(t.length === 5); for (const r of t) { assert(r.members.some(m => m.name === 'Tsunade')); assert(r.members.some(m => m.name === 'Kimimaro')); } });
test('banidos e lista "allowed" são respeitados', () => { const t = E.suggestTeams(profiles, { banned: ['Tsunade'], allowed: ['Tsunade', 'Kimimaro', 'Rock Lee', 'Tenten', 'Haku'], poolSize: 216, limit: 5 }); for (const r of t) for (const m of r.members) { assert.notStrictEqual(m.name, 'Tsunade'); assert(['Kimimaro', 'Rock Lee', 'Tenten', 'Haku'].includes(m.name)); } });
test('bônus extra (missões) entra na ordenação', () => { const t = E.suggestTeams(profiles, { poolSize: 216, limit: 3, allowClash: true, extra: (a, b, c) => [a, b, c].some(m => m.name === 'Rock Lee') ? 500 : 0 }); assert(t[0].members.some(m => m.name === 'Rock Lee')); assert.strictEqual(t[0].bonus, 500); });
test('scoreTeam e fastTeamScore batem', () => { const team = profiles.slice(0, 3); const r = E.scoreTeam(team); const s = E.suggestTeams(profiles, { locked: team.map(m => m.name), poolSize: 1 })[0]; assert.strictEqual(r.total, s.total); });
test('busca completa (216) em menos de 6 s', () => { const t0 = Date.now(); E.suggestTeams(profiles, { poolSize: 216, limit: 5, allowClash: true }); assert(Date.now() - t0 < 6000); });

console.log('\n# Missões');
const idx = NM.buildIndex(MISSIONS, CHARS, null, {});
test('200 missões e 31 grupos carregados', () => { assert.strictEqual(MISSIONS.missions.length >= 200, true); assert(Object.keys(MISSIONS.groups).length >= 31); });
test('todo nome de personagem nos objetivos existe no catálogo (exceto textos livres)', () => {
  const names = new Set(CHARS.map(c => c.name)); const bad = new Set();
  for (const g of idx.goals) for (const n of (g.anyOf || []).concat(g.allOf || [])) if (!names.has(n)) bad.add(n);
  const allowed = new Set(['any skill copied by Zetsu']);
  for (const b of bad) assert(allowed.has(b), 'desconhecido: ' + b);
});
test('todo useSkill tem dono resolvido', () => { assert.strictEqual(idx.goals.filter(g => g.goal.type === 'useSkill' && !g.owner).length, 0); });
test('regra any-of / sameTeam / grupo', () => {
  const t7 = ['Uzumaki Naruto', 'Uchiha Sasuke', 'Haruno Sakura'];
  const r = idx.goalsForTeam(t7);
  assert(r.goals.some(g => g.mission.name === 'Survival'), 'sameTeam Survival');
  assert(r.goals.some(g => g.goal.with === 'Team 7'), 'grupo Team 7');
  assert(!idx.goalsForTeam(['Uzumaki Naruto', 'Haruno Sakura', 'Tenten']).goals.some(g => g.mission.name === 'Survival'), 'sameTeam exige todos');
  assert.strictEqual(idx.countForNames(...t7), r.goals.length, 'contagem rápida = lista');
});
test('conta simulada: só missões disponíveis contam e progresso é lido', () => {
  const account = { missions: {} };
  for (const m of MISSIONS.missions) account.missions[m.name] = { isCompleted: true, isAvailable: false, progress: [] };
  account.missions['Survival'] = { isCompleted: false, isAvailable: true, progress: [{ text: 'Win 5 battles with the team (2/5)', isCompleted: false }] };
  const i2 = NM.buildIndex(MISSIONS, CHARS, account, {});
  assert.strictEqual(i2.activeGoalCount, 1);
  const g = i2.goalsForTeam(['Uzumaki Naruto', 'Uchiha Sasuke', 'Haruno Sakura']).goals[0];
  assert.deepStrictEqual(g.progress, { done: 2, total: 5 });
});
test('objetivo já concluído dentro de missão em andamento não conta', () => {
  const account = { missions: {} };
  for (const m of MISSIONS.missions) account.missions[m.name] = { isCompleted: true, isAvailable: false, progress: [] };
  const mm = MISSIONS.missions.find(m => m.missionGoals.length >= 2);
  account.missions[mm.name] = { isCompleted: false, isAvailable: true, progress: mm.missionGoals.map((g, i) => ({ text: 'x', isCompleted: i === 0 })) };
  const i2 = NM.buildIndex(MISSIONS, CHARS, account, {});
  assert.strictEqual(i2.activeGoalCount, mm.missionGoals.length - 1);
});
test('peso por tipo de objetivo: sequência >> vencer N >> usar skill', () => { const w = NM.goalWeight; assert(w({ type: 'win', isrow: true, sameTeam: true }) > w({ type: 'win', isrow: true }) && w({ type: 'win', isrow: true }) > w({ type: 'win' }) && w({ type: 'win' }) > w({ type: 'useSkill' })); const t = ['Rock Lee', 'Tenten', 'Haku']; assert(idx.weightForNames(...t) > 0 && idx.weightForNames(...t) <= 4 * idx.countForNames(...t)); for (const trio of [t, ['Inuzuka Kiba (S)', 'Kurotsuchi (S)', 'Kankuro (S)'], ['Hozuki Suigetsu (S)', 'Karin (S)', 'Juugo (S)']]) assert(Math.abs(idx.weightForNames(...trio) - idx.goalsForTeam(trio).weight) < 1e-4, 'soma ponderada bate com goalsForTeam: ' + trio.join('+')); });
test('tabela de ranks do manual', () => { assert.strictEqual(NM.rankForLevel(26).name, 'Jounin'); assert.strictEqual(NM.rankForLevel(1).name, 'Academy Student'); assert.strictEqual(NM.rankForLevel(50).name, 'Kage'); });

console.log('\n# Integridade dos dados');
test('personagens têm nome único, imagem e 4+ skills com energia válida', () => {
  const seen = new Set();
  for (const c of CHARS) {
    assert(!seen.has(c.name), 'duplicado ' + c.name); seen.add(c.name);
    assert(c.url && c.skills.length >= 4, c.name);
    for (const s of c.skills) for (const e of s.energy) assert(['Tai', 'Blood', 'Nin', 'Gen', 'Random'].includes(e), c.name + ' ' + s.name);
  }
});
test('nenhuma skill ativa ficou sem nada extraído por engano (alerta se > 12%)', () => {
  let active = 0, empty = 0;
  for (const c of CHARS) c.skills.forEach((s, i) => { const p = E.parseSkill(s, i); if (p.isPassive || p.genericDodge) return; active++; if (!p.dmg && !p.dmgCond && !p.stun && !p.drain && !p.heal && !p.healAlly && !p.dr && !p.drAlly && !p.dd && !p.ddAlly && !p.tags.size) empty++; });
  assert(empty / active < 0.12, `${empty}/${active} skills sem nada extraído`);
});

console.log('\n# Pesos treinados e prioridade de missões');
test('pesos treinados viram o novo padrão; usuário sobrescreve; chaves estranhas são ignoradas', () => {
  E.setTrainedWeights({ synergy: 17, clash: 9, _meta: { x: 1 }, naoExiste: 5, offense: 'abc' });
  assert.strictEqual(E.getDefaultWeights().synergy, 17); assert.strictEqual(E.getWeights().clash, 9); assert.strictEqual(E.getWeights().offense, E.DEFAULT_WEIGHTS.offense); assert(!('naoExiste' in E.getWeights()));
  E.setWeights({ synergy: 3 }); assert.strictEqual(E.getWeights().synergy, 3); assert.strictEqual(E.getWeights().clash, 9);
  E.setTrainedWeights(null); assert.strictEqual(E.getWeights().clash, E.DEFAULT_WEIGHTS.clash); assert.strictEqual(E.getWeights().synergy, 3);
  E.setWeights({});
});
test('esforço esperado: N seguidas custa muito mais que N ao todo; progresso reduz', () => {
  const g = (type, value, isrow, done) => ({ goal: { type, value, isrow }, progress: { done, total: value }, done: false });
  const em = idx.expectedMatches;
  assert(em(g('win', 4, true, 0), 0.55) > 2 * em(g('win', 4, false, 0), 0.55));
  assert(em(g('win', 4, true, 2), 0.55) < em(g('win', 4, true, 0), 0.55));
  assert.strictEqual(em(g('win', 20, false, 20), 0.55), 0);
  assert(em(g('useSkill', 25, false, 15), 0.55) === 5);
});
test('cadeia de pré-requisitos: dependentes e downstream com profundidade', () => {
  const mi = idx.missions.find(m => m.mission.name === 'Sasukes Quest for Power');
  assert(mi.dependents.length >= 4 && mi.downstream.length > mi.dependents.length);
  assert(mi.downstream.every(d => d.mi.requires.length > 0) && mi.downstream.some(d => d.depth >= 2));
  const leaf = idx.missions.find(m => m.dependents.length === 0); assert(leaf && leaf.downstream.length === 0);
});
test('prioridade: ordenada por valor ÷ esforço, só disponíveis, com gateway valendo mais que folha equivalente', () => {
  const rows = idx.priority({ scoreOf: () => 60 });
  assert(rows.length > 0 && rows.every(r => r.mi.status === 'disponivel'));
  for (let i = 1; i < rows.length; i++) assert(rows[i - 1].ratio >= rows[i].ratio);
  const gate = rows.find(r => r.opens > 0); if (gate) assert(gate.chain > 0 && gate.value > gate.own);
});

test('a parte não medida da nota vem do tier (70%) + heurística encolhida (30%), proporcional à confiança', () => {
  let W = null; try { W = require('./data/winrate.js'); } catch (e) { /* sem winrate */ }
  if (!W || !W._model) return;
  const ps = E.scoreChars(CHARS, {}, W);
  const fb = p => { const shrunk = 50 + (p.heuristicScore - 50) * 0.5; return E.winrateScore(p.tier) * 0.7 + shrunk * 0.3; };
  const semMedicao = ps.find(x => x.tierWinrate);   // nenhuma medição utilizável
  if (semMedicao) {
    assert(!semMedicao.winrateConf && semMedicao.tierWinrate.tierOnly && semMedicao.tierWinrate.unlockLevel >= 1);
    assert(Math.abs(semMedicao.baseScore - fb(semMedicao)) < 0.11, `sem medição: ${semMedicao.baseScore} vs ${fb(semMedicao).toFixed(1)}`);
  }
  const pouca = ps.find(x => x.lowConfidence);      // medição fraca: mistura proporcional
  if (pouca) {
    const c = pouca.winrateConf, esperado = E.winrateScore(pouca.winrate) * c + fb(pouca) * (1 - c);
    assert(Math.abs(pouca.baseScore - esperado) < 0.11, `pouca medição: ${pouca.baseScore} vs ${esperado.toFixed(1)}`);
    assert(Math.abs(pouca.baseScore - pouca.heuristicScore) > 0.5, 'a heurística não pode mandar na nota de quem tem pouca medição');
  }
  const muita = ps.find(x => x.winrateConf >= 0.7);
  if (muita) { const c = muita.winrateConf, esperado = E.winrateScore(muita.winrate) * c + fb(muita) * (1 - c); assert(Math.abs(muita.baseScore - esperado) < 0.11); }
  // sem modelo de tier nenhum (nem _model, nem "expected" por personagem): volta ao comportamento antigo
  const cru = Object.fromEntries(Object.entries(W).filter(([k]) => k !== '_model').map(([k, v]) => [k, { ...v, expected: undefined }]));
  const alvo = ps.find(x => x.winrateConf >= 0.7) || ps[0];
  const sem = E.scoreChars(CHARS, {}, cru).find(x => x.name === alvo.name);
  assert(!sem.tier, 'sem modelo de tier não há expectativa');
  assert(Math.abs(sem.baseScore - (sem.heuristicScore * (1 - sem.winrateConf) + E.winrateScore(sem.winrate) * sem.winrateConf)) < 0.11);
});

console.log('\n# Captura do time adversário (extração tolerante)');
{
  const OB = require('./scripts/watch-matches.js');
  const meu = [CHARS[0].name, CHARS[1].name, CHARS[2].name], dele = [CHARS[3].name, CHARS[4].name, CHARS[5].name];
  test('acha os dois trios em qualquer formato (strings ou objetos, em qualquer profundidade)', () => {
    const estado = { battle: { p1: { chars: meu.map(name => ({ name, hp: 100 })) }, p2: { chars: dele } }, lixo: [1, 2, 3], turno: 4 };
    const trios = OB.extrairTimes(estado);
    assert.strictEqual(trios.length, 2);
    assert(trios.some(t => t.join('|') === meu.join('|')) && trios.some(t => t.join('|') === dele.join('|')));
  });
  test('lê players[].team no formato real do jogo (char0/char1/char2) e separa o meu do dele', () => {
    const estado = { matchType: 'Quick', players: [
      { playerId: 'jogador1', team: { char0: { name: meu[0], health: 50 }, char1: { name: meu[1] }, char2: { name: meu[2] } } },
      { playerId: 'jogador2', team: { char0: { name: dele[0], health: 45 }, char1: { name: dele[1] }, char2: { name: dele[2] } } },
    ] };
    const r = OB.timesDaBatalha(estado, 'Jogador1');
    assert.deepStrictEqual(r.meu, meu); assert.deepStrictEqual(r.dele, dele);
    assert.strictEqual(r.adversario, 'jogador2'); assert.strictEqual(r.matchType, 'Quick');
  });
  test('ignora listas que não são de personagens', () => {
    assert.strictEqual(OB.extrairTimes({ a: ['x', 'y', 'z'], b: [1, 2, 3], c: { d: ['Nome Inexistente', 'Outro', 'Mais'] } }).length, 0);
  });
}

console.log('\n# Margem de erro das notas');
test('margem maior para quem tem pouca medição; time tem margem menor que a média dos três', () => {
  let W = null; try { W = require('./data/winrate.js'); } catch (e) { /* sem winrate */ }
  if (!W || !W._model) return;
  const ps = E.scoreChars(CHARS, {}, W);
  const bom = ps.find(p => p.winrateConf >= 0.7), fraco = ps.find(p => !p.winrateConf);
  assert(bom && fraco && bom.margin > 0 && fraco.margin > 0);
  const trio = ps.slice(0, 3), r = E.scoreTeam(trio);
  const media = (trio[0].margin + trio[1].margin + trio[2].margin) / 3;
  assert(r.margin > 0 && r.margin < media, `margem do time ${r.margin} deveria ser menor que ${media.toFixed(1)}`);
});
test('sem modelo de winrate a margem ainda existe (usa o padrão)', () => {
  const p = E.scoreChars(CHARS, {}, null)[0];
  assert(p.margin > 0);
});

console.log('\n# Leitura de habilidades: buracos encontrados pela cobertura (scripts/skill-coverage.js)');
test('"removing/removed 1 chakra" conta como dreno (o parser só via "remove")', () => {
  const p = skillOf('Hyuuga Neji', 'Eight Trigram Sixty-Four Palms');
  assert(p.drain >= 1, 'dreno não lido: ' + p.drain);
  assert(skillOf('Orochimaru', 'Kusanagi').drain >= 1);
  assert(parse('Removes 2 random chakra from one enemy.').drain >= 2);
  assert.strictEqual(parse('The user gains 1 random chakra.').drain, 0);   // ganhar não é drenar
});
test('efeito em área sem dano (stun/custo em todos os inimigos) marca área', () => {
  const shika = skillOf('Nara Shikamaru', 'Shadow Imitation');
  assert(shika.aoe && shika.tags.has('stunAoe'), 'stun em área não marcado');
  const zabuza = skillOf('Momochi Zabuza', 'Hidden Mist Technique');
  assert(zabuza.aoe, 'custo extra em todos os inimigos não marcou área');
  assert(!parse('Deals 20 damage to one enemy.').aoe);
});
test('"heals an ally for 25 points" conta como cura', () => {
  const p = skillOf('Uzumaki Kushina', 'Life Transfer');
  assert(p.healAlly >= 20, 'cura em aliado não lida: ' + p.healAlly);
  assert(parse('Heals one ally for 30 points.').healAlly >= 30);
});

console.log('\n# Diário: consolidação dos resultados por time');
{
  const R = require('./js/results.js');
  const team = ['A', 'B', 'C'];
  const agg = obs => R.aggregate({ observed: obs.map((o, i) => ({ at: '2026-09-2' + i + 'T10:00:00Z', team, type: 'ladder', ...o })) }).rows[0];
  test('registro que junta vitórias e derrotas conta as duas e não vira sequência', () => {
    const r = agg([{ result: 'mixed', win: 4, lose: 3, gap: true, gapMin: 870 }]);
    assert.strictEqual(r.win, 4); assert.strictEqual(r.lose, 3); assert.strictEqual(r.games, 7);
    assert.strictEqual(r.maxStreak, 1); assert.strictEqual(r.gaps, 1);
  });
  test('várias vitórias seguidas sem derrota contam como sequência', () => {
    const r = agg([{ result: 'win', win: 3, lose: 0 }, { result: 'win', win: 2, lose: 0 }]);
    assert.strictEqual(r.maxStreak, 5); assert.strictEqual(r.wr, 100);
  });
  test('derrota quebra a sequência e "sem resultado" não conta partida', () => {
    const r = agg([{ result: 'win', win: 2, lose: 0 }, { result: 'lose', win: 0, lose: 1 }, { result: null, win: 0, lose: 0 }, { result: 'win', win: 1, lose: 0 }]);
    assert.strictEqual(r.maxStreak, 2); assert.strictEqual(r.games, 4); assert.strictEqual(r.unknown, 1);
  });
  test('acumulado só de vitórias não infla a sequência (ordem desconhecida)', () => {
    const r = agg([{ result: 'win', win: 5, lose: 0, gap: true }]);
    assert.strictEqual(r.win, 5); assert.strictEqual(r.maxStreak, 1);
  });
}

console.log('\n# Observador: histórico do perfil (fonte principal do resultado)');
{
  const OB = require('./scripts/watch-matches.js');
  const g = (id, at, type, result, opp) => ({ historicId: id, at, type, result, opponent: opp || 'alguem' });
  test('partida nova do histórico entra com resultado, tipo e adversário', () => {
    const res = [];
    const novos = OB.mergeHistory(res, [g('b1', '2026-09-22T14:00:00Z', 'quick', 'win', 'Gkasem')], () => ['A', 'B', 'C']);
    assert.strictEqual(novos.length, 1); assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].result, 'win'); assert.strictEqual(res[0].win, 1); assert.strictEqual(res[0].lose, 0);
    assert.strictEqual(res[0].opponent, 'Gkasem'); assert.deepStrictEqual(res[0].team, ['A', 'B', 'C']);
  });
  test('registro sem resultado é completado, não duplicado', () => {
    const res = [{ at: '2026-09-22T14:01:00Z', type: 'quick', team: ['A', 'B', 'C'], result: null, win: 0, lose: 0 }];
    OB.mergeHistory(res, [g('b2', '2026-09-22T14:00:00Z', 'quick', 'lose')], () => null);
    assert.strictEqual(res.length, 1); assert.strictEqual(res[0].result, 'lose'); assert.strictEqual(res[0].lose, 1); assert.strictEqual(res[0].historicId, 'b2');
  });
  test('a mesma partida não entra duas vezes', () => {
    const res = [];
    const games = [g('b3', '2026-09-22T14:00:00Z', 'ladder', 'win')];
    OB.mergeHistory(res, games, () => null); OB.mergeHistory(res, games, () => null);
    assert.strictEqual(res.length, 1);
  });
  test('partida distante no tempo não é confundida com outra', () => {
    const res = [{ at: '2026-09-22T14:00:00Z', type: 'quick', team: ['A', 'B', 'C'], result: null, win: 0, lose: 0 }];
    OB.mergeHistory(res, [g('b4', '2026-09-22T15:00:00Z', 'quick', 'win')], () => null);
    assert.strictEqual(res.length, 2);
  });
  test('resultado do histórico alimenta o diário (vitórias, derrotas e sequência)', () => {
    const R = require('./js/results.js');
    const res = [];
    OB.mergeHistory(res, [g('c1', '2026-09-22T14:00:00Z', 'quick', 'win'), g('c2', '2026-09-22T14:05:00Z', 'quick', 'win'), g('c3', '2026-09-22T14:10:00Z', 'quick', 'lose')], () => ['A', 'B', 'C']);
    const row = R.aggregate({ observed: res }).rows[0];
    assert.strictEqual(row.win, 2); assert.strictEqual(row.lose, 1); assert.strictEqual(row.maxStreak, 2); assert.strictEqual(row.quick, 3);
  });
}

console.log('\n# Observador: dedução de resultado de quick match pelas missões (reserva)');
{
  const OB = require('./scripts/watch-matches.js');
  const mk = (row, tot) => ({ 'The Experienced Rock Shinobi': { isCompleted: false, isAvailable: true, isLevelAvailable: true, progress: [{ text: `Win 3 in a row (${row}/3)`, isCompleted: false }, { text: `Win 20 (${tot}/20)`, isCompleted: false }] } });
  const team = ['Kurotsuchi (S)', 'Karin (S)', 'Kankuro (S)'];
  const d = (a, b, t) => OB.deduce(OB.snapshot(a, 'x'), OB.snapshot(b, 'x'), t || team);
  test('sequência subiu -> vitória, com a mudança registrada', () => { const r = d(mk(1, 5), mk(2, 6)); assert.strictEqual(r.result, 'win'); assert(r.changes.some(c => c.inRow && c.from === 1 && c.to === 2)); });
  test('sequência zerou -> derrota', () => { assert.strictEqual(d(mk(2, 6), mk(0, 6)).result, 'lose'); });
  test('salto de 3 no "vencer 20" = 3 vitórias desde a última leitura', () => { const r = d(mk(0, 6), mk(0, 9)); assert.strictEqual(r.result, 'win'); assert.strictEqual(r.wins, 3); });
  test('tinha "vencer 20" para subir e não subiu -> derrota', () => { assert.strictEqual(d(mk(0, 6), mk(0, 6)).result, 'lose'); });
  test('time sem objetivo de vitória -> sem resultado', () => { assert.strictEqual(d(mk(0, 6), mk(0, 6), ['Rock Lee', 'Tenten', 'Haku']).result, null); });
  test('sem contador legível não vira prova', () => { const a = { 'The Experienced Rock Shinobi': { isCompleted: false, isAvailable: true, isLevelAvailable: true, progress: [] } }; assert.strictEqual(d(a, a).result, null); });
}

// ---------------------------------------------------------------- servidor local (aba Ferramentas)
(async () => {
  console.log('\n# Servidor local (server.js)');
  const srv = require('./server.js');
  const http = require('http');
  const req = (porta, method, path, headers) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port: porta, method, path, headers }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d })); }); r.on('error', rej); r.end(); });
  let s = null;
  try { s = await srv.start({ porta: 0 }); } catch (e) { failed++; console.log('  ✗ servidor sobe: ' + e.message); }
  if (s) {
    const P = s.porta, host = { host: '127.0.0.1:' + P };
    const check = async (name, fn) => { try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.message || e).toString().split('\n')[0]); } };
    await check('estado responde e lista as tarefas com grupo', async () => { const r = await req(P, 'GET', '/api/estado', host); const j = JSON.parse(r.body); assert.strictEqual(j.app, 'na-team-builder'); assert(Object.keys(j.tarefas).length >= 15); assert(Object.values(j.tarefas).every(t => t.grupo)); });
    await check('serve a página e os dados', async () => { assert.strictEqual((await req(P, 'GET', '/', host)).status, 200); assert.strictEqual((await req(P, 'GET', '/data/version.json', host)).status, 200); });
    await check('nunca serve .env nem sai da pasta', async () => { assert.strictEqual((await req(P, 'GET', '/.env', host)).status, 403); assert.strictEqual((await req(P, 'GET', '/..%2F..%2Fetc%2Fpasswd', host)).status, 403); assert.strictEqual((await req(P, 'GET', '/data/../.env', host)).status, 403); });
    await check('recusa Host estranho, POST sem JSON e origem de outro site', async () => {
      assert.strictEqual((await req(P, 'GET', '/api/estado', { host: 'evil.com' })).status, 403);
      assert.strictEqual((await req(P, 'POST', '/api/tarefas/testes/iniciar', { ...host, 'content-type': 'text/plain' })).status, 415);
      assert.strictEqual((await req(P, 'POST', '/api/tarefas/testes/iniciar', { ...host, 'content-type': 'application/json', origin: 'http://evil.com' })).status, 403);
    });
    await check('tarefa com login não roda sem credenciais', async () => { const r = srv.iniciarTarefa('conta', {}, null); assert.strictEqual(r.erro, 'sem-login'); });
    await check('correção de skill: personagem/skill desconhecidos são recusados sem gravar', async () => {
      const post = (body) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port: P, method: 'POST', path: '/api/overrides', headers: { ...host, 'content-type': 'application/json' } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d })); }); r.on('error', rej); r.end(JSON.stringify(body)); });
      const before = require('fs').statSync(require('path').join(__dirname, 'data', 'skill-overrides.js')).mtimeMs;
      assert.strictEqual((await post({ char: 'Ninguém', skill: 'x', override: { dmg: 1 } })).status, 400);
      assert.strictEqual((await post({ char: CHARS[0].name, skill: 'skill que não existe', override: { dmg: 1 } })).status, 400);
      assert.strictEqual(require('fs').statSync(require('path').join(__dirname, 'data', 'skill-overrides.js')).mtimeMs, before);
    });
    await check('toda tarefa aponta para um script existente', async () => { for (const id of Object.keys(srv.TAREFAS)) for (const p of srv.TAREFAS[id].passos) if (p.script) assert(require('fs').existsSync(require('path').join(__dirname, p.script)), id + ': ' + p.script); });
    s.server.close();
  }
  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed ? 1 : 0);
})();
