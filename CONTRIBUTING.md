# Contributing to Noema

Noema uses a main-only, pull-request-based workflow. `main` is the only long-running branch and must remain releasable.

## Branches

Create every working branch from the latest `main`:

```bash
git switch main
git pull --ff-only origin main
git switch -c fix/15-windows-packaging
```

Use one of these branch forms:

- `feature/<short-description>`
- `fix/<issue-number>-<short-description>`
- `refactor/<short-description>`
- `docs/<short-description>`
- `test/<short-description>`
- `build/<short-description>`
- `release/v<major>.<minor>.<patch>`

Keep branches short-lived and delete them after merge. Branch names must describe the product change and must not contain agent, model, IDE, or automation names.

## Commits

Use Conventional Commits:

```text
<type>(optional-scope): <imperative summary>
```

Allowed types are `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`, and `revert`. Keep each commit focused and use the body for motivation, behavior changes, and migration notes. Do not add tool attribution or prefixes such as `[codex]`.

Sign commits with the contributor's GitHub-recognized SSH signing key when available:

```bash
git config gpg.format ssh
git config user.signingkey ~/.ssh/<github-signing-key>.pub
git config commit.gpgsign true
```

## Pull Requests

Open pull requests against `main`. The PR title must use the same Conventional Commit form because it becomes the squash commit title. The PR body must explain the problem, the solution, verification, and related issues. Use `Fixes #<number>` only when merging the PR fully resolves that issue.

Prefer squash merge so `main` receives one coherent change. Delete the source branch after merge. PR titles and descriptions must not advertise the agent, model, IDE, or automation used to produce the change.

## Releases and Tags

Noema tags releases with SemVer:

- Stable: `v1.4.0`
- Prerelease: `v1.4.0-beta.1`

Tags are immutable. Never move, replace, or reuse a published tag.

1. Create `release/vX.Y.Z` from the latest `main`.
2. Update the version in `package.json`, `packages/sdk/package.json`, and `apps/desktop/package.json`.
3. Run `pnpm check:release-version X.Y.Z` and the required builds.
4. Merge a PR titled `chore(release): vX.Y.Z` into `main`.
5. Create a signed annotated tag on that merge commit and push it:

```bash
git switch main
git pull --ff-only origin main
git tag -s vX.Y.Z -m "Noema vX.Y.Z"
git push origin vX.Y.Z
```

Pushing the tag packages the exact tagged commit and creates the GitHub Release. The release workflow rejects lightweight tags, tags outside `main`, and tags whose version does not match the package manifests.
