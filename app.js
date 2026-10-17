

const $ = (sel, el = document) => el.querySelector(sel); const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = n => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

function toast(msg, type = 'ok') {
  let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); } const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; box.append(t); setTimeout(() => t.remove(), 3800); }  

const run = fn => async e => {
  if (e?.type === 'submit') e.preventDefault();
  try { await fn(e); } catch (err) { console.error(err); } 


const views = {};
function showView(name) {
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + name);
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (views[name]) run(views[name])();
}
$$('nav button').forEach(b => b.onclick = () => showView(b.dataset.view));
document.addEventListener('click', e => { const b = e.target.closest('[data-close]'); if (b) b.closest('dialog').close(); });


const STORAGE_KEY = 'school-events-db';


const pad = n => String(n).padStart(2, '0');
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const todayStr = () => inDays(0);
const clean = v => String(v ?? '').trim();
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const randomCode = (n = 6) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const nextId = list => list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
const fail = msg => { toast(msg, 'error'); throw new Error(msg); };


const sampleData = () => ({
  events: [
    { id: 1, title: 'Intramurals Opening Ceremony', date: inDays(7), time: '08:00', venue: 'School gymnasium', capacity: 200, description: 'Parade of teams and opening program. Wear your team color.' },
    { id: 2, title: 'Science Fair', date: inDays(14), time: '09:00', venue: 'Science building', capacity: 40, description: 'Present your project to the judges. Bring your display board.' },
    { id: 3, title: 'Career Orientation Talk', date: inDays(30), time: '13:30', venue: 'Auditorium', capacity: 5, description: 'Guest speakers share what it is like to work in different careers.' },
  ],
  registrations: [],
});

function readDB() {
  try {                                                 
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.events && saved.registrations) return saved;
  } catch { /* nothing saved yet, or it was unreadable */ }
  return sampleData();                                   

function saveDB() {                                       
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
  catch { toast('Your browser would not let us save. Try a normal (not private) window.', 'error'); }
}

let db = readDB();
saveDB();


function withCounts(e) {
  const registered = db.registrations.filter(r => r.eventId === e.id).length;
  return { ...e, registered, seatsLeft: e.capacity - registered, isPast: e.date < todayStr() };
}

const findEvent = id => db.events.find(e => e.id === Number(id)) || fail('Event not found');

const API = {
 
  getEvents() {
    return db.events.map(withCounts).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },

 
  getEvent(id) { return withCounts(findEvent(id)); },

  
  addEvent(b) {
    const event = {
      id: nextId(db.events),
      title: clean(b.title).slice(0, 80),
      date: clean(b.date),
      time: clean(b.time),
      venue: clean(b.venue).slice(0, 80),
      capacity: Number(b.capacity),
      description: clean(b.description).slice(0, 500)
    };
    if (event.title.length < 3) fail('Please enter an event title');
    if (event.venue.length < 2) fail('Please enter the venue');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || isNaN(new Date(event.date))) fail('Please choose a valid date');
    if (event.date < todayStr()) fail('The event date cannot be in the past');
    if (!/^\d{2}:\d{2}$/.test(event.time)) fail('Please choose a valid time');
    if (!Number.isInteger(event.capacity) || event.capacity < 1 || event.capacity > 1000) fail('Maximum participants must be from 1 to 1000');
    db.events.push(event); saveDB();                     
    return withCounts(event);
  },

  
  registerStudent(eventId, b) {
    const event = findEvent(eventId);
    const reg = {
      id: nextId(db.registrations),
      eventId: event.id,
      code: randomCode(),
      studentId: clean(b.studentId).toUpperCase().slice(0, 20),
      name: clean(b.name).slice(0, 60),
      gradeSection: clean(b.gradeSection).slice(0, 30),
      email: clean(b.email).toLowerCase(),
      at: new Date().toISOString(),
     
      eventTitle: event.title,
      date: event.date,
      time: event.time,
      venue: event.venue
    };
    if (!reg.studentId || reg.name.length < 2 || !reg.gradeSection) fail('Please fill in all the student information');
    if (!isEmail(reg.email)) fail('Please enter a valid email address');
    const info = withCounts(event);
    if (info.isPast) fail('This event has already passed');
    if (info.seatsLeft <= 0) fail('Sorry, this event is already full');
    if (db.registrations.some(r => r.eventId === event.id && r.studentId === reg.studentId))
      fail(`Student ${reg.studentId} is already registered for this event`);
    db.registrations.push(reg); saveDB();
    return reg;
  },

 
  getParticipants(eventId) {
    const event = findEvent(eventId);
    return { event: withCounts(event), participants: db.registrations.filter(r => r.eventId === event.id) };
  },

 
  resetData() { db = sampleData(); saveDB(); },
};


let events = [];          
let pickedEvent = null;   
const fullDate = e => new Date(`${e.date}T${e.time}`).toLocaleString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const canRegister = e => !e.isPast && e.seatsLeft > 0;
const seatBadge = e => e.isPast ? '<span class="badge">Event has passed</span>'
  : e.seatsLeft <= 0 ? '<span class="badge bad">Full</span>'
  : `<span class="badge ${e.seatsLeft <= 5 ? 'warn' : 'ok'}">${e.seatsLeft} seats left</span>`;


