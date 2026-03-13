# ELDAR - Git Hygiene & Repository Safety Prompt

## CRITICAL INSTRUCTION - READ BEFORE EVERY COMMIT

You are working on a production Next.js TypeScript repository.
Before you touch git in any way - before `git add`, before `git commit`,
before any file creation - you must follow every rule in this document.

Violating these rules has already caused the repository to bloat to an
unmanageable size. It will not happen again.

## WHAT YOU MUST NEVER COMMIT

These files and folders must never appear in a git commit. Ever.

### Node / Package managers
```
node_modules/
.npm-cache/
.npm/
.yarn/
.pnp/
.pnp.js
yarn-error.log
npm-debug.log*
yarn-debug.log*
.pnpm-debug.log*
```

### Build outputs
```
.next/
out/
dist/
build/
.vercel/
*.tsbuildinfo
tsconfig.tsbuildinfo
next-env.d.ts
```

### Python (has no place in a Next.js repo)
```
__pycache__/
*.py[cod]
*.pyo
.Python
*.egg-info/
.env (python venv)
venv/
.venv/
```

### Environment and secrets
```
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
.env.production
```

### OS and editor
```
.DS_Store
Thumbs.db
.idea/
.vscode/settings.json
*.swp
*.swo
```

### Logs and debug
```
*.log
logs/
audit/          <- unless this is intentional source code, not generated output
*.pid
```

### Large assets that should use cloud storage
```
*.mp4
*.mov
*.avi
*.zip
*.tar.gz
public/videos/
public/assets/*.zip
```

## THE .gitignore YOU MUST MAINTAIN

Every time you create a new file type or install a new tool,
check if it needs a .gitignore entry. The canonical .gitignore for
this project is:

```gitignore
# Dependencies
node_modules/
.npm-cache/
.npm/
.yarn/
.pnp
.pnp.js

# Next.js build
.next/
out/
build/
dist/

# Vercel
.vercel/

# TypeScript
*.tsbuildinfo
tsconfig.tsbuildinfo
next-env.d.ts

# Environment variables - NEVER COMMIT
.env
.env.*
!.env.example

# Python (should not exist in this repo)
__pycache__/
*.py[cod]
*.pyo
.Python
venv/
.venv/

# OS
.DS_Store
.DS_Store?
._*
Thumbs.db
ehthumbs.db

# Editor
.idea/
*.swp
*.swo
.vscode/settings.json

# Logs
*.log
logs/
npm-debug.log*
yarn-debug.log*
yarn-error.log
.pnpm-debug.log*

# Test output
coverage/
.nyc_output/

# Misc
*.pid
*.seed
*.pid.lock
.cache/
```

## BEFORE EVERY GIT ADD - RUN THIS CHECKLIST

Before running `git add .` or `git add <anything>`, ask yourself:

```
Does .gitignore exist and is it up to date?
Am I about to add node_modules or .npm-cache?
If yes -> STOP. Add to .gitignore first.
Am I about to add .next/ or any build output?
If yes -> STOP. Build outputs are never committed.
Am I about to add a .env file with real values?
If yes -> STOP. This is a security incident.
Am I about to add __pycache__ or any Python artifacts?
If yes -> STOP. This is a Next.js TypeScript project.
Am I about to add tsconfig.tsbuildinfo?
If yes -> STOP. This is a build artifact.
Is there any file above 1MB I'm about to commit?
If yes -> justify why this belongs in git, or use cloud storage.
Run: git status - does anything unexpected appear?
If yes -> investigate before committing.
```

Never use `git add .` blindly. Always review `git status` first.

## THE CORRECT COMMIT WORKFLOW

```bash
# 1. Check what git sees
git status

# 2. Review the diff - never commit what you haven't read
git diff --staged

# 3. Add specific files, not everything blindly
git add src/lib/scoring/engine.ts
git add src/components/ScoreBadge.tsx
# NOT: git add .

# 4. If you must add everything, preview first
git add -n .
# Then review the output before running git add .

# 5. Verify staged files are correct
git status

# 6. Commit with a meaningful message
git commit -m "feat(scoring): add ROIC computation to profitability factor"

# 7. Never force push to main
# Never: git push --force
# Use: git push origin feature/your-branch
```

## COMMIT MESSAGE FORMAT

Every commit message follows this format:

