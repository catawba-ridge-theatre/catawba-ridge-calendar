import {createApi, escapeHTML as h, safeColor, activeRound, calendarIdentity, LUDUS_URL, SESSION_KEY} from "./core.mjs?v=12";
const app = document.querySelector("#app");
const weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
let viewId = 0;
const {request, list, getSession, saveSession, clearSession} = createApi({storage: localStorage,
  onExpired: () => { location.hash = "#/login"; }});
const current = id => id === viewId;
function busy(button, value) {
  button.disabled = value;
  button.setAttribute("aria-busy", String(value));
}
function errorHTML(error) { return `<p class="error" role="alert">${h(error.message)}</p><button class="pill" data-retry>Refresh this page</button>`; }
function paymentMessage(day) {
  return `<div class="notice">Day ${day} is reserved. Complete your payment on Ludus.<a href="${LUDUS_URL}" target="_blank" rel="noopener noreferrer">Open Ludus in a new tab →</a></div>`;
}

async function loadPeople() {
  const [people, days] = await Promise.all([
    list("rest/v1/participants?select=id,slug,name,initials,color,raised,goal&active=eq.true&order=display_order,id"),
    list("rest/v1/sponsored_days?select=participant_id,day,amount,round&order=id"),
  ]);
  return people.map((person) => activeRound(person, days.filter((item) => item.participant_id === person.id)));
}

function header() {
  return `<header class="topbar">
    <a class="brand" href="#/"><span class="mark">CR</span><span>Catawba Ridge Theatre</span></a>
    <nav><a href="#/">All calendars</a><a class="pill create-link" href="${getSession() ? '#/dashboard' : '#/login'}">${getSession() ? 'My dashboard' : 'Create calendar'}</a></nav>
  </header>`;
}

function footer() {
  return `<footer><b>Catawba Ridge Theatre</b><em>Small days. Big difference.</em><span>April Calendar Fundraiser · 2027</span></footer>`;
}

function calendarGrid(person, readOnly = false) {
  const blanks = "<span></span>".repeat(4);
  const days = Array.from({ length: 30 }, (_, index) => {
    const day = index + 1;
    const paid = person.sponsored.includes(day);
    return `<button type="button" data-day="${day}" aria-label="April ${day}, ${paid ? 'reserved' : `$${day} donation`}" class="${paid ? "sponsored" : ""}" ${readOnly || paid || person.full ? "disabled" : ""}>
      <b>${day}</b><small>${paid ? "♥ Taken" : `$${day}`}</small>
    </button>`;
  }).join("");
  return `<div class="calendar ${person.round > 1 ? "encore" : ""}">
    <div class="month"><span>${person.round > 1 ? `ENCORE ROUND ${person.round}` : ""}</span><h2>April <em>2027</em></h2><span></span></div>
    <div class="weekdays">${weekdays.map((day) => `<span>${day}</span>`).join("")}</div>
    <div class="days">${blanks}${days}</div>
  </div>`;
}

