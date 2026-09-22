/*
 * ============================================================================
 *  EXPERIMENTO ENCERRADO — leia antes de mexer aqui / CLOSED EXPERIMENT
 * ============================================================================
 *
 *  Este simulador NÃO alimenta as notas do programa. Foi medido em 2026-09-17
 *  contra o winrate oficial (o único gabarito disponível) e deu correlação de
 *  -0,13 — pior que sortear. Fica no repositório como registro do que foi
 *  tentado, não como ferramenta.
 *
 *  POR QUE FALHOU
 *  As mecânicas aqui são aproximadas a partir do TEXTO das habilidades, e o
 *  texto não descreve as regras com a precisão que uma simulação exige. O
 *  leitor (js/core/engine.js) erra ou ignora: acúmulos ("stacks"), cópia de skills,
 *  manipulação de cooldown, condições de gatilho, ordem da fila de efeitos e
 *  transformações que substituem habilidades. Num ranking essas falhas se
 *  diluem; numa simulação turno a turno elas se multiplicam.
 *
 *  O QUE SERIA PRECISO PARA FUNCIONAR
 *  1. Mecânicas curadas à mão, skill por skill (961 delas), num formato que a
 *     máquina execute — não extraídas de texto.
 *  2. Um motor fiel: ordem de fila, invulnerabilidade/counter/reflect,
 *     defesa destrutível, aflição que ignora redução, economia de chakra.
 *  3. Uma IA decente: a atual é gulosa (usa a skill de maior dano possível).
 *     Um jogador ruim faz time bom parecer ruim, o que contamina tudo.
 *  4. Validação partida a partida contra resultados reais. Isso hoje é
 *     possível: o histórico do perfil dá "time A x time B -> vencedor"
 *     (veja scripts/watch-matches.js). Era o que faltava em 2026-09-17.
 *
 *  Com (1) a (3) feitos e (4) mostrando que o simulador acerta o vencedor
 *  acima do acaso, aí sim ele poderia voltar a alimentar as sugestões.
 *
 *  EN: this battle simulator is a closed experiment. Measured against the
 *  official win rate it scored -0.13 (worse than chance), because its
 *  mechanics are approximated from skill *text* and the text is not precise
 *  enough for turn-by-turn simulation. Making it work would require
 *  hand-curated mechanics for all 961 skills, a faithful engine, a decent AI,
 *  and validation against real match outcomes (now collectable from the
 *  profile match history).
 * ============================================================================
 */

