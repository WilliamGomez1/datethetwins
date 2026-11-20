const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const options = require('./src/options');
const { openDb, STATUSES } = require('./src/db');
const { validateProfile, ValidationError } = require('./src/validate');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const FEATURED_FILE = path.join(ROOT, 'content', 'twins.json');

// Detect real image types from file contents (never trust the browser's mime type).
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return null;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function basicAuth({ user, password }) {
  return (req, res, next) => {
    if (!password) {
      return res.status(503).send('Admin is disabled: set the ADMIN_PASSWORD environment variable.');
    }
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx !== -1 && safeEqual(decoded.slice(0, idx), user) && safeEqual(decoded.slice(idx + 1), password)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Date the Twins admin", charset="UTF-8"');
    return res.status(401).send('Authentication required.');
  };
}

// Tiny in-memory rate limiter (fine for a single server instance).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'Too many submissions from this device. Please try again later.' });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

function createApp(config = {}) {
  const dataDir = config.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data');
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const isProd = process.env.NODE_ENV === 'production';
  let adminPassword = config.adminPassword ?? process.env.ADMIN_PASSWORD;
  if (!adminPassword && !isProd) {
    adminPassword = 'changeme';
    if (!config.quiet) console.warn('[warn] ADMIN_PASSWORD not set; using "changeme" for local development.');
  }
  const adminUser = config.adminUser || process.env.ADMIN_USER || 'admin';

  const db = openDb(dataDir);
  const app = express();
  app.locals.db = db;

  app.disable('x-powered-by');
  if (isProd || process.env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "script-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    next();
  });

  app.use(express.json({ limit: '50kb' }));

  // ---------- Public API ----------
  app.get('/api/featured', (req, res, next) => {
    fs.readFile(FEATURED_FILE, 'utf8', (err, txt) => {
      if (err) return next(err);
      try {
        res.json(JSON.parse(txt));
      } catch (e) {
        next(new Error(`content/twins.json is not valid JSON: ${e.message}`));
      }
    });
  });

  app.get('/api/options', (req, res) => res.json(options));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: options.limits.maxPhotoBytes,
      files: options.limits.maxPhotosPerTwin * 2,
      fields: 5,
      fieldSize: 100 * 1024,
    },
  });

  const submitLimiter = config.disableRateLimit ? (req, res, next) => next() : rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

  app.post(
    '/api/applications',
    submitLimiter,
    upload.fields([
      { name: 'photos0', maxCount: options.limits.maxPhotosPerTwin },
      { name: 'photos1', maxCount: options.limits.maxPhotosPerTwin },
    ]),
    (req, res, next) => {
      let raw;
      try {
        raw = JSON.parse(req.body.profile || '');
      } catch {
        return res.status(400).json({ error: 'Profile data is missing or malformed.' });
      }

      const files = [req.files?.photos0 || [], req.files?.photos1 || []];
      let profile;
      try {
        profile = validateProfile(raw, files.map((f) => f.length));
      } catch (err) {
        if (err instanceof ValidationError) {
          return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: err.errors });
        }
        return next(err);
      }

      // Verify every upload is a real image before writing anything to disk.
      const typed = files.map((list) => list.map((f) => ({ f, ext: sniffImage(f.buffer) })));
      const bad = typed.flat().find((x) => !x.ext);
      if (bad) {
        return res.status(400).json({ error: `"${bad.f.originalname}" isn't a supported image. Use JPG, PNG, WEBP or GIF.` });
      }

      const written = [];
      try {
        typed.forEach((list, i) => {
          profile.twins[i].photos = list.map(({ f, ext }) => {
            const name = `${crypto.randomUUID()}.${ext}`;
            fs.writeFileSync(path.join(uploadsDir, name), f.buffer);
            written.push(name);
            return `/uploads/${name}`;
          });
        });
        const id = db.insert(profile);
        res.status(201).json({ id });
      } catch (err) {
        written.forEach((n) => fs.rm(path.join(uploadsDir, n), { force: true }, () => {}));
        next(err);
      }
    },
  );

  // ---------- Admin (HTTP Basic Auth) ----------
  const requireAdmin = basicAuth({ user: adminUser, password: adminPassword });

  app.get(['/admin', '/admin.html'], requireAdmin, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
  });

  app.use('/uploads', requireAdmin, express.static(uploadsDir, {
    fallthrough: false,
    setHeaders: (res) => res.set('Cache-Control', 'private, max-age=3600'),
  }));

  app.get('/api/admin/applications', requireAdmin, (req, res) => {
    res.json({ statuses: STATUSES, applications: db.list() });
  });

  app.patch('/api/admin/applications/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const { status, notes } = req.body || {};
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
    }
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) {
      return res.status(400).json({ error: 'Notes must be text under 2000 characters.' });
    }
    const updated = db.update(id, { status, notes });
    if (!updated) return res.status(404).json({ error: 'Application not found.' });
    res.json(updated);
  });

  app.delete('/api/admin/applications/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const existing = db.get(id);
    if (!existing) return res.status(404).json({ error: 'Application not found.' });
    for (const twin of existing.profile.twins) {
      for (const p of twin.photos || []) {
        fs.rm(path.join(uploadsDir, path.basename(p)), { force: true }, () => {});
      }
    }
    db.remove(id);
    res.status(204).end();
  });

  // ---------- Static site ----------
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html' }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: `Each photo must be under ${options.limits.maxPhotoBytes / 1024 / 1024} MB.`,
        LIMIT_FILE_COUNT: `Too many photos (max ${options.limits.maxPhotosPerTwin} per twin).`,
        LIMIT_UNEXPECTED_FILE: `Too many photos (max ${options.limits.maxPhotosPerTwin} per twin).`,
      };
      return res.status(400).json({ error: messages[err.code] || err.message });
    }
    console.error(err);
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong on our end.' });
    res.status(500).send('Something went wrong on our end.');
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`Date the Twins running at http://localhost:${port}`);
    console.log(`Admin dashboard:            http://localhost:${port}/admin`);
  });
}

module.exports = { createApp, sniffImage };
