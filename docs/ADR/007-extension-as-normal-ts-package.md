# ADR 007: Extension as a Normal TypeScript Package

## Status

Accepted

## Context

Pi extensions can be placed inside `.pi/extensions/` for auto-discovery, which is convenient for personal or project-local scripts. For a distributable extension intended to be published and installed by others, two structural options exist:

- **Nested under `.pi/extensions/`** — the extension lives inside a `.pi/` directory within the repo; users must manually copy or symlink it
- **Normal TypeScript package at repo root** — the repo itself is the extension package; users install it via `pi install`

## Decision

Stay Focused is structured as a normal TypeScript package at the repo root, not nested inside `.pi/extensions/`.

## Rationale

- **Standard distribution path** — `pi install git:github.com/<owner>/stay-focused` works out of the box; no manual file placement required
- **Cleaner repo layout** — source files, tests, and config sit at the root without an extra directory layer
- **No functional difference** — Pi discovers the extension via the `pi.extensions` field in `package.json` regardless of where the package lives; the four source files and their contracts are identical either way

## Consequences

- **Dev-time loading:** the local repo path must be added to `extensions` in Pi's `settings.json` (see knowledgebase: `extension-package-dev-and-install.md`)
- **Distribution:** runtime deps (`js-yaml`) must be in `dependencies`; Pi installs with `--omit=dev` so `devDependencies` are not available at runtime
- `@earendil-works/pi-coding-agent` stays in `devDependencies` — it is only needed for types and integration tests, not at runtime
- The TSD's file layout diagram references `.pi/extensions/stay-focused/` as the root; mentally map that to `<repo root>/`