async function home() {
  const id = viewId;
  const previewDays = Array.from({ length: 21 }, (_, index) => `<span>${index + 1}</span>`).join("");
  app.innerHTML = `${header()}<main><section class="hero">
    <div><p class="eyebrow">CATAWBA RIDGE THEATRE PRESENTS</p><h1>Every day can<br>make a <em>difference.</em></h1>
    <p class="lead">Choose a participant, sponsor an open April date, and complete the donation securely through the official theatre payment page.</p>
    <div class="hero-actions"><a class="button" href="#fundraisers">Choose a fundraiser →</a><a class="how-link" href="#how">See how it works</a></div></div>
    <div class="preview-card"><div class="preview-month"><span>APRIL</span><strong>2027</strong></div><div class="preview-days">${previewDays}<b>♥</b></div><p>pick a day<br><em>change a life!</em></p></div>
  </section>
  <section class="impact-strip"><div><strong id="raised-together">—</strong><span>raised together</span></div><div><strong id="active-calendars">—</strong><span>active calendars</span></div><div><strong id="ways-to-help">—</strong><span>ways to help</span></div></section>
  <section id="fundraisers" class="fundraisers"><p class="eyebrow">OUR FUNDRAISERS</p><h2>Who will you support?</h2><div class="cards" id="cards"><p>Loading calendars…</p></div></section>
  <section id="how" class="how-section"><p class="eyebrow">HOW IT WORKS</p><h2>Pick a day.<br><em>Change a life.</em></h2><div class="how-steps"><article><b>01</b><h3>Choose a fundraiser</h3><p>Select the participant you want to support.</p></article><article><b>02</b><h3>Pick an April date</h3><p>The date number is the donation amount. Open dates are ready to choose.</p></article><article><b>03</b><h3>Complete payment</h3><p>You’ll be sent to Catawba Ridge Theatre’s official Ludus page.</p></article></div><a class="button" href="#/login">Create calendar →</a></section>
  </main>${footer()}`;
  try {
    const people = await loadPeople();
    if (!current(id)) return;
    const totalRaised = people.reduce((sum, person) => sum + Number(person.raised || 0), 0);
    const availableDates = people.reduce((sum, person) => sum + (30 - person.sponsored.length), 0);
    document.querySelector("#raised-together").textContent = `$${totalRaised.toLocaleString()}`;
    document.querySelector("#active-calendars").textContent = people.length;
    document.querySelector("#ways-to-help").textContent = availableDates;
    document.querySelector("#cards").innerHTML = people.map((person) => {
      const percent = Math.min(100, Math.round(person.raised / person.goal * 100));
      return `<a class="person" href="#/calendar/${encodeURIComponent(person.slug)}">
        <span class="avatar" style="background:${safeColor(person.color)}">${h(person.initials)}</span>
        <span class="details"><b>${h(person.name)}</b><i><span style="width:${percent}%"></span></i><small>$${person.raised} of $${person.goal} reserved</small></span><strong>↗</strong>
      </a>`;
    }).join("") || '<p>No calendars yet. Create yours to get started!</p>';
    document.querySelector('.impact-strip > div > span').textContent = 'reserved together';
    if (location.hash === '#how' || location.hash === '#fundraisers') document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (error) {
    if (current(id)) document.querySelector("#cards").innerHTML = errorHTML(error);
  }
}

async function personalCalendar(slug, notice = "") {
  const id = viewId;
  app.innerHTML = `${header()}<main class="personal"><p>Loading calendar…</p></main>${footer()}`;
  try {
    const people = await loadPeople();
    if (!current(id)) return;
    const person = people.find((item) => item.slug === slug);
    if (!person) throw new Error("That calendar could not be found.");
    app.innerHTML = `${header()}<main class="personal">
      <section><a href="#/">← All fundraisers</a><p class="eyebrow">APRIL CALENDAR FUNDRAISER</p><h1>Support<br><em>${h(person.name)}</em></h1>
      <p class="lead">Choose an open date. The date is the donation amount, and payment is completed on Catawba Ridge Theatre’s Ludus page.</p>
      <p class="total"><b>$${person.raised}</b> reserved of $${person.goal}</p><p class="muted">Reservations include payments awaiting admin review.</p></section>
      <section>${calendarGrid(person)}<div id="payment-note" role="status" aria-live="polite">${notice}</div></section>
    </main>${footer()}`;
    let saving = false;
    document.querySelectorAll(".days button:not(:disabled)").forEach((button) => {
      button.addEventListener("click", async () => {
        if (saving || !current(id)) return;
        saving = true;
        const day = Number(button.dataset.day);
        const paymentTab = window.open("about:blank", "_blank");
        if (paymentTab) paymentTab.opener = null;
        busy(button, true);
        document.querySelectorAll('.days button').forEach(b => b.disabled = true);
        document.querySelector("#payment-note").innerHTML = `<div class="notice">Reserving day ${day} and opening Ludus…</div>`;
        try {
          await request("rest/v1/sponsored_days", {
            method: "POST",
            body: JSON.stringify({ participant_id: person.id, day, amount: day, paid: false, round: person.round }),
          });
          if (paymentTab) {
            paymentTab.location.href = LUDUS_URL;
          }
          if (current(id)) await personalCalendar(slug, paymentMessage(day));
        } catch (error) {
          if (paymentTab) paymentTab.close();
          if (current(id)) {
            busy(button, false);
            document.querySelector("#payment-note").innerHTML = errorHTML(error);
          }
        }
      });
    });
  } catch (error) {
    if (current(id)) document.querySelector(".personal").innerHTML = notice + errorHTML(error);
  }
}

function login() {
  const id = viewId;
  if (getSession()) return dashboard();
  app.innerHTML = `<main class="auth"><a class="brand" href="#/"><span class="mark">CR</span><span>Catawba Ridge Theatre</span></a>
    <section class="auth-card"><p class="eyebrow" id="auth-label">CALENDAR OWNERS</p><h1 id="auth-title">Welcome<br><em>back.</em></h1>
    <p id="auth-copy">Sign in with the email and password connected to your fundraiser.</p>
    <form id="auth-form"><label>Email<input id="email" type="email" autocomplete="email" maxlength="254" required></label><label>Password<input id="password" type="password" autocomplete="current-password" required></label>
    <p id="auth-message" role="status" aria-live="polite"></p><button class="button" type="submit">Sign in securely</button></form>
    <button class="link-button" id="switch-auth">New participant? Create an account</button><a href="#/">← Return to all calendars</a></section></main>`;
  let creating = false;
  let submitting = false;
  const switchButton = document.querySelector("#switch-auth");
  switchButton.addEventListener("click", () => {
    creating = !creating;
    document.querySelector('#password').autocomplete = creating ? 'new-password' : 'current-password';
    document.querySelector('#password').minLength = creating ? 8 : 1;
    document.querySelector("#auth-label").textContent = creating ? "JOIN THE FUNDRAISER" : "CALENDAR OWNERS";
    document.querySelector("#auth-title").innerHTML = creating ? "Create your<br><em>account.</em>" : "Welcome<br><em>back.</em>";
    document.querySelector("#auth-copy").textContent = creating ? "Create an account, then enter your own name to receive a personal April calendar." : "Sign in with the email and password connected to your fundraiser.";
    document.querySelector("#auth-form .button").textContent = creating ? "Create my account" : "Sign in securely";
    switchButton.textContent = creating ? "Already have an account? Sign in" : "New participant? Create an account";
    document.querySelector("#auth-message").textContent = "";
  });
  document.querySelector("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    const submit = event.currentTarget.querySelector('button');
    busy(submit, true);
    switchButton.disabled = true;
    const message = document.querySelector("#auth-message");
    message.textContent = "Please wait…";
    try {
      const email = document.querySelector("#email").value.trim();
      const password = document.querySelector("#password").value;
      const data = await request(creating ? "auth/v1/signup" : "auth/v1/token?grant_type=password", {
        method: "POST", body: JSON.stringify({ email, password }),
      });
      if (!current(id)) return;
      if (data.access_token) {
        saveSession(data);
        document.querySelector('#password').value = '';
        location.hash = "#/dashboard";
      } else {
        message.className = "success";
        message.textContent = "Account created! Check your email to confirm it, then return here to sign in.";
      }
    } catch (error) {
      if (current(id)) { message.className = "error"; message.textContent = error.message; }
    } finally {
      submitting = false;
      busy(submit, false);
      switchButton.disabled = false;
    }
  });
}

