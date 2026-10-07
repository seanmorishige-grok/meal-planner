/* Sous — shared weekly meal planner. Vanilla JS, talks to Supabase RPCs only. */
const SUPABASE_URL = 'https://lpppmjnryqtwhdsnhzpx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwcHBtam5yeXF0d2hkc25oenB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjczMjksImV4cCI6MjEwNjgwMzMyOX0.BYQpNOpwE98_4J7ICCgDYcIzlIzwm13je9dgpWnx5KU'; // public anon key: it can only call passcode-checked RPCs
const POLL_MS = 5000;

const CAT_ORDER = ['produce', 'meat/seafood', 'dairy/eggs', 'bakery', 'pantry/dry goods', 'spices/condiments', 'frozen', 'snacks', 'other'];
const CAT_LABEL = { 'produce': 'Produce', 'meat/seafood': 'Meat & seafood', 'dairy/eggs': 'Dairy & eggs', 'bakery': 'Bakery',
  'pantry/dry goods': 'Pantry', 'spices/condiments': 'Spices & condiments', 'frozen': 'Frozen', 'snacks': 'Snacks', 'other': 'Other' };
/* line icons (1.75 stroke, currentColor) */
const svg = (d, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  week: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  bag: svg('<path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 8z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>'),
  book: svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  chev: svg('<path d="M9 5l7 7-7 7"/>', 'chev'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  sort: svg('<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  camera: svg('<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
};
const metaLine = parts => parts.filter(Boolean).map(x => `<span>${x}</span>`).join('');
const STEPS = ['Pick', 'Pantry', 'Staples', 'List'];

const S = {
  code: localStorage.getItem('mp_code') || '',
  who: localStorage.getItem('mp_who') || '',
  data: null, tab: 'week', sub: null /* week tab: null=home | 'flow' | 'plan'; basket tab: null | 'orders' | 'order' */, orders: null, orderId: null, oq: '', step: null, open: {}, batches: {}, busy: 0, seq: 0, lastSync: null, error: null,
  q: '', filter: null /* {k:'tag',id} | {k:'awhile'|'quick'|'new'} */, seg: 'all' /* all | dinner | snack */, sort: localStorage.getItem('mp_sort') || 'cooked' /* cooked | newest | az */, editTime: false,
  noteDraft: {}, tagFilter: [] /* Recipes tab tag filter (AND) */, pickTags: [] /* Pick step tag filter */, detail: null /* {id, r, loading} recipe detail page */,
  mode: null /* 'plan' | 'shop' on This week */, sel: null /* meal picked up for scheduling: {w, r} */, drag: null,
};

const SW = { el: null, open: null, x0: 0, y0: 0, base: 0, tx: 0, axis: null, suppress: false };   // swipe state (see bottom)

/* ---------- api ---------- */
async function rpc(fn, args = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', keepalive: true,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'x-who': whoHeader() },
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
function whoHeader() { const w = (S.who || '').slice(0, 40); return /^[\x20-\x7e]*$/.test(w) ? w : encodeURIComponent(w); }
// mutation: optimistic local change, then server call, then refresh
async function mutate(fn, args, optimistic, onOk) {
  S.busy++; S.seq++;
  if (optimistic) { optimistic(); render(); }
  try { const res = await rpc(fn, args); if (onOk) onOk(res); }
  catch (e) { handleErr(e); }
  finally { S.busy--; }
  await refresh(true);
}
function handleErr(e) {
  if (e.code === '28P01') { logout('That passcode stopped working — please re-enter it.'); return; }
  toast(e.message);
}
async function refresh(force) {
  if (!S.code || (S.busy && !force)) return;
  const mySeq = S.seq;
  try {
    const d = await rpc('get_state');
    if (mySeq !== S.seq && !force) return; // a newer change happened while we were fetching
    S.data = d; S.lastSync = new Date(); S.error = null;
    if (S.pend) S.pend.apply(S.data);
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
  if ((S.drag || SW.el || SW.open) && S.data && !render.force) return; // don't rebuild the page mid-drag / mid-swipe
  render.force = false;
  if (!S.code || !S.who) { app.innerHTML = loginView(); return bindLogin(); }
  if (!S.data) { app.innerHTML = '<div class="boot"><span class="spinner" aria-label="Loading"></span></div>'; return; }
  if (S.tab === 'quick') S.tab = 'basket';
  S.banner = S.tab === 'week' && S.sub === 'flow' ? cartBanners('week') : '';   // shown under the large title
  const body = S.tab === 'recipes' ? recipesView() : S.tab === 'basket' ? (S.sub === 'orders' ? ordersView() : S.sub === 'order' ? orderView() : basketView())
    : S.sub === 'flow' ? weekView() : S.sub === 'plan' && plans().length ? planView() : homeView();
  heartbeatSoon();
  app.innerHTML = `<div class="wrap">${body}
    <div class="sync">${S.error ? esc(S.error) : S.lastSync ? 'Synced ' + S.lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''}</div></div>
    ${S.tab === 'week' && S.sub === 'flow' ? actionBar() : S.tab === 'basket' && !S.sub ? basketActionBar() : ''}
    <nav class="tabbar">
      <button data-tab="week" class="${S.tab === 'week' ? 'on' : ''}">${IC.week}<span>Home</span></button>
      <button data-tab="basket" class="${S.tab === 'basket' ? 'on' : ''}">${IC.bag}<span>Basket</span>${basketCounts().unc ? '<i class="dot" aria-label="items not in the cart yet"></i>' : ''}</button>
      <button data-tab="recipes" class="${S.tab === 'recipes' ? 'on' : ''}">${IC.book}<span>Recipes</span></button>
    </nav>`;
}

function whoBtn() { return `<button class="who" data-act="menu" aria-label="${esc(S.who)} — menu">${esc((S.who || '?').trim().charAt(0).toUpperCase())}</button>`; }
function header(title, sub, actions = '') {
  const b = S.banner || ''; S.banner = '';
  return `<div class="top"><div class="top-t"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <div class="top-actions">${actions}${whoBtn()}</div></div>${b}`;
}

function loginView() {
  const names = ['Sean'];
  return `<div class="login">
    <h1 class="brand">sous</h1><p>for the Morishiges</p>
    <form id="loginForm" autocomplete="off">
      <label for="code">Household passcode</label>
      <input id="code" class="field" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="word-word-00" value="${esc(S.code)}" required>
      <label for="who">Who are you?</label>
      <div class="chips" style="margin-bottom:8px">${names.map(n => `<button type="button" class="chip ${S.who === n ? 'on' : ''}" data-name="${n}">${n}</button>`).join('')}</div>
      <input id="who" class="field" type="text" placeholder="Or type your name" value="${esc(S.who)}" required>
      <div class="err" id="loginErr">${esc(S.loginErr || '')}</div>
      <button class="btn" type="submit">Continue</button>
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
      btn.disabled = false; btn.textContent = 'Continue';
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
    const prog = c.total ? `${c.added ?? 0} of ${c.total} in the cart` : '';
    const missing = c.missing || [];
    const label = kind === 'quick' ? `Quick order #${c.week_id}` : `Week of ${fmtDate(c.week_start)}`;
    let cls = 'info', head = c.message;
    if (c.status === 'blocked_retrying') { cls = 'warn'; head ||= 'QFC’s site is having trouble.'; }
    else if (c.status === 'filling') head ||= 'Filling the QFC cart…';
    else if (c.status === 'partial') { cls = 'warn'; head ||= `Cart is filled except ${missing.length} item${missing.length === 1 ? '' : 's'}. Add ${missing.length === 1 ? 'it' : 'them'} in the QFC app before checkout.`; }
    else if (c.status === 'done') { cls = 'ok'; head ||= 'Everything is in the QFC cart.'; }
    const retry = c.retry_at && ['blocked_retrying', 'filling', 'partial'].includes(c.status)
      ? (new Date(c.retry_at) > new Date() ? `Retrying around ${fmtT(c.retry_at)}` : 'Retrying now…') : '';
    const pct = c.total ? Math.round(100 * Math.min(c.added || 0, c.total) / c.total) : null;
    const showProg = prog && !(head || '').includes(`${c.added ?? 0} of ${c.total}`);   // never say the count twice
    const meta = [label, showProg && prog, retry, 'Updated ' + fmtT(c.updated_at)].filter(Boolean).map(esc).join(' · ');
    return `<div class="banner cart ${cls}" role="status" aria-live="polite">
      <div class="cart-head"><i class="sdot"></i><span class="big">${esc(head)}</span></div>
      ${pct != null && c.status !== 'done' ? `<div class="cartbar" aria-label="${pct}% in cart"><i style="width:${pct}%"></i></div>` : ''}
      <div class="cart-meta">${meta}</div>
      ${missing.length ? `<details class="cart-missing"><summary>${c.status === 'done' ? 'Not added' : 'Still missing'} · ${missing.length}</summary><ul>${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul></details>` : ''}</div>`;
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
function weekMode() { return S.sub === 'plan' && plans().length ? 'plan' : 'shop'; }
function modeToggle() {
  return '';
  const m = weekMode();
  return `<div class="seg"><button class="${m === 'plan' ? 'on' : ''}" data-act="mode" data-mode="plan">Plan</button><button class="${m === 'shop' ? 'on' : ''}" data-act="mode" data-mode="shop">Shopping</button></div>`;
}
function mealChip(p, m) {
  const sel = S.sel && S.sel.w === p.week_id && S.sel.r === m.recipe_id;
  const link = m.url ? `<a class="rlink" href="${esc(m.url)}" target="_blank" rel="noopener">Recipe</a>`
    : `<button class="rlink linkbtn" data-act="showRecipe" data-id="${m.recipe_id}">Recipe</button>`;
  return `<div class="meal ${sel ? 'sel' : ''}" draggable="true" role="button" tabindex="0" data-act="selMeal" data-week="${p.week_id}" data-id="${m.recipe_id}" aria-pressed="${sel}">
    <div class="mt"><b>${esc(m.title)}</b></div>
    <div class="mm"><span class="meta">${metaLine([m.total_time && esc(m.total_time), 'Serves ' + m.servings, m.long_cook && '<em class="long">Long cook</em>'])}</span>${link}</div></div>`;
}
function planSection(p) {
  const end = addDays(p.week_start, 6), t = todayISO(), days = [0, 1, 2, 3, 4, 5, 6].map(n => addDays(p.week_start, n));
  const on = d => p.meals.filter(m => m.planned_date === d);
  const tray = p.meals.filter(m => !m.planned_date || m.planned_date < p.week_start || m.planned_date > end);
  const picking = S.sel && S.sel.w === p.week_id;
  const selMeal = picking && p.meals.find(m => m.recipe_id === S.sel.r);
  return `<section class="plan"><div class="sec-head"><h2>${planLabel(p)}</h2><span class="sec-sub">${fmtDate(p.week_start)} – ${fmtDate(end)} · ${p.status === 'carted' ? 'In the cart' : 'Sent to cart'}</span></div>
    ${picking && selMeal ? `<div class="selhint" role="status"><span>Tap a day for <b>${esc(selMeal.title)}</b>${selMeal.planned_date ? ', or Not scheduled to clear it' : ''}.</span><button class="linkbtn" data-act="selMeal" data-week="${p.week_id}" data-id="${selMeal.recipe_id}">Cancel</button></div>`
      : `<p class="hint">Tap a meal, then a day<span class="desk">, or drag it</span>. Changes sync to every phone.</p>`}
    <div class="group">Not scheduled${tray.length ? ` · ${tray.length}` : ''}</div>
    <div class="tray drop ${picking ? 'target' : ''}" data-act="dropTray" data-week="${p.week_id}">
      ${tray.length ? tray.map(m => mealChip(p, m)).join('') : `<div class="none">${p.meals.length ? 'Every meal has a day.' : 'No meals were picked for this week.'}</div>`}</div>
    <div class="group">Days</div>
    <div class="days">${days.map(d => `<div class="day drop ${d === t ? 'today' : ''} ${picking ? 'target' : ''}" data-act="dropDay" data-week="${p.week_id}" data-date="${d}">
      <div class="dayhead"><b>${dayName(d)}</b><small>${d === t ? 'Today' : fmtDate(d)}</small></div>
      <div class="daymeals">${on(d).map(m => swipeWrap(mealChip(p, m), { act: 'unschedule', id: m.recipe_id, label: 'Unschedule', extra: `data-week="${p.week_id}"`, cls: 'sw-meal' })).join('') || `<span class="none">${picking ? 'Tap to put it here' : ''}</span>`}</div></div>`).join('')}</div></section>`;
}
function planView() {
  const ps = plans();
  return backHome() + header('Meal plan', ps.length > 1 ? 'This week and next' : '') + presenceNote() + ps.map(planSection).join('');
}
// recipe sheet for recipes without a web link (typed-up photo recipes)
async function showRecipe(id) {
  let r; try { r = await rpc('get_recipe', { p_id: id }); } catch (e) { return handleErr(e); }
  if (!r) return toast('Recipe not found');
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet tall"><i class="grab"></i><h2 class="sheet-h">${esc(r.title)}</h2>
    <div class="meta">${metaLine([r.total_time && esc(r.total_time), 'Serves ' + esc(r.servings || '?')])}</div>
    <h3>Ingredients</h3><ul class="ings">${(r.ingredients || []).map(i => `<li>${esc([i.qty, i.unit, i.item].filter(Boolean).join(' '))}</li>`).join('')}</ul>
    ${(r.steps || []).length ? `<h3>Steps</h3><ol class="rsteps">${r.steps.map(t => `<li>${esc(typeof t === 'string' ? t : t.text || '')}</li>`).join('')}</ol>` : ''}
    ${r.url ? `<p><a href="${esc(r.url)}" target="_blank" rel="noopener">Open original</a></p>` : ''}
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
  if (!w) return backHome() + header('This week') + `<div class="empty"><p><b>No week planned yet</b>Options show up here when they’re posted.</p></div>`;
  if (S.step == null) S.step = defaultStep();
  const st = w.status, ds = defaultStep();
  const steps = `<div class="steps" role="tablist">${STEPS.map((n, i) => `<button role="tab" aria-selected="${S.step === i}" class="step ${S.step === i ? 'on' : ''} ${i < ds ? 'done' : ''}" data-step="${i}">${i < ds ? IC.check : ''}${n}</button>`).join('')}</div>`;
  let banner = '';
  if (st === 'ready_for_cart') banner = `<div class="note-row"><i class="sdot ok"></i><span>Sent by ${esc(w.sent_by || '?')}${w.sent_at ? ' · ' + fmtWhen(w.sent_at) : ''}. The QFC cart gets filled next.</span></div>`;
  if (st === 'picking' && S.step > 0 && (S.data.items || []).some(i => i.source === 'recipe')) banner = `<div class="note-row"><i class="sdot warn"></i><span>Picks changed. Go back to Pick and tap Confirm portions to refresh the list.</span></div>`;
  const views = [pickView, pantryView, staplesView, listView];
  return backHome() + header('Week of ' + fmtDate(w.week_start), statusLabel(st)) + presenceNote() + steps + banner + views[S.step]();
}
function statusLabel(st) {
  return { picking: 'Picking meals', pantry: 'Checking pantry and staples', ready_for_cart: 'Sent to cart', carted: 'In the QFC cart' }[st] || st;
}
function locked() {
  if (S.tab === 'quick') { const q = S.data && S.data.quick; return !q || q.status !== 'picking'; }
  return ['ready_for_cart', 'carted'].includes(weekStatus());
}
function allItems() { const seen = new Set(); return [...(S.data.items || []), ...((S.data.quick && S.data.quick.items) || []), ...((S.data.basket && S.data.basket.items) || [])].filter(i => !seen.has(i.id) && seen.add(i.id)); }

function pickView() {
  const opts = S.data.options || [], n = picked().length;
  const msg = locked() ? `${n} meal${n === 1 ? '' : 's'} picked.` : n === 0 ? 'Tap the meals you want. Aim for three.' : n < 3 ? `${n} picked, ${3 - n} to go.` : n === 3 ? 'Three picked. Perfect.' : `${n} picked. More than three is fine.`;
  const more = S.data.more_available || 0;
  const moreBtn = locked() ? '' : more > 0
    ? `<button class="btn tinted" data-act="more">Show ${Math.min(6, more)} more recipes</button>`
    : `<p class="hint center">That’s everything. Add more in <a href="#" data-tab="recipes">Recipes</a>.</p>`;
  return `<div class="sec-head"><h2>Pick this week’s meals</h2><span class="sec-sub">${msg}</span></div>` + ownerNote()
    + opts.map(o => {
    const open = S.open[o.recipe_id] ?? false;
    const factor = o.servings / (o.base_servings || 6);
    const sug = mySuggestion(o.recipe_id);
    return `<div class="card ${o.picked ? 'picked' : ''} ${sug ? 'suggested' : ''}">
      <button class="card-main" data-act="pick" data-id="${o.recipe_id}" ${locked() ? 'disabled' : ''} aria-pressed="${o.picked}">
        <div class="check">${o.picked ? IC.check : ''}</div>
        <div class="card-txt"><div class="card-title">${esc(o.title)}</div>${sug ? `<div class="sugtag">You suggested ${sug.picked ? 'adding' : 'removing'} this</div>` : ''}
          <div class="meta">${timeMeta(o.total_time, o.total_minutes)}<span>Serves ${o.base_servings || '?'}</span><span>${lastCooked(o.last_cooked)}</span>${inAWhile(o.last_cooked) ? '<em class="long">Not in a while</em>' : ''}</div>
          ${tagPills(o.tags)}
          ${o.description ? `<div class="desc">${esc(o.description)}</div>` : ''}</div>
        ${o.image_url ? coverHtml({ ...o, id: o.recipe_id }, 'pthumb') : ''}
      </button>
      <div class="card-link">${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">View recipe</a>` : `<button class="linkbtn" data-act="showRecipe" data-id="${o.recipe_id}">View recipe</button>`}</div>
      ${o.picked ? `<div class="card-body">
        <div class="serv"><div class="serv-label">Servings<small>6 feeds 2 adults, 2 kids, plus lunches</small></div>
          <div class="stepper"><button data-act="serv" data-id="${o.recipe_id}" data-d="-1" aria-label="fewer" ${locked() ? 'disabled' : ''}>−</button><span>${o.servings}</span><button data-act="serv" data-id="${o.recipe_id}" data-d="1" aria-label="more" ${locked() ? 'disabled' : ''}>+</button></div></div>
        <button class="linkbtn disclose ${open ? 'open' : ''}" data-act="toggleIngs" data-id="${o.recipe_id}">${IC.chev}${open ? 'Hide' : 'Show'} ingredients for ${o.servings}</button>
        ${open ? `<ul class="ings">${(o.ingredients || []).map(i => { const s = Ingredients.scaleOne(i, factor); return `<li><span class="q">${esc(s.qty)}</span><span>${esc(s.item)}</span></li>`; }).join('')}</ul>` : ''}
      </div>` : ''}
    </div>`;
  }).join('') + moreBtn + (locked() ? '' : `<div class="center"><button class="linkbtn quiet" data-act="startOver">Start over</button></div>`);
}

// "(for Bolognese, Piccata)" / "(staple)" / "(added by Sean)" shown after an item's name
function srcLabel(i, kind) {
  if (i.source === 'recipe') return i.recipes && i.recipes.length ? `for ${i.recipes.map(t => t.replace(/\s*\([^)]*\)\s*$/, '')).join(', ')}` : '';
  if (i.source === 'custom') return `added by ${i.added_by || '?'}`;
  return kind === 'list' ? 'staple' : '';
}
function nameHtml(i, kind) {
  const src = srcLabel(i, kind);
  return `<b>${esc(i.name)}</b>${src ? `<span class="src">${esc(src.charAt(0).toUpperCase() + src.slice(1))}</span>` : ''}`;
}
// swipe-left action for an item row: custom items are deleted; recipe/staple items on the pantry check and the list are removed (include = false)
function itemSwipe(i, kind) {
  if (locked()) return null;
  if (i.source === 'custom') return { act: 'delItem', label: 'Delete' };
  if (kind === 'pantry' || kind === 'list') return { act: 'skipItem', label: 'Remove' };
  return null;
}
function itemRows(items, kind) {
  return groupBy(items).map(([cat, list]) => `<div class="group">${CAT_LABEL[cat] || esc(cat)}</div><div class="list">${list.map(i => {
    const sw = itemSwipe(i, kind), row = itemRow(i, kind);
    return sw ? swipeWrap(row, { act: sw.act, id: i.id, label: sw.label }) : row;
  }).join('')}</div>`).join('');
}
function itemRow(i, kind) {
  {
    if (kind === 'pantry') return `<div class="row ${i.have_it ? 'dim' : ''}"><div class="name">${nameHtml(i, kind)}<small>${esc(i.qty || '')}</small></div>
      <button class="toggle ${i.have_it ? 'on' : ''}" data-act="have" data-id="${i.id}" aria-pressed="${i.have_it}" ${locked() ? 'disabled' : ''}>Have it</button></div>`;
    if (kind === 'staple') return `<div class="row ${i.include ? '' : 'dim'}"><div class="name">${nameHtml(i, kind)}<small>${i.source === 'custom' ? '' : esc(stapleProduct(i))}</small></div>
      <input class="qtyin" data-act="qty" data-id="${i.id}" value="${esc(i.qty || '')}" aria-label="quantity" ${locked() ? 'disabled' : ''}>
      ${i.source === 'custom' && !locked() ? `<button class="x" data-act="rm" data-id="${i.id}" aria-label="remove">${IC.x}</button>` : ''}
      <button class="toggle add ${i.include ? 'on' : ''}" data-act="inc" data-id="${i.id}" aria-pressed="${i.include}" ${locked() ? 'disabled' : ''}>${i.include ? 'Buy' : 'Skip'}</button></div>`;
    return `<div class="row"><div class="name">${nameHtml(i, kind)}</div><span class="qty">${esc(i.qty || '')}</span></div>`;
  }
}
function removedFooter(items) {
  const n = items.filter(i => !i.include).length;
  return n && !locked() ? `<div class="restore"><span>${n} item${n > 1 ? 's' : ''} removed</span><button class="linkbtn" data-act="restoreItems" data-ids="${items.filter(i => !i.include).map(i => i.id).join(',')}">Put back</button></div>` : '';
}
function stapleProduct(i) {
  if (i.source === 'custom') return 'added by ' + (i.added_by || '');
  const s = (S.data.staples || []).find(x => x.name.toLowerCase() === i.name.toLowerCase());
  return s ? s.product : '';
}
function pantryView() {
  const all = (S.data.items || []).filter(i => i.source === 'recipe'), items = all.filter(i => i.include);
  if (!all.length) return `<div class="empty"><p><b>Nothing to check yet</b>Pick meals and tap Confirm portions first.</p></div>`;
  const need = items.filter(i => !i.have_it).length;
  return `<div class="sec-head"><h2>Pantry check</h2><span class="sec-sub">${need} of ${items.length} to buy. Tap Have it for anything already in the kitchen.</span></div>` + itemRows(items, 'pantry') + removedFooter(all);
}
function addItemForm(id, title = 'Add an item') {
  const cats = CAT_ORDER.map(c => `<option value="${c}">${CAT_LABEL[c] || c}</option>`).join('');
  return `<div class="group">${title}</div><form id="${id}" class="list addform">
      <input class="field" name="name" placeholder="Item, e.g. paper towels" aria-label="Item name" required>
      <input class="field qtyf" name="qty" placeholder="Qty" aria-label="Quantity">
      <select class="field" name="category" aria-label="Aisle">${cats.replace('value="other"', 'value="other" selected')}</select>
      <button class="btn small" type="submit">Add</button></form>`;
}
function staplesView() {
  const items = (S.data.items || []).filter(i => i.source !== 'recipe');
  const recurring = items.filter(i => i.source === 'custom' || (S.data.staples || []).some(s => s.active && s.name.toLowerCase() === i.name.toLowerCase()));
  const other = items.filter(i => !recurring.includes(i));
  if (!items.length && weekStatus() === 'picking') return `<div class="empty"><p><b>No staples yet</b>Confirm portions on the Pick step and your usual staples show up here.</p></div>`;
  return `<div class="sec-head h2row"><h2>Staples and extras</h2>${clearAllBtn(S.data.week && S.data.week.id, items)}</div><p class="hint">Your usual QFC items. Buy or skip, adjust amounts, or add anything else.</p>
    ${locked() ? '' : addItemForm('addForm')}
    <h3 class="subhead">Every week</h3>${itemRows(recurring, 'staple')}
    ${other.length ? `<h3 class="subhead">Sometimes</h3>${itemRows(other, 'staple')}` : ''}`;
}
function listView() {
  const buy = (S.data.items || []).filter(i => i.include && !i.have_it);
  const meals = picked();
  return `<div class="sec-head"><h2>Shopping list</h2><span class="sec-sub">${buy.length} items for ${meals.length} meal${meals.length === 1 ? '' : 's'}</span></div>
    ${meals.length ? `<p class="hint">${meals.map(m => `${esc(m.title)} <span class="num">(${m.servings})</span>`).join(' · ')}</p>` : ''}
    ${buy.length ? itemRows(buy, 'list') : `<div class="empty"><p><b>Nothing on the list yet</b></p></div>`}`;
}
function actionBar() {
  const st = weekStatus(); if (!st) return '';
  let main = '', back = S.step > 0 ? `<button class="btn ghost back" data-act="go" data-step="${S.step - 1}" aria-label="Back">${IC.back}</button>` : '';
  if (S.step === 0) {
    const n = picked().length;
    main = locked() ? `<button class="btn ghost" data-act="go" data-step="3">See the list</button>`
      : `<button class="btn" data-act="confirm" ${n ? '' : 'disabled'}>Confirm portions${n ? ` · ${n}` : ''}</button>`;
  } else if (S.step === 1) main = `<button class="btn" data-act="go" data-step="2">Next: staples</button>`;
  else if (S.step === 2) main = `<button class="btn" data-act="go" data-step="3">Review list</button>`;
  else if (S.step === 3) {
    if (st === 'ready_for_cart') main = `<button class="btn ghost" data-act="reopen">Reopen to edit</button>`;
    else if (st === 'carted') main = `<button class="btn done" disabled>${IC.check}In the cart</button>`;
    else main = `<button class="btn" data-act="send" ${st === 'pantry' ? '' : 'disabled'}>Send to cart</button>`;
  }
  return `<div class="actionbar"><div class="inner">${back}${main}</div></div>`;
}

function quickView() {
  const q = S.data.quick;
  const intro = `<p class="hint">Just a few groceries (milk, eggs, fruit, snacks). Doesn’t touch this week’s plan.</p>`;
  if (!q) return header('Quick order') + intro + `<div class="empty"><p><b>Need a few things now?</b></p></div>
    <button class="btn" data-act="quickStart">Start a quick order</button>`;
  const items = q.items || [];
  const allRecipe = items.filter(i => i.source === 'recipe'), fromRecipes = allRecipe.filter(i => i.include), staples = items.filter(i => i.source !== 'recipe');
  const buy = items.filter(i => i.include && !i.have_it);
  const added = (q.quick_recipes || []).map(r => `${esc(r.title)} <span class="num">×${+r.batches}</span>`).join(' · ');
  if (q.status === 'ready_for_cart') return header('Quick order', 'Sent to cart') +
    `<div class="note-row"><i class="sdot ok"></i><span>Sent by ${esc(q.sent_by || '?')}${q.sent_at ? ' · ' + fmtWhen(q.sent_at) : ''}. The QFC cart gets filled next.</span></div>
     <div class="sec-head"><h2>${buy.length} items</h2>${added ? `<span class="sec-sub">Includes ${added}</span>` : ''}</div>${itemRows(buy, 'list')}
     <button class="btn ghost" data-act="quickStart" style="margin-top:24px">Start another quick order</button>`;
  return header('Quick order', `${buy.length} item${buy.length === 1 ? '' : 's'} to buy`) + intro +
    (fromRecipes.length ? `<h3 class="subhead">From snacks and baking</h3>${added ? `<p class="hint">${added}</p>` : ''}${itemRows(fromRecipes, 'pantry')}` : '') + removedFooter(allRecipe) +
    addItemForm('addFormQuick') +
    `<div class="h2row subhead-row"><h3 class="subhead">Staples</h3>${clearAllBtn(q.id, staples)}</div>${itemRows(staples, 'staple')}
     <div class="center"><button class="linkbtn quiet" data-act="quickDiscard">Discard this quick order</button></div>`;
}
function quickActionBar() {
  const q = S.data.quick; if (!q) return '';
  if (q.status === 'ready_for_cart') return `<div class="actionbar"><div class="inner"><button class="btn ghost" data-act="quickReopen">Reopen to edit</button></div></div>`;
  const n = (q.items || []).filter(i => i.include && !i.have_it).length;
  return `<div class="actionbar"><div class="inner"><button class="btn" data-act="quickSend" ${n ? '' : 'disabled'}>Send to cart${n ? ` · ${n}` : ''}</button></div></div>`;
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
  tags.sort((a, b) => sel.includes(b.id) - sel.includes(a.id));   // selected chips first so they're never scrolled out of view
  return `<div class="tagbar" role="group" aria-label="Filter by tag">${tags.map(t => `<button class="fchip ${sel.includes(t.id) ? 'on' : ''}" data-act="ftag" data-key="${key}" data-id="${t.id}" aria-pressed="${sel.includes(t.id)}">${esc(t.name)}</button>`).join('')}
    ${sel.length ? `<button class="fchip clear" data-act="fclear" data-key="${key}">Clear</button>` : ''}</div>
    ${sel.length > 1 ? `<p class="hint" style="margin:-4px 0 12px;font-size:13px">Showing recipes with <b>all</b> of: ${sel.map(id => esc(tagName(id))).join(' + ')}</p>` : ''}`;
}
function lastCooked(d) { return d ? `Last cooked ${fmtDate(d)}` : 'Not cooked yet'; }

/* ---------- recipe list: search · segment · sort ---------- */
function minutesOf(t) { if (!t) return null; t = t.toLowerCase(); const h = t.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)\b/), m = t.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  const n = (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0); return n || null; }
function timeMeta(t, mins) {
  const m = mins ?? minutesOf(t);
  return `${t ? `<span class="num">${esc(t)}</span>` : ''}${m >= 90 ? '<em class="long">Long cook</em>' : ''}`;
}
function inAWhile(d) { return d && d <= addDays(todayISO(), -28); }
const SORTS = { cooked: 'Least recently cooked', newest: 'Newest', az: 'A–Z' };
function recipeMatches(r, q) {
  if (!q) return true;
  const hay = [r.title, r.ing_text || '', ...(r.tags || []).map(tagName)].join(' ¦ ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));   // every word must match somewhere
}
function sortRecipes(list) {
  const az = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  if (S.sort === 'az') return list.sort(az);
  if (S.sort === 'newest') return list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '') || az(a, b));
  return list.sort((a, b) => (a.last_cooked ? 1 : 0) - (b.last_cooked ? 1 : 0) || (a.last_cooked || '').localeCompare(b.last_cooked || '') || az(a, b));
}
function snackCard(r) {
  const b = S.batches[r.id] || 1;
  return `<div class="rcard"><button class="rcard-open rc-row" data-act="openRecipe" data-id="${r.id}" aria-label="Open ${esc(r.title)}">${coverHtml(r, 'rthumb')}<div class="rc-body">
    <div class="rc-top"><div class="card-title">${esc(r.title)}</div>${IC.chev}</div>
    <div class="meta">${timeMeta(r.total_time, r.total_minutes)}<span>Makes ${r.servings || '?'}</span><span>${lastCooked(r.last_cooked)}</span>${r.note_count ? `<span>${r.note_count} note${r.note_count > 1 ? 's' : ''}</span>` : ''}</div>
    <div class="pills"><span class="pill kind">Snack</span>${r.status === 'trial' ? '<span class="pill trial">New</span>' : ''}${sortedTags(r.tags).map(pillBtn).join('')}</div></div></button>
    <div class="snackrow"><div class="stepper sm" aria-label="Batches"><button data-act="batch" data-id="${r.id}" data-d="-1" aria-label="fewer batches">−</button><span class="num">${b}×</span><button data-act="batch" data-id="${r.id}" data-d="1" aria-label="more batches">+</button></div>
      <button class="btn small compact" data-act="snackAdd" data-id="${r.id}" ${(r.ingredients || []).length ? '' : 'disabled'}>Add to basket</button></div></div>`;
}
function recipeCard(r) {
  return `<div class="rcard"><button class="rcard-open rc-row" data-act="openRecipe" data-id="${r.id}" aria-label="Open ${esc(r.title)}">${coverHtml(r, 'rthumb')}<div class="rc-body">
    <div class="rc-top"><div class="card-title">${esc(r.title)}</div>${IC.chev}</div>
    <div class="meta">${timeMeta(r.total_time, r.total_minutes)}<span>Serves ${r.servings || '?'}</span><span>${lastCooked(r.last_cooked)}</span>${r.note_count ? `<span>${r.note_count} note${r.note_count > 1 ? 's' : ''}</span>` : ''}</div>
    ${r.status === 'trial' || (r.tags || []).length ? `<div class="pills">${r.status === 'trial' ? '<span class="pill trial">New</span>' : ''}${sortedTags(r.tags).map(pillBtn).join('')}</div>` : ''}</div></button></div>`;
}
function pendingCard(r) {
  return r.photo_count ? `<div class="rcard pending"><div class="pills"><span class="pill trial">Typing it up</span></div>
      <div class="card-title" style="margin-top:6px">${esc(r.title)}</div>
      <div class="meta">${r.photo_count} photo${r.photo_count > 1 ? 's' : ''} · Added by ${esc(r.added_by || '?')}. The assistant is typing it up.</div></div>`
    : `<div class="rcard pending"><div class="pills"><span class="pill trial">Importing soon</span></div>
      <div class="card-title" style="margin-top:6px;word-break:break-all;font-size:15px;font-weight:500">${esc(r.url)}</div>
      <div class="meta">Added by ${esc(r.added_by || '?')}. Ingredients are filled in soon.${r.notes ? ' ' + esc(r.notes) : ''}</div></div>`;
}
function pillBtn(t) { return `<span class="pill tap" role="button" tabindex="0" data-act="tagFilter" data-id="${t.id}" aria-label="Show recipes tagged ${esc(t.name)}">${esc(t.name)}</span>`; }
/* smart shelves + filters (a filter is a tag or a shelf; it combines with search and the segment) */
const SHELVES = [
  { k: 'awhile', title: "Haven't had in a while", sub: 'Last cooked 4+ weeks ago', test: r => inAWhile(r.last_cooked), sort: (a, b) => a.last_cooked.localeCompare(b.last_cooked) },
  { k: 'new', title: 'New to try', sub: 'Added recently, not a favorite yet', test: r => r.status === 'trial', sort: (a, b) => (b.created_at || '').localeCompare(a.created_at || '') },
  { k: 'quick', title: 'Under 30 min', sub: 'By total time', test: r => (r.total_minutes ?? minutesOf(r.total_time) ?? 999) <= 30, sort: (a, b) => (a.total_minutes || 0) - (b.total_minutes || 0) },
];
function filterDef(f) {
  if (!f) return null;
  if (f.k === 'tag') { const n = tagName(f.id); return n ? { label: n, test: r => (r.tags || []).includes(f.id) } : null; }
  const sh = SHELVES.find(x => x.k === f.k); return sh && { label: sh.title, test: sh.test };
}
function inSeg(r) { return S.seg === 'all' || (S.seg === 'snack' ? r.recipe_type === 'snack/baking' : r.recipe_type !== 'snack/baking'); }
function libRecipes() { return (S.data.recipes || []).filter(r => r.status !== 'retired' && r.status !== 'pending' && inSeg(r)); }
function shelvesHtml() {
  const lib = libRecipes(), rows = [];
  const tagShelves = (S.data.tags || []).filter(t => lib.some(r => (r.tags || []).includes(t.id))).sort((a, b) => a.name.localeCompare(b.name))
    .map(t => ({ f: { k: 'tag', id: t.id }, title: t.name, sub: 'Tag', items: sortRecipes(lib.filter(r => (r.tags || []).includes(t.id))) }));
  const smart = SHELVES.map(sh => ({ f: { k: sh.k }, title: sh.title, sub: sh.sub, items: lib.filter(sh.test).sort(sh.sort) }));
  // order: what to cook next (in a while), tags people chose, new to try, quick
  for (const x of [smart[0], ...tagShelves, smart[1], smart[2]]) if (x.items.length) rows.push(x);
  if (!rows.length) return '';
  return rows.map(x => `<section class="shelf" aria-label="${esc(x.title)}">
      <div class="shelf-head"><h3>${esc(x.title)}</h3>
        <button class="seeall" data-act="seeAll" data-f='${esc(JSON.stringify(x.f))}'>See all</button></div>
      <div class="shelf-row">${x.items.slice(0, 12).map(r => `<button class="scard" data-act="openRecipe" data-id="${r.id}">
          ${coverHtml(r, 'scard-art')}
          <span class="scard-title">${esc(r.title)}</span>
          <span class="scard-meta">${esc([r.total_time, (r.total_minutes ?? minutesOf(r.total_time)) >= 90 && 'Long cook'].filter(Boolean).join(' · '))}</span></button>`).join('')}</div></section>`).join('')
    + `<h2 class="list-head">All recipes</h2>`;
}
/* Cover photo with a fixed-ratio frame; the soft gradient + emoji sits underneath, so a missing or failed image never looks broken. */
function coverHtml(r, cls, eager) {
  const img = r.image_url ? `<img src="${esc(r.image_url)}" alt="" loading="${eager ? 'eager' : 'lazy'}" decoding="async" onload="this.classList.add('in')" onerror="this.remove()">` : '';
  return `<span class="cover ${cls}${r.image_url ? '' : ' ph'}" style="--h:${(r.id * 47) % 360}" aria-hidden="true"><span class="cover-ph">${esc((r.title || '?').replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase())}</span>${img}</span>`;
}
function recipeEmoji(r) {
  const title = r.title.toLowerCase(), t = title + ' ' + (r.ing_text || '').toLowerCase();
  if (r.recipe_type === 'snack/baking') return /muffin|cake|cookie|bread/.test(t) ? '🧁' : '🥨';
  const RULES = [[/salad/, '🥗'], [/soup|stew|chili/, '🍲'], [/taco|carnitas/, '🌮'], [/salmon|sushi|fish|shrimp/, '🍣'], [/noodle|pasta|bolognese|tortellini|gnocchi|orzo|spaghetti/, '🍝'],
    [/steak|beef|roast|stroganoff/, '🥩'], [/pork|chop/, '🍖'], [/chicken/, '🍗'], [/lettuce wrap|wrap/, '🥬'], [/rice|bowl/, '🍚']];
  for (const [re, e] of RULES) if (re.test(title)) return e;   // the title decides first, ingredients only as a fallback
  for (const [re, e] of [[/salad/, '🥗'], [/soup|stew|chili/, '🍲'], [/taco|carnitas/, '🌮'], [/salmon|sushi|fish|shrimp/, '🍣'], [/noodle|pasta|bolognese|tortellini|gnocchi|orzo|spaghetti/, '🍝'],
    [/steak|beef|roast|stroganoff/, '🥩'], [/pork|chop/, '🍖'], [/chicken/, '🍗'], [/lettuce wrap|wrap/, '🥬'], [/rice|bowl/, '🍚']]) if (re.test(t)) return e;
  return '🍽️';
}
function tokenHtml() {
  const f = filterDef(S.filter);
  return f ? `<div class="tokens"><span class="token">${esc(f.label)}<button data-act="clearFilter" aria-label="Remove filter ${esc(f.label)}">${IC.x}</button></span></div>` : '';
}
function recipeListHtml() {
  const all = (S.data.recipes || []).filter(r => r.status !== 'retired');
  const f = filterDef(S.filter); if (S.filter && !f) S.filter = null;
  const pending = S.q || f ? [] : all.filter(r => r.status === 'pending' && inSeg(r));
  const lib = sortRecipes(all.filter(r => r.status !== 'pending' && inSeg(r) && recipeMatches(r, S.q) && (!f || f.test(r))));
  const shelves = !S.q && !f ? shelvesHtml() : '';
  const cards = !lib.length ? '' : '<div class="glist">' + lib.map(r => swipeWrap(r.recipe_type === 'snack/baking' ? snackCard(r) : recipeCard(r), { act: 'delRecipeSwipe', id: r.id, label: 'Delete', full: false, cls: 'sw-card' })).join('') + '</div>';
  const what = [S.q && `matching “${esc(S.q)}”`, f && `in ${esc(f.label)}`].filter(Boolean).join(' ');
  const count = `<div class="rcount">${lib.length} recipe${lib.length === 1 ? '' : 's'}${what ? ' ' + what : ''} · ${SORTS[S.sort]}</div>`;
  const empty = !lib.length ? `<div class="empty"><p><b>${S.q || f ? 'No results' : 'Nothing here yet'}</b>${S.q || f ? `No recipes ${what}.` : ''}</p>${f ? '<button class="linkbtn" data-act="clearFilter">Remove filter</button>' : ''}</div>` : '';
  return shelves + (pending.length ? `<div class="glist">${pending.map(pendingCard).join('')}</div>` : '') + (lib.length ? count : '') + cards + empty;
}
function recipesView() {
  if (S.detail) return recipeDetailView();
  const seg = [['all', 'All'], ['dinner', 'Dinners'], ['snack', 'Snacks & baking']];
  return header('Recipes', '', `<button class="iconbtn add" data-act="addRecipe" aria-label="Add recipe">${IC.plus}</button>`) + `
    <div class="searchrow"><label class="search">${IC.search}
        <input id="rsearch" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Search recipes, ingredients, tags" value="${esc(S.q)}" aria-label="Search recipes">
        <button class="sclear ${S.q ? 'on' : ''}" data-act="qclear" aria-label="Clear search" type="button">${IC.x}</button></label>
      <button class="iconbtn sortbtn" data-act="sortMenu" aria-label="Sort: ${SORTS[S.sort]}">${IC.sort}</button></div>
    <div id="rtoken">${tokenHtml()}</div>
    <div class="seg3 seg" role="tablist">${seg.map(([k, l]) => `<button role="tab" aria-selected="${S.seg === k}" class="${S.seg === k ? 'on' : ''}" data-act="seg" data-seg="${k}">${l}</button>`).join('')}</div>
    <div id="rlist">${recipeListHtml()}</div>`;
}
function updateRecipeList() { const el = $('#rlist'); if (el) el.innerHTML = recipeListHtml(); const tk = $('#rtoken'); if (tk) tk.innerHTML = tokenHtml(); const c = $('.sclear'); if (c) c.classList.toggle('on', !!S.q); }
function listTop() { const sr = $('.searchrow'); if (sr && window.scrollY > sr.offsetTop) window.scrollTo({ top: Math.max(0, sr.offsetTop - 8), behavior: reduced() ? 'auto' : 'smooth' }); }
function sortMenu() {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet actions" role="dialog" aria-label="Sort recipes"><div class="agroup"><div class="sheet-title">Sort by</div>
    ${Object.entries(SORTS).map(([k, l]) => `<button class="action ${S.sort === k ? 'on' : ''}" data-sort="${k}"><span>${l}</span>${S.sort === k ? `<b>${IC.check}</b>` : ''}</button>`).join('')}
    </div><button class="action cancel" data-sort="">Cancel</button></div>`;
  bg.onclick = e => { const b = e.target.closest('[data-sort]'); if (e.target !== bg && !b) return; if (b && b.dataset.sort) { S.sort = b.dataset.sort; localStorage.setItem('mp_sort', S.sort); } bg.remove(); render.force = true; render(); };
  document.body.appendChild(bg);
}
document.addEventListener('input', ev => { if (ev.target.id === 'rsearch') { S.q = ev.target.value; updateRecipeList(); }
  if (ev.target.closest('#timeForm') && S.detail) S.detail.timeDraft = ev.target.value; });
document.addEventListener('keydown', ev => { if (ev.target.id === 'rsearch' && ev.key === 'Enter') ev.target.blur(); });

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
  const back = `<button class="backlink" data-act="closeRecipe">${IC.back}Recipes</button>`;
  if (!lib) return back + `<div class="empty"><p>This recipe is no longer in the library.</p></div>`;
  const r = dt.r || {}, notes = r.notes || [], tags = lib.tags || [];
  const allTags = (S.data.tags || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const tagSection = dt.tagEdit
    ? `<div class="chips tagedit">${allTags.map(t => { const on = tags.includes(t.id); return `<button class="tchip ${on ? 'on' : ''}" data-act="toggleTag" data-id="${t.id}" aria-pressed="${on}">${esc(t.name)}</button>`; }).join('')}</div>
       <form id="newTagForm" class="inline-form"><input class="field" name="tag" maxlength="30" placeholder="New tag, e.g. Date night" autocomplete="off" aria-label="New tag name"><button class="btn small compact" type="submit">Add tag</button></form>
       <button class="linkbtn strong" data-act="tagEdit">Done</button>`
    : `<div class="chips">${sortedTags(tags).map(t => `<span class="tchip on static">${esc(t.name)}</span>`).join('') || '<span class="none">No tags yet</span>'}</div>`;
  const link = lib.url ? `<a class="btn small compact" href="${esc(lib.url)}" target="_blank" rel="noopener">Open recipe</a>`
    : `<button class="btn small compact" data-act="showRecipe" data-id="${lib.id}">Ingredients and steps</button>`;
  const hero = `<div class="dhero-wrap">${coverHtml(lib, 'dhero', true)}
    <button class="photo-btn ${lib.image_url ? 'on-photo' : ''}" data-act="coverPick" data-id="${lib.id}" ${dt.coverBusy ? 'disabled' : ''}>${dt.coverBusy ? 'Uploading…' : lib.image_url ? 'Change photo' : 'Add photo'}</button></div>`;
  const kind = [{ favorite: 'Favorite', trial: 'New to try', retired: 'Retired', pending: 'Importing' }[lib.status] || lib.status, lib.recipe_type === 'snack/baking' && 'Snack and baking'].filter(Boolean).join(' · ');
  return back + hero + `<div class="detail">
    <div class="eyebrow">${esc(kind)}</div>
    <h1 class="dtitle">${esc(lib.title)}</h1>
    ${dt.editTime ? `<form id="timeForm" class="inline-form timeform"><input class="field" name="t" value="${esc(dt.timeDraft ?? lib.total_time ?? '')}" placeholder="e.g. 35 min or 1 hr 20 min" aria-label="Total time" autocomplete="off">
        <button class="btn small compact" type="submit">Save</button><button class="linkbtn" type="button" data-act="cancelTime">Cancel</button></form>` : ''}
    <div class="meta dmeta">${dt.editTime ? '' : `<button class="timeedit" data-act="editTime" aria-label="Edit total time">${esc(lib.total_time || 'Add time')}</button>${minutesOf(lib.total_time) >= 90 ? '<em class="long">Long cook</em>' : ''}`}<span>Serves ${lib.servings || '?'}</span><span>${lastCooked(lib.last_cooked)}</span></div>
    ${lib.description ? `<p class="desc lead">${esc(lib.description)}</p>` : ''}
    <div class="dactions">${link}</div>
    <div class="dsec-row"><h3 class="dsec">Tags</h3>${dt.tagEdit ? '' : `<button class="hdrbtn" data-act="tagEdit">${tags.length ? 'Edit' : 'Add'}</button>`}</div>${tagSection}
    <div class="dsec-row"><h3 class="dsec">Notes${notes.length ? ` <small>${notes.length}</small>` : ''}</h3></div>
    <form id="noteForm" class="noteform"><textarea class="field" name="body" rows="3" maxlength="2000" placeholder="Tweaks, what the kids thought, what to change next time" aria-label="New note">${esc(S.noteDraft[dt.id] || '')}</textarea>
      <div class="noteform-foot"><span class="hint">Posting as ${esc(S.who)}</span><button class="btn small compact" type="submit">Add note</button></div></form>
    ${dt.loading && !dt.r ? '<p class="hint">Loading notes…</p>' : notes.length ? `<ul class="notes">${notes.map(n => `<li>${swipeWrap(`<div class="note">
        <div class="note-head"><b>${esc(n.added_by || 'Someone')}</b><span>${fmtNoteTime(n.created_at)}</span>
          <button class="note-x" data-act="delNote" data-id="${n.id}" aria-label="Delete note">${IC.x}</button></div>
        <div class="note-body">${esc(n.body)}</div></div>`, { act: 'delNoteSwipe', id: n.id, label: 'Delete', cls: 'sw-note' })}</li>`).join('')}</ul>` : '<p class="hint">No notes yet.</p>'}
    <div class="danger-zone"><button class="btn ghost danger" data-act="deleteRecipe" data-id="${lib.id}">Delete recipe</button>
      <p class="hint">Removes it from the library and from weeks still being picked. Weeks already sent keep their history.</p></div>
  </div>`;
}
function confirmSheet({ title, body, ok, danger }) {
  return new Promise(resolve => {
    const bg = document.createElement('div'); bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><i class="grab"></i><h2 class="sheet-h">${title}</h2><p class="hint">${body}</p>
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
  if (el.dataset.tab) { ev.preventDefault(); const same = S.tab === el.dataset.tab; S.tab = el.dataset.tab; S.detail = null; if (same || S.tab !== 'week') S.sub = null; render.force = true; render(); window.scrollTo(0, 0); return; }
  const act = el.dataset.act;
  if (!act && el.dataset.step != null) { S.step = +el.dataset.step; render.force = true; render(); window.scrollTo(0, 0); return; }
  const opt = () => d.options.find(o => o.recipe_id === id), item = () => allItems().find(i => i.id === id);
  switch (act) {
    case 'go': S.step = +el.dataset.step; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'pick': { const o = opt(), sug = mySuggestion(id); const v = sug ? !sug.picked : !o.picked;
      if (!isOwner()) { mutate('set_pick', { p_week: w.id, p_recipe: id, p_picked: v, p_who: S.who }, null, r => { if (r === 'suggested') toast(`Suggested to ${w.owner}`); }); break; }
      if (v && picked().length >= 3) toast('That makes ' + (picked().length + 1) + '. Three is the goal.');
      mutate('set_pick', { p_week: w.id, p_recipe: id, p_picked: v, p_who: S.who }, () => { o.picked = v; if (!w.owner) w.owner = S.who; if (w.status === 'pantry') w.status = 'picking'; }); break; }
    case 'sugAnswer': mutate('answer_suggestion', { p_week: w.id, p_recipe: id, p_by: el.dataset.by, p_accept: el.dataset.ok === '1', p_who: S.who }); break;
    case 'askEdit': mutate('request_edit', { p_week: w.id, p_who: S.who }, () => { w.editors = [...(w.editors || []), S.who]; }, () => toast('You can edit picks now')); break;
    case 'home': S.sub = null; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'flow': S.sub = 'flow'; S.step = +(el.dataset.step || 0); render.force = true; render(); window.scrollTo(0, 0); break;
    case 'planView': S.sub = 'plan'; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'basketTab': S.tab = 'basket'; S.sub = null; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'fillCart': fillCart(el); break;
    case 'weOrdered': weOrdered(); break;
    case 'activity': activitySheet(); break;
    case 'orders': openOrders(); break;
    case 'openOrder': S.sub = 'order'; S.orderId = id; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'backOrders': S.sub = 'orders'; render.force = true; render(); break;
    case 'backBasket': S.sub = null; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'reorder': reorder(id, el); break;
    case 'orderStatus': orderStatus(id, el.dataset.status); break;
    case 'serv': { const o = opt(); const v = Math.max(1, Math.min(30, o.servings + +el.dataset.d));
      mutate('set_servings', { p_week: w.id, p_recipe: id, p_servings: v }, () => { o.servings = v; if (w.status === 'pantry') w.status = 'picking'; }); break; }
    case 'more': {
      el.disabled = true; el.textContent = 'Finding more recipes…';
      S.busy++; S.seq++;
      try { const n = await rpc('add_more_options', { p_week: w.id, p_count: 6 }); toast(n ? `Added ${n} more recipe${n > 1 ? 's' : ''}` : 'That’s all the recipes for now'); }
      catch (e) { handleErr(e); } finally { S.busy--; }
      await refresh(true); break; }
    case 'toggleIngs': S.open[id] = !S.open[id]; render(); break;
    case 'confirm': {
      const items = Ingredients.combine(d.options).map(({ name, qty, category, have_it, recipes }) => ({ name, qty, category, have_it, recipes }));
      el.disabled = true; el.textContent = 'Building list…';
      await mutate('confirm_portions', { p_week: w.id, p_items: items, p_who: S.who });
      S.step = 1; render.force = true; render(); window.scrollTo(0, 0); toast('Portions confirmed'); break; }
    case 'have': { const i = item(); const v = !i.have_it; mutate('set_item', { p_item: id, p_have_it: v, p_include: null, p_qty: null }, () => { i.have_it = v; }); break; }
    case 'inc': { const i = item(); const v = !i.include; mutate('set_item', { p_item: id, p_have_it: null, p_include: v, p_qty: null }, () => { i.include = v; }); break; }
    case 'rm': { mutate('remove_item', { p_item: id }, () => { d.items = d.items.filter(i => i.id !== id); if (d.quick) d.quick.items = d.quick.items.filter(i => i.id !== id); }); break; }
    case 'send': fillCart(el); break;
    case 'reopen': mutate('set_week_status', { p_week: w.id, p_status: 'pantry', p_who: S.who }, () => { w.status = 'pantry'; }); break;
    case 'ftag': { const k = el.dataset.key; S[k] = S[k].includes(id) ? S[k].filter(x => x !== id) : [...S[k], id]; render.force = true; render(); break; }
    case 'fclear': S[el.dataset.key] = []; render.force = true; render(); break;
    case 'openRecipe': openRecipe(id); break;
    case 'seg': S.seg = el.dataset.seg; render.force = true; render(); break;
    case 'tagFilter': ev.preventDefault(); ev.stopPropagation(); S.filter = { k: 'tag', id }; updateRecipeList(); listTop(); break;
    case 'seeAll': S.filter = JSON.parse(el.dataset.f); updateRecipeList(); listTop(); break;
    case 'clearFilter': S.filter = null; updateRecipeList(); break;
    case 'qclear': S.q = ''; updateRecipeList(); { const i = $('#rsearch'); if (i) { i.value = ''; i.focus(); } } break;
    case 'sortMenu': sortMenu(); break;
    case 'editTime': S.detail.editTime = true; S.detail.timeDraft = null; render.force = true; render(); setTimeout(() => { const i = $('#timeForm input'); if (i) { i.focus(); i.select(); } }, 30); break;
    case 'cancelTime': S.detail.editTime = false; render.force = true; render(); break;
    case 'closeRecipe': S.detail = null; render.force = true; render(); window.scrollTo(0, 0); break;
    case 'tagEdit': S.detail.tagEdit = !S.detail.tagEdit; render.force = true; render(); break;
    case 'toggleTag': { const r = d.recipes.find(x => x.id === S.detail.id); const on = !(r.tags || []).includes(id);
      mutate('set_recipe_tag', { p_recipe: r.id, p_tag: id, p_on: on, p_who: S.who }, () => { r.tags = on ? [...(r.tags || []), id] : r.tags.filter(x => x !== id); render.force = true; }); break; }
    case 'delNote': swipeAction('delNoteSwipe', id); break;
    case 'deleteRecipe': swipeAction('delRecipeSwipe', id); break;
    case 'menu': showMenu(); break;
    case 'addRecipe': openAddSheet(); break;
    case 'quickStart': { let qid = null; S.busy++; S.seq++;
      try { qid = await rpc('quick_start', { p_who: S.who }); } catch (e) { handleErr(e); } finally { S.busy--; }
      await refresh(true); render.force = true; render(); window.scrollTo(0, 0); break; }
    case 'quickSend': { const q = d.quick; let ok = false; el.disabled = true;
      await mutate('quick_send', { p_id: q.id, p_who: S.who }, () => { q.status = 'ready_for_cart'; q.sent_by = S.who; q.sent_at = new Date().toISOString(); }, () => { ok = true; });
      if (ok) { notifyAssistant('send_to_cart', { week_id: q.id }); toast('Quick order sent'); } break; }
    case 'quickReopen': mutate('quick_reopen', { p_id: d.quick.id }, () => { d.quick.status = 'picking'; }); break;
    case 'coverPick': pickCover(id); break;
    case 'quickDiscard': if (window.confirm('Discard this quick order?')) mutate('quick_discard', { p_id: d.quick.id }, () => { d.quick = null; }); break;
    case 'batch': S.batches[id] = Math.max(1, Math.min(12, (S.batches[id] || 1) + +el.dataset.d)); render(); break;
    case 'snackAdd': {
      const r = d.recipes.find(x => x.id === id), b = S.batches[id] || 1;
      const items = Ingredients.combine([{ picked: true, title: r.title, servings: (r.servings || 1) * b, base_servings: r.servings || 1, ingredients: r.ingredients || [] }])
        .map(({ name, qty, category, have_it }) => ({ name, qty, category, have_it }));
      let ok = false; el.disabled = true; el.textContent = 'Adding…';
      await mutate('basket_add_recipe', { p_recipe: id, p_batches: b, p_items: items, p_who: S.who }, null, () => { ok = true; });
      if (ok) { toast(`Added ${r.title} ×${b} to the basket`); S.tab = 'basket'; S.sub = null; render.force = true; render(); window.scrollTo(0, 0); }
      break; }
    case 'startOver': startOver(); break;
    case 'showRecipe': showRecipe(id); break;
    case 'clearStaples': clearStaples(id); break;
    case 'swipeDo': swipeAction(el.dataset.swipeAct, id, el); break;
    case 'restoreItems': { const ids = el.dataset.ids.split(',').map(Number);
      S.busy++; S.seq++; try { for (const x of ids) await rpc('set_item', { p_item: x, p_have_it: null, p_include: true, p_qty: null }); toast('Put back'); } catch (e) { handleErr(e); } finally { S.busy--; }
      await refresh(true); break; }
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
  if (f.id === 'addFormBasket') {
    ev.preventDefault();
    const fd = new FormData(f), name = fd.get('name').trim(); if (!name) return;
    document.activeElement && document.activeElement.blur();
    await mutate('basket_add_item', { p_name: name, p_qty: fd.get('qty'), p_category: fd.get('category'), p_who: S.who });
    toast('Added ' + name); render.force = true; render();
  } else if (f.id === 'orderSearch') { ev.preventDefault(); document.activeElement && document.activeElement.blur();
  } else if (f.id === 'addForm' || f.id === 'addFormQuick') {
    ev.preventDefault();
    const fd = new FormData(f), name = fd.get('name').trim(); if (!name) return;
    document.activeElement && document.activeElement.blur();
    await mutate('add_item', { p_week: f.id === 'addFormQuick' ? S.data.quick.id : S.data.week.id, p_name: name, p_qty: fd.get('qty'), p_category: fd.get('category'), p_who: S.who });
    toast('Added ' + name); render.force = true; render();
  } else if (f.id === 'timeForm') {
    ev.preventDefault();
    const t = new FormData(f).get('t').trim(); if (!t) return;
    document.activeElement && document.activeElement.blur();
    const rid = S.detail.id, r = S.data.recipes.find(x => x.id === rid);
    S.busy++; S.seq++;
    try { const saved = await rpc('set_recipe_time', { p_recipe: rid, p_time: t }); if (r) { r.total_time = saved; r.total_minutes = minutesOf(saved); } S.detail.editTime = false; S.detail.timeDraft = null; toast('Time saved: ' + saved); }
    catch (e) { handleErr(e); } finally { S.busy--; }
    render.force = true; render(); refresh(true);
  } else if (f.id === 'noteForm') {
    ev.preventDefault();
    const body = new FormData(f).get('body').trim(); if (!body) return;
    document.activeElement && document.activeElement.blur();
    const rid = S.detail.id; let ok = false;
    await mutate('add_recipe_note', { p_recipe: rid, p_body: body, p_who: S.who }, null, () => { ok = true; });
    if (ok) { f.reset(); delete S.noteDraft[rid]; toast('Note added'); await openRecipe(rid, true); }
  } else if (f.id === 'newTagForm') {
    ev.preventDefault();
    const name = new FormData(f).get('tag').trim().replace(/\s+/g, ' '); if (!name) return;
    document.activeElement && document.activeElement.blur();
    const rid = S.detail.id; let tid = null;
    S.busy++; S.seq++;
    try { tid = await rpc('create_tag', { p_name: name, p_who: S.who }); await rpc('set_recipe_tag', { p_recipe: rid, p_tag: tid, p_on: true, p_who: S.who }); toast('Tagged ' + name); }
    catch (e) { handleErr(e); } finally { S.busy--; }
    await refresh(true); render.force = true; render();
  } else if (f.id === 'urlForm') {
    ev.preventDefault();
    const url = new FormData(f).get('url').trim(), rtype = new FormData(f).get('rtype') || 'dinner';
    document.activeElement && document.activeElement.blur();
    closeSheet();
    await mutate('add_recipe_url', { p_url: url, p_who: S.who, p_type: rtype });
    toast('Added. Ingredients coming soon.'); render.force = true; render();
  }
});
function showMenu() {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet actions" role="dialog" aria-label="Menu"><div class="agroup"><div class="sheet-title">Signed in as ${esc(S.who)}</div>
    ${S.data && S.data.week ? '<button class="action" data-m="reset">Start this week over</button>' : ''}
    <button class="action" data-m="who">Switch person</button>
    <button class="action" data-m="out">Forget passcode on this phone</button></div>
    <button class="action cancel" data-m="close">Done</button></div>`;
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
  const other = recentOther();
  if (!(await confirmSheet({ title: 'Start this week over?', body: (other ? `${esc(other.who)} changed something ${ago(other.at)}. ` : '') + 'This clears all picks, pantry checks, staples and meal-plan days for this week.', ok: 'Start over', danger: true }))) return;
  let ok = false;
  await mutate('reset_week', { p_week: w.id }, () => {
    S.data.options.forEach(o => { o.picked = false; o.servings = 6; o.planned_date = null; }); S.data.items = []; w.status = 'picking'; w.sent_by = null; w.sent_at = null;
    S.data.plans = plans().filter(p => p.week_id !== w.id); S.mode = null; S.sel = null;
  }, () => { ok = true; });
  if (ok) { S.step = 0; S.open = {}; render.force = true; render(); window.scrollTo(0, 0); toast('Fresh start for this week'); }
}

/* ---------- add recipe: link or photos ---------- */
const PHOTO = { blobs: [] };
function closeSheet() { const el = document.querySelector('.sheet-bg.add'); if (el) el.remove(); PHOTO.blobs.forEach(b => URL.revokeObjectURL(b.url)); PHOTO.blobs = []; }
function openAddSheet(mode = 'choose') {
  let bg = document.querySelector('.sheet-bg.add');
  if (!bg) { bg = document.createElement('div'); bg.className = 'sheet-bg add'; document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); }); }
  if (mode === 'choose') bg.innerHTML = `<div class="sheet"><i class="grab"></i><h2 class="sheet-h">Add a recipe</h2>
      <div class="list menu-list"><button class="mrow" data-sheet="link">${IC.link}<span><b>Paste a link</b><small>From any recipe site</small></span>${IC.chev}</button>
      <button class="mrow" data-sheet="photo">${IC.camera}<span><b>Photo of a recipe</b><small>Cookbook page or recipe card</small></span>${IC.chev}</button></div>
      <button class="btn ghost" data-sheet="close">Cancel</button></div>`;
  if (mode === 'link') bg.innerHTML = `<div class="sheet"><i class="grab"></i><h2 class="sheet-h">Add by link</h2>
      <form id="urlForm" class="urlform"><div class="seg seg2" role="radiogroup" aria-label="Recipe type">
        <label><input type="radio" name="rtype" value="dinner" checked hidden><span>Dinner</span></label>
        <label><input type="radio" name="rtype" value="snack/baking" hidden><span>Snack or baking</span></label></div><input class="field" name="url" type="url" inputmode="url" placeholder="https://" aria-label="Recipe link" required autofocus>
      <button class="btn" type="submit">Add recipe</button></form>
      <button class="btn ghost" data-sheet="close">Cancel</button></div>`;
  if (mode === 'photo') { bg.innerHTML = `<div class="sheet tall"><i class="grab"></i><h2 class="sheet-h">Recipe from photos</h2>
      <p class="hint">Add every page, including any continuation. The assistant types it up.</p>
      <form id="photoTypeForm" onsubmit="return false"><div class="seg seg2" role="radiogroup" aria-label="Recipe type">
        <label><input type="radio" name="rtype" value="dinner" checked hidden><span>Dinner</span></label>
        <label><input type="radio" name="rtype" value="snack/baking" hidden><span>Snack or baking</span></label></div></form>
      <input class="field" id="photoTitle" placeholder="Recipe name (optional)" autocomplete="off">
      <div id="thumbs" class="thumbs"></div>
      <div class="btnrow">
        <label class="btn ghost small">Take photo<input type="file" accept="image/*" capture="environment" data-photo hidden></label>
        <label class="btn ghost small">Choose from library<input type="file" accept="image/*" multiple data-photo hidden></label>
      </div>
      <div class="err" id="photoErr"></div>
      <button class="btn" id="photoSave" data-sheet="savePhotos" disabled>Save recipe</button>
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
    <button type="button" data-rmphoto="${i}" aria-label="remove photo">${IC.x}</button></div>`).join('');
  t.querySelectorAll('[data-rmphoto]').forEach(x => x.onclick = () => { const [r] = PHOTO.blobs.splice(+x.dataset.rmphoto, 1); URL.revokeObjectURL(r.url); drawThumbs(); });
  const sv = $('#photoSave'); const n = PHOTO.blobs.length;
  sv.disabled = !n; sv.textContent = n ? `Save recipe · ${n} photo${n > 1 ? 's' : ''}` : 'Save recipe';
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
function pickCover(id) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) uploadCover(id, f); };
  inp.click();
}
async function uploadCover(id, file) {
  if (!S.detail || S.detail.id !== id) return;
  S.detail.coverBusy = true; render.force = true; render();
  try {
    const blob = await downscale(file, 1200);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/photo-upload`, { method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: S.code, count: 1, target: 'cover' }) });
    const body = await res.json();
    if (!res.ok) { const e = new Error(body.message || 'upload failed'); e.code = body.code; throw e; }
    const up = await fetch(body.uploads[0].upload_url, { method: 'PUT', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'image/jpeg' }, body: blob });
    if (!up.ok) throw new Error('photo failed to upload (' + up.status + ')');
    const url = await rpc('set_recipe_cover', { p_id: id, p_path: body.uploads[0].path, p_who: S.who });
    const lib = (S.data.recipes || []).find(x => x.id === id); if (lib) lib.image_url = url;
    toast('Photo added');
  } catch (e) { handleErr(e); }
  if (S.detail && S.detail.id === id) S.detail.coverBusy = false;
  render.force = true; render();
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
    closeSheet(); toast('Saved. The assistant will type it up.'); await refresh(true); render.force = true; render();
  } catch (e) {
    if (e.code === '28P01') { closeSheet(); return handleErr(e); }
    err.textContent = e.message; btn.disabled = false; drawThumbs();
  }
}

/* ---------- sync loop ---------- */
setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('focus', () => refresh());
setInterval(() => { if (!document.hidden) heartbeat(); }, 30000);
render();
if (S.code && S.who) refresh(true);

document.addEventListener('input', ev => { if (ev.target.closest('#noteForm') && S.detail) S.noteDraft[S.detail.id] = ev.target.value; });

// "Clear all" on the Staples step / Quick order staples: every staple and custom item → Skip, with Undo (no confirm)
function clearAllBtn(orderId, items) {
  const on = (items || []).filter(i => i.source !== 'recipe' && i.include).length;
  return !locked() && orderId && on ? `<button class="hdrbtn" data-act="clearStaples" data-id="${orderId}">Clear all</button>` : '';
}
function clearStaples(orderId) {
  const isQuick = S.data.quick && S.data.quick.id === orderId;
  const list = d => isQuick ? ((d.quick && d.quick.id === orderId && d.quick.items) || []) : (d.week && d.week.id === orderId ? d.items || [] : []);
  const n = list(S.data).filter(i => i.source !== 'recipe' && i.include).length;
  deferAction(`Cleared ${n} staple${n === 1 ? '' : 's'}`, d => list(d).forEach(i => { if (i.source !== 'recipe') i.include = false; }),
    () => rpc('clear_staples', { p_week: orderId }));
}

/* ---------- undoable actions: hidden right away, committed after 5 s unless Undo is tapped ---------- */
const UNDO_MS = 5000;
function deferAction(label, apply, commit) {
  flushPending();
  S.pend = { label, apply, commit };
  apply(S.data); render.force = true; render();
  showUndo(label);
  S.pend.timer = setTimeout(flushPending, UNDO_MS);
}
async function flushPending() {
  const p = S.pend; if (!p) return;
  S.pend = null; clearTimeout(p.timer); hideUndo();
  S.busy++; S.seq++;
  try { await p.commit(); } catch (e) { handleErr(e); } finally { S.busy--; }
  await refresh(true);
  if (p.after) p.after();
}
function undoPending() {
  const p = S.pend; if (!p) return;
  S.pend = null; clearTimeout(p.timer); hideUndo(); toast('Undone');
  if (p.undo) p.undo();
  refresh(true).then(() => { render.force = true; render(); });
}
function showUndo(label) {
  let u = $('#undo');
  if (!u) { u = document.createElement('div'); u.id = 'undo'; u.setAttribute('role', 'status'); document.body.appendChild(u);
    u.addEventListener('click', e => { if (e.target.closest('button')) undoPending(); }); }
  u.innerHTML = `<span>${esc(label)}</span><button type="button">Undo</button><i style="animation-duration:${UNDO_MS}ms"></i>`;
  u.classList.toggle('high', !!document.querySelector('.actionbar'));
  u.classList.remove('show'); void u.offsetWidth; u.classList.add('show');
}
function hideUndo() { const u = $('#undo'); if (u) u.classList.remove('show'); }
// closing or backgrounding the app commits right away (rpc uses keepalive)
window.addEventListener('pagehide', flushPending);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushPending(); });

