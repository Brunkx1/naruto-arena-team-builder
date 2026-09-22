/* NA Team Builder - interface (PT/EN) */
(function () {
  'use strict';

  const E = window.NAEngine;
  const I18N = window.NAI18N;
  const CHARS = window.NA_CHARACTERS;
  if (!Array.isArray(CHARS) || !CHARS.length) {   // primeira execução: os dados do jogo ainda não foram baixados
    document.addEventListener('DOMContentLoaded', () => {
      const main = document.querySelector('main');
      if (main) main.innerHTML = '<div class="card"><h2>Primeira execução</h2><p class="hint">Os dados do jogo ainda não foram baixados. Feche esta página e abra o programa com <code>node start.js</code> — ele baixa personagens, missões e patch notes (leva cerca de um minuto) e abre a interface sozinho.</p><p class="hint">First run: the game data has not been downloaded yet. Close this page and start the program with <code>node start.js</code>.</p></div>';
    });
    return;
  }
  const MISSIONS = window.NA_MISSIONS || null;   // data/missions.js
  const ACCOUNT = window.NA_ACCOUNT || null;     // data/account.js (opcional, gerado por scripts/download-account.js)
  const NEWS = Array.isArray(window.NA_NEWS) ? window.NA_NEWS : [];  // data/news.js
  const WINRATE = window.NA_WINRATE && Object.keys(window.NA_WINRATE).length ? window.NA_WINRATE : null; // data/winrate.js (oficial)
  const COMMUNITY = window.NA_COMMUNITY || null; // data/community.js (patch notes + fórum pré-computados)
  const TRAINED = window.NA_TRAINED_WEIGHTS && typeof window.NA_TRAINED_WEIGHTS === 'object' ? window.NA_TRAINED_WEIGHTS : null; // data/trained-weights.js
  const IMAGES = window.NA_IMAGES || {};          // data/img/index.js: URL -> arquivo local (scripts/download-images.js)
  const NR = window.NAResultados || null;
  const RESULTS = window.NA_RESULTADOS && ACCOUNT && window.NA_RESULTADOS.username && ACCOUNT.username && window.NA_RESULTADOS.username.toLowerCase() === ACCOUNT.username.toLowerCase() ? window.NA_RESULTADOS : null; // data/results.js
  const imgSrc = u => (u && IMAGES[u]) || u;
  const NM = window.NAMissions;
  const STORAGE_KEY = 'na-team-builder';
  const TIERS = ['', 'S', 'A', 'B', 'C', 'D', 'F'];
  const TAG_ORDER = ['aoe', 'pierce', 'affliction', 'invuln', 'counter', 'reflect', 'uncounterable', 'ignoreInvuln', 'ignoreStun', 'cleanse', 'amplify', 'invisible', 'noDefense', 'antiHeal', 'costUp', 'chakraGain'];

  // ------------------------------------------------------------------ estado
  const state = {
    lang: 'pt',
    bans: new Set(),
    tiers: {},
    owned: new Set(),          // vazio = nenhum marcado
    weights: {},
    locked: [null, null, null],
    opts: { allowClash: false, allowVariants: false, onlyOwned: false, diverse: true, pool: 100, limit: 20, missionWeight: 0, wrAdjusted: false, useTrained: true, teamFilter: 'all', guideDismissed: false },
    ownedFromAccount: null,    // carimbo do último import automático da conta
  };
  let missionIndex = null;     // NAMissions.buildIndex(...)
  let profiles = [];
  let byName = new Map();
  let pickerSlot = -1;
  let rankSort = { key: 'rank', dir: 1 };
  let lastTeams = null;        // último resultado de sugestões (para re-renderizar ao trocar idioma)

  const t = (key, vars) => I18N.t(state.lang, key, vars);
  const isEn = () => state.lang === 'en';
  const roleLabel = r => t('roles.' + r);
  const localeStr = () => (isEn() ? 'en-US' : 'pt-BR');

  function save() {
    const data = {
      lang: state.lang, bans: [...state.bans], tiers: state.tiers, owned: [...state.owned], weights: state.weights,
      locked: state.locked, opts: state.opts, ownedFromAccount: state.ownedFromAccount,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* ignora */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!d) return;
      state.lang = d.lang === 'en' ? 'en' : 'pt';
      state.bans = new Set(d.bans || []);
      state.tiers = d.tiers || {};
      state.owned = new Set(d.owned || []);
      state.weights = d.weights || {};
      state.locked = Array.isArray(d.locked) && d.locked.length === 3 ? d.locked : [null, null, null];
      state.opts = { ...state.opts, ...(d.opts || {}) };
      state.ownedFromAccount = d.ownedFromAccount || null;
      state._missionWeightSaved = !!(d.opts && 'missionWeight' in d.opts);
    } catch (e) { /* ignora */ }
  }

  function recompute() {
    E.setTrainedWeights(TRAINED && state.opts.useTrained !== false ? TRAINED : null);
    E.setWeights(state.weights);
    E.setOverrides(window.NA_SKILL_OVERRIDES || {});
    E.setKnownCombos(COMMUNITY && COMMUNITY.combos ? COMMUNITY.combos : []);
    E.setWinrateMode(state.opts.wrAdjusted ? 'adjusted' : 'raw');
    profiles = E.scoreChars(CHARS, state.tiers, WINRATE);
    byName = new Map(profiles.map(p => [p.name, p]));
    if (MISSIONS && NM) missionIndex = NM.buildIndex(MISSIONS, CHARS, ACCOUNT, {});
  }

  // Importa "personagens que tenho" da conta (todos menos os bloqueados)
  function applyAccountOwned(force) {
    if (!ACCOUNT || !Array.isArray(ACCOUNT.lockedChars)) return false;
    // reimporta quando os dados da conta OU o catálogo de personagens mudam
    const stamp = ACCOUNT.fetchedAt + '|' + CHARS.length + '|' + CHARS[CHARS.length - 1].name;
    if (!force && state.ownedFromAccount === stamp) return false;
    const locked = new Set(ACCOUNT.lockedChars);
    state.owned = new Set(CHARS.map(c => c.name).filter(n => !locked.has(n)));
    state.ownedFromAccount = stamp;
    if (state.owned.size) state.opts.onlyOwned = true;
    save();
    return true;
  }

  function renderAccountChip() {
    const chip = $('#account-chip');
    if (!ACCOUNT) { chip.style.display = 'none'; return; }
    const pr = ACCOUNT.profile || {};
    const when = ACCOUNT.fetchedAt ? new Date(ACCOUNT.fetchedAt).toLocaleDateString(localeStr()) : '';
    chip.textContent = t('account.chip', {
      user: ACCOUNT.username, level: pr.level != null ? t('account.level', { n: pr.level }) : '', rank: pr.rank ? ' · ' + pr.rank : '',
      locked: ACCOUNT.lockedChars.length, date: when,
    });
    chip.style.display = '';
  }

  // ------------------------------------------------------------------ util
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v != null) n.setAttribute(k, v);
    }
    for (const c of children) if (c != null) n.append(c);
    return n;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function portrait(p, cls) {
    // local (data/img) se baixada; senão a URL original sem Referer (o imgur devolve 403 com Referer de localhost)
    const img = el('img', { class: 'portrait ' + (cls || ''), referrerpolicy: 'no-referrer', src: imgSrc(p.url), alt: p.name, loading: 'lazy', title: p.name });
    img.addEventListener('error', () => { if (p.url && img.getAttribute('src') !== p.url) { img.src = p.url; return; } img.removeAttribute('src'); img.alt = p.name.slice(0, 2); });
    return img;
  }
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function energyPills(p) {
    const box = el('span');
    if (!p.specificTypes.size) box.append(el('span', { class: 'pill Random' }, 'Random'));
    for (const x of ['Tai', 'Blood', 'Nin', 'Gen']) if (p.specificTypes.has(x)) box.append(el('span', { class: 'pill ' + x }, x));
    return box;
  }
  function tierTag(p) {
    return p.tierOverride ? el('span', { class: 'tier ' + p.tierOverride }, p.tierOverride) : el('span', { class: 'muted' }, '–');
  }
  const goalText = g => (isEn() ? g.textEn : g.text);
  const skillDesc = s => (isEn() ? s.description : (s.descriptionBR || s.description));

  // ------------------------------------------------------------------ idioma
  function setLang(lang) {
    state.lang = lang === 'en' ? 'en' : 'pt';
    save();
    I18N.applyStatic(state.lang);
    renderAccountChip();
    renderSlots();
    renderWeights();
    if (lastTeams) renderTeams(lastTeams);
    renderCommunityTeams();
    renderLadderTeams();
    renderResults();
    const active = $$('nav button[data-tab]').find(b => b.classList.contains('active'));
    if (active) renderTab(active.dataset.tab);
    $('#detail-bg').classList.remove('open');
    document.dispatchEvent(new CustomEvent('na:lang', { detail: state.lang }));
  }
  $('#lang-toggle').addEventListener('click', () => setLang(isEn() ? 'pt' : 'en'));

  // ------------------------------------------------------------------ abas
  function renderTab(tab) {
    if (tab === 'ranking') renderRanking();
    if (tab === 'chars') renderChars();
    if (tab === 'missions') renderMissions();
  }
  function showTab(tab) {
    $$('nav button[data-tab]').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
    $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab));
    renderTab(tab);
  }
  $$('nav button[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ------------------------------------------------------------------ slots
  function renderSlots() {
    const box = $('#slots');
    box.innerHTML = '';
    state.locked.forEach((name, i) => {
      const p = name && byName.get(name);
      const slot = el('div', { class: 'slot' + (p ? ' filled' : ''), onclick: () => openPicker(i) });
      if (p) {
        slot.append(portrait(p),
          el('div', { class: 'info' },
            el('div', { class: 'name' }, p.name),
            el('div', { class: 'hint' }, t('slot.score', { s: p.score, roles: p.roles.map(roleLabel).join(' / ') })),
            energyPills(p)),
          el('button', { class: 'small x', onclick: ev => { ev.stopPropagation(); state.locked[i] = null; save(); renderSlots(); } }, '✕'));
      } else {
        slot.append(el('div', { class: 'empty' }, t('slot.empty', { n: i + 1 })));
      }
      box.append(slot);
    });
  }

  // ------------------------------------------------------------------ picker
  function openPicker(slot) {
    pickerSlot = slot;
    $('#picker-search').value = '';
    renderPicker();
    $('#picker-bg').classList.add('open');
    setTimeout(() => $('#picker-search').focus(), 30);
  }
  function renderPicker() {
    const q = norm($('#picker-search').value.trim());
    const grid = $('#picker-grid');
    grid.innerHTML = '';
    const chosen = new Set(state.locked.filter(Boolean));
    const isDim = p => chosen.has(p.name) || state.bans.has(p.name) || (state.opts.onlyOwned && state.owned.size && !state.owned.has(p.name));
    // com "só personagens que eu tenho" ativo, os liberados vêm primeiro
    const list = profiles.slice().sort((a, b) => (isDim(a) ? 1 : 0) - (isDim(b) ? 1 : 0));
    for (const p of list) {
      if (q && !norm(p.name).includes(q)) continue;
      grid.append(el('div', { class: 'pick' + (isDim(p) ? ' dim' : ''), onclick: () => choose(p.name) },
        portrait(p, 'xs'), el('span', {}, p.name), el('span', { class: 'sc' }, p.score)));
    }
  }
  function choose(name) {
    if (pickerSlot < 0) return;
    // não permite o mesmo personagem em dois slots
    state.locked = state.locked.map((n, i) => (n === name && i !== pickerSlot) ? null : n);
    state.locked[pickerSlot] = name;
    save();
    $('#picker-bg').classList.remove('open');
    renderSlots();
  }
  $('#picker-search').addEventListener('input', renderPicker);
  $('#picker-close').addEventListener('click', () => $('#picker-bg').classList.remove('open'));
  $('#picker-bg').addEventListener('click', ev => { if (ev.target.id === 'picker-bg') ev.currentTarget.classList.remove('open'); });

  // ------------------------------------------------------------------ opções
  function bindOpts() {
    $('#opt-clash').checked = state.opts.allowClash;
    $('#opt-variants').checked = state.opts.allowVariants;
    $('#opt-owned').checked = state.opts.onlyOwned;
    $('#opt-diverse').checked = state.opts.diverse;
    $('#opt-pool').value = String(state.opts.pool);
    $('#opt-limit').value = String(state.opts.limit);
    $('#opt-clash').onchange = e => { state.opts.allowClash = e.target.checked; save(); };
    $('#opt-variants').onchange = e => { state.opts.allowVariants = e.target.checked; save(); };
    $('#opt-owned').onchange = e => { state.opts.onlyOwned = e.target.checked; save(); };
    $('#opt-diverse').onchange = e => { state.opts.diverse = e.target.checked; save(); };
    $('#opt-pool').onchange = e => { state.opts.pool = +e.target.value; save(); };
    $('#opt-limit').onchange = e => { state.opts.limit = +e.target.value; save(); };
    $('#opt-wrmode').checked = !!state.opts.wrAdjusted;
    const mw = $('#opt-missions');
    const cur = +state.opts.missionWeight || 0;
    mw.value = String(cur <= 0 ? 0 : cur < 6 ? 3 : 8);   // valores antigos do controle deslizante caem na opção mais próxima
    mw.onchange = () => { state.opts.missionWeight = +mw.value; save(); };
    if (!missionIndex) mw.closest('label').style.display = 'none';
  }
  $('#btn-clear').addEventListener('click', () => { state.locked = [null, null, null]; save(); renderSlots(); });
  $('#btn-suggest').addEventListener('click', runSuggest);

  // ------------------------------------------------------------------ sugestões
  function runSuggest() {
    const status = $('#suggest-status');
    status.innerHTML = '<span class="spinner"></span> ' + esc(t('status.calc'));
    $('#teams').innerHTML = '';
    lastTeams = null;
    // deixa o navegador pintar o spinner antes da busca
    setTimeout(() => {
      const locked = state.locked.filter(Boolean);
      const opts = {
        locked,
        banned: [...state.bans],
        allowClash: state.opts.allowClash,
        allowVariants: state.opts.allowVariants,
        poolSize: state.opts.pool,
        limit: state.opts.limit,
        diverse: state.opts.diverse,
        maxPerChar: locked.length ? 99 : 3,
      };
      if (state.opts.onlyOwned) {
        if (!state.owned.size) { status.textContent = t('status.noOwned'); return; }
        opts.allowed = [...state.owned];
      }
      const mw = missionIndex ? state.opts.missionWeight : 0;
      // slider = pontos por objetivo EM SEQUÊNCIA (peso 3); os outros entram proporcionalmente ao peso
      if (mw > 0) opts.extra = (a, b, c) => mw / 3 * missionIndex.weightForNames(a.name, b.name, c.name);
      const t0 = performance.now();
      let teams;
      try { teams = E.suggestTeams(profiles, opts); }
      catch (err) { status.textContent = t('status.error', { m: err.message }); console.error(err); return; }
      const ms = Math.round(performance.now() - t0);
      if (!teams.length) { status.textContent = t('status.none'); return; }
      status.textContent = t('status.result', { n: teams.length, ms });
      lastTeams = teams;
      renderTeams(teams);
    }, 20);
  }

  const TEAM_FILTERS = ['all', 'missions', 'measurable', 'played', 'new'];
  function teamPasses(r, filter) {
    if (filter === 'all') return true;
    const names = r.members.map(m => m.name);
    if (filter === 'played' || filter === 'new') { const h = teamHistory(names); const played = !!(h && (h.games || h.unknown)); return filter === 'played' ? played : !played; }
    if (!missionIndex) return true;
    const mg = missionIndex.goalsForTeam(names);
    if (filter === 'missions') return mg.goals.length > 0;
    if (filter === 'measurable') return mg.goals.some(g => g.goal.type === 'win');   // só objetivos de vitória deixam o observador medir quick match
    return true;
  }
  function renderTeams(teams) {
    const box = $('#teams');
    box.innerHTML = '';
    const bar = $('#teams-filter');
    bar.innerHTML = '';
    bar.style.display = teams.length ? '' : 'none';
    const filter = TEAM_FILTERS.includes(state.opts.teamFilter) ? state.opts.teamFilter : 'all';
    const shown = teams.filter(r => teamPasses(r, filter));
    for (const f of TEAM_FILTERS) {
      if ((f === 'played' || f === 'new') && !resultAgg) continue;
      if ((f === 'missions' || f === 'measurable') && !missionIndex) continue;
      bar.append(el('button', { class: 'pill-btn' + (f === filter ? ' active' : ''), title: t('filter.' + f + '.title'), onclick: () => { state.opts.teamFilter = f; save(); renderTeams(teams); } }, t('filter.' + f)));
    }
    bar.append(el('span', { class: 'count' }, t('filter.count', { n: shown.length, total: teams.length })));
    if (teams.length > 1) {
      const margem = teams[0].margin || 0;
      const empatados = teams.filter(r => teams[0].total - r.total <= margem).length;
      if (empatados > 1) bar.append(el('span', { class: 'count tie', title: t('tie.title') }, t('tie', { n: empatados, m: Math.round(margem) })));
    }
    shown.forEach(r => box.append(teamCard(r, teams.indexOf(r) + 1)));
    $('#teams-empty').style.display = teams.length ? 'none' : '';
    if (teams.length && !shown.length) box.append(el('div', { class: 'hint' }, t('filter.none')));
  }

  function teamCard(r, pos) {
    const card = el('div', { class: 'card team' });
    const head = el('div', { class: 'head' });
    const combo = r.total - r.base - (r.bonus || 0);
    head.append(el('div', { class: 'score', title: t('card.score.title') + ' · ' + t('card.margin.title', { m: r.margin, min: Math.round(r.total - r.margin), max: Math.round(r.total + r.margin) }) },
      Math.round(r.total), el('span', { class: 'margin' }, ' ±' + Math.round(r.margin)),
      el('small', {}, t('card.breakdown', { pos, b: r.base.toFixed(0), c: (combo >= 0 ? '+' : '') + combo.toFixed(0) }) + (r.bonus ? t('card.missions', { b: r.bonus }) : ''))));
    const members = el('div', { class: 'members' });
    for (const m of r.members) {
      members.append(el('div', { class: 'member', onclick: () => openDetail(m.name), title: t('card.details') },
        portrait(m),
        el('div', { class: 'nm' }, m.name),
        el('div', { class: 'role' }, `${m.score} · ${m.roles.map(roleLabel).join('/')}`)));
    }
    head.append(members);
    head.append(el('div', {},
      el('button', { class: 'small', title: t('card.use.title'), onclick: () => { state.locked = r.members.map(m => m.name); save(); renderSlots(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, t('card.use')),
      el('br'),
      el('button', { class: 'small', style: 'margin-top:4px', title: t('card.copy.title'), onclick: ev => copyText(r.members.map(m => m.name).join(' + '), ev.target) }, t('card.copy'))));
    card.append(head);

    // chakra
    const bars = el('div', { class: 'energy-bars' });
    for (const x of E.ENERGY_TYPES) {
      const d = r.clash.demand[x];
      const over = d > 0.75;
      const pct = Math.min(100, d / 1.5 * 100);
      bars.append(el('div', { class: 'ebar ' + x + (over ? ' over' : '') },
        el('span', {}, `${x} ${(d * 100).toFixed(0)}%`),
        el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${pct}%` }), el('div', { class: 'supply', style: 'left:50%' }))));
    }
    card.append(bars);

    // skills que pedem 2+ do mesmo tipo ou 2 tipos específicos juntos: demoram a sair (informativo; não mexe na nota,
    // porque contra o winrate medido esse formato de custo dá correlação ~0)
    const pesadas = [];
    for (const m of r.members) {
      const chars = CHARS.find(c => c.name === m.name);
      (m.skills || []).forEach((sk, i) => {
        if (sk.isPassive || sk.isHidden || !sk.cost || !sk.cost.specific || sk.cost.specific.length < 2) return;
        const nome = (chars && chars.skills[i] && chars.skills[i].name) || sk.name;
        pesadas.push({ who: m.name, skill: nome, cost: sk.cost.specific.join(' + ') });
      });
    }
    if (pesadas.length) {
      const line = el('div', { class: 'heavy', title: t('card.heavy.title') }, el('b', {}, t('card.heavy')), ': ');
      pesadas.slice(0, 4).forEach((x, i) => { if (i) line.append(' '); line.append(el('span', { class: 'pair' }, `${x.skill} (${x.cost})`)); });
      card.append(line);
    }

    // badges
    const badges = el('div', { class: 'badges' });
    if (r.clash.contested.length) badges.append(el('span', { class: 'badge bad' }, t('badge.contention', { t: r.clash.contested.join(', ') })));
    else badges.append(el('span', { class: 'badge good' }, t('badge.balanced')));
    if (r.clash.sharedPairs) badges.append(el('span', { class: 'badge warn' }, t('badge.shared', { n: r.clash.sharedPairs })));
    else badges.append(el('span', { class: 'badge good' }, t('badge.noclash')));
    if (r.setupPen > 0) badges.append(el('span', { class: 'badge warn' }, t('badge.setup')));
    const sv = r.synergy.value;
    badges.append(el('span', { class: 'badge ' + (sv >= 0.6 ? 'syn-strong' : sv < 0.3 ? 'syn-weak' : ''), title: t('badge.synergy.title', { p: (sv * 100).toFixed(0) }) + ' · ' + t('comb.unvalidated') }, t(sv >= 0.6 ? 'badge.synergy.strong' : sv >= 0.3 ? 'badge.synergy.good' : 'badge.synergy.weak'), el('span', { class: 'unval', title: t('comb.unvalidated') }, ' ?')));
    const hist = teamHistory(r.members.map(m => m.name));
    if (hist && (hist.games || hist.unknown)) badges.append(el('span', { class: 'badge ' + (hist.wr == null ? '' : hist.wr >= 60 ? 'good' : hist.wr < 45 ? 'bad' : 'warn'), title: t('res.badge.title', { u: hist.unknown, q: hist.quick, l: hist.ladder }) }, t('res.badge', { w: hist.win, l: hist.lose, s: hist.maxStreak })));
    card.append(badges);

    // papéis
    const roles = el('div', { class: 'roles-line' });
    for (const [label, v] of [[t('role.dmg'), r.coverage.dmg], [t('role.ctl'), r.coverage.ctl], [t('role.def'), r.coverage.def]]) {
      roles.append(el('div', { class: 'r' }, `${label} ${(v * 100).toFixed(0)}%`, el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${v * 100}%` }))));
    }
    card.append(roles);

    // sinergias: agrupa por motivo, junta motivos que valem para os mesmos pares e diz "entre os três" quando cobre o trio todo
    const byTitle = new Map();
    for (const s of r.synergy.list) {
      const title = (isEn() ? s.titleEn : s.title) || (isEn() ? s.whyEn : s.why);
      const g = byTitle.get(title) || { why: isEn() ? s.whyEn : s.why, pairs: new Set() };
      g.pairs.add(s.b ? [s.a, s.b].sort().join('|') : s.a);
      byTitle.set(title, g);
    }
    const byPairs = new Map();   // mesmos pares -> um bloco só
    for (const [title, g] of byTitle) {
      const k = [...g.pairs].sort().join('#');
      const e = byPairs.get(k) || { titles: [], whys: [], pairs: [...g.pairs] };
      e.titles.push(title); e.whys.push(g.why);
      byPairs.set(k, e);
    }
    const names = r.members.map(m => m.name);
    let n = 0;
    for (const e of byPairs.values()) {
      if (n++ >= 4) break;
      const line = el('div', { class: 'syn', title: e.whys.join(' · ') }, el('b', {}, e.titles.join(' · ')), ': ');
      const allPairs = e.pairs.length >= 3 && e.pairs.every(p => p.includes('|'));
      if (allPairs) line.append(el('span', { class: 'trio' }, t('syn.trio')));
      else e.pairs.forEach((p, i) => { if (i) line.append(' '); line.append(el('span', { class: 'pair' }, p.split('|').join(' + '))); });
      card.append(line);
    }
    // missões
    if (missionIndex) {
      const mg = missionIndex.goalsForTeam(r.members.map(m => m.name));
      if (mg.goals.length) {
        const det = el('details');
        det.append(el('summary', {}, t('card.goals', {
          g: mg.goals.length, gw: t(mg.goals.length > 1 ? 'goal.many' : 'goal.one'),
          m: mg.missionsTouched.length, mw: t(mg.missionsTouched.length > 1 ? 'mission.many' : 'mission.one'),
        }) + (mg.inRow ? t('card.goals.row', { n: mg.inRow }) : '')));
        const ul = el('ul');
        for (const g of mg.goals) ul.append(el('li', {}, g.inRow ? el('span', { class: 'badge warn', style: 'margin-right:6px', title: t('goal.row.title') }, t('goal.row')) : null, el('b', {}, g.mission.name), ': ' + goalText(g) + (g.progress ? ` (${g.progress.done}/${g.progress.total})` : '')));
        det.append(ul);
        card.append(det);
      } else {
        card.append(el('div', { class: 'hint' }, t('card.nogoals')));
      }
    }
    return card;
  }

  function copyText(text, btn) {
    const done = () => { const old = btn.textContent; btn.textContent = t('card.copied'); setTimeout(() => btn.textContent = old, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* ignora */ }
    ta.remove();
  }

  // ------------------------------------------------------------------ novidades
  function balanceNotesFor(name) {
    const out = [];
    for (const n of NEWS) for (const b of n.balance || []) if (b.name.toLowerCase() === name.toLowerCase()) out.push({ title: n.title, date: n.date, type: b.type, skills: b.skills });
    return out;
  }
  function renderNews() {
    const card = $('#news-card');
    const withBalance = NEWS.filter(n => n.balance && n.balance.length);
    if (!withBalance.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const list = $('#news-list');
    list.innerHTML = '';
    for (const n of withBalance.slice(0, 3)) {
      const box = el('div', { class: 'news' });
      box.append(el('span', { class: 'nt' }, n.title), el('span', { class: 'nd' }, n.date));
      if (n.body) box.append(el('div', { class: 'nb' }, n.body.slice(0, 220) + (n.body.length > 220 ? '…' : '')));
      const chips = el('div', { class: 'chips' });
      for (const b of n.balance) {
        const p = byName.get(b.name) || profiles.find(x => x.name.toLowerCase() === b.name.toLowerCase());
        chips.append(el('span', { class: 'chip ' + (b.type || ''), title: (b.type || '') + ' · ' + t('news.click'), onclick: () => p && openDetail(p.name) }, `${b.name} (${b.type || '?'})`));
      }
      box.append(chips);
      list.append(box);
    }
  }

  // ------------------------------------------------------------------ meus resultados (observador / diário)
  let resultAgg = null, resultByKey = new Map();
  function computeResults() {
    if (!RESULTS || !NR) return;
    resultAgg = NR.aggregate(RESULTS);
    resultByKey = new Map(resultAgg.rows.map(r => [r.key, r]));
  }
  const teamHistory = names => (NR ? resultByKey.get(NR.key(names)) : null);
  // taxa real para a prioridade de missões: melhor time seu (5+ partidas decididas) que avança a missão
  function realRateFor(mi, g) {
    if (!resultAgg) return null;
    let best = null;
    for (const row of resultAgg.rows) {
      if (row.games < 5 || row.wr == null) continue;
      const set = new Set(row.team);
      const advances = g.anyOf ? g.anyOf.some(n => set.has(n)) : !!(g.allOf && g.allOf.length && g.allOf.every(n => set.has(n)));
      if (advances && (!best || row.wr > best.wr)) best = row;
    }
    return best ? { p: Math.min(0.85, Math.max(0.35, best.wr / 100)), team: best.team, games: best.games } : null;
  }
  function renderResults() {
    const card = $('#results-card');
    if (!resultAgg || !resultAgg.rows.length) {
      if (!ACCOUNT) { card.style.display = 'none'; return; }
      card.style.display = ''; $('#results-hint').textContent = ''; $('#results-list').innerHTML = ''; $('#results-list').append(el('div', { class: 'results-empty' }, t('res.empty')));
      return;
    }
    card.style.display = '';
    $('#results-hint').textContent = t('res.hint', { n: resultAgg.observedMatches, l: resultAgg.ladderMatches, q: resultAgg.quickMatches, d: RESULTS.updatedAt ? new Date(RESULTS.updatedAt).toLocaleString(localeStr()) : '?' });
    const box = $('#results-list'); box.innerHTML = '';
    for (const r of resultAgg.rows) {
      const members = r.team.map(n => byName.get(n)).filter(Boolean);
      const row = el('div', { class: 'cteam' });
      row.append(el('span', { class: 'cnt', title: t('res.wr.title') }, r.wr == null ? '–' : r.wr.toFixed(0) + '%'));
      const ms = el('div', { class: 'members' });
      for (const n of r.team) { const m = byName.get(n); ms.append(m ? el('span', { onclick: () => openDetail(m.name), style: 'cursor:pointer' }, portrait(m, 'xs'), m.name) : el('span', {}, n)); }
      row.append(ms);
      const parts = [t('res.games', { w: r.win, l: r.lose })];
      if (r.unknown) parts.push(t('res.unknown', { n: r.unknown }));
      parts.push([r.ladder ? t('res.ladder', { n: r.ladder }) : null, r.quick ? t('res.quick', { n: r.quick }) : null].filter(Boolean).join(' · '));
      row.append(el('span', { class: 'hint', title: t('res.unknown.title') }, parts.filter(Boolean).join(' · ')));
      row.append(el('span', { class: 'hint' }, t('res.streak', { s: r.maxStreak })));
      row.append(el('span', { class: 'hint' }, r.last ? new Date(r.last).toLocaleDateString(localeStr()) : ''));
      const sc = members.length === 3 ? E.scoreTeam(members) : null;
      row.append(el('span', { class: 'sc', title: t('res.score.title') }, sc ? t('res.score', { s: sc.total }) : '—'));
      if (members.length === 3) row.append(el('button', { class: 'small', onclick: () => { state.locked = members.map(m => m.name); save(); renderSlots(); window.scrollTo({ top: 0 }); } }, t('card.use')));
      box.append(row);
    }
  }

  // ------------------------------------------------------------------ winrate / comunidade
  // quanto a estimativa costuma errar (medido por scripts/validate-winrate.js; 8,4 pontos hoje)
  const WR_ERR = (WINRATE && WINRATE._model && WINRATE._model.typicalError) || 8.4;
  const wrGap = w => (w && w.lastWinrate != null ? w.winrate - w.lastWinrate : 0);
  const scoreCell = p => el('td', { title: t('card.margin.title', { m: p.margin, min: Math.round(p.score - p.margin), max: Math.round(p.score + p.margin) }) }, el('b', {}, String(p.score)), el('span', { class: 'margin' }, ' ±' + Math.round(p.margin)));
  function winrateCell(p) {
    const w = p.winrate;
    if (!w && p.tierWinrate) return el('td', { class: 'muted', title: t('wr.tier.title', { l: p.tierWinrate.unlockLevel }) }, t('wr.tier', { w: p.tierWinrate.winrate.toFixed(0) }));
    if (!w) return el('td', { class: 'muted', title: t('wr.none.title') }, t('wr.none'));
    const cls = w.winrate >= 60 ? 'wr-good' : w.winrate < 45 ? 'wr-bad' : '';
    const gap = wrGap(w);
    const td = el('td', { class: 'wrcell', title: t('wr.title') + (w.date ? ' · ' + t('wr.old', { d: w.date }) : '') + ' · ' + t('wr.err', { e: WR_ERR }) });
    td.append(el('span', { class: cls }, `${w.winrate.toFixed(1)}%`), ' ', el('small', {}, `(${w.matches})`));
    if (p.lowConfidence) td.append(' ', el('span', { class: 'wr-low', title: t('wr.low.title', { m: w.matches, l: p.tier.unlockLevel, e: p.tier.winrate }) }, t('wr.low')));
    if (Math.abs(gap) >= 10) td.append(' ', el('span', { class: 'wr-gap', title: t('wr.gap.title', { l: w.lastWinrate, m: w.lastMatches, d: w.date }) }, gap > 0 ? '▲' : '▼'));
    return td;
  }
  function vsTierCell(p) {
    const w = p.winrate;
    if (!w || w.adjusted == null) return el('td', { class: 'muted' }, '–');
    const d = w.winrate - w.expected;
    return el('td', { class: d >= 5 ? 'wr-good' : d <= -5 ? 'wr-bad' : 'muted', title: t('wr.vs.title', { e: w.expected }) }, (d > 0 ? '+' : '') + d.toFixed(1));
  }
  const dirClass = d => d < 0 ? 'nerf' : d > 0 ? 'buff' : 'other';
  const dirLabel = d => t(d < 0 ? 'bal.nerf' : d > 0 ? 'bal.buff' : 'bal.other');
  function communityBlock(p) {
    const frag = el('div');
    const w = p.winrate;
    if (w && w.series && w.series.length) {
      const gap = wrGap(w);
      if (Math.abs(gap) >= 10) frag.append(el('div', { class: 'balance-note', style: 'border-color:var(--accent)' }, t('wr.gap', { g: (gap > 0 ? '+' : '') + gap.toFixed(0), l: w.lastWinrate, m: w.lastMatches, d: w.date, t: w.matches })));
      frag.append(el('h3', { style: 'margin-top:14px' }, t('wr.series')), el('div', { class: 'hint' }, t('wr.est', { w: w.winrate, l: w.lastWinrate, d: w.date || '?', t: w.type || '?', m: w.matches })));
      const tb = el('table', { class: 'series' });
      tb.append(el('tr', {}, el('th', {}, t('wr.th.date')), el('th', {}, t('wr.th.wr')), el('th', {}, t('wr.th.matches')), el('th', {}, t('wr.th.usage')), el('th', {}, t('wr.th.ctx'))));
      for (const s of w.series.slice(0, 10)) tb.append(el('tr', {}, el('td', {}, s.date || '?'), el('td', { class: s.winrate >= 60 ? 'wr-good' : s.winrate < 45 ? 'wr-bad' : '' }, s.winrate + '%'), el('td', {}, String(s.matches)), el('td', {}, s.usage != null ? s.usage + '%' : '–'), el('td', { class: 'muted' }, s.type || '')));
      frag.append(tb);
    }
    const c = COMMUNITY && COMMUNITY.chars && COMMUNITY.chars[p.name];
    if (c) {
      if (c.timeline && c.timeline.length) {
        frag.append(el('h3', { style: 'margin-top:14px' }, t('bal.title')), el('div', { class: 'hint' }, t('bal.summary', { n: c.nerfs, b: c.buffs, o: c.neutral })));
        const tl = el('div', { class: 'timeline' });
        for (const x of c.timeline.slice(0, 8)) {
          const row = el('div', { class: 'tl' }, el('span', { class: 'dir ' + dirClass(x.dir) }, dirLabel(x.dir)), el('b', {}, x.title), el('span', { class: 'hint' }, ' · ' + x.date));
          const ul = el('ul');
          for (const s of x.skills.slice(0, 3)) for (const txt of s.text.slice(0, 2)) ul.append(el('li', {}, el('i', {}, s.name + ': '), txt));
          if (ul.children.length) row.append(ul);
          tl.append(row);
        }
        frag.append(tl);
      }
      if (COMMUNITY.hasForum) frag.append(el('div', { class: 'hint', style: 'margin-top:8px' }, t('com.mentions', { n: c.mentions, s: c.mentionsStrength, t: c.teamCount })));
    }
    return frag;
  }
  // times que jogadores reais da ladder salvaram (scripts/collect-ladder-teams.js -> community.js)
  function renderLadderTeams() {
    const card = $('#ladder-card');
    const lista = COMMUNITY && COMMUNITY.ladderTeams;
    if (!lista || !lista.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const info = COMMUNITY.ladderInfo || {};
    $('#ladder-hint').textContent = t('ladder.hint', { p: info.players || '?', t: info.teams || '?', d: info.fetchedAt ? new Date(info.fetchedAt).toLocaleDateString(localeStr()) : '?' });
    const onlyOwned = $('#ladder-owned').checked;
    const box = $('#ladder-teams'); box.innerHTML = '';
    let shown = 0;
    for (const lt of lista) {
      const members = lt.members.map(n => byName.get(n)).filter(Boolean);
      if (members.length !== 3) continue;
      if (onlyOwned && !lt.members.every(n => state.owned.has(n))) continue;
      if (++shown > 40) break;
      const r = E.scoreTeam(members);
      const row = el('div', { class: 'cteam' });
      row.append(el('span', { class: 'cnt', title: t('ladder.count.title') }, t('ladder.count', { n: lt.count })));
      const ms = el('div', { class: 'members' });
      for (const m of members) ms.append(el('span', { onclick: () => openDetail(m.name), style: 'cursor:pointer' }, portrait(m, 'xs'), m.name));
      row.append(ms);
      row.append(el('span', { class: 'hint', title: t('ladder.player.title', { u: lt.players.map(p => `${p.username} ${p.wr}% (${p.games})`).join(', ') }) }, t('ladder.player', { w: lt.bestWr })));
      row.append(el('span', { class: 'sc', title: t('res.score.title') }, t('res.score', { s: r.total })));
      row.append(el('button', { class: 'small', onclick: () => { state.locked = members.map(m => m.name); save(); renderSlots(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, t('card.use')));
      box.append(row);
    }
    if (!shown) box.append(el('div', { class: 'hint' }, t('ladder.none')));
  }
  $('#ladder-owned').addEventListener('change', renderLadderTeams);

  function renderCommunityTeams() {
    const card = $('#community-card');
    if (!COMMUNITY || !COMMUNITY.teams || !COMMUNITY.teams.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    $('#community-hint').textContent = t('com.teams.hint', { t: COMMUNITY.forumTopics, p: COMMUNITY.forumPosts });
    const onlyOwned = $('#com-owned').checked;
    const box = $('#community-teams');
    box.innerHTML = '';
    let shown = 0;
    for (const ct of COMMUNITY.teams) {
      const members = ct.members.map(n => byName.get(n)).filter(Boolean);
      if (members.length !== 3) continue;
      if (onlyOwned && !ct.members.every(n => state.owned.has(n))) continue;
      const r = E.scoreTeam(members);
      const row = el('div', { class: 'cteam' });
      row.append(el('span', { class: 'cnt', title: (ct.staff ? t('com.staff') + ' · ' : '') + ct.topics.join(' / ') }, t('com.times', { n: ct.count }) + (ct.staff ? ' ★' : '')));
      const ms = el('div', { class: 'members' });
      for (const m of members) ms.append(el('span', { onclick: () => openDetail(m.name), style: 'cursor:pointer' }, portrait(m, 'xs'), m.name, el('small', { class: 'muted' }, m.winrate ? ` ${m.winrate.winrate.toFixed(0)}%` : '')));
      row.append(ms, el('span', { class: 'hint' }, t('com.last', { d: (ct.lastDate || '').slice(0, 12) })),
        ct.stale ? el('span', { class: 'badge warn', title: t('com.stale.title') }, t('com.stale')) : null,
        el('span', { class: 'sc' }, r.total.toFixed(1)),
        el('button', { class: 'small', onclick: () => { state.locked = ct.members.slice(); save(); renderSlots(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, t('card.use')));
      box.append(row);
      if (++shown >= 40) break;
    }
  }
  $('#com-owned').addEventListener('change', renderCommunityTeams);

  // ------------------------------------------------------------------ ranking
  function renderRanking() {
    renderNews();
    const q = norm($('#rank-search').value.trim());
    const onlyOwned = $('#rank-owned').checked;
    const tbody = $('#rank-table tbody');
    tbody.innerHTML = '';
    let list = profiles.filter(p => (!q || norm(p.name).includes(q)) && (!onlyOwned || state.owned.has(p.name)));
    const k = rankSort.key, dir = rankSort.dir;
    list = list.slice().sort((a, b) => {
      let va, vb;
      if (k === 'name') { va = a.name; vb = b.name; return va.localeCompare(vb) * dir; }
      if (k === 'rank') { va = a.rank; vb = b.rank; }
      else if (k === 'score') { va = a.score; vb = b.score; }
      else { va = a.norm[k]; vb = b.norm[k]; }
      return (va - vb) * dir;
    });
    const mini = v => el('span', { class: 'mini', title: (v * 100).toFixed(0) + '%' }, el('i', { style: `width:${v * 100}%` }));
    for (const p of list) {
      const tr = el('tr', { class: 'clickable' + (state.bans.has(p.name) ? ' muted' : ''), onclick: () => openDetail(p.name) });
      tr.append(
        el('td', {}, String(p.rank)),
        el('td', {}, portrait(p, 'sm')),
        el('td', {}, p.name + (state.bans.has(p.name) ? t('rank.banned') : '')),
        scoreCell(p),
        el('td', { class: 'muted' }, p.roles.map(roleLabel).join(' / ')),
        el('td', {}, mini(p.norm.offense)),
        el('td', {}, mini(p.norm.control)),
        el('td', {}, mini(p.norm.defense)),
        el('td', {}, mini(p.norm.support)),
        el('td', {}, mini(p.norm.economy)),
        el('td', {}, energyPills(p)),
        el('td', {}, tierTag(p)),
        winrateCell(p),
        vsTierCell(p));
      tbody.append(tr);
    }
  }
  $('#rank-search').addEventListener('input', renderRanking);
  $('#rank-owned').addEventListener('change', renderRanking);
  $('#opt-wrmode').addEventListener('change', e => { state.opts.wrAdjusted = e.target.checked; save(); recompute(); renderRanking(); renderSlots(); if (lastTeams) runSuggest(); });
  $$('#rank-table th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (rankSort.key === key) rankSort.dir *= -1;
    else rankSort = { key, dir: (key === 'rank' || key === 'name') ? 1 : -1 };
    renderRanking();
  }));

  // ------------------------------------------------------------------ personagens
  function renderChars() {
    const q = norm($('#chars-search').value.trim());
    const filter = $('#chars-filter').value;
    const grid = $('#chars-grid');
    grid.innerHTML = '';
    const list = profiles.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const p of list) {
      if (q && !norm(p.name).includes(q)) continue;
      const owned = state.owned.has(p.name), banned = state.bans.has(p.name), tier = state.tiers[p.name];
      if (filter === 'owned' && !owned) continue;
      if (filter === 'notowned' && owned) continue;
      if (filter === 'banned' && !banned) continue;
      if (filter === 'tiered' && !tier) continue;
      const card = el('div', { class: 'cchar' + (banned ? ' banned' : '') + (!owned && state.owned.size ? ' notowned' : '') });
      card.append(el('div', { class: 'top', onclick: () => openDetail(p.name) }, portrait(p, 'sm'),
        el('div', {}, el('div', { class: 'nm' }, p.name), el('div', { class: 'sc' }, t('chars.card', { r: p.rank, s: p.score })))));
      const ctl = el('div', { class: 'ctl' });
      const own = el('input', { type: 'checkbox', title: t('chars.own.title') });
      own.checked = owned;
      own.addEventListener('change', () => { if (own.checked) state.owned.add(p.name); else state.owned.delete(p.name); save(); card.classList.toggle('notowned', !own.checked && state.owned.size > 0); });
      const ban = el('input', { type: 'checkbox', title: t('chars.ban.title') });
      ban.checked = banned;
      ban.addEventListener('change', () => { if (ban.checked) state.bans.add(p.name); else state.bans.delete(p.name); save(); card.classList.toggle('banned', ban.checked); });
      const sel = el('select', { title: t('chars.tier.title') });
      for (const x of TIERS) sel.append(el('option', { value: x }, x || t('chars.auto')));
      sel.value = tier || '';
      sel.addEventListener('change', () => {
        if (sel.value) state.tiers[p.name] = sel.value; else delete state.tiers[p.name];
        save(); recompute(); renderChars(); renderSlots();
      });
      ctl.append(el('label', { title: t('chars.own.title') }, own, t('chars.own')), el('label', { title: t('chars.ban.title') }, ban, t('chars.ban')), sel);
      card.append(ctl);
      grid.append(card);
    }
  }
  $('#chars-search').addEventListener('input', renderChars);
  $('#chars-filter').addEventListener('change', renderChars);
  $('#btn-own-all').addEventListener('click', () => { profiles.forEach(p => state.owned.add(p.name)); save(); renderChars(); });
  $('#btn-own-account').addEventListener('click', () => {
    if (!ACCOUNT) { alert(t('chars.noAccount')); return; }
    applyAccountOwned(true); bindOpts(); renderChars();
  });
  $('#btn-own-none').addEventListener('click', () => { state.owned.clear(); save(); renderChars(); });
  $('#btn-reset-chars').addEventListener('click', () => {
    if (!confirm(t('chars.confirmReset'))) return;
    state.bans.clear(); state.tiers = {}; save(); recompute(); renderChars(); renderSlots();
  });

  // ------------------------------------------------------------------ detalhe
  function highlightDesc(desc) {
    // converte as tags <Damage>..<Damage> (pares iguais) em spans coloridos
    let out = '', open = null;
    const parts = String(desc || '').split(/(<[A-Za-z]+>)/);
    for (const part of parts) {
      const m = part.match(/^<([A-Za-z]+)>$/);
      if (m) {
        const tag = m[1];
        if (tag === 'br') { out += '<br>'; continue; }
        if (open === tag) { out += '</span>'; open = null; }
        else if (!open) { out += `<span class="${esc(tag)}">`; open = tag; }
        continue;
      }
      out += esc(part);
    }
    if (open) out += '</span>';
    return out;
  }
  function skillTags(ps) {
    const tags = [];
    const add = (id, n) => tags.push(el('span', { class: 'badge', title: t('tagd.' + id) }, t('tagl.' + id, { n })));
    if (ps.dmg) add('dmg', Math.round(ps.dmg));
    if (ps.dmgCond) add('dmgCond', Math.round(ps.dmgCond));
    if (ps.stun) add('stun', ps.stun.toFixed(1));
    if (ps.drain) add('drain', ps.drain.toFixed(1));
    if (ps.debuff) add('debuff', ps.debuff);
    if (ps.dr || ps.drAlly) add('dr', Math.round(ps.dr + ps.drAlly));
    if (ps.dd || ps.ddAlly) add('dd', Math.round(ps.dd + ps.ddAlly));
    if (ps.heal || ps.healAlly) add('heal', Math.round(ps.heal + ps.healAlly));
    for (const x of TAG_ORDER) if (ps.tags.has(x)) add(x);
    if (ps.setup) add('setup');
    return tags;
  }
  // ------------------------------------------------------------------ correções manuais de skill (data/curated/skill-overrides.js)
  const OV_NUM = ['dmg', 'dmgCond', 'stun', 'drain', 'debuff', 'heal', 'healAlly', 'dr', 'drAlly', 'dd', 'ddAlly', 'amplify'];
  const OV_TAGS = ['aoe', 'pierce', 'affliction', 'invulnSelf', 'invulnAlly', 'invulnTeam', 'counter', 'counterEnemy', 'reflect', 'uncounterable', 'ignoreInvuln', 'ignoreStun', 'cleanse', 'noDefense', 'noDefenseAoe', 'antiHeal', 'costUp', 'setup'];
  function openOverrideEditor(c, s, i, ps, card) {
    const old = card.querySelector('.ov-editor'); if (old) { old.remove(); return; }
    const raw = E.parseSkill(s, i);   // leitura sem correção (a correção é expressa em relação a ela)
    const cur = ((window.NA_SKILL_OVERRIDES || {})[c.name] || {})[s.name] || null;
    const box = el('div', { class: 'ov-editor' });
    box.append(el('div', { class: 'hint' }, t('ov.hint')));
    const nums = el('div', { class: 'ov-grid' });
    const inputs = {};
    for (const k of OV_NUM) {
      const inp = el('input', { type: 'number', step: '0.1', placeholder: String(Math.round((raw[k] || 0) * 10) / 10), value: cur && cur[k] != null ? cur[k] : '' });
      inputs[k] = inp;
      nums.append(el('label', { title: t('ov.f.' + k + '.title') }, t('ov.f.' + k), inp));
    }
    box.append(nums);
    const flags = el('div', { class: 'ov-flags' });
    const checks = {};
    for (const k of OV_TAGS) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = k === 'setup' ? !!ps.setup : (ps.tags.has(k) || !!ps[k]);
      checks[k] = cb;
      flags.append(el('label', { title: t('tagd.' + k) !== 'tagd.' + k ? t('tagd.' + k) : '' }, cb, ' ', t('tagl.' + k) !== 'tagl.' + k ? t('tagl.' + k, { n: '' }) : k));
    }
    box.append(flags);
    const note = el('input', { type: 'text', placeholder: t('ov.note'), value: cur && cur.nota ? cur.nota : '', style: 'width:100%' });
    box.append(note);
    const status = el('div', { class: 'hint' });
    const build = () => {
      const ov = {};
      for (const k of OV_NUM) if (inputs[k].value !== '') ov[k] = +inputs[k].value;
      const tags = [];
      for (const k of OV_TAGS) {
        const rawHas = k === 'setup' ? !!raw.setup : (raw.tags.has(k) || !!raw[k]);
        if (checks[k].checked && !rawHas) { tags.push('+' + k); ov[k] = true; }
        if (!checks[k].checked && rawHas) { tags.push('-' + k); ov[k] = false; }
      }
      // tags de exibição derivadas (invuln = self/ally/team; counter inclui counterEnemy; noDefense inclui a versão em área)
      const DISPLAY = { invuln: ['invulnSelf', 'invulnAlly', 'invulnTeam'], counter: ['counter', 'counterEnemy'], noDefense: ['noDefense', 'noDefenseAoe'] };
      for (const [d, ks] of Object.entries(DISPLAY)) {
        const want = ks.some(k => checks[k] && checks[k].checked), has = raw.tags.has(d);
        if (want && !has) tags.push('+' + d); else if (!want && has) tags.push('-' + d);
      }
      if (tags.length) ov.tags = [...new Set(tags)];
      if (note.value.trim()) ov.nota = note.value.trim();
      return ov;
    };
    async function send(override) {
      if (!/^https?:$/.test(location.protocol)) {   // sem servidor: mostra o que colar no arquivo
        status.innerHTML = ''; status.append(t('ov.offline'), el('pre', { class: 'ov-json' }, JSON.stringify({ [c.name]: { [s.name]: override } }, null, 1)));
        return;
      }
      try {
        const r = await fetch('/api/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ char: c.name, skill: s.name, override }) });
        const j = await r.json();
        if (!r.ok || j.erro) { status.textContent = t('ov.err', { m: j.erro || r.status }); return; }
        window.NA_SKILL_OVERRIDES = j.overrides;
        recompute(); renderSlots();
        if (lastTeams) runSuggest();
        if ($('#tab-ranking').classList.contains('active')) renderRanking();
        renderResults();
        openDetail(c.name);   // re-renderiza com a leitura corrigida
      } catch (e) { status.textContent = t('ov.err', { m: e.message }); }
    }
    const btns = el('div', { class: 'row' },
      el('button', { class: 'small primary', onclick: () => { const ov = build(); if (!Object.keys(ov).filter(k => k !== 'nota').length) { status.textContent = t('ov.empty'); return; } send(ov); } }, t('ov.save')),
      cur ? el('button', { class: 'small danger', onclick: () => send(null) }, t('ov.remove')) : null,
      el('button', { class: 'small', onclick: () => box.remove() }, t('ov.cancel')));
    box.append(btns, status);
    card.append(box);
  }

  function openDetail(name) {
    const p = byName.get(name);
    if (!p) return;
    const c = CHARS.find(x => x.name === name);
    const box = $('#detail-box');
    box.innerHTML = '';
    const head = el('div', { class: 'dhead' });
    head.append(portrait(p));
    const info = el('div', { style: 'flex:1' });
    info.append(el('div', { class: 'row' }, el('h2', { style: 'margin:0' }, p.name), tierTag(p),
      el('span', { class: 'hint', title: t('card.margin.title', { m: p.margin, min: Math.round(p.score - p.margin), max: Math.round(p.score + p.margin) }) }, t('detail.rank', { r: p.rank, s: p.score }) + ' ±' + Math.round(p.margin) + (p.tierOverride ? t('detail.auto', { b: p.baseScore }) : '')),
      el('button', { class: 'small', style: 'margin-left:auto', onclick: () => $('#detail-bg').classList.remove('open') }, t('detail.close'))));
    info.append(el('p', { class: 'hint', style: 'margin:6px 0' }, isEn() ? c.description : (c.descriptionBR || c.description)));
    info.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, t('detail.roles') + p.roles.map(roleLabel).join(' / ')), energyPills(p),
      el('span', { class: 'muted' }, t('detail.random', { p: (p.randomRatio * 100).toFixed(0) })),
      p.winrate ? el('span', { class: 'muted', title: t('wr.err', { e: WR_ERR }) + (p.lowConfidence ? ' · ' + t('wr.low.title', { m: p.winrate.matches, l: p.tier.unlockLevel, e: p.tier.winrate }) : '') }, t('detail.winrate', { w: p.winrate.winrate.toFixed(1), e: WR_ERR, m: p.winrate.matches, h: p.heuristicScore }) + (p.lowConfidence ? ' · ' + t('wr.low') : ''))
        : p.tierWinrate ? el('span', { class: 'muted', title: t('wr.tier.title', { l: p.tierWinrate.unlockLevel }) }, t('detail.tier', { w: p.tierWinrate.winrate.toFixed(1), l: p.tierWinrate.unlockLevel, h: p.heuristicScore }))
        : el('span', { class: 'muted', title: t('wr.none.title') }, t('wr.none'))));
    const comp = el('div', { class: 'comp' });
    for (const key of ['offense', 'control', 'defense', 'support', 'economy', 'tempo']) {
      comp.append(el('div', {}, `${t('detail.c.' + key)} ${(p.norm[key] * 100).toFixed(0)}%`, el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${p.norm[key] * 100}%` }))));
    }
    info.append(comp);
    head.append(info);
    box.append(head);

    const skills = el('div', { class: 'skills' });
    c.skills.forEach((s, i) => {
      const ps = p.skills[i];
      const sk = el('div', { class: 'skill' + (ps.isHidden ? ' hidden-skill' : '') });
      const cost = s.energy.length ? s.energy.map(e => `<span class="pill ${esc(e)}">${esc(e)}</span>`).join('') : `<span class="pill">${esc(t('detail.nocost'))}</span>`;
      sk.append(el('div', { class: 'sh' }, portrait({ url: s.url, name: s.name }, 'sm'),
        el('div', {}, el('div', { class: 'sn' }, s.name + (ps.isHidden ? t('detail.hidden') : '')), el('div', { class: 'hint' }, `${t('detail.cooldown', { n: s.cooldown })} · ${(s.classes || []).filter(x => !/^[_$*]/.test(x)).join(', ')}`)),
        el('div', { class: 'cost', html: cost })));
      sk.append(el('div', { class: 'desc', html: highlightDesc(skillDesc(s)) }));
      const tags = skillTags(ps);
      const tagRow = el('div', { class: 'badges', style: 'margin-top:6px' }, ...tags);
      const curOv = (window.NA_SKILL_OVERRIDES || {})[c.name] && (window.NA_SKILL_OVERRIDES[c.name][s.name] || window.NA_SKILL_OVERRIDES[c.name]['*']);
      tagRow.append(el('button', { class: 'small edit', title: t('ov.btn.title'), onclick: () => openOverrideEditor(c, s, i, ps, sk) }, '✎ ' + t(curOv ? 'ov.btn.edit' : 'ov.btn')));
      if (curOv && curOv.nota) tagRow.append(el('span', { class: 'hint', title: t('ov.note.title') }, '✎ ' + curOv.nota));
      sk.append(tagRow);
      skills.append(sk);
    });
    const notes = balanceNotesFor(p.name);
    if (notes.length) {
      const nb = el('div', { class: 'balance-note' });
      for (const n of notes.slice(0, 3)) {
        nb.append(el('div', {}, el('b', {}, `${n.title} · ${n.type}`), el('span', { class: 'hint' }, ' ' + n.date)));
        const ul = el('ul');
        for (const s of n.skills) for (const x of s.text) ul.append(el('li', {}, el('i', {}, s.name + ': '), x));
        nb.append(ul);
      }
      box.append(nb);
    }
    box.append(communityBlock(p));
    box.append(el('h3', { style: 'margin-top:14px' }, t('detail.skills')), skills);
    $('#detail-bg').classList.add('open');
  }
  $('#detail-bg').addEventListener('click', ev => { if (ev.target.id === 'detail-bg') ev.currentTarget.classList.remove('open'); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') $$('.modal-bg.open').forEach(m => m.classList.remove('open')); });

  // ------------------------------------------------------------------ missões
  function renderMissions() {
    const list = $('#missions-list');
    const hint = $('#missions-hint');
    list.innerHTML = '';
    if (!missionIndex) { hint.textContent = t('missions.noData'); return; }
    const animeSel = $('#missions-anime');
    if (animeSel.options.length === 1) for (const a of [...new Set(MISSIONS.missions.map(m => m.anime))]) animeSel.append(el('option', { value: a }, a));
    const q = norm($('#missions-search').value.trim());
    const filter = $('#missions-filter').value;
    const anime = animeSel.value;
    const counts = { disponivel: 0, concluida: 0, 'falta-rank': 0, bloqueada: 0 };
    missionIndex.missions.forEach(mi => counts[mi.status]++);
    $('#missions-summary').textContent = ACCOUNT
      ? t('missions.summary', { a: counts.disponivel, c: counts.concluida, r: counts['falta-rank'], l: counts.bloqueada })
      : t('missions.summary.noacc', { n: missionIndex.missions.length });
    hint.textContent = ACCOUNT ? t('missions.hint.acc') : t('missions.hint.noacc');
    // próximos ranks: quantas missões cada um libera
    const ranksBox = $('#missions-ranks');
    if (ACCOUNT && ACCOUNT.profile && (ACCOUNT.profile.level || ACCOUNT.profile.rank)) {
      const cur = ACCOUNT.profile.level ? NM.rankForLevel(ACCOUNT.profile.level) : NM.RANKS.find(r => r.name === ACCOUNT.profile.rank) || NM.RANKS[0];
      const parts = [];
      for (const r of NM.RANKS) {
        if (r.level <= cur.level) continue;
        const n = missionIndex.missions.filter(mi => mi.status !== 'concluida' && NM.rankForLevel(mi.mission.levelRequirement || 1).name === r.name).length;
        if (n) parts.push(t('missions.rank.item', { r: r.name, l: r.level, n }));
      }
      ranksBox.textContent = parts.length ? t('missions.ranks', { r: cur.name, list: parts.join(' · ') }) : '';
    } else ranksBox.textContent = '';
    let shown = 0;
    // prioridade: valor (personagem liberado + cadeia que destrava) ÷ esforço estimado em partidas
    let seq = missionIndex.missions, prio = null;
    if (filter === 'prioridade') {
      const rows = missionIndex.priority({ scoreOf: n => { const p = byName.get(n); return p ? p.score : null; }, pFor: realRateFor });
      prio = new Map(rows.map((r, i) => [r.mi, { ...r, pos: i + 1 }]));
      seq = rows.map(r => r.mi);
    }
    for (const mi of seq) {
      const m = mi.mission;
      if (anime && m.anime !== anime) continue;
      if (filter === 'prioridade') { /* já filtrado e ordenado */ }
      else if (filter === 'andamento') { if (mi.status !== 'disponivel' || !mi.goals.some(g => g.progress && g.progress.done > 0)) continue; }
      else if (filter === 'sequencia') { if (mi.status !== 'disponivel' || !mi.goals.some(g => g.inRow && !g.done)) continue; }
      else if (filter !== 'all' && mi.status !== filter) continue;
      if (q) {
        const hay = norm(m.name + ' ' + (m.unlockedCharacter || '') + ' ' + mi.goals.map(g => (g.anyOf || g.allOf || []).join(' ')).join(' '));
        if (!hay.includes(q)) continue;
      }
      shown++;
      const box = el('div', { class: 'mission' });
      const img = el('img', { class: 'mimg', referrerpolicy: 'no-referrer', src: imgSrc(m.url), alt: '', loading: 'lazy' });
      img.addEventListener('error', () => { if (m.url && img.getAttribute('src') !== m.url) { img.src = m.url; return; } img.style.display = 'none'; });
      box.append(img);
      const body = el('div', { class: 'mbody' });
      const title = el('div', { class: 'mtitle' }, el('b', {}, m.name), el('span', { class: 'status ' + mi.status }, t('status.' + mi.status)),
        el('span', { class: 'hint' }, m.anime + (m.levelRequirement ? t('missions.level', { n: m.levelRequirement }) : '')));
      if (m.unlockedCharacter) {
        const uc = byName.get(m.unlockedCharacter);
        title.append(el('span', { class: 'hint' }, t('missions.unlocks')), uc ? el('a', { href: '#', onclick: ev => { ev.preventDefault(); openDetail(uc.name); } }, uc.name) : el('span', {}, m.unlockedCharacter));
      }
      if (m.completedRequeriments && m.completedRequeriments.length) title.append(el('span', { class: 'hint' }, t('missions.requires') + m.completedRequeriments.join(', ')));
      // personagens necessários para montar o time: primeiro os objetivos pendentes de maior peso (sequências)
      const need = [];
      for (const g of [...mi.goals].sort((x, y) => (x.done - y.done) || (y.weight - x.weight))) {
        const cands = g.allOf && g.allOf.length ? g.allOf : (g.anyOf || []);
        for (const n of cands) { if (need.length >= 3) break; if (!need.includes(n) && byName.has(n)) { need.push(n); if (!(g.allOf && g.allOf.length)) break; } }
      }
      if (need.length && mi.status !== 'concluida') {
        title.append(el('button', { class: 'small', style: 'margin-left:auto', onclick: () => {
          state.locked = [need[0] || null, need[1] || null, need[2] || null];
          if (!(state.opts.missionWeight > 0)) { state.opts.missionWeight = 3; bindOpts(); }   // senão a missão não pesa na sugestão
          save(); renderSlots();
          showTab('suggest');
          window.scrollTo({ top: 0 });
        } }, t('missions.build')));
      }
      // linhas extras (prioridade, cadeia) depois do botão, para ele ficar na linha do título
      if (prio && prio.get(mi)) {
        const r = prio.get(mi);
        const parts = [];
        if (r.ownScore != null) parts.push(t('prio.unlock', { c: m.unlockedCharacter, s: r.ownScore }));
        if (r.opens) parts.push(t('prio.opens', { n: r.opens }) + (r.best ? t('prio.best', { c: r.best.name, s: r.best.score }) : ''));
        const hardest = r.hardest ? (isEn() ? r.hardest.textEn : r.hardest.text) + (r.hardest.progress ? ` (${r.hardest.progress.done}/${r.hardest.progress.total})` : '') : '';
        const worth = r.value >= 30 ? 'prio.w.high' : r.value >= 12 ? 'prio.w.mid' : r.value >= 4 ? 'prio.w.low' : 'prio.w.none';
        title.append(el('span', { class: 'prio', title: t('prio.title') + ' · ' + t('prio.numbers', { v: r.value, e: r.effort, r: r.ratio }) }, t('prio.line', { pos: r.pos, w: t(worth), v: r.value, e: r.effort }) + (r.rate && r.rate.real ? t('prio.rate', { p: Math.round(r.rate.p * 100), t: r.rate.team.join(' + ') }) : '') + (parts.length ? ' — ' + parts.join('; ') : '') + (hardest ? ' · ' + t('prio.effort', { g: hardest }) : '')));
      }
      // cadeia: quem exige esta missão (direto) e quanto ela destrava no total
      if (mi.dependents && mi.dependents.length) {
        const pend = mi.downstream.filter(d => d.mi.status !== 'concluida').length;
        title.append(el('span', { class: 'hint chain', title: t('missions.chain.title') }, t('missions.prereqOf') + mi.dependents.map(d => d.mission.name).join(', ') + (pend > mi.dependents.length ? t('missions.chain', { n: pend }) : '')));
      }
      body.append(title);
      const ul = el('ul');
      for (const g of mi.goals) {
        const li = el('li', { class: g.done ? 'done' : '' });
        if (g.inRow) li.append(el('span', { class: 'badge warn', style: 'margin-right:6px', title: t('goal.row.title') }, t('goal.row')), ' ');
        li.append(goalText(g));
        if (g.progressText && !g.progress) li.append(' ', el('span', { class: 'prog' }, '— ' + g.progressText));
        if (g.progress) li.append(' ', el('span', { class: 'prog' }, `(${g.progress.done}/${g.progress.total})`));
        ul.append(li);
      }
      body.append(ul);
      box.append(body);
      list.append(box);
      if (shown >= 300) break;
    }
    if (!shown) list.append(el('div', { class: 'hint' }, t('missions.none')));
  }
  $('#missions-search').addEventListener('input', renderMissions);
  $('#missions-filter').addEventListener('change', renderMissions);
  $('#missions-anime').addEventListener('change', renderMissions);

  // ------------------------------------------------------------------ pesos
  const WEIGHT_META = {
    char: [['offense', 0, 2, 0.1], ['control', 0, 2, 0.1], ['defense', 0, 2, 0.1], ['support', 0, 2, 0.1], ['economy', 0, 2, 0.1], ['tempo', 0, 2, 0.1], ['hiddenSkills', 0, 1, 0.05], ['passive', 0, 1, 0.05]],
    team: [['roleCoverage', 0, 30, 1], ['synergy', 0, 30, 1], ['clash', 0, 40, 1], ['setupPenalty', 0, 20, 1]],
  };
  function renderWeights() {
    for (const [group, box] of [['char', $('#weights-char')], ['team', $('#weights-team')]]) {
      box.innerHTML = '';
      for (const [key, min, max, step] of WEIGHT_META[group]) {
        const cur = state.weights[key] != null ? state.weights[key] : E.getDefaultWeights()[key];
        const out = el('span', {}, String(cur));
        const range = el('input', { type: 'range', min, max, step, value: cur });
        range.addEventListener('input', () => { out.textContent = range.value; });
        range.addEventListener('change', () => {
          state.weights[key] = +range.value; save(); recompute(); renderSlots();
          if ($('#tab-ranking').classList.contains('active')) renderRanking();
        });
        box.append(el('label', {}, el('b', {}, t('w.' + key)), range, out));
      }
    }
  }
  $('#btn-weights-reset').addEventListener('click', () => { state.weights = {}; save(); recompute(); renderWeights(); renderSlots(); });
  function renderTrained() {
    const box = $('#trained-info'); if (!TRAINED) { box.style.display = 'none'; return; }
    box.style.display = '';
    const m = TRAINED._meta || {};
    const vars = { date: m.trainedAt ? new Date(m.trainedAt).toLocaleDateString(localeStr()) : '?', mode: m.mode || '?', auc: m.aucValid != null ? m.aucValid : '?', n: m.positives != null ? m.positives : '?', w: ['roleCoverage', 'synergy', 'clash', 'setupPenalty'].filter(k => k in TRAINED).map(k => `${t('w.' + k)} ${TRAINED[k]}`).join(', ') };
    $('#trained-text').textContent = t('config.trained', vars);
    $('#trained-info').querySelector('label').title = t('config.trained.title', vars);
    const cb = $('#opt-trained'); cb.checked = state.opts.useTrained !== false;
    cb.onchange = () => { state.opts.useTrained = cb.checked; save(); recompute(); renderWeights(); renderSlots(); if (lastTeams) runSuggest(); };
  }

  // ------------------------------------------------------------------ init
  load();
  I18N.applyStatic(state.lang);
  recompute();
  if (ACCOUNT && !state._missionWeightSaved) { state.opts.missionWeight = 3; save(); } // com conta, missões entram por padrão
  applyAccountOwned(false);   // primeira vez com dados novos da conta: importa "tenho"
  renderAccountChip();
  bindOpts();
  renderSlots();
  renderWeights();
  renderTrained();
  computeResults();
  renderResults();
  renderLadderTeams();
  renderCommunityTeams();
  $('#guide').style.display = state.opts.guideDismissed ? 'none' : '';
  $('#guide-close').addEventListener('click', () => { state.opts.guideDismissed = true; save(); $('#guide').style.display = 'none'; });
})();
