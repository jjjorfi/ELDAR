# Codex Repo Guardrails

Apply these rules before any staging or commit operation.

1. Run `git status --short --branch` before `git add`, `git commit`, or `git push`.
2. Never run `git add .` or `git add -A` blindly.
3. Before any bulk staging operation, run `git add -n .` and review the full dry-run output.
4. Stage only explicit intended paths after review.
5. Do not stage build artifacts, caches, generated files, or local secrets.
6. If the repo is already dirty, do not mix unrelated changes into the same commit.

Always treat these paths as non-committable unless the user explicitly requests otherwise:
- `.npm-cache/`
- `.cache/`
- `__pycache__/`
- `*.pyc`
- `*.tsbuildinfo`
- `.next/`
- `node_modules/`
- `.env*` except approved templates
- local logs and temporary files
