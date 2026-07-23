# Deploying the Alphabet City Project on DigitalOcean

This is a standard **Django + Gunicorn + WhiteNoise** app. The three.js front-end
is **pre-built and committed** (`alphabetcity/static/alphabetcity/index/`), so a
deploy only needs Python — no Node on the server.

- **Repo root:** `AlphabetCityProject/`
- **Django project dir (the "source directory"):** `djangotutorial/`
  (contains `manage.py`, `mysite/`, `alphabetcity/`, `requirements.txt`)
- **WSGI app:** `mysite.wsgi:application`
- **Python:** 3.12+ (Django 6.0 requires it)

---

## App Platform or a Droplet?

**Both work, but the deciding factor is the database.**

The app currently uses **SQLite** (a file on disk). App Platform containers have an
**ephemeral filesystem** — the disk is wiped on every deploy, restart, and scale.
So on App Platform, **SQLite would lose all answers/residents/sessions** on each
redeploy. There is no persistent block storage for App Platform app containers.

| | **Droplet (recommended for you)** | **App Platform** |
|---|---|---|
| Database | Keep **SQLite** on the droplet's persistent disk (free) | Must use a **Managed Postgres** DB (extra $/mo) |
| Cost | Cheapest — one small droplet (~$6/mo) hosts everything | App instance + managed DB |
| Control | Full (nginx, systemd, cron, backups) | Managed; less control |
| Maintenance | You patch/manage the server | DO manages the runtime |
| Auto-deploy from git | Set up yourself (or `git pull`) | Built in |

**Recommendation:** given you want to keep costs down and the app is low-traffic,
go with a **Droplet + SQLite** (Option A). It's the cheapest, keeps your existing
database as-is, and gives you the fine control you asked about. Choose **App
Platform** (Option B) only if you'd rather pay for a managed Postgres and never
touch a server — in that case SQLite is not an option and you must migrate to
Postgres.

Both options share the same one-time code prep below.

---

## 0. One-time code prep (already partly done)

These are in the repo now — listed so you know what changed and why:

- `settings.py`: removed the hard-coded `DEBUG = True`; `DEBUG`, `ALLOWED_HOSTS`,
  `CSRF_TRUSTED_ORIGINS` now come from the environment; added
  `SECURE_PROXY_SSL_HEADER` and secure-cookie/SSL-redirect settings that switch on
  when `DEBUG=False`.
- `requirements.txt`: pinned `Django>=6.0,<6.1`, **removed `mysqlclient`** (it needs
  system libraries and breaks the build; you aren't using MySQL), added
  `psycopg[binary]` for the Postgres path.

**Generate a production `SECRET_KEY`** (do NOT reuse the dev one):

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

**Rebuild the front-end only if you changed anything under `djangotutorial/frontend/`:**

```bash
cd djangotutorial/frontend
npm install        # first time only
npm run build      # writes into alphabetcity/static/alphabetcity/index/
cd ..
git add alphabetcity/static/alphabetcity/index
git commit -m "Rebuild front-end bundle"
```

**Stop shipping the dev database.** `db.sqlite3` is currently committed, which
would overwrite the server's live DB on every `git pull`. Untrack it:

```bash
cd djangotutorial
git rm --cached db.sqlite3
printf "\ndb.sqlite3\nstaticfiles/\n__pycache__/\n*.pyc\n" >> ../.gitignore   # .gitignore lives at the repo root
git commit -am "Stop tracking the local database and build artifacts"
```

Push everything to GitHub before deploying.

---

## Option A — Droplet + SQLite (recommended)

### A1. Create the droplet
- DigitalOcean → Create → Droplet.
- Image: **Ubuntu 24.04 LTS**. Size: Basic / Regular, the **$6/mo** (1 GB) is fine.
- Add your SSH key. Create, then note the public IP.
- (Optional) Point your domain's `A` record at the droplet IP.

### A2. Server setup
SSH in (`ssh root@YOUR_IP`) and install the essentials:

```bash
apt update && apt upgrade -y
apt install -y python3-venv python3-pip nginx git
# (Ubuntu 24.04 ships Python 3.12, which satisfies Django 6.0.)
adduser --disabled-password --gecos "" acp     # a non-root app user
usermod -aG www-data acp
```

### A3. Get the code and install
```bash
su - acp
git clone https://github.com/<you>/AlphabetCityProject.git
cd AlphabetCityProject/djangotutorial
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### A4. Environment file
Create `djangotutorial/.env` (never commit this):

```ini
SECRET_KEY=<>
DEBUG=False
ALLOWED_HOSTS=alphabetcityproject.org,www.alphabetcityproject.org,YOUR_IP
CSRF_TRUSTED_ORIGINS=https://alphabetcityproject.org,https://www.alphabetcityproject.org
# No DATABASE_URL line → the app uses SQLite (djangotutorial/db.sqlite3).
```

> If you kept a `DATABASE_URL` from local dev, remove it here — its presence is
> only read by the Postgres path in Option B.

### A5. Initialize the app
```bash
python manage.py migrate
python manage.py createcachetable      # backs the login rate-limiter (DB cache)
python manage.py collectstatic --noinput
python manage.py createsuperuser       # optional, for /admin
# Load your questions/residents here (admin, a fixture, or a script).
```

Quick smoke test: `gunicorn mysite.wsgi:application --bind 127.0.0.1:8000` then
`curl -I localhost:8000/alphabetcity/` (expect a redirect/200). Ctrl-C to stop.

### A6. Gunicorn as a systemd service
As **root**, create `/etc/systemd/system/acp.service`:

```ini
[Unit]
Description=Alphabet City Project (gunicorn)
After=network.target

[Service]
User=acp
Group=www-data
WorkingDirectory=/home/acp/AlphabetCityProject/djangotutorial
EnvironmentFile=/home/acp/AlphabetCityProject/djangotutorial/.env
ExecStart=/home/acp/AlphabetCityProject/djangotutorial/.venv/bin/gunicorn --workers 3 --bind 127.0.0.1:8000 mysite.wsgi:application
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now acp
systemctl status acp        # verify it's running
```

### A7. nginx reverse proxy
Create `/etc/nginx/sites-available/acp`:

```nginx
server {
    listen 80;
    server_name alphabetcityproject.org www.alphabetcityproject.org;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # lets Django see HTTPS
    }
    client_max_body_size 5m;
}
```

WhiteNoise serves the static files from inside the app, so nginx doesn't need a
`/static/` block.

```bash
ln -s /etc/nginx/sites-available/acp /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
```

### A8. HTTPS + firewall
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d alphabetcityproject.org -d www.alphabetcityproject.org
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

Certbot rewrites the nginx config for TLS, adds an HTTP→HTTPS redirect at the
nginx layer, and auto-renews. Keep `SECURE_SSL_REDIRECT=False` in `.env` **while**
you run certbot (so nothing interferes with the plain-HTTP ACME challenge on port
80), then, once certbot succeeds, set `SECURE_SSL_REDIRECT=True` and
`systemctl restart acp` so Django also enforces HTTPS.

### A9. Redeploying later
```bash
su - acp && cd AlphabetCityProject/djangotutorial
git pull
source .venv/bin/activate
pip install -r requirements.txt          # if deps changed
python manage.py migrate                 # if models changed
python manage.py collectstatic --noinput # if static/bundle changed
exit
systemctl restart acp
```

### A10. Back up the database
SQLite is a single file — back it up on a schedule (cron):

```bash
# crontab -e  (as acp)  — nightly copy kept for 14 days
0 3 * * * cp ~/AlphabetCityProject/djangotutorial/db.sqlite3 ~/backups/db-$(date +\%F).sqlite3 && find ~/backups -name 'db-*.sqlite3' -mtime +14 -delete
```

---

## Option B — App Platform + Managed Postgres

Only pick this if you're OK migrating off SQLite. **Requires one settings edit.**

### B1. Switch the DB to `DATABASE_URL`
In `mysite/settings.py`, replace the hard-coded SQLite `DATABASES` block with:

```python
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
        ssl_require=not DEBUG,
    )
}
```

This uses `DATABASE_URL` when set (Postgres in prod) and falls back to SQLite
locally. **If your local `.env` still has `DATABASE_URL=mysql://…`, remove that
line** or local dev will try (and fail) to use MySQL. Commit and push.

### B2. Create the managed database
DigitalOcean → Databases → Create → **PostgreSQL**. Smallest plan is fine.

### B3. Create the App
- DigitalOcean → Apps → Create → pick your GitHub repo/branch.
- **Source directory:** `djangotutorial`
- It auto-detects Python. Set:
  - **Build command:** `pip install -r requirements.txt && python manage.py collectstatic --noinput`
  - **Run command:** `gunicorn --workers 3 --bind 0.0.0.0:8080 mysite.wsgi:application`
    (App Platform provides `$PORT`, usually 8080.)
- **Attach the database** to the app so it injects `DATABASE_URL`.

### B4. Environment variables (App → Settings → Environment)
```
SECRET_KEY            = <generated key>          (mark as Secret / encrypted)
DEBUG                 = False
ALLOWED_HOSTS         = your-app.ondigitalocean.app,alphabetcityproject.org
CSRF_TRUSTED_ORIGINS  = https://your-app.ondigitalocean.app,https://alphabetcityproject.org
```
`DATABASE_URL` is provided automatically by the attached DB. Add a Python 3.12+
runtime via a `runtime.txt` (`python-3.12.x`) in `djangotutorial/` if the buildpack
defaults lower.

### B5. One-off release commands
App Platform doesn't persist a shell, so run migrations as a **Job** (Type:
"pre-deploy" or "post-deploy") or from the **Console** tab:

```bash
python manage.py migrate
python manage.py createcachetable
python manage.py createsuperuser   # once, via Console
```

`collectstatic` already runs in the build command. Add your questions/data via
`/admin` or a fixture.

### B6. Domain + TLS
App → Settings → Domains → add your domain; App Platform issues/renews TLS
automatically. Update `ALLOWED_HOSTS` / `CSRF_TRUSTED_ORIGINS` to include it.

---

## Post-deploy checklist (either option)

- [ ] `https://yourdomain/alphabetcity/` loads the welcome page.
- [ ] Fonts, garden background, and answer dots render (front-end bundle + assets
      load — check the browser Network tab for any `404`s under
      `/static/alphabetcity/index/`).
- [ ] Log in with a resident code → Choose → Answer → submit → the new dot shows
      on the Index.
- [ ] Edit and delete your own answer; the "Your response was deleted" toast shows.
- [ ] Enter a wrong code 3× → the 5-minute lockout message appears (rate-limit
      cache table works).
- [ ] `python manage.py check --deploy` reports no critical warnings.

### If static assets 404 in production
The Vite bundle references its own images by literal paths
(`/static/alphabetcity/index/assets/…`). This works with the current
`CompressedManifestStaticFilesStorage` because `collectstatic` also keeps the
un-hashed originals. If you ever see those assets 404, switch the storage backend
in `settings.py` to the non-hashing variant:

```python
STORAGES = {"staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"}}
```

(You lose long-lived cache-busting on those files, but paths always resolve.)

---

## Notes & gotchas

- **Node is not needed on the server** — the bundle is committed. Only rebuild
  locally + commit when you change `frontend/` code.
- **The rate-limiter needs the DB cache table** — always run `createcachetable`
  on a fresh environment, or logins error out.
- **`ALLOWED_HOSTS` / `CSRF_TRUSTED_ORIGINS`** must include every hostname you
  actually serve (bare domain, `www`, the `*.ondigitalocean.app` URL, and the raw
  IP if you test over it) or you'll get 400 / CSRF errors.
- **Time zone** is `America/New_York` (answer `pub_date` ordering) — change in
  `settings.py` if needed.
- **Scaling:** SQLite + Gunicorn on one small droplet is plenty for a gallery
  kiosk / low traffic. If you ever need multiple app instances, move to Postgres
  (Option B) since SQLite doesn't share across hosts.
