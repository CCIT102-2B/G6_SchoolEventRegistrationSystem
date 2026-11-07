// =====================================================================
//  app.js  -  runs in the browser. It collects the user's INPUT, sends it
//  to the API with fetch(), then shows the OUTPUT the server sends back.
//  Lines marked  NEW  were added for logins, roles, quotas and the Attendance Manager.
// =====================================================================

// ---------- where the API lives ----------
// The local ASP.NET server hosts both the page and its API.
const API_URL = ((window.APP_CONFIG && window.APP_CONFIG.apiUrl) || '/api').replace(/\/+$/, '');

// ---------- helpers used by every screen ----------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
// esc() makes user text safe to put inside HTML (stops script injection)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
const ord = n => ({ 1: '1st', 2: '2nd', 3: '3rd' }[n] || n + 'th');   // 1 -> "1st"

function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), 3800);
}

// ---------- NEW: who is logged in ----------
// The API gives us a token when we log in. We keep it in sessionStorage (it is forgotten when the tab closes)
// and send it with every request in the  Authorization  header.
const memStore = {};   // fallback if the browser blocks sessionStorage
const store = {
  get: k => { try { return sessionStorage.getItem(k); } catch { return memStore[k] ?? null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { memStore[k] = v; } },
  del: k => { try { sessionStorage.removeItem(k); } catch { delete memStore[k]; } }
};
let me = null;   // the logged-in user: { username, displayName, role, department, program, yearLevel, studentId, email } or null

const authHeaders = () => {
  const h = { 'Content-Type': 'application/json' };
  if (store.get('token')) h.Authorization = 'Bearer ' + store.get('token');
  return h;
};
function endSession() { store.del('token'); me = null; renderAuth(); }

// Talk to the server:  api('/things')   or   api('/things', { method: 'POST', body: {...} })
async function api(url, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_URL + url, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
  } catch {
    toast('Cannot reach CampusPulse. Make sure the local app is running (see the README).', 'error');
    throw new Error('offline');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 401 while logged in = the API was restarted, so our token is no longer known
    if (res.status === 401 && me && url !== '/auth/login') {
      endSession(); showView('login'); toast('Your session ended. Please log in again.', 'error'); throw new Error('session ended');
    }
    toast(data.error || data.title || 'Something went wrong', 'error'); throw new Error(data.error || data.title);
  }
  return data;
}
// Like api(), but returns null instead of showing an error (used for "maybe not there" lookups and auto-refresh)
async function apiQuiet(url) {
  try { const res = await fetch(API_URL + url, { headers: authHeaders() }); return res.ok ? await res.json() : null; } catch { return null; }
}

// run(fn) wraps an event handler: stops page reload on forms, and keeps errors from crashing the page
const run = fn => async e => {
  if (e?.type === 'submit') e.preventDefault();
  try { await fn(e); } catch (err) { console.error(err); }   // api() already showed a toast
};

// Tabs: <button data-view="x"> shows <section id="view-x"> and runs views.x()
const views = {};
const guards = { add: ['organizer', 'master'], attendance: ['organizer', 'master'] };   // NEW: who may open which tab
function showView(name) {
  if (guards[name] && !guards[name].includes(me?.role)) {
    toast('Please log in with an organizer account to open that page', 'error'); name = 'login';
  }
  stopAutoRefresh();
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + name);
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (views[name]) run(views[name])();
}
$$('nav button').forEach(b => b.onclick = () => showView(b.dataset.view));
document.addEventListener('click', e => {
  const b = e.target.closest('[data-close]'); if (b) b.closest('dialog').close();
  const g = e.target.closest('[data-goto]'); if (g) showView(g.dataset.goto);
});

// =====================================================================
//  THIS SYSTEM'S SCREENS
// =====================================================================

let events = [];          // the events we got from the server
let pickedEvent = null;   // the event the student clicked on, remembered between tabs
let catalog = null;       // NEW: departments and programs from the API

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fullDate = e => new Date(`${e.date}T${e.time}`).toLocaleString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// NEW: API 11: GET /api/catalog  (CatalogController.GetAll) -> departments and their programs
async function ensureCatalog() { if (!catalog) catalog = await api('/catalog'); return catalog; }
const allPrograms = () => catalog.flatMap(d => d.programs.map(p => ({ ...p, dept: d.code })));

