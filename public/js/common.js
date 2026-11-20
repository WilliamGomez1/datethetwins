/* Shared helpers + Hinge-style profile rendering. All text goes through
   textContent (never innerHTML) so user-submitted content can't inject HTML. */
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ICON_PATHS = {
    heart: 'M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z',
    cake: 'M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M5 16c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0M12 12V8M12 5.5c.8-.8.8-1.7 0-2.5-.8.8-.8 1.7 0 2.5z',
    ruler: 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
    briefcase: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
    home: 'M3 11 12 4l9 7M5 10v10h14V10',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
    pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    twins: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 2.7-5 6-5s6 2 6 5M10 20c0-3 2.7-5 6-5s6 2 6 5',
  };

  function icon(name, { filled = false } = {}) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', filled ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', filled ? '0' : '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.append(path);
    return svg;
  }

  function likeButton(likeHref, label) {
    if (!likeHref) return null;
    return h('a', { class: 'like-btn', href: likeHref, 'aria-label': label }, icon('heart', { filled: true }));
  }

  function photoCard(src, alt, likeHref) {
    return h('div', { class: 'card photo-card' },
      h('img', { src, alt, loading: 'lazy', decoding: 'async' }),
      likeButton(likeHref, `Like ${alt}`));
  }

  function promptCard(p, likeHref, label) {
    return h('div', { class: 'card prompt-card' },
      label ? h('span', { class: 'pair-label' }, label) : null,
      h('p', { class: 'prompt' }, p.prompt),
      h('p', { class: 'answer' }, p.answer),
      likeButton(likeHref, `Like answer to "${p.prompt}"`));
  }

  function infoCard(twin) {
    const items = [
      twin.age && ['cake', String(twin.age)],
      twin.pronouns && ['person', twin.pronouns],
      twin.height && ['ruler', twin.height],
    ].filter(Boolean);
    const list = [
      twin.occupation && ['briefcase', twin.occupation],
      twin.hometown && ['home', twin.hometown],
      twin.instagram && ['camera', '@' + twin.instagram],
    ].filter(Boolean);
    const item = ([ic, text]) => h('div', { class: 'info-item' }, icon(ic), h('span', null, text));
    if (!items.length && !list.length) return null;
    return h('div', { class: 'card info-card' },
      items.length ? h('div', { class: 'info-row' }, items.map(item)) : null,
      list.length ? h('div', { class: 'info-list' }, list.map(item)) : null);
  }

  /**
   * Renders one twin as a Hinge-style vertical profile:
   * header, photo, info, prompt, photo, prompt, photo, prompt, remaining photos.
   */
  function renderTwinProfile(twin, photos, { likeHref } = {}) {
    const name = twin.name || 'Twin';
    const header = h('div', { class: 'profile-header' },
      h('h3', null, name),
      twin.pronouns ? h('span', { class: 'meta' }, twin.pronouns) : null);
    const blocks = [header];
    const ps = photos || [];
    const prompts = (twin.prompts || []).filter((p) => p && p.prompt && p.answer);
    if (ps[0]) blocks.push(photoCard(ps[0], `${name}, photo 1`, likeHref));
    blocks.push(infoCard(twin));
    let pi = 1;
    prompts.forEach((p) => {
      blocks.push(promptCard(p, likeHref));
      if (ps[pi]) { blocks.push(photoCard(ps[pi], `${name}, photo ${pi + 1}`, likeHref)); pi++; }
    });
    for (; pi < ps.length; pi++) blocks.push(photoCard(ps[pi], `${name}, photo ${pi + 1}`, likeHref));
    return h('article', { class: 'profile', 'aria-label': `${name}'s profile` }, blocks.filter(Boolean));
  }

  /** Two profiles side by side (tabs on small screens). */
  function renderPair(twins, photoLists, opts = {}) {
    const profiles = h('div', { class: 'profiles', dataset: { active: '0' } },
      twins.map((t, i) => renderTwinProfile(t, photoLists[i], opts)));
    const buttons = twins.map((t, i) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(i === 0),
      onclick: () => {
        profiles.dataset.active = String(i);
        buttons.forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
      },
    }, t.name || `Twin ${i + 1}`));
    const tabs = h('div', { class: 'twin-tabs', role: 'tablist', 'aria-label': 'Choose a twin' }, buttons);
    return h('div', null, tabs, profiles);
  }

  function pairName(twins) {
    return twins.map((t) => t.name || '?').join(' & ');
  }

  function navScrollShadow() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const update = () => nav.classList.toggle('scrolled', window.scrollY > 4);
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  const storage = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  // Supabase client (null until public/js/config.js is filled in).
  let client;
  function getSupabase() {
    if (client !== undefined) return client;
    const cfg = window.DTT_CONFIG || {};
    client = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
      ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
      : null;
    return client;
  }

  window.DTT = { h, icon, renderTwinProfile, renderPair, promptCard, pairName, navScrollShadow, storage, getSupabase };
  document.addEventListener('DOMContentLoaded', navScrollShadow);
})();
