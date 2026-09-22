/*
 * NA Team Builder - sinal de "meta" a partir de fontes externas ao programa
 *
 *   1. Histórico de balanceamentos (data/balance-history.js, 113 patch notes desde 2023): personagens
 *      nerfados estavam fortes demais; buffados estavam fracos/pouco usados. Cada mudança é classificada
 *      como nerf/buff pelo tipo do post e, quando ambíguo ("Major Balance"), pelo texto.
 *   2. Fórum oficial (data/forum.js): menções de personagens e TRIOS recomendados nos posts de estratégia.
 *      Tópicos são classificados por contexto: missão (pedido de desbloqueio) ou força/ladder.
 *
 * Saída por personagem: { nerfs, buffs, pressure, timeline[], mentions, mentionsStrength, metaScore }
 * Saída geral: teams[] = trios recomendados na comunidade com contagem e data.
 * Funciona no navegador (window.NAMeta) e no Node.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.NAMeta = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ balanceamento
  const DOWN = /\b(down (from|to)|decreased|reduced|no longer|removed|lowered|nerf|increased cooldown|cooldown (is )?(now )?\d+,? up|now costs? (\d+ )?(an? )?(additional|more)|instead of (all|full)|only (once|one time)|less damage|less health)\b/i;
  const UP = /\b(up (from|to)|increased|boost|buff|now also|now additionally|no longer requires|reduced cooldown|cooldown (is )?(now )?\d+,? down|now costs? (\d+ )?less|improved|more damage|more health|new:)\b/i;

  function direction(change) {
    const t = String(change.type || '').toLowerCase();
    if (/nerf/.test(t)) return -1;
    if (/boost|buff/.test(t)) return 1;
    let d = 0;
    for (const s of change.skills || []) for (const x of s.text || []) {
      const down = DOWN.test(x), up = UP.test(x);
      if (down && !up) d--; else if (up && !down) d++;
    }
    return Math.sign(d);
  }
  function parseDate(s) { const d = new Date(String(s || '').replace(/^[A-Za-z]+,\s*/, '').replace(/(\d+)(st|nd|rd|th)\b/, '$1').replace(' at ', ' ')); return isNaN(d) ? null : d; }
  function recencyWeight(date, now) {
    if (!date) return 0.4;
    const months = (now - date) / (30 * 864e5);
    return months < 6 ? 1 : months < 18 ? 0.7 : 0.4;
  }

  // ------------------------------------------------------------------ nomes e apelidos
  const GENERIC = new Set(['path', 'pein', 'pain', 'edo', 'tensei', 'shinobi', 'alliance', 'body', 'double', 'true', 'form', 'young', 'cursed', 'seal', 'sennin', 'kyuubi', 'fuuton', 'hebi', 'mangekyou', 'susanoo', 'kazekage', 'shukaku', 'drunken', 'brothers', 'demon', 'classic', 'special', 'version', 'rehabilitated', 'desert', 'sand', 'rain', 'hokage', 'mizukage', 'raikage', 'tsuchikage', 'sandaime', 'nidaime', 'shodai', 'yondaime', 'masked', 'white', 'snake', 'female', 'animal', 'asura', 'human', 'preta', 'naraka', 'deva', 'hiruko', 'samehada', 'fusion', 'anbu', 'alternative', 'four', 'tail', 'hachibi', 'killer', 'red', 'the', 'and', 'of', 'art', 'tails', 'akatsuki', 'uzumaki', 'uchiha', 'hyuuga', 'nara', 'yamanaka', 'akimichi', 'aburame', 'inuzuka', 'haruno', 'hatake', 'namikaze', 'yakushi', 'hoshigaki', 'momochi', 'sarutobi', 'maito', 'gekko', 'mitarashi', 'umino', 'touji', 'akadou', 'tsurugi', 'yuhi', 'kinuta', 'tsuchi', 'abumi', 'nohara', 'hozuki', 'karatachi', 'yamashiro', 'morino', 'shimura', 'uzuki', 'senju', 'izumo', 'kotetsu', 'fukasaku', 'shima', 'ittan', 'nii', 'et']);
  // prefixos que identificam a versão quando aparecem antes do nome
  const PREFIX_HINTS = [
    [/(?:^|\W)(?:sa|shinobi alliance)\s*$/, /^shinobi alliance /], [/(?:^|\W)(?:et|edo|edo tensei)\s*$/, /^(edo tensei|et) /],
    [/(?:^|\W)young\s*$/, /^young /], [/(?:^|\W)(?:cs|cursed seal)\s*$/, /^cursed seal /], [/(?:^|\W)kyuubi\s*$/, /^(four tail )?kyuubi /],
    [/(?:^|\W)sennin\s*$/, /^sennin /], [/(?:^|\W)hebi\s*$/, /^hebi /], [/(?:^|\W)(?:ms|mangekyou)\s*$/, /^mangekyou /], [/(?:^|\W)susanoo\s*$/, /^(et )?susanoo /],
    [/(?:^|\W)kazekage\s*$/, /^kazekage /], [/(?:^|\W)shukaku\s*$/, /^shukaku /], [/(?:^|\W)drunken\s*$/, /^drunken /], [/(?:^|\W)anbu\s*$/, /^anbu /],
    [/(?:^|\W)hiruko\s*$/, /^hiruko /], [/(?:^|\W)true form\s*$/, /^true form /], [/(?:^|\W)white snake\s*$/, /^white snake /], [/(?:^|\W)fuuton\s*$/, /^fuuton /],
  ];
  const EXTRA_ALIASES = { preta: 'Preta Path Pein (S)', naraka: 'Naraka Path Pein (S)', deva: 'Deva Path Pein (S)', asura: 'Asura Path Pein (S)', animal: 'Animal Path Pein (S)', human: 'Human Path Pein (S)', tobirama: 'Nidaime Hokage', hiruzen: 'Sandaime Hokage', nagato: 'Nagato (S)', pain: null, konan: 'Konan (S)', bee: 'Killer Bee (S)', zetsu: 'Zetsu (S)', chouza: 'Akimichi Chouza (S)', choza: 'Akimichi Chouza (S)', inoichi: 'Yamanaka Inoichi (S)', shikaku: 'Nara Shikaku (S)', hiashi: 'Hyuuga Hiashi (S)', ibiki: 'Morino Ibiki (S)', danzo: 'Shimura Danzo (S)', chiyo: 'Chiyo (S)', yugao: 'Uzuki Yugao', kushina: 'Uzumaki Kushina', mifune: 'Mifune (S)', chojuro: 'Chojuro (S)', suigetsu: 'Hozuki Suigetsu (S)', karin: 'Karin (S)', juugo: 'Juugo (S)', jugo: 'Juugo (S)', hidan: 'Hidan (S)', kakuzu: 'Kakuzu (S)', deidara: 'Deidara (S)', sasori: 'Sasori of the Red Sand (S)', darui: 'Darui (S)', omoi: 'Omoi (S)', shee: 'Shee (S)', ao: 'Ao (S)', dodai: 'Dodai (S)', akatsuchi: 'Akatsuchi (S)', kurotsuchi: 'Kurotsuchi (S)', kitsuchi: 'Kitsuchi (S)', yugito: 'Nii Yugito (S)', utakata: 'Utakata (S)', guren: 'Guren (S)', torune: 'Aburame Torune (S)', tsume: 'Inuzuka Tsume (S)', yamato: 'Yamato (S)', sai: 'Sai (S)', maki: 'Maki (S)', tobi: 'Tobi (S)', madara: 'Uchiha Madara', hashirama: 'Senju Hashirama', shisui: 'Uchiha Shisui (S)', fu: 'Yamanaka Fu (S)', aoba: 'Yamashiro Aoba (S)', pakura: 'Edo Tensei Pakura (S)', hanzo: 'Edo Tensei Hanzo (S)', mangetsu: 'Edo Tensei Mangetsu (S)', jinpachi: 'Edo Tensei Jinpachi (S)', jinin: 'Edo Tensei Jinin (S)', ameyuri: 'Edo Tensei Ameyuri (S)', fuguki: 'Edo Tensei Fuguki (S)', kuriarare: 'Edo Tensei Kuriarare (S)', kinkaku: 'Edo Tensei Kinkaku (S)', ginkaku: 'Edo Tensei Ginkaku (S)', muu: 'Edo Tensei Muu (S)', rasa: 'Edo Tensei Rasa (S)', yota: 'Edo Tensei Yota (S)', roshi: 'Edo Tensei Roshi (S)', fuu: 'Edo Tensei Fuu (S)', yagura: 'Karatachi Yagura', raikage: 'Raikage (S)', mizukage: 'Mizukage (S)', tsuchikage: 'Tsuchikage (S)', hokage: null, minato: 'Namikaze Minato', kabuto: 'Yakushi Kabuto', kakashi: 'Hatake Kakashi', kiba: 'Inuzuka Kiba', shino: 'Aburame Shino', hinata: 'Hyuuga Hinata', shikamaru: 'Nara Shikamaru', chouji: 'Akimichi Chouji', choji: 'Akimichi Chouji', ino: 'Yamanaka Ino', neji: 'Hyuuga Neji', lee: 'Rock Lee', gaara: 'Gaara of the Desert', naruto: 'Uzumaki Naruto', sasuke: 'Uchiha Sasuke', sakura: 'Haruno Sakura', itachi: 'Uchiha Itachi', kisame: 'Hoshigaki Kisame', zabuza: 'Momochi Zabuza', asuma: 'Sarutobi Asuma', gai: 'Maito Gai', guy: 'Maito Gai', kurenai: 'Yuhi Kurenai', jiraiya: 'Jiraiya', tsunade: 'Tsunade', orochimaru: 'Orochimaru', anko: 'Mitarashi Anko', shizune: 'Shizune', hayate: 'Gekko Hayate', iruka: 'Umino Iruka', mizuki: 'Touji Mizuki', obito: 'Uchiha Obito', rin: 'Nohara Rin', hanabi: 'Hyuuga Hanabi', haku: 'Haku', zaku: 'Abumi Zaku', kin: 'Tsuchi Kin', dosu: 'Kinuta Dosu', tayuya: 'Tayuya', kidoumaru: 'Kidoumaru', kidomaru: 'Kidoumaru', jiroubou: 'Jiroubou', jirobo: 'Jiroubou', sakon: 'Sakon', kimimaro: 'Kimimaro', kankuro: 'Kankuro', temari: 'Temari', tenten: 'Tenten', baki: 'Baki', yoroi: 'Akadou Yoroi', misumi: 'Tsurugi Misumi', oboro: 'Oboro', shigure: 'Shigure' };

  function buildResolver(characters) {
    const names = characters.map(c => c.name);
    const lowerToName = new Map(names.map(n => [n.toLowerCase(), n]));
    const byGiven = new Map(); // token -> [nomes]
    for (const n of names) {
      const parts = n.toLowerCase().replace(/\s*\(.*\)\s*$/, '').split(/\s+/);
      for (const p of parts) { if (p.length < 3 || GENERIC.has(p)) continue; if (!byGiven.has(p)) byGiven.set(p, []); byGiven.get(p).push(n); }
    }
    const fullNames = names.map(n => n.toLowerCase()).sort((a, b) => b.length - a.length);
    const baseOf = list => list.find(n => !/\(|^(shinobi alliance|edo tensei|et|young|cursed seal|kyuubi|four tail|sennin|hebi|mangekyou|susanoo|kazekage|shukaku|drunken|anbu|hiruko|true form|white snake|fuuton|samehada|masked)\b/i.test(n)) || list.find(n => /^[^(]*\(S\)$/.test(n) && !/^(shinobi alliance|edo tensei|et) /i.test(n)) || list[0];

    // devolve [{name, pos}] das menções num texto
    function mentions(text) {
      const low = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9()\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
      const out = []; const taken = [];
      const free = (a, b) => taken.every(([x, y]) => b <= x || a >= y);
      // 1) nomes completos
      for (const fn of fullNames) {
        let i = low.indexOf(' ' + fn + ' ');
        while (i >= 0) { if (free(i, i + fn.length + 1)) { out.push({ name: lowerToName.get(fn), pos: i }); taken.push([i, i + fn.length + 1]); } i = low.indexOf(' ' + fn + ' ', i + 1); }
      }
      // 2) apelidos / primeiros nomes, com desambiguação de versão pelo contexto
      const re = /\s([a-z]+)(?=\s)/g; let m;
      while ((m = re.exec(low)) !== null) {
        const tok = m[1], start = m.index, end = start + tok.length + 1;
        if (!free(start, end)) continue;
        let cands = byGiven.get(tok);
        if (!cands && EXTRA_ALIASES[tok]) cands = [EXTRA_ALIASES[tok]];
        if (!cands || !cands.length || (EXTRA_ALIASES[tok] === null)) continue;
        const before = low.slice(Math.max(0, start - 20), start + 1), after = low.slice(end, end + 8);
        let pick = null;
        const sVersion = cands.find(n => /\(S\)$/.test(n) && !/^(shinobi alliance|edo tensei|et|young|cursed seal|kyuubi|four tail|sennin|hebi|mangekyou|susanoo|kazekage|shukaku|drunken|anbu|hiruko|true form|white snake|fuuton|samehada) /i.test(n));
        if (/^\s*\(?s\)?(\s|$)/.test(after) && sVersion) pick = sVersion;
        if (!pick) for (const [hint, prefix] of PREFIX_HINTS) { if (hint.test(before)) { const c = cands.find(n => prefix.test(n.toLowerCase())); if (c) { pick = c; break; } } }
        if (!pick) pick = EXTRA_ALIASES[tok] && cands.includes(EXTRA_ALIASES[tok]) ? EXTRA_ALIASES[tok] : baseOf(cands);
        if (pick) { out.push({ name: pick, pos: start }); taken.push([start, end]); }
      }
      out.sort((a, b) => a.pos - b.pos);
      return out;
    }
    return { mentions };
  }

  const MISSION_RE = /mission|unlock|miss[aã]o|desbloq|liberar|how (do|to) (i )?(get|unlock)|in a row|streak with|win \d+/i;
  const STRENGTH_RE = /ladder|streak|rank|tier|meta|best team|strong|\bop\b|broken|counter|nerf|forte|melhor time|time bom|beginner|good team|ladder team/i;
  function topicContext(t) {
    const title = t.title || '';
    if (MISSION_RE.test(title)) return 'mission';
    if (STRENGTH_RE.test(title)) return 'strength';
    return 'general';
  }

  // Trios: três personagens distintos mencionados em sequência próxima numa mesma linha
  function extractTeams(post, resolver) {
    const teams = [];
    for (const line of String(post.text || '').split(/\n|\.\s|;|\|/)) {
      const ms = resolver.mentions(line);
      for (let i = 0; i + 2 < ms.length; i++) {
        const a = ms[i], b = ms[i + 1], c = ms[i + 2];
        if (c.pos - a.pos > 90) continue;                         // muito espalhado: não é um time
        const set = new Set([a.name, b.name, c.name]);
        if (set.size < 3) continue;
        teams.push([a.name, b.name, c.name].sort());
      }
    }
    return teams;
  }

  // ------------------------------------------------------------------ agregação
  function build(balance, forum, characters, opts) {
    opts = opts || {};
    const now = opts.now ? new Date(opts.now) : new Date();
    const canon = new Map(characters.map(c => [c.name.toLowerCase(), c.name]));
    const stats = new Map();
    const get = name => { let s = stats.get(name); if (!s) { s = { name, nerfs: 0, buffs: 0, neutral: 0, pressure: 0, lastChange: null, lastDir: 0, timeline: [], mentions: 0, mentionsStrength: 0, mentionsRecent: 0, teamCount: 0 }; stats.set(name, s); } return s; };

    // balanceamentos
    for (const p of balance || []) {
      const date = parseDate(p.date); const w = recencyWeight(date, now);
      for (const ch of p.changes || []) {
        const name = canon.get(String(ch.name || '').trim().toLowerCase());
        if (!name) continue;
        const dir = direction(ch); const s = get(name);
        if (dir < 0) { s.nerfs++; s.pressure += w; } else if (dir > 0) { s.buffs++; s.pressure -= w; } else s.neutral++;
        s.timeline.push({ date: p.date, ts: date ? date.getTime() : 0, title: p.title, type: ch.type, dir, skills: ch.skills || [] });
        if (!s.lastChange || (date && date.getTime() > s.lastChange)) { s.lastChange = date ? date.getTime() : 0; s.lastDir = dir; }
      }
    }

    // fórum: menções e trios
    const teamMap = new Map();
    if (forum && forum.topics) {
      const resolver = buildResolver(characters);
      for (const t of forum.topics) {
        const ctx = topicContext(t);
        const tdate = parseDate(t.createdAt); const recent = tdate && (now - tdate) < 365 * 864e5;
        const found = new Map(); // nome -> peso máximo (staff conta mais)
        const roleWeight = p => /admin|developer|moderator|staff|owner/i.test(p && p.role || '') ? 3 : 1;
        for (const m of resolver.mentions(t.title || '')) found.set(m.name, Math.max(found.get(m.name) || 0, 1));
        for (const p of t.posts || []) for (const m of resolver.mentions(p.text || '')) found.set(m.name, Math.max(found.get(m.name) || 0, roleWeight(p)));
        for (const [n, w] of found) { const s = get(n); s.mentions++; if (ctx !== 'mission') s.mentionsStrength += w; if (recent && ctx !== 'mission') s.mentionsRecent += w; if (w > 1) s.staffMentions = (s.staffMentions || 0) + 1; }
        for (const p of t.posts || []) {
          const pdate = parseDate(p.date) || tdate;
          const w = roleWeight(p);
          for (const trio of extractTeams(p, resolver)) {
            const key = trio.join(' + ');
            const rec = teamMap.get(key) || { members: trio, count: 0, weighted: 0, recent: 0, staff: 0, contexts: {}, last: 0, lastDate: '', topics: new Set() };
            // recência: posts do último ano valem 1, de 1-2 anos 0.5, mais antigos 0.25 (o meta muda a cada balanceamento)
            const age = pdate ? (now - pdate) / (365 * 864e5) : 3;
            const rw = age < 1 ? 1 : age < 2 ? 0.5 : 0.25;
            rec.count++; rec.weighted += w; rec.recent += w * rw; if (w > 1) rec.staff++; rec.contexts[ctx] = (rec.contexts[ctx] || 0) + 1; rec.topics.add(t.title);
            if (pdate && pdate.getTime() > rec.last) { rec.last = pdate.getTime(); rec.lastDate = p.date || t.createdAt; }
            teamMap.set(key, rec);
            for (const n of trio) get(n).teamCount++;
          }
        }
      }
    }
    // trio "desatualizado": algum membro foi reformulado (rework/major changes) depois do último post que o citou
    const reworkAfter = (name, ts) => { const s = stats.get(name); return !!(s && s.timeline.some(x => x.ts > ts && /rework|major changes|full rework/i.test(x.type || ''))); };
    const teams = [...teamMap.values()].map(r => ({ ...r, topics: [...r.topics].slice(0, 5), recent: Math.round(r.recent * 100) / 100, stale: r.members.some(n => reworkAfter(n, r.last)) }))
      .sort((a, b) => b.recent - a.recent || b.weighted - a.weighted || b.last - a.last);

    // combos citados pelo staff: nos patch notes, o texto da mudança de A menciona outro personagem B
    // (ex.: "with Kakuzu this becomes...") e, no fórum, posts de staff que citam dois personagens na mesma frase
    const comboMap = new Map();
    const resolver = buildResolver(characters);
    // versões do mesmo personagem (Rock Lee / Rock Lee (S) / Drunken Lee) não formam combo
    const tokensOf = n => new Set(n.toLowerCase().replace(/\s*\(.*\)\s*$/, '').split(/\s+/).filter(t => t.length >= 3 && !GENERIC.has(t)));
    // mesma pessoa com outro nome (título/versão)
    const SAME_PERSON = [['Senju Hashirama', 'Shodai Hokage', 'Senju Hashirama (Special Version)'], ['Namikaze Minato', 'Yondaime Hokage'], ['Uchiha Obito', 'Tobi (S)', 'Masked Man'], ['Nidaime Hokage'], ['Sandaime Hokage'],
      ['Nagato (S)', 'Edo Tensei Nagato (S)', 'Animal Path Pein (S)', 'Female Animal Path Pein (S)', 'Asura Path Pein (S)', 'Human Path Pein (S)', 'Preta Path Pein (S)', 'Naraka Path Pein (S)', 'Deva Path Pein (S)']];
    const personGroup = new Map(); SAME_PERSON.forEach((g, i) => g.forEach(n => personGroup.set(n, i)));
    const sameCharacter = (a, b) => { if (personGroup.has(a) && personGroup.get(a) === personGroup.get(b)) return true; const ta = tokensOf(a); for (const t of tokensOf(b)) if (ta.has(t)) return true; return false; };
    const COMBO_CUE = /\b(combo|combos|together|synerg|pair|paired|alongside|along side|with .{0,25}(on the same team|in the same team|team)|team of|\+)/i;
    const addCombo = (a, b, src) => {
      if (!a || !b || a === b || sameCharacter(a, b)) return;
      if (!COMBO_CUE.test(src.text || '')) return;
      const key = [a, b].sort().join('|');
      const rec = comboMap.get(key) || { members: [a, b].sort(), count: 0, sources: [] };
      rec.count++; if (rec.sources.length < 4) rec.sources.push(src); comboMap.set(key, rec);
    };
    for (const p of balance || []) {
      for (const ch of p.changes || []) {
        const a = canon.get(String(ch.name || '').trim().toLowerCase());
        if (!a) continue;
        for (const s of ch.skills || []) for (const txt of s.text || []) {
          for (const m of resolver.mentions(txt)) if (m.name !== a) addCombo(a, m.name, { date: p.date, title: p.title, text: txt.slice(0, 200), kind: 'patch' });
        }
      }
    }
    if (forum && forum.topics) for (const t of forum.topics) for (const post of t.posts || []) {
      if (/^member$/i.test(post.role || 'Member')) continue;
      for (const sent of String(post.text || '').split(/[.\n]/)) {
        const ms = resolver.mentions(sent);
        const uniq = [...new Set(ms.map(m => m.name))];
        if (uniq.length === 2 || uniq.length === 3) for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) addCombo(uniq[i], uniq[j], { date: post.date, title: t.title, text: sent.trim().slice(0, 200), kind: 'staff-forum', author: post.author });
      }
    }
    const combos = [...comboMap.values()].sort((a, b) => b.count - a.count);

    // nota de meta (0-100): 50 = sem sinal
    const all = [...stats.values()];
    const maxMent = Math.max(1, ...all.map(s => s.mentionsRecent));
    for (const s of all) {
      const pressurePart = Math.max(-4, Math.min(4, s.pressure)) * 8;                 // -32..+32 (nerfado = forte)
      const mentionPart = forum ? Math.sqrt(s.mentionsRecent / maxMent) * 15 : 0;       // 0..15 (citado em contexto de força/geral)
      s.metaScore = Math.round(Math.max(0, Math.min(100, 50 + pressurePart + mentionPart)) * 10) / 10;
      s.timeline.sort((a, b) => b.ts - a.ts);
    }
    return { stats, teams, combos, byName: name => stats.get(name) || null, hasForum: !!(forum && forum.topics), hasBalance: !!(balance && balance.length) };
  }

  return { build, direction, buildResolver, extractTeams, topicContext };
});
