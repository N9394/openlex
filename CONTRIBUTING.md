# Contributing to OpenLex

Thank you for helping. OpenLex is used by lawyers on confidential client matters, so we value small, well-tested changes that keep the product predictable, local-first and honest about what it does.

## Before you start

- **Security problems:** do not open an issue or pull request; follow [SECURITY.md](SECURITY.md).
- **Bigger changes** (a new feature, a new dependency, a change to the data policy, the local API or `openlex.json`): open an issue first so we can agree on the approach.
- **Small fixes** (bugs, docs, tests, wording): just send a pull request.

## Set up and run the tests

You need Node.js 20 or newer. The tests are offline: every model, API and website they use is faked on `127.0.0.1`, so no keys, models or network are needed.

```bash
cd sidecar
npm ci                                     # or npm install
node --test test/*.test.js                 # the engine, CLI, TUI and add-in logic (same as: npm test)
node --test test/tui.test.js               # one file
cd ..
node --test desktop/electron/test/*.test.js     # desktop shell (no Electron needed)
bash scripts/package-cli.sh && bash scripts/check-cli-tarball.sh   # build and check the CLI tarball
```

On Windows run these in Git Bash, or use Node 22+ (which expands the `*.test.js` pattern itself). A few tests only run where the platform has the feature (the macOS/Linux shell sandbox, on-device OCR) and are skipped elsewhere; tests that need the real network run only with `OPENLEX_TEST_NETWORK=1`.

CI runs the tests on Linux, macOS and Windows with Node 20 and 22 for every pull request, and builds the CLI tarball twice to check that it is reproducible. A pull request needs a green CI run.

Never run tests against real client data, real API keys or production services.

## Code style

- Plain JavaScript (CommonJS in `sidecar/src`, ES modules in `sidecar/tui`), Node ≥ 20, no build step for the engine.
- 2-space indentation, single quotes, no semicolons; match the file you are editing.
- Few dependencies. A new runtime dependency needs a good reason (and no native modules in the engine: the CLI tarball is one file for every platform).
- Everything that listens on a port binds to `127.0.0.1` only (there is a test for that).
- User-facing text is plain language for lawyers: no tool names, model ids, JSON or stack traces on screen (see [docs/TUI_DESIGN.md](docs/TUI_DESIGN.md)).
- Every behaviour change comes with a test. Bug fixes come with a test that failed before.
- Comments explain *why*, not what.

## Pull requests

1. Fork, create a branch from `main`, keep it focused on one change.
2. Add or update tests and docs (README, `docs/`, guides) in the same pull request.
3. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
4. Sign off your commits (see below) and open the pull request against `main`. Describe what changed, why, and how you tested it.
5. A maintainer reviews it. We may ask for changes; please don't take it personally.

## Sign-off (Developer Certificate of Origin)

By contributing you confirm that you wrote the change or otherwise have the right to submit it under the project's licence, as described in the [Developer Certificate of Origin](https://developercertificate.org). Add a sign-off line to each commit:

```bash
git commit -s -m "Fix the chronology date parser for '1. Jänner 2025'"
# adds: Signed-off-by: Your Name <you@example.com>
```

Contributions are licensed under [Apache-2.0](LICENSE), the licence of this repository.

## No secrets, no client data

- Never commit API keys, tokens, certificates, passwords, server addresses, `.env` files, `distribution.json`, or anything from `~/.lexvault`.
- Never commit real client documents or personal data, also not as test fixtures. Write small synthetic fixtures instead (see `sidecar/test/fixtures/`).
- Screenshots and logs in issues: remove names, matter titles and file paths first.

If you committed a secret by mistake, tell us right away (privately, see [SECURITY.md](SECURITY.md)); rotating it is more important than rewriting history.

## What belongs in this repository

This repository is the complete open-source OpenLex: the engine and CLI, the Word and Outlook add-in, the desktop app, skills, playbooks and docs, under Apache-2.0. Commercial extensions and services are not part of this repository, and contributions here never depend on them. A distribution's own settings file (`distribution.json`, see `distribution.example.json`) also stays outside the repository.

## Releases

Maintainers release by pushing a tag `vX.Y.Z` that matches `sidecar/package.json`. The [release workflow](.github/workflows/release.yml) builds, signs and attests everything on GitHub and drafts the release; see [docs/VERIFY.md](docs/VERIFY.md) for how anyone can check the result.
