<div align="center">

# @omadia/agent-confluence

### Confluence playbook tools for omadia — page search/read/write via the shared Confluence integration.

A **Confluence** capability plugin (kind `tool`) for [omadia](https://github.com/byte5ai/omadia),
built on `@omadia/integration-confluence`.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

## How it works

A capability plugin of kind `tool` (spec 2042 §5.10): it owns no credentials and
no persona. `src/plugin.ts` takes the tools the Confluence integration
publishes as the `confluence.toolkit` service and registers each one with
`ctx.tools.register` (`src/registerTools.ts`); the kernel offers them to the
agents the operator granted this plugin to. The knowledge that used to be the
playbook skill (CQL patterns, `expand` whitelist, answer rules, the two-phase
write flow) now sits in the tool descriptions (`src/toolDocs.ts`) and in
`playbook.when_to_use`. The former persona ships as two inactive agent
templates (English and German) in `manifest.yaml`; an operator turns one into
an agent in the Agent Builder.

Tools: `confluence_search`, `confluence_get_page`,
`confluence_get_page_by_title`, `confluence_get_children`,
`confluence_get_space` (read), and, when the integration has
`confluence_write_enabled`, `confluence_create_page`, `confluence_update_page`,
`confluence_add_comment` (stage a preview, read-only) and
`confluence_commit_write` (the only write; always saved as a draft). Each has a
`side_effects` entry in the manifest. The dashboards below stay part of the
plugin.

Needs omadia core >= 1.76.0 (kind `tool`, `agent_templates`).

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
npm test             # tsc + node --test
npm run package      # out/<id>-<version>.zip
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