function findItem(d, id) { return [...(d.items || []), ...((d.quick && d.quick.items) || []), ...((d.basket && d.basket.items) || [])].find(i => i.id === id); }
function dropItem(d, id) { d.items = (d.items || []).filter(i => i.id !== id); if (d.basket) d.basket.items = (d.basket.items || []).filter(i => i.id !== id); if (d.quick) d.quick.items = (d.quick.items || []).filter(i => i.id !== id); }
async function swipeAction(act, id, el) {
  closeSwipe(SW.open, true);
  const d = S.data;
  if (act === 'skipItem') { const i = findItem(d, id); if (!i) return;
    deferAction(`Removed ${i.name}`, dd => { const x = findItem(dd, id); if (x) x.include = false; },
      () => rpc('set_item', { p_item: id, p_have_it: null, p_include: false, p_qty: null })); }
  else if (act === 'delItem') { const i = findItem(d, id); if (!i) return;
    deferAction(`Deleted ${i.name}`, dd => dropItem(dd, id), () => rpc('remove_item', { p_item: id })); }
  else if (act === 'unschedule') { const w = +((el && el.dataset.week) || (S.sel && S.sel.w) || 0);
    const p = plans().find(x => x.week_id === w), m = p && p.meals.find(x => x.recipe_id === id); if (!m) return;
    deferAction(`${m.title} moved to Not scheduled`, dd => { const pp = (dd.plans || []).find(x => x.week_id === w), mm = pp && pp.meals.find(x => x.recipe_id === id); if (mm) mm.planned_date = null; },
      () => rpc('set_plan_day', { p_week: w, p_recipe: id, p_date: null, p_who: S.who })); }
  else if (act === 'delNoteSwipe') { const rid = S.detail && S.detail.id; if (!rid) return;
    const hide = () => { if (S.detail && S.detail.r && S.detail.id === rid) S.detail.r.notes = (S.detail.r.notes || []).filter(n => n.id !== id); };
    deferAction('Note deleted', dd => { hide(); const r = (dd.recipes || []).find(x => x.id === rid); if (r) { r.note_count = Math.max(0, (r.note_count || 1) - 1); } },
      () => rpc('delete_recipe_note', { p_note: id }));
    S.pend.after = () => { if (S.detail && S.detail.id === rid) openRecipe(rid, true); };
    S.pend.undo = () => { if (S.detail && S.detail.id === rid) openRecipe(rid, true); }; }
  else if (act === 'delRecipeSwipe') { const r = (d.recipes || []).find(x => x.id === id); if (!r) return;
    if (!(await confirmSheet({ title: `Delete “${esc(r.title)}”?`, body: 'It disappears from the library, from this week\'s options (if it hasn\'t been sent yet) and from future suggestions. You can undo for a few seconds.', ok: 'Delete recipe', danger: true }))) return;
    const wasDetail = S.detail && S.detail.id === id;
    deferAction(`Deleted ${r.title}`, dd => { dd.recipes = (dd.recipes || []).filter(x => x.id !== id);
        if (!['ready_for_cart', 'carted'].includes(dd.week && dd.week.status)) dd.options = (dd.options || []).filter(o => o.recipe_id !== id);
        if (S.detail && S.detail.id === id) S.detail = null; },
      () => rpc('delete_recipe', { p_recipe: id, p_who: S.who }));
    S.pend.undo = () => { if (wasDetail) openRecipe(id); };
    if (wasDetail) window.scrollTo(0, 0); }
}

