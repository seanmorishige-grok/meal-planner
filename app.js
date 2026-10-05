/* Family Meals — shared weekly meal planner. Vanilla JS, talks to Supabase RPCs only. */
const SUPABASE_URL = 'https://lpppmjnryqtwhdsnhzpx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwcHBtam5yeXF0d2hkc25oenB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjczMjksImV4cCI6MjEwNjgwMzMyOX0.BYQpNOpwE98_4J7ICCgDYcIzlIzwm13je9dgpWnx5KU'; // public anon key: it can only call passcode-checked RPCs
const POLL_MS = 5000;

const CAT_ORDER = ['produce', 'meat/seafood', 'dairy/eggs', 'bakery', 'pantry/dry goods', 'spices/condiments', 'frozen', 'snacks', 'other'];
const CAT_LABEL = { 'produce': '🥬 Produce', 'meat/seafood': '🥩 Meat & seafood', 'dairy/eggs': '🧀 Dairy & eggs', 'bakery': '🥖 Bakery',
  'pantry/dry goods': '🥫 Pantry', 'spices/condiments': '🧂 Spices & condiments', 'frozen': '🧊 Frozen', 'snacks': '🥨 Snacks', 'other': '🛒 Other' };
const STEPS = ['Pick', 'Pantry', 'Staples', 'List'];

const S = {
  code: localStorage.getItem('mp_code') || '',
  who: localStorage.getItem('mp_who') || '',
  data: null, tab: 'week', step: null, open: {}, busy: 0, seq: 0, lastSync: null, error: null,
};

