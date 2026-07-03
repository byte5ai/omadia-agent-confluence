/**
 * Confluence Playbook Sub-Agent — extracted from middleware kernel in
 * Phase 5B M3+M4 catch-up.
 *
 * Differs from the odoo agents: the integration publishes a complete
 * `confluence.toolkit` (LocalSubAgentTool[]) so this agent doesn't need
 * a graph-lookup helper or @omadia/verifier dependency. We just pass the
 * tools through.
 *
 * v0.2.0 adds two operator-facing dashboards (Hub-/Teams-Tabs) that
 * surface the configured Space's most-favourited and oldest pages — both
 * SSR, refreshed every 2 h.
 */

import type { PluginContext } from '@omadia/plugin-api';
import type { LocalSubAgentTool } from '@omadia/plugin-api';

import { createConfluenceUiRouter } from './routes/confluenceUiRouter.js';
import type { ConfluenceSearchClient } from './routes/confluenceDataSource.js';

const TOOLKIT_SERVICE = 'confluence.toolkit';
const CLIENT_SERVICE = 'confluence.client';
const ROUTE_PREFIX = '/p/agent-confluence';

export interface ConfluenceHandle {
  readonly toolkit: { tools: LocalSubAgentTool[] };
  close(): Promise<void>;
}

export async function activate(ctx: PluginContext): Promise<ConfluenceHandle> {
  ctx.log('activating confluence-playbook agent');

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
  // /p/agent-confluence/{most-read,oldest} — pinned as Teams Tabs through
  // the channel-teams configurable-tab flow. Reads live from Confluence
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
  const disposeRoute = ctx.routes.register(ROUTE_PREFIX, uiRouter);
  const disposeMostReadDescriptor = ctx.uiRoutes.register({
    routeId: 'most-read',
    path: '/most-read',
    title: 'Confluence — Meist gelesen',
    description:
      'Top 25 Seiten im konfigurierten Space, sortiert nach Favoriten (Proxy für Aufrufe). Auto-Refresh 2 h.',
    order: 30,
  });
  const disposeOldestDescriptor = ctx.uiRoutes.register({
    routeId: 'oldest',
    path: '/oldest',
    title: 'Confluence — Älteste Seiten',
    description:
      'Top 25 Seiten im konfigurierten Space, sortiert nach Erstellungsdatum aufsteigend. Auto-Refresh 2 h.',
    order: 31,
  });
  ctx.log(
    'confluence uiRoutes mounted at /p/agent-confluence/{most-read,oldest}',
  );

  return {
    toolkit: { tools },
    async close() {
      ctx.log('deactivating confluence-playbook agent');
      disposeRoute();
      disposeMostReadDescriptor();
      disposeOldestDescriptor();
    },
  };
}