// A student can register when the event is upcoming, not full, open to them, and (quota events) has slots left for their program and year
const canRegister = e => !e.isPast && e.seatsLeft > 0 && e.eligible !== false && e.yourSlotsLeft !== 0;
const seatBadge = e => e.isPast ? '<span class="badge">Event has passed</span>'
  : e.eligible === false ? '<span class="badge bad">Not open to you</span>'
  : e.seatsLeft <= 0 ? '<span class="badge bad">Full</span>'
  : e.yourSlotsLeft === 0 ? '<span class="badge bad">Your program and year slots are full</span>'
  : e.yourSlotsLeft != null ? `<span class="badge ${e.yourSlotsLeft <= 2 ? 'warn' : 'ok'}">${e.yourSlotsLeft} slots left for you</span>`
  : `<span class="badge ${e.seatsLeft <= 5 ? 'warn' : 'ok'}">${e.seatsLeft} seats left</span>`;

// NEW: text for who can join, who owns the event, and the quota chips
const audienceText = e => e.allowedDepartments.includes('ALL') ? 'College-wide'
  : e.allowedDepartments.length > 1 ? e.allowedDepartments.join(' + ') + ' (inter-departmental)' : e.allowedDepartments[0] + ' only';
const ownerText = e => e.ownerDepartment ? e.ownerDepartment + ' department' : 'College (Master Admin)';
const quotaHTML = e => e.capacityMode === 'quota' && e.quotas.length
  ? `<div class="chips">${e.quotas.map(q => `<span class="chip ${q.left <= 0 ? 'full' : ''}" title="${q.used} of ${q.slots} slots used">${esc(q.program)} ${ord(q.yearLevel)} yr <b>${q.used}/${q.slots}</b></span>`).join('')}</div>` : '';

// EVENT DETAILS feature: one block of HTML reused on the Register and Participants tabs
const detailsHTML = e => `<h3>${esc(e.title)}</h3>
  <p class="meta">${fullDate(e)}<br>Venue: ${esc(e.venue)}<br>Organized by: ${esc(ownerText(e))}</p>
  <p>${esc(e.description) || '<span class="muted">No description.</span>'}</p>
  <p><span class="badge info">${esc(audienceText(e))}</span> <span class="badge">${e.capacityMode === 'quota' ? 'Quota per program and year' : 'Open: first come, first served'}</span></p>
  ${quotaHTML(e)}
  ${e.eligible === false ? `<p class="msg">${esc(e.eligibilityNote)}</p>` : ''}
  <p>${seatBadge(e)} <span class="muted">${e.registered} of ${e.capacity} registered</span></p>`;

// API 1: GET /api/events  (EventsController.GetAll) -> list of all events with seats left
// (the login token is sent too, so a logged-in student also learns which events are open to them)
async function loadEvents() { events = await api('/events'); }

// fills an event <select>; events that cannot take registrations are greyed out when onlyOpen is true
function fillSelect(sel, onlyOpen) {
  sel.innerHTML = '<option value="">Choose an event</option>' + events.map(e =>
    `<option value="${e.id}" ${onlyOpen && !canRegister(e) ? 'disabled' : ''}>${esc(e.title)} (${e.date})</option>`).join('');
  if (pickedEvent) sel.value = pickedEvent;
}

// =====================================================================
//  NEW: LOG IN / LOG OUT
// =====================================================================
const DEMO = [
  ['FAITH', 'Master Admin (all events, all departments)', 'master'],
  ['cbma_admin', 'CBMA department head', 'organizer'], ['ccit_admin', 'CCIT department head', 'organizer'],
  ['coe_admin', 'COE department head', 'organizer'], ['case_admin', 'CASE department head', 'organizer'],
  ['chc_admin', 'CHC department head', 'organizer'], ['ccj_admin', 'CCJ department head', 'organizer'],
  ['student_ccit_1', 'Juan Dela Cruz, CCIT, BSIT 1st year', 'student'],
  ['student_ccit_3', 'Maria Santos, CCIT, BSCS 3rd year', 'student'],
  ['student_cabea_3', 'Ana Reyes, CBMA, BSA 3rd year', 'student'],
];
$('#demoBody').innerHTML = DEMO.map(([u, who, role]) =>
  `<tr class="pick" data-user="${u}"><td><code>${u}</code></td><td>${esc(who)}</td><td><span class="badge ${role === 'student' ? '' : 'info'}">${role}</span></td></tr>`).join('');
$('#demoBody').onclick = e => {
  const tr = e.target.closest('[data-user]'); if (!tr) return;
  $('#lUser').value = tr.dataset.user; $('#lPass').value = 'password123'; $('#lUser').focus();
};

