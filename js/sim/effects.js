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
 * Simulador - extração de efeitos executáveis a partir do texto de cada skill.
 *
 * Diferente do parser de notas (que agrega valores), aqui cada efeito vira um registro com valores brutos:
 *   { type:'damage', amount, kind:'normal'|'piercing'|'affliction', target:'enemy'|'enemies', turns, cond }
 *   { type:'stun', turns, scope, classes, target }         scope = fração do kit coberta (1 = tudo)
 *   { type:'dr', amount, percent, unpierceable, turns, target:'self'|'ally'|'team' }
 *   { type:'dd', amount, turns, target }   { type:'heal', amount, turns, target }
 *   { type:'invuln', turns, scope, target } { type:'drain', amount } { type:'gain', amount }
 *   { type:'amplify', amount, turns, target } { type:'debuff', amount, turns, target }
 *   { type:'counter', scope, turns, target } { type:'reflect', turns, target } { type:'noDefense', turns, target }
 *   { type:'costUp', turns, target }
 * Flags da skill: uncounterable, ignoreInvuln, requires (nome da skill de preparação), classes, cost, cooldown.
 * O que não é reconhecido é ignorado (o simulador conta quantas skills ficaram vazias).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('../engine.js'));
  else root.NASimEffects = factory(root.NAEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const T = E._text;

  const ALLY_CTX = /(one ally|all allies|an ally|his team|her team|their team|the team|himself or one ally|herself or one ally|allies|ally)/;
  const TEAM_CTX = /(all allies|his team|her team|their team|the team|the whole team|his allies|her allies)/;
  const ENEMY_CTX = /(enem|that target|the target|one target|opponent)/;
  const classesIn = sent => (sent.match(/\b(physical|chakra|mental|melee|ranged|affliction|harmful|helpful|instant|action|control|non-mental|non-physical|non-chakra)\b/g) || []);

  function targetOf(before, sent, kind) {
    // kind: 'buff' (padrão self) ou 'debuff' (padrão enemy)
    if (kind === 'buff') {
      if (TEAM_CTX.test(sent)) return 'team';
      if (ALLY_CTX.test(before) || ALLY_CTX.test(sent.slice(0, 60))) return 'ally';
      return 'self';
    }
    return /all enemies|the enemy team|enemy team|all other enemies/.test(sent) ? 'enemies' : 'enemy';
  }

  function extract(skill, idx) {
    const text = E.cleanText(skill.description);
    const lower = text.toLowerCase();
    const classes = skill.classes || [];
    const isPassive = classes.includes('Passive') || /^passive:/i.test(skill.name || '');
    const energy = skill.energy || [];
    const out = {
      name: skill.name, idx, isPassive, isHidden: !isPassive && idx >= 4,
      cost: { specific: energy.filter(e => e !== 'Random'), random: energy.filter(e => e === 'Random').length },
      cooldown: T.num(skill.cooldown, 0), classes,
      isAction: classes.some(c => /^\*?Action\*?$/.test(c)), isControl: classes.some(c => /^\*?Control\*?$/.test(c)),
      isMental: classes.includes('Mental'), isPhysical: classes.includes('Physical'), isChakra: classes.includes('Chakra'),
      isAffliction: classes.some(c => /^\*?Affliction\*?$/.test(c)), isHelpful: classes.includes('Helpful'),
      effects: [], uncounterable: false, ignoreInvuln: false, requires: null, genericDodge: false, unparsed: false,
    };
    if (T.GENERIC_DODGE.test(text)) { out.genericDodge = true; out.effects.push({ type: 'invuln', turns: 1, scope: 1, target: 'self', cond: 1 }); out.isHelpful = true; return out; }
    let m;
    const sentAt = i => { const [s0, s1] = T.sentenceBounds(lower, i); return { s0, s1, sent: lower.slice(s0, s1), before: lower.slice(s0, i), after: lower.slice(i, s1) }; };
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const ownSkills = (skill._siblings || []).map(norm);
    // alternativas aleatórias ("randomly ... one of ... A / B / C"): cada efeito vale 1/k
    const randomAlt = /randomly|one of the|at random/.test(lower) && (lower.match(/ \/ /g) || []).length >= 2 ? 1 / ((lower.match(/ \/ /g) || []).length + 1) : 1;
    // fator de condição de uma frase: 'skill:<nome>' quando depende de uma skill própria ativa, número caso contrário
    const condMin = (c, r) => (typeof c === 'string' ? c : Math.min(c, r));
    const condFactor = (sent, before, after) => {
      const dm = sent.match(/during '([^']+)'|requires? '([^']+)'|if '([^']+)' is active|while '([^']+)' is active/);
      if (dm) { const k = norm(dm[1] || dm[2] || dm[3] || dm[4]); if (ownSkills.includes(k)) return 'skill:' + k; return 0.5; }
      const b = before || '', a = after || '';
      if (/\b(if|when|instead|each time|whenever|for each|for every|per |after)\b/.test(b) || /\b(if|instead)\b/.test(a.slice(0, 60))) return 0.5;
      return 1;
    };

    // --- dano ---------------------------------------------------------------
    const dmgRe = /(\d+)\s+(additional\s+|extra\s+|more\s+)?(piercing\s+|affliction\s+|unpierceable\s+)?damage(?! reduction)/gi;
    while ((m = dmgRe.exec(text)) !== null) {
      const { s0, sent, before, after } = sentAt(m.index);
      if (/^\d+\s+(?:non-\w+\s+)?less\b/.test(after) || /\bless\s*$/.test(before)) continue;
      if (/\b(will|to|and)\s+(take|takes|receive|receives|suffer|suffers)\s+$/.test(before) && !ENEMY_CTX.test(before) && !/they|them/.test(before)) continue; // auto-dano
      if (/(take|takes|taking|receive|receives|receiving)\s+(an?\s+)?(\d+\s+)?(additional|extra|more)\s*$/.test(before)) continue; // amplificação (tratada abaixo)
      const amount = T.num(m[1], 0); if (!amount) continue;
      const cond = condMin(m[2] ? 0.5 : condFactor(sent, before, after), randomAlt);
      const kind = /affliction/.test(m[3] || '') || out.isAffliction ? 'affliction' : /piercing/.test(m[3] || '') ? 'piercing' : 'normal';
      const clause = T.clauseAround(sent, m.index - s0);
      const turns = /(each|every) turn/.test(sent) && /permanent/.test(sent) ? 4 : T.turnsIn(clause);
      // "20 damage to one enemy and 10 damage to all other enemies"
      // "to all enemies" logo após, ou a frase inteira fala de todos os inimigos e o dano é "to them"
      const target = /all other enemies/.test(after) ? 'others' : (/all enemies|enemy team|the enemy team/.test(after.slice(0, 50)) || (/all enemies|enemy team|the enemy team/.test(sent) && !/one enemy|one target|an enemy/.test(sent))) ? 'enemies' : 'enemy';
      out.effects.push({ type: 'damage', amount, kind, target, turns: Math.min(turns, 5), cond });
    }
    const stealHp = lower.match(/steal(?:ing|s)?\s+(\d+)\s+health/);
    if (stealHp) { out.effects.push({ type: 'damage', amount: T.num(stealHp[1], 0), kind: out.isAffliction ? 'affliction' : 'normal', target: 'enemy', turns: 1, cond: false }); out.effects.push({ type: 'heal', amount: T.num(stealHp[1], 0), turns: 1, target: 'self' }); }
    const pct = lower.match(/(\d+)%\s+of\s+(?:one enemy's|their|the target's|an enemy's)\s+(current|maximum|max|total)?\s*health\s+as\s+damage/);
    if (pct) out.effects.push({ type: 'damage', amount: Math.round(T.num(pct[1], 0) / 100 * (/current/.test(pct[2] || '') ? 55 : 100)), kind: 'affliction', target: 'enemy', turns: 1, cond: false });

    // --- stun -----------------------------------------------------------------
    const stunRe = /(?<![a-z])stun(s|ned|ning)?(?![a-z])|unable to (use|perform) (a |any |their |new )?skills?|cannot use (a |any |their )?skills?/gi;
    while ((m = stunRe.exec(text)) !== null) {
      const { sent, before } = sentAt(m.index);
      if (/(ignore|ignores|ignoring|cannot be|unable to be|immune to|will not be|not be)[^.]{0,25}$/.test(before)) continue;
      if (/(ally|allies|team|himself|herself|themselves)[^.]{0,20}$/.test(before) && !/enem/.test(before)) continue;
      if (/(if|when|while|is|being|are)\s*$/.test(before) && /stunned/.test(m[0]) && !/enem/.test(sent)) continue;
      const scope = T.partialFactor(sent);
      out.effects.push({ type: 'stun', turns: Math.min(T.turnsIn(sent), 4), scope, classes: classesIn(sent), target: /all enemies|enemy team|the enemy team/.test(sent) ? 'enemies' : 'enemy', cond: condMin(condFactor(sent, before, ''), randomAlt) });
    }
    // --- chakra ---------------------------------------------------------------
    const drainRe = /(steal|remove|absorb|drain|lose|loses|losing)\w*\s+(?:them\s+|from them\s+|all of\s+)?(?:[^.]{0,45}?\s)?(\d+|one|two|three|all)\s+(?:random\s+|non-\w+\s+|[a-z]+\s+)?(?:or\s+[a-z]+\s+)?(?:and\s+\d+\s+[a-z]+\s+)?chakra/gi;
    while ((m = drainRe.exec(text)) !== null) {
      const { sent, before } = sentAt(m.index);
      if (/^lo/.test(m[1].toLowerCase()) && !/(enem|that (enemy|character|target)|they will|target)/.test(sent)) continue;
      if (/gain/.test(sent.slice(0, m.index))) continue;
      let v = T.num(m[2], 1); if (/and \d+ [a-z]+ chakra/.test(m[0])) v += 1;
      out.effects.push({ type: 'drain', amount: v, steal: /^(steal|absorb)/i.test(m[1]), cond: condMin(condFactor(sent, before, ''), randomAlt) });
    }
    const gain = lower.match(/gain(?:s|ing)?\s+(\d+|one|two)\s+(?:random\s+|[a-z]+\s+)?chakra/);
    if (gain) out.effects.push({ type: 'gain', amount: T.num(gain[1], 1), turns: /every turn|each turn|permanently/.test(lower) ? 4 : 1 });
    if (/cost\w*[^.]{0,40}(additional|more|increase)/.test(lower) && /enem/.test(lower)) out.effects.push({ type: 'costUp', turns: T.turnsIn(lower), target: 'enemies' });

    // --- defesas / cura --------------------------------------------------------
    const drRe = /(\d+)(%|\s+points? of|\s+point of)?\s+(permanent\s+)?(unpierceable\s+)?damage reduction/gi;
    while ((m = drRe.exec(text)) !== null) {
      const { sent, before } = sentAt(m.index);
      if (/(ignore|ignores|cannot|unable to|reduces?|removes?|loses?|less)[^.]{0,25}$/.test(before)) continue;
      out.effects.push({ type: 'dr', amount: T.num(m[1], 0), percent: !!(m[2] && m[2].includes('%')), unpierceable: !!m[4], turns: /permanent/.test(sent) ? 99 : Math.min(T.turnsIn(sent), 5), target: targetOf(before, sent, 'buff'), cond: condMin(condFactor(sent, before, ''), randomAlt) });
    }
    const ddRe = /(\d+)\s+(points? of\s+)?(permanent\s+)?destructible defense/gi;
    while ((m = ddRe.exec(text)) !== null) {
      const { sent, before } = sentAt(m.index);
      if (/(ignore|ignores|removes?|destroys?|lose|loses)[^.]{0,25}$/.test(before)) continue;
      out.effects.push({ type: 'dd', amount: T.num(m[1], 0), turns: (m[3] || /permanent/.test(sent)) ? 99 : Math.min(T.turnsIn(sent), 5), perTurn: /every turn|each turn/.test(sent), target: targetOf(before, sent, 'buff'), cond: condMin(condFactor(sent, before, ''), randomAlt) });
    }
    const healRe = /heal(?:s|ed|ing)?\s+([^.]{0,40}?)(\d+)\s+(?:points? of\s+)?health/gi;
    while ((m = healRe.exec(text)) !== null) {
      const { sent, before } = sentAt(m.index);
      if (/(cannot|unable to|prevent\w*|no longer)[^.]{0,20}$/.test(before)) continue;
      const target = /(all allies|team)/.test(m[1]) || TEAM_CTX.test(sent) ? 'team' : /(ally)/.test(m[1]) || ALLY_CTX.test(before) ? 'ally' : 'self';
      out.effects.push({ type: 'heal', amount: T.num(m[2], 0), turns: /every turn|each turn|permanently/.test(sent) ? 4 : 1, target, cond: condMin(condFactor(sent, before, ''), randomAlt) });
    }
    const invRe = /invulnerab/gi;
    while ((m = invRe.exec(text)) !== null) {
      const { sent, before } = sentAt(m.index);
      if (/ignores?\s+$/.test(before) || /ignore\w*[^.]{0,15}$/.test(before)) { out.ignoreInvuln = true; continue; }
      if (/(cannot|unable to|prevent\w*|removes?|not be)[^.]{0,30}$/.test(before)) continue;
      if (/invulnerable to (friendly|helpful)/.test(sent) && /enem/.test(sent)) { out.effects.push({ type: 'antiHeal', turns: T.turnsIn(sent), target: 'enemies' }); continue; }
      const scopeSent = lower.slice(m.index, m.index + 60);
      const scope = /invulnerab\w*\s+to\s+/.test(scopeSent) ? T.partialFactor(scopeSent.replace(/invulnerab\w*\s+to\s+/, '')) : 1;
      out.effects.push({ type: 'invuln', turns: Math.min(T.turnsIn(sent), 4), scope, classes: scope < 1 ? classesIn(scopeSent) : [], target: targetOf(before, sent, 'buff'), cond: condMin(condFactor(sent, before, ''), randomAlt) });
    }
    // --- amplificação / debuff / sem defesa ------------------------------------
    const ampRe = /(take|takes|taking|receive|receives|receiving)\s+(an?\s+)?(\d+)\s+(additional|extra|more)\s+damage/gi;
    while ((m = ampRe.exec(text)) !== null) { const { sent, before } = sentAt(m.index); out.effects.push({ type: 'amplify', amount: T.num(m[3], 0), turns: /permanent|rest of the game/.test(sent) ? 99 : Math.min(T.turnsIn(sent), 5), affliction: /affliction skills/.test(sent), target: /all enemies|enemy team|the enemy team/.test(sent) ? 'enemies' : 'enemy', cond: condMin(condFactor(sent, before, ''), randomAlt) }); }
    const debRe = /(\d+)\s+(?:non-\w+\s+)?less\s+(?:non-\w+\s+)?damage|deal\w*\s+(\d+)\s+less/gi;
    while ((m = debRe.exec(text)) !== null) { const { sent, before } = sentAt(m.index); if (/enem|that (character|target)|they will|their skills|target/.test(sent) && !/(ally|allies|team)[^.]{0,30}deal/.test(sent)) out.effects.push({ type: 'debuff', amount: T.num(m[1] || m[2], 0), turns: Math.min(T.turnsIn(sent), 5), target: /all enemies|enemy team|the enemy team/.test(sent) ? 'enemies' : 'enemy', cond: condMin(condFactor(sent, before, ''), randomAlt) }); }
    if (/(unable to|cannot) (reduce damage|become invulnerable)/.test(lower)) { const i = lower.search(/(unable to|cannot) (reduce damage|become invulnerable)/); const { sent } = sentAt(i); out.effects.push({ type: 'noDefense', turns: Math.min(T.turnsIn(sent), 5), target: /all enemies|enemy team|the enemy team|enemies/.test(sent) ? 'enemies' : 'enemy' }); }
    // --- contadores -------------------------------------------------------------
    const cRe = /(?<![a-z])counter(s|ed|ing)?(?![a-z])/gi;
    while ((m = cRe.exec(text)) !== null) {
      const { sent, before } = sentAt(m.index);
      if (/(cannot be|can't be|unable to be|ignores?|not be)\s*$/.test(before.slice(-20))) { out.uncounterable = true; continue; }
      const onEnemy = /(that enemy|one enemy|the enemy|enemy's|enemies)/.test(sent) && !/used on (him|her|them)/.test(sent);
      out.effects.push({ type: 'counter', scope: T.partialFactor(sent), turns: Math.min(T.turnsIn(sent), 3), target: onEnemy ? 'enemy' : targetOf(before, sent, 'buff'), cond: condMin(condFactor(sent, before, ''), randomAlt) });
    }
    const rRe = /(?<![a-z])reflect(s|ed|ing)?(?![a-z])/gi;
    while ((m = rRe.exec(text)) !== null) { const { sent, before } = sentAt(m.index); if (/(cannot be|can't be|unable to be|ignores?|not be|or)\s*$/.test(before.slice(-20))) { out.uncounterable = true; continue; } out.effects.push({ type: 'reflect', turns: Math.min(T.turnsIn(sent), 3), target: targetOf(before, sent, 'buff'), cond: condMin(condFactor(sent, before, ''), randomAlt) }); }
    if (/cannot be counter|cannot be reflect/.test(lower)) out.uncounterable = true;
    if (/ignores? invulnerability/.test(lower)) out.ignoreInvuln = true;
    // --- preparação ----------------------------------------------------------------
    const req = text.match(/[Rr]equires? '(.+?)'(?:\.|\s|$)|can only be used (?:during|while) '(.+?)'(?:\.|\s|$)|[Dd]uring '(.+?)'[^.]{0,30}(?:may be used|can be used|will be usable)/);
    if (req && !isPassive) out.requires = norm(req[1] || req[2] || req[3]);
    // normaliza cond: número (probabilidade/escala) ou 'skill:<chave>'
    for (const e of out.effects) { if (typeof e.cond === 'boolean') e.cond = e.cond ? 0.5 : 1; else if (e.cond == null) e.cond = 1; }
    if (out.effects.length === 0 && !isPassive) out.unparsed = true;
    return out;
  }

  function character(char) {
    const names = (char.skills || []).map(s => s.name);
    const skills = (char.skills || []).map((s, i) => extract({ ...s, _siblings: names }, i));
    for (const s of skills) s.key = String(s.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return { name: char.name, skills, base: skills.filter(s => !s.isPassive && !s.isHidden).slice(0, 4), passives: skills.filter(s => s.isPassive) };
  }

  return { extract, character };
});