```
type(scope): short description

Types:
  feat      new feature
  fix       bug fix
  refactor  code restructure, no behavior change
  chore     tooling, deps, config
  docs      documentation only
  test      tests only
  perf      performance improvement

Scopes (ELDAR-specific):
  scoring   V8.1 engine
  macro     macro engine
  edgar     EDGAR parser
  prices    price waterfall
  normalize normalization layer
  cache     Redis / caching
  ai        AI orchestration
  ui        components, pages
  db        schema, migrations
  auth      Clerk integration
  api       API routes
```

## IF THE DAMAGE IS ALREADY DONE

If cache files or artifacts have already been committed, run this
to remove them without deleting the actual files from disk:

```bash
git rm -r --cached .npm-cache/
git rm -r --cached __pycache__/
git rm --cached tsconfig.tsbuildinfo
git rm --cached next-env.d.ts

cat .gitignore

git commit -m "chore: remove build artifacts and cache from git history"

git push
```

If the repository history is severely bloated (>500MB), use BFG Repo Cleaner:

```bash
brew install bfg

bfg --delete-folders .npm-cache
bfg --delete-folders node_modules
bfg --delete-folders __pycache__

git reflog expire --expire=now --all && git gc --prune=now --aggressive

git push --force
```

## BRANCH STRATEGY

```
main          production - protected, never push directly
dev           integration branch - all features merge here first
feature/*     individual feature branches
fix/*         bug fixes
chore/*       tooling and maintenance
```

## ENVIRONMENT VARIABLES - NEVER IN GIT

```
.env.example    <- commit this - shows variable names, no real values
.env.local      <- never commit - contains real API keys
.env            <- never commit
```

If you ever accidentally commit a real API key:
1. Rotate the key immediately - assume it is compromised
2. Remove it from git history with BFG
3. Add the file to .gitignore
4. Never use that key again

## WHAT A HEALTHY git status LOOKS LIKE

Before committing, `git status` should only show files you wrote.
If you see any of these, something is wrong:

```
WRONG - stop and investigate:
  modified: node_modules/...
  new file: .npm-cache/...
  new file: .next/...
  new file: tsconfig.tsbuildinfo
  new file: __pycache__/...
  modified: .env
  new file: *.log

CORRECT - these are fine:
  modified: src/lib/scoring/engine.ts
  new file: src/lib/normalize/adapters/prices/alpaca.adapter.ts
  modified: src/app/stocks/[ticker]/page.tsx
  modified: package.json
  modified: .gitignore
```

## REPOSITORY SIZE LIMITS

```
Single file:          < 1MB
Total repo size:      < 100MB
Any folder:           investigate if unexpectedly large

If a folder shows percentage > 20% of the repo,
it almost certainly contains something that should not be committed.
```

## FINAL RULE

You are a professional engineer working on a production codebase.
Every commit is permanent. Every mistake in git is recoverable
but costs time and trust.

Before every `git add`:  read `git status`
Before every `git commit`: read `git diff --staged`
Before every `git push`:  confirm you are on the right branch

Never commit what you haven't read.
Never push what you haven't tested.
Never force push to main.

## CRITICAL SYSTEM PROTECTION

The following files are protected and must never be deleted or renamed casually:

```
src/lib/financials/eldar-financials-adapter.ts
src/lib/financials/eldar-financials-pipeline.ts
src/lib/financials/eldar-financials-schema.ts
src/lib/financials/eldar-financials-taxonomy.ts
src/lib/financials/eldar-financials-types.ts
src/lib/normalize/adapters/fundamentals/edgar.adapter.ts
src/lib/scoring/engine.ts
src/lib/scoring/macro/eldar-macro-v2.ts
```

Rules:

- Modifying these files is allowed when the user explicitly asks for that critical system to change.
- Deleting or renaming any protected file is never allowed unless you first ask the user and the user explicitly approves in the conversation.
- Before touching a protected file, state which protected file is changing and why.
- If a deletion or rename is explicitly approved, run:

```bash
ELDAR_ALLOW_CRITICAL_SYSTEM_DELETIONS=1 \
ELDAR_CRITICAL_DELETION_REASON="short reason" \
npm run guard:critical-systems
```

- `security-gate.sh` will fail automatically when these files are deleted or renamed without that explicit acknowledgment.
