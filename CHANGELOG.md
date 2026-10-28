# Changelog

## 0.3.4

- The playbook no longer hard-codes the space key `HOME` (byte5ai/omadia#1493).
  The integration scopes every tool call to the space the operator configured,
  so the prompt now speaks of "the configured space" and tells the agent to take
  the real key from the `confluence_search` tool description and the name from
  `confluence_get_space()`. That covers the scope rule, the refusal sentence for
  other spaces, the "outside this space" hint and the link fallback (links are
  built from `_links.base` + `_links.webui`, never from a guessed host or key).
- Drop the dead managed-agent runtime from the playbook
  (byte5ai/omadia-agent-confluence#3): the Connection / Authentication / HTTP
  error sections, curl recipes and the bash tag-stripping snippet are replaced
  by a short proxy paragraph and tool-call recipes, and the runtime note no
  longer has to tell the model to ignore them.
- Recipes include `type = page ORDER BY lastmodified DESC`; this needs
  `@omadia/integration-confluence` >= 0.3.4 (byte5ai/omadia#1504). A 400 from
  Confluence now carries its reason, and the playbook tells the agent to fix
  the CQL from it.
- `npm test` runs `scripts/check-skills.mjs`, which fails on a hard-coded
  `HOME`, curl, `$confluence_*` env vars or shell snippets in `skills/`.

## 0.3.3

- Declare `confluence.client@1` and `confluence.toolkit@1` under
  `optional_requires:` (omadia#839). Both are resolved via `ctx.services.get`
  in activate() with an unconditional throw when absent, but their provider
  `@omadia/integration-confluence` still ships `provides: []`, so a `requires:`
  entry would be permanently unresolved and drop this agent from the eligible
  set. `optional_requires:` grants the same declaration the service gate asks
  for without a resolver edge; `depends_on` still orders the integration first.
  Retires the `@omadia/agent-confluence` row in
  `STANDALONE_LEGACY_SERVICE_GRANTS_2026_08_20`.
