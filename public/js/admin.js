(function () {
  const { h, renderPair, promptCard, pairName, storage } = window.DTT;
  const listEl = document.querySelector('[data-list]');
  const detailEl = document.querySelector('[data-detail]');
  const filtersEl = document.querySelector('[data-filters]');

  const LABELS = { all: 'All', new: 'New', liked: 'Liked', maybe: 'Maybe', passed: 'Passed' };
  let apps = [];
  let statuses = [];
  let filter = storage.get('dtt-admin-filter') || 'all';
  let selectedId = null;

  async function api(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (res.status === 204) return null;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
  }

  const fmtDate = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function renderFilters() {
    const counts = { all: apps.length };
    statuses.forEach((s) => { counts[s] = apps.filter((a) => a.status === s).length; });
    filtersEl.replaceChildren(...['all', ...statuses].map((s) => h('button', {
      type: 'button', 'aria-pressed': String(filter === s),
      onclick: () => { filter = s; storage.set('dtt-admin-filter', s); render(); },
    }, `${LABELS[s] || s} (${counts[s]})`)));
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
      h('span', { class: 'thumbs' }, t.map((tw) => h('img', { src: tw.photos[0], alt: '' }))),
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
      try {
        const updated = await api(`/api/admin/applications/${a.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        Object.assign(a, updated);
        render();
      } catch (e) { alert(e.message); }
    };
    const decision = (status, cls, text) => h('button', {
      type: 'button', class: `btn btn-sm ${cls}`, 'aria-pressed': String(a.status === status), onclick: () => setStatus(status),
    }, text);

    const notes = h('textarea', { class: 'textarea', rows: 4, maxlength: 2000, placeholder: 'Private notes…' });
    notes.value = a.notes || '';
    const saved = h('span', { class: 'sub' });
    let t;
    notes.addEventListener('input', () => {
      clearTimeout(t);
      saved.textContent = '';
      t = setTimeout(async () => {
        try {
          const updated = await api(`/api/admin/applications/${a.id}`, { method: 'PATCH', body: JSON.stringify({ notes: notes.value }) });
          a.notes = updated.notes;
          saved.textContent = 'Saved';
        } catch (e) { saved.textContent = e.message; }
      }, 600);
    });

    const del = h('button', {
      type: 'button', class: 'btn btn-sm btn-quiet',
      onclick: async () => {
        if (!confirm(`Delete the application from ${pairName(p.twins)}? This removes their photos too and can't be undone.`)) return;
        try {
          await api(`/api/admin/applications/${a.id}`, { method: 'DELETE' });
          apps = apps.filter((x) => x.id !== a.id);
          selectedId = null;
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
      renderPair(p.twins, p.twins.map((tw) => tw.photos)),
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

  api('/api/admin/applications')
    .then((data) => {
      apps = data.applications;
      statuses = data.statuses;
      if (!['all', ...statuses].includes(filter)) filter = 'all';
      selectedId = apps[0]?.id ?? null;
      render();
    })
    .catch((e) => listEl.replaceChildren(h('p', { class: 'empty' }, `Couldn't load applications: ${e.message}`)));
})();