/* ---------- api ---------- */
async function rpc(fn, args = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_code: S.code, ...args }),
  });
  const txt = await res.text();
  const body = txt ? JSON.parse(txt) : null;
  if (!res.ok) {
    const err = new Error((body && body.message) || `Error ${res.status}`);
    err.code = body && body.code;
    throw err;
  }
  return body;
}
// mutation: optimistic local change, then server call, then refresh
async function mutate(fn, args, optimistic) {
  S.busy++; S.seq++;
  if (optimistic) { optimistic(); render(); }
  try { await rpc(fn, args); }
  catch (e) { handleErr(e); }
  finally { S.busy--; }
  await refresh(true);
}
function handleErr(e) {
  if (e.code === '28P01') { logout('That passcode stopped working — please re-enter it.'); return; }
  toast('⚠️ ' + e.message);
}
async function refresh(force) {
  if (!S.code || (S.busy && !force)) return;
  const mySeq = S.seq;
  try {
    const d = await rpc('get_state');
    if (mySeq !== S.seq && !force) return; // a newer change happened while we were fetching
    S.data = d; S.lastSync = new Date(); S.error = null;
  } catch (e) {
    if (e.code === '28P01') return logout('Wrong passcode.');
    S.error = 'Offline — retrying…';
  }
  render();
}

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
function fmtDate(d) { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function fmtWhen(ts) { return new Date(ts).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
function catSort(a, b) { return (CAT_ORDER.indexOf(a) + 1 || 99) - (CAT_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b); }
function groupBy(items) {
  const g = {}; for (const i of items) (g[i.category || 'other'] ||= []).push(i);
  return Object.keys(g).sort(catSort).map(c => [c, g[c].sort((a, b) => a.name.localeCompare(b.name))]);
}
function weekStatus() { return S.data && S.data.week && S.data.week.status; }
function defaultStep() {
  const st = weekStatus();
  return st === 'ready_for_cart' || st === 'carted' ? 3 : st === 'pantry' ? 1 : 0;
}
function picked() { return (S.data.options || []).filter(o => o.picked); }

/* ---------- views ---------- */
function render() {
  const app = $('#app');
  // don't clobber a field the user is typing in
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT') && app.contains(ae) && S.data && !render.force) return;
  render.force = false;
  if (!S.code || !S.who) { app.innerHTML = loginView(); return bindLogin(); }
  if (!S.data) { app.innerHTML = '<div class="boot">🥕</div>'; return; }
  const body = S.tab === 'recipes' ? recipesView() : weekView();
  app.innerHTML = `<div class="wrap">${body}
    <div class="sync">${S.error ? esc(S.error) : S.lastSync ? 'Synced ' + S.lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''}</div></div>
    ${S.tab === 'week' ? actionBar() : ''}
    <nav class="tabbar">
      <button data-tab="week" class="${S.tab === 'week' ? 'on' : ''}"><span>🍽️</span>This week</button>
      <button data-tab="recipes" class="${S.tab === 'recipes' ? 'on' : ''}"><span>📖</span>Recipes</button>
    </nav>`;
}

function header(title, sub) {
  return `<div class="top"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <button class="who" data-act="menu">👋 ${esc(S.who)}</button></div>`;
}

function loginView() {
  const names = ['Sean'];
  return `<div class="login">
    <div class="logo">🥘</div><h1>Family Meals</h1><p>Plan the week together.</p>
    <form id="loginForm" autocomplete="off">
      <label for="code">Household passcode</label>
      <input id="code" class="field" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="word-word-00" value="${esc(S.code)}" required>
      <label for="who">Who are you?</label>
      <div class="chips" style="margin-bottom:8px">${names.map(n => `<button type="button" class="chip ${S.who === n ? 'on' : ''}" data-name="${n}">${n}</button>`).join('')}</div>
      <input id="who" class="field" type="text" placeholder="…or type your name" value="${esc(S.who)}" required>
      <div class="err" id="loginErr">${esc(S.loginErr || '')}</div>
      <button class="btn" type="submit">Let's eat →</button>
    </form></div>`;
}
function bindLogin() {
  const f = $('#loginForm');
  f.querySelectorAll('.chip').forEach(c => c.onclick = () => { $('#who').value = c.dataset.name; f.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); });
  f.onsubmit = async ev => {
    ev.preventDefault();
    const code = $('#code').value.trim().toLowerCase(), who = $('#who').value.trim();
    if (!who) { $('#loginErr').textContent = 'Tell us who you are.'; return; }
    const btn = f.querySelector('.btn'); btn.disabled = true; btn.textContent = 'Checking…';
    S.code = code;
    try {
      await rpc('check_passcode');
      localStorage.setItem('mp_code', code); localStorage.setItem('mp_who', who);
      S.who = who; S.loginErr = ''; S.data = null; render.force = true; render();
      await refresh(true);
    } catch (e) {
      S.code = '';
      $('#loginErr').textContent = e.code === '28P01' ? 'That passcode isn’t right.' : 'Couldn’t connect: ' + e.message;
      btn.disabled = false; btn.textContent = "Let's eat →";
    }
  };
}
function logout(msg) {
  localStorage.removeItem('mp_code'); S.code = ''; S.data = null; S.loginErr = msg || ''; render.force = true; render();
}

function weekView() {
  const w = S.data.week;
  if (!w) return header('This week') + `<div class="empty"><div class="e">🗓️</div><p>No week is planned yet.<br>Options will show up here when they're posted.</p></div>`;
  if (S.step == null) S.step = defaultStep();
  const st = w.status, ds = defaultStep();
  const steps = `<div class="steps">${STEPS.map((n, i) => `<button class="step ${S.step === i ? 'on' : ''} ${i < ds ? 'done' : ''}" data-step="${i}"><b>${i < ds ? '✓' : i + 1}</b>${n}</button>`).join('')}</div>`;
  let banner = '';
  if (st === 'ready_for_cart') banner = `<div class="banner ok"><span class="big">🛒 Sent to cart</span>by ${esc(w.sent_by || '?')} · ${w.sent_at ? fmtWhen(w.sent_at) : ''}. The QFC cart gets filled next.</div>`;
  if (st === 'carted') banner = `<div class="banner ok"><span class="big">✅ In the QFC cart</span>This week's groceries are in the cart.</div>`;
  if (st === 'picking' && S.step > 0 && (S.data.items || []).some(i => i.source === 'recipe')) banner = `<div class="banner info">Picks or portions changed — go back to <b>Pick</b> and tap <b>Confirm portions</b> to refresh the list.</div>`;
  const views = [pickView, pantryView, staplesView, listView];
  return header('Week of ' + fmtDate(w.week_start), statusLabel(st)) + steps + banner + views[S.step]();
}
function statusLabel(st) {
  return { picking: 'Picking meals', pantry: 'Checking pantry & staples', ready_for_cart: 'Sent to cart', carted: 'Carted' }[st] || st;
}
function locked() { return ['ready_for_cart', 'carted'].includes(weekStatus()); }

function pickView() {
  const opts = S.data.options || [], n = picked().length;
  const msg = n === 0 ? 'Tap the meals you want — aim for 3.' : n < 3 ? `${n} picked — ${3 - n} more to go.` : n === 3 ? '3 picked — perfect! 🎉' : `${n} picked (that's more than 3 — fine if you're hungry!)`;
  return `<h2>Pick this week's meals</h2><p class="hint">${msg}</p>` + opts.map(o => {
    const open = S.open[o.recipe_id] ?? false;
    const factor = o.servings / (o.base_servings || 6);
    return `<div class="card ${o.picked ? 'picked' : ''}">
      <button class="card-main" data-act="pick" data-id="${o.recipe_id}" ${locked() ? 'disabled' : ''} aria-pressed="${o.picked}">
        <div class="check">${o.picked ? '✓' : ''}</div>
        <div><div class="card-title">${esc(o.title)}</div>
          <div class="meta"><span>⏱ ${esc(o.total_time || '?')}</span><span>Serves ${o.base_servings || '?'} as written</span></div>
          ${o.description ? `<div class="desc">${esc(o.description)}</div>` : ''}</div>
      </button>
      <div style="padding:0 16px 10px 62px" class="meta"><a href="${esc(o.url)}" target="_blank" rel="noopener">View recipe ↗</a></div>
      ${o.picked ? `<div class="card-body">
        <div class="serv"><div class="serv-label">Servings<small>6 = 2 adults + 2 kids + lunches</small></div>
          <div class="stepper"><button data-act="serv" data-id="${o.recipe_id}" data-d="-1" aria-label="fewer" ${locked() ? 'disabled' : ''}>−</button><span>${o.servings}</span><button data-act="serv" data-id="${o.recipe_id}" data-d="1" aria-label="more" ${locked() ? 'disabled' : ''}>+</button></div></div>
        <button class="linkbtn" data-act="toggleIngs" data-id="${o.recipe_id}">${open ? '▾ Hide' : '▸ Show'} ingredients for ${o.servings}</button>
        ${open ? `<ul class="ings">${(o.ingredients || []).map(i => { const s = Ingredients.scaleOne(i, factor); return `<li><span class="q">${esc(s.qty)}</span><span>${esc(s.item)}</span></li>`; }).join('')}</ul>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');
}

function itemRows(items, kind) {
  return groupBy(items).map(([cat, list]) => `<div class="group">${CAT_LABEL[cat] || esc(cat)}</div><div class="list">${list.map(i => {
    if (kind === 'pantry') return `<div class="row ${i.have_it ? 'dim' : ''}"><div class="name"><b>${esc(i.name)}</b><small>${esc(i.qty || '')}</small></div>
      <button class="toggle ${i.have_it ? 'on' : ''}" data-act="have" data-id="${i.id}" aria-pressed="${i.have_it}" ${locked() ? 'disabled' : ''}>${i.have_it ? '✓ Have it' : 'Have it?'}</button></div>`;
    if (kind === 'staple') return `<div class="row ${i.include ? '' : 'dim'}"><div class="name"><b>${esc(i.name)}</b><small>${esc(stapleProduct(i))}</small></div>
      <input class="qtyin" data-act="qty" data-id="${i.id}" value="${esc(i.qty || '')}" aria-label="quantity" ${locked() ? 'disabled' : ''}>
      ${i.source === 'custom' && !locked() ? `<button class="x" data-act="rm" data-id="${i.id}" aria-label="remove">✕</button>` : ''}
      <button class="toggle add ${i.include ? 'on' : ''}" data-act="inc" data-id="${i.id}" aria-pressed="${i.include}" ${locked() ? 'disabled' : ''}>${i.include ? '✓ Buy' : 'Skip'}</button></div>`;
    return `<div class="row"><div class="name"><b>${esc(i.name)}</b><small>${i.source === 'custom' ? 'added by ' + esc(i.added_by || '') : i.source === 'staple' ? 'staple' : ''}</small></div><span class="qty">${esc(i.qty || '')}</span></div>`;
  }).join('')}</div>`).join('');
}
function stapleProduct(i) {
  if (i.source === 'custom') return 'added by ' + (i.added_by || '');
  const s = (S.data.staples || []).find(x => x.name.toLowerCase() === i.name.toLowerCase());
  return s ? s.product : '';
}
function pantryView() {
  const items = (S.data.items || []).filter(i => i.source === 'recipe');
  if (!items.length) return `<div class="empty"><div class="e">🧺</div><p>Pick meals and tap <b>Confirm portions</b> first.</p></div>`;
  const need = items.filter(i => !i.have_it).length;
  return `<h2>Pantry check</h2><p class="hint">Tap <b>Have it</b> for anything already in the kitchen. ${need} of ${items.length} to buy.</p>` + itemRows(items, 'pantry');
}
function staplesView() {
  const items = (S.data.items || []).filter(i => i.source !== 'recipe');
  const recurring = items.filter(i => i.source === 'custom' || (S.data.staples || []).some(s => s.active && s.name.toLowerCase() === i.name.toLowerCase()));
  const other = items.filter(i => !recurring.includes(i));
  if (!items.length && weekStatus() === 'picking') return `<div class="empty"><div class="e">🥛</div><p>Confirm portions on the <b>Pick</b> step first — then the usual staples show up here.</p></div>`;
  const cats = CAT_ORDER.map(c => `<option value="${c}">${(CAT_LABEL[c] || c).replace(/^\S+\s/, '')}</option>`).join('');
  return `<h2>Staples & extras</h2><p class="hint">Your usual QFC items. Tap to buy or skip, adjust amounts, or add anything else.</p>
    ${locked() ? '' : `<form id="addForm" class="list" style="padding:14px"><b>➕ Add an item</b>
      <div class="addform"><input class="field" name="name" placeholder="e.g. paper towels" required>
      <input class="field" name="qty" placeholder="qty" style="text-align:center">
      <select class="field" name="category">${cats.replace('value="other"', 'value="other" selected')}</select>
      <button class="btn small" type="submit">Add</button></div></form>`}
    <div class="group" style="font-size:15px;color:var(--ink)">Usual every week</div>${itemRows(recurring, 'staple')}
    ${other.length ? `<div class="group" style="font-size:15px;color:var(--ink);margin-top:26px">Sometimes</div>${itemRows(other, 'staple')}` : ''}`;
}
function listView() {
  const buy = (S.data.items || []).filter(i => i.include && !i.have_it);
  const meals = picked();
  return `<h2>Shopping list</h2><p class="hint">${buy.length} items · ${meals.length} meals: ${meals.map(m => esc(m.title) + ' (' + m.servings + ')').join(', ') || 'none picked'}</p>
    ${buy.length ? itemRows(buy, 'list') : `<div class="empty"><div class="e">📝</div><p>Nothing on the list yet.</p></div>`}`;
}
function actionBar() {
  const st = weekStatus(); if (!st) return '';
  let main = '', back = S.step > 0 ? `<button class="btn ghost back" data-act="go" data-step="${S.step - 1}" aria-label="back">←</button>` : '';
  if (S.step === 0) {
    const n = picked().length;
    main = locked() ? `<button class="btn ghost" data-act="go" data-step="3">See the list →</button>`
      : `<button class="btn" data-act="confirm" ${n ? '' : 'disabled'}>Confirm portions${n ? ` (${n})` : ''} →</button>`;
  } else if (S.step === 1) main = `<button class="btn" data-act="go" data-step="2">Next: staples →</button>`;
  else if (S.step === 2) main = `<button class="btn" data-act="go" data-step="3">Review list →</button>`;
  else if (S.step === 3) {
    if (st === 'ready_for_cart') main = `<button class="btn ghost" data-act="reopen">↩︎ Reopen to edit</button>`;
    else if (st === 'carted') main = `<button class="btn green" disabled>✓ Carted</button>`;
    else main = `<button class="btn green huge" data-act="send" ${st === 'pantry' ? '' : 'disabled'}>🛒 Send to cart</button>`;
  }
  return `<div class="actionbar"><div class="inner">${back}${main}</div></div>`;
}

function recipesView() {
  const rs = S.data.recipes || [];
  return header('Recipes', `${rs.filter(r => r.status !== 'pending').length} in the library`) + `
    <form id="urlForm" class="urlform"><input class="field" name="url" type="url" inputmode="url" placeholder="Paste a recipe link to add it" required>
      <button class="btn small" type="submit">➕ Add recipe</button></form>` +
    rs.map(r => r.status === 'pending' ? `<div class="rcard"><span class="badge b-pending">Importing soon</span>
        <div class="card-title" style="margin-top:6px;word-break:break-all;font-size:15px">${esc(r.url)}</div>
        <div class="meta">Added by ${esc(r.added_by || '?')} — ingredients get filled in by the assistant.${r.notes ? ' ' + esc(r.notes) : ''}</div></div>`
      : `<div class="rcard"><span class="badge b-${esc(r.status)}">${esc(r.status)}</span>
        <div class="card-title" style="margin-top:6px">${esc(r.title)}</div>
        <div class="meta"><span>⏱ ${esc(r.total_time || '?')}</span><span>Serves ${r.servings || '?'}</span>${r.last_cooked ? `<span>Last: ${fmtDate(r.last_cooked)}</span>` : ''}${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Recipe ↗</a>` : ''}</div>
        <div class="vbtns"><button class="vbtn keep ${r.verdict === 'keep' ? 'on' : ''}" data-act="verdict" data-v="keep" data-id="${r.id}">👍 Keep</button>
          <button class="vbtn swap ${r.verdict === 'swap' ? 'on' : ''}" data-act="verdict" data-v="swap" data-id="${r.id}">🔄 Swap out</button></div>
        ${r.verdict ? `<div class="meta">Last vote: ${r.verdict} by ${esc(r.verdict_by || '?')}</div>` : ''}</div>`).join('');
}

/* ---------- events ---------- */
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act],[data-tab],[data-step]'); if (!el || el.disabled) return;
  const d = S.data, w = d && d.week, id = +el.dataset.id;
  if (el.dataset.tab) { S.tab = el.dataset.tab; render.force = true; render(); window.scrollTo(0, 0); return; }
  const act = el.dataset.act;
  if (!act && el.dataset.step != null) { S.step = +el.dataset.step; render.force = true; render(); window.scrollTo(0, 0); return; }
  const opt = () => d.options.find(o => o.recipe_id === id), item = () => d.items.find(i => i.id === id);
  switch (act) {
    case 'go': S.step = +el.dataset.step; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'pick': { const o = opt(); const v = !o.picked;
      if (v && picked().length >= 3) toast('That makes ' + (picked().length + 1) + ' — 3 is the goal');
      mutate('set_pick', { p_week: w.id, p_recipe: id, p_picked: v }, () => { o.picked = v; if (w.status === 'pantry') w.status = 'picking'; }); break; }
    case 'serv': { const o = opt(); const v = Math.max(1, Math.min(30, o.servings + +el.dataset.d));
      mutate('set_servings', { p_week: w.id, p_recipe: id, p_servings: v }, () => { o.servings = v; if (w.status === 'pantry') w.status = 'picking'; }); break; }
    case 'toggleIngs': S.open[id] = !S.open[id]; render(); break;
    case 'confirm': {
      const items = Ingredients.combine(d.options).map(({ name, qty, category, have_it }) => ({ name, qty, category, have_it }));
      el.disabled = true; el.textContent = 'Building list…';
      await mutate('confirm_portions', { p_week: w.id, p_items: items, p_who: S.who });
      S.step = 1; render.force = true; render(); window.scrollTo(0, 0); toast('Portions confirmed ✓'); break; }
    case 'have': { const i = item(); const v = !i.have_it; mutate('set_item', { p_item: id, p_have_it: v, p_include: null, p_qty: null }, () => { i.have_it = v; }); break; }
    case 'inc': { const i = item(); const v = !i.include; mutate('set_item', { p_item: id, p_have_it: null, p_include: v, p_qty: null }, () => { i.include = v; }); break; }
    case 'rm': { mutate('remove_item', { p_item: id }, () => { d.items = d.items.filter(i => i.id !== id); }); break; }
    case 'send':
      el.disabled = true;
      await mutate('set_week_status', { p_week: w.id, p_status: 'ready_for_cart', p_who: S.who }, () => { w.status = 'ready_for_cart'; w.sent_by = S.who; w.sent_at = new Date().toISOString(); });
      toast('🛒 Sent! The cart gets filled next.'); break;
    case 'reopen': mutate('set_week_status', { p_week: w.id, p_status: 'pantry', p_who: S.who }, () => { w.status = 'pantry'; }); break;
    case 'verdict': { const r = d.recipes.find(x => x.id === id), v = el.dataset.v;
      mutate('recipe_verdict', { p_recipe: id, p_verdict: v, p_who: S.who }, () => { r.verdict = v; r.verdict_by = S.who; }); toast(v === 'keep' ? '👍 Keeping it' : '🔄 Marked to swap out'); break; }
    case 'menu': showMenu(); break;
  }
});
document.addEventListener('change', ev => {
  const el = ev.target; if (el.dataset.act !== 'qty') return;
  const id = +el.dataset.id, i = S.data.items.find(x => x.id === id), v = el.value.trim();
  el.blur();
  mutate('set_item', { p_item: id, p_have_it: null, p_include: null, p_qty: v }, () => { i.qty = v; });
});
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.dataset.act === 'qty') ev.target.blur(); });
document.addEventListener('submit', async ev => {
  const f = ev.target;
  if (f.id === 'addForm') {
    ev.preventDefault();
    const fd = new FormData(f), name = fd.get('name').trim(); if (!name) return;
    document.activeElement && document.activeElement.blur();
    await mutate('add_item', { p_week: S.data.week.id, p_name: name, p_qty: fd.get('qty'), p_category: fd.get('category'), p_who: S.who });
    toast('Added ' + name); render.force = true; render();
  } else if (f.id === 'urlForm') {
    ev.preventDefault();
    const url = new FormData(f).get('url').trim();
    document.activeElement && document.activeElement.blur();
    await mutate('add_recipe_url', { p_url: url, p_who: S.who });
    toast('📖 Added — ingredients coming soon'); render.force = true; render();
  }
});
function showMenu() {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet"><b>Signed in as ${esc(S.who)}</b>
    <button class="btn ghost" data-m="who">Switch person</button>
    <button class="btn ghost" data-m="out">Forget passcode on this phone</button>
    <button class="btn" data-m="close">Close</button></div>`;
  bg.onclick = e => {
    const m = e.target.dataset.m; if (e.target !== bg && !m) return;
    bg.remove();
    if (m === 'who') { localStorage.removeItem('mp_who'); S.who = ''; render.force = true; render(); }
    if (m === 'out') logout('');
  };
  document.body.appendChild(bg);
}

/* ---------- sync loop ---------- */
setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('focus', () => refresh());
render();
if (S.code && S.who) refresh(true);