async function dashboard() {
  const id = viewId;
  const session = getSession();
  if (!session) return login();
  app.innerHTML = `${header()}<main class="dashboard"><div class="dash-head"><div><p class="eyebrow">YOUR CALENDAR DASHBOARD</p><h1>Your April<br><em>calendar.</em></h1></div><div class="account-actions" id="account-actions"><button class="pill" id="signout">Sign out</button></div></div><div id="dashboard-content"><p>Loading…</p></div></main>`;
  document.querySelector("#signout").addEventListener("click", async () => {
    busy(document.querySelector('#signout'), true);
    await request("auth/v1/logout", { method: "POST" }, true).catch(() => {});
    clearSession();
    location.hash = "#/";
  });
  try {
    const adminRows = await request(`rest/v1/calendar_admins?select=user_id&user_id=eq.${session.user.id}`, {}, true);
    if (!current(id)) return;
    if (adminRows.length) {
      document.querySelector("#account-actions").insertAdjacentHTML("afterbegin", `<a class="button" href="#/admin">Admin controls</a>`);
    }
    const calendars = await request(`rest/v1/participants?select=id,slug,name,initials,raised,goal&owner_id=eq.${session.user.id}`, {}, true);
    if (!current(id)) return;
    if (!calendars[0]) {
      document.querySelector("#dashboard-content").innerHTML = `<section class="setup"><h2>Create your calendar</h2><form id="name-form"><label>Your full name<input id="name" autocomplete="name" maxlength="80" required></label><p id="setup-message" role="status"></p><button class="button">Create my calendar</button></form></section>`;
      let creatingCalendar = false;
      document.querySelector("#name-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (creatingCalendar) return;
        creatingCalendar = true;
        const submit = event.currentTarget.querySelector('button');
        busy(submit, true);
        try {
          const {name, initials, slug} = calendarIdentity(document.querySelector('#name').value, session.user.id);
          await request("rest/v1/participants", { method: "POST", body: JSON.stringify({ owner_id: session.user.id, name, slug, initials, color: "#123d2c", goal: 465, raised: 0 }) }, true);
          if (current(id)) await dashboard();
        } catch (error) {
          if (current(id)) document.querySelector("#setup-message").textContent = error.message;
        } finally {
          creatingCalendar = false;
          busy(submit, false);
        }
      });
      return;
    }
    const person = calendars[0];
    const reservedDays = await list(`rest/v1/sponsored_days?select=day,amount,round&participant_id=eq.${person.id}&order=id`, true);
    if (!current(id)) return;
    Object.assign(person, activeRound(person, reservedDays));
    document.querySelector("#dashboard-content").innerHTML = `<div class="dashboard-actions"><a class="button" href="#/calendar/${encodeURIComponent(person.slug)}">View public calendar →</a><button class="pill" id="share-calendar">Copy calendar link</button></div><p class="total"><b>$${person.raised}</b> reserved of $${person.goal}</p><p>Share your public calendar with supporters. Administrators review Ludus payments and reopen unpaid dates.</p>${calendarGrid(person, true)}<p id="dash-message" role="status"></p>`;
    document.querySelector('#share-calendar').addEventListener('click', async () => {
      const url = `${location.href.split('#')[0]}#/calendar/${encodeURIComponent(person.slug)}`;
      try {
        await navigator.clipboard.writeText(url);
        if (current(id)) document.querySelector('#dash-message').textContent = 'Calendar link copied!';
      } catch {
        if (current(id)) document.querySelector('#dash-message').textContent = `Copy this link: ${url}`;
      }
    });
  } catch (error) {
    if (current(id)) document.querySelector("#dashboard-content").innerHTML = errorHTML(error);
  }
}

