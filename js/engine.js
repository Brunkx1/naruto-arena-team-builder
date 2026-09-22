/*
 * NA Team Builder - motor de análise
 *
 * Funciona no navegador (window.NAEngine) e no Node (module.exports).
 *
 * Pipeline:
 *   1. parseSkill()     - lê a descrição em inglês de cada habilidade e extrai
 *                         números/efeitos (dano, stun, cura, redução, chakra...).
 *   2. profileChar()    - agrega as habilidades num perfil por personagem
 *                         (ofensa, controle, defesa, suporte, economia de chakra).
 *   3. scoreChars()     - normaliza os perfis e gera uma nota 0-100 por personagem.
 *   4. scoreTeam()      - nota de um trio: soma das notas + cobertura de papéis
 *                         + sinergias - contenção de chakra - excesso de setup.
 *   5. suggestTeams()   - busca combinatória (com poda) devolvendo os melhores trios.
 *
 * Regras do jogo usadas (manual "The Basics"):
 *   - 3 ninjas por time; a cada turno recebe-se 1 chakra aleatório por ninja vivo,
 *     25% de chance para cada tipo (Tai, Blood, Nin, Gen). Custo "Random" aceita
 *     qualquer tipo. Logo, dois personagens que dependem do mesmo tipo específico
 *     competem pelo mesmo ~0,75 chakra/turno -> "choque de chakra".
 *   - Piercing ignora redução de dano; Affliction ignora redução e defesa destrutível.
 *   - Stun impede o uso de habilidades; Invulnerável não pode ser alvo de inimigos.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.NAEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENERGY_TYPES = ['Tai', 'Blood', 'Nin', 'Gen'];
  const SUPPLY_PER_TYPE = 0.75; // 3 chakras/turno * 25%

  // Pesos padrão. Ajustáveis pela UI/CLI via setWeights().
  const DEFAULT_WEIGHTS = {
    // nota individual (componentes normalizados 0..1, somados e reescalados p/ 0-100)
    offense: 1.0,
    control: 0.8,
    defense: 0.7,
    support: 0.6,
    economy: 0.5,     // custo baixo / flexibilidade de chakra / ganho de chakra
    tempo: 0.3,       // quantas habilidades baratas e sem setup o personagem tem
    hiddenSkills: 0.5, // multiplicador p/ habilidades ocultas/substitutas (índice >= 4)
    passive: 0.8,     // multiplicador p/ passivas
    // nota de time
    roleCoverage: 12, // bônus máximo por cobrir dano + controle + defesa/suporte
    synergy: 10,      // bônus máximo por pares sinérgicos
    clash: 22,        // penalidade máxima por contenção de chakra
    setupPenalty: 6,  // penalidade se o time inteiro depende de setup
  };

  let BASE = { ...DEFAULT_WEIGHTS };   // padrão efetivo: DEFAULT_WEIGHTS, sobrescrito pelos pesos treinados (se houver)
  let USER = {};
  let W = { ...BASE };
  function setWeights(w) { USER = { ...(w || {}) }; W = { ...BASE, ...USER }; }
  // pesos de time treinados por scripts/train-synergy.js --aplicar (data/trained-weights.js); null = voltar aos padrões
  function setTrainedWeights(tw) {
    BASE = { ...DEFAULT_WEIGHTS };
    if (tw) for (const k of Object.keys(tw)) if (k in DEFAULT_WEIGHTS && Number.isFinite(+tw[k])) BASE[k] = +tw[k];
    W = { ...BASE, ...USER };
  }
  const getDefaultWeights = () => ({ ...BASE });
  function getWeights() { return { ...W }; }

  // Correções manuais por skill (data/skill-overrides.js):
  //   { "Nara Shikamaru": { "Shadow Imitation": { "stun": 2.2, "tags": ["+stunAoe", "-setup"], "nota": "..." } } }
  // Campos numéricos/booleanos substituem o que o parser extraiu; "tags" adiciona (+x) ou remove (-x).
  let OVERRIDES = {};
  function setOverrides(o) { OVERRIDES = o || {}; }
  function applyOverride(charName, p) {
    const byChar = OVERRIDES[charName];
    const ov = byChar && (byChar[p.name] || byChar['*']);
    if (!ov) return;
    for (const [k, v] of Object.entries(ov)) {
      if (k === 'tags' && Array.isArray(v)) { for (const x of v) { if (x[0] === '-') p.tags.delete(x.slice(1)); else p.tags.add(x.replace(/^\+/, '')); } }
      else if (k !== 'nota' && k !== 'note' && k in p) p[k] = v;
    }
    p.overridden = true;
  }

  // ---------------------------------------------------------------------------
  // 1. Parsing de habilidades
  // ---------------------------------------------------------------------------

  const GENERIC_DODGE = /^this skill makes .{0,60}invulnerable/i;
  const NEGATED_BEFORE = /(ignore|ignores|ignoring|cannot be|can't be|unable to be|immune to|will not be|won't be|not be)[^.]{0,25}$/i;

  function cleanText(s) {
    return String(s || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      // "20/40/60 damage" (valores por estágio) -> usa a média
      .replace(/\b(\d+)(?:\/(\d+))+\b/g, v => {
        const parts = v.split('/').map(Number);
        return String(Math.round(parts.reduce((a, b) => a + b, 0) / parts.length));
      })
      .trim();
  }

  const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, all: 3 };
  function num(x, d) {
    if (x == null) return d;
    const s = String(x).toLowerCase();
    if (WORD_NUM[s] != null) return WORD_NUM[s];
    const n = parseInt(s, 10); return Number.isFinite(n) ? n : d;
  }

  // Devolve [inicio, fim) da frase que contém a posição idx (delimitada por ". ")
  function sentenceBounds(lower, idx) {
    let start = lower.lastIndexOf('. ', idx); start = start < 0 ? 0 : start + 2;
    let end = lower.indexOf('. ', idx); end = end < 0 ? lower.length : end + 1;
    return [start, end];
  }

  // Efeitos descritos em frases condicionais ("If X is active, ...") valem metade.
  function condOf(sentence) {
    return (/^(if|during|while|when|after|each time|whenever|at \d)/.test(sentence) || /\b(is active|in effect)\b/.test(sentence)) ? 0.5 : 1;
  }

  // Cláusula (trecho entre vírgulas / " and ") que contém a posição pos dentro da frase
  function clauseAround(sentence, pos) {
    const sep = /,|;| and | while | but /g;
    let start = 0, m;
    while ((m = sep.exec(sentence)) !== null) {
      if (m.index >= pos) return sentence.slice(start, m.index);
      start = m.index + m[0].length;
    }
    return sentence.slice(start);
  }

  function turnsIn(sentence) {
    const m = sentence.match(/for (\d+|one|two|three|four|five) (turns?|rounds?)/i);
    const t = m ? num(m[1], 1) : 1;
    if (/permanent/i.test(sentence)) return Math.max(t, 4); // permanente: tratamos como 4 turnos de valor
    return t;
  }

  // Quanto do kit inimigo um efeito "parcial" cobre: "non-mental" quase tudo; uma classe só, pouco.
  function partialFactor(sent) {
    if (/\ball\s+(of\s+)?(their\s+|the\s+)?skills/.test(sent)) return 1;
    if (/\bnon-mental\b/.test(sent)) return 0.85;
    if (/\bnon-(physical|chakra)\b/.test(sent)) return 0.7;
    if (/\bharmful\s+skills?/.test(sent)) return 0.9;
    if (/\b(physical|chakra|mental|melee|ranged|affliction)\s+and\s+(physical|chakra|mental|melee|ranged|affliction)\s+skills?/.test(sent)) return 0.65;
    if (/\b(helpful)\s+skills?/.test(sent)) return 0.5;
    if (/\b(physical|chakra|mental|melee|ranged|affliction|instant|action|control)\s+skills?/.test(sent)) return 0.4;
    return 1;
  }

  function parseSkill(skill, idx) {
    const text = cleanText(skill.description);
    const lower = text.toLowerCase();
    const classes = skill.classes || [];
    const isPassive = classes.includes('Passive') || /^passive:/i.test(skill.name || '');
    const isHidden = !isPassive && idx >= 4;
    const energy = skill.energy || [];
    const specific = energy.filter(e => e !== 'Random');
    const randomCount = energy.length - specific.length;

    const p = {
      name: skill.name, idx, isPassive, isHidden,
      cost: { specific, random: randomCount, total: energy.length },
      cooldown: num(skill.cooldown, 0),
      classes,
      dmg: 0, dmgCond: 0, aoe: false, pierce: false, affliction: false, multiTurn: 1,
      stun: 0, drain: 0, chakraGain: 0, debuff: 0, costUp: false,
      heal: 0, healAlly: 0, dr: 0, drAlly: 0, dd: 0, ddAlly: 0,
      invulnSelf: false, invulnAlly: false, genericDodge: false,
      counter: false, reflect: false, uncounterable: false, ignoreInvuln: false,
      ignoreStun: false, cleanse: false, amplify: 0,
      invisible: false, noDefense: false, noDefenseAoe: false, invulnTeam: false, extendTurns: 0, free: false, counterEnemy: false, endsEarly: false, antiHeal: false,
      invulnScope: 1, cdDown: 0, cdUp: 0, stacks: false, aoeEffect: false, permanent: false, enables: 0, revive: false, costDown: false, unkillable: false, shieldBreak: false, copy: false, pctDmg: 0, amplifyAffl: false,
      setup: false, targetsAllies: false,
      tags: new Set(),
    };

    if (GENERIC_DODGE.test(text)) { p.genericDodge = true; p.invulnSelf = true; return p; }

    // --- dano -----------------------------------------------------------------
    // debuff ofensivo: "deal 5 less (non-affliction) damage"
    const debuffRe = /(\d+)\s+(?:non-\w+\s+)?less\s+(?:non-\w+\s+)?damage|deal\w*\s+(\d+)\s+less/gi;
    let m;
    while ((m = debuffRe.exec(text)) !== null) {
      const [s0, s1] = sentenceBounds(lower, m.index);
      const sent = lower.slice(s0, s1);
      if (/enem|that (character|target)|they will|their skills|target/.test(sent) && !/(ally|allies|team)[^.]{0,30}deal/.test(sent)) p.debuff += num(m[1] || m[2], 0) * condOf(sent);
    }
    const dmgRe = /(\d+)\s+(additional\s+|extra\s+|more\s+)?(piercing\s+|affliction\s+|unpierceable\s+)?damage(?! reduction)/gi;
    while ((m = dmgRe.exec(text)) !== null) {
      const [s0, s1] = sentenceBounds(lower, m.index);
      const sent = lower.slice(s0, s1);
      const before = lower.slice(s0, m.index);
      const after = lower.slice(m.index, s1);
      if (/^\d+\s+(?:non-\w+\s+)?less\b/.test(after)) continue;          // já tratado como debuff
      if (/\bless\s*$/.test(before)) continue;
      // "Lee will take 5 affliction damage" (auto-dano / custo em vida) não é ofensa
      if (/\b(will|to|and)\s+(take|takes|receive|receives|suffer|suffers)\s+$/.test(before) && !/(enem|that (character|target)|target|they|them)/.test(before)) continue;
      const amount = num(m[1], 0);
      if (!amount) continue;
      const kind = (m[3] || '').trim().toLowerCase();
      const conditional = !!m[2] ||
        /\b(if|during|after|when|instead|requires?|each time|whenever|for each|for every|per stack|per )\b/.test(before) ||
        /\b(for each|for every|per stack)\b/.test(after) ||
        /\bwhile\b[^.]{0,40}\b(active|in effect|affected|under|stunned|marked)\b/.test(before) ||
        /\b(if|during|instead)\b/.test(after) ||
        /\bwhile\b[^.]{0,40}\b(active|in effect|affected|under)\b/.test(after);
      const aoe = /all enemies|the enemy team|enemy team|to all/.test(sent);
      const takes = /(take|takes|taking|receive|receives|receiving)\s+(an?\s+)?(\d+\s+)?(additional|extra|more)\s*$/.test(before);
      // duração só da cláusula do dano ("deals 15 damage and gains 10 permanent destructible defense" não é dano permanente)
      const clause = clauseAround(sent, m.index - s0);
      const turns = /(each|every) turn/.test(sent) && /permanent/.test(sent) ? turnsIn(sent) : turnsIn(clause);
      let value = amount * (aoe ? 2.2 : 1) * Math.min(turns, 4);
      if (kind === 'piercing') { p.pierce = true; value *= 1.15; }
      if (kind === 'affliction') { p.affliction = true; value *= 1.25; }
      if (aoe) p.aoe = true;
      if (turns > 1) p.multiTurn = Math.max(p.multiTurn, turns);
      if (takes) { p.amplify += amount; if (/from (all )?affliction/.test(after) || /affliction skills/.test(sent)) { p.amplifyAffl = true; p.tags.add('amplifyAffl'); } if (/(all enemies|enemy team|the enemy team)/.test(sent)) p.tags.add('amplifyAoe'); continue; }
      if (conditional) p.dmgCond += value; else p.dmg += value;
    }
    // "stealing 20 health" (dreno de vida)
    const stealHp = lower.match(/steal(?:ing|s)?\s+(\d+)\s+(?:additional\s+)?health/);
    if (stealHp) {
      const v = num(stealHp[1], 0);
      if (/additional/.test(stealHp[0])) p.dmgCond += v; else p.dmg += v;
      p.heal += v;
    }

    // --- controle -------------------------------------------------------------
    const stunRe = /(?<![a-z])stun(s|ned|ning)?(?![a-z])|unable to (use|perform) (a |any |their |new )?skills?|cannot use (a |any |their )?skills?/gi;
    let stunHits = 0, stunTurns = 0, partial = 1;
    while ((m = stunRe.exec(text)) !== null) {
      const [s0, s1] = sentenceBounds(lower, m.index);
      const before = lower.slice(Math.max(s0, m.index - 45), m.index);
      const sent = lower.slice(s0, s1);
      if (NEGATED_BEFORE.test(before)) { p.ignoreStun = true; continue; }
      if (/(ally|allies|team|himself|herself|themselves)[^.]{0,20}$/.test(before) && !/enem/.test(before)) continue;
      if (/(if|when|while|is|being|are)\s*$/.test(before) && /stunned/.test(m[0]) && !/enem/.test(sent)) continue;
      partial = Math.min(partial, partialFactor(sent));
      stunHits++;
      stunTurns += turnsIn(sent) * condOf(sent);
    }
    if (stunHits) {
      const aoe = /all enemies|enemy team|the enemy team/.test(lower);
      // stun em todos os inimigos vale quase um turno inteiro do adversário
      p.stun = Math.max(1, stunTurns) * partial * (aoe ? 2.6 : 1);
      p.tags.add('stun');
      if (aoe) p.tags.add('stunAoe');
    }
    // prefixos, não palavras inteiras: "removing"/"removed" não casavam com "remove" (bug encontrado em 2026-09-22)
    const drainRe = /(steal|remov|absorb|drain|los)\w*\s+(?:them\s+|from them\s+|all of\s+)?(?:[^.]{0,45}?\s)?(\d+|one|two|three|all)\s+(?:random\s+|non-\w+\s+|[a-z]+\s+)?(?:or\s+[a-z]+\s+)?(?:and\s+\d+\s+[a-z]+\s+)?chakra/gi;
    while ((m = drainRe.exec(text)) !== null) {
      const [s0, s1] = sentenceBounds(lower, m.index);
      const sent = lower.slice(s0, s1);
      const verb = m[1].toLowerCase();
      // "lose" só conta se for o inimigo perdendo
      if (/^los/.test(verb) && !/(enem|that (enemy|character|target)|they will|target)/.test(sent)) continue;
      if (/gain/.test(sent.slice(0, m.index - s0))) continue;
      let v = num(m[2], 1);
      if (/and \d+ [a-z]+ chakra/.test(m[0])) v += 1;
      if (/^steal|^absorb/.test(verb)) v *= 1.4;
      p.drain += v * condOf(sent);
      p.tags.add('drain');
    }
    if (/gain(s|ing)?\s+(\d+|one|two)\s+(random\s+|[a-z]+\s+)?chakra/.test(lower)) {
      const g = lower.match(/gain(?:s|ing)?\s+(\d+|one|two)\s+(?:random\s+|[a-z]+\s+)?chakra/);
      p.chakraGain = num(g[1], 1);
      if (/every turn|each turn|permanently/.test(lower)) p.chakraGain *= 3;
      p.tags.add('chakraGain');
    }
    if (/cost\w*[^.]{0,40}(additional|more|increase)/.test(lower) || /(additional|more)\s+(random\s+)?chakra\s+to\s+use/.test(lower)) {
      p.costUp = true; p.tags.add('costUp');
    }
    if (p.debuff) p.tags.add('debuff');

    // --- defesa / suporte ----------------------------------------------------
    const allyCtx = /(one ally|all allies|an ally|his team|her team|their team|the team|himself or one ally|herself or one ally|allies|ally)/;
    p.targetsAllies = allyCtx.test(lower);

    const drRe = /(\d+)(%|\s+points? of|\s+point of)?\s+(permanent\s+)?(unpierceable\s+)?damage reduction/gi;
    while ((m = drRe.exec(text)) !== null) {
      const [s0, s1] = sentenceBounds(lower, m.index);
      const before = lower.slice(s0, m.index);
      const sent = lower.slice(s0, s1);
      if (/(ignore|ignores|cannot|unable to|reduces?|removes?|loses?|less)[^.]{0,25}$/.test(before)) continue;
      let v = num(m[1], 0);
      if (m[2] && m[2].includes('%')) v = v * 0.4; // 25% ≈ 10 pontos p/ dano médio de 40
      v = v * Math.min(turnsIn(sent), 4) * (m[4] ? 1.2 : 1) * condOf(sent);
      if (allyCtx.test(before)) p.drAlly += v; else p.dr += v;
      p.tags.add('dr');
    }
    const ddRe = /(\d+)\s+(points? of\s+)?(permanent\s+)?destructible defense/gi;
    while ((m = ddRe.exec(text)) !== null) {
      const [s0, s1] = sentenceBounds(lower, m.index);
      const before = lower.slice(s0, m.index);
      const sent = lower.slice(s0, s1);
      if (/(ignore|ignores|removes?|destroys?|lose|loses)[^.]{0,25}$/.test(before)) continue;
      const v = num(m[1], 0) * (/every turn|each turn/.test(sent) ? 2.5 : 1) * (m[3] ? 1.5 : 1) * condOf(sent);
      if (allyCtx.test(before)) p.ddAlly += v; else p.dd += v;
      p.tags.add('dd');
    }
    // "heals X for 25 health" e também "heals an ally for 25 points" (sem a palavra health)
    const healRe = /heal(?:s|ed|ing)?\s+([^.]{0,40}?)(\d+)\s+(?:points? of\s+)?(?:health|points?\b)/gi;
    while ((m = healRe.exec(text)) !== null) {
      const [s0, s1] = sentenceBounds(lower, m.index);
      const before = lower.slice(s0, m.index);
      const sent = lower.slice(s0, s1);
      if (/(cannot|unable to|prevent\w*|no longer)[^.]{0,20}$/.test(before)) continue;
      const v = num(m[2], 0) * (/every turn|each turn|permanently/.test(sent) ? 3 : 1) * condOf(sent);
      if (/(ally|allies|team)/.test(m[1]) || allyCtx.test(before)) p.healAlly += v; else p.heal += v;
      p.tags.add('heal');
    }
    const TRIGGER_SENT = /(if|when|each time|whenever) (a |any )?(new )?skill (that|which|with)[^.]{0,60}(counter|reflect|invulnerab)/;
    const invRe = /invulnerab/gi;
    while ((m = invRe.exec(text)) !== null) {
      const before = lower.slice(Math.max(0, m.index - 60), m.index);
      if (TRIGGER_SENT.test(lower.slice(...sentenceBounds(lower, m.index)))) continue; // "if a skill that has ... invulnerability is used on that enemy" = gatilho, não invulnerabilidade própria
      if (/ignores?\s+$/.test(before) || /ignore\w*[^.]{0,15}$/.test(before)) { p.ignoreInvuln = true; continue; }
      if (/(cannot|unable to|prevent\w*|removes?|not be)[^.]{0,30}$/.test(before)) continue;
      const invSent = lower.slice(...sentenceBounds(lower, m.index));
      if (/invulnerable to (friendly|helpful)/.test(invSent) && /enem/.test(invSent)) { p.antiHeal = true; p.tags.add('antiHeal'); continue; }
      if (allyCtx.test(before) && !/himself|herself/.test(before)) p.invulnAlly = true;
      else p.invulnSelf = true;
      p.tags.add('invuln');
      // "invulnerable to non-mental skills" / "to physical skills": cobertura parcial
      const scopeSent = lower.slice(m.index, Math.min(lower.length, m.index + 60));
      if (/invulnerab\w*\s+to\s+/.test(scopeSent)) p.invulnScope = Math.min(p.invulnScope, partialFactor(scopeSent.replace(/invulnerab\w*\s+to\s+/, '')));
    }
    const counterRe = /(?<![a-z])counter(s|ed|ing)?(?![a-z])/gi;
    while ((m = counterRe.exec(text)) !== null) {
      const before = lower.slice(Math.max(0, m.index - 30), m.index);
      if (TRIGGER_SENT.test(lower.slice(...sentenceBounds(lower, m.index)))) continue;
      if (/(cannot be|can't be|unable to be|ignores?|not be)\s*$/.test(before)) { p.uncounterable = true; continue; }
      const [s0, s1] = sentenceBounds(lower, m.index);
      const sent = lower.slice(s0, s1);
      if (/(that enemy|one enemy|the enemy|enemy's|enemies)/.test(sent) && !/used on (him|her|them|[a-z]+ \(s\)|[a-z]+)\b[^.]{0,20}counter/.test(sent)) p.counterEnemy = true;
      p.counter = true; p.tags.add('counter');
    }
    const reflectRe = /(?<![a-z])reflect(s|ed|ing)?(?![a-z])/gi;
    while ((m = reflectRe.exec(text)) !== null) {
      const before = lower.slice(Math.max(0, m.index - 30), m.index);
      if (TRIGGER_SENT.test(lower.slice(...sentenceBounds(lower, m.index)))) continue;
      if (/(cannot be|can't be|unable to be|ignores?|not be|or)\s*$/.test(before) && /cannot be countered or/.test(lower)) { p.uncounterable = true; continue; }
      if (/(cannot be|can't be|unable to be|ignores?|not be)\s*$/.test(before)) { p.uncounterable = true; continue; }
      const [s0, s1] = sentenceBounds(lower, m.index);
      const sent = lower.slice(s0, s1);
      if (/(that enemy|one enemy|the enemy|enemy's)/.test(sent) && /used by/.test(sent)) p.counterEnemy = true;
      p.reflect = true; p.tags.add('reflect');
    }
    if (/this skill is (also )?invisible/.test(lower)) { p.invisible = true; p.tags.add('invisible'); }
    if (/(unable to|cannot) (reduce damage|become invulnerable)/.test(lower)) {
      p.noDefense = true; p.tags.add('noDefense');
      if (/all enemies|enemy team/.test(lower)) { p.noDefenseAoe = true; p.tags.add('noDefenseAoe'); }
    }
    if (p.invulnAlly && /(his|her|their|the) team|all allies/.test(lower)) { p.invulnTeam = true; p.tags.add('invulnTeam'); }
    // 6) estende a duração de outras skills ("will last 1 additional turn") e skills gratuitas
    const ext = lower.match(/last (\d+|one|two) additional turns?/g);
    if (ext) { p.extendTurns = ext.length * num(ext[0].match(/last (\w+)/)[1], 1); p.tags.add('extend'); }
    if (!isPassive && energy.length === 0) p.free = true;
    const pctMore = lower.match(/(\d+)% (more|additional|increased) damage/);
    if (pctMore && /(enem|that character|target)/.test(lower)) { p.amplify += num(pctMore[1], 0) * 0.2; p.tags.add('amplify'); }
    if (/(this skill will end|this skill ends|will end if|ends if|and then this skill will end)/.test(lower) && /(uses a new|new skill)/.test(lower)) {
      p.endsEarly = true; p.dmg *= 0.65; p.dmgCond *= 0.65; p.stun *= 0.65;
    }
    // --- mecânicas adicionais -------------------------------------------------
    // cooldown: reduzido para aliados (suporte) / aumentado para inimigos (controle)
    let cm;
    if ((cm = lower.match(/cooldowns?\s+(of\s+[^.]{0,40}?)?(reduced|decreased|lowered)\s+by\s+(\d+|one|two)/)) && !/enem/.test(lower.slice(0, cm.index + cm[0].length))) { p.cdDown = num(cm[3], 1); p.tags.add('cdDown'); }
    if ((cm = lower.match(/(increas(?:e|es|ing)\s+the\s+cooldowns?|cooldowns?\s+(?:of\s+[^.]{0,40}?)?(?:increased|raised)\s+by)\s*[^.]{0,40}?(\d+|one|two)/)) && /enem|their/.test(lower)) { p.cdUp = num(cm[2], 1); p.tags.add('cdUp'); }
    // stacks: dano que cresce com acúmulo é condicional por natureza
    if (/\bstacks?\b/.test(lower) && /(gain|gains|gaining|per stack|for each stack|for every|each stack|at \d+ stacks)/.test(lower)) p.tags.add('stacks');
    // reviver aliado
    if (/\breviv(e|es|ed|ing)\b/.test(lower) && /(ally|allies|team|dead|killed)/.test(lower) && !/cannot be revived/.test(lower)) { p.revive = true; p.tags.add('revive'); }
    // custo menor para o time
    if (/(cost|costs)\s+(\d+|one)\s+less/.test(lower) && /(ally|allies|team|his|her|their)/.test(lower) && !/enem/.test(lower)) { p.costDown = true; p.tags.add('costDown'); }
    // não pode morrer / vida não cai abaixo de
    if (/(cannot (be killed|die)|can(?:not|'t) be killed|health (cannot|can't|will not) (drop|go|fall) below|will not die|immortal)/.test(lower) && !/enem/.test(lower.slice(0, 40))) { p.unkillable = true; p.tags.add('unkillable'); }
    // quebra de defesa destrutível
    if (/(destroys?|removes?)\s+(all\s+)?(of\s+)?(their\s+|one enemy's\s+|the\s+)?destructible defense/.test(lower)) { p.shieldBreak = true; p.tags.add('shieldBreak'); }
    // cópia de skill
    if (/\b(copy|copies|copying|imitate|imitates)\b[^.]{0,40}\bskill/.test(lower) && !/cannot be copied/.test(lower)) { p.copy = true; p.tags.add('copy'); }
    // dano percentual da vida ("30% of one enemy's current health as damage")
    const pd = lower.match(/(\d+)%\s+of\s+(?:one enemy's|their|the target's|an enemy's)\s+(current|maximum|max|total)?\s*health\s+as\s+damage/);
    if (pd) { const pct = num(pd[1], 0); const base = /current/.test(pd[2] || '') ? 55 : 100; p.pctDmg = pct / 100 * base; p.dmg += p.pctDmg; p.tags.add('pctDmg'); }
    if (/removes? (all )?(enemy )?(harmful|affliction)/.test(lower) && p.targetsAllies) { p.cleanse = true; p.tags.add('cleanse'); }
    if (/ignores? invulnerability/.test(lower)) p.ignoreInvuln = true;
    if (p.ignoreInvuln) p.tags.add('ignoreInvuln');
    if ((p.dmg || p.dmgCond) && classes.some(c => /^\*?Affliction\*?$/.test(c))) p.affliction = true;
    if (p.pierce) p.tags.add('pierce');
    if (p.affliction) p.tags.add('affliction');
    // efeito em ÁREA sem dano: "stunning all enemies", "all enemies' skills cost 1 additional", "all enemies deal 5 less damage".
    // O jogo trata isso como pressão nos três inimigos igual ao dano em área, e é o que as regras de sinergia usam.
    if (!p.aoe) {
      const areaRe = /all enemies|the enemy team|enemy team|all of their enemies/gi;
      let am;
      while ((am = areaRe.exec(text)) !== null) {
        const [s0, s1] = sentenceBounds(lower, am.index);
        const sent = lower.slice(s0, s1);
        if (!/stun|cost|less damage|additional damage|cooldown|invulnerab|chakra|damage reduction|destructible/.test(sent)) continue;
        if (TRIGGER_SENT.test(sent)) continue;
        p.aoeEffect = true;
        if (p.stun && /stun/.test(sent)) p.tags.add('stunAoe');
        break;
      }
      if (p.aoeEffect) { p.aoe = true; p.tags.add('aoeEffect'); }
    }
    if (p.aoe) p.tags.add('aoe');
    if (p.uncounterable) p.tags.add('uncounterable');
    if (p.ignoreStun) p.tags.add('ignoreStun');
    if (p.amplify) p.tags.add('amplify');

    // --- setup / dependência --------------------------------------------------
    if (/(requires? '|can only be used (during|after|if|while)|if used (one turn )?after|during '|while .{0,25}is (active|in effect)|can only be used on an enemy affected)/.test(lower) && !isPassive) {
      p.setup = true;
    }
    return p;
  }

  // ---------------------------------------------------------------------------
  // 2. Perfil por personagem
  // ---------------------------------------------------------------------------

  function skillWeight(s) {
    if (s.isPassive) return W.passive;
    if (s.isHidden) return W.hiddenSkills;
    return 1;
  }

  function profileChar(char) {
    const skills = (char.skills || []).map((s, i) => { const p = parseSkill(s, i); applyOverride(char.name, p); return p; });
    const active = skills.filter(s => !s.isPassive);
    const base = active.filter(s => !s.isHidden);

    const prof = {
      name: char.name, url: char.url, description: char.description, descriptionBR: char.descriptionBR,
      skills,
      raw: { offense: 0, control: 0, defense: 0, support: 0, economy: 0, tempo: 0 },
      energy: { Tai: 0, Blood: 0, Nin: 0, Gen: 0 },   // participação de cada tipo nas skills base
      specificTypes: new Set(),
      randomRatio: 0,
      setupRatio: 0,
      tags: new Set(),
      aoe: false,
    };

    let costSum = 0, randSum = 0, setupCount = 0;
    for (const s of skills) {
      const w = skillWeight(s);
      const costDiv = Math.max(1, s.cost.total);
      const cdDiv = 1 + Math.min(s.cooldown, 5) * 0.12;
      const setupMul = s.setup ? 0.7 : 1;
      // Action (refeita a cada turno: stun/invulnerabilidade interrompem) e Control (acaba se perder contato) valem menos que Instant
      const classMul = s.multiTurn > 1 && s.classes.some(c => /^\*?Control\*?$/.test(c)) ? 0.8 : s.multiTurn > 1 && s.classes.some(c => /^\*?Action\*?$/.test(c)) ? 0.85 : 1;
      // Ofensa: dano garantido + 50% do dano condicional, por chakra gasto, penalizando cooldown longo.
      prof.raw.offense += w * setupMul * classMul * ((s.dmg + 0.5 * s.dmgCond) / Math.sqrt(costDiv)) / cdDiv;
      if (s.shieldBreak) prof.raw.offense += w * 4;
      if (s.copy) prof.raw.offense += w * 12;
      prof.raw.offense += w * s.amplify * 0.4;
      // Controle
      prof.raw.control += w * setupMul * (s.stun * 14 + s.drain * 9 + s.debuff * 0.6 + (s.costUp ? 8 : 0) +
        (s.counterEnemy ? 14 : 0) + (s.antiHeal ? 8 : 0) + (s.invisible && (s.stun || s.counterEnemy || s.drain) ? 3 : 0) +
        (s.noDefenseAoe ? 12 : 0) + s.extendTurns * 6 + s.cdUp * 8) / cdDiv;
      // Defesa própria (dodge genérico vale pouco: todos têm)
      prof.raw.defense += w * (s.dr * 0.9 + s.dd * 0.8 + s.heal * 0.8 +
        (s.invulnSelf ? (s.genericDodge ? 3 : 9 * s.invulnScope) : 0) + (s.counter && !s.counterEnemy ? 10 : 0) + (s.reflect && !s.counterEnemy ? 9 : 0) + (s.ignoreStun ? 4 : 0) +
        (s.unkillable ? 12 : 0)) / cdDiv;
      if (s.noDefense) prof.raw.offense += w * 6;
      if (s.invisible && (s.dmg || s.dmgCond)) prof.raw.offense += w * 3;
      // Suporte (aliados)
      prof.raw.support += w * (s.drAlly * 1.0 + s.ddAlly * 0.9 + s.healAlly * 1.0 +
        (s.invulnTeam ? 30 * s.invulnScope : (s.invulnAlly ? 12 * s.invulnScope : 0)) + (s.cleanse ? 8 : 0) +
        (s.revive ? 25 : 0) + s.cdDown * 10) / cdDiv;
      // Economia (skills gratuitas com efeito também contam)
      prof.raw.economy += w * (s.chakraGain * 6 + s.drain * 3 + (s.free && !s.genericDodge ? 8 : 0) + (s.costDown ? 6 : 0));
      if (!s.isPassive) {
        costSum += s.cost.total; randSum += s.cost.random;
        if (s.setup) setupCount++;
        if (!s.setup && s.cost.total <= 1 && (s.dmg > 0 || s.stun > 0 || s.healAlly > 0 || s.drAlly > 0 || s.noDefense || s.extendTurns)) prof.raw.tempo += w;
        if (s.uncounterable || s.ignoreInvuln || s.pierce || s.affliction) prof.raw.offense += w * 4;
      }
      for (const t of s.tags) prof.tags.add(t);
      if (s.aoe) prof.aoe = true;
    }
    // economia: quanto mais barato/aleatório o kit, mais fácil de jogar
    const avgCost = costSum / Math.max(1, active.length);
    prof.randomRatio = costSum ? randSum / costSum : 1;
    prof.raw.economy += (2.2 - Math.min(avgCost, 2.2)) * 10 + prof.randomRatio * 8;
    prof.setupRatio = base.length ? setupCount / base.length : 0;

    for (const s of base) {
      for (const t of s.cost.specific) { prof.energy[t] += 1 / base.length; prof.specificTypes.add(t); }
    }
    return prof;
  }

  // ---------------------------------------------------------------------------
  // 3. Notas individuais
  // ---------------------------------------------------------------------------

  function normalizeAll(profiles) {
    const keys = Object.keys(profiles[0].raw);
    const stats = {};
    for (const k of keys) {
      const vals = profiles.map(p => p.raw[k]).sort((a, b) => a - b);
      // usa percentil 95 como teto para reduzir efeito de outliers
      stats[k] = { min: vals[0], max: vals[Math.floor(vals.length * 0.95)] || vals[vals.length - 1] };
    }
    for (const p of profiles) {
      p.norm = {};
      for (const k of keys) {
        const { min, max } = stats[k];
        const lin = max > min ? Math.max(0, Math.min(1, (p.raw[k] - min) / (max - min))) : 0;
        p.norm[k] = Math.sqrt(lin); // comprime o topo: diferenças entre medianos ficam mais visíveis
      }
    }
    return stats;
  }

  function computeScore(p) {
    const n = p.norm;
    const wsum = W.offense + W.control + W.defense + W.support + W.economy + W.tempo;
    const v = (n.offense * W.offense + n.control * W.control + n.defense * W.defense +
      n.support * W.support + n.economy * W.economy + n.tempo * W.tempo) / wsum;
    return Math.round(v * 1000) / 10;
  }

  function roleOf(p) {
    const n = p.norm;
    const entries = [['dano', n.offense], ['controle', n.control], ['suporte', n.support], ['tanque', n.defense]];
    entries.sort((a, b) => b[1] - a[1]);
    const roles = [entries[0][0]];
    if (entries[1][1] > 0.55 && entries[1][1] > entries[0][1] * 0.7) roles.push(entries[1][0]);
    return roles;
  }

  // Winrate OFICIAL (data/winrate.js): { nome: { winrate, matches, usage, date, type, series } }.
  // É a medida real de força (publicada pelo staff nos patch notes), então domina a nota quando existe:
  // com 1000+ partidas, 75% winrate + 25% heurística. A heurística fica para quem não tem dados e para
  // a parte de time (sinergia, chakra, papéis). Validação: heurística × winrate oficial = ~0 de correlação.
  const MIN_MATCHES = 200;
  let WINRATE_MODE = 'raw'; // 'raw' = o que vence no ladder; 'adjusted' = força relativa ao tier de desbloqueio
  function setWinrateMode(m) { WINRATE_MODE = m === 'adjusted' ? 'adjusted' : 'raw'; }
  const effectiveWinrate = wr => (WINRATE_MODE === 'adjusted' && wr.adjusted != null) ? wr.adjusted : wr.winrate;
  function winrateScore(wr) {
    // 30% -> 0, 55% -> 50, 80% -> 100 (faixa observada nos patch notes). O ajuste por nerf/buff já vem
    // embutido na estimativa gerada por scripts/build-winrate.js.
    if (!wr) return null;
    return Math.max(0, Math.min(100, (effectiveWinrate(wr) - 30) / 50 * 100));
  }
  function winrateConfidence(wr) {
    if (!wr || !(wr.matches >= MIN_MATCHES) || !(wr.winrate >= 0)) return 0;
    let conf = Math.min(1, wr.matches / 1000);
    if (wr.date) { const months = (Date.now() - new Date(wr.date).getTime()) / (30 * 864e5); if (months > 18) conf *= 0.7; else if (months > 9) conf *= 0.85; }
    return conf * 0.75;
  }
  // expectativa do tier de desbloqueio (winrate ≈ a + b × nível; correlação 0,71 com o winrate medido), de winrate.js
  function tierWinrate(winrates, name) {
    const m = winrates && winrates._model, w = winrates && winrates[name];
    const noData = m && m.expectedNoData && m.expectedNoData[name];
    const expected = w && w.expected != null ? w.expected : (noData ? noData.expected : null);
    if (expected == null) return null;
    const unlockLevel = w && w.unlockLevel != null ? w.unlockLevel : (noData ? noData.unlockLevel : null);
    return { winrate: expected, adjusted: m && m.mean != null ? m.mean : expected, expected, unlockLevel, matches: 0, tierOnly: true };
  }
  // A parte da nota que não vem de medição confiável NÃO pode ser a heurística: contra o winrate medido ela dá
  // correlação ~0 (e negativa em quem tem pouca amostra), enquanto o tier de desbloqueio dá 0,71. Então o
  // complemento é 70% expectativa do tier + 30% heurística encolhida.
  function blendWinrate(score, wr, anyWinrateData, tier) {
    const conf = winrateConfidence(wr);
    const shrunk = 50 + (score - 50) * 0.5;
    if (!tier) {
      if (!conf) return anyWinrateData ? Math.round(shrunk * 10) / 10 : score;
      return Math.round((score * (1 - conf) + winrateScore(wr) * conf) * 10) / 10;
    }
    const fallback = winrateScore(tier) * 0.7 + shrunk * 0.3;
    const measured = conf ? winrateScore(wr) : 0;
    return Math.round((measured * conf + fallback * (1 - conf)) * 10) / 10;
  }

  // Margem de erro da nota, em pontos. Base: o backtest de scripts/validate-winrate.js (erro típico da
  // estimativa de winrate, ~8 pontos) convertido para a escala da nota (1 ponto de winrate = 2 de nota),
  // mais a dispersão de quem depende do tier. Sem o backtest, usa 8 como padrão.
  function scoreMargin(p, winrates) {
    const wrErr = (winrates && winrates._model && winrates._model.typicalError) || 8;
    const conf = p.winrateConf || 0;
    const medida = wrErr * 2;          // personagem com medição confiável
    const tierOnly = 14;               // quem depende do tier: dispersão do winrate dentro do mesmo nível
    return Math.round((medida * conf + tierOnly * (1 - conf)) * 10) / 10;
  }

  function scoreChars(characters, overrides, winrates) {
    const profiles = characters.map(profileChar);
    normalizeAll(profiles);
    for (const p of profiles) {
      precompute(p);
      p.vkey = variantKey(p.name);
      p.heuristicScore = computeScore(p);
      p.winrate = winrates && winrates[p.name] && winrates[p.name].winrate != null ? winrates[p.name] : null;
      p.winrateConf = winrateConfidence(p.winrate);
      p.tier = tierWinrate(winrates, p.name);                 // expectativa do tier, sempre que houver modelo
      p.tierWinrate = p.winrateConf ? null : p.tier;           // exibida como "≈X% (tier)" só quando não há medição
      p.lowConfidence = !!(p.tier && p.winrateConf > 0 && p.winrateConf < 0.45);
      p.baseScore = blendWinrate(p.heuristicScore, p.winrate, !!(winrates && Object.keys(winrates).length > 50), p.tier);
      const ov = overrides && overrides[p.name];
      p.tierOverride = ov || null;
      p.score = applyTier(p.baseScore, ov);
      p.margin = scoreMargin(p, winrates);
      p.roles = roleOf(p);
    }
    profiles.sort((a, b) => b.score - a.score);
    profiles.forEach((p, i) => { p.rank = i + 1; });
    return profiles;
  }

  const TIER_MULT = { S: 1.35, A: 1.18, B: 1.0, C: 0.85, D: 0.7, F: 0.5 };
  function applyTier(score, tier) {
    if (!tier || !TIER_MULT[tier]) return score;
    return Math.round(Math.min(100, score * TIER_MULT[tier]) * 10) / 10;
  }

  // ---------------------------------------------------------------------------
  // 4. Nota de time
  // ---------------------------------------------------------------------------

  // Flags pré-computadas por personagem (bitmask) para a busca combinatória ser rápida.
  const F = { STUN: 1, AFFL: 2, DOT: 4, DRAIN: 8, AMP: 16, DEBUFF: 32, CLEANSE: 64, AOE: 128, STUN_AOE: 256, NODEF_AOE: 512, INVULN_TEAM: 1024, AMP_AFFL: 2048 };

  function precompute(p) {
    p.e = ENERGY_TYPES.map(t => p.energy[t]);
    p.specMask = 0;
    ENERGY_TYPES.forEach((t, i) => { if (p.specificTypes.has(t)) p.specMask |= (1 << i); });
    let f = 0;
    if (p.tags.has('stun')) f |= F.STUN;
    if (p.tags.has('affliction')) f |= F.AFFL;
    if (p.skills.some(s => s.multiTurn > 1 && s.dmg > 0)) f |= F.DOT;
    if (p.tags.has('drain')) f |= F.DRAIN;
    if (p.tags.has('amplify')) f |= F.AMP;
    if (p.tags.has('debuff')) f |= F.DEBUFF;
    if (p.tags.has('cleanse')) f |= F.CLEANSE;
    if (p.aoe) f |= F.AOE;
    if (p.tags.has('stunAoe')) f |= F.STUN_AOE;
    if (p.tags.has('noDefenseAoe')) f |= F.NODEF_AOE;
    if (p.tags.has('invulnTeam')) f |= F.INVULN_TEAM;
    if (p.tags.has('amplifyAffl')) f |= F.AMP_AFFL;
    p.f = f;
    p.combos = COMBO_PARTNERS.get(p.name) || EMPTY_SET;
  }

  // Combos confirmados por fontes oficiais (patch notes / posts de staff): { "A|B": { count, title } }
  let KNOWN_COMBOS = new Map();
  let COMBO_PARTNERS = new Map(); // nome -> Set de parceiros (para o caminho rápido da busca)
  const EMPTY_SET = new Set();
  function setKnownCombos(list) {
    KNOWN_COMBOS = new Map(); COMBO_PARTNERS = new Map();
    for (const c of list || []) {
      KNOWN_COMBOS.set(c.members.slice().sort().join('|'), c);
      for (const n of c.members) { if (!COMBO_PARTNERS.has(n)) COMBO_PARTNERS.set(n, new Set()); for (const m of c.members) if (m !== n) COMBO_PARTNERS.get(n).add(m); }
    }
  }
  const knownCombo = (a, b) => KNOWN_COMBOS.get([a.name, b.name].sort().join('|')) || null;

  // Regras de sinergia direcionais (a -> b). `v` é a força; combinadas com retorno decrescente.
  const SYNERGY_RULES = [
    { v: 0.30, title: 'Suporte + carregador', titleEn: 'Support + carrier', why: 'suporte protege o carregador de dano', whyEn: 'support protects the damage carrier', test: (a, b) => a.norm.support > 0.6 && b.norm.offense > 0.7 },
    { v: 0.25, title: 'Stun + dano contínuo', titleEn: 'Stun + damage over time', why: 'stun segura o alvo enquanto o dano contínuo/aflição trabalha', whyEn: 'stun holds the target while damage over time/affliction works', test: (a, b) => (a.f & F.STUN) && (b.f & (F.AFFL | F.DOT)) },
    { v: 0.20, title: 'Dreno de chakra + dano', titleEn: 'Chakra drain + damage', why: 'roubo de chakra atrasa a resposta inimiga ao dano', whyEn: 'chakra drain delays the enemy response to damage', test: (a, b) => (a.f & F.DRAIN) && b.norm.offense > 0.7 },
    { v: 0.30, title: 'Amplificação + dano', titleEn: 'Amplification + damage', why: 'amplificação de dano recebido multiplica o dano do parceiro', whyEn: 'damage amplification multiplies the partner damage', test: (a, b) => (a.f & F.AMP) && b.norm.offense > 0.6 },
    { v: 0.15, title: 'Debuff + defesa', titleEn: 'Debuff + defense', why: 'redução de dano inimigo + defesa própria = muito difícil de matar', whyEn: 'enemy damage reduction + own defense = very hard to kill', test: (a, b) => (a.f & F.DEBUFF) && b.norm.defense > 0.6 },
    { v: 0.12, title: 'Limpeza + atacante', titleEn: 'Cleanse + attacker', why: 'limpeza de aflições mantém o atacante livre', whyEn: 'affliction cleansing keeps the attacker free', test: (a, b) => (a.f & F.CLEANSE) && b.norm.offense > 0.7 },
    { v: 0.35, title: 'Anula defesas + dano em área', titleEn: 'Defense removal + AoE damage', why: 'bloqueia a esquiva/redução de todos os inimigos e o parceiro bate em área', whyEn: 'blocks every enemy dodge/reduction while the partner hits everyone', test: (a, b) => (a.f & F.NODEF_AOE) && (b.f & F.AOE) },
    { v: 0.30, title: 'Stun em área + dano em área', titleEn: 'AoE stun + AoE damage', why: 'stun em todos os inimigos abre um turno livre para o dano em área', whyEn: 'stunning all enemies opens a free turn for area damage', test: (a, b) => (a.f & F.STUN_AOE) && (b.f & F.AOE) },
    { v: 0.20, title: 'Invulnerabilidade do time', titleEn: 'Team invulnerability', why: 'invulnerabilidade do time inteiro compra um turno para o parceiro', whyEn: 'team-wide invulnerability buys a turn for the partner', test: (a, b) => (a.f & F.INVULN_TEAM) && b.norm.offense > 0.6 },
    { v: 0.40, title: 'Amplificação de aflição', titleEn: 'Affliction amplification', why: 'amplifica o dano de aflição de todo o time e o parceiro causa aflição', whyEn: 'amplifies the whole team\'s affliction damage and the partner deals affliction', test: (a, b) => (a.f & F.AMP_AFFL) && (b.f & F.AFFL) },
    { v: 0.40, title: 'Combo citado pelo staff', titleEn: 'Staff-cited combo', why: 'combo citado pelo staff nos patch notes/fórum', whyEn: 'combo cited by the staff in patch notes/forum', test: (a, b) => a.name < b.name && a.combos.size > 0 && a.combos.has(b.name) },
  ];

  function synergyValue(a, b, c) {
    let keep = 1; // 1 - Π(1 - v): retorno decrescente
    const pairs = [[a, b], [b, a], [a, c], [c, a], [b, c], [c, b]];
    for (let i = 0; i < 6; i++) {
      const x = pairs[i][0], y = pairs[i][1];
      for (let r = 0; r < SYNERGY_RULES.length; r++) if (SYNERGY_RULES[r].test(x, y)) keep *= (1 - SYNERGY_RULES[r].v);
    }
    const aoeCount = ((a.f & F.AOE) ? 1 : 0) + ((b.f & F.AOE) ? 1 : 0) + ((c.f & F.AOE) ? 1 : 0);
    if (aoeCount >= 2) keep *= (aoeCount === 3 ? 0.7 : 0.8);
    return 1 - keep;
  }

  function synergyList(team) {
    const out = [];
    for (const x of team) for (const y of team) {
      if (x === y) continue;
      for (const r of SYNERGY_RULES) if (r.test(x, y)) { const kc = r.v === 0.40 ? knownCombo(x, y) : null; out.push({ a: x.name, b: y.name, title: r.title, titleEn: r.titleEn, why: r.why + (kc ? ` (${kc.sources[0].title})` : ''), whyEn: r.whyEn + (kc ? ` (${kc.sources[0].title})` : ''), v: r.v }); }
    }
    const aoe = team.filter(p => p.f & F.AOE);
    if (aoe.length >= 2) out.push({ a: aoe.map(p => p.name).join(' + '), b: '', title: 'Dano em área combinado', titleEn: 'Combined AoE damage', why: 'dano em área combinado pressiona os 3 inimigos', whyEn: 'combined area damage pressures all 3 enemies', v: 0.2 });
    return out.sort((p, q) => q.v - p.v);
  }

  function sharedTypes(a, b) { return (a.specMask & b.specMask) !== 0; }

  // Chave para identificar versões do mesmo personagem ("Tsunade" ~ "Tsunade (S)",
  // "Uzumaki Naruto" ~ "Kyuubi Naruto" ~ "Sennin Naruto (S)").
  const VARIANT_PREFIX = /^(shinobi alliance|edo tensei|et|anbu|cursed seal|four tail kyuubi|kyuubi|sennin|fuuton|hebi|mangekyou|susanoo|kazekage|shukaku|young|drunken|true art|true form|hiruko|hachibi|samehada fusion|white snake|masked)\s+/;
  const VARIANT_SUFFIX = /\s+(of the desert|rehabilitated|of the red sand|of the rain|body double)$/;
  function variantKey(name) {
    let n = String(name).toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim(); // "(S)", "(Classic)", "(Alternative)"...
    n = n.replace(VARIANT_PREFIX, '').replace(VARIANT_SUFFIX, '').trim();
    if (/path pein$/.test(n) || /(hokage|mizukage|raikage|tsuchikage)$/.test(n)) return n;
    const parts = n.split(/\s+/);
    return parts[parts.length - 1];
  }

  function clashValue(a, b, c) {
    // demanda por tipo = soma das participações; excedente sobre a oferta esperada vira penalidade
    let excess = 0;
    for (let i = 0; i < 4; i++) {
      const over = a.e[i] + b.e[i] + c.e[i] - SUPPLY_PER_TYPE;
      if (over > 0) excess += Math.pow(over, 1.4);
    }
    const pairs = (sharedTypes(a, b) ? 1 : 0) + (sharedTypes(a, c) ? 1 : 0) + (sharedTypes(b, c) ? 1 : 0);
    return Math.min(1, excess / 2.2) * 0.75 + (pairs / 3) * 0.25;
  }

  function coverageValue(a, b, c) {
    const soft = x => Math.min(1, x / 0.6);
    const dmg = Math.max(a.norm.offense, b.norm.offense, c.norm.offense);
    const ctl = Math.max(a.norm.control, b.norm.control, c.norm.control);
    const def = Math.max(a.norm.defense, b.norm.defense, c.norm.defense, a.norm.support, b.norm.support, c.norm.support);
    return (soft(dmg) + soft(ctl) + soft(def)) / 3;
  }

  function fastTeamScore(a, b, c) {
    const base = (a.score + b.score + c.score) / 3;
    const setupAvg = (a.setupRatio + b.setupRatio + c.setupRatio) / 3;
    const setupPen = setupAvg > 0.4 ? (setupAvg - 0.4) / 0.6 : 0;
    return base + coverageValue(a, b, c) * W.roleCoverage + synergyValue(a, b, c) * W.synergy
      - clashValue(a, b, c) * W.clash - setupPen * W.setupPenalty;
  }

  // Versão detalhada (para exibir): mesma fórmula, com os componentes abertos.
  function scoreTeam(team) {
    const [a, b, c] = team;
    const demand = {};
    ENERGY_TYPES.forEach((t, i) => { demand[t] = a.e[i] + b.e[i] + c.e[i]; });
    const contested = ENERGY_TYPES.filter(t => demand[t] > SUPPLY_PER_TYPE);
    const sharedPairs = (sharedTypes(a, b) ? 1 : 0) + (sharedTypes(a, c) ? 1 : 0) + (sharedTypes(b, c) ? 1 : 0);
    const setupAvg = (a.setupRatio + b.setupRatio + c.setupRatio) / 3;
    const margem = Math.round(Math.sqrt((a.margin || 0) ** 2 + (b.margin || 0) ** 2 + (c.margin || 0) ** 2) / 3 * 10) / 10;
    return {
      total: Math.round(fastTeamScore(a, b, c) * 10) / 10,
      margin: margem,
      base: Math.round((a.score + b.score + c.score) / 3 * 10) / 10,
      coverage: {
        dmg: Math.max(a.norm.offense, b.norm.offense, c.norm.offense),
        ctl: Math.max(a.norm.control, b.norm.control, c.norm.control),
        def: Math.max(a.norm.defense, b.norm.defense, c.norm.defense, a.norm.support, b.norm.support, c.norm.support),
        value: coverageValue(a, b, c),
      },
      synergy: { list: synergyList(team), value: synergyValue(a, b, c) },
      clash: { demand, contested, sharedPairs, penalty: clashValue(a, b, c) },
      setupPen: setupAvg > 0.4 ? (setupAvg - 0.4) / 0.6 : 0,
      members: team,
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Busca de times
  // ---------------------------------------------------------------------------

  function suggestTeams(profiles, opts) {
    opts = opts || {};
    const byName = new Map(profiles.map(p => [p.name, p]));
    const locked = (opts.locked || []).map(n => byName.get(n)).filter(Boolean);
    const banned = new Set(opts.banned || []);
    const allowClash = opts.allowClash !== false;
    const allowVariants = !!opts.allowVariants;
    const extra = typeof opts.extra === 'function' ? opts.extra : null; // bônus adicional (ex.: missões)
    const poolSize = opts.poolSize || 70;
    const limit = opts.limit || 20;

    let pool = profiles.filter(p => !banned.has(p.name) && !locked.some(l => l.name === p.name));
    if (opts.allowed && opts.allowed.length) { const al = new Set(opts.allowed); pool = pool.filter(p => al.has(p.name)); }
    pool = pool.slice(0, poolSize); // profiles já vêm ordenados por nota
    // sem choque: candidato não pode compartilhar tipo específico com quem já está no time
    if (!allowClash && locked.length) pool = pool.filter(p => locked.every(l => !sharedTypes(l, p)));
    if (!allowVariants && locked.length) pool = pool.filter(p => locked.every(l => l.vkey !== p.vkey));

    const need = 3 - locked.length;
    const heap = []; // guarda só os melhores (limit * 8) para depois diversificar
    const keep = Math.min(4000, Math.max(limit * 60, 400));
    let worst = -Infinity;
    const push = (a, b, c) => {
      if (!allowVariants && (a.vkey === b.vkey || a.vkey === c.vkey || b.vkey === c.vkey)) return;
      if (!allowClash && (sharedTypes(a, b) || sharedTypes(a, c) || sharedTypes(b, c)) && locked.length < 2) return;
      if (!allowClash && locked.length === 2 && (sharedTypes(a, c) || sharedTypes(b, c))) return;
      const s = fastTeamScore(a, b, c) + (extra ? extra(a, b, c) : 0);
      if (heap.length >= keep && s <= worst) return;
      heap.push({ s, a, b, c });
      if (heap.length > keep * 2) { heap.sort((x, y) => y.s - x.s); heap.length = keep; worst = heap[keep - 1].s; }
    };
    const n = pool.length;
    if (need === 0) push(locked[0], locked[1], locked[2]);
    else if (need === 1) for (let i = 0; i < n; i++) push(locked[0], locked[1], pool[i]);
    else if (need === 2) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) push(locked[0], pool[i], pool[j]);
    else for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) push(pool[i], pool[j], pool[k]);

    heap.sort((x, y) => y.s - x.s);
    const out = [];
    const count = new Map();
    const maxPer = opts.diverse ? (opts.maxPerChar || 4) : Infinity;
    for (const h of heap) {
      const team = [h.a, h.b, h.c];
      if (team.every(m => (count.get(m.name) || 0) < maxPer)) {
        const r = scoreTeam(team);
        r.bonus = extra ? Math.round(extra(h.a, h.b, h.c) * 10) / 10 : 0;
        r.total = Math.round((r.total + r.bonus) * 10) / 10;
        out.push(r);
        team.forEach(m => count.set(m.name, (count.get(m.name) || 0) + 1));
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  function explainTeam(r) {
    const lines = [];
    const e = r.clash.demand;
    lines.push(`Chakra: Tai ${e.Tai.toFixed(2)} | Blood ${e.Blood.toFixed(2)} | Nin ${e.Nin.toFixed(2)} | Gen ${e.Gen.toFixed(2)} (oferta ≈ 0.75/tipo/turno)`);
    if (r.clash.contested.length) lines.push(`Contenção em: ${r.clash.contested.join(', ')} (${r.clash.sharedPairs} par(es) compartilham tipo)`);
    else lines.push('Sem contenção de chakra relevante');
    const c = r.coverage;
    lines.push(`Papéis: dano ${(c.dmg * 100).toFixed(0)}% | controle ${(c.ctl * 100).toFixed(0)}% | defesa/suporte ${(c.def * 100).toFixed(0)}%`);
    for (const s of r.synergy.list.slice(0, 4)) lines.push(`Sinergia: ${s.a}${s.b ? ' + ' + s.b : ''} — ${s.why}`);
    if (r.setupPen > 0) lines.push('Aviso: time depende bastante de habilidades de preparação (início lento)');
    return lines;
  }

  return {
    ENERGY_TYPES, DEFAULT_WEIGHTS, scoreMargin, setWeights, getWeights, setTrainedWeights, getDefaultWeights, setOverrides, setKnownCombos, setWinrateMode,
    cleanText, parseSkill, applyOverride, profileChar, scoreChars, scoreTeam, suggestTeams, explainTeam, applyTier, variantKey, winrateScore, winrateConfidence,
    // utilitários de texto (usados pelo simulador)
    _text: { sentenceBounds, clauseAround, turnsIn, condOf, num, partialFactor, GENERIC_DODGE },
  };
});
