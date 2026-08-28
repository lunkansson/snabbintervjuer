(() => {
  'use strict';

  // ---- schedule (09.00–12.00, 15 min interviews, 15 min gap → 6 slots) ----
  const SLOT_MINUTES = 15;
  const BUFFER_MINUTES = 15;
  const START = 9 * 60;
  const END = 12 * 60;
  const LOCAL_KEY = 'nexer-speeddating-mine';

  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const hhmm = (m) => pad(Math.floor(m / 60)) + '.' + pad(m % 60);

  function buildSlots() {
    const out = [];
    for (let t = START; t + SLOT_MINUTES <= END; t += SLOT_MINUTES + BUFFER_MINUTES) {
      out.push({ id: 's' + t, start: hhmm(t), end: hhmm(t + SLOT_MINUTES) });
    }
    return out;
  }
  const SLOTS = buildSlots();
  const label = (d) => d.start + ' – ' + d.end;

  // ---- supabase ----
  const cfg = window.NEXER_CONFIG || {};
  const sb = (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  // ---- state ----
  const state = {
    view: 'list', // list | form | confirm | gate | admin
    bookedSlotIds: new Set(),
    picked: null,
    name: '',
    error: '',
    pw: '',
    pwError: '',
    copied: false,
    mine: loadMine(),
    adminData: null, // { [slotId]: { name, code } } — only populated after a correct admin unlock
    adminPassword: null, // kept in memory only, to re-fetch the admin list after deleting a booking
    busy: false,
  };

  function loadMine() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function saveMine() {
    try {
      if (state.mine) localStorage.setItem(LOCAL_KEY, JSON.stringify(state.mine));
      else localStorage.removeItem(LOCAL_KEY);
    } catch (e) {}
  }

  // ---- data ----
  async function refreshSlots() {
    if (!sb) return;
    const { data, error } = await sb.from('public_slots').select('slot_id');
    if (!error && data) state.bookedSlotIds = new Set(data.map((r) => r.slot_id));
    render();
  }

  async function submit() {
    const name = state.name.trim();
    if (name.length < 2) {
      state.error = 'Fyll i ditt namn så vi vet vem vi möter.';
      return render();
    }
    if (!sb) {
      state.error = 'Bokningssystemet är inte anslutet (saknar Supabase-konfiguration).';
      return render();
    }
    state.busy = true;
    render();
    const { data, error } = await sb.rpc('create_booking', { p_slot_id: state.picked, p_name: name });
    state.busy = false;
    if (error) {
      state.error = (error.message || '').includes('slot_taken')
        ? 'Någon hann före på den tiden – välj en annan.'
        : 'Något gick fel – försök igen.';
      await refreshSlots();
      return render();
    }
    state.mine = { slot: state.picked, code: data, name };
    saveMine();
    state.view = 'confirm';
    state.error = '';
    await refreshSlots();
  }

  async function fetchAdminData(password) {
    const { data, error } = await sb.rpc('get_admin_bookings', { p_password: password });
    if (error) return null;
    const map = {};
    (data || []).forEach((row) => { map[row.slot_id] = { name: row.name, code: row.code }; });
    return map;
  }

  async function unlockAdmin() {
    if (!sb) {
      state.pwError = 'Bokningssystemet är inte anslutet (saknar Supabase-konfiguration).';
      return render();
    }
    state.busy = true;
    render();
    const password = state.pw.trim();
    const map = await fetchAdminData(password);
    state.busy = false;
    if (!map) {
      state.pwError = 'Fel lösenord.';
      return render();
    }
    state.adminData = map;
    state.adminPassword = password;
    state.view = 'admin';
    state.pw = '';
    state.pwError = '';
    render();
  }

  async function deleteBooking(slotId, code, name) {
    if (!sb || !state.adminPassword) return;
    if (!window.confirm('Ta bort bokningen för ' + name + '?')) return;
    state.busy = true;
    render();
    await sb.rpc('cancel_booking', { p_code: code, p_slot_id: slotId });
    const map = await fetchAdminData(state.adminPassword);
    state.busy = false;
    if (map) state.adminData = map;
    await refreshSlots();
  }

  function copyList() {
    const text = SLOTS.map((d) => {
      const b = state.adminData ? state.adminData[d.id] : null;
      return label(d) + '\t' + (b ? b.name + '\t' + b.code : 'ledig');
    }).join('\n');
    try { navigator.clipboard.writeText(text); } catch (e) {}
    state.copied = true;
    render();
    setTimeout(() => { state.copied = false; render(); }, 2000);
  }

  // ---- render ----
  const els = {};
  function cacheEls() {
    ['view-list', 'view-form', 'view-confirm', 'view-gate', 'view-admin',
      'free-tag', 'my-booking-slot', 'slots',
      'form-picked-time', 'form-submit-time', 'cand-name', 'form-error',
      'confirm-time', 'confirm-name', 'confirm-code',
      'admin-pw', 'gate-error',
      'admin-count', 'admin-rows', 'admin-copy'].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function render() {
    ['list', 'form', 'confirm', 'gate', 'admin'].forEach((v) => {
      els['view-' + v].hidden = state.view !== v;
    });

    const free = SLOTS.filter((d) => !state.bookedSlotIds.has(d.id)).length;
    els['free-tag'].textContent = free === 0 ? 'Alla tider bokade' : free === 1 ? '1 tid kvar' : free + ' tider kvar';

    if (state.view === 'list') renderList();
    if (state.view === 'form') renderForm();
    if (state.view === 'confirm') renderConfirm();
    if (state.view === 'gate') renderGate();
    if (state.view === 'admin') renderAdmin();
  }

  function renderList() {
    els['my-booking-slot'].innerHTML = '';
    if (state.mine) {
      const mySlot = SLOTS.find((d) => d.id === state.mine.slot);
      const card = document.createElement('div');
      card.className = 'card elev-sm my-booking-card';
      const kicker = document.createElement('span');
      kicker.className = 'card-kicker';
      kicker.textContent = 'Din bokning';
      const time = document.createElement('span');
      time.className = 'my-booking-time';
      time.textContent = mySlot ? label(mySlot) : '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost';
      btn.style.cssText = 'align-self:flex-start;min-height:44px;';
      btn.textContent = 'Visa bekräftelsen';
      btn.addEventListener('click', () => { state.view = 'confirm'; render(); });
      card.append(kicker, time, btn);
      els['my-booking-slot'].appendChild(card);
    }

    els.slots.innerHTML = '';
    SLOTS.forEach((d) => {
      const isMine = !!(state.mine && state.mine.slot === d.id);
      const booked = state.bookedSlotIds.has(d.id);
      const disabled = booked && !isMine;

      const row = document.createElement('div');
      row.className = 'card elev-sm slot-row';

      const timeCol = document.createElement('div');
      timeCol.className = 'slot-time';
      const startEl = document.createElement('span');
      startEl.className = 'slot-start';
      startEl.style.color = booked && !isMine ? 'color-mix(in srgb, var(--color-text) 50%, transparent)' : 'var(--color-text)';
      startEl.textContent = d.start;
      const endEl = document.createElement('span');
      endEl.className = 'slot-end';
      endEl.textContent = 'till ' + d.end;
      timeCol.append(startEl, endEl);

      const statusEl = document.createElement('span');
      statusEl.className = 'slot-status';
      statusEl.style.color = isMine
        ? 'var(--color-accent-300)'
        : booked
          ? 'color-mix(in srgb, var(--color-text) 50%, transparent)'
          : 'color-mix(in srgb, var(--color-text) 72%, transparent)';
      statusEl.textContent = isMine ? 'Din tid' : booked ? 'Bokad' : 'Ledig';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn slot-btn ' + (disabled ? 'btn-secondary' : 'btn-primary');
      btn.textContent = isMine ? 'Din' : booked ? 'Upptagen' : 'Välj';
      btn.disabled = disabled;
      if (!disabled) {
        btn.addEventListener('click', () => {
          state.picked = d.id;
          state.error = '';
          state.view = isMine ? 'confirm' : 'form';
          render();
        });
      }

      row.append(timeCol, statusEl, btn);
      els.slots.appendChild(row);
    });
  }

  function renderForm() {
    const picked = SLOTS.find((d) => d.id === state.picked);
    els['form-picked-time'].textContent = picked ? label(picked) : '';
    els['form-submit-time'].textContent = picked ? picked.start : '';
    if (document.activeElement !== els['cand-name']) els['cand-name'].value = state.name;
    els['form-error'].hidden = !state.error;
    els['form-error'].textContent = state.error;
  }

  function renderConfirm() {
    const mySlot = state.mine ? SLOTS.find((d) => d.id === state.mine.slot) : null;
    els['confirm-time'].textContent = mySlot ? label(mySlot) : '';
    els['confirm-name'].textContent = state.mine ? state.mine.name : '';
    els['confirm-code'].textContent = state.mine ? state.mine.code : '';
  }

  function renderGate() {
    if (document.activeElement !== els['admin-pw']) els['admin-pw'].value = state.pw;
    els['gate-error'].hidden = !state.pwError;
    els['gate-error'].textContent = state.pwError;
  }

  function renderAdmin() {
    els['admin-count'].textContent = 'Adminvy · ' + state.bookedSlotIds.size + ' bokade';
    els['admin-rows'].innerHTML = '';
    SLOTS.forEach((d) => {
      const b = state.adminData ? state.adminData[d.id] : null;
      const tr = document.createElement('tr');
      const tdTime = document.createElement('td');
      tdTime.className = 'admin-time';
      tdTime.textContent = label(d);
      const tdName = document.createElement('td');
      tdName.style.color = b ? 'var(--color-text)' : 'color-mix(in srgb, var(--color-text) 50%, transparent)';
      tdName.textContent = b ? b.name : 'ledig';
      const tdCode = document.createElement('td');
      tdCode.className = 'admin-code';
      tdCode.textContent = b ? b.code : '–';
      const tdAction = document.createElement('td');
      if (b) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-ghost admin-delete-btn';
        delBtn.textContent = 'Ta bort';
        delBtn.addEventListener('click', () => deleteBooking(d.id, b.code, b.name));
        tdAction.appendChild(delBtn);
      }
      tr.append(tdTime, tdName, tdCode, tdAction);
      els['admin-rows'].appendChild(tr);
    });
    els['admin-copy'].textContent = state.copied ? 'Kopierat ✓' : 'Kopiera listan';
  }

  // ---- events ----
  function bindEvents() {
    document.getElementById('form-back').addEventListener('click', () => { state.view = 'list'; render(); });
    document.getElementById('form-submit').addEventListener('click', submit);
    els['cand-name'].addEventListener('input', (e) => { state.name = e.target.value; state.error = ''; });

    els['admin-pw'].addEventListener('input', (e) => { state.pw = e.target.value; state.pwError = ''; });
    els['admin-pw'].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); unlockAdmin(); }
    });
    document.getElementById('gate-unlock').addEventListener('click', unlockAdmin);
    document.getElementById('gate-cancel').addEventListener('click', () => { state.pw = ''; state.pwError = ''; state.view = 'list'; render(); });

    document.getElementById('admin-back').addEventListener('click', () => { state.view = 'list'; state.adminPassword = null; render(); });
    els['admin-copy'].addEventListener('click', copyList);

    document.getElementById('footer-admin').addEventListener('click', () => { state.pw = ''; state.pwError = ''; state.view = 'gate'; render(); });
  }

  // ---- boot ----
  document.addEventListener('DOMContentLoaded', () => {
    cacheEls();
    bindEvents();
    render();
    refreshSlots();

    if (sb) {
      sb.channel('bookings-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { refreshSlots(); })
        .subscribe();
    } else {
      console.warn('Nexer speeddating: Supabase is not configured — fill in config.js. See README.md.');
    }
  });
})();