/* ---------- swipe left on rows (touch only; mouse keeps click/drag) ---------- */
const EDGE = 20, BTN_W = 96;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function swipeWrap(inner, { act, id, label, full = true, cls = '', extra = '' }) {
  return `<div class="swipe ${cls}" data-swipe="${act}" data-id="${id}" data-full="${full ? 1 : 0}" ${extra}>
    <div class="swipe-under" aria-hidden="true"><button class="swipe-btn" tabindex="-1" data-act="swipeDo" data-swipe-act="${act}" data-id="${id}" ${extra}>${label}</button></div>
    <div class="swipe-row">${inner}</div></div>`;
}
function setTx(sw, x, animate) {
  const row = sw.querySelector('.swipe-row'); if (!row) return;
  row.style.transition = animate && !reduced() ? 'transform .22s cubic-bezier(.2,.8,.2,1)' : 'none';
  row.style.transform = x ? `translate3d(${x}px,0,0)` : '';
  sw.classList.toggle('revealed', x < 0);
  sw.style.setProperty('--sx', Math.min(1, -x / BTN_W));
}
function closeSwipe(sw, quiet) {
  if (!sw) return; setTx(sw, 0, true); if (SW.open === sw) SW.open = null;
  if (!quiet) setTimeout(() => { if (!SW.open && !SW.el) { render.force = true; render(); } }, 260);
}
document.addEventListener('pointerdown', e => {
  SW.suppress = false;
  if (e.pointerType === 'mouse') return;
  if (SW.open && !SW.open.contains(e.target)) { closeSwipe(SW.open); SW.suppress = true; return; }  // tap elsewhere just closes
  const sw = e.target.closest('.swipe');
  if (!sw || e.clientX < EDGE || e.target.closest('input,textarea,select,.swipe-under')) return;   // left edge = Safari back gesture
  SW.el = sw; SW.x0 = e.clientX; SW.y0 = e.clientY; SW.axis = null; SW.base = sw === SW.open ? -BTN_W : 0; SW.tx = SW.base;
}, true);
document.addEventListener('pointermove', e => {
  if (!SW.el || e.pointerType === 'mouse') return;
  const dx = e.clientX - SW.x0, dy = e.clientY - SW.y0;
  if (!SW.axis) { if (Math.hypot(dx, dy) < 8) return; SW.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; if (SW.axis === 'y') { SW.el = null; return; } }
  const w = SW.el.offsetWidth, full = SW.el.dataset.full === '1';
  let x = SW.base + dx;
  if (x > 0) x = x / 4;                                         // resist swiping right
  const max = full ? -w : -BTN_W;
  if (x < max) x = max + (x - max) / 4;                          // rubber band past the end
  SW.tx = x; setTx(SW.el, x, false);
  SW.el.classList.toggle('commit', full && x < -w * 0.55);
}, true);
function endSwipe(e, cancelled) {
  const sw = SW.el; if (!sw) return; SW.el = null;
  if (SW.axis !== 'x') return;
  SW.suppress = true; setTimeout(() => { SW.suppress = false; }, 450);   // a swipe isn't a tap
  const w = sw.offsetWidth, full = sw.dataset.full === '1';
  sw.classList.remove('commit');
  if (!cancelled && full && SW.tx < -w * 0.55) {                 // full swipe commits
    setTx(sw, -w, true); SW.open = null;
    setTimeout(() => swipeAction(sw.dataset.swipe, +sw.dataset.id, sw), reduced() ? 0 : 200);
  } else if (!cancelled && SW.tx < -BTN_W / 2) {                 // partial: leave the red button showing
    if (SW.open && SW.open !== sw) closeSwipe(SW.open, true);
    setTx(sw, -BTN_W, true); SW.open = sw;
    const b = sw.querySelector('.swipe-btn'); if (b) b.tabIndex = 0;
  } else closeSwipe(sw);
}
document.addEventListener('pointerup', e => endSwipe(e, false), true);
document.addEventListener('pointercancel', e => { if (SW.el && SW.axis === 'x') endSwipe(e, false); else SW.el = null; }, true);
// swallow the click that follows a swipe or a tap-to-close
document.addEventListener('click', e => { if (SW.suppress) { SW.suppress = false; if (!e.target.closest('.swipe-under')) { e.stopPropagation(); e.preventDefault(); } } }, true);
// tapping an open row's own content closes it
document.addEventListener('click', e => { const sw = e.target.closest('.swipe'); if (SW.open && sw === SW.open && !e.target.closest('.swipe-under')) { e.stopPropagation(); e.preventDefault(); closeSwipe(sw); } }, true);

