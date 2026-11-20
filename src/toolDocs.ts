import type { ToolRegistrationOptions } from '@omadia/plugin-api';

/**
 * Tool knowledge that used to live in the playbook skill (prompt_partial),
 * now appended to the tool descriptions the calling agent sees (spec 2042
 * §5.10). The persona and tone are NOT here: they ship as agent templates.
 */
export const CONFLUENCE_TOOL_DOCS: Readonly<Record<string, string>> = {
  confluence_search: [
    'CQL basics (the space scope is added for you):',
    '- full text: `text~"onboarding"`; title: `title="Playbook Home" AND type=page`;',
    '- recent: `lastModified >= now("-7d") ORDER BY lastModified DESC`;',
    '- under a parent: `ancestor=12345`; label: `label="process"`; combine with AND / OR.',
    '`limit` up to 50, 10 is a sensible default. Hits carry `content.id`, `content.title` and `url`.',
    'If a search with `ORDER BY` answers 400 without a usable reason, repeat it without `ORDER BY`, a higher `limit`, and sort by `lastModified` yourself.',
    'A 413 means the answer exceeded the proxy limit (200 kB): narrow the CQL or lower `limit`. A 400 carries Confluence\'s reason (e.g. `Could not parse cql`): fix the CQL accordingly.',
    'Strategy: search wide first (about 10 hits), then fetch the 1-3 most relevant pages by id; do not load all hits at once. No hits: try 2-3 CQL variations before giving up.',
  ].join('\n'),
  confluence_get_page: [
    'Allowed `expand` values: `body.view`, `body.view,version`, `body.view,version,space`, `body.view,version,space,ancestors`, `version`, `version,space`, `space`, `ancestors`.',
    'The content is HTML in `body.view.value`; reason over its text, not the markup. For very long pages (> ~12k characters of text) summarize the first segment and say there is more.',
    'Quote a page with its title, a link built from `_links.base` + `_links.webui` (never invent a host or space key; without a link give title and page id) and the date from `version.when` (`Stand: YYYY-MM-DD`). Content older than 12 months deserves a short staleness note.',
    'Never request a page id you learned outside this plugin.',
  ].join('\n'),
  confluence_get_page_by_title:
    'Same `expand` whitelist and answer rules as `confluence_get_page`. Prefer `confluence_search` when the title is not known exactly.',
  confluence_get_children:
    'Use it to list the sub-pages of a parent page; `limit` up to 100, 25 is usually enough.',
  confluence_get_space:
    'Use it to name the configured space (key and name) to the user. Never assume or invent a space key; for content of another space say that only the configured space is accessible.',
  confluence_create_page:
    'Writes are never live: a committed new page is saved as a DRAFT and must still be reviewed and published in Confluence. Say so after the commit. Deleting, moving and labelling pages is not possible.',
  confluence_update_page:
    'Writes are never live: a committed update is saved as a DRAFT of the page and must still be reviewed and published in Confluence. Say so after the commit.',
  confluence_add_comment:
    'Stages a footer comment only; nothing is written before `confluence_commit_write`.',
  confluence_commit_write:
    'Two-phase flow: stage with `confluence_create_page` / `_update_page` / `_add_comment`, show the user the preview, and commit only after an explicit yes. Never commit without confirmation; when unsure, ask. The result is saved as a draft.',
};

/**
 * `confluence_commit_write` is the only tool that changes Confluence. Declaring
 * what it writes gives it at-most-once protection in the kernel's dispatcher.
 */
export const CONFLUENCE_TOOL_OPTIONS: Readonly<Record<string, ToolRegistrationOptions>> = {
  confluence_commit_write: {
    writeCapabilities: [
      { dataClass: 'confluence.page', operation: 'create' },
      { dataClass: 'confluence.page', operation: 'update' },
      { dataClass: 'confluence.comment', operation: 'create' },
    ],
  },
};