const roleLabel = u => u.role === 'master' ? 'Master Admin' : u.role === 'organizer' ? u.department + ' organizer'
  : `${u.program} · ${ord(u.yearLevel)} year · ${u.department}`;

// shows the Log in button or the user's name, and shows only the tabs this role may use
function renderAuth() {
  $('#authBox').innerHTML = me
    ? `<span class="who"><b>${esc(me.displayName)}</b><small>${esc(roleLabel(me))}</small></span><button class="btn small ghost" id="logoutBtn">Log out</button>`
    : '<button class="btn small ghost" id="signupBtn">Sign up</button><button class="btn small" id="loginBtn">Log in</button>';
  $$('nav button[data-roles]').forEach(b => b.hidden = !(me && b.dataset.roles.split(' ').includes(me.role)));
}
$('#authBox').onclick = run(async e => {
  if (e.target.id === 'loginBtn') showView('login');
  if (e.target.id === 'signupBtn') showView('signup');
  if (e.target.id === 'logoutBtn') {
    try { await fetch(API_URL + '/auth/logout', { method: 'POST', headers: authHeaders() }); } catch { /* offline: still log out here */ }
    endSession(); toast('You are logged out'); showView('events');
  }
});

// API 8: POST /api/auth/login  (AuthController.Login) -> { token, user }
$('#loginForm').onsubmit = run(async () => {
  const r = await api('/auth/login', { method: 'POST', body: { username: $('#lUser').value, password: $('#lPass').value } });
  store.set('token', r.token); me = r.user; renderAuth();
  $('#loginForm').reset(); toast(`Welcome, ${me.displayName}!`); showView('events');
});

// API 10: GET /api/auth/me  (AuthController.Me) -> remember who is logged in after the page is reloaded
async function restoreLogin() {
  if (!store.get('token')) return;
  try {
    const res = await fetch(API_URL + '/auth/me', { headers: authHeaders() });
    if (res.ok) me = await res.json(); else store.del('token');
  } catch { /* API is offline: the Events tab will explain */ }
}

// =====================================================================
//  NEW: SIGN UP  (a new student creates their own account)
// =====================================================================
const NAME_RE = /^\p{L}[\p{L} .'-]{1,39}$/u;   // letters, spaces, dots, apostrophes and dashes
// 09171234567, 0917 123 4567 and +639171234567 are all fine. Returns the number as 09171234567, or null if it is not valid
const phoneOk = v => { const d = v.replace(/[\s\-()]/g, ''); return /^(09\d{9}|\+639\d{9})$/.test(d) ? '09' + d.slice(-9) : null; };

// the Program list depends on the Department, and the Year level list depends on the Program
function fillSignupPrograms() {
  const d = catalog.find(x => x.code === $('#sDept').value);
  $('#sProg').innerHTML = `<option value="">${d ? 'Choose a program' : 'Choose a department first'}</option>`
    + (d ? d.programs.map(p => `<option value="${esc(p.code)}">${esc(p.code)} - ${esc(p.name)}</option>`).join('') : '');
  $('#sProg').disabled = !d; fillSignupYears();
}
function fillSignupYears() {
  const p = allPrograms().find(x => x.code === $('#sProg').value);
  $('#sYear').innerHTML = `<option value="">${p ? 'Choose a year level' : 'Choose a program first'}</option>`
    + (p ? Array.from({ length: p.years }, (_, i) => `<option value="${i + 1}">${ord(i + 1)} year</option>`).join('') : '');
  $('#sYear').disabled = !p;
}
$('#sDept').onchange = fillSignupPrograms;
$('#sProg').onchange = fillSignupYears;
$('#sShow').onchange = () => { $('#sPass').type = $('#sPass2').type = $('#sShow').checked ? 'text' : 'password'; };

// The same checks the API makes, so the student sees the problem before anything is sent.
// Returns [field id, message] for the first problem, or null when everything is fine.
function signupProblem() {
  const v = id => $('#' + id).value.trim(), pw = $('#sPass').value;
  return [
    ['sFirst', NAME_RE.test(v('sFirst')), 'Please enter your first name (letters only)'],
    ['sMiddle', !v('sMiddle') || NAME_RE.test(v('sMiddle')), 'The middle name can only have letters'],
    ['sLast', NAME_RE.test(v('sLast')), 'Please enter your last name (letters only)'],
    ['sStudentNo', /^[A-Za-z0-9-]{4,20}$/.test(v('sStudentNo')), 'Student number must be 4 to 20 letters, numbers or dashes, like 2026-1001'],
    ['sEmail', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('sEmail')), 'Please enter a valid student email address'],
    ['sContact', !!phoneOk(v('sContact')), 'Enter a valid mobile number, like 09171234567 or +639171234567'],
    ['sDept', !!v('sDept'), 'Please choose your department'],
    ['sProg', !!v('sProg'), 'Please choose your program'],
    ['sYear', !!v('sYear'), 'Please choose your year level'],
    ['sUser', /^[A-Za-z0-9_.]{4,20}$/.test(v('sUser')), 'Username must be 4 to 20 letters, numbers, dots or underscores'],
    ['sPass', pw.length >= 8 && pw.length <= 64 && /[A-Za-z]/.test(pw) && /\d/.test(pw), 'Password must be at least 8 characters with a letter and a number'],
    ['sPass', pw.toLowerCase() !== v('sUser').toLowerCase(), 'Password cannot be the same as your username'],
    ['sPass2', pw === $('#sPass2').value, 'The two passwords do not match'],
    ['sAgree', $('#sAgree').checked, 'Please tick the box to agree before creating your account'],
  ].find(c => !c[1]) || null;
}

