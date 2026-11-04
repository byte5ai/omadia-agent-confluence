// Teams-tab surface (byte5ai/omadia#1620). Runs against `dist/` — `npm test`
// builds first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';

import { createConfluenceUiRouter } from '../dist/routes/confluenceUiRouter.js';
import { createTeamsTabRouters } from '../dist/routes/teamsTabRouter.js';
import { activate } from '../dist/plugin.js';

const MOUNT = '/p/agent-confluence/teams';
const SECRET_TITLE = 'Secret Onboarding Page';

const fakeClient = {
  spaceKey: 'SPACEKEY',
  async search() {
    return {
      _links: { base: 'https://example.atlassian.net/wiki' },
      results: [
        {
          content: {
            id: '1',
            title: SECRET_TITLE,
            history: { createdDate: '2020-01-01T00:00:00Z', createdBy: { displayName: 'Jane Doe' } },
            _links: { webui: '/spaces/SPACEKEY/pages/1' },
          },
          lastModified: '2024-01-01T00:00:00Z',
        },
      ],
    };
  },
  async getPage() {
    return null;
  },
};

const PAGES = [
  { path: '/most-read', title: 'Confluence — Meist gelesene Seiten' },
  { path: '/oldest', title: 'Confluence — Älteste Seiten' },
];

/** Mounts shell + data like the kernel would; `ssoUser` simulates a verified token. */
async function withServer(ssoUser, fn) {
  const { shell, data } = createTeamsTabRouters({
    mountPath: MOUNT,
    pages: PAGES,
    dataRouter: createConfluenceUiRouter({ client: fakeClient, log: () => {} }),
  });
  const app = express();
  app.use(MOUNT + '/_data', (req, _res, next) => {
    if (ssoUser) req.teamsSsoUser = ssoUser;
    next();
  }, data);
  app.use(MOUNT, shell);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('shell pages are data-free and load the data mount via Teams SSO', async () => {
  await withServer(null, async (base) => {
    for (const page of PAGES) {
      const res = await fetch(base + MOUNT + page.path);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.ok(!body.includes(SECRET_TITLE), 'shell must not contain page data');
      assert.ok(!body.includes('SPACEKEY'), 'shell must not contain the space key');
      assert.ok(!body.includes('Jane Doe'));
      assert.ok(body.includes(JSON.stringify(MOUNT + '/_data' + page.path)));
      assert.ok(body.includes('getAuthToken'));
      assert.ok(body.includes("credentials: 'omit'"));
      assert.ok(body.includes('sha384-brW9AazbKR2dYw2DucGgWCCcmrm2oBFV4HQidyuyZRI/TnAkmOOnTARSTdps3Hwt'));
      assert.ok(body.includes('https://res.cdn.office.net/teams-js/2.34.0/js/MicrosoftTeams.min.js'));
    }
  });
});

test('data router answers 401 without req.teamsSsoUser', async () => {
  await withServer(null, async (base) => {
    for (const page of PAGES) {
      const res = await fetch(base + MOUNT + '/_data' + page.path);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { code: 'auth.teams_sso_required' });
    }
  });
});

test('data router renders the page for a verified Teams user', async () => {
  const user = { oid: 'o', tenantId: 't', appId: 'a' };
  await withServer(user, async (base) => {
    const res = await fetch(base + MOUNT + '/_data/most-read');
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes(SECRET_TITLE));
  });
});

test('manifest declares the Teams public path and the teams-sso core floor', () => {
  const manifest = readFileSync(new URL('../manifest.yaml', import.meta.url), 'utf8');
  assert.match(manifest, /public_paths:\s*\n\s*-\s*"\/p\/agent-confluence\/teams"/);
  assert.match(manifest, /core:\s*">=1\.51\.0 <2\.0"/);
});

test('activate registers session pages, Teams shell, teams-sso data and shell descriptors', async () => {
  const routes = [];
  const descriptors = [];
  const ctx = {
    log() {},
    services: {
      get(name) {
        if (name === 'confluence.toolkit') return [{ spec: { name: 'confluence_search' } }];
        if (name === 'confluence.client') return fakeClient;
        return undefined;
      },
    },
    routes: { register: (prefix, _router, opts) => (routes.push({ prefix, auth: opts?.auth }), () => {}) },
    uiRoutes: { register: (d) => (descriptors.push(d), () => {}) },
  };
  const handle = await activate(ctx);
  assert.deepEqual(routes, [
    { prefix: '/p/agent-confluence', auth: 'session' },
    { prefix: '/p/agent-confluence/teams', auth: 'public' },
    { prefix: '/p/agent-confluence/teams/_data', auth: 'teams-sso' },
  ]);
  assert.deepEqual(descriptors.map((d) => d.path), ['/teams/most-read', '/teams/oldest']);
  await handle.close();
});