/* ---------- pull to refresh: re-fetch data + check for a new app version ---------- */
const PTR = { y0: null, x0: 0, pull: 0, axis: null, busy: false, TH: 70 };
function ptrEl() {
  let el = $('#ptr');
  if (!el) { el = document.createElement('div'); el.id = 'ptr'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<div class="ptr-spin">${Array.from({ length: 8 }, (_, i) => `<i style="transform:rotate(${i * 45}deg)"></i>`).join('')}</div>`; document.body.appendChild(el); }
  return el;
}
function ptrShow(pull, state) {
  const el = ptrEl(), wrap = $('.wrap'), p = Math.min(pull, 120);
  el.className = state || '';
  el.style.transform = `translate(-50%, ${Math.max(-50, p - 50)}px)`;
  el.style.opacity = Math.min(1, p / PTR.TH);
  el.style.setProperty('--ptr-p', Math.min(1, p / PTR.TH));
  if (wrap && !reduced()) { wrap.style.transition = state === 'release' ? 'transform .25s ease' : 'none'; wrap.style.transform = p ? `translateY(${p}px)` : ''; }
}
function sheetOpen() { return !!document.querySelector('.sheet-bg'); }
document.addEventListener('touchstart', e => {
  if (PTR.busy || e.touches.length !== 1 || window.scrollY > 0 || sheetOpen() || SW.open) { PTR.y0 = null; return; }
  PTR.y0 = e.touches[0].clientY; PTR.x0 = e.touches[0].clientX; PTR.axis = null; PTR.pull = 0;
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (PTR.y0 == null) return;
  const dy = e.touches[0].clientY - PTR.y0, dx = e.touches[0].clientX - PTR.x0;
  if (!PTR.axis) { if (Math.hypot(dx, dy) < 8) return; PTR.axis = dy > 0 && Math.abs(dy) > Math.abs(dx) && window.scrollY <= 0 ? 'pull' : 'none'; }
  if (PTR.axis !== 'pull') { PTR.y0 = null; return; }
  e.preventDefault();                                            // we own this gesture (stops Safari's overscroll)
  PTR.pull = dy < 0 ? 0 : 1.2 * Math.pow(dy, 0.85);              // iOS-style resistance
  ptrShow(PTR.pull, PTR.pull >= PTR.TH ? 'armed' : '');
}, { passive: false });
document.addEventListener('touchend', () => {
  if (PTR.y0 == null || PTR.axis !== 'pull') { PTR.y0 = null; return; }
  PTR.y0 = null;
  if (PTR.pull >= PTR.TH) pullRefresh(); else ptrShow(0, 'release');
}, { passive: true });
async function pullRefresh() {
  PTR.busy = true; ptrShow(PTR.TH, 'spinning release');
  const t0 = Date.now();
  await flushPending();
  const [, newer] = await Promise.all([refresh(true), checkVersion()]);
  await new Promise(r => setTimeout(r, Math.max(0, 600 - (Date.now() - t0))));   // let the spinner register
  if (newer) { toast('Updating the app…'); location.replace(location.pathname + '?v=' + newer + '&t=' + Date.now()); return; }
  ptrShow(0, 'release'); PTR.busy = false;
  if (S.detail) openRecipe(S.detail.id, true);
}
// compare the app.js?v=N on the live page with the one this page loaded (no service worker; GitHub Pages + cache-bust)
function loadedVersion() { const s = document.querySelector('script[src*="app.js"]'); const m = s && s.getAttribute('src').match(/[?&]v=(\d+)/); return m ? m[1] : null; }
async function checkVersion() {
  try {
    const txt = await (await fetch(location.pathname + '?vcheck=' + Date.now(), { cache: 'no-store' })).text();
    const m = txt.match(/app\.js\?v=(\d+)/), cur = loadedVersion();
    return m && cur && m[1] !== cur ? m[1] : null;
  } catch (e) { return null; }
}

/* ======================= household basket, home timeline, orders, activity, presence ======================= */
const usd = n => '$' + Math.round(n);
function ago(ts) { const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : fmtWhen(ts); }
function fmtShort(ts) { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function backHome() { return `<button class="backlink" data-act="home">${IC.back}Home</button>`; }
function basket() { return (S.data && S.data.basket) || { items: [], weeks: [] }; }
function basketCounts() {
  const b = basket(), buy = (b.items || []).filter(i => i.include && !i.have_it);
  const unc = buy.filter(i => !i.carted_at), car = buy.filter(i => i.carted_at);
  return { b, buy, unc: unc.length, uncItems: unc, car: car.length, carItems: car, est: buy.reduce((t, i) => t + (+i.est || 4), 0) };
}
function itemGroup(i) { return i.source === 'recipe' && (i.recipes || []).length ? i.recipes[0].replace(/\s*\([^)]*\)\s*$/, '') : i.source === 'staple' ? 'Staples' : 'Extras'; }
function groupCounts(items) { const g = {}; items.forEach(i => { const k = itemGroup(i); g[k] = (g[k] || 0) + 1; }); return Object.entries(g).sort((a, b) => (a[0] === 'Extras') - (b[0] === 'Extras') || (a[0] === 'Staples') - (b[0] === 'Staples') || b[1] - a[1]); }
function cartIssue() {
  const b = basket(), ids = [b.id, ...(b.weeks || []).map(w => w.id)];
  return ((S.data && S.data.cart_status) || []).find(c => ids.includes(c.week_id) && ['blocked_retrying', 'partial', 'filling'].includes(c.status));
}
function isOwner() { const w = S.data.week; return !w || !w.owner || w.owner === S.who || (w.editors || []).includes(S.who); }
function mySuggestion(rid) { return (S.data.suggestions || []).find(x => x.recipe_id === rid && x.by === S.who); }
function recentOther() { return (S.data.activity || []).find(a => a.who !== S.who && a.source === 'app' && a.who !== 'Someone' && Date.now() - new Date(a.at) < 5 * 60000); }
function ownerNote() {
  const w = S.data.week; if (!w || locked()) return '';
  if (!isOwner()) return `<div class="note-row"><i class="sdot"></i><span>${esc(w.owner)} is planning this week. Your picks go to ${esc(w.owner)} as suggestions.</span><button class="linkbtn strong" data-act="askEdit">Ask to edit</button></div>`;
  const sugs = (S.data.suggestions || []).filter(x => x.by !== S.who);
  return sugs.length ? `<div class="group">Suggestions</div><div class="list">${sugs.map(x => `<div class="row"><div class="name"><b>${esc(x.title)}</b><span class="src">${esc(x.by)} suggests ${x.picked ? 'adding' : 'removing'} it · ${ago(x.at)}</span></div>
      <button class="toggle" data-act="sugAnswer" data-id="${x.recipe_id}" data-by="${esc(x.by)}" data-ok="0">Dismiss</button><button class="toggle on" data-act="sugAnswer" data-id="${x.recipe_id}" data-by="${esc(x.by)}" data-ok="1">Accept</button></div>`).join('')}</div>` : '';
}

/* presence: heartbeat every 30 s and on screen changes */
function screenName() {
  if (S.tab === 'recipes') return 'recipes';
  if (S.tab === 'basket') return S.sub ? 'orders' : 'basket';
  if (S.sub === 'flow') return ['pick', 'pantry', 'staples', 'list'][S.step || 0];
  return S.sub === 'plan' ? 'plan' : 'home';
}
function heartbeat() { if (!S.code || !S.who) return; S.hbAt = Date.now(); S.hbScreen = screenName(); rpc('heartbeat', { p_who: S.who, p_screen: S.hbScreen }).catch(() => {}); }
function heartbeatSoon() { if (S.hbScreen !== screenName() || !S.hbAt || Date.now() - S.hbAt > 30000) { clearTimeout(heartbeatSoon.t); heartbeatSoon.t = setTimeout(heartbeat, 400); } }
function presenceNote() {
  const others = ((S.data && S.data.presence) || []).filter(p => p.who !== S.who && Date.now() - new Date(p.at) < 75000);
  if (!others.length) return '';
  const say = { pick: 'is picking meals right now', pantry: 'is checking the pantry right now', staples: 'is going through staples right now', list: 'is looking at the list right now',
    basket: 'is in the basket right now', plan: 'is arranging the meal plan right now', recipes: 'is browsing recipes', orders: 'is looking at past orders', home: 'is in the app' };
  return others.map(p => `<div class="presence"><i class="live"></i>${esc(p.who)} ${say[p.screen] || 'is in the app'}</div>`).join('');
}

/* weekly rhythm (soft, never forced) */
const RHYTHM = { 4: [0, 'Thursday is for picking meals.'], 5: [1, 'Friday is for the pantry check and extras.'], 6: [2, 'Saturday is for filling the cart.'], 0: [3, 'Sunday is for checking out.'] };
function rhythmNote(steps) {
  const dow = new Date(new Date(S.data.server_time || Date.now()).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).getDay();
  const r = RHYTHM[dow]; if (!r || !steps[r[0]] || steps[r[0]].done) return '';
  return `<p class="rhythm">${r[1]}</p>`;
}

/* timeline steps derived from the week + basket */
function timeline() {
  const w = S.data.week, c = basketCounts(), b = c.b, issue = cartIssue();
  const weekItems = S.data.items || [], wkBasket = (weekItems.find(i => i.basket_id) || {}).basket_id;
  const ordered = w && wkBasket && wkBasket !== b.id;                   // this week's items went out with a placed order
  const n = w ? picked().length : 0;
  const st = w && w.status;
  const pickDone = !!w && (st !== 'picking' || ordered);
  const pantryDone = !!w && (['ready_for_cart', 'carted'].includes(st) || ordered);
  const fillDone = ordered || (c.buy.length > 0 && c.unc === 0 && !(issue && issue.status !== 'filling') && b.status !== 'ready_for_cart');
  return [
    { key: 'pick', title: 'Pick meals', day: 'Thu', done: pickDone, doneText: `${n} meal${n === 1 ? '' : 's'} picked${w && w.owner ? ' by ' + esc(w.owner) : ''}`,
      body: w ? (isOwner() ? `Choose this week’s dinners. ${n ? `${n} picked so far.` : 'Aim for three.'}` : `${esc(w.owner)} is planning. You can suggest meals.`) : 'Options show up here when they’re posted.',
      action: w ? `<button class="btn" data-act="flow" data-step="0">${n ? 'Keep picking' : 'Pick meals'}</button>` : '' },
    { key: 'pantry', title: 'Pantry and extras', day: 'Fri', done: pantryDone, doneText: 'Pantry checked',
      body: 'Mark what’s already in the kitchen, then go through staples and extras.',
      action: `<button class="btn" data-act="flow" data-step="${st === 'picking' ? 0 : 1}">${st === 'picking' ? 'Confirm portions first' : 'Check the pantry'}</button>` },
    { key: 'fill', title: 'Fill the cart', day: 'Sat', done: fillDone, doneText: `${c.car} item${c.car === 1 ? '' : 's'} in the QFC cart`,
      body: b.status === 'ready_for_cart' ? 'The assistant is filling the QFC cart now.' : issue && issue.status !== 'filling' ? 'Waiting on QFC. The status above shows what’s going on.' : c.unc ? `${c.unc} item${c.unc === 1 ? '' : 's'} aren’t in the cart yet.` : 'Nothing to add yet.',
      action: b.status === 'ready_for_cart' ? '<button class="btn" disabled>Filling…</button>' : c.unc ? `<button class="btn" data-act="fillCart">Fill cart · ${c.unc}</button><button class="btn ghost" data-act="basketTab">Review basket</button>` : `<button class="btn ghost" data-act="basketTab">Open basket</button>` },
    { key: 'checkout', title: 'Check out', day: 'Sun', done: !!ordered, doneText: `Ordered${S.data.last_order && S.data.last_order.ordered_by ? ' by ' + esc(S.data.last_order.ordered_by) : ''}`,
      body: 'Check out in the QFC app, then tap We ordered. Anything added after that goes to next week’s basket.',
      action: `<button class="btn" data-act="weOrdered" ${c.buy.length ? '' : 'disabled'}>We ordered</button>` },
  ];
}
function statusCard() {
  const c = basketCounts(), b = c.b, issue = cartIssue();
  let head, tone = 'info';
  if (!c.buy.length) { head = 'Nothing to order yet.'; tone = 'idle'; }
  else if (b.status === 'ready_for_cart') head = `Not yet. The cart is being filled with ${c.unc} item${c.unc === 1 ? '' : 's'}.`;
  else if (issue && issue.status !== 'filling') { head = 'Not yet. ' + (issue.message || 'QFC needs attention.'); tone = 'warn'; }
  else if (c.unc) head = `Not yet. ${c.unc} item${c.unc === 1 ? ' isn’t' : 's aren’t'} in the cart.`;
  else { head = 'Yes. Everything is in the QFC cart.'; tone = 'ok'; }
  const steps = timeline(), next = steps.find(s => !s.done);
  const groups = groupCounts(c.carItems);
  return `<section class="status ${tone}" aria-label="Order status">
    <div class="status-q">Can we order?</div><div class="status-a"><i class="sdot"></i>${esc(head)}</div>
    ${c.buy.length ? `<div class="status-grid">
      <div><div class="k">In the cart</div><div class="v num">${c.car}</div></div>
      <div><div class="k">Not yet</div><div class="v num">${c.unc}</div></div>
      <div><div class="k">Estimate</div><div class="v num">≈ ${usd(c.est)}</div></div></div>
      ${groups.length ? `<div class="status-groups">${groups.map(([k, n]) => `<span>${esc(k)} <b class="num">${n}</b></span>`).join('')}</div>` : ''}` : ''}
    <div class="status-next"><span>Next</span>${next ? esc(next.title) + (next.key === 'checkout' ? ' in the QFC app' : '') : 'Next week starts Thursday'}</div></section>`;
}
function homeView() {
  const steps = timeline(), cur = steps.findIndex(s => !s.done), done = steps.filter(s => s.done), w = S.data.week;
  const act = (S.data.activity || []).slice(0, 4);
  const curStep = steps[cur];
  return header('This week', w ? 'Week of ' + fmtDate(w.week_start) : '') + presenceNote() + rhythmNote(steps) + statusCard()
    + (curStep ? `<section class="now" aria-label="Current step"><div class="now-k">Step ${cur + 1} of 4 · ${curStep.day}</div><h2>${curStep.title}</h2><p>${curStep.body}</p><div class="now-actions">${curStep.action}</div></section>`
      : `<section class="now done"><div class="now-k">All set</div><h2>Ordered</h2><p>This week’s groceries are on the way. Anything you add now goes to next week’s basket.</p><div class="now-actions"><button class="btn ghost" data-act="basketTab">Start next week’s basket</button></div></section>`)
    + `<ol class="steps-list">${steps.map((s, i) => i === cur ? '' : `<li class="${s.done ? 'done' : 'todo'}">${s.done ? IC.check : `<span class="n">${i + 1}</span>`}<span class="t">${s.title}</span><span class="d">${s.done ? s.doneText : s.day}</span></li>`).join('')}</ol>`
    + `<div class="list menu-list home-links">${plans().length ? `<button class="mrow" data-act="planView">${IC.week}<span><b>Meal plan</b><small>Which night for which meal</small></span>${IC.chev}</button>` : ''}
        ${w ? `<button class="mrow" data-act="flow" data-step="${defaultStep()}">${IC.book}<span><b>Picks and list</b><small>Week of ${fmtDate(w.week_start)}</small></span>${IC.chev}</button>` : ''}
        <button class="mrow" data-act="orders">${IC.bag}<span><b>Orders</b><small>Past orders, search, reorder</small></span>${IC.chev}</button></div>`
    + `<div class="h2row subhead-row"><h3 class="subhead">Activity</h3><button class="hdrbtn" data-act="activity">See all</button></div>
       <div class="list">${act.length ? act.map(activityRow).join('') : '<div class="row"><div class="name"><span class="src">Nothing yet. Changes from both of you and the assistant show up here.</span></div></div>'}</div>`;
}

/* basket tab */
function basketView() {
  const c = basketCounts(), b = c.b, items = b.items || [];
  const live = items.filter(i => i.include && !i.have_it), skipped = items.filter(i => !(i.include && !i.have_it));
  const groups = {}; live.forEach(i => (groups[itemGroup(i)] ||= []).push(i));
  const order = Object.keys(groups).sort((a, z) => (a === 'Extras') - (z === 'Extras') || (a === 'Staples') - (z === 'Staples') || a.localeCompare(z));
  const sub = c.buy.length ? `${c.buy.length} item${c.buy.length === 1 ? '' : 's'} · ≈ ${usd(c.est)} est.` : 'Empty';
  const row = i => { const who = i.added_by && i.added_by !== 'staples' ? `${esc(i.added_by)} · ${fmtWhen(i.created_at)}` : i.source === 'staple' ? 'Staple' : '';
    const r = `<div class="row ${i.carted_at ? 'carted' : ''}"><div class="name"><b>${esc(i.name)}</b><span class="src">${[i.qty && esc(i.qty), who].filter(Boolean).join(' · ')}</span></div>
      ${i.carted_at ? '<span class="incart">In cart</span>' : `<button class="toggle add on" data-act="inc" data-id="${i.id}" aria-pressed="true">Buy</button>`}</div>`;
    return !i.carted_at && i.source === 'custom' ? swipeWrap(r, { act: 'delItem', id: i.id, label: 'Delete' }) : !i.carted_at ? swipeWrap(r, { act: 'skipItem', id: i.id, label: 'Remove' }) : r; };
  return header('Basket', sub, `<button class="hdrbtn" data-act="orders">Orders</button>`) + presenceNote()
    + `<p class="hint">One basket for the next delivery. Meals, staples and extras all land here, and either of you can add anytime.</p>`
    + addItemForm('addFormBasket', 'Add to the basket')
    + (order.length ? order.map(g => `<div class="group">${esc(g)} · ${groups[g].length}</div><div class="list">${groups[g].map(row).join('')}</div>`).join('')
      : `<div class="empty"><p><b>The basket is empty</b>Add an item above, pick meals, or add a snack recipe.</p></div>`)
    + (skipped.length ? `<details class="skipped"><summary>Skipped or already at home · ${skipped.length}</summary><div class="list">${skipped.map(i => `<div class="row dim"><div class="name"><b>${esc(i.name)}</b><span class="src">${esc(itemGroup(i))}</span></div>
        ${i.include ? '' : `<button class="toggle add" data-act="inc" data-id="${i.id}">Add back</button>`}</div>`).join('')}</div></details>` : '');
}
function basketActionBar() {
  const c = basketCounts(); if (!c.buy.length) return '';
  if (c.b.status === 'ready_for_cart') return `<div class="actionbar"><div class="inner"><button class="btn" disabled>Filling the cart…</button></div></div>`;
  return `<div class="actionbar"><div class="inner">${c.unc ? `<button class="btn" data-act="fillCart">Fill cart · ${c.unc} new</button>` : `<button class="btn" data-act="weOrdered">We ordered</button>`}</div></div>`;
}
async function fillCart(el) {
  const c = basketCounts(); if (!c.unc) return toast('Everything is already in the cart');
  const other = recentOther();
  if (other && !(await confirmSheet({ title: 'Fill the cart now?', body: `${esc(other.who)} changed something ${ago(other.at)}. ${c.unc} item${c.unc === 1 ? '' : 's'} will be added to the QFC cart.`, ok: 'Fill cart' }))) return;
  if (el) el.disabled = true;
  let n = 0;
  await mutate('basket_send', { p_who: S.who }, () => { c.b.status = 'ready_for_cart'; }, r => { n = r; });
  if (n) { notifyAssistant('send_to_cart', { week_id: c.b.id }); toast(`Sent ${n} item${n === 1 ? '' : 's'}. The cart gets filled next.`); }
}
async function weOrdered() {
  const c = basketCounts(), other = recentOther();
  const body = (other ? `${esc(other.who)} changed something ${ago(other.at)}. ` : '') + (c.unc ? `${c.unc} item${c.unc === 1 ? ' isn’t' : 's aren’t'} in the cart yet and will stay behind. ` : '')
    + 'This locks the order. Anything added after this goes to next week’s basket.';
  if (!(await confirmSheet({ title: 'Mark this order as placed?', body, ok: 'We ordered' }))) return;
  let ok = false; await mutate('mark_ordered', { p_who: S.who }, null, () => { ok = true; });
  if (ok) { toast('Ordered. A fresh basket is ready.'); S.orders = null; }
}

/* activity */
const nameList = a => { const ns = (a.names || []).map(esc); return ns.length <= 2 ? ns.join(' and ') : `${ns.slice(0, 2).join(', ')} and ${a.n - 2} more`; };
function activityText(a) {
  const d = a.detail || {}, N = nameList(a), cnt = a.n > 1 ? `${a.n} items` : N;
  const day = x => x ? dayName(x) + ' ' + fmtDate(x) : '';
  const T = {
    pick: `picked ${N}`, unpick: `removed ${N} from the picks`, servings: `set ${N} to ${d.to} servings`, plan_day: d.to ? `moved ${N} to ${day(d.to)}` : `unscheduled ${N}`,
    'item.add': `added ${N}`, 'item.remove': `removed ${N}`, 'item.have': `has ${N} at home`, 'item.need': `needs ${N} after all`, 'item.skip': `skipped ${N}`, 'item.buy': `will buy ${N}`,
    'item.qty': `changed ${N} to ${esc(d.to || '')}`, 'item.carted': `put ${a.n} item${a.n === 1 ? '' : 's'} in the QFC cart`,
    'week.status': d.kind === 'basket' ? ({ ready_for_cart: 'asked to fill the cart', carted: 'finished filling the cart', picking: 'reopened the basket' }[d.to] || `set the basket to ${d.to}`)
      : ({ ready_for_cart: 'sent the week to the cart', pantry: 'moved the week to the pantry check', carted: 'marked the week as carted', picking: 'reopened picking' }[d.to] || `set the order to ${d.to}`),
    'basket.ordered': 'marked the order as placed', 'week.owner': `is planning this week`, 'week.edit_override': 'asked to edit the picks',
    'recipe.add': `added the recipe ${N}`, 'recipe.delete': `deleted ${N}`, 'recipe.restore': `restored ${N}`, 'recipe.time': `set ${N} to ${esc(d.to || '')}`, 'recipe.photo': `changed the photo of ${N}`,
    'recipe.import': `imported ${N}`, 'note.add': `added a note to ${N}`, 'note.delete': `deleted a note on ${N}`, 'tag.on': `tagged ${N}`, 'tag.off': `untagged ${N}`,
    'cart.status': ({ filling: `is filling the cart${d.total ? ` (${d.added || 0} of ${d.total})` : ''}`, blocked_retrying: `hit a QFC problem${d.message ? ': ' + esc(d.message) : ''}`,
      partial: `filled the cart except a few items${d.message ? ': ' + esc(d.message) : ''}`, done: 'filled the cart' }[d.status] || 'updated the cart'),
    'week.confirm': `confirmed portions (${d.n || 0} ingredients)`, 'week.reset': 'started the week over', 'basket.recipe': `added ${esc(d.title || '')} ×${d.batches || 1} to the basket`,
    'basket.reorder': `reordered ${d.n ?? ''} items from order #${d.from}`, 'pick.suggest': `suggested ${d.picked ? 'adding' : 'removing'} ${N}`,
    'pick.accept': `accepted ${esc(d.by || '')}’s suggestion: ${N}`, 'pick.dismiss': `passed on ${esc(d.by || '')}’s suggestion: ${N}`,
    undo: `undid a change${a.names && a.names.length ? ' to ' + N : ''}`,
  };
  return T[a.kind] || `${a.kind.replace(/[._]/g, ' ')} ${cnt}`;
}
function activityRow(a, withUndo) {
  return `<div class="row act ${a.undone_at ? 'undone' : ''}"><div class="name"><b><span class="who-n">${esc(a.who || 'Someone')}</span> ${activityText(a)}</b>
    <span class="src">${ago(a.at)}${a.undone_at ? ` · undone by ${esc(a.undone_by || '?')}` : ''}</span></div>
    ${withUndo && a.undoable ? `<button class="toggle" data-undo="${a.id}">Undo</button>` : ''}</div>`;
}
function activitySheet() {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  const draw = () => { const list = S.data.activity || [];
    bg.innerHTML = `<div class="sheet tall" role="dialog" aria-label="Activity"><i class="grab"></i><h2 class="sheet-h">Activity</h2>
      <p class="hint">Everything either of you or the assistant changed this week. Changes from the last 24 hours can be undone.</p>
      <div class="list">${list.length ? list.map(a => activityRow(a, true)).join('') : '<div class="row"><div class="name"><span class="src">Nothing yet.</span></div></div>'}</div>
      <button class="btn ghost" data-close>Done</button></div>`; };
  draw();
  bg.onclick = async e => {
    if (e.target === bg || e.target.hasAttribute('data-close')) return bg.remove();
    const u = e.target.closest('[data-undo]'); if (!u) return;
    u.disabled = true; u.textContent = '…';
    try { await rpc('undo_activity', { p_id: +u.dataset.undo, p_who: S.who }); toast('Undone'); } catch (err) { handleErr(err); }
    await refresh(true); render.force = true; render(); draw();
  };
  document.body.appendChild(bg);
}