views.signup = async () => {
  if (me) { toast('You are already logged in'); showView('events'); return; }
  await ensureCatalog();
  $('#sDept').innerHTML = '<option value="">Choose a department</option>' + catalog.map(d => `<option value="${esc(d.code)}">${esc(d.code)} - ${esc(d.name)}</option>`).join('');
  fillSignupPrograms();
};

// API 14: POST /api/auth/register  (AuthController.Register) -> { token, user }; the new student is logged in straight away
$('#signupForm').onsubmit = run(async () => {
  const bad = signupProblem();
  if (bad) { toast(bad[2], 'error'); $('#' + bad[0]).focus(); return; }
  const v = id => $('#' + id).value.trim();
  const r = await api('/auth/register', { method: 'POST', body: {
    firstName: v('sFirst'), middleName: v('sMiddle'), lastName: v('sLast'), studentNumber: v('sStudentNo'),
    email: v('sEmail'), contactNumber: v('sContact'), department: v('sDept'), program: v('sProg'), yearLevel: Number(v('sYear')),
    username: v('sUser'), password: $('#sPass').value, confirmPassword: $('#sPass2').value, agreeToTerms: $('#sAgree').checked } });
  store.set('token', r.token); me = r.user; renderAuth();
  $('#signupForm').reset(); toast(`Account created. Welcome, ${me.displayName}!`); showView('events');
});

// ---------- VIEW EVENTS ----------
views.events = async () => {
  // a free host puts the server to sleep when nobody uses it, so the first load can take a while
  if (!$('#eventList').children.length) $('#eventList').innerHTML = '<div class="card empty">Loading events. If the server was asleep, this can take up to a minute.</div>';
  await loadEvents();
  const isStudentOrGuest = !me || me.role === 'student';
  $('#eventList').innerHTML = events.length ? events.map(e => {
    const d = new Date(e.date + 'T00:00:00');
    return `<article class="card event">
      <div class="date-tag"><b>${d.getDate()}</b><span>${d.toLocaleString('en-PH', { month: 'short' })}</span></div>
      <div class="event-main">${detailsHTML(e)}
        <div class="actions">
          ${isStudentOrGuest ? `<button class="btn small go" data-register="${e.id}" ${canRegister(e) ? '' : 'disabled'}>Register</button>` : ''}
          <button class="btn small ghost" data-people="${e.id}">View participants</button>
          ${e.canManage ? `<button class="btn small ghost" data-manage="${e.id}">Manage attendance</button>` : ''}
        </div></div></article>`;
  }).join('') : '<div class="card empty">No events yet. Use "Add event" to create one.</div>';
};
$('#eventList').onclick = e => {
  const reg = e.target.closest('[data-register]'), ppl = e.target.closest('[data-people]'), mng = e.target.closest('[data-manage]');
  if (reg) { pickedEvent = Number(reg.dataset.register); showView('register'); }
  if (ppl) { pickedEvent = Number(ppl.dataset.people); showView('people'); }
  if (mng) { att.pendingEvent = mng.dataset.manage; showView('attendance'); }
};

