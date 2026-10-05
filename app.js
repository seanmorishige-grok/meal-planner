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
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT') && app.contains(ae) && S.data && !render.force) return;
  render.force = false;
  if (!S.code || !S.who) { app.innerHTML = loginView(); return bindLogin(); }
  if (!S.data) { app.innerHTML = '<div class="boot">🥕</div>'; return; }
  const body = S.tab === 'recipes' ? recipesView() : S.tab === 'quick' ? quickView() : weekView();
  app.innerHTML = `<div class="wrap">${body}
    <div class="sync">${S.error ? esc(S.error) : S.lastSync ? 'Synced ' + S.lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''}</div></div>
    ${S.tab === 'week' ? actionBar() : S.tab === 'quick' ? quickActionBar() : ''}
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
  return `<h2>Pick this week's meals</h2><p class="hint">${msg}${pickedNames ? `<br><b style="color:var(--accent-dark)">✓ ${pickedNames}</b>` : ''}</p>` + opts.map(o => {
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
  }).join('') + moreBtn + `<div style="text-align:center;margin-top:14px"><button class="linkbtn" data-act="startOver" style="color:var(--muted);font-weight:500">↺ Start over</button></div>`;
}

// "(for Bolognese, Piccata)" / "(staple)" / "(added by Sean)" shown after an item's name
function srcLabel(i, kind) {
  if (i.source === 'recipe') return i.recipes && i.recipes.length ? `for ${i.recipes.join(', ')}` : '';
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
function snackCard(r) {
  const b = S.batches[r.id] || 1;
  return `<div class="rcard"><span class="badge b-${esc(r.status)}">${esc(r.status)}</span> <span class="badge b-snack">Snack/baking</span>
    <div class="card-title" style="margin-top:6px">${esc(r.title)}</div>
    <div class="meta"><span>⏱ ${esc(r.total_time || '?')}</span><span>Makes ${r.servings || '?'} per batch</span>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Recipe ↗</a>` : ''}</div>
    <div class="serv"><div class="serv-label">Batches</div>
      <div class="stepper"><button data-act="batch" data-id="${r.id}" data-d="-1" aria-label="fewer batches">−</button><span>${b}</span><button data-act="batch" data-id="${r.id}" data-d="1" aria-label="more batches">+</button></div></div>
    <button class="btn small" data-act="snackAdd" data-id="${r.id}" ${(r.ingredients || []).length ? '' : 'disabled'}>🛒 Add ingredients to order</button></div>`;
}
function recipesView() {
  const all = S.data.recipes || [];
  const snacks = all.filter(r => r.recipe_type === 'snack/baking' && r.status !== 'pending' && r.status !== 'retired');
  const rs = all.filter(r => !snacks.includes(r));
  return header('Recipes', `${all.filter(r => r.status !== 'pending').length} in the library`) + `
    <button class="btn" data-act="addRecipe" style="margin:0 0 18px">➕ Add recipe</button>` +
    (snacks.length ? `<div class="group" style="font-size:15px;color:var(--ink);margin-top:4px">🧁 Snacks & Baking</div>${snacks.map(snackCard).join('')}
      <div class="group" style="font-size:15px;color:var(--ink);margin-top:22px">🍽️ Dinners</div>` : '') +
    rs.map(r => r.status === 'pending' && r.photo_count ? `<div class="rcard"><span class="badge b-pending">📷 Processing…</span>
        <div class="card-title" style="margin-top:6px">${esc(r.title)}</div>
        <div class="meta">${r.photo_count} photo${r.photo_count > 1 ? 's' : ''} · added by ${esc(r.added_by || '?')} — the assistant will type it up and add it to the library.</div></div>`
      : r.status === 'pending' ? `<div class="rcard"><span class="badge b-pending">Importing soon</span>
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
  if (el.dataset.tab) { ev.preventDefault(); S.tab = el.dataset.tab; render.force = true; render(); window.scrollTo(0, 0); return; }
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
    case 'verdict': { const r = d.recipes.find(x => x.id === id), v = el.dataset.v;
      mutate('recipe_verdict', { p_recipe: id, p_verdict: v, p_who: S.who }, () => { r.verdict = v; r.verdict_by = S.who; }); toast(v === 'keep' ? '👍 Keeping it' : '🔄 Marked to swap out'); break; }
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

async function startOver() {
  const w = S.data && S.data.week; if (!w) return;
  if (!window.confirm('Clear all picks, pantry checks and staples for this week?')) return;
  let ok = false;
  await mutate('reset_week', { p_week: w.id }, () => {
    S.data.options.forEach(o => { o.picked = false; o.servings = 6; }); S.data.items = []; w.status = 'picking'; w.sent_by = null; w.sent_at = null;
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
