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
  data: null, tab: 'week', step: null, open: {}, batches: {}, busy: 0, seq: 0, lastSync: null, error: null,
  noteDraft: {}, tagFilter: [] /* Recipes tab tag filter (AND) */, pickTags: [] /* Pick step tag filter */, detail: null /* {id, r, loading} recipe detail page */,
  mode: null /* 'plan' | 'shop' on This week */, sel: null /* meal picked up for scheduling: {w, r} */, drag: null,
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
async function mutate(fn, args, optimistic, onOk) {
  S.busy++; S.seq++;
  if (optimistic) { optimistic(); render(); }
  try { await rpc(fn, args); if (onOk) onOk(); }
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

// Fire-and-forget ping so the assistant reacts right away; failures are ignored (an hourly check is the fallback).
function notifyAssistant(event, ids) {
  try {
    fetch(`${SUPABASE_URL}/functions/v1/notify`, { method: 'POST', keepalive: true,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: S.code, event, by: S.who, ...ids }) }).catch(() => {});
  } catch (e) { /* ignore */ }
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
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA') && app.contains(ae) && S.data && !render.force) return;
  if (S.drag && S.data && !render.force) return; // don't rebuild the page mid-drag
  render.force = false;
  if (!S.code || !S.who) { app.innerHTML = loginView(); return bindLogin(); }
  if (!S.data) { app.innerHTML = '<div class="boot">🥕</div>'; return; }
  const body = S.tab === 'recipes' ? recipesView() : S.tab === 'quick' ? cartBanners('quick') + quickView() : cartBanners('week') + weekView();
  app.innerHTML = `<div class="wrap">${body}
    <div class="sync">${S.error ? esc(S.error) : S.lastSync ? 'Synced ' + S.lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''}</div></div>
    ${S.tab === 'week' && weekMode() === 'shop' ? actionBar() : S.tab === 'quick' ? quickActionBar() : ''}
    <nav class="tabbar">
      <button data-tab="week" class="${S.tab === 'week' ? 'on' : ''}"><span>🍽️</span>This week</button>
      <button data-tab="quick" class="${S.tab === 'quick' ? 'on' : ''}"><span>🛒</span>Quick order${S.data.quick && S.data.quick.status === 'picking' ? ' •' : ''}</button>
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

/* ---------- QFC cart-fill status banner (written by the assistant's cart routines via scripts/set_cart_status.py) ---------- */
function cartBanners(kind) {
  const rows = ((S.data && S.data.cart_status) || []).filter(c => c.kind === kind);
  return rows.map(c => {
    const fmtT = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const prog = c.total ? `${c.added ?? 0} of ${c.total} items are in the cart` : '';
    const missing = c.missing || [];
    const label = kind === 'quick' ? `Quick order #${c.week_id}` : `Week of ${fmtDate(c.week_start)}`;
    let icon = '🛒', cls = 'info', head = c.message;
    if (c.status === 'blocked_retrying') { icon = '⚠️'; cls = 'warn'; head ||= `QFC's site is having trouble.${prog ? ' ' + prog + ' so far.' : ''}`; }
    else if (c.status === 'filling') head ||= `Filling the QFC cart…${prog ? ' ' + prog + '.' : ''}`;
    else if (c.status === 'partial') { icon = '⚠️'; cls = 'warn'; head ||= `Cart is filled except ${missing.length} item${missing.length === 1 ? '' : 's'}. Please add these in the QFC app before checkout.`; }
    else if (c.status === 'done') { icon = '✅'; cls = 'ok'; head ||= 'All items added to the QFC cart.'; }
    const retry = c.retry_at && ['blocked_retrying', 'filling', 'partial'].includes(c.status)
      ? (new Date(c.retry_at) > new Date() ? `Retrying automatically around <b>${fmtT(c.retry_at)}</b>.` : 'Retrying now…') : '';
    const pct = c.total ? Math.round(100 * Math.min(c.added || 0, c.total) / c.total) : null;
    return `<div class="banner cart ${cls}" role="status" aria-live="polite">
      <div class="cart-head"><span class="big">${icon} ${esc(head)}</span></div>
      ${pct != null ? `<div class="cartbar" aria-label="${pct}% in cart"><i style="width:${pct}%"></i></div><div class="cart-meta">${esc(prog)} · ${label}</div>` : `<div class="cart-meta">${label}</div>`}
      ${retry ? `<div class="cart-retry">${retry}</div>` : ''}
      ${missing.length ? `<details class="cart-missing" ${missing.length <= 4 ? 'open' : ''}><summary>${c.status === 'done' ? 'Not added' : 'Still missing'} (${missing.length})</summary><ul>${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul></details>` : ''}
      <div class="cart-meta" style="margin-top:4px">Updated ${fmtT(c.updated_at)}</div></div>`;
  }).join('');
}
// keep the banner fresh: re-check when the app comes back to the foreground, plus every 60 s while a fill is in progress
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { const live = ((S.data && S.data.cart_status) || []).some(c => ['filling', 'blocked_retrying'].includes(c.status)); if (live) refresh(); else render(); }, 60000);