/*
 * Simulador - motor de batalha 3v3 + IA gulosa.
 *
 * Regras implementadas (manual "The Basics" + classes de skill):
 *  - 100 de vida por ninja; vitória quando os 3 inimigos chegam a 0.
 *  - Turnos alternados (contador global g). No início do turno o jogador recebe 1 chakra aleatório por
 *    ninja vivo (só 1 no primeiríssimo turno), 25% cada tipo; chakra acumula.
 *  - Cada ninja usa no máximo 1 skill por turno; custo específico + Random (qualquer tipo); cooldown N =
 *    indisponível nos N turnos seguintes do dono.
 *  - Durações "N turnos" = os próximos N turnos do adversário (expira em g + 2N).
 *  - Instant aplica uma vez; Action repete a cada turno do dono (interrompida por stun); Control idem e
 *    acaba se o alvo ficar invulnerável.
 *  - Dano: piercing ignora redução (exceto unpierceable); aflição ignora redução e defesa destrutível;
 *    defesa destrutível absorve antes da vida; amplificação soma; "deals N less" subtrai (não-aflição).
 *  - Invulnerável não é alvo de skills inimigas (total ou por classe); stun bloqueia skills (total ou por
 *    classe); "sem defesa" ignora redução e invulnerabilidade do alvo.
 *  - Contador nega a primeira skill nociva que chegar (escopo por classe); reflexo devolve ao autor.
 *  - Skills com "requires X" só após X ter sido usada recentemente.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./effects.js'));
  else root.NASimBattle = factory(root.NASimEffects);
})(typeof self !== 'undefined' ? self : this, function (SE) {
  'use strict';
  const TYPES = ['Tai', 'Blood', 'Nin', 'Gen'];
  const MAX_TURNS = 80;

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // uma classe de skill é bloqueada por um efeito com lista de classes? (stun/invuln parciais)
  function classHit(skill, classes) {
    if (!classes || !classes.length) return true; // total
    const own = skill.classes.map(c => c.replace(/\*/g, '').toLowerCase());
    for (const c of classes) {
      if (c === 'harmful') { if (!skill.isHelpful) return true; continue; }
      if (c === 'helpful') { if (skill.isHelpful) return true; continue; }
      if (c.startsWith('non-')) { if (!own.includes(c.slice(4))) return true; continue; }
      if (own.includes(c)) return true;
    }
    return false;
  }

  function makeChar(data, side, slot) {
    return { name: data.name, side, slot, hp: 100, alive: true, skills: data.base, ready: data.base.map(() => 0), effects: [], active: {}, ongoing: [] };
  }

  function createBattle(teamA, teamB, seed) {
    const rng = mulberry32(seed || 1);
    const players = [0, 1].map(side => ({ side, chakra: { Tai: 0, Blood: 0, Nin: 0, Gen: 0 }, chars: (side ? teamB : teamA).map((d, i) => makeChar(d, side, i)) }));
    return { g: 0, players, rng, winner: null, log: [] };
  }

  const alive = p => p.chars.filter(c => c.alive);
  const enemyOf = (b, side) => b.players[1 - side];
  const fx = (c, type) => c.effects.filter(e => e.type === type && e.expiresAt > c._g);
  function expire(b) { for (const p of b.players) for (const c of p.chars) { c._g = b.g; c.effects = c.effects.filter(e => e.expiresAt > b.g); } }

  function stunned(c, skill) { return fx(c, 'stun').some(e => classHit(skill, e.classes)); }
  function fullyStunned(c) { return fx(c, 'stun').some(e => !e.classes || !e.classes.length); }
  function invulnTo(c, skill) { if (fx(c, 'noDefense').length) return false; return fx(c, 'invuln').some(e => classHit(skill, e.classes)); }

  function canAfford(pool, cost, extraRandom) {
    const p = { ...pool };
    for (const t of cost.specific) { if (!p[t]) return null; p[t]--; }
    let r = cost.random + (extraRandom || 0);
    const pay = [];
    while (r > 0) { const t = TYPES.slice().sort((a, b2) => p[b2] - p[a])[0]; if (!p[t]) return null; p[t]--; pay.push(t); r--; }
    return p;
  }

  function applyDamage(b, attacker, target, amount, kind, skill) {
    if (!target.alive) return 0;
    let dmg = amount;
    if (kind !== 'affliction') { const deb = fx(attacker, 'debuff').reduce((s, e) => s + e.amount, 0); dmg -= deb; }
    dmg += fx(target, 'amplify').filter(e => !e.affliction || kind === 'affliction').reduce((s, e) => s + e.amount, 0);
    if (dmg <= 0) return 0;
    const noDef = fx(target, 'noDefense').length > 0;
    if (kind !== 'affliction' && !noDef) {
      for (const e of fx(target, 'dr')) { if (kind === 'piercing' && !e.unpierceable) continue; dmg -= e.percent ? Math.round(dmg * e.amount / 100) : e.amount; }
      if (dmg <= 0) return 0;
      for (const e of fx(target, 'dd')) { const take = Math.min(e.amount, dmg); e.amount -= take; dmg -= take; if (dmg <= 0) break; }
      target.effects = target.effects.filter(e => e.type !== 'dd' || e.amount > 0);
    }
    if (dmg <= 0) return 0;
    target.hp -= dmg;
    if (target.hp <= 0) { target.hp = 0; target.alive = false; target.effects = []; target.ongoing = []; }
    return dmg;
  }

  function applyEffect(b, caster, skill, e, targets) {
    const dur = t => b.g + 2 * Math.max(1, t || 1);
    for (const t of targets) {
      if (!t.alive) continue;
      switch (e.type) {
        case 'damage': applyDamage(b, caster, t, e.amount, e.kind, skill); break;
        case 'stun': t.effects.push({ type: 'stun', classes: e.classes && e.classes.length && e.scope < 1 ? e.classes : [], expiresAt: dur(e.turns) }); break;
        case 'dr': t.effects.push({ type: 'dr', amount: e.amount, percent: e.percent, unpierceable: e.unpierceable, expiresAt: e.turns >= 99 ? 9999 : dur(e.turns) }); break;
        case 'dd': t.effects.push({ type: 'dd', amount: e.amount, expiresAt: e.turns >= 99 ? 9999 : dur(e.turns) }); break;
        case 'heal': if (!fx(t, 'antiHeal').length) t.hp = Math.min(100, t.hp + e.amount); break;
        case 'invuln': t.effects.push({ type: 'invuln', classes: e.classes && e.classes.length && e.scope < 1 ? e.classes : [], expiresAt: dur(e.turns) }); break;
        case 'amplify': t.effects.push({ type: 'amplify', amount: e.amount, affliction: !!e.affliction, expiresAt: e.turns >= 99 ? 9999 : dur(e.turns) }); break;
        case 'debuff': t.effects.push({ type: 'debuff', amount: e.amount, expiresAt: dur(e.turns) }); break;
        case 'noDefense': t.effects.push({ type: 'noDefense', expiresAt: dur(e.turns) }); break;
        case 'counter': t.effects.push({ type: 'counter', classes: e.scope < 1 ? [] : [], onEnemy: e.target === 'enemy', expiresAt: dur(e.turns) }); break;
        case 'reflect': t.effects.push({ type: 'reflect', expiresAt: dur(e.turns) }); break;
        case 'antiHeal': t.effects.push({ type: 'antiHeal', expiresAt: dur(e.turns) }); break;
        case 'drain': { const ep = enemyOf(b, caster.side); for (let k = 0; k < e.amount; k++) { const ts = TYPES.filter(x => ep.chakra[x] > 0); if (!ts.length) break; const x = ts[Math.floor(b.rng() * ts.length)]; ep.chakra[x]--; if (e.steal) b.players[caster.side].chakra[x]++; } break; }
        case 'gain': { const own = b.players[caster.side]; for (let k = 0; k < e.amount; k++) own.chakra[TYPES[Math.floor(b.rng() * 4)]]++; break; }
        case 'costUp': { const ep = enemyOf(b, caster.side); ep.costUpUntil = dur(e.turns); break; }
        default: break;
      }
    }
  }

  function resolveTargets(b, caster, skill, e, chosen) {
    const own = b.players[caster.side], enemy = enemyOf(b, caster.side);
    switch (e.target) {
      case 'self': return [caster];
      case 'team': return alive(own);
      case 'ally': return [chosen && chosen.side === caster.side ? chosen : caster];
      case 'enemies': return alive(enemy).filter(t => skill.ignoreInvuln || !invulnTo(t, skill));
      case 'others': return alive(enemy).filter(t => t !== chosen && (skill.ignoreInvuln || !invulnTo(t, skill)));
      default: return chosen && chosen.side !== caster.side && chosen.alive ? [chosen] : [];
    }
  }

  function useSkill(b, caster, si, chosen) {
    const skill = caster.skills[si];
    const own = b.players[caster.side];
    const extra = own.costUpUntil && own.costUpUntil > b.g ? 1 : 0;
    const after = canAfford(own.chakra, skill.cost, extra);
    if (!after) return false;
    own.chakra = after;
    caster.ready[si] = b.g + 2 * (skill.cooldown + 1);
    const maxTurns = Math.max(1, ...skill.effects.map(e => e.turns || 1));
    caster.active[skill.key] = b.g + 2 * Math.min(maxTurns, 4);
    // contador / reflexo no alvo principal (skill nociva)
    if (chosen && chosen.side !== caster.side && !skill.isHelpful && !skill.uncounterable) {
      const ci = chosen.effects.findIndex(e => e.type === 'counter' && e.expiresAt > b.g && !e.onEnemy);
      if (ci >= 0) { chosen.effects.splice(ci, 1); return true; }
      const ri = chosen.effects.findIndex(e => e.type === 'reflect' && e.expiresAt > b.g);
      if (ri >= 0) { chosen.effects.splice(ri, 1); for (const e of skill.effects) if (e.type === 'damage' || e.type === 'stun' || e.type === 'debuff') applyEffect(b, chosen, skill, { ...e, turns: 1 }, [caster]); return true; }
    }
    // contador aplicado pelo autor no inimigo ("if that enemy uses a new skill, they will be countered"): tratado como stun curto
    for (const e0 of skill.effects) {
      const f = condValue(b, caster, e0);
      if (f <= 0) continue;
      const e = e0.type === 'damage' || e0.type === 'heal' || e0.type === 'dd' || e0.type === 'dr' || e0.type === 'amplify' || e0.type === 'debuff' ? { ...e0, amount: Math.round(e0.amount * f) } : (f >= 1 || b.rng() < f ? e0 : null);
      if (!e || !e.amount && e.type === 'damage') continue;
      let targets;
      if (e.type === 'counter' && e.target === 'enemy') { targets = chosen ? [chosen] : []; for (const t of targets) t.effects.push({ type: 'stun', classes: [], expiresAt: b.g + 2 }); continue; }
      targets = resolveTargets(b, caster, skill, e, chosen);
      if (!targets.length) continue;
      if (e.type === 'damage' && e.turns > 1) { caster.ongoing.push({ skill, e, targets: targets.map(t => t), remaining: e.turns - 1 }); }
      if ((e.type === 'heal' || e.type === 'gain') && e.turns > 1) caster.ongoing.push({ skill, e, targets, remaining: e.turns - 1 });
      applyEffect(b, caster, skill, e, targets);
    }
    return true;
  }

  // fator de condição: 1 (incondicional), 0.5 (condição genérica: valor esperado), 1/k (alternativa aleatória),
  // 'skill:<x>' -> 1 se a skill própria x estiver ativa no autor, senão 0
  function condValue(b, caster, e) {
    const c = e.cond == null ? 1 : e.cond;
    if (typeof c === 'string') return caster.active[c.slice(6)] > b.g ? 1 : 0;
    return c;
  }

  function tickOngoing(b, p) {
    for (const c of alive(p)) {
      const keep = [];
      for (const o of c.ongoing) {
        if (o.remaining <= 0) continue;
        const blocked = o.skill.isAction && stunned(c, o.skill);
        if (!blocked) {
          const targets = o.targets.filter(t => t.alive && (o.e.type !== 'damage' || o.skill.ignoreInvuln || !invulnTo(t, o.skill) || !o.skill.isControl));
          if (o.skill.isControl && o.e.type === 'damage' && targets.length < o.targets.filter(t => t.alive).length) continue; // contato quebrado
          applyEffect(b, c, o.skill, o.e, targets);
          o.remaining--;
        }
        if (o.remaining > 0) keep.push(o);
      }
      c.ongoing = keep;
    }
  }

  // ------------------------------------------------------------------ IA
  // ameaça de um personagem: melhor dano esperado que ele pode causar no próximo turno (sem olhar chakra)
  function threatOf(b, c) {
    if (c._threatG === b.g && c._threat != null) return c._threat;
    let best = 0;
    if (c.alive && !fullyStunned(c)) c.skills.forEach((skill, si) => {
      if (c.ready[si] > b.g + 1 || stunned(c, skill)) return;
      if (skill.requires && !(c.active[skill.requires] > b.g)) return;
      let d = 0;
      for (const e of skill.effects) { const f = condValue(b, c, e); if (e.type === 'damage' && f > 0) d += e.amount * f * (e.target === 'enemies' ? 2.2 : e.target === 'others' ? 1.6 : 1) * Math.min(e.turns || 1, 2); }
      if (d > best) best = d;
    });
    c._threatG = b.g; c._threat = best; return best;
  }
  const totalThreat = (b, side) => alive(enemyOf(b, side)).reduce((s, c) => s + threatOf(b, c), 0);

  function evalAction(b, caster, si, chosen) {
    const skill = caster.skills[si];
    const own = b.players[caster.side], enemy = enemyOf(b, caster.side);
    const enemies = alive(enemy), allies = alive(own);
    let v = 0;
    for (const e of skill.effects) {
      const f = condValue(b, caster, e);
      if (f <= 0) continue;
      const targets = resolveTargets(b, caster, skill, e, chosen);
      if (!targets.length) continue;
      const scaled = f;
      switch (e.type) {
        case 'damage': for (const t of targets) { let d = e.amount * scaled; if (e.kind !== 'affliction' && !fx(t, 'noDefense').length) { for (const r of fx(t, 'dr')) if (!(e.kind === 'piercing' && !r.unpierceable)) d -= r.percent ? d * r.amount / 100 : r.amount; d = Math.max(0, d); const dd = fx(t, 'dd').reduce((s, x) => s + x.amount, 0); d = Math.max(0, d - Math.min(dd, d) * 0.5); } const total = d * Math.min(e.turns || 1, 3); v += total + (t.hp <= total ? 30 : 0) + (100 - t.hp) * 0.12; } break;
        // controle vale o dano que nega: stun em quem ameaça mais; invulnerabilidade vale o que iria chegar
        case 'stun': for (const t of targets) if (!fullyStunned(t)) v += (6 + threatOf(b, t) * 0.9) * (e.turns || 1) * (e.scope || 1) * scaled; break;
        case 'heal': for (const t of targets) { const miss = 100 - t.hp; if (miss >= 15) v += Math.min(e.amount * scaled, miss) * 0.9; } break;
        case 'dd': for (const t of targets) v += Math.min(e.amount, 60) * (t.hp < 60 ? 0.7 : 0.4); break;
        case 'dr': for (const t of targets) v += (e.percent ? e.amount * 0.3 : e.amount) * Math.min(e.turns || 1, 3) * 0.5; break;
        case 'invuln': { const incoming = totalThreat(b, caster.side); for (const t of targets) { const danger = t.hp <= Math.min(incoming, 100) ? 1 : t.hp <= 60 ? 0.6 : 0.2; v += Math.min(incoming, 70) * danger * (e.scope || 1) * (e.target === 'team' ? 1.6 : 1); } break; }
        case 'drain': { const ep = enemyOf(b, caster.side); const pool = TYPES.reduce((s, x) => s + ep.chakra[x], 0); v += (pool <= 3 ? 12 : 6) * e.amount; break; }
        case 'gain': v += 6 * e.amount; break;
        case 'amplify': v += 6 * e.amount * targets.length; break;
        case 'debuff': for (const t of targets) v += Math.min(e.amount, threatOf(b, t)) * 0.8 * Math.min(e.turns || 1, 2); break;
        case 'noDefense': for (const t of targets) v += 8 + fx(t, 'dr').reduce((s, x) => s + (x.percent ? 10 : x.amount), 0) + fx(t, 'dd').reduce((s, x) => s + x.amount, 0) * 0.5; break;
        case 'counter': v += 6 + Math.max(0, ...enemies.map(t => threatOf(b, t))) * 0.5; break;
        case 'reflect': v += 6 + Math.max(0, ...enemies.map(t => threatOf(b, t))) * 0.4; break;
        case 'costUp': v += 8; break;
        case 'antiHeal': v += 6; break;
        default: break;
      }
    }
    const cost = skill.cost.specific.length + skill.cost.random;
    return v / (1 + 0.15 * cost) * (0.85 + 0.3 * b.rng());
  }

  function chooseActions(b, p) {
    const enemy = enemyOf(b, p.side);
    const actions = [];
    const order = alive(p).sort(() => b.rng() - 0.5);
    let pool = { ...p.chakra };
    const extra = p.costUpUntil && p.costUpUntil > b.g ? 1 : 0;
    for (const c of order) {
      if (fullyStunned(c)) continue;
      let best = null;
      c.skills.forEach((skill, si) => {
        if (c.ready[si] > b.g || stunned(c, skill)) return;
        if (skill.requires && !(c.active[skill.requires] > b.g)) return;
        if (skill.effects.length && skill.effects.every(e => condValue(b, c, e) <= 0)) return;
        if (!canAfford(pool, skill.cost, extra)) return;
        const harmful = skill.effects.some(e => ['damage', 'stun', 'drain', 'amplify', 'debuff', 'noDefense', 'costUp', 'antiHeal'].includes(e.type) && e.target !== 'self');
        const cands = harmful ? alive(enemy).filter(t => skill.ignoreInvuln || !invulnTo(t, skill)) : (skill.effects.some(e => e.target === 'ally') ? alive(p) : [c]);
        if (harmful && !cands.length) return;
        for (const t of cands) { const v = evalAction(b, c, si, t); if (v > 3 && (!best || v > best.v)) best = { c, si, t, v }; }
      });
      if (best) { pool = canAfford(pool, best.c.skills[best.si].cost, extra); actions.push(best); }
    }
    return actions;
  }

  function playTurn(b) {
    const side = b.g % 2, p = b.players[side];
    expire(b);
    const n = b.g === 0 ? 1 : alive(p).length;
    for (let i = 0; i < n; i++) p.chakra[TYPES[Math.floor(b.rng() * 4)]]++;
    tickOngoing(b, p);
    if (!alive(enemyOf(b, side)).length) { b.winner = side; return; }
    for (const a of chooseActions(b, p)) { if (a.c.alive) useSkill(b, a.c, a.si, a.t); }
    if (!alive(enemyOf(b, side)).length) b.winner = side;
    else if (!alive(p).length) b.winner = 1 - side;
    b.g++;
  }

  function simulate(teamA, teamB, seed) {
    const b = createBattle(teamA, teamB, seed);
    while (b.winner === null && b.g < MAX_TURNS) playTurn(b);
    if (b.winner === null) { // desempate por vida restante
      const hp = s => alive(b.players[s]).reduce((t, c) => t + c.hp, 0);
      b.winner = hp(0) === hp(1) ? -1 : hp(0) > hp(1) ? 0 : 1;
    }
    return { winner: b.winner, turns: b.g };
  }

  return { simulate, createBattle, playTurn, applyDamage, canAfford, classHit, build: SE.character };
});
