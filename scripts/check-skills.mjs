#!/usr/bin/env node
/**
 * check-skills.mjs — guard the prompt partials in skills/ against regressions.
 *
 *     npm test
 *
 * The host loads skills/*.md as plain text (no placeholders), so anything
 * written there reaches the model verbatim on every call. Two things must
 * never come back:
 *
 * - a hard-coded space key. The Confluence integration scopes every tool
 *   call to the space the operator configured; a fixed key in the prompt makes
 *   the agent name a space that does not exist on that install
 *   (byte5ai/omadia#1493).
 * - the dead managed-agent runtime: curl recipes, `$confluence_*` env vars
 *   and bash snippets (byte5ai/omadia-agent-confluence#3).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(here, '..', 'skills');

const RULES = [
  {
    // `HOME` as a space key, also inside link paths like /spaces/HOME/.
    pattern: /\bHOME\b/,
    why: 'hard-coded space key — refer to the configured space instead',
  },
  { pattern: /\bcurl\b/i, why: 'curl recipe from the old managed-agent runtime' },
  { pattern: /\$\{?confluence_/, why: 'env var from the old managed-agent runtime' },
  { pattern: /```(bash|sh)\b/, why: 'shell snippet — the sub-agent has no shell' },
  { pattern: /X-Agent-Token/, why: 'proxy header from the old managed-agent runtime' },
];

let failures = 0;
const files = readdirSync(skillsDir).filter((f) => f.endsWith('.md'));
for (const file of files) {
  const lines = readFileSync(join(skillsDir, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        failures++;
        console.error(`✗ skills/${file}:${i + 1} — ${rule.why}\n    ${line.trim()}`);
      }
    }
  });
}

if (failures > 0) {
  console.error(`\n${failures} problem(s) in skills/`);
  process.exit(1);
}
console.log(`✓ ${files.length} skill file(s) clean`);