/* orders history */
const ORDER_STATUS = { picking: 'Building', ready_for_cart: 'Building', carted: 'In cart', ordered: 'Ordered', delivered: 'Delivered', canceled: 'Canceled' };
async function openOrders() {
  S.tab = 'basket'; S.sub = 'orders'; render.force = true; render(); window.scrollTo(0, 0);
  try { S.orders = await rpc('get_orders'); } catch (e) { handleErr(e); }
  render.force = true; render();
}
function orderLabel(o) {
  const st = o.status === 'picking' && (o.items || []).some(i => i.carted_at) ? 'carted' : o.status;
  return ORDER_STATUS[st] || st;
}
function orderDate(o) { return o.ordered_at || o.sent_at || o.created_at; }
function orderMatches(o, q) {
  if (!q) return null;
  const w = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (o.items || []).filter(i => w.every(x => (i.name + ' ' + (i.recipes || []).join(' ')).toLowerCase().includes(x)));
  const meals = (o.meals || []).filter(m => w.every(x => m.toLowerCase().includes(x)));
  return hit.length || meals.length ? { hit, meals } : false;
}
function ordersView() {
  const list = S.orders;
  const back = `<button class="backlink" data-act="backBasket">${IC.back}Basket</button>`;
  if (!list) return back + header('Orders') + '<p class="hint">Loading…</p>';
  const q = S.oq.trim(), rows = list.map(o => ({ o, m: orderMatches(o, q) })).filter(x => !q || x.m);
  const last = q && rows.find(x => x.o.status !== 'canceled');
  return back + header('Orders', `${list.length} order${list.length === 1 ? '' : 's'}`)
    + `<form id="orderSearch" class="searchrow"><label class="search">${IC.search}<input id="osearch" type="search" placeholder="Search items or meals, e.g. fennel" value="${esc(S.oq)}" aria-label="Search orders" autocomplete="off"></label></form>`
    + (q ? `<p class="hint">${last ? `Last bought ${fmtShort(orderDate(last.o))}: ${esc([...last.m.hit.map(i => i.name + (i.qty ? ` (${i.qty})` : '')), ...last.m.meals].slice(0, 3).join(', '))}` : `No orders with “${esc(q)}”.`}</p>` : '')
    + `<div class="glist orders">${rows.map(({ o, m }) => `<button class="rcard order-row" data-act="openOrder" data-id="${o.id}">
        <div class="rc-top"><div class="card-title">${fmtShort(orderDate(o))} <span class="ost s-${esc(orderLabel(o).toLowerCase().replace(' ', ''))}">${orderLabel(o)}</span></div>${IC.chev}</div>
        <div class="meta"><span class="num">${o.items.length} items</span><span class="num">≈ ${usd(o.est)}</span>${o.sent_by ? `<span>Sent by ${esc(o.sent_by)}</span>` : ''}${o.ordered_by ? `<span>Ordered by ${esc(o.ordered_by)}</span>` : ''}</div>
        ${(o.meals || []).length ? `<div class="desc">${o.meals.map(esc).join(' · ')}</div>` : ''}
        ${m && m.hit.length ? `<div class="pills">${m.hit.slice(0, 4).map(i => `<span class="pill trial">${esc(i.name)}</span>`).join('')}</div>` : ''}</button>`).join('')}</div>`;
}
function orderView() {
  const o = (S.orders || []).find(x => x.id === S.orderId);
  const back = `<button class="backlink" data-act="backOrders">${IC.back}Orders</button>`;
  if (!o) return back + '<p class="hint">Order not found.</p>';
  const groups = {}; o.items.forEach(i => (groups[itemGroup(i)] ||= []).push(i));
  const isCurrent = o.id === basket().id;
  const tl = [{ at: o.created_at, t: 'Basket started' }, ...(o.includes || []).filter(x => x.sent_at).map(x => ({ at: x.sent_at, t: `${x.kind === 'quick' ? 'Quick order #' + x.id : 'Week of ' + fmtDate(x.week_start)} sent to cart by ${esc(x.sent_by || '?')}` })),
    ...(o.timeline || []).map(a => ({ at: a.at, t: `${esc(a.who || '')} ${activityText({ ...a, names: [], n: a.n || 1 })}` })),
    o.ordered_at && { at: o.ordered_at, t: `Ordered by ${esc(o.ordered_by || '?')}` }, o.delivered_at && { at: o.delivered_at, t: 'Delivered' }, o.canceled_at && { at: o.canceled_at, t: 'Canceled' }]
    .filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at));
  const inc = (o.includes || []).map(x => x.kind === 'quick' ? `Quick order #${x.id}` : `Week of ${fmtDate(x.week_start)} plan`);
  return back + header(fmtShort(orderDate(o)), `${orderLabel(o)} · ${o.items.length} items · ≈ ${usd(o.est)} est.`)
    + (inc.length ? `<p class="hint">Includes ${inc.join(' and ')}.</p>` : '')
    + `<div class="btnrow order-actions">${isCurrent ? `<button class="btn ghost" data-act="backBasket">Open in basket</button>` : `<button class="btn" data-act="reorder" data-id="${o.id}">Reorder</button>`}
        ${o.status === 'ordered' ? `<button class="btn ghost" data-act="orderStatus" data-id="${o.id}" data-status="delivered">Mark delivered</button>` : ''}</div>`
    + Object.keys(groups).sort((a, z) => (a === 'Extras') - (z === 'Extras') || (a === 'Staples') - (z === 'Staples') || a.localeCompare(z)).map(g => `<div class="group">${esc(g)} · ${groups[g].length}</div>
        <div class="list">${groups[g].map(i => `<div class="row"><div class="name"><b>${esc(i.name)}</b><span class="src">${[i.qty && esc(i.qty), i.added_by && i.added_by !== 'staples' && 'Added by ' + esc(i.added_by)].filter(Boolean).join(' · ')}</span></div>${i.carted_at ? '<span class="incart">In cart</span>' : ''}</div>`).join('')}</div>`).join('')
    + `<h3 class="subhead">Timeline</h3><ol class="otl">${tl.map(x => `<li><span class="d">${fmtWhen(x.at)}</span>${x.t}</li>`).join('')}</ol>`
    + (o.status === 'ordered' ? `<div class="center"><button class="linkbtn quiet" data-act="orderStatus" data-id="${o.id}" data-status="canceled">Mark as canceled</button></div>` : '');
}
async function reorder(id, el) {
  el.disabled = true; let n = 0;
  await mutate('reorder', { p_order: id, p_who: S.who }, null, r => { n = r; });
  toast(`Added ${n} item${n === 1 ? '' : 's'} to the basket`); S.tab = 'basket'; S.sub = null; S.orders = null; render.force = true; render(); window.scrollTo(0, 0);
}
async function orderStatus(id, status) {
  if (status === 'canceled' && !(await confirmSheet({ title: 'Mark this order as canceled?', body: 'Use this if the QFC order was canceled. Items stay in the history.', ok: 'Mark canceled', danger: true }))) return;
  await mutate('set_order_status', { p_order: id, p_status: status, p_who: S.who });
  S.orders = await rpc('get_orders').catch(() => S.orders); render.force = true; render();
}
document.addEventListener('input', ev => { if (ev.target.id === 'osearch') { S.oq = ev.target.value; const pos = ev.target.selectionStart; render.force = true; render(); const i = $('#osearch'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } } });
