# Changelog

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
