/**
 * Confluence playbook capability plugin (kind `tool`, spec 2042 §5.10,
 * ADR-0014).
 *
 * The integration publishes a complete `confluence.toolkit`
 * (LocalSubAgentTool[]). This plugin registers every tool of it via
 * `ctx.tools.register` (`registerTools.ts`) and returns `{ close }`. It has no
 * persona, no system prompt and no sub-agent: the former persona ships as
 * agent templates in manifest.yaml, the tool knowledge is in the descriptions.
 *
 * v0.2.0 adds two operator-facing dashboards (Hub-/Teams-Tabs) that
 * surface the configured Space's most-favourited and oldest pages — both
 * SSR, refreshed every 2 h. v0.4.0 serves them to Teams tabs through the
 * kernel's `auth: 'teams-sso'` mode (byte5ai/omadia#1620).
 */

import type { LocalSubAgentTool, PluginContext } from '@omadia/plugin-api';

import { CONFLUENCE_TOOL_DOCS, CONFLUENCE_TOOL_OPTIONS } from './toolDocs.js';
import { registerToolkitTools } from './registerTools.js';
import { createConfluenceUiRouter } from './routes/confluenceUiRouter.js';
import {
  createTeamsTabRouters,
  TEAMS_TAB_DATA_SEGMENT,
  TEAMS_TAB_SEGMENT,
} from './routes/teamsTabRouter.js';
import type { ConfluenceSearchClient } from './routes/confluenceDataSource.js';

const TOOLKIT_SERVICE = 'confluence.toolkit';
const CLIENT_SERVICE = 'confluence.client';
const ROUTE_PREFIX = '/p/agent-confluence';
/** Teams-tab surface (#1620) — must match `permissions.public_paths`. */
const TEAMS_TAB_PREFIX = ROUTE_PREFIX + TEAMS_TAB_SEGMENT;

const DASHBOARD_PAGES = [
  { path: '/most-read', title: 'Confluence — Meist gelesene Seiten' },
  { path: '/oldest', title: 'Confluence — Älteste Seiten' },
] as const;

export interface ConfluenceHandle {
  close(): Promise<void>;
}

export async function activate(ctx: PluginContext): Promise<ConfluenceHandle> {
  ctx.log('activating confluence playbook tools');

  const tools = ctx.services.get<LocalSubAgentTool[]>(TOOLKIT_SERVICE);
  if (!tools || tools.length === 0) {
    throw new Error(
      `agent-confluence: required service '${TOOLKIT_SERVICE}' not published or empty — @omadia/integration-confluence must be active before this agent (declared in depends_on).`,
    );
  }

  const toolNames = tools.map((t) => t.spec.name).join(', ');
  ctx.log(
    `confluence-playbook ready (tools=${tools.length}: ${toolNames})`,
  );

  // --- Dashboard wiring ----------------------------------------------
  // Plugin-served Confluence dashboards. Mounted at
  // /p/agent-confluence/{most-read,oldest} for the browser and under
  // /p/agent-confluence/teams/… for Teams Tabs (pinned through the
  // channel-teams configurable-tab flow). Reads live from Confluence
  // via the shared `confluence.client` service (published by
  // @omadia/integration-confluence). Route handlers catch fetch failures
  // and render an inline banner.
  const client = ctx.services.get<ConfluenceSearchClient>(CLIENT_SERVICE);
  if (!client) {
    throw new Error(
      `agent-confluence: required service '${CLIENT_SERVICE}' not published — @omadia/integration-confluence must publish ConfluenceClient before this agent.`,
    );
  }
  const uiRouter = createConfluenceUiRouter({
    client,
    log: (...args) => ctx.log(...args),
  });
  // Browser pages for operators: behind the omadia session (#1596). Spelled
  // out so nobody "fixes" a 401 inside a Teams tab by flipping this mount.
  const disposeRoute = ctx.routes.register(ROUTE_PREFIX, uiRouter, {
    auth: 'session',
  });

  // Teams tabs (byte5ai/omadia#1620): a data-free shell ('public') loads the
  // same pages from the 'teams-sso' data mount with the tab's SSO token.
  // Both prefixes sit under the ONE declared, operator-granted public path
  // `/p/agent-confluence/teams`; without the grant neither is served.
  const teamsTab = createTeamsTabRouters({
    mountPath: TEAMS_TAB_PREFIX,
    pages: DASHBOARD_PAGES,
    dataRouter: uiRouter,
  });
  const disposeTeamsShell = ctx.routes.register(
    TEAMS_TAB_PREFIX,
    teamsTab.shell,
    { auth: 'public' },
  );
  const disposeTeamsData = ctx.routes.register(
    TEAMS_TAB_PREFIX + TEAMS_TAB_DATA_SEGMENT,
    teamsTab.data,
    { auth: 'teams-sso' },
  );

  // The descriptors are what channel-teams pins as the tab URL, so they
  // point at the Teams shell, not at the session-gated page.
  const disposeMostReadDescriptor = ctx.uiRoutes.register({
    routeId: 'most-read',
    path: `${TEAMS_TAB_SEGMENT}/most-read`,
    title: 'Confluence — Meist gelesen',
    description:
      'Top 25 Seiten im konfigurierten Space, sortiert nach Favoriten (Proxy für Aufrufe). Auto-Refresh 2 h.',
    order: 30,
  });
  const disposeOldestDescriptor = ctx.uiRoutes.register({
    routeId: 'oldest',
    path: `${TEAMS_TAB_SEGMENT}/oldest`,
    title: 'Confluence — Älteste Seiten',
    description:
      'Top 25 Seiten im konfigurierten Space, sortiert nach Erstellungsdatum aufsteigend. Auto-Refresh 2 h.',
    order: 31,
  });
  ctx.log(
    `confluence uiRoutes mounted at ${ROUTE_PREFIX}/{most-read,oldest} (session) + ${TEAMS_TAB_PREFIX}/{most-read,oldest} (Teams SSO)`,
  );

  // Every toolkit tool goes to the kernel's tool runtime. The write tools are
  // only in the toolkit when the integration has confluence_write_enabled.
  const disposeTools = registerToolkitTools(ctx, tools, {
    docs: CONFLUENCE_TOOL_DOCS,
    options: CONFLUENCE_TOOL_OPTIONS,
  });

  return {
    async close() {
      ctx.log('deactivating confluence playbook tools');
      disposeTools();
      disposeRoute();
      disposeTeamsShell();
      disposeTeamsData();
      disposeMostReadDescriptor();
      disposeOldestDescriptor();
    },
  };
}