const detailsHTML = e => `<h3>${esc(e.title)}</h3>
  <p class="meta">${fullDate(e)}<br>Venue: ${esc(e.venue)}</p>
  <p>${esc(e.description) || '<span class="muted">No description.</span>'}</p>
  <p>${seatBadge(e)} <span class="muted">${e.registered} of ${e.capacity} registered</span></p>`;


function loadEvents() { events = API.getEvents(); }


function fillSelect(sel, onlyOpen) {
  sel.innerHTML = '<option value="">Choose an event</option>' + events.map(e =>
    `<option value="${e.id}" ${onlyOpen && !canRegister(e) ? 'disabled' : ''}>${esc(e.title)} (${e.date})</option>`).join('');
  if (pickedEvent) sel.value = pickedEvent;
}


views.events = async () => {
  await loadEvents();
  $('#eventList').innerHTML = events.length ? events.map(e => {
    const d = new Date(e.date + 'T00:00:00');
    return `<article class="card event">
      <div class="date-tag"><b>${d.getDate()}</b><span>${d.toLocaleString('en-PH', { month: 'short' })}</span></div>
      <div class="event-main">${detailsHTML(e)}
        <div class="actions">
          <button class="btn small" data-register="${e.id}" ${canRegister(e) ? '' : 'disabled'}>Register</button>
          <button class="btn small ghost" data-people="${e.id}">View participants</button>
        </div></div></article>`;
  }).join('') : '<div class="card empty">No events yet. Use "Add event" to create one.</div>';
};

$('#eventList').onclick = e => {
  const reg = e.target.closest('[data-register]'), ppl = e.target.closest('[data-people]');
  if (reg) { pickedEvent = Number(reg.dataset.register); showView('register'); }
  if (ppl) { pickedEvent = Number(ppl.dataset.people); showView('people'); }
};


function showInfo() {
  const e = events.find(x => x.id === Number($('#rEvent').value));
  $('#eventInfo').innerHTML = e ? detailsHTML(e) : '<p class="muted">Choose an event to see its details.</p>';
}

views.register = async () => {
  await loadEvents();
  $('#confirmation').hidden = true; $('#regForm').hidden = false;
  fillSelect($('#rEvent'), true); showInfo();
};

$('#rEvent').onchange = () => { pickedEvent = Number($('#rEvent').value) || null; showInfo(); };


$('#regForm').onsubmit = run(async () => {
  if (!$('#rEvent').value) return toast('Please choose an event first', 'error');
  
  const r = API.registerStudent($('#rEvent').value, {
    studentId: $('#rStudentId').value, name: $('#rName').value, gradeSection: $('#rGrade').value, email: $('#rEmail').value
  });
  const box = $('#confirmation');
  $('#regForm').hidden = true; box.hidden = false;
  box.innerHTML = `<h3>You are registered!</h3><p class="code">${r.code}</p>
    <p><strong>${esc(r.name)}</strong> (${esc(r.studentId)}, ${esc(r.gradeSection)})<br>
    is registered for <strong>${esc(r.eventTitle)}</strong><br>${fullDate(r)}, ${esc(r.venue)}.</p>
    <p class="muted">Show this code at the entrance of the event.</p>
    <div class="actions" style="justify-content:center">
      <button class="btn" id="another">Register another student</button>
      <button class="btn ghost" id="seeList">View participants</button></div>`;
  $('#another').onclick = run(async () => { $('#regForm').reset(); await views.register(); });
  $('#seeList').onclick = () => showView('people');
});


async function showPeople() {
  const box = $('#peopleBox'), id = $('#pEvent').value;
  if (!id) { box.innerHTML = '<div class="card empty">Choose an event to see who registered.</div>'; return; }
  
  const { event, participants } = API.getParticipants(id);
  box.innerHTML = `<div class="card">${detailsHTML(event)}</div>
    <div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Student ID</th><th>Name</th><th>Grade and section</th><th>Email</th><th>Registered on</th></tr></thead>
      <tbody>${participants.length ? participants.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.studentId)}</td><td>${esc(p.name)}</td>
        <td>${esc(p.gradeSection)}</td><td>${esc(p.email)}</td><td>${fmtDate(p.at)}</td></tr>`).join('')
        : '<tr><td colspan="6" class="empty">Nobody has registered yet.</td></tr>'}</tbody></table></div>`;
}

views.people = async () => { await loadEvents(); fillSelect($('#pEvent'), false); await showPeople(); };
$('#pEvent').onchange = run(() => { pickedEvent = Number($('#pEvent').value) || null; return showPeople(); });


views.add = () => { $('#eDate').min = todayStr(); };
$('#eventForm').onsubmit = run(async () => {
 
  API.addEvent({
    title: $('#eTitle').value, date: $('#eDate').value, time: $('#eTime').value, venue: $('#eVenue').value,
    capacity: $('#eCapacity').value, description: $('#eDesc').value
  });
  toast('Event added!'); $('#eventForm').reset(); pickedEvent = null; showView('events');
});


$('#resetBtn').onclick = () => {
  if (!confirm('Delete all events and registrations and go back to the sample data?')) return;
  API.resetData(); pickedEvent = null; toast('Sample data restored'); showView('events');
};

showView('events');}}