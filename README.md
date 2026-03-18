# Child Investments

A small React + Vite app for tracking each kid's cash, CDs, and bitcoin in one place.

## What is in this repo

- `src/` - React app
- `supabase/migrations/` - hosted database schema
- `supabase/seed.sql` - starter data matching the seeded local app state
- `netlify.toml` - Netlify build settings and SPA redirect
- `.env.example` - environment variable template

## Local development

1. Copy the env template.

   ```bash
   cp .env.example .env.local
   ```

2. Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` if you want to use hosted Supabase.

   If you leave them blank, the app falls back to local browser storage.

3. Install dependencies.

   ```bash
   npm install
   ```

4. Start the dev server.

   ```bash
   npm run dev
   ```

5. Verify production build.

   ```bash
   npm run build
   ```

## Environment variables

Use these variables in local development and in Netlify:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_APP_BASENAME=
```

### `VITE_APP_BASENAME`

- Leave blank for a normal root deploy like `https://bank.micahneely.ai`
- Set to `/bank` only if you intentionally host this app behind a parent site at `https://micahneely.ai/bank`

## Recommended production model

Use **two separate hosted Supabase projects** and **two separate Netlify sites**.

- `master` branch -> production Netlify site -> production Supabase project
- `staging` branch -> staging Netlify site -> staging Supabase project

This gives you:

- a stable production URL
- a stable staging URL
- separate data for staging vs production
- branch-based deploys with no manual toggling

## Branch workflow

This is the workflow you described, written out explicitly.

1. Create a feature branch from `staging`.
2. Build the feature.
3. Push the feature branch and open a PR into `staging`.
4. Merge into `staging`.
5. Netlify auto-deploys the staging site.
6. Verify the feature on the staging URL.
7. Fast-forward `master` from `staging`.
8. Push `master`.
9. Netlify auto-deploys production.

### Fast-forward promotion commands

```bash
git checkout staging
git pull origin staging
git checkout master
git pull origin master
git merge --ff-only staging
git push origin master
```

## First-time GitHub setup

This repo should use `master` as the default branch.

### If the repo is currently on `main`

Rename it locally:

```bash
git branch -m main master
```

### Add GitHub remote

```bash
git remote add origin YOUR_GITHUB_REPO_URL
```

### First push of production branch

```bash
git add .
git commit -m "Initial child investments app"
git push -u origin master
```

### Create and push staging branch

```bash
git checkout -b staging
git push -u origin staging
```

### Set GitHub default branch

In GitHub:

1. Open the repository
2. Go to `Settings`
3. Go to `Branches`
4. Set the default branch to `master`

## Hosted Supabase setup

You should create **two** Supabase projects:

- `child-investments-prod`
- `child-investments-staging`

Do not point staging and production at the same database.

### Production Supabase project

1. Create a new hosted Supabase project.
2. Save the project URL.
3. Save the anon key.
4. Open the SQL Editor.
5. Run the migration in `supabase/migrations/202603100001_initial_schema.sql`.
6. Run `supabase/seed.sql`.

### Staging Supabase project

Repeat the same steps in a separate project:

1. Create another hosted Supabase project.
2. Save the project URL.
3. Save the anon key.
4. Open the SQL Editor.
5. Run the same migration file.
6. Run the same seed file.

### What these files do

- `supabase/migrations/202603100001_initial_schema.sql` creates the required tables and indexes
- `supabase/seed.sql` loads the starter children, transactions, and bitcoin price snapshot

## Netlify setup

Use **two Netlify sites** connected to the same GitHub repo.

### Production Netlify site

1. In Netlify, choose `Add new site`.
2. Import the GitHub repo.
3. Set the production branch to `master`.
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Add environment variables:
   - `VITE_SUPABASE_URL` = production Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = production anon key
   - `VITE_APP_BASENAME` = blank unless you are intentionally serving from `/bank`
7. Deploy the site.

### Staging Netlify site

Create a second site from the same repo:

1. In Netlify, choose `Add new site` again.
2. Import the same GitHub repo.
3. Set the production branch for this second site to `staging`.
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Add environment variables:
   - `VITE_SUPABASE_URL` = staging Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = staging anon key
   - `VITE_APP_BASENAME` = blank unless you are intentionally serving from `/bank`
7. Deploy the site.

After that:

- every push to `master` deploys production
- every push to `staging` deploys staging

## Domain setup

### Easiest option

Use subdomains:

- production: `bank.micahneely.ai`
- staging: `staging-bank.micahneely.ai`

This is the simplest setup in Netlify.

### If you want `micahneely.ai/bank`

That is **not** the normal shape of a standalone Netlify site.

To use `micahneely.ai/bank`, you need a parent site or reverse proxy that forwards `/bank/*` to this app.

If you choose that path:

1. Keep the main site for `micahneely.ai`
2. Proxy or rewrite `/bank/*` to this app
3. Set `VITE_APP_BASENAME=/bank` in the Netlify environment for this app
4. Verify that client-side routing still resolves correctly through the parent site

If you are not already running a parent site at `micahneely.ai`, use `bank.micahneely.ai` instead.

## Deploy checklist

### One-time setup

- create GitHub repo
- rename local branch to `master`
- push `master`
- create and push `staging`
- create prod Supabase project
- create staging Supabase project
- run migration SQL in both
- run seed SQL in both
- create prod Netlify site from `master`
- create staging Netlify site from `staging`
- set Netlify env vars for each site
- attach production and staging domains

### Day-to-day release flow

- branch from `staging`
- build feature
- merge to `staging`
- verify on staging site
- fast-forward merge `staging` into `master`
- push `master`
- verify production site

## Current verification status

This app has already been locally verified with:

- `npm install`
- `tsc --noEmit`
- `npm run build`
- `npm run dev`
- HTTP check against the running local app
