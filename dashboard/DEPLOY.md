# Manual Deploy (one-time, ~2 minutes)

The dashboard code is fully ready — the only thing left is to add the
GitHub Actions workflow file that auto-builds and deploys it to GitHub
Pages. I couldn't push this file directly because the GitHub Personal
Access Token I have doesn't include the `workflow` scope (needed to
create files under `.github/workflows/`).

You have **two options** — pick whichever is easier:

## Option A: Paste the workflow via GitHub UI (easiest, no new tokens)

1. Open this URL in your browser:
   https://github.com/Deq710sia/wankle-trials/actions/new
2. Click **"set up a workflow yourself"** (the skip-to-blank-file link).
3. Delete the default contents and paste the entire contents of
   [`dashboard/deploy-workflow.yml`](deploy-workflow.yml) from this repo.
4. Change the filename at the top from `main.yml` to `deploy-dashboard.yml`.
5. Click **"Commit changes..."** → "Commit directly to main".
6. The workflow runs immediately. Watch it at:
   https://github.com/Deq710sia/wankle-trials/actions
7. Once it's done (~3 min), enable Pages:
   - Go to https://github.com/Deq710sia/wankle-trials/settings/pages
   - Under **"Build and deployment"** → **"Source"**, select **"GitHub Actions"**
8. Re-run the workflow (Actions tab → "Deploy dashboard to GitHub Pages" →
   "Run workflow"). The site goes live at:
   **https://deq710sia.github.io/wankle-trials/**

## Option B: Give me a workflow-enabled PAT

If you'd rather I do the whole thing, create a new fine-grained PAT at
https://github.com/settings/personal-access-tokens/new with:
- Repository access: `Deq710sia/wankle-trials`
- Repository permissions:
  - **Contents**: Read and write
  - **Workflows**: Read and write
  - **Pages**: Read and write

Paste the new token in chat and I'll push the workflow, enable Pages,
and trigger the deploy.

## Why this step is needed

GitHub requires any token that creates or modifies files under
`.github/workflows/` to have the `workflow` scope. This is a security
measure to prevent malicious scripts from secretly changing CI/CD. The
PAT I have only has `repo` scope, which is enough for normal code pushes
but not for workflow files.

## After deployment

Once the workflow is in place, **every future push** to `main` that
touches `dashboard/` will automatically rebuild and redeploy the site.
No more manual steps.

The site URL will be:
**https://deq710sia.github.io/wankle-trials/**

On first visit, click "set key" in the header to paste your OpenRouter
API key (stored in localStorage, never sent to any server except
OpenRouter itself).
