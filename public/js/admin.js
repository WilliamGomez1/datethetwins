(function () {
  const { h, renderPair, promptCard, pairName, storage, getSupabase } = window.DTT;
  const layout = document.querySelector('.admin-layout');
  const listEl = document.querySelector('[data-list]');
  const detailEl = document.querySelector('[data-detail]');
  const filtersEl = document.querySelector('[data-filters]');
  const navLinks = document.querySelector('.nav-links');

  const BUCKET = 'applicant-photos';
  const STATUSES = ['new', 'liked', 'maybe', 'passed'];
  const LABELS = { all: 'All', new: 'New', liked: 'Liked', maybe: 'Maybe', passed: 'Passed' };
  let apps = [];
  let photoUrls = {}; // storage path -> signed URL
  let filter = storage.get('dtt-admin-filter') || 'all';
  let selectedId = null;

  const sb = getSupabase();

  const fmtDate = (s) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const urlsFor = (twin) => (twin.photos || []).map((p) => photoUrls[p]).filter(Boolean);

  // ---------- Login ----------
  function showMessage(text) {
    layout.replaceChildren(h('div', { class: 'apply-wrap' }, h('p', { class: 'empty' }, text)));
  }

  function showLogin(message) {
    const email = h('input', { class: 'input', type: 'email', id: 'login-email', autocomplete: 'username', required: true });
    const password = h('input', { class: 'input', type: 'password', id: 'login-password', autocomplete: 'current-password', required: true });
    const alertEl = h('div', { class: 'form-alert', role: 'alert' }, message || '');
    const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Log in');
    const form = h('form', { class: 'fieldset' },
      h('div', { class: 'legend' }, 'Admin login'),
      h('p', { class: 'hint' }, 'For the featured twins only.'),
      alertEl,
      h('div', { class: 'field' }, h('label', { for: 'login-email' }, 'Email'), email),
      h('div', { class: 'field' }, h('label', { for: 'login-password' }, 'Password'), password),
      h('div', { class: 'step-nav' }, h('span', { class: 'spacer' }), submitBtn));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertEl.textContent = '';
      submitBtn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      submitBtn.disabled = false;
      if (error) { alertEl.textContent = error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message; return; }
      start();
    });
    layout.replaceChildren(h('div', { class: 'apply-wrap' }, form));
    email.focus();
  }

  function addLogout(userEmail) {
    navLinks.querySelector('[data-logout]')?.remove();
    navLinks.append(h('button', {
      type: 'button', class: 'btn btn-quiet btn-sm', dataset: { logout: '' }, title: userEmail,
      onclick: async () => { await sb.auth.signOut(); location.reload(); },
    }, 'Log out'));
  }

  // ---------- Data ----------
  async function load() {
    const { data, error } = await sb.from('applications')
      .select('id, created_at, status, email, profile, notes')
      .order('id', { ascending: false });
    if (error) throw error;
    apps = data;
    const paths = apps.flatMap((a) => a.profile.twins.flatMap((t) => t.photos || []));
    photoUrls = {};
    for (let i = 0; i < paths.length; i += 100) {
      const { data: signed, error: e } = await sb.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), 60 * 60);
      if (e) throw e;
      signed.forEach((s) => { if (s.signedUrl) photoUrls[s.path] = s.signedUrl; });
    }
  }

  async function update(a, fields) {
    const { data, error } = await sb.from('applications').update(fields).eq('id', a.id)
      .select('id, created_at, status, email, profile, notes').single();
    if (error) throw error;
    Object.assign(a, data);
  }

  // ---------- Rendering ----------
  function renderFilters() {
    const counts = { all: apps.length };
    STATUSES.forEach((s) => { counts[s] = apps.filter((a) => a.status === s).length; });
    filtersEl.replaceChildren(...['all', ...STATUSES].map((s) => h('button', {
      type: 'button', 'aria-pressed': String(filter === s),
      onclick: () => { filter = s; storage.set('dtt-admin-filter', s); render(); },
    }, `${LABELS[s]} (${counts[s]})`)));
  }

  function renderList() {
    const visible = apps.filter((a) => filter === 'all' || a.status === filter);
    if (!visible.length) {
      listEl.replaceChildren(h('p', { class: 'empty' }, apps.length ? 'Nothing here.' : 'No applications yet. Share the link!'));
      return;
    }
    listEl.replaceChildren(...visible.map((a) => {
      const t = a.profile.twins;
      return h('button', {
        type: 'button', class: 'app-item', 'aria-current': String(a.id === selectedId),
        onclick: () => { selectedId = a.id; render(); if (window.innerWidth < 960) detailEl.scrollIntoView({ behavior: 'smooth' }); },
      },
      h('span', { class: 'thumbs' }, t.map((tw) => h('img', { src: urlsFor(tw)[0] || 'images/placeholders/applicant.svg', alt: '' }))),
      h('span', null,
        h('span', { class: 'title' }, pairName(t)), ' ',
        h('span', { class: `pill ${a.status}` }, LABELS[a.status] || a.status),
        h('span', { class: 'sub' }, h('br'), `${t.map((x) => x.age).join(' & ')} · ${a.profile.pair.city} · ${fmtDate(a.created_at)}`)));
    }));
  }

  function renderDetail() {
    const a = apps.find((x) => x.id === selectedId);
    if (!a) {
      detailEl.replaceChildren(h('p', { class: 'empty' }, apps.length ? 'Select an application to review it.' : ''));
      return;
    }
    const p = a.profile;
    const setStatus = async (status) => {
      try { await update(a, { status }); render(); } catch (e) { alert(e.message); }
    };
    const decision = (status, cls, text) => h('button', {
      type: 'button', class: `btn btn-sm ${cls}`, 'aria-pressed': String(a.status === status), onclick: () => setStatus(status),
    }, text);

    const notes = h('textarea', { class: 'textarea', rows: 4, maxlength: 2000, placeholder: 'Private notes…' });
    notes.value = a.notes || '';
    const saved = h('span', { class: 'sub' });
    let timer;
    notes.addEventListener('input', () => {
      clearTimeout(timer);
      saved.textContent = '';
      timer = setTimeout(async () => {
        try { await update(a, { notes: notes.value }); saved.textContent = 'Saved'; } catch (e) { saved.textContent = e.message; }
      }, 600);
    });

    const del = h('button', {
      type: 'button', class: 'btn btn-sm btn-quiet',
      onclick: async () => {
        if (!confirm(`Delete the application from ${pairName(p.twins)}? This removes their photos too and can't be undone.`)) return;
        try {
          const paths = p.twins.flatMap((t) => t.photos || []);
          if (paths.length) {
            const { error: e1 } = await sb.storage.from(BUCKET).remove(paths);
            if (e1) throw e1;
          }
          const { error: e2 } = await sb.from('applications').delete().eq('id', a.id);
          if (e2) throw e2;
          apps = apps.filter((x) => x.id !== a.id);
          selectedId = apps[0]?.id ?? null;
          render();
        } catch (e) { alert(e.message); }
      },
    }, 'Delete');

    const contact = [
      h('a', { href: `mailto:${p.contact.email}` }, p.contact.email),
      p.contact.phone ? [h('br'), h('a', { href: `tel:${p.contact.phone}` }, p.contact.phone)] : null,
    ];

    detailEl.replaceChildren(
      h('div', { class: 'detail-head' },
        h('div', null,
          h('h2', null, pairName(p.twins)),
          h('p', { class: 'sub' }, `${p.pair.twinType} twins · ${p.pair.city} · applied ${fmtDate(a.created_at)}`)),
        h('div', { class: 'decision' },
          decision('liked', 'btn-like', '♥ Like'),
          decision('maybe', 'btn-maybe', 'Maybe'),
          decision('passed', 'btn-pass', 'Pass'))),
      renderPair(p.twins, p.twins.map(urlsFor)),
      h('div', { class: 'detail-meta' },
        promptCard(p.pair.prompt, null, 'From both of them'),
        h('div', { class: 'card prompt-card' },
          h('span', { class: 'pair-label' }, 'Their pitch'),
          h('p', { class: 'answer' }, p.pair.why)),
        h('div', { class: 'card' }, h('h4', null, 'Contact'), h('p', null, contact)),
        h('div', { class: 'card' }, h('h4', null, 'Notes'), notes, saved, h('p', null, h('br'), del))));
  }

  function render() {
    renderFilters();
    renderList();
    renderDetail();
  }

  // ---------- Startup ----------
  const shell = [...layout.children];

  async function start() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showLogin(); return; }
    const { data: isAdmin, error } = await sb.rpc('am_i_admin');
    if (error || !isAdmin) {
      await sb.auth.signOut();
      showLogin(error ? error.message : `${session.user.email} isn’t on the admin list.`);
      return;
    }
    layout.replaceChildren(...shell);
    addLogout(session.user.email);
    listEl.replaceChildren(h('p', { class: 'empty' }, 'Loading…'));
    try {
      await load();
      if (!['all', ...STATUSES].includes(filter)) filter = 'all';
      selectedId = apps[0]?.id ?? null;
      render();
    } catch (e) {
      console.error(e);
      listEl.replaceChildren(h('p', { class: 'empty' }, `Couldn't load applications: ${e.message}`));
    }
  }

  if (!sb) showMessage('The admin page isn’t connected to Supabase yet. Fill in public/js/config.js (see the README).');
  else start();
})();
