/* NA Team Builder - aba Ferramentas: executa os scripts pelo servidor local (server.js, aberto por start.js).
 * Aberto direto pelo arquivo (file://), a aba só lista os comandos equivalentes do terminal. */
(function () {
  'use strict';
  const I18N = window.NAI18N;
  const CHARS = Array.isArray(window.NA_CHARACTERS) ? window.NA_CHARACTERS : [];
  const STORAGE_KEY = 'na-team-builder';
  const $ = s => document.querySelector(s);
  const lang = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').lang === 'en' ? 'en' : 'pt'; } catch (e) { return 'pt'; } };
  const t = (k, v) => I18N.t(lang(), k, v);
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v != null) n.setAttribute(k, v); }
    for (const k of kids.flat()) if (k != null) n.append(k);
    return n;
  }
  // comandos equivalentes (mostrados quando não há servidor)
  const CMDS = {
    'atualizar-tudo': 'node start.js --nao-abrir [--forcar]', 'atualizar-dados': 'node scripts/update-game-data.js', 'balanceamentos': 'node scripts/download-patch-notes.js && node scripts/build-winrate.js',
    'winrate': 'node scripts/build-winrate.js', 'comunidade': 'node scripts/build-community.js', 'skills-db': 'node scripts/build-skills-db.js', 'imagens': 'node scripts/download-images.js [--forcar]',
    'forum': 'NA_USER=... NA_PASS=... node scripts/download-forum.js', 'coletar-times': 'NA_USER=... NA_PASS=... node scripts/collect-ladder-teams.js --paginas 15', 'mapear-site': 'NA_USER=... NA_PASS=... node scripts/map-site.js', 'conta': 'NA_USER=... NA_PASS=... node scripts/download-account.js', 'trocar-conta': 'node scripts/switch-account.js <usuario>',
    'observar': 'NA_USER=... NA_PASS=... node scripts/watch-matches.js --intervalo 45', 'diario': 'node scripts/diary.js', 'diario-registrar': 'node scripts/diary.js registrar "A" "B" "C" vitorias derrotas',
    'treinar': 'node scripts/train-synergy.js --modo=forca|todos|diario [--aplicar]', 'calibrar': 'node scripts/calibrate.js', 'validar-winrate': 'node scripts/validate-winrate.js', 'validar-chakra': 'node scripts/validate-chakra.js', 'cobertura-skills': 'node scripts/skill-coverage.js [--detalhe]', 'saude': 'NA_USER=... NA_PASS=... node scripts/health-check.js', 'testes': 'node test.js',
    'simular': 'node scripts/simulate.js --partidas 40000', 'winrate-pagina': 'NA_USER=... NA_PASS=... node scripts/download-winrate-page.js', 'atalho': 'node scripts/create-launcher.js',
  };
  const GRUPOS = ['jogo', 'conta', 'analise', 'experimentos', 'sistema'];
  const PAGE_LOADED = Date.now();
  let estado = null, online = null, selected = null, logPos = 0, timer = null, dismissedAt = 0, quit = false;
  const paramValues = {};
  const locale = () => (lang() === 'en' ? 'en-US' : 'pt-BR');
  const hhmm = ms => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

  async function api(url, body) {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j.erro) j.erro = 'http ' + r.status;
    return j;
  }
  const tabActive = () => $('#tab-tools').classList.contains('active');
  const running = () => estado && Object.values(estado.execucoes || {}).some(e => e.status === 'rodando');

  // ------------------------------------------------------------------ polling
  async function refresh() {
    if (quit) return;
    if (!/^https?:$/.test(location.protocol)) { online = false; renderOffline(); updateBanner(); return; }   // aberto pelo arquivo: sem servidor
    try {
      const j = await api('/api/estado');
      if (j.app !== 'na-team-builder') throw new Error('não é o servidor');
      estado = j;
      if (online !== true) { online = true; renderOnline(); } else updateStatuses();
    } catch (e) { estado = null; if (online !== false) { online = false; renderOffline(); } }
    updateDot(); updateBanner(); updateObserverChip();
    if (online && selected) await pollLog();
    schedule();
  }
  // chip no cabeçalho enquanto o observador roda: partidas registradas hoje
  function updateObserverChip() {
    const chip = $('#observer-chip');
    const run = estado && estado.execucoes && estado.execucoes.observar;
    if (!run || run.status !== 'rodando') { chip.style.display = 'none'; return; }
    const st = estado.observador || { hoje: 0, vitoriasHoje: 0 };
    chip.textContent = t('obs.chip', { n: st.hoje, w: st.vitoriasHoje });
    chip.style.display = '';
  }
  $('#observer-chip').addEventListener('click', () => { document.querySelector('nav button[data-tab="tools"]').click(); if (online) select('observar'); });
  function schedule() { clearTimeout(timer); if (online === false) return; timer = setTimeout(refresh, tabActive() || running() ? 1500 : 8000); }
  async function pollLog() {
    try {
      const j = await api(`/api/tarefas/${selected}/log?desde=${logPos}`);
      const pre = $('#tools-log');
      if (j.reiniciou || logPos === 0) { pre.textContent = ''; logPos = 0; }
      if (j.texto) {
        const stick = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
        pre.textContent += j.texto; logPos += j.texto.length;
        if (stick) pre.scrollTop = pre.scrollHeight;
      }
    } catch (e) { /* servidor caiu; o refresh trata */ }
  }
  function updateDot() { $('#tools-dot').style.display = running() ? '' : 'none'; }
  function updateBanner() {
    const b = $('#banner'), txt = $('#banner-text'), btn = $('#banner-reload');
    if (quit) { b.style.display = 'none'; return; }
    const ini = estado && estado.execucoes && estado.execucoes.inicio;
    if (ini && ini.status === 'rodando') { txt.textContent = t('banner.checking'); btn.style.display = 'none'; b.style.display = ''; return; }
    const accountChanged = estado && estado.arquivos ? estado.arquivos.account : 0;   // o observador grava o progresso das missões na conta
    const changed = Math.max(estado ? estado.dadosAlterados || 0 : 0, accountChanged);
    if (changed > PAGE_LOADED && changed > dismissedAt) { txt.textContent = t(accountChanged > (estado.dadosAlterados || 0) ? 'banner.account' : 'banner.updated'); btn.style.display = ''; b.style.display = ''; return; }
    b.style.display = 'none';
  }
  $('#banner-reload').addEventListener('click', () => location.reload());
  $('#banner-close').addEventListener('click', () => { dismissedAt = Date.now(); updateBanner(); });

  // ------------------------------------------------------------------ render
  function renderOffline() {
    $('#tools-online').style.display = 'none';
    const box = $('#tools-offline'); box.style.display = '';
    box.querySelectorAll('.cmds').forEach(n => n.remove());
    const ul = el('ul', { class: 'cmds hint', style: 'line-height:1.8' });
    for (const id of Object.keys(CMDS)) ul.append(el('li', {}, el('b', {}, t('task.' + id)), ': ', el('code', {}, CMDS[id])));
    box.append(ul);
    if (quit) { box.querySelector('p').textContent = t('tools.quit.done'); ul.remove(); }
  }
  function renderOnline() {
    $('#tools-offline').style.display = 'none';
    $('#tools-online').style.display = '';
    renderLogin();
    const groups = $('#tools-groups'); groups.innerHTML = '';
    const ids = Object.keys(estado.tarefas);
    for (const g of GRUPOS) {
      const inGroup = ids.filter(id => estado.tarefas[id].grupo === g);
      if (!inGroup.length) continue;
      const card = el('div', { class: 'card', style: 'margin-bottom:12px' }, el('h3', { style: 'margin:0 0 4px' }, t('tools.group.' + g)));
      for (const id of inGroup) card.append(renderTask(id));
      groups.append(card);
    }
    if (!$('#tools-chars')) { const dl = el('datalist', { id: 'tools-chars' }); for (const c of CHARS) dl.append(el('option', { value: c.name })); document.body.append(dl); }
    updateStatuses();
    $('#tools-log-title').textContent = selected ? t('tools.log') + ' — ' + t('task.' + selected) : t('tools.log');
  }
  let loginKey = null;
  function renderLogin() {
    const s = estado.login || {};
    loginKey = JSON.stringify(s);
    const user = $('#tools-user'); if (!user.value && s.user) user.value = s.user;
    $('#tools-forget').style.display = s.senhaSalva ? '' : 'none';
    $('#tools-login-status').textContent = s.senhaSalva ? t('tools.login.saved', { user: s.user }) : t('tools.login.none');
    const auto = $('#tools-autoobs'); auto.checked = !!(estado.config && estado.config.observarAoAbrir);
    auto.onchange = async () => { await api('/api/config', { observarAoAbrir: auto.checked }); await refresh(); };
    const cap = $('#tools-capture'); cap.checked = !!(estado.config && estado.config.capturarAdversario);
    cap.onchange = async () => {
      if (cap.checked && !confirm(t('tools.capture.confirm'))) { cap.checked = false; return; }
      await api('/api/config', { capturarAdversario: cap.checked });
      await refresh();
      if (estado && estado.execucoes.observar && estado.execucoes.observar.status === 'rodando') alert(t('tools.capture.restart'));
    };
  }
  function paramControl(id, p) {
    const vals = paramValues[id] || (paramValues[id] = {});
    const cur = vals[p.id] != null ? vals[p.id] : p.padrao;
    let input;
    if (p.tipo === 'bool') { input = el('input', { type: 'checkbox' }); input.checked = vals[p.id] = !!cur; input.addEventListener('change', () => { vals[p.id] = input.checked; }); return el('label', {}, input, ' ', t('param.' + p.id)); }
    if (p.tipo === 'number') { input = el('input', { type: 'number', min: p.min != null ? p.min : null, value: cur != null ? cur : '' }); }
    else if (p.tipo === 'select') { input = el('select', {}); for (const o of p.opcoes) input.append(el('option', { value: o }, t('param.' + p.id + '.' + o))); input.value = cur || p.opcoes[0]; }
    else if (p.tipo === 'conta') {
      input = el('select', {});
      const ativa = estado.conta && estado.conta.username ? estado.conta.username.toLowerCase() : '';
      for (const c of estado.contas || []) input.append(el('option', { value: c.username.toLowerCase() }, `${c.username} · ${c.rank || '?'} ${c.level != null ? c.level : ''}`.trim() + (c.username.toLowerCase() === ativa ? ' ★' : '')));
      if (!(estado.contas || []).length) input.append(el('option', { value: '' }, '—'));
      const other = (estado.contas || []).find(c => c.username.toLowerCase() !== ativa);
      input.value = cur || (other ? other.username.toLowerCase() : input.value);
    }
    else { input = el('input', { type: 'text', list: 'tools-chars', value: cur || '', autocomplete: 'off' }); }
    vals[p.id] = input.value;
    input.addEventListener('input', () => { vals[p.id] = input.value; });
    input.addEventListener('change', () => { vals[p.id] = input.value; });
    return el('label', {}, t('param.' + p.id) + ' ', input);
  }
  function renderTask(id) {
    const d = estado.tarefas[id];
    const badges = el('span', { class: 'badges', style: 'display:inline-flex;margin-left:8px' });
    if (d.login) badges.append(el('span', { class: 'badge warn', title: t('tools.needsLogin.title') }, t('tools.needsLogin')));
    if (d.demorada) badges.append(el('span', { class: 'badge', title: t('tools.slow.title') }, t('tools.slow')));
    if (d.daemon) badges.append(el('span', { class: 'badge good', title: t('tools.daemon.title') }, t('tools.daemon')));
    if (d.recarregar) badges.append(el('span', { class: 'badge', title: t('tools.reloads.title') }, t('tools.reloads')));
    const left = el('div', {}, el('div', { class: 'tname' }, t('task.' + id), badges), el('div', { class: 'tdesc' }, t('task.' + id + '.d')));
    if (d.params && d.params.length) { const pr = el('div', { class: 'tparams' }); for (const p of d.params) pr.append(paramControl(id, p)); left.append(pr); }
    const btn = el('button', { class: 'small primary', onclick: () => run(id) }, t(d.daemon ? 'tools.start' : 'tools.run'));
    const stop = el('button', { class: 'small danger', style: 'display:none', onclick: () => api(`/api/tarefas/${id}/parar`, {}).then(refresh) }, t('tools.stop'));
    const status = el('div', { class: 'tstatus' });
    const row = el('div', { class: 'task', id: 'task-' + id, onclick: ev => { if (ev.target.closest('button, input, select, label')) return; select(id); } }, left, el('div', { class: 'tactions' }, el('div', {}, btn, ' ', stop), status));
    row._btn = btn; row._stop = stop; row._status = status;
    return row;
  }
  function updateStatuses() {
    if (!estado) return;
    if (JSON.stringify(estado.login || {}) !== loginKey) renderLogin();
    for (const id of Object.keys(estado.tarefas)) {
      const row = $('#task-' + id); if (!row) continue;
      const e = estado.execucoes[id] || {};
      row.classList.toggle('selected', id === selected);
      const rodando = e.status === 'rodando';
      row._btn.disabled = rodando; row._stop.style.display = rodando ? '' : 'none';
      row._status.className = 'tstatus ' + (e.status || '');
      row._status.textContent = rodando ? t('tools.running') + (e.inicio ? ' · ' + hhmm(e.inicio) : '') : e.fim ? t('tools.last', { s: t('tools.status.' + e.status), time: hhmm(e.fim) }) : t('tools.never');
    }
    const ini = estado.execucoes.inicio;
    if (ini && ini.status === 'rodando' && !selected) select('inicio');
  }
  function select(id) { if (selected !== id) { selected = id; logPos = 0; $('#tools-log').textContent = ''; } $('#tools-log-title').textContent = t('tools.log') + ' — ' + (id === 'inicio' ? t('task.inicio') : t('task.' + id)); updateStatuses(); pollLog(); }
  async function run(id) {
    const body = { params: paramValues[id] || {}, user: $('#tools-user').value.trim(), pass: $('#tools-pass').value, salvar: $('#tools-save').checked };
    const st = $('#tools-login-status');
    try {
      const r = await api(`/api/tarefas/${id}/iniciar`, body);
      if (r.erro) { st.textContent = r.erro === 'ocupado' ? t('tools.err.ocupado', { t: t('task.' + r.tarefa) }) : t('tools.err.' + r.erro) || r.erro; st.style.color = 'var(--bad)'; return; }
      st.style.color = '';
      if (body.salvar) $('#tools-save').checked = false;
      select(id); dismissedAt = 0;
      await refresh();
    } catch (e) { st.textContent = t('tools.err.net'); st.style.color = 'var(--bad)'; }
  }
  $('#tools-forget').addEventListener('click', async () => { await api('/api/login/esquecer', {}); $('#tools-pass').value = ''; await refresh(); renderLogin(); });
  $('#tools-log-clear').addEventListener('click', () => { $('#tools-log').textContent = ''; });
  $('#tools-quit').addEventListener('click', async () => {
    if (!confirm(t('tools.quit.confirm'))) return;
    try { await api('/api/encerrar', {}); } catch (e) { /* já caiu */ }
    quit = true; online = false; clearTimeout(timer); estado = null; updateDot(); updateBanner(); renderOffline();
  });
  document.addEventListener('na:lang', () => { if (online) renderOnline(); else if (online === false) renderOffline(); updateBanner(); });
  document.querySelector('nav button[data-tab="tools"]').addEventListener('click', () => { if (online) { clearTimeout(timer); refresh(); } });

  refresh();
})();