/* ---------- meal calendar ("This week's plan") ---------- */
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayName = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
function todayISO() { return new Date(S.data.server_time || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); }
function plans() { return (S.data && S.data.plans) || []; }
function planLabel(p) {
  const t = todayISO(), end = addDays(p.week_start, 6);
  if (p.week_start <= t && t <= end) return "This week's plan";
  if (p.week_start > t && p.week_start <= addDays(t, 7)) return "Next week's plan";
  return 'Week of ' + fmtDate(p.week_start);
}
// Plan view is the default once the shown week is sent/carted, or while a sent plan covers today; picking stays one tap away.
function weekMode() {
  if (!plans().length) return 'shop';
  if (S.mode) return S.mode;
  const t = todayISO();
  return locked() || plans().some(p => p.week_start <= t && t <= addDays(p.week_start, 6)) ? 'plan' : 'shop';
}
function modeToggle() {
  if (!plans().length) return '';
  const m = weekMode();
  return `<div class="seg"><button class="${m === 'plan' ? 'on' : ''}" data-act="mode" data-mode="plan">📅 Plan</button><button class="${m === 'shop' ? 'on' : ''}" data-act="mode" data-mode="shop">🛒 Picks & list</button></div>`;
}
function mealChip(p, m) {
  const sel = S.sel && S.sel.w === p.week_id && S.sel.r === m.recipe_id;
  const link = m.url ? `<a class="rlink" href="${esc(m.url)}" target="_blank" rel="noopener">Recipe ↗</a>`
    : `<button class="rlink linkbtn" data-act="showRecipe" data-id="${m.recipe_id}">Recipe →</button>`;
  return `<div class="meal ${sel ? 'sel' : ''}" draggable="true" role="button" tabindex="0" data-act="selMeal" data-week="${p.week_id}" data-id="${m.recipe_id}" aria-pressed="${sel}">
    <div class="mt"><b>${esc(m.title)}</b>${m.long_cook ? `<span class="flag" title="Long cook: ${esc(m.total_time || '')}">⏳ Long cook</span>` : ''}</div>
    <div class="mm"><span>Serves ${m.servings}${m.total_time ? ' · ' + esc(m.total_time) : ''}</span>${link}</div></div>`;
}
function planSection(p) {
  const end = addDays(p.week_start, 6), t = todayISO(), days = [0, 1, 2, 3, 4, 5, 6].map(n => addDays(p.week_start, n));
  const on = d => p.meals.filter(m => m.planned_date === d);
  const tray = p.meals.filter(m => !m.planned_date || m.planned_date < p.week_start || m.planned_date > end);
  const picking = S.sel && S.sel.w === p.week_id;
  const selMeal = picking && p.meals.find(m => m.recipe_id === S.sel.r);
  return `<section class="plan"><h2>${planLabel(p)} <small>${fmtDate(p.week_start)} – ${fmtDate(end)}${p.status === 'carted' ? ' · carted' : ' · sent to cart'}</small></h2>
    ${picking && selMeal ? `<div class="banner info selhint">Now tap a day for <b>${esc(selMeal.title)}</b>${selMeal.planned_date ? ' (or the tray to unschedule it)' : ''}. <button class="linkbtn" data-act="selMeal" data-week="${p.week_id}" data-id="${selMeal.recipe_id}">Cancel</button></div>`
      : `<p class="hint">Tap a meal, then tap a day<span class="desk"> — or drag it</span>. Syncs to every phone.</p>`}
    <div class="tray drop ${picking ? 'target' : ''}" data-act="dropTray" data-week="${p.week_id}"><div class="trayhead">Not scheduled yet${tray.length ? ` (${tray.length})` : ''}</div>
      ${tray.length ? tray.map(m => mealChip(p, m)).join('') : `<div class="none">${p.meals.length ? 'Every meal has a day ✓' : 'No meals were picked for this week.'}</div>`}</div>
    <div class="days">${days.map(d => `<div class="day drop ${d === t ? 'today' : ''} ${picking ? 'target' : ''}" data-act="dropDay" data-week="${p.week_id}" data-date="${d}">
      <div class="dayhead"><b>${dayName(d)}</b><small>${fmtDate(d)}${d === t ? ' · today' : ''}</small></div>
      <div class="daymeals">${on(d).map(m => mealChip(p, m)).join('') || `<span class="none">${picking ? 'Tap to put it here' : '—'}</span>`}</div></div>`).join('')}</div></section>`;
}
function planView() {
  const ps = plans();
  return header('Meal plan', ps.length > 1 ? 'This week and next' : planLabel(ps[0])) + modeToggle() + ps.map(planSection).join('');
}
// recipe sheet for recipes without a web link (typed-up photo recipes)
async function showRecipe(id) {
  let r; try { r = await rpc('get_recipe', { p_id: id }); } catch (e) { return handleErr(e); }
  if (!r) return toast('Recipe not found');
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" style="max-height:88vh;overflow:auto"><h2 style="margin-top:0">${esc(r.title)}</h2>
    <p class="hint">Serves ${esc(r.servings || '?')}${r.total_time ? ' · ' + esc(r.total_time) : ''}</p>
    <h3>Ingredients</h3><ul class="ings">${(r.ingredients || []).map(i => `<li>${esc([i.qty, i.unit, i.item].filter(Boolean).join(' '))}</li>`).join('')}</ul>
    ${(r.steps || []).length ? `<h3>Steps</h3><ol class="rsteps">${r.steps.map(t => `<li>${esc(typeof t === 'string' ? t : t.text || '')}</li>`).join('')}</ol>` : ''}
    ${r.url ? `<p><a href="${esc(r.url)}" target="_blank" rel="noopener">Open original ↗</a></p>` : ''}
    <button class="btn" data-close>Close</button></div>`;
  bg.onclick = e => { if (e.target === bg || e.target.hasAttribute('data-close')) bg.remove(); };
  document.body.appendChild(bg);
}
async function setPlanDay(w, r, date) {
  S.sel = null;
  const p = plans().find(x => x.week_id === w), m = p && p.meals.find(x => x.recipe_id === r);
  if (!m || (m.planned_date || null) === (date || null)) { render.force = true; return render(); }
  await mutate('set_plan_day', { p_week: w, p_recipe: r, p_date: date, p_who: S.who }, () => { m.planned_date = date; render.force = true; });
}

function weekView() {
  if (weekMode() === 'plan') return planView();
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
  return header('Week of ' + fmtDate(w.week_start), statusLabel(st)) + modeToggle() + steps + banner + views[S.step]();
}
function statusLabel(st) {
  return { picking: 'Picking meals', pantry: 'Checking pantry & staples', ready_for_cart: 'Sent to cart', carted: 'Carted' }[st] || st;
}
function locked() {
  if (S.tab === 'quick') { const q = S.data && S.data.quick; return !q || q.status !== 'picking'; }
  return ['ready_for_cart', 'carted'].includes(weekStatus());
}
function allItems() { return [...(S.data.items || []), ...((S.data.quick && S.data.quick.items) || [])]; }

function pickView() {
  const opts = S.data.options || [], n = picked().length;
  const msg = n === 0 ? 'Tap the meals you want — aim for 3.' : n < 3 ? `${n} picked — ${3 - n} more to go.` : n === 3 ? '3 picked — perfect! 🎉' : `${n} picked (that's more than 3 — fine if you're hungry!)`;
  const pickedNames = picked().map(o => esc(o.title)).join(' · ');
  const more = S.data.more_available || 0;
  const moreBtn = locked() ? '' : more > 0
    ? `<button class="btn ghost" data-act="more" style="margin:6px 0 4px">➕ More recipes <small style="font-weight:500;opacity:.75">(${Math.min(6, more)} more from the library)</small></button>`
    : `<div class="empty" style="padding:18px 8px"><p>That's all for now — add a recipe link in the <a href="#" data-tab="recipes">Recipes tab</a>.</p></div>`;
  const shown = opts.filter(o => o.picked || hasTags(o.tags, S.pickTags));
  const usedTags = new Set(opts.flatMap(o => o.tags || []));
  return `<h2>Pick this week's meals</h2><p class="hint">${msg}${pickedNames ? `<br><b style="color:var(--accent-dark)">✓ ${pickedNames}</b>` : ''}</p>`
    + tagFilterBar('pickTags', [...usedTags])
    + (shown.length ? '' : `<div class="empty" style="padding:14px 8px"><p>No options match those tags.</p></div>`)
    + shown.map(o => {
    const open = S.open[o.recipe_id] ?? false;
    const factor = o.servings / (o.base_servings || 6);
    return `<div class="card ${o.picked ? 'picked' : ''}">
      <button class="card-main" data-act="pick" data-id="${o.recipe_id}" ${locked() ? 'disabled' : ''} aria-pressed="${o.picked}">
        <div class="check">${o.picked ? '✓' : ''}</div>
        <div><div class="card-title">${esc(o.title)}</div>
          <div class="meta"><span>⏱ ${esc(o.total_time || '?')}</span><span>Serves ${o.base_servings || '?'} as written</span><span>${lastCooked(o.last_cooked)}</span></div>
          ${tagPills(o.tags)}
          ${o.description ? `<div class="desc">${esc(o.description)}</div>` : ''}</div>
      </button>
      <div style="padding:0 16px 10px 62px" class="meta">${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">View recipe ↗</a>` : `<button class="linkbtn" style="padding:0;min-height:0;font-size:14px" data-act="showRecipe" data-id="${o.recipe_id}">View recipe →</button>`}</div>
      ${o.picked ? `<div class="card-body">
        <div class="serv"><div class="serv-label">Servings<small>6 = 2 adults + 2 kids + lunches</small></div>
          <div class="stepper"><button data-act="serv" data-id="${o.recipe_id}" data-d="-1" aria-label="fewer" ${locked() ? 'disabled' : ''}>−</button><span>${o.servings}</span><button data-act="serv" data-id="${o.recipe_id}" data-d="1" aria-label="more" ${locked() ? 'disabled' : ''}>+</button></div></div>
        <button class="linkbtn" data-act="toggleIngs" data-id="${o.recipe_id}">${open ? '▾ Hide' : '▸ Show'} ingredients for ${o.servings}</button>
        ${open ? `<ul class="ings">${(o.ingredients || []).map(i => { const s = Ingredients.scaleOne(i, factor); return `<li><span class="q">${esc(s.qty)}</span><span>${esc(s.item)}</span></li>`; }).join('')}</ul>` : ''}
      </div>` : ''}
    </div>`;
  }).join('') + moreBtn + `<div style="text-align:center;margin-top:14px"><button class="linkbtn" data-act="startOver" style="color:var(--muted);font-weight:500">↺ Start over</button></div>`;
}

// "(for Bolognese, Piccata)" / "(staple)" / "(added by Sean)" shown after an item's name
function srcLabel(i, kind) {
  if (i.source === 'recipe') return i.recipes && i.recipes.length ? `for ${i.recipes.map(t => t.replace(/\s*\([^)]*\)\s*$/, '')).join(', ')}` : '';
  if (i.source === 'custom') return `added by ${i.added_by || '?'}`;
  return kind === 'list' ? 'staple' : '';
}
function nameHtml(i, kind) {
  const src = srcLabel(i, kind);
  return `<b>${esc(i.name)}${src ? ` <span class="src">(${esc(src)})</span>` : ''}</b>`;
}
function itemRows(items, kind) {
  return groupBy(items).map(([cat, list]) => `<div class="group">${CAT_LABEL[cat] || esc(cat)}</div><div class="list">${list.map(i => {
    if (kind === 'pantry') return `<div class="row ${i.have_it ? 'dim' : ''}"><div class="name">${nameHtml(i, kind)}<small>${esc(i.qty || '')}</small></div>
      <button class="toggle ${i.have_it ? 'on' : ''}" data-act="have" data-id="${i.id}" aria-pressed="${i.have_it}" ${locked() ? 'disabled' : ''}>${i.have_it ? '✓ Have it' : 'Have it?'}</button></div>`;
    if (kind === 'staple') return `<div class="row ${i.include ? '' : 'dim'}"><div class="name">${nameHtml(i, kind)}<small>${i.source === 'custom' ? '' : esc(stapleProduct(i))}</small></div>
      <input class="qtyin" data-act="qty" data-id="${i.id}" value="${esc(i.qty || '')}" aria-label="quantity" ${locked() ? 'disabled' : ''}>
      ${i.source === 'custom' && !locked() ? `<button class="x" data-act="rm" data-id="${i.id}" aria-label="remove">✕</button>` : ''}
      <button class="toggle add ${i.include ? 'on' : ''}" data-act="inc" data-id="${i.id}" aria-pressed="${i.include}" ${locked() ? 'disabled' : ''}>${i.include ? '✓ Buy' : 'Skip'}</button></div>`;
    return `<div class="row"><div class="name">${nameHtml(i, kind)}</div><span class="qty">${esc(i.qty || '')}</span></div>`;
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
function addItemForm(id) {
  const cats = CAT_ORDER.map(c => `<option value="${c}">${(CAT_LABEL[c] || c).replace(/^\S+\s/, '')}</option>`).join('');
  return `<form id="${id}" class="list" style="padding:14px"><b>➕ Add an item</b>
      <div class="addform"><input class="field" name="name" placeholder="e.g. paper towels" required>
      <input class="field" name="qty" placeholder="qty" style="text-align:center">
      <select class="field" name="category">${cats.replace('value="other"', 'value="other" selected')}</select>
      <button class="btn small" type="submit">Add</button></div></form>`;
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

function quickView() {
  const q = S.data.quick;
  const intro = `<p class="hint">A staples-only order (milk, eggs, fruit, snacks…) that doesn't touch this week's meal plan.</p>`;
  if (!q) return header('Quick order') + intro + `<div class="empty"><div class="e">🛒</div><p>Need a few groceries now?</p></div>
    <button class="btn" data-act="quickStart">Start a quick order</button>`;
  const items = q.items || [];
  const fromRecipes = items.filter(i => i.source === 'recipe'), staples = items.filter(i => i.source !== 'recipe');
  const buy = items.filter(i => i.include && !i.have_it);
  const added = (q.quick_recipes || []).map(r => `${esc(r.title)} ×${+r.batches}`).join(' · ');
  if (q.status === 'ready_for_cart') return header('Quick order', 'Sent to cart') +
    `<div class="banner ok"><span class="big">🛒 Sent to cart</span>by ${esc(q.sent_by || '?')} · ${q.sent_at ? fmtWhen(q.sent_at) : ''}. The QFC cart gets filled next.</div>
     <h2>${buy.length} items</h2>${added ? `<p class="hint">Includes: ${added}</p>` : ''}${itemRows(buy, 'list')}
     <button class="btn ghost" data-act="quickStart" style="margin-top:18px">Start another quick order</button>`;
  return header('Quick order', `${buy.length} item${buy.length === 1 ? '' : 's'} to buy`) + intro +
    (fromRecipes.length ? `<div class="group" style="font-size:15px;color:var(--ink)">From snacks & baking${added ? ` <small style="text-transform:none;letter-spacing:0;font-weight:500;color:var(--muted)">(${added})</small>` : ''}</div>
      <p class="hint" style="margin:4px 0 0">Tap <b>Have it</b> for anything already in the kitchen.</p>${itemRows(fromRecipes, 'pantry')}` : '') +
    `<div style="margin-top:18px">${addItemForm('addFormQuick')}</div>
     <div class="group" style="font-size:15px;color:var(--ink)">Staples</div>${itemRows(staples, 'staple')}
     <div style="text-align:center;margin-top:16px"><button class="linkbtn" data-act="quickDiscard" style="color:var(--muted);font-weight:500">🗑 Discard this quick order</button></div>`;
}
function quickActionBar() {
  const q = S.data.quick; if (!q) return '';
  if (q.status === 'ready_for_cart') return `<div class="actionbar"><div class="inner"><button class="btn ghost" data-act="quickReopen">↩︎ Reopen to edit</button></div></div>`;
  const n = (q.items || []).filter(i => i.include && !i.have_it).length;
  return `<div class="actionbar"><div class="inner"><button class="btn green huge" data-act="quickSend" ${n ? '' : 'disabled'}>🛒 Send to cart${n ? ` (${n})` : ''}</button></div></div>`;
}
/* ---------- tags ---------- */
function tagName(id) { const t = (S.data.tags || []).find(x => x.id === id); return t ? t.name : ''; }
function sortedTags(ids) { return (ids || []).map(id => ({ id, name: tagName(id) })).filter(t => t.name).sort((a, b) => a.name.localeCompare(b.name)); }
// multi-select tag filter = AND: a recipe must have every selected tag
function hasTags(ids, sel) { return !sel.length || sel.every(t => (ids || []).includes(t)); }
function tagPills(ids) { const t = sortedTags(ids); return t.length ? `<div class="tagpills">${t.map(x => `<span class="tagpill">${esc(x.name)}</span>`).join('')}</div>` : ''; }
function tagFilterBar(key, ids) {
  const tags = sortedTags(ids); if (!tags.length) return '';
  S[key] = S[key].filter(id => ids.includes(id));
  const sel = S[key];
  return `<div class="tagbar" role="group" aria-label="Filter by tag">${tags.map(t => `<button class="fchip ${sel.includes(t.id) ? 'on' : ''}" data-act="ftag" data-key="${key}" data-id="${t.id}" aria-pressed="${sel.includes(t.id)}">${sel.includes(t.id) ? '✓ ' : ''}${esc(t.name)}</button>`).join('')}
    ${sel.length ? `<button class="fchip clear" data-act="fclear" data-key="${key}">Clear</button>` : ''}</div>
    ${sel.length > 1 ? `<p class="hint" style="margin:-4px 0 12px;font-size:13px">Showing recipes with <b>all</b> of: ${sel.map(id => esc(tagName(id))).join(' + ')}</p>` : ''}`;
}
function lastCooked(d) { return `Last cooked: ${d ? fmtDate(d) : 'Never'}`; }

function snackCard(r) {
  const b = S.batches[r.id] || 1;
  return `<div class="rcard"><button class="rcard-open" data-act="openRecipe" data-id="${r.id}" aria-label="Open ${esc(r.title)}">
    <span class="badge b-${esc(r.status)}">${esc(r.status)}</span> <span class="badge b-snack">Snack/baking</span>
    <div class="card-title" style="margin-top:6px">${esc(r.title)} <span class="chev">›</span></div>
    <div class="meta"><span>⏱ ${esc(r.total_time || '?')}</span><span>Makes ${r.servings || '?'} per batch</span>${r.note_count ? `<span>📝 ${r.note_count}</span>` : ''}</div>
    ${tagPills(r.tags)}</button>
    <div class="serv"><div class="serv-label">Batches</div>
      <div class="stepper"><button data-act="batch" data-id="${r.id}" data-d="-1" aria-label="fewer batches">−</button><span>${b}</span><button data-act="batch" data-id="${r.id}" data-d="1" aria-label="more batches">+</button></div></div>
    <button class="btn small" data-act="snackAdd" data-id="${r.id}" ${(r.ingredients || []).length ? '' : 'disabled'}>🛒 Add ingredients to order</button></div>`;
}
function recipeCard(r) {
  return `<div class="rcard"><button class="rcard-open" data-act="openRecipe" data-id="${r.id}" aria-label="Open ${esc(r.title)}">
    <span class="badge b-${esc(r.status)}">${esc(r.status)}</span>
    <div class="card-title" style="margin-top:6px">${esc(r.title)} <span class="chev">›</span></div>
    <div class="meta"><span>⏱ ${esc(r.total_time || '?')}</span><span>Serves ${r.servings || '?'}</span><span>${lastCooked(r.last_cooked)}</span>${r.note_count ? `<span>📝 ${r.note_count} note${r.note_count > 1 ? 's' : ''}</span>` : ''}</div>
    ${tagPills(r.tags)}</button></div>`;
}
function recipesView() {
  if (S.detail) return recipeDetailView();
  const all = S.data.recipes || [];
  const lib = all.filter(r => r.status !== 'pending');
  const bar = tagFilterBar('tagFilter', [...new Set(lib.flatMap(r => r.tags || []))]);
  const match = r => r.status === 'pending' ? !S.tagFilter.length : hasTags(r.tags, S.tagFilter);
  const snacks = all.filter(r => r.recipe_type === 'snack/baking' && r.status !== 'pending' && r.status !== 'retired' && match(r));
  const rs = all.filter(r => !(r.recipe_type === 'snack/baking' && r.status !== 'pending' && r.status !== 'retired') && match(r));
  const none = !snacks.length && !rs.length ? `<div class="empty"><div class="e">🏷️</div><p>No recipes have all of those tags.</p></div>` : '';
  return header('Recipes', `${lib.length} in the library`) + `
    <button class="btn" data-act="addRecipe" style="margin:0 0 14px">➕ Add recipe</button>` + bar + none +
    (snacks.length ? `<div class="group" style="font-size:15px;color:var(--ink);margin-top:4px">🧁 Snacks & Baking</div>${snacks.map(snackCard).join('')}
      ${rs.length ? `<div class="group" style="font-size:15px;color:var(--ink);margin-top:22px">🍽️ Dinners</div>` : ''}` : '') +
    rs.map(r => r.status === 'pending' && r.photo_count ? `<div class="rcard"><span class="badge b-pending">📷 Processing…</span>
        <div class="card-title" style="margin-top:6px">${esc(r.title)}</div>
        <div class="meta">${r.photo_count} photo${r.photo_count > 1 ? 's' : ''} · added by ${esc(r.added_by || '?')} — the assistant will type it up and add it to the library.</div></div>`
      : r.status === 'pending' ? `<div class="rcard"><span class="badge b-pending">Importing soon</span>
        <div class="card-title" style="margin-top:6px;word-break:break-all;font-size:15px">${esc(r.url)}</div>
        <div class="meta">Added by ${esc(r.added_by || '?')} — ingredients get filled in by the assistant.${r.notes ? ' ' + esc(r.notes) : ''}</div></div>`
      : recipeCard(r)).join('');
}

/* ---------- recipe detail page (tags, notes, delete) ---------- */
function fmtNoteTime(ts) {
  const d = new Date(ts), now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
async function openRecipe(id, keepScroll) {
  S.detail = { id, r: S.detail && S.detail.id === id ? S.detail.r : null, loading: true, tagEdit: S.detail && S.detail.id === id && S.detail.tagEdit };
  render.force = true; render(); if (!keepScroll) window.scrollTo(0, 0);
  try { const r = await rpc('get_recipe', { p_id: id }); if (!S.detail || S.detail.id !== id) return;
    if (!r) { S.detail = null; toast('That recipe was deleted'); } else { S.detail.r = r; S.detail.loading = false; } }
  catch (e) { handleErr(e); if (S.detail) S.detail.loading = false; }
  render.force = true; render();
}
function recipeDetailView() {
  const dt = S.detail, lib = (S.data.recipes || []).find(x => x.id === dt.id);
  const back = `<button class="backlink" data-act="closeRecipe">‹ Recipes</button>`;
  if (!lib) return back + `<div class="empty"><p>This recipe is no longer in the library.</p></div>`;
  const r = dt.r || {}, notes = r.notes || [], tags = lib.tags || [];
  const allTags = (S.data.tags || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const tagSection = dt.tagEdit
    ? `<div class="chips tagedit">${allTags.map(t => { const on = tags.includes(t.id); return `<button class="tchip ${on ? 'on' : ''}" data-act="toggleTag" data-id="${t.id}" aria-pressed="${on}">${on ? '✓ ' : '+ '}${esc(t.name)}</button>`; }).join('')}</div>
       <form id="newTagForm" class="inline-form"><input class="field" name="tag" maxlength="30" placeholder="New tag, e.g. Date night" autocomplete="off" aria-label="New tag name"><button class="btn small compact" type="submit">Add tag</button></form>
       <button class="linkbtn" data-act="tagEdit">Done</button>`
    : `<div class="chips">${sortedTags(tags).map(t => `<span class="tchip on static">${esc(t.name)}</span>`).join('') || '<span class="none">No tags yet</span>'}
       <button class="tchip add" data-act="tagEdit">${tags.length ? '✎ Edit' : '+ Add tags'}</button></div>`;
  const link = lib.url ? `<a class="btn ghost small compact" href="${esc(lib.url)}" target="_blank" rel="noopener">Open recipe ↗</a>`
    : `<button class="btn ghost small compact" data-act="showRecipe" data-id="${lib.id}">View ingredients & steps</button>`;
  return back + `<div class="detail">
    <span class="badge b-${esc(lib.status)}">${esc(lib.status)}</span>${lib.recipe_type === 'snack/baking' ? ' <span class="badge b-snack">Snack/baking</span>' : ''}
    <h1 class="dtitle">${esc(lib.title)}</h1>
    <div class="meta"><span>⏱ ${esc(lib.total_time || '?')}</span><span>Serves ${lib.servings || '?'}</span><span>${lastCooked(lib.last_cooked)}</span></div>
    ${lib.description ? `<p class="desc" style="font-size:15px">${esc(lib.description)}</p>` : ''}
    <div style="margin:12px 0 4px">${link}</div>
    <h3 class="dsec">Tags</h3>${tagSection}
    <h3 class="dsec">Notes${notes.length ? ` <small>(${notes.length})</small>` : ''}</h3>
    <form id="noteForm" class="noteform"><textarea class="field" name="body" rows="3" maxlength="2000" placeholder="Add a note — tweaks, what the kids thought, what to change next time…" aria-label="New note">${esc(S.noteDraft[dt.id] || '')}</textarea>
      <div class="noteform-foot"><span class="hint" style="margin:0;font-size:13px">Posting as <b>${esc(S.who)}</b></span><button class="btn small compact" type="submit">Add note</button></div></form>
    ${dt.loading && !dt.r ? '<p class="hint">Loading notes…</p>' : notes.length ? `<ul class="notes">${notes.map(n => `<li class="note">
        <div class="note-head"><b>${esc(n.added_by || 'Someone')}</b><span>${fmtNoteTime(n.created_at)}</span>
          <button class="note-x" data-act="delNote" data-id="${n.id}" aria-label="Delete note">✕</button></div>
        <div class="note-body">${esc(n.body)}</div></li>`).join('')}</ul>` : '<p class="hint">No notes yet.</p>'}
    <div class="danger-zone"><button class="btn danger" data-act="deleteRecipe" data-id="${lib.id}">🗑 Delete recipe</button>
      <p class="hint" style="font-size:13px;margin-top:6px">Removes it from the library and from weeks still being picked. Weeks already sent keep their history.</p></div>
  </div>`;
}
function confirmSheet({ title, body, ok, danger }) {
  return new Promise(resolve => {
    const bg = document.createElement('div'); bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h2 style="margin-top:0">${title}</h2><p class="hint" style="font-size:16px">${body}</p>
      <button class="btn ${danger ? 'danger' : ''}" data-r="1">${ok}</button><button class="btn ghost" data-r="0">Cancel</button></div>`;
    bg.onclick = e => { const r = e.target.dataset.r; if (e.target !== bg && r == null) return; bg.remove(); resolve(r === '1'); };
    document.body.appendChild(bg);
  });
}

/* ---------- events ---------- */
document.addEventListener('click', async ev => {
  if (ev.target.closest('a[target=_blank]')) return;
  const el = ev.target.closest('[data-act],[data-tab],[data-step]'); if (!el || el.disabled) return;
  const d = S.data, w = d && d.week, id = +el.dataset.id;
  if (el.dataset.tab) { ev.preventDefault(); S.tab = el.dataset.tab; S.detail = null; render.force = true; render(); window.scrollTo(0, 0); return; }
  const act = el.dataset.act;
  if (!act && el.dataset.step != null) { S.step = +el.dataset.step; render.force = true; render(); window.scrollTo(0, 0); return; }
  const opt = () => d.options.find(o => o.recipe_id === id), item = () => allItems().find(i => i.id === id);
  switch (act) {
    case 'go': S.step = +el.dataset.step; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'pick': { const o = opt(); const v = !o.picked;
      if (v && picked().length >= 3) toast('That makes ' + (picked().length + 1) + ' — 3 is the goal');
      mutate('set_pick', { p_week: w.id, p_recipe: id, p_picked: v }, () => { o.picked = v; if (w.status === 'pantry') w.status = 'picking'; }); break; }
    case 'serv': { const o = opt(); const v = Math.max(1, Math.min(30, o.servings + +el.dataset.d));
      mutate('set_servings', { p_week: w.id, p_recipe: id, p_servings: v }, () => { o.servings = v; if (w.status === 'pantry') w.status = 'picking'; }); break; }
    case 'more': {
      el.disabled = true; el.textContent = 'Finding more recipes…';
      S.busy++; S.seq++;
      try { const n = await rpc('add_more_options', { p_week: w.id, p_count: 6 }); toast(n ? `Added ${n} more recipe${n > 1 ? 's' : ''} 🍲` : "That's all the recipes for now"); }
      catch (e) { handleErr(e); } finally { S.busy--; }
      await refresh(true); break; }
    case 'toggleIngs': S.open[id] = !S.open[id]; render(); break;
    case 'confirm': {
      const items = Ingredients.combine(d.options).map(({ name, qty, category, have_it, recipes }) => ({ name, qty, category, have_it, recipes }));
      el.disabled = true; el.textContent = 'Building list…';
      await mutate('confirm_portions', { p_week: w.id, p_items: items, p_who: S.who });
      S.step = 1; render.force = true; render(); window.scrollTo(0, 0); toast('Portions confirmed ✓'); break; }
    case 'have': { const i = item(); const v = !i.have_it; mutate('set_item', { p_item: id, p_have_it: v, p_include: null, p_qty: null }, () => { i.have_it = v; }); break; }
    case 'inc': { const i = item(); const v = !i.include; mutate('set_item', { p_item: id, p_have_it: null, p_include: v, p_qty: null }, () => { i.include = v; }); break; }
    case 'rm': { mutate('remove_item', { p_item: id }, () => { d.items = d.items.filter(i => i.id !== id); if (d.quick) d.quick.items = d.quick.items.filter(i => i.id !== id); }); break; }
    case 'send':
      el.disabled = true;
      { let sent = false;
        await mutate('set_week_status', { p_week: w.id, p_status: 'ready_for_cart', p_who: S.who }, () => { w.status = 'ready_for_cart'; w.sent_by = S.who; w.sent_at = new Date().toISOString(); }, () => { sent = true; });
        if (sent) { notifyAssistant('send_to_cart', { week_id: w.id }); toast('🛒 Sent! The cart gets filled next.'); } }
      break;
    case 'reopen': mutate('set_week_status', { p_week: w.id, p_status: 'pantry', p_who: S.who }, () => { w.status = 'pantry'; }); break;
    case 'ftag': { const k = el.dataset.key; S[k] = S[k].includes(id) ? S[k].filter(x => x !== id) : [...S[k], id]; render.force = true; render(); break; }
    case 'fclear': S[el.dataset.key] = []; render.force = true; render(); break;
    case 'openRecipe': openRecipe(id); break;
    case 'closeRecipe': S.detail = null; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'tagEdit': S.detail.tagEdit = !S.detail.tagEdit; render.force = true; render(); break;
    case 'toggleTag': { const r = d.recipes.find(x => x.id === S.detail.id); const on = !(r.tags || []).includes(id);
      mutate('set_recipe_tag', { p_recipe: r.id, p_tag: id, p_on: on, p_who: S.who }, () => { r.tags = on ? [...(r.tags || []), id] : r.tags.filter(x => x !== id); render.force = true; }); break; }
    case 'delNote': if (await confirmSheet({ title: 'Delete this note?', body: 'It will be removed for everyone.', ok: 'Delete note', danger: true })) {
      const rid = S.detail.id; await mutate('delete_recipe_note', { p_note: id }, () => { S.detail.r.notes = S.detail.r.notes.filter(n => n.id !== id); const r = d.recipes.find(x => x.id === rid); if (r) r.note_count = Math.max(0, (r.note_count || 1) - 1); render.force = true; });
      openRecipe(rid, true); } break;
    case 'deleteRecipe': { const r = d.recipes.find(x => x.id === id);
      if (!(await confirmSheet({ title: `Delete “${esc(r.title)}”?`, body: 'It disappears from the library, from this week\'s options (if it hasn\'t been sent yet) and from future suggestions. Notes and tags go with it.', ok: 'Delete recipe', danger: true }))) break;
      let ok = false;
      await mutate('delete_recipe', { p_recipe: id, p_who: S.who }, () => { d.recipes = d.recipes.filter(x => x.id !== id); if (!locked()) d.options = (d.options || []).filter(o => o.recipe_id !== id); S.detail = null; render.force = true; }, () => { ok = true; });
      if (ok) toast('🗑 Deleted ' + r.title); window.scrollTo(0, 0); break; }
    case 'menu': showMenu(); break;
    case 'addRecipe': openAddSheet(); break;
    case 'quickStart': { let qid = null; S.busy++; S.seq++;
      try { qid = await rpc('quick_start', { p_who: S.who }); } catch (e) { handleErr(e); } finally { S.busy--; }
      await refresh(true); render.force = true; render(); window.scrollTo(0, 0); break; }
    case 'quickSend': { const q = d.quick; let ok = false; el.disabled = true;
      await mutate('quick_send', { p_id: q.id, p_who: S.who }, () => { q.status = 'ready_for_cart'; q.sent_by = S.who; q.sent_at = new Date().toISOString(); }, () => { ok = true; });
      if (ok) { notifyAssistant('send_to_cart', { week_id: q.id }); toast('🛒 Quick order sent!'); } break; }
    case 'quickReopen': mutate('quick_reopen', { p_id: d.quick.id }, () => { d.quick.status = 'picking'; }); break;
    case 'quickDiscard': if (window.confirm('Discard this quick order?')) mutate('quick_discard', { p_id: d.quick.id }, () => { d.quick = null; }); break;
    case 'batch': S.batches[id] = Math.max(1, Math.min(12, (S.batches[id] || 1) + +el.dataset.d)); render(); break;
    case 'snackAdd': {
      const r = d.recipes.find(x => x.id === id), b = S.batches[id] || 1;
      const items = Ingredients.combine([{ picked: true, title: r.title, servings: (r.servings || 1) * b, base_servings: r.servings || 1, ingredients: r.ingredients || [] }])
        .map(({ name, qty, category, have_it }) => ({ name, qty, category, have_it }));
      let ok = false; el.disabled = true; el.textContent = 'Adding…';
      await mutate('quick_add_recipe', { p_recipe: id, p_batches: b, p_items: items, p_who: S.who }, null, () => { ok = true; });
      if (ok) { toast(`Added ${r.title} ×${b} to the quick order`); S.tab = 'quick'; render.force = true; render(); window.scrollTo(0, 0); }
      break; }
    case 'startOver': startOver(); break;
    case 'showRecipe': showRecipe(id); break;
    case 'mode': S.mode = el.dataset.mode; S.sel = null; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'selMeal': { const w2 = +el.dataset.week; S.sel = S.sel && S.sel.w === w2 && S.sel.r === id ? null : { w: w2, r: id }; render.force = true; render(); break; }
    case 'dropDay': if (S.sel && S.sel.w === +el.dataset.week) setPlanDay(S.sel.w, S.sel.r, el.dataset.date); break;
    case 'dropTray': if (S.sel && S.sel.w === +el.dataset.week) setPlanDay(S.sel.w, S.sel.r, null); break;
  }
});
document.addEventListener('change', ev => {
  const el = ev.target; if (el.dataset.act !== 'qty') return;
  const id = +el.dataset.id, i = allItems().find(x => x.id === id), v = el.value.trim();
  el.blur();
  mutate('set_item', { p_item: id, p_have_it: null, p_include: null, p_qty: v }, () => { i.qty = v; });
});
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.dataset.act === 'qty') ev.target.blur(); });
document.addEventListener('submit', async ev => {
  const f = ev.target;
  if (f.id === 'addForm' || f.id === 'addFormQuick') {
    ev.preventDefault();
    const fd = new FormData(f), name = fd.get('name').trim(); if (!name) return;
    document.activeElement && document.activeElement.blur();
    await mutate('add_item', { p_week: f.id === 'addFormQuick' ? S.data.quick.id : S.data.week.id, p_name: name, p_qty: fd.get('qty'), p_category: fd.get('category'), p_who: S.who });
    toast('Added ' + name); render.force = true; render();
  } else if (f.id === 'noteForm') {
    ev.preventDefault();
    const body = new FormData(f).get('body').trim(); if (!body) return;
    document.activeElement && document.activeElement.blur();
    const rid = S.detail.id; let ok = false;
    await mutate('add_recipe_note', { p_recipe: rid, p_body: body, p_who: S.who }, null, () => { ok = true; });
    if (ok) { f.reset(); delete S.noteDraft[rid]; toast('📝 Note added'); await openRecipe(rid, true); }
  } else if (f.id === 'newTagForm') {
    ev.preventDefault();
    const name = new FormData(f).get('tag').trim().replace(/\s+/g, ' '); if (!name) return;
    document.activeElement && document.activeElement.blur();
    const rid = S.detail.id; let tid = null;
    S.busy++; S.seq++;
    try { tid = await rpc('create_tag', { p_name: name, p_who: S.who }); await rpc('set_recipe_tag', { p_recipe: rid, p_tag: tid, p_on: true, p_who: S.who }); toast('🏷️ Tagged ' + name); }
    catch (e) { handleErr(e); } finally { S.busy--; }
    await refresh(true); render.force = true; render();
  } else if (f.id === 'urlForm') {
    ev.preventDefault();
    const url = new FormData(f).get('url').trim(), rtype = new FormData(f).get('rtype') || 'dinner';
    document.activeElement && document.activeElement.blur();
    closeSheet();
    await mutate('add_recipe_url', { p_url: url, p_who: S.who, p_type: rtype });
    toast('📖 Added — ingredients coming soon'); render.force = true; render();
  }
});
function showMenu() {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet"><b>Signed in as ${esc(S.who)}</b>
    ${S.data && S.data.week ? '<button class="btn ghost" data-m="reset">↺ Start this week over</button>' : ''}
    <button class="btn ghost" data-m="who">Switch person</button>
    <button class="btn ghost" data-m="out">Forget passcode on this phone</button>
    <button class="btn" data-m="close">Close</button></div>`;
  bg.onclick = e => {
    const m = e.target.dataset.m; if (e.target !== bg && !m) return;
    bg.remove();
    if (m === 'who') { localStorage.removeItem('mp_who'); S.who = ''; render.force = true; render(); }
    if (m === 'out') logout('');
    if (m === 'reset') startOver();
  };
  document.body.appendChild(bg);
}

/* drag & drop scheduling (desktop) */
document.addEventListener('dragstart', ev => {
  const m = ev.target.closest && ev.target.closest('.meal[draggable]'); if (!m) return;
  S.drag = { w: +m.dataset.week, r: +m.dataset.id }; S.sel = null;
  ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', m.dataset.id); m.classList.add('dragging');
});
const dropZone = ev => { const z = ev.target.closest && ev.target.closest('.drop'); return z && S.drag && +z.dataset.week === S.drag.w ? z : null; };
document.addEventListener('dragover', ev => { const z = dropZone(ev); if (!z) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.drop.over').forEach(x => x !== z && x.classList.remove('over')); z.classList.add('over'); });
document.addEventListener('dragleave', ev => { const z = dropZone(ev); if (z && !z.contains(ev.relatedTarget)) z.classList.remove('over'); });
document.addEventListener('drop', ev => { const z = dropZone(ev); if (!z) return; ev.preventDefault();
  const { w, r } = S.drag; S.drag = null; setPlanDay(w, r, z.dataset.act === 'dropDay' ? z.dataset.date : null); });
document.addEventListener('dragend', () => { if (S.drag) { S.drag = null; render.force = true; render(); } });

async function startOver() {
  const w = S.data && S.data.week; if (!w) return;
  if (!window.confirm('Clear all picks, pantry checks, staples and meal-plan days for this week?')) return;
  let ok = false;
  await mutate('reset_week', { p_week: w.id }, () => {
    S.data.options.forEach(o => { o.picked = false; o.servings = 6; o.planned_date = null; }); S.data.items = []; w.status = 'picking'; w.sent_by = null; w.sent_at = null;
    S.data.plans = plans().filter(p => p.week_id !== w.id); S.mode = null; S.sel = null;
  }, () => { ok = true; });
  if (ok) { S.step = 0; S.open = {}; render.force = true; render(); window.scrollTo(0, 0); toast('↺ Fresh start for this week'); }
}

/* ---------- add recipe: link or photos ---------- */
const PHOTO = { blobs: [] };
function closeSheet() { const el = document.querySelector('.sheet-bg.add'); if (el) el.remove(); PHOTO.blobs.forEach(b => URL.revokeObjectURL(b.url)); PHOTO.blobs = []; }
function openAddSheet(mode = 'choose') {
  let bg = document.querySelector('.sheet-bg.add');
  if (!bg) { bg = document.createElement('div'); bg.className = 'sheet-bg add'; document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); }); }
  if (mode === 'choose') bg.innerHTML = `<div class="sheet"><h2 style="margin-top:0">Add a recipe</h2>
      <button class="btn ghost" data-sheet="link">🔗 Paste a link</button>
      <button class="btn ghost" data-sheet="photo">📷 Photo of a recipe <small style="font-weight:500;opacity:.75">(cookbook, card…)</small></button>
      <button class="btn" data-sheet="close" style="margin-top:16px">Cancel</button></div>`;
  if (mode === 'link') bg.innerHTML = `<div class="sheet"><h2 style="margin-top:0">🔗 Add by link</h2>
      <form id="urlForm" class="urlform"><div class="chips" style="margin:6px 0 10px" role="radiogroup" aria-label="Recipe type">
        <label class="chip"><input type="radio" name="rtype" value="dinner" checked hidden>🍽️ Dinner</label>
        <label class="chip"><input type="radio" name="rtype" value="snack/baking" hidden>🧁 Snack / baking</label></div><input class="field" name="url" type="url" inputmode="url" placeholder="https://…" required autofocus>
      <button class="btn" type="submit">Add recipe</button></form>
      <button class="btn ghost" data-sheet="close">Cancel</button></div>`;
  if (mode === 'photo') { bg.innerHTML = `<div class="sheet" style="max-height:92vh;overflow:auto"><h2 style="margin-top:0">📷 Recipe from photos</h2>
      <p class="hint" style="margin-bottom:10px">Add every page (e.g. the page and its continuation). The assistant types it up.</p>
      <form id="photoTypeForm" onsubmit="return false"><div class="chips" style="margin:6px 0 10px" role="radiogroup" aria-label="Recipe type">
        <label class="chip"><input type="radio" name="rtype" value="dinner" checked hidden>🍽️ Dinner</label>
        <label class="chip"><input type="radio" name="rtype" value="snack/baking" hidden>🧁 Snack / baking</label></div></form>
      <input class="field" id="photoTitle" placeholder="Recipe name (optional)" autocomplete="off">
      <div id="thumbs" class="thumbs"></div>
      <div style="display:flex;gap:8px">
        <label class="btn ghost small" style="flex:1;text-align:center">📷 Take photo<input type="file" accept="image/*" capture="environment" data-photo hidden></label>
        <label class="btn ghost small" style="flex:1;text-align:center">🖼️ Library<input type="file" accept="image/*" multiple data-photo hidden></label>
      </div>
      <div class="err" id="photoErr"></div>
      <button class="btn green" id="photoSave" data-sheet="savePhotos" disabled>Save recipe</button>
      <button class="btn ghost" data-sheet="close">Cancel</button></div>`; drawThumbs(); }
  bg.querySelectorAll('[data-sheet]').forEach(b => b.onclick = async e => {
    e.preventDefault(); const m = b.dataset.sheet;
    if (m === 'close') closeSheet(); else if (m === 'savePhotos') savePhotos(b); else openAddSheet(m);
  });
  bg.querySelectorAll('input[data-photo]').forEach(inp => inp.onchange = async () => {
    const files = [...inp.files]; inp.value = '';
    for (const f of files) {
      if (PHOTO.blobs.length >= 10) { $('#photoErr').textContent = 'Up to 10 photos per recipe.'; break; }
      try { const blob = await downscale(f); PHOTO.blobs.push({ blob, url: URL.createObjectURL(blob) }); }
      catch (err) { $('#photoErr').textContent = 'Couldn’t read that image (' + (f.type || 'unknown type') + ').'; }
      drawThumbs();
    }
  });
}
function drawThumbs() {
  const t = $('#thumbs'); if (!t) return;
  t.innerHTML = PHOTO.blobs.map((b, i) => `<div class="thumb"><img src="${b.url}" alt="page ${i + 1}"><span>${i + 1}</span>
    <button type="button" data-rmphoto="${i}" aria-label="remove photo">✕</button></div>`).join('');
  t.querySelectorAll('[data-rmphoto]').forEach(x => x.onclick = () => { const [r] = PHOTO.blobs.splice(+x.dataset.rmphoto, 1); URL.revokeObjectURL(r.url); drawThumbs(); });
  const sv = $('#photoSave'); const n = PHOTO.blobs.length;
  sv.disabled = !n; sv.textContent = n ? `Save recipe (${n} photo${n > 1 ? 's' : ''})` : 'Save recipe';
}
async function downscale(file, max = 1600) {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = src; await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw new Error('encode failed');
    return blob;
  } finally { URL.revokeObjectURL(src); }
}
async function savePhotos(btn) {
  const n = PHOTO.blobs.length; if (!n) return;
  const err = $('#photoErr'); err.textContent = ''; btn.disabled = true;
  try {
    btn.textContent = 'Preparing upload…';
    const res = await fetch(`${SUPABASE_URL}/functions/v1/photo-upload`, { method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: S.code, count: n }) });
    const body = await res.json();
    if (!res.ok) { const e = new Error(body.message || 'upload failed'); e.code = body.code; throw e; }
    for (let i = 0; i < n; i++) {
      btn.textContent = `Uploading ${i + 1} of ${n}…`;
      const up = await fetch(body.uploads[i].upload_url, { method: 'PUT', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'image/jpeg' }, body: PHOTO.blobs[i].blob });
      if (!up.ok) throw new Error('photo ' + (i + 1) + ' failed to upload (' + up.status + ')');
    }
    btn.textContent = 'Saving…';
    const ptype = (document.querySelector('#photoTypeForm input[name=rtype]:checked') || {}).value || 'dinner';
    const rid = await rpc('add_recipe_photos', { p_paths: body.uploads.map(u => u.path), p_title: ($('#photoTitle').value || '').trim(), p_who: S.who, p_type: ptype });
    notifyAssistant('photo_recipe', { recipe_id: rid });
    closeSheet(); toast('📷 Saved — the assistant will type it up'); await refresh(true); render.force = true; render();
  } catch (e) {
    if (e.code === '28P01') { closeSheet(); return handleErr(e); }
    err.textContent = '⚠️ ' + e.message; btn.disabled = false; drawThumbs();
  }
}

/* ---------- sync loop ---------- */
setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('focus', () => refresh());
render();
if (S.code && S.who) refresh(true);

document.addEventListener('input', ev => { if (ev.target.closest('#noteForm') && S.detail) S.noteDraft[S.detail.id] = ev.target.value; });
