(function () {
  const { h, renderPair, promptCard, pairName } = window.DTT;
  const $$ = (sel) => document.querySelectorAll(sel);
  const setText = (sel, text) => $$(sel).forEach((el) => { el.textContent = text; });

  setText('[data-year]', new Date().getFullYear());

  fetch('content/twins.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then((data) => {
      const names = pairName(data.twins);
      if (data.siteName) { setText('[data-site-name]', data.siteName); document.title = data.siteName; }
      if (data.subhead) setText('[data-subhead]', data.subhead);
      if (data.headline) {
        // Italicise everything after the first comma for a bit of flair.
        const el = document.querySelector('[data-headline]');
        const idx = data.headline.indexOf(',');
        el.textContent = '';
        if (idx > 0) el.append(data.headline.slice(0, idx + 1) + ' ', h('em', null, data.headline.slice(idx + 1).trim()));
        else el.textContent = data.headline;
      }
      setText('[data-pair-name]', names);
      const ages = [...new Set(data.twins.map((t) => t.age))].join(' & ');
      setText('[data-pair-meta]', [data.twinType && `${data.twinType} twins`, ages, data.city].filter(Boolean).join(' · '));
      const pairImg = document.querySelector('[data-pair-photo]');
      if (data.pairPhoto) pairImg.src = data.pairPhoto;
      pairImg.alt = names;

      document.querySelector('[data-profiles]')
        .replaceChildren(renderPair(data.twins, data.twins.map((t) => t.photos), { likeHref: 'apply' }));

      const shared = document.querySelector('[data-pair-prompts]');
      (data.sharedPrompts || []).forEach((p) => shared.append(promptCard(p, 'apply', 'From both of us')));
    })
    .catch((err) => {
      console.error(err);
      document.querySelector('[data-profiles]')
        .replaceChildren(h('p', { class: 'empty' }, "Couldn't load the profiles. Please refresh."));
    });
})();
