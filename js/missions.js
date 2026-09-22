/*
 * NA Team Builder - missões
 *
 * Casa os objetivos das missões (data/missions.js) com um time e, opcionalmente,
 * com o estado da conta (data/account.js: concluídas/disponíveis/progresso).
 *
 * Regras (iguais às do site, função checkMissionGoals do bundle):
 *   - goal.with = lista de personagens  -> basta UM deles estar no time
 *   - goal.with = nome de grupo         -> basta um membro do grupo no time
 *   - goal.sameTeam = true              -> TODOS os personagens de `with` no time
 *   - goal.type = 'useSkill'            -> o dono da habilidade precisa estar no time
 *     (o personagem vem do texto "Use <Personagem>'s "<Skill>"..." ou do nome da skill)
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.NAMissions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Manual "The Ninja Ladder": rank por nível
  const RANKS = [
    { name: 'Academy Student', level: 1 }, { name: 'Genin', level: 6 }, { name: 'Chuunin', level: 11 }, { name: 'Missing-Nin', level: 16 },
    { name: 'Anbu', level: 21 }, { name: 'Jounin', level: 26 }, { name: 'Sannin', level: 31 }, { name: 'Jinchuuriki', level: 36 },
    { name: 'Akatsuki', level: 41 }, { name: 'Kage', level: 46 },
  ];
  const rankForLevel = level => { let r = RANKS[0]; for (const x of RANKS) if (level >= x.level) r = x; return r; };

  // Peso por tipo de objetivo: sequências exigem um time bom; "vencer N" e "usar skill N vezes" vêm com o tempo.
  function goalWeight(g) {
    if (g.type === 'useSkill') return 0.3;
    if (g.type === 'win') { if (g.isrow) return g.sameTeam ? 4 : 3; return g.sameTeam ? 1.5 : 0.6; }
    return 0.5;
  }

  function parseProgress(text) {
    const m = String(text || '').match(/(\d+)\s*(?:\/|of|de)\s*(\d+)/i);
    return m ? { done: +m[1], total: +m[2] } : null;
  }

  // Dono de uma habilidade de useSkill
  function skillOwner(goal, skillIndex) {
    const t = String(goal.text || '');
    let m = t.match(/^Use\s+(.+?)(?:'s|')\s+"/);
    if (m) return m[1].trim();
    m = t.match(/\busing\s+(.+?)(?:'s|')\s+"/);
    if (m) return m[1].trim();
    m = t.match(/^Use\s+"[^"]+"\s+(?:of|from)\s+(.+?)\s+\d+/);
    if (m) return m[1].trim();
    const s = String(goal.with && goal.with[0] || '').replace(/[+_-].*$/, '');
    return skillIndex.get(s.toLowerCase()) || null;
  }

  // Descrição legível de um objetivo (lang = 'pt' ou 'en')
  function describeGoal(goal, owner, lang) {
    const en = lang === 'en';
    if (!en && goal.textBR) return goal.textBR;
    if (goal.text && (en || goal.type !== 'win')) return goal.text;
    const who = Array.isArray(goal.with) ? goal.with.join(goal.sameTeam ? ' + ' : (en ? ' or ' : ' ou ')) : (en ? `any of "${goal.with}"` : `qualquer um de "${goal.with}"`);
    if (goal.type === 'win') {
      if (en) return `Win ${goal.value} battle${goal.value > 1 ? 's' : ''}${goal.isrow ? ' in a row' : ''} with ${who}${goal.sameTeam ? ' on the same team' : ''}`;
      return `Vencer ${goal.value} partida${goal.value > 1 ? 's' : ''}${goal.isrow ? ' seguidas' : ''} com ${who}${goal.sameTeam ? ' no mesmo time' : ''}`;
    }
    if (goal.type === 'useSkill') return en ? `Use "${goal.with[0]}"${owner ? ' of ' + owner : ''} ${goal.value} times` : `Usar "${goal.with[0]}"${owner ? ' de ' + owner : ''} ${goal.value} vezes`;
    return goal.text || JSON.stringify(goal);
  }

  /*
   * Constrói o índice de objetivos "ativos".
   *   data      = { groups, missions }
   *   characters= lista de personagens (para resolver donos de skills)
   *   account   = data/account.js (opcional)
   *   opts.includeUnavailable: incluir missões que a conta ainda não liberou (padrão: false se houver conta)
   */
  function buildIndex(data, characters, account, opts) {
    opts = opts || {};
    const groups = data.groups || {};
    const skillIndex = new Map();
    const catalog = new Set((characters || []).map(c => c.name));
    const allNames = [...catalog];
    for (const c of characters || []) for (const s of c.skills || []) if (!skillIndex.has(s.name.toLowerCase())) skillIndex.set(s.name.toLowerCase(), c.name);
    // corrige pequenos erros de digitação dos nomes no bundle do site ("Chiyo" -> "Chiyo (S)", ")" sobrando)
    const fixName = n => {
      if (catalog.has(n)) return n;
      const tries = [n.replace(/\)+$/, ')'), n.replace(/\)$/, ''), n + ' (S)', n.replace(/ \(S\)$/, '')];
      for (const t of tries) if (catalog.has(t)) return t;
      return n;
    };
    const fixList = list => list.map(fixName);
    const groupMembers = g => g === 'All Characters' ? allNames : fixList(groups[g] || []);

    const goals = [];        // objetivos ativos
    const missions = [];     // missões ativas (com status)
    for (const m of data.missions) {
      const st = account && account.missions ? account.missions[m.name] : null;
      let status = 'disponivel';
      if (st) {
        if (st.isCompleted) status = 'concluida';
        else if (!st.isAvailable) status = st.isLevelAvailable === false ? 'falta-rank' : 'bloqueada';
      }
      const active = status === 'disponivel' || (opts.includeUnavailable && status !== 'concluida');
      const mi = { mission: m, status, goals: [], progress: st ? st.progress : [], hard: (m.missionGoals || []).some(g => g.isrow) };
      m.missionGoals.forEach((g, gi) => {
        const owner = g.type === 'useSkill' ? skillOwner(g, skillIndex) : null;
        const prog = st && st.progress && st.progress[gi] ? st.progress[gi] : null;
        const goal = {
          id: goals.length, mission: m, missionInfo: mi, goal: g, gi, owner,
          text: describeGoal(g, owner, 'pt'),
          textEn: describeGoal(g, owner, 'en'),
          progressText: prog ? prog.text : null,
          progress: prog ? parseProgress(prog.text) : null,
          done: !!(prog && prog.isCompleted),
          active: active && !(prog && prog.isCompleted),
          weight: goalWeight(g), inRow: !!g.isrow,
          // personagens que satisfazem sozinhos (any-of) ou todos necessários (sameTeam)
          anyOf: null, allOf: null,
        };
        if (g.type === 'useSkill') goal.anyOf = owner ? [fixName(owner)] : [];
        else if (g.sameTeam) goal.allOf = Array.isArray(g.with) ? fixList(g.with) : [];
        else if (Array.isArray(g.with)) goal.anyOf = fixList(g.with);
        else goal.anyOf = groupMembers(g.with);
        mi.goals.push(goal);
        goals.push(goal);
      });
      missions.push(mi);
    }
    // cadeia de pré-requisitos: requires (diretos), dependents (quem exige esta) e downstream (transitivo, com profundidade)
    const byMissionName = new Map(missions.map(mi => [mi.mission.name, mi]));
    for (const mi of missions) { mi.dependents = []; mi.requires = (mi.mission.completedRequeriments || []).map(n => byMissionName.get(n)).filter(Boolean); }
    for (const mi of missions) for (const req of mi.requires) req.dependents.push(mi);
    for (const mi of missions) {
      const seen = new Map(); const stack = mi.dependents.map(d => [d, 1]);
      while (stack.length) { const [d, depth] = stack.pop(); if (seen.has(d) && seen.get(d) <= depth) continue; seen.set(d, depth); for (const x of d.dependents) if (x !== mi) stack.push([x, depth + 1]); }
      mi.downstream = [...seen.entries()].map(([d, depth]) => ({ mi: d, depth })).sort((a, b) => a.depth - b.depth);
    }

    // bitmask por personagem sobre os objetivos any-of ativos
    const words = Math.ceil(goals.length / 32) || 1;
    const charMask = new Map();
    const maskOf = name => { let mk = charMask.get(name); if (!mk) { mk = new Uint32Array(words); charMask.set(name, mk); } return mk; };
    const allOfGoals = [];
    for (const goal of goals) {
      if (!goal.active) continue;
      if (goal.anyOf) for (const n of goal.anyOf) maskOf(n)[goal.id >> 5] |= (1 << (goal.id & 31));
      else if (goal.allOf && goal.allOf.length) allOfGoals.push(goal);
    }
    const empty = new Uint32Array(words);

    function popcount(x) { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }
    const weights = new Float32Array(goals.length); goals.forEach(g => { weights[g.id] = g.weight; });

    // conta rápida (usada na busca combinatória): nº de objetivos ativos que o trio avança
    function countForNames(a, b, c) {
      const ma = charMask.get(a) || empty, mb = charMask.get(b) || empty, mc = charMask.get(c) || empty;
      let n = 0;
      for (let i = 0; i < words; i++) n += popcount(ma[i] | mb[i] | mc[i]);
      for (let i = 0; i < allOfGoals.length; i++) {
        const need = allOfGoals[i].allOf; let ok = true;
        for (let j = 0; j < need.length; j++) if (need[j] !== a && need[j] !== b && need[j] !== c) { ok = false; break; }
        if (ok) n++;
      }
      return n;
    }
    // soma PONDERADA (sequências pesam muito mais que "usar skill N vezes")
    function weightForNames(a, b, c) {
      const ma = charMask.get(a) || empty, mb = charMask.get(b) || empty, mc = charMask.get(c) || empty;
      let s = 0;
      for (let i = 0; i < words; i++) { let w = (ma[i] | mb[i] | mc[i]) >>> 0; while (w) { const low = w & -w; const bit = 31 - Math.clz32(low); s += weights[i * 32 + bit]; w ^= low; } }
      for (let i = 0; i < allOfGoals.length; i++) {
        const need = allOfGoals[i].allOf; let ok = true;
        for (let j = 0; j < need.length; j++) if (need[j] !== a && need[j] !== b && need[j] !== c) { ok = false; break; }
        if (ok) s += allOfGoals[i].weight;
      }
      return s;
    }

    // lista detalhada para exibir
    function goalsForTeam(names) {
      const set = new Set(names);
      const out = [];
      for (const goal of goals) {
        if (!goal.active) continue;
        let ok = false;
        if (goal.anyOf) ok = goal.anyOf.some(n => set.has(n));
        else if (goal.allOf && goal.allOf.length) ok = goal.allOf.every(n => set.has(n));
        if (ok) out.push(goal);
      }
      const missionsTouched = new Set(out.map(g => g.mission.name));
      out.sort((x, y) => y.weight - x.weight);
      return { goals: out, missionsTouched: [...missionsTouched], weight: out.reduce((s, g) => s + g.weight, 0), inRow: out.filter(g => g.inRow).length };
    }

    // esforço esperado de um objetivo, em partidas, com probabilidade p de vencer cada uma
    function expectedMatches(g, p) {
      const total = g.goal.value || (g.progress ? g.progress.total : 1);
      const done = g.done ? total : (g.progress ? g.progress.done : 0);
      const rem = Math.max(0, total - done);
      if (!rem) return 0;
      if (g.goal.type === 'win') { if (g.goal.isrow) { const q = Math.pow(p, rem); return (1 - q) / ((1 - p) * q); } return rem / p; }   // corrida de N vitórias seguidas
      if (g.goal.type === 'useSkill') return rem / 2;   // ~2 usos por partida
      return rem;
    }
    // prioridade das missões disponíveis: valor (personagem liberado + o que destrava na cadeia) ÷ esforço (partidas esperadas)
    function priority(opts) {
      const scoreOf = (opts && opts.scoreOf) || (() => null);
      const pDefault = (opts && opts.p) || 0.55;
      const pFor = opts && opts.pFor;   // (mi, goal) => { p, team } com a taxa real de um time seu que avança aquele objetivo, ou null
      const worth = name => { const s = name ? scoreOf(name) : null; return s == null ? null : Math.max(0, s - 40); };   // nota acima de 40: fraco vale pouco
      const rows = [];
      for (const mi of missions) {
        if (mi.status !== 'disponivel') continue;
        const ownScore = mi.mission.unlockedCharacter ? scoreOf(mi.mission.unlockedCharacter) : null;
        const own = worth(mi.mission.unlockedCharacter);
        let chain = 0, best = null, opens = 0;
        for (const { mi: d, depth } of mi.downstream) {
          if (d.status === 'concluida') continue;
          opens++;
          const w = worth(d.mission.unlockedCharacter);
          if (w == null) continue;
          chain += w * Math.pow(0.5, depth);
          const s = scoreOf(d.mission.unlockedCharacter);
          if (!best || s > best.score) best = { name: d.mission.unlockedCharacter, score: s, mission: d.mission.name, depth };
        }
        const active = mi.goals.filter(g => !g.done);
        // esforço por objetivo com a taxa do seu melhor time para ELE (objetivos diferentes podem pedir times diferentes)
        const efforts = active.map(g => { const real = pFor ? pFor(mi, g) : null; const p = real && real.p ? real.p : pDefault; return { g, e: expectedMatches(g, p), real, p }; }).sort((a, b) => b.e - a.e);
        const effort = Math.max(1, efforts.length ? efforts[0].e : 1);
        const value = (own || 0) + chain;
        rows.push({ mi, own, ownScore, chain: Math.round(chain * 10) / 10, best, opens, effort: Math.round(effort), hardest: efforts.length ? efforts[0].g : null, value: Math.round(value * 10) / 10, ratio: Math.round(value / effort * 100) / 100, rate: efforts.length ? { p: efforts[0].p, real: !!(efforts[0].real && efforts[0].real.p), team: efforts[0].real ? efforts[0].real.team : null } : { p: pDefault, real: false, team: null } });
      }
      rows.sort((a, b) => b.ratio - a.ratio || b.value - a.value);
      return rows;
    }

    return { goals, missions, groups, countForNames, weightForNames, goalsForTeam, expectedMatches, priority, activeGoalCount: goals.filter(g => g.active).length };
  }

  return { buildIndex, parseProgress, describeGoal, goalWeight, RANKS, rankForLevel };
});
