<div align="center">

# @omadia/agent-confluence

### Confluence sub-agent for omadia — page search/read/write via the shared Confluence integration.

A **Confluence** agent plugin for [omadia](https://github.com/byte5ai/omadia),
built on `@omadia/integration-confluence`.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

## How it works

A sub-agent playbook (`skills/playbook.md` + `skills/runtime-note.md`) plus a
plugin entry point (`src/plugin.ts`) wrapping the shared Confluence
integration's read/write surface, a data-source route
(`src/routes/confluenceDataSource.ts`) and admin UI route
(`src/routes/confluenceUiRouter.ts`, built with `@omadia/plugin-ui-helpers`).
Write operations always save as draft, never publish live.

## Dashboards and Teams tabs

Two dashboards (`most-read`, `oldest`) of the configured space:

- Browser: `/p/agent-confluence/<page>`, behind the omadia session.
- Teams tab: `/p/agent-confluence/teams/<page>`, a data-free shell that loads
  the page from `/p/agent-confluence/teams/_data/<page>` with the tab's Teams
  SSO token (kernel `auth: 'teams-sso'`, byte5ai/omadia#1620). Needs omadia
  core with `@omadia/plugin-api` >= 1.51.0 and the operator's grant of the
  `permissions.public_paths` entry `/p/agent-confluence/teams`. Every tenant
  member can open it, so it shows only what the configured space may show to
  the whole tenant.

## Build, typecheck

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build        # tsc
```

`@omadia/plugin-api` is a **peer dependency**, provided by the omadia host at
runtime. `@omadia/plugin-ui-helpers` is additionally linked as a `file:`
devDependency (imported at the value level, not just typed) so local
typechecking and builds are green standalone — see `paths` in
`tsconfig.json`, which assumes a sibling `odoo-bot` checkout.

## Manifest

See [`manifest.yaml`](manifest.yaml) for the full plugin manifest.

## License

MIT © byte5 GmbH — see [LICENSE](LICENSE).
