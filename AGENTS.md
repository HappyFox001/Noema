# AGENTS.md

Guidance for coding agents working in this repository.

## Project Shape

Keep the project structure simple. Prefer the existing package and plugin boundaries over adding new compatibility layers, adapter stacks, or speculative abstractions.

Do not add redundant backwards compatibility unless the user explicitly asks for it. When behavior changes, update the current path directly instead of preserving obsolete paths.

## Comments

Use English-only comments in source files.

Prefer a short file-level comment at the top of a file that explains the file's role in the system. Avoid dense inline comments. Add inline comments only when they clarify non-obvious control flow, protocol behavior, or safety constraints.

Do not use Chinese in code comments. Chinese is fine for user-facing UI text, logs, prompts, markdown documents, and conversation content when appropriate.

## Implementation Style

Keep changes scoped and direct. Avoid creating a new framework when a small extension of the existing one is enough.

Plugins should use generic hooks and runtime capabilities. Do not add plugin-specific hooks when the need is a general lifecycle, context, tool, or admin-management capability.

Task runtime features should stay explicit: context providers contribute task context, tools execute actions, and UI management remains separate from runtime execution.

## Git Workflow

Use `dev` as the long-running development branch. Do not make routine development changes directly on `main`.

For regular updates, work from `dev` and use pull requests for merging. For larger or riskier changes, create a short-lived feature branch from `dev`, then open a pull request back into `dev`.

Merge `dev` into `main` only through a pull request when the development branch is stable and ready for release.

## Verification

After changing SDK or desktop runtime code, run the relevant build:

```bash
pnpm --filter @her-text/sdk build
pnpm --filter @her-text/desktop build
```

For runtime plugin files, run `node --check` on changed `.mjs` files when practical.

Do not run startup tests unless the user explicitly asks for them. This includes launching Electron, starting Vite/dev servers, or opening browser-based smoke tests for verification.