async function admin() {
  const id = viewId;
  const session = getSession();
  if (!session) {
    location.hash = "#/login";
    return;
  }
  app.innerHTML = `${header()}<main class="dashboard admin"><div class="dash-head"><div><p class="eyebrow">ADMINISTRATOR</p><h1>All calendar<br><em>controls.</em></h1></div><a class="pill" href="#/dashboard">My dashboard</a></div><p class="lead">Use these controls to reopen a date when its payment was not completed.</p><div id="admin-content"><p>Loading calendars…</p></div></main>`;
  try {
    const adminRows = await request(`rest/v1/calendar_admins?select=user_id&user_id=eq.${session.user.id}`, {}, true);
    if (!current(id)) return;
    if (!adminRows.length) throw new Error("This account does not have administrator access.");
    const [people, paidDays] = await Promise.all([
      list("rest/v1/participants?select=id,name,slug&active=eq.true&order=display_order,id"),
      list("rest/v1/sponsored_days?select=participant_id,day,round,paid&order=participant_id,round,day", true),
    ]);
    if (!current(id)) return;
    document.querySelector("#admin-content").innerHTML = people.map((person) => {
      const days = paidDays.filter((item) => item.participant_id === person.id);
      return `<section class="admin-person"><div><h2>${h(person.name)}</h2><a href="#/calendar/${encodeURIComponent(person.slug)}">View public calendar →</a><button class="delete-calendar" data-person="${h(person.id)}" data-name="${h(person.name)}">Delete calendar</button></div><div class="admin-days">${days.length ? days.map((item) => `<div class="reservation"><span>Round ${Number(item.round)} · Day ${Number(item.day)} · ${item.paid ? 'Payment confirmed' : 'Awaiting payment review'}</span>${item.paid ? '' : `<button class="confirm-payment pill" data-person="${h(person.id)}" data-day="${Number(item.day)}" data-round="${Number(item.round)}">Mark paid</button>`}<button class="admin-day" data-person="${h(person.id)}" data-day="${Number(item.day)}" data-round="${Number(item.round)}">Reopen day ${Number(item.day)}</button></div>`).join("") : "<span>No reserved dates</span>"}</div></section>`;
    }).join("") || '<p>No active calendars to manage.</p>';
    let changing = false;
    document.querySelectorAll('.confirm-payment').forEach(button => button.addEventListener('click', async () => {
      if (changing || !current(id)) return;
      if (!window.confirm(`Have you verified the $${button.dataset.day} payment in Ludus for this calendar?`)) return;
      changing = true;
      busy(button, true);
      try {
        const rows = await request(`rest/v1/sponsored_days?select=id&participant_id=eq.${button.dataset.person}&day=eq.${button.dataset.day}&round=eq.${button.dataset.round}`, {method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify({paid:true})}, true);
        if (!rows?.length) throw new Error('That reservation changed or your admin access expired. Refresh to check.');
        if (current(id)) await admin();
      } catch (error) { if (current(id)) window.alert(error.message); }
      finally { changing = false; busy(button, false); }
    }));
    document.querySelectorAll(".admin-day").forEach((button) => button.addEventListener("click", async () => {
      if (changing || !current(id)) return;
      const day = Number(button.dataset.day);
      if (!window.confirm(`Reopen day ${day}? It will become available on the public calendar.`)) return;
      changing = true;
      busy(button, true);
      try {
        const rows = await request(`rest/v1/sponsored_days?select=id&participant_id=eq.${button.dataset.person}&day=eq.${day}&round=eq.${button.dataset.round}`, { method: "DELETE", headers:{Prefer:'return=representation'} }, true);
        if (!rows?.length) throw new Error('That reservation changed or your admin access expired. Refresh to check.');
        if (current(id)) await admin();
      } catch (error) {
        if (current(id)) window.alert(error.message);
      } finally { changing = false; busy(button, false); }
    }));
    document.querySelectorAll(".delete-calendar").forEach((button) => button.addEventListener("click", async () => {
      if (changing || !current(id)) return;
      if (!window.confirm(`Permanently delete ${button.dataset.name}'s calendar and all of its reserved dates?`)) return;
      changing = true;
      busy(button, true);
      try {
        const rows = await request(`rest/v1/participants?select=id&id=eq.${button.dataset.person}`, { method: "DELETE", headers:{Prefer:'return=representation'} }, true);
        if (!rows?.length) throw new Error('That calendar changed or your admin access expired. Refresh to check.');
        if (current(id)) await admin();
      } catch (error) {
        if (current(id)) window.alert(error.message);
      } finally { changing = false; busy(button, false); }
    }));
  } catch (error) {
    if (current(id)) document.querySelector("#admin-content").innerHTML = errorHTML(error);
  }
}

function route() {
  viewId++;
  const path = location.hash.replace(/^#/, "") || "/";
  if (path.startsWith("/calendar/")) {
    let slug;
    try { slug = decodeURIComponent(path.split('/')[2]); } catch { slug = ''; }
    return personalCalendar(slug);
  }
  if (path === "/login") return login();
  if (path === "/dashboard") return dashboard();
  if (path === "/admin") return admin();
  return home();
}

window.addEventListener("hashchange", route);
window.addEventListener('storage', event => { if (event.key === SESSION_KEY && !event.newValue) route(); });
app.addEventListener('click', event => { if (event.target.closest('[data-retry]')) route(); });
route();