// ---------- REGISTER FOR EVENT ----------
function showInfo() {
  const e = events.find(x => x.id === Number($('#rEvent').value));
  $('#eventInfo').innerHTML = e ? detailsHTML(e) : '<p class="muted">Choose an event to see its details.</p>';
}
views.register = async () => {
  await loadEvents();
  const isStudent = me?.role === 'student';
  // NEW: only a logged-in student can register
  $('#regLogin').hidden = isStudent; $('#regWrap').hidden = !isStudent;
  if (!isStudent) {
    $('#regLoginMsg').textContent = me ? 'Organizer accounts cannot register. Log in with a student account to register.' : 'Please log in with your student account to register for an event.';
    return;
  }
  $('#confirmation').hidden = true; $('#regForm').hidden = false;
  fillSelect($('#rEvent'), true); showInfo();
  // NEW: the student information comes from the login account
  $('#rStudentId').value = me.studentId; $('#rName').value = me.displayName;
  $('#rGrade').value = `${me.program} - ${ord(me.yearLevel)} year`; $('#rEmail').value = me.email; $('#rContact').value = me.contactNumber || '';
  await loadMine();
};
$('#rEvent').onchange = () => { pickedEvent = Number($('#rEvent').value) || null; showInfo(); };

// "My registrations": the events this student already signed up for.
// API 7: GET /api/students/{studentId}  (StudentsController.GetByStudentId); 404 just means "no registrations yet"
async function loadMine() {
  const s = await apiQuiet('/students/' + encodeURIComponent(me.studentId));
  $('#myRegs').innerHTML = s && s.registrations.length ? `<div class="card table-wrap"><h3 class="table-title">My registrations</h3><table>
    <thead><tr><th>Event</th><th>When</th><th>Venue</th><th>Code</th></tr></thead>
    <tbody>${s.registrations.map(r => `<tr><td>${esc(r.eventTitle)}</td><td>${fullDate(r)}</td><td>${esc(r.venue)}</td><td><code>${esc(r.code)}</code></td></tr>`).join('')}</tbody></table></div>` : '';
}

// Registration Form -> API 5 -> Registration Confirmation
$('#regForm').onsubmit = run(async () => {
  if (!$('#rEvent').value) return toast('Please choose an event first', 'error');
  // API 5: POST /api/registrations  (RegistrationsController.Register)
  // sends the student information, gets back the confirmation with its code
  const r = await api('/registrations', { method: 'POST', body: {
    eventId: Number($('#rEvent').value), studentId: $('#rStudentId').value, fullName: $('#rName').value,
    gradeSection: $('#rGrade').value, email: $('#rEmail').value } });
  const box = $('#confirmation');
  $('#regForm').hidden = true; box.hidden = false;
  box.innerHTML = `<h3>You are registered!</h3><p class="code">${r.code}</p>
    <p><strong>${esc(r.fullName)}</strong> (${esc(r.studentId)}, ${esc(r.gradeSection)})<br>
    is registered for <strong>${esc(r.eventTitle)}</strong><br>${fullDate(r)}, ${esc(r.venue)}.</p>
    <p class="muted">Show this code at the entrance of the event.</p>
    <div class="actions center">
      <button class="btn go" id="another">Register for another event</button>
      <button class="btn ghost" id="seeList">View participants</button></div>`;
  $('#another').onclick = run(async () => { await views.register(); });
  $('#seeList').onclick = () => showView('people');
  await loadMine();
});

// ---------- VIEW PARTICIPANTS ----------
async function showPeople() {
  const box = $('#peopleBox'), id = $('#pEvent').value;
  if (!id) { box.innerHTML = '<div class="card empty">Choose an event to see who registered.</div>'; return; }
  // API 4: GET /api/events/{id}/participants  (EventsController.GetParticipants) -> the event and its participants
  const { event, participants } = await api(`/events/${id}/participants`);
  box.innerHTML = `<div class="card">${detailsHTML(event)}</div>
    <div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Student ID</th><th>Name</th><th>Program and year</th><th>Email</th><th>Registered on</th></tr></thead>
      <tbody>${participants.length ? participants.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.studentId)}</td><td>${esc(p.fullName)}</td>
        <td>${p.program ? esc(p.program) + ' · ' + ord(p.yearLevel) + ' year' : esc(p.gradeSection)}</td><td>${esc(p.email)}</td><td>${fmtDate(p.registeredAt)}</td></tr>`).join('')
        : '<tr><td colspan="6" class="empty">Nobody has registered yet.</td></tr>'}</tbody></table></div>`;
}
views.people = async () => { await loadEvents(); fillSelect($('#pEvent'), false); await showPeople(); };
$('#pEvent').onchange = run(() => { pickedEvent = Number($('#pEvent').value) || null; return showPeople(); });

// =====================================================================
//  ADD EVENT  (NEW: audience + capacity mode switch + quota rows)
// =====================================================================
// the department codes this event will be open to (used to decide which programs a quota can use)
function allowedDeptCodes() {
  const a = $('#eAudience').value;
  if (a === 'college') return catalog.map(d => d.code);
  if (me.role === 'organizer' && a === 'department') return [me.department];
  return $$('#eDepts input:checked').map(i => i.value);
}
const programOptions = codes => catalog.filter(d => codes.includes(d.code)).map(d =>
  `<optgroup label="${esc(d.code)}">${d.programs.map(p => `<option value="${esc(p.code)}">${esc(p.code)} - ${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
const yearOptions = code => Array.from({ length: allPrograms().find(p => p.code === code)?.years || 4 }, (_, i) => `<option value="${i + 1}">${ord(i + 1)} year</option>`).join('');

function fillYears(row, year) {
  $('.qYear', row).innerHTML = yearOptions($('.qProg', row).value);
  if (year) $('.qYear', row).value = String(year);
}
function updateQuotaTotal() {
  const total = $$('#quotaRows .qSlots').reduce((sum, i) => sum + (Number(i.value) || 0), 0);
  $('#quotaTotal').textContent = `Total capacity: ${total}`;
}
function addQuotaRow() {
  const codes = allowedDeptCodes();
  if (!codes.length) return toast('Choose the departments first', 'error');
  const row = document.createElement('div'); row.className = 'quota-row';
  row.innerHTML = `<select class="qProg" aria-label="Program">${programOptions(codes)}</select><select class="qYear" aria-label="Year level"></select>
    <input class="qSlots" type="number" min="1" max="1000" value="10" aria-label="Slots"><button type="button" class="btn small ghost" data-delquota title="Remove">✕</button>`;
  $('#quotaRows').append(row); fillYears(row); updateQuotaTotal();
}
// when the chosen departments change, rebuild the program lists and drop rows that no longer fit
function refreshQuotaPrograms() {
  const codes = allowedDeptCodes(); let removed = false;
  $$('#quotaRows .quota-row').forEach(row => {
    const prog = $('.qProg', row).value, year = $('.qYear', row).value;
    $('.qProg', row).innerHTML = programOptions(codes); $('.qProg', row).value = prog;
    if ($('.qProg', row).value !== prog) { row.remove(); removed = true; return; }
    fillYears(row, year);
  });
  if (removed) toast('Removed quota rows for programs outside the chosen departments');
  updateQuotaTotal();
}
function onAudienceChange() {
  const a = $('#eAudience').value, master = me.role === 'master';
  $('#eDeptsBox').hidden = a === 'college' || (!master && a === 'department');
  $('#eDeptsHint').textContent = master ? (a === 'department' ? 'Tick exactly one department.' : 'Tick two or more departments.')
    : 'Your own department is always included. Tick the departments you want to invite.';
  refreshQuotaPrograms();
}
// the switch: Mode B "open" (one overall limit) or Mode A "quota" (slots per program and year level)
function setMode(mode) {
  $(`input[name=cmode][value=${mode}]`).checked = true;
  $('#openBox').hidden = mode !== 'open'; $('#quotaBox').hidden = mode !== 'quota';
  $('#eCapacity').required = mode === 'open';
  if (mode === 'quota' && !$$('#quotaRows .quota-row').length) addQuotaRow();
}
$$('input[name=cmode]').forEach(r => r.onchange = () => setMode(r.value));
$('#eAudience').onchange = onAudienceChange;
$('#eDepts').onchange = refreshQuotaPrograms;
$('#addQuota').onclick = addQuotaRow;
$('#quotaRows').onclick = e => { if (e.target.closest('[data-delquota]')) { e.target.closest('.quota-row').remove(); updateQuotaTotal(); } };
$('#quotaRows').onchange = e => { if (e.target.matches('.qProg')) fillYears(e.target.closest('.quota-row')); };
$('#quotaRows').oninput = e => { if (e.target.matches('.qSlots')) updateQuotaTotal(); };

views.add = async () => {
  await ensureCatalog();
  $('#eDate').min = todayStr();
  const master = me.role === 'master';
  // the Master Admin may create college-wide events; a department head can only target their own department or invite others
  $('#eAudience').innerHTML = master
    ? '<option value="college">College-wide (all departments)</option><option value="department">One department only</option><option value="inter">Selected departments (inter-departmental)</option>'
    : `<option value="department">My department only (${esc(me.department)})</option><option value="inter">My department + invited departments</option>`;
  $('#eDepts').innerHTML = catalog.map(d => {
    const mine = !master && d.code === me.department;
    return `<label class="check"><input type="checkbox" value="${esc(d.code)}" ${mine ? 'checked disabled' : ''}> <span><b>${esc(d.code)}</b> <span class="muted">${esc(d.name)}</span></span></label>`;
  }).join('');
  $('#quotaRows').innerHTML = '';
  setMode('open'); onAudienceChange();
};

$('#eventForm').onsubmit = run(async () => {
  const mode = $('input[name=cmode]:checked').value;
  const quotas = mode === 'quota' ? $$('#quotaRows .quota-row').map(r => ({
    program: $('.qProg', r).value, yearLevel: Number($('.qYear', r).value), slots: Number($('.qSlots', r).value) })) : [];
  if (mode === 'quota') {
    if (!quotas.length) return toast('Add at least one program and year level', 'error');
    if (quotas.some(q => !(q.slots >= 1))) return toast('Every quota needs at least 1 slot', 'error');
  }
  // API 3: POST /api/events  (EventsController.Create)
  // sends the new event's details (time needs seconds), who can join, and how the seats are shared; the API saves it
  await api('/events', { method: 'POST', body: {
    title: $('#eTitle').value, date: $('#eDate').value, time: $('#eTime').value + ':00', venue: $('#eVenue').value,
    description: $('#eDesc').value,
    audience: $('#eAudience').value,
    invitedDepartments: $('#eDeptsBox').hidden ? [] : $$('#eDepts input:checked').map(i => i.value),
    capacityMode: mode,
    capacity: mode === 'open' ? Number($('#eCapacity').value) : 0,   // quota events work out their own total
    quotas } });
  toast('Event added!'); $('#eventForm').reset(); pickedEvent = null; showView('events');
});

// =====================================================================
//  NEW: EVENT ATTENDANCE MANAGER  (organizers and the Master Admin)
// =====================================================================
const att = { dir: 'desc', timer: null, rows: [], pendingEvent: null };

// puts the chosen filters into the URL:  /attendance?department=CCIT&program=BSIT&yearLevel=1 ...
function attQuery() {
  const q = new URLSearchParams();
  const add = (k, v) => { if (v) q.set(k, v); };
  add('eventId', $('#aEvent').value || att.pendingEvent); add('department', $('#aDept').value); add('program', $('#aProg').value);
  add('yearLevel', $('#aYear').value); add('status', $('#aStatus').value); add('search', $('#aSearch').value.trim());
  add('sort', $('#aSort').value); add('dir', att.dir);
  return q.toString();
}
function fillAttPrograms() {
  const dept = $('#aDept').value;
  $('#aProg').innerHTML = '<option value="">All programs</option>' + catalog.filter(d => !dept || d.code === dept).map(d =>
    `<optgroup label="${esc(d.code)}">${d.programs.map(p => `<option value="${esc(p.code)}">${esc(p.code)}</option>`).join('')}</optgroup>`).join('');
}
const dirLabel = () => $('#aDir').textContent = att.dir === 'asc' ? 'Ascending ↑' : 'Descending ↓';

// API 12: GET /api/attendance  (AttendanceController.GetAttendance) -> { summary, events, rows } filtered by the page
async function loadAttendance(quiet = false) {
  const wanted = $('#aEvent').value || att.pendingEvent || '';
  const data = quiet ? await apiQuiet('/attendance?' + attQuery()) : await api('/attendance?' + attQuery());
  if (!data) { $('#aUpdated').textContent = 'Cannot reach the API. Showing the last list.'; return; }
  att.rows = data.rows;
  $('#aEvent').innerHTML = '<option value="">All events</option>' + data.events.map(e => `<option value="${e.id}">${esc(e.title)} (${e.date})</option>`).join('');
  $('#aEvent').value = wanted; att.pendingEvent = null;
  const s = data.summary;
  $('#aStats').innerHTML = `<div class="stat"><small>Students shown</small><strong>${s.total}</strong></div>
    <div class="stat"><small>Checked in</small><strong>${s.checkedIn}</strong></div>
    <div class="stat"><small>Not yet checked in</small><strong>${s.notYetCheckedIn}</strong></div>
    <div class="stat"><small>All registrations you can see</small><strong>${s.allInScope}</strong></div>`;
  $('#aBody').innerHTML = data.rows.length ? data.rows.map((r, i) => `<tr>
      <td>${i + 1}</td><td>${esc(r.studentId)}</td><td>${esc(r.fullName)}</td><td>${esc(r.contactNumber) || '-'}</td><td>${esc(r.department) || '-'}</td><td>${esc(r.program) || '-'}</td>
      <td>${r.yearLevel ? ord(r.yearLevel) : '-'}</td><td>${esc(r.eventTitle)}</td>
      <td><span class="badge ${r.status === 'checked_in' ? 'ok' : ''}">${r.status === 'checked_in' ? 'Checked in' : 'Registered'}</span></td>
      <td><code>${esc(r.code)}</code></td>
      <td class="right">${r.canManage ? (r.status === 'checked_in'
        ? `<button class="btn small ghost" data-status="registered" data-code="${esc(r.code)}">Undo</button>`
        : `<button class="btn small go" data-status="checked_in" data-code="${esc(r.code)}">Check in</button>`) : ''}</td></tr>`).join('')
    : '<tr><td colspan="11" class="empty">No students match these filters.</td></tr>';
  $('#aUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-PH');
}

views.attendance = async () => {
  await ensureCatalog();
  $('#attLead').textContent = me.role === 'master'
    ? 'You can see every registration in the college.'
    : `Events organized by ${me.department}, plus ${me.department} students registered in any event. You can check students in for your own events.`;
  $('#aDept').innerHTML = '<option value="">All departments</option>' + catalog.map(d => `<option value="${esc(d.code)}">${esc(d.code)}</option>`).join('');
  fillAttPrograms();
  $('#aYear').innerHTML = '<option value="">All year levels</option>' + [1, 2, 3, 4, 5].map(n => `<option value="${n}">${ord(n)} year</option>`).join('');
  $('#aStatus').value = ''; $('#aSearch').value = ''; $('#aEvent').innerHTML = '<option value="">All events</option>';
  dirLabel();
  await loadAttendance();
  startAutoRefresh();
};

// "real-time": ask the API again every 10 seconds while this tab is open
function startAutoRefresh() {
  stopAutoRefresh();
  if ($('#aAuto').checked) att.timer = setInterval(() => run(() => loadAttendance(true))(), 10000);
}
function stopAutoRefresh() { clearInterval(att.timer); att.timer = null; }

const reload = run(() => loadAttendance());
['aEvent', 'aStatus', 'aYear', 'aSort'].forEach(id => $('#' + id).onchange = reload);
$('#aDept').onchange = run(() => { fillAttPrograms(); return loadAttendance(); });
$('#aProg').onchange = reload;
let searchTimer;
$('#aSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(reload, 300); };
$('#aDir').onclick = () => { att.dir = att.dir === 'asc' ? 'desc' : 'asc'; dirLabel(); reload(); };
$('#aRefresh').onclick = reload;
$('#aAuto').onchange = startAutoRefresh;

// Check in / Undo.  API 13: PUT /api/attendance/{code}/status  (AttendanceController.SetStatus)
$('#aBody').onclick = run(async e => {
  const b = e.target.closest('[data-code]'); if (!b) return;
  await api(`/attendance/${b.dataset.code}/status`, { method: 'PUT', body: { status: b.dataset.status } });
  toast(b.dataset.status === 'checked_in' ? 'Checked in' : 'Check-in undone');
  await loadAttendance();
});

// Export CSV: saves the rows that are on the screen (so the filters apply) as a file Excel can open
$('#aExport').onclick = () => {
  if (!att.rows.length) return toast('Nothing to export', 'error');
  const cell = v => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };   // the ' stops Excel from running formulas
  const head = ['Event', 'Student ID', 'Name', 'Department', 'Program', 'Year level', 'Email', 'Contact number', 'Status', 'Registered at', 'Checked in at', 'Code'];
  const lines = att.rows.map(r => [r.eventTitle, r.studentId, r.fullName, r.department, r.program, r.yearLevel || '', r.email, r.contactNumber,
    r.status === 'checked_in' ? 'Checked in' : 'Registered', r.registeredAt, r.checkedInAt || '', r.code].map(cell).join(','));
  const url = URL.createObjectURL(new Blob(['\ufeff' + [head.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `attendance-${todayStr()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---------- start: remember who was logged in, then show the events ----------
restoreLogin().then(() => { renderAuth(); showView('events'); });
