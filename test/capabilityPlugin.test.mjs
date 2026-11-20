// Capability-plugin contract (spec 2042 §5.10): tools go through
// ctx.tools.register, the manifest has no persona surface, every registered
// tool has a side_effects entry. Runs against `dist/` — `npm test` builds first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { registerToolkitTools } from '../dist/registerTools.js';
import { CONFLUENCE_TOOL_DOCS, CONFLUENCE_TOOL_OPTIONS } from '../dist/toolDocs.js';

const manifest = readFileSync(new URL('../manifest.yaml', import.meta.url), 'utf8');

function fakeCtx() {
  const registered = [];
  return {
    registered,
    ctx: {
      tools: {
        register(spec, handler, options) {
          registered.push({ spec, handler, options });
          return () => registered.splice(registered.findIndex((r) => r.spec === spec), 1);
        },
      },
    },
  };
}

const tool = (name, handle) => ({
  spec: { name, description: `${name} desc`, input_schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } },
  handle,
});

test('registers every toolkit tool, appends docs, normalizes results, disposes', async () => {
  const { ctx, registered } = fakeCtx();
  const dispose = registerToolkitTools(
    ctx,
    [tool('confluence_search', async () => 'plain'), tool('confluence_commit_write', async () => ({ output: 'structured' }))],
    { docs: CONFLUENCE_TOOL_DOCS, options: CONFLUENCE_TOOL_OPTIONS },
  );
  assert.deepEqual(registered.map((r) => r.spec.name), ['confluence_search', 'confluence_commit_write']);
  assert.match(registered[0].spec.description, /^confluence_search desc\n\nCQL basics/);
  assert.deepEqual(registered[0].spec.input_schema.required, ['a']);
  assert.equal(await registered[0].handler({}), 'plain');
  assert.equal(await registered[1].handler({}), 'structured');
  assert.ok(registered[1].options.writeCapabilities.length > 0);
  assert.equal(registered[0].options, undefined);
  dispose();
  assert.equal(registered.length, 0);
});

test('manifest is a capability plugin: kind tool, no persona surface, templates en + de', () => {
  assert.match(manifest, /^\s{2}kind: "tool"/m);
  assert.doesNotMatch(manifest, /prompt_partial|^\s*persona:|system_prompt|^llm:/m);
  assert.doesNotMatch(manifest, /^\s{2}memory:/m);
  assert.match(manifest, /language: "en"/);
  assert.match(manifest, /language: "de"/);
  assert.equal(existsSync(new URL('../AGENT.md', import.meta.url)), false);
  assert.equal(existsSync(new URL('../skills', import.meta.url)), false);
});

test('every documented tool has a side_effects entry and the commit is the only write', () => {
  const entries = [...manifest.matchAll(/- id: "(confluence_[a-z_]+)"\n(?:    .*\n)*?    side_effects: "(read|write|none)"/g)];
  const byId = Object.fromEntries(entries.map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(CONFLUENCE_TOOL_DOCS).sort());
  assert.deepEqual(Object.keys(byId).filter((id) => byId[id] === 'write'), ['confluence_commit_write']);
});
