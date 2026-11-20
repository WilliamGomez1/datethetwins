(function () {
  const { h, renderPair, promptCard, pairName, icon, storage } = window.DTT;
  const DRAFT_KEY = 'dtt-application-draft-v1';
  const app = document.getElementById('app');

  // ---------- State ----------
  const blankTwin = () => ({
    name: '', age: '', pronouns: '', height: '', occupation: '', hometown: '', instagram: '',
    prompts: [{ prompt: '', answer: '' }, { prompt: '', answer: '' }, { prompt: '', answer: '' }],
  });
  const state = {
    pair: { twinType: '', city: '', prompt: { prompt: '', answer: '' }, why: '' },
    contact: { email: '', phone: '' },
    twins: [blankTwin(), blankTwin()],
    consent: { adults: false, agree: false },
  };
  const photos = [[], []]; // [{ blob, url, name }]

  let options;
  let step = 0;
  const STEPS = [
    { key: 'pair', label: 'About you two' },
    { key: 'twin0', label: 'First twin' },
    { key: 'twin1', label: 'Second twin' },
    { key: 'together', label: 'Together' },
    { key: 'preview', label: 'Preview & apply' },
  ];

  const getPath = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), state);
  function setPath(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], state)[last] = value;
  }

  function restoreDraft() {
    const draft = storage.get(DRAFT_KEY);
    if (!draft || typeof draft !== 'object') return;
    const merge = (target, src) => {
      for (const k of Object.keys(target)) {
        if (src == null || !(k in src)) continue;
        if (target[k] && typeof target[k] === 'object') merge(target[k], src[k]);
        else if (typeof src[k] === typeof target[k]) target[k] = src[k];
      }
    };
    merge(state, draft);
    state.consent = { adults: false, agree: false }; // always re-confirm
  }
  let saveTimer;
  const saveDraft = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => storage.set(DRAFT_KEY, state), 300); };

  // ---------- Form building blocks ----------
  const fieldEls = new Map(); // path -> .field element

  function field(path, label, control, { optional = false, hint, wrapper } = {}) {
    const id = 'f-' + path.replace(/\./g, '-');
    control.id = id;
    const err = h('p', { class: 'error-text', id: id + '-err', role: 'alert' });
    control.setAttribute('aria-describedby', id + '-err');
    const el = h('div', { class: 'field', dataset: { field: path } },
      h('label', { for: id }, label, optional ? h('span', { class: 'opt' }, ' (optional)') : null),
      wrapper || control,
      hint ? h('p', { class: 'hint' }, hint) : null,
      err);
    fieldEls.set(path, el);
    return el;
  }

  function bind(control, path, transform = (v) => v) {
    control.value = getPath(path) ?? '';
    control.addEventListener('input', () => {
      setPath(path, transform(control.value));
      clearError(path);
      saveDraft();
    });
    return control;
  }

  const input = (path, attrs = {}) => bind(h('input', { class: 'input', type: 'text', ...attrs }), path);

  function textarea(path, max) {
    const ta = bind(h('textarea', { class: 'textarea', maxlength: max, rows: 3 }), path);
    const count = h('p', { class: 'char-count' });
    const update = () => { count.textContent = `${ta.value.length}/${max}`; };
    ta.addEventListener('input', update);
    update();
    return { wrap: h('div', null, ta, count), ta };
  }

  function select(path, choices, placeholder) {
    const sel = h('select', { class: 'select' },
      h('option', { value: '' }, placeholder),
      choices.map((c) => h('option', { value: c }, c)));
    return bind(sel, path);
  }

  function chips(path, choices) {
    const name = 'r-' + path;
    const group = h('div', { class: 'chips', role: 'radiogroup' }, choices.map((c) => {
      const radio = h('input', { type: 'radio', name, value: c });
      radio.checked = getPath(path) === c;
      radio.addEventListener('change', () => { setPath(path, c); clearError(path); saveDraft(); });
      return h('label', { class: 'chip' }, radio, h('span', null, c));
    }));
    return group;
  }

  function promptBlock(basePath, choices, n) {
    const { wrap, ta } = textarea(`${basePath}.answer`, options.limits.maxLongText);
    ta.placeholder = 'Your answer…';
    const sel = select(`${basePath}.prompt`, choices, `Choose prompt ${n}…`);
    const selField = field(`${basePath}.prompt`, `Prompt ${n}`, sel);
    selField.querySelector('label').classList.add('visually-hidden');
    const ansField = field(`${basePath}.answer`, `Answer to prompt ${n}`, ta, { wrapper: wrap });
    ansField.querySelector('label').classList.add('visually-hidden');
    return h('div', { class: 'prompt-block' }, selField, ansField);
  }

  // ---------- Photos ----------
  const photoGrids = [];

  async function processPhoto(file) {
    if (file.type === 'image/gif') return file;
    const MAX = 1600;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new Error(`Couldn't read "${file.name}". Try a JPG or PNG.`);
    }
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
    if (!blob) throw new Error(`Couldn't process "${file.name}".`);
    return blob;
  }

  async function addPhotos(twinIdx, fileList) {
    const max = options.limits.maxPhotosPerTwin;
    const files = [...fileList].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/i.test(f.name));
    const room = max - photos[twinIdx].length;
    if (files.length > room) showError(`twins.${twinIdx}.photos`, `You can add up to ${max} photos. Only the first ${room} were added.`);
    else clearError(`twins.${twinIdx}.photos`);
    for (const f of files.slice(0, Math.max(0, room))) {
      try {
        const blob = await processPhoto(f);
        if (blob.size > options.limits.maxPhotoBytes) throw new Error(`"${f.name}" is too large.`);
        photos[twinIdx].push({ blob, url: URL.createObjectURL(blob), name: f.name });
      } catch (e) {
        showError(`twins.${twinIdx}.photos`, e.message);
      }
      renderPhotoGrid(twinIdx);
    }
  }

  function renderPhotoGrid(twinIdx) {
    const grid = photoGrids[twinIdx];
    const list = photos[twinIdx];
    const max = options.limits.maxPhotosPerTwin;
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', tabindex: '-1' });
    fileInput.addEventListener('change', () => { addPhotos(twinIdx, fileInput.files); fileInput.value = ''; });
    const slots = [];
    for (let i = 0; i < max; i++) {
      const p = list[i];
      if (p) {
        slots.push(h('div', { class: 'photo-slot filled' },
          h('img', { src: p.url, alt: `Photo ${i + 1}` }),
          i === 0 ? h('span', { class: 'main-tag' }, 'Main') : null,
          h('button', {
            type: 'button', class: 'remove', 'aria-label': `Remove photo ${i + 1}`,
            onclick: () => { URL.revokeObjectURL(p.url); list.splice(i, 1); renderPhotoGrid(twinIdx); },
          }, '×')));
      } else {
        slots.push(h('button', {
          type: 'button', class: 'photo-slot', 'aria-label': 'Add photos',
          onclick: () => fileInput.click(),
        }, h('span', { class: 'plus', 'aria-hidden': 'true' }, '+')));
      }
    }
    grid.replaceChildren(...slots, fileInput);
  }

  // ---------- Steps ----------
  function stepPair() {
    return h('section', { class: 'step-panel' },
      h('h1', null, 'Apply for a double date'),
      h('p', { class: 'sub' }, "You'll build one joint profile for you and your twin. It takes about 10 minutes. Your progress saves on this device (except photos)."),
      h('fieldset', { class: 'fieldset' },
        h('legend', null, 'About you two'),
        h('p', { class: 'hint' }, 'The basics, so the twins know who they might be meeting.'),
        h('div', { class: 'field', dataset: { field: 'pair.twinType' } },
          h('span', { class: 'label' }, 'What kind of twins are you?'),
          chips('pair.twinType', options.twinTypes),
          errorEl('pair.twinType')),
        h('div', { class: 'grid-2' },
          field('pair.city', 'Where do you live?', input('pair.city', { autocomplete: 'address-level2', placeholder: 'City, State', maxlength: 60 })))),
      h('fieldset', { class: 'fieldset' },
        h('legend', null, 'How we reach you'),
        h('p', { class: 'hint' }, "Only the featured twins and site admin see this. We'll use it if it's a match."),
        h('div', { class: 'grid-2' },
          field('contact.email', 'Email', input('contact.email', { type: 'email', autocomplete: 'email', inputmode: 'email', maxlength: 120 })),
          field('contact.phone', 'Phone', input('contact.phone', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 30 }), { optional: true }))));
  }

  function errorEl(path) {
    const el = h('p', { class: 'error-text', role: 'alert' });
    el.dataset.errorFor = path;
    return el;
  }

  function stepTwin(i) {
    const p = `twins.${i}`;
    const grid = h('div', { class: 'photo-grid' });
    photoGrids[i] = grid;
    renderPhotoGrid(i);
    const L = options.limits;
    return h('section', { class: 'step-panel' },
      h('h1', null, i === 0 ? 'First twin' : 'Now the other twin'),
      h('p', { class: 'sub' }, i === 0
        ? 'Each of you gets your own profile, just like on a dating app.'
        : 'Pass the phone (or laptop) to your twin.'),
      h('fieldset', { class: 'fieldset' },
        h('legend', null, 'Basics'),
        h('div', { class: 'grid-2' },
          field(`${p}.name`, 'First name', input(`${p}.name`, { autocomplete: 'off', maxlength: 40 })),
          field(`${p}.age`, 'Age', bind(h('input', { class: 'input', type: 'number', min: L.minAge, max: L.maxAge, inputmode: 'numeric' }), `${p}.age`)),
          field(`${p}.pronouns`, 'Pronouns', input(`${p}.pronouns`, { placeholder: 'e.g. she/her', maxlength: 30 }), { optional: true }),
          field(`${p}.height`, 'Height', input(`${p}.height`, { placeholder: `e.g. 5'9"`, maxlength: 20 }), { optional: true }),
          field(`${p}.occupation`, 'Job or school', input(`${p}.occupation`, { maxlength: L.maxShortText }), { optional: true }),
          field(`${p}.hometown`, 'Hometown', input(`${p}.hometown`, { maxlength: L.maxShortText }), { optional: true }),
          field(`${p}.instagram`, 'Instagram', input(`${p}.instagram`, { placeholder: '@handle', maxlength: 40 }), { optional: true }))),
      h('fieldset', { class: 'fieldset' },
        h('legend', null, 'Photos'),
        h('p', { class: 'hint' }, `Add ${L.minPhotosPerTwin}–${L.maxPhotosPerTwin} photos. The first one is your main photo. Clear, recent, and smiling works best.`),
        h('div', { class: 'field', dataset: { field: `${p}.photos` } }, grid, errorEl(`${p}.photos`))),
      h('fieldset', { class: 'fieldset' },
        h('legend', null, 'Prompts'),
        h('p', { class: 'hint' }, `Pick ${L.promptsPerTwin} different prompts and make them yours.`),
        h('div', { class: 'field', dataset: { field: `${p}.prompts` } }, errorEl(`${p}.prompts`)),
        [0, 1, 2].map((j) => promptBlock(`${p}.prompts.${j}`, options.twinPrompts, j + 1))));
  }

  function stepTogether() {
    const { wrap: whyWrap, ta: whyTa } = textarea('pair.why', options.limits.maxLongText);
    whyTa.placeholder = 'Make your case!';
    const whyField = field('pair.why', 'Why do you two want to go on a double date with them?', whyTa, { wrapper: whyWrap });
    return h('section', { class: 'step-panel' },
      h('h1', null, 'Together'),
      h('p', { class: 'sub' }, 'One answer from both of you. This shows up on your joint profile.'),
      h('fieldset', { class: 'fieldset' },
        h('legend', null, 'Your joint prompt'),
        h('p', { class: 'hint' }, 'Pick one and answer it together.'),
        promptBlock('pair.prompt', options.pairPrompts, 1)),
      h('fieldset', { class: 'fieldset' },
        h('legend', null, 'Your pitch'),
        h('p', { class: 'hint' }, 'Only the featured twins see this.'),
        whyField));
  }

  const previewMount = h('div', { class: 'preview' });
  function stepPreview() {
    const consent = (key, text) => {
      const box = h('input', { type: 'checkbox' });
      box.checked = state.consent[key];
      box.addEventListener('change', () => { state.consent[key] = box.checked; clearError(`consent.${key}`); });
      return h('div', { class: 'field', dataset: { field: `consent.${key}` } },
        h('label', { class: 'check' }, box, h('span', null, text)),
        errorEl(`consent.${key}`));
    };
    return h('section', { class: 'step-panel' },
      h('h1', null, 'Preview your profile'),
      h('p', { class: 'sub' }, 'This is exactly what the twins will see. Go back to make changes.'),
      previewMount,
      h('fieldset', { class: 'fieldset' },
        h('legend', null, 'Before you apply'),
        consent('adults', 'We are both 18 or older.'),
        consent('agree', 'We both agree to apply, the photos are of us, and we’re OK with the featured twins and site admin seeing this profile.')));
  }

  function renderPreview() {
    const twins = state.twins.map((t) => ({ ...t, age: Number(t.age) || '' }));
    previewMount.replaceChildren(
      h('p', { class: 'preview-note' }, `${pairName(twins)} · ${state.pair.twinType || 'Twins'}${state.pair.city ? ' · ' + state.pair.city : ''}`),
      renderPair(twins, photos.map((list) => list.map((p) => p.url))),
      state.pair.prompt.prompt ? promptCard(state.pair.prompt, null, 'From both of us') : null,
      h('div', { class: 'card prompt-card' },
        h('span', { class: 'pair-label' }, 'Only the twins see this'),
        h('p', { class: 'prompt' }, 'Why us'),
        h('p', { class: 'answer' }, state.pair.why)));
  }

  // ---------- Validation (mirrors src/validate.js) ----------
  function showError(path, msg) {
    const target = document.querySelector(`[data-error-for="${CSS.escape(path)}"]`)
      || fieldEls.get(path)?.querySelector('.error-text');
    if (target) target.textContent = msg;
    const f = fieldEls.get(path) || document.querySelector(`[data-field="${CSS.escape(path)}"]`);
    f?.classList.add('invalid');
  }
  function clearError(path) {
    const target = document.querySelector(`[data-error-for="${CSS.escape(path)}"]`)
      || fieldEls.get(path)?.querySelector('.error-text');
    if (target) target.textContent = '';
    (fieldEls.get(path) || document.querySelector(`[data-field="${CSS.escape(path)}"]`))?.classList.remove('invalid');
  }
  function clearAllErrors() {
    document.querySelectorAll('.error-text').forEach((e) => { e.textContent = ''; });
    document.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
    alertEl.textContent = '';
  }

  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

  function validateStep(idx) {
    const errs = [];
    const need = (cond, path, msg) => { if (!cond) errs.push([path, msg]); };
    const L = options.limits;
    const filled = (path) => String(getPath(path) || '').trim().length > 0;
    if (idx === 0) {
      need(filled('pair.twinType'), 'pair.twinType', 'Choose one.');
      need(filled('pair.city'), 'pair.city', 'Where do you live?');
      need(isEmail(state.contact.email), 'contact.email', 'Enter a valid email address.');
      need(!state.contact.phone.trim() || /^[0-9+()\-.\s]{7,30}$/.test(state.contact.phone.trim()), 'contact.phone', 'Enter a valid phone number.');
    } else if (idx === 1 || idx === 2) {
      const i = idx - 1;
      const p = `twins.${i}`;
      const t = state.twins[i];
      need(filled(`${p}.name`), `${p}.name`, 'What’s your first name?');
      const age = Number(t.age);
      need(Number.isInteger(age) && age >= L.minAge && age <= L.maxAge, `${p}.age`, `You must be ${L.minAge} or older.`);
      need(photos[i].length >= L.minPhotosPerTwin, `${p}.photos`, `Add at least ${L.minPhotosPerTwin} photos.`);
      const seen = new Set();
      t.prompts.forEach((pr, j) => {
        need(pr.prompt, `${p}.prompts.${j}.prompt`, 'Choose a prompt.');
        if (pr.prompt) need(!seen.has(pr.prompt), `${p}.prompts.${j}.prompt`, 'Pick a different prompt.');
        seen.add(pr.prompt);
        need(pr.answer.trim(), `${p}.prompts.${j}.answer`, 'Write an answer.');
      });
    } else if (idx === 3) {
      need(state.pair.prompt.prompt, 'pair.prompt.prompt', 'Choose a prompt.');
      need(state.pair.prompt.answer.trim(), 'pair.prompt.answer', 'Write an answer.');
      need(state.pair.why.trim(), 'pair.why', 'Tell them why!');
    } else if (idx === 4) {
      need(state.consent.adults, 'consent.adults', 'Both of you must be 18 or older.');
      need(state.consent.agree, 'consent.agree', 'Please confirm to apply.');
    }
    errs.forEach(([path, msg]) => showError(path, msg));
    return errs;
  }

  function stepForPath(path) {
    if (path.startsWith('twins.0')) return 1;
    if (path.startsWith('twins.1')) return 2;
    if (path === 'pair.why' || path.startsWith('pair.prompt')) return 3;
    if (path.startsWith('consent')) return 4;
    return 0;
  }

  function focusFirstError() {
    const f = document.querySelector('.step-panel:not([hidden]) .invalid');
    if (!f) return;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    f.querySelector('input:not([type=file]), select, textarea, button')?.focus({ preventScroll: true });
  }

  // ---------- Shell / navigation ----------
  const progress = h('div', { class: 'progress', 'aria-hidden': 'true' }, STEPS.map(() => h('span')));
  const progressLabel = h('p', { class: 'progress-label' });
  const alertEl = h('div', { class: 'form-alert', role: 'alert' });
  const backBtn = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Back');
  const nextBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Next');
  let panels = [];

  function goTo(idx, { scroll = true } = {}) {
    step = idx;
    panels.forEach((p, i) => { p.hidden = i !== idx; });
    [...progress.children].forEach((s, i) => s.classList.toggle('done', i <= idx));
    progressLabel.textContent = `Step ${idx + 1} of ${STEPS.length} · ${STEPS[idx].label}`;
    backBtn.hidden = idx === 0;
    nextBtn.textContent = idx === STEPS.length - 1 ? 'Submit application' : idx === STEPS.length - 2 ? 'Preview' : 'Next';
    if (idx === 4) renderPreview();
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    nextBtn.disabled = true;
    backBtn.disabled = true;
    nextBtn.textContent = 'Submitting…';
    const fd = new FormData();
    const payload = { ...state, twins: state.twins.map((t) => ({ ...t, age: Number(t.age) })) };
    fd.append('profile', JSON.stringify(payload));
    photos.forEach((list, i) => list.forEach((p, j) => {
      const ext = p.blob.type === 'image/gif' ? 'gif' : 'jpg';
      fd.append(`photos${i}`, p.blob, `twin${i + 1}-photo${j + 1}.${ext}`);
    }));
    try {
      const res = await fetch('/api/applications', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(body.fields) && body.fields.length) {
          const target = Math.min(...body.fields.map((f) => stepForPath(f.field)));
          step = target;
          body.fields.forEach((f) => showError(f.field, f.message));
          setTimeout(focusFirstError, 50);
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        alertEl.textContent = body.error || 'Something went wrong. Please try again.';
        return;
      }
      storage.remove(DRAFT_KEY);
      showSuccess();
    } catch {
      alertEl.textContent = 'Network error. Check your connection and try again.';
    } finally {
      nextBtn.disabled = false;
      backBtn.disabled = false;
      if (document.body.contains(nextBtn)) {
        const msg = alertEl.textContent;
        goTo(step, { scroll: false });
        alertEl.textContent = msg;
      }
    }
  }

  function showSuccess() {
    const heart = icon('heart', { filled: true });
    heart.classList.add('big-heart');
    app.replaceChildren(h('section', { class: 'success' },
      heart,
      h('h1', null, 'Application sent!'),
      h('p', null, `Thanks, ${pairName(state.twins)}. The twins will read your profile, and if it’s a match we’ll reach out at ${state.contact.email}.`),
      h('a', { class: 'btn btn-primary', href: '/' }, 'Back to home')));
    window.scrollTo({ top: 0 });
  }

  function build() {
    restoreDraft();
    panels = [stepPair(), stepTwin(0), stepTwin(1), stepTogether(), stepPreview()];
    const form = h('form', { novalidate: true },
      progress, progressLabel, alertEl, ...panels,
      h('div', { class: 'step-nav' }, backBtn, h('span', { class: 'spacer' }), nextBtn));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearAllErrors();
      if (validateStep(step).length) {
        focusFirstError();
        return;
      }
      if (step < STEPS.length - 1) goTo(step + 1);
      else submit();
    });
    backBtn.addEventListener('click', () => { clearAllErrors(); goTo(Math.max(0, step - 1)); });
    app.replaceChildren(form);
    goTo(0, { scroll: false });
  }

  fetch('/api/options')
    .then((r) => r.json())
    .then((o) => { options = o; build(); })
    .catch(() => { app.replaceChildren(h('p', { class: 'empty' }, "Couldn't load the application. Please refresh.")); });
})();
