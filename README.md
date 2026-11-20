# Date the Twins

A dating site for twins who want to go on a **double date with another pair of twins**. It goes live at **https://steeleyourheart.ca**.

- **Landing page** (`/`): features one pair of twins with Hinge-style profiles (photos, info, and prompts) and a call to action to apply.
- **Application builder** (`/apply`): a 5-step wizard. Applicants describe themselves as a pair, then each twin builds a profile (2–6 photos and 3 prompts), then they answer one prompt together. They preview the joint profile exactly as it will look, confirm they're 18+, and submit. Text progress autosaves in the browser.
- **Admin dashboard** (`/admin`): the featured twins log in to review applications, mark each one **Like / Maybe / Pass**, add private notes, see contact info, and delete applications.

## How it's built

| Piece | What it does |
|---|---|
| **GitHub Pages** | Hosts the website: the static files in `public/`. Free. |
| **Supabase** (free tier) | Database for applications, private storage for applicant photos, and logins for the admin page. |
| **GoDaddy** | Your domain. Its DNS points to GitHub Pages. |

All the security rules live in the database (`supabase/schema.sql`):
- **Visitors** can only upload photos and submit an application through one validated function. They can never read, list, or change anything.
- **Admins** (emails you list) can read applications, view photos through temporary signed links, update status and notes, and delete.

---

## Setup: going live

### 1. Create the Supabase project (~10 min)

1. Sign up at [supabase.com](https://supabase.com) and create a **New project**. Region **Canada (Central)** is a good fit. Save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole contents of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. You should see "Success". This creates the tables, the private photo bucket, and all the security rules.
3. **Create the admin logins** for your friends: **Authentication → Users → Add user → Create new user**. Enter their email and a password, and tick **Auto Confirm User**.
4. **Mark those users as admins.** In the SQL Editor, run this with their emails in lowercase:
   ```sql
   insert into dtt_private.admins (email) values ('friend1@example.com'), ('friend2@example.com');
   ```
5. **Turn off public sign-ups**: **Authentication → Sign In / Providers →** turn off **Allow new users to sign up**. Only the accounts you created can log in.
6. **Authentication → URL Configuration →** set **Site URL** to `https://steeleyourheart.ca`.
7. **Connect the website:** go to **Project Settings → API Keys** (or the **Connect** button) and copy the **Project URL** and the **anon / publishable** key into [`public/js/config.js`](public/js/config.js). The anon key is meant to be public. **Never** use the `service_role` / secret key.

> Supabase's free tier **pauses a project after 7 days with no activity**. Visits to the site count as activity. If it does pause, log in to Supabase and click **Restore**. The Pro plan ($25/mo) never pauses.

### 2. Turn on GitHub Pages

1. GitHub Pages needs the repository to be **public**, unless you're on GitHub Pro. To make it public: **Settings → General → Danger Zone → Change visibility → Public**. That's safe: the code has no secrets, and applicant data lives in Supabase, not in the repo.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Merge this code into `main`. The workflow in `.github/workflows/pages.yml` runs the database tests and then publishes `public/`. From then on, every push to `main` re-deploys.
4. **Settings → Pages → Custom domain:** enter `steeleyourheart.ca` and click **Save**.

### 3. Point steeleyourheart.ca at GitHub (GoDaddy)

In GoDaddy: **My Products → steeleyourheart.ca → DNS → DNS Records**.

1. **Delete** the existing `A` record for `@` (often "Parked"), and any **Forwarding** on the domain.
2. **Add** these records (TTL: default or 1 hour):

   | Type | Name | Value |
   |---|---|---|
   | A | @ | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | AAAA | @ | 2606:50c0:8000::153 |
   | AAAA | @ | 2606:50c0:8001::153 |
   | AAAA | @ | 2606:50c0:8002::153 |
   | AAAA | @ | 2606:50c0:8003::153 |
   | CNAME | www | williamgomez1.github.io |

   If a `www` CNAME already exists (GoDaddy usually adds one pointing to `@`), edit it instead of adding a second.
3. Wait for DNS to update (usually minutes, sometimes a few hours). Then in **GitHub → Settings → Pages**, tick **Enforce HTTPS** once it's available.
4. *Recommended:* verify the domain in your GitHub account (**profile Settings → Pages → Add a domain**). That adds one TXT record in GoDaddy and stops anyone else from claiming your domain on GitHub Pages.

---

## Customize the featured twins

Everything on the landing page comes from **`public/content/twins.json`**: names, ages, bios, prompts, photos, headline, and site name. You don't need to touch any code.

1. Put your friends' photos in `public/images/twins/` (JPG/PNG/WEBP; portrait 4:5 looks best, e.g. 1200×1500).
2. Update the `photos` paths, e.g. `"images/twins/jordan-1.jpg"` (no leading slash), and set `pairPhoto` for the hero image (landscape, ~5:4).
3. Commit and push to `main`. The site updates in about a minute.

The prompt lists and photo limits live in `public/js/options.js`. The database enforces the same limits in `supabase/schema.sql`, so if you change a limit, change it in both.

## Run it locally

```bash
npm start            # http://localhost:3000 (needs Node 18+, no npm install required)
```
If `public/js/config.js` has your Supabase keys, local submissions go to the real database.

`npm test` runs the database security tests against a throwaway local Postgres (needs PostgreSQL 15+ installed). GitHub runs the same tests before every deploy.

## Project layout

```
public/                     The website (what GitHub Pages serves)
  index.html, apply.html, admin.html, 404.html
  content/twins.json        Featured twins (edit me!)
  js/config.js              Supabase URL + anon key
  js/options.js             Prompt lists + limits
  js/common.js, landing.js, apply.js, admin.js
  vendor/supabase-*.js      Supabase client library (MIT licensed)
  images/                   Logo, placeholders, and your twins' photos
supabase/schema.sql         Database, storage, and security rules (run in Supabase)
supabase/test/              Tests for those rules
.github/workflows/pages.yml Deploys to GitHub Pages
scripts/                    Local dev server + placeholder image generator
```

## Good to know

- If a submission fails partway, some uploaded photos may never get attached to an application. They're harmless. To find them, run this in the SQL Editor:
  ```sql
  select name, created_at from storage.objects o
  where bucket_id = 'applicant-photos'
    and not exists (select 1 from public.application_photos p where p.path = o.name);
  ```
  You can delete them under **Storage → applicant-photos**.
- Admins can reset their password in Supabase (**Authentication → Users → … → Send password recovery**).
- Ideas for later: an email to the twins when a new application arrives (Supabase Database Webhooks + Resend), and support for multiple featured pairs.
