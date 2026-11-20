const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

// Smallest valid PNG (1x1 transparent).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let server;
let base;
let dataDir;
const auth = 'Basic ' + Buffer.from('admin:secret').toString('base64');

function validProfile() {
  const twin = (name) => ({
    name, age: 25, pronouns: 'he/him', occupation: 'Chef',
    prompts: [
      { prompt: 'The way to win me over is', answer: 'Tacos' },
      { prompt: "I'm known for", answer: 'Being late' },
      { prompt: 'Typical Sunday', answer: 'Brunch' },
    ],
  });
  return {
    twins: [twin('Ana'), twin('Bea')],
    pair: { twinType: 'Identical', city: 'Chicago', prompt: { prompt: 'Our ideal double date', answer: 'Bowling' }, why: 'We are fun' },
    contact: { email: 'TWINS@example.com', phone: '' },
    consent: { adults: true, agree: true },
  };
}

function form(profile, { photos = [2, 2], file = PNG } = {}) {
  const fd = new FormData();
  fd.append('profile', JSON.stringify(profile));
  photos.forEach((n, i) => {
    for (let j = 0; j < n; j++) fd.append(`photos${i}`, new Blob([file], { type: 'image/png' }), `p${j}.png`);
  });
  return fd;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtt-test-'));
  const app = createApp({ dataDir, adminPassword: 'secret', quiet: true, disableRateLimit: true });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('serves landing page, apply page and featured twins', async () => {
  for (const p of ['/', '/apply']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /Date the Twins/);
  }
  const featured = await (await fetch(base + '/api/featured')).json();
  assert.equal(featured.twins.length, 2);
  assert.equal((await fetch(base + '/nope')).status, 404);
});

test('accepts a valid application and stores photos', async () => {
  const r = await fetch(base + '/api/applications', { method: 'POST', body: form(validProfile()) });
  assert.equal(r.status, 201, await r.clone().text());
  const { id } = await r.json();
  assert.ok(id > 0);

  const list = await (await fetch(base + '/api/admin/applications', { headers: { authorization: auth } })).json();
  const app = list.applications.find((a) => a.id === id);
  assert.equal(app.status, 'new');
  assert.equal(app.profile.contact.email, 'twins@example.com');
  assert.equal(app.profile.twins[0].photos.length, 2);

  const photo = await fetch(base + app.profile.twins[0].photos[0], { headers: { authorization: auth } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');
});

test('rejects invalid applications with field errors', async () => {
  const p = validProfile();
  p.twins[1].age = 17;
  p.consent.adults = false;
  p.twins[0].prompts[1].prompt = p.twins[0].prompts[0].prompt;
  const r = await fetch(base + '/api/applications', { method: 'POST', body: form(p, { photos: [2, 1] }) });
  assert.equal(r.status, 400);
  const fields = (await r.json()).fields.map((f) => f.field);
  for (const f of ['twins.1.age', 'consent.adults', 'twins.0.prompts.1.prompt', 'twins.1.photos']) {
    assert.ok(fields.includes(f), `expected error for ${f}, got ${fields}`);
  }
});

test('rejects files that are not images', async () => {
  const r = await fetch(base + '/api/applications', {
    method: 'POST', body: form(validProfile(), { file: Buffer.from('<html><script>alert(1)</script></html>') }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /isn't a supported image/);
});

test('admin routes and photos require auth', async () => {
  assert.equal((await fetch(base + '/admin')).status, 401);
  assert.equal((await fetch(base + '/api/admin/applications')).status, 401);
  assert.equal((await fetch(base + '/uploads/whatever.png')).status, 401);
  const wrong = 'Basic ' + Buffer.from('admin:nope').toString('base64');
  assert.equal((await fetch(base + '/admin', { headers: { authorization: wrong } })).status, 401);
  assert.equal((await fetch(base + '/admin', { headers: { authorization: auth } })).status, 200);
});

test('admin can update status/notes and delete', async () => {
  const { id } = await (await fetch(base + '/api/applications', { method: 'POST', body: form(validProfile()) })).json();
  const patch = (body) => fetch(`${base}/api/admin/applications/${id}`, {
    method: 'PATCH', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let r = await patch({ status: 'liked', notes: 'cute' });
  assert.equal(r.status, 200);
  const updated = await r.json();
  assert.equal(updated.status, 'liked');
  assert.equal(updated.notes, 'cute');
  assert.equal((await patch({ status: 'bogus' })).status, 400);

  const photoFile = path.join(dataDir, 'uploads', path.basename(updated.profile.twins[0].photos[0]));
  assert.ok(fs.existsSync(photoFile));
  r = await fetch(`${base}/api/admin/applications/${id}`, { method: 'DELETE', headers: { authorization: auth } });
  assert.equal(r.status, 204);
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(!fs.existsSync(photoFile), 'photos removed with application');
  assert.equal((await patch({ status: 'liked' })).status, 404);
});
