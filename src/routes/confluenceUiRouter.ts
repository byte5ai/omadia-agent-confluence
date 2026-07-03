import { Router } from 'express';
import { html, htmlDoc, renderRoute, safe } from '@omadia/plugin-ui-helpers';
import type { HtmlFragment } from '@omadia/plugin-ui-helpers';

import {
  ageInYears,
  fetchMostFavorited,
  fetchOldestPages,
  formatGermanDate,
  type ConfluencePageSummary,
  type ConfluenceSearchClient,
} from './confluenceDataSource.js';

export interface ConfluenceUiRouterOptions {
  /** Shared ConfluenceClient (the integration-confluence plugin's
   *  `confluence.client` service). Required — the plugin's activate()
   *  refuses to mount these routes without it. */
  readonly client: ConfluenceSearchClient;
  /** Optional logger — defaults to console.log. */
  readonly log?: (...args: unknown[]) => void;
}

/** Auto-Refresh-Intervall der Tab-Inhalte: 2 Stunden. */
const REFRESH_SECONDS = 7200;

/** Wieviele Treffer pro Tab gerendert werden. */
const RESULTS_LIMIT = 25;

/**
 * Plugin-served Confluence dashboards. Mount under `/p/agent-confluence`
 * via ctx.routes.register; the operator pins them as Teams Tabs (or opens
 * them in a browser, same URL).
 *
 * Each route SSR-fetches its data from Confluence on every request. With
 * `refreshSeconds: 7200` the Tab self-fills every 2 h — gentle on
 * Atlassian rate-limits while keeping content materially current.
 *
 * Errors during the upstream fetch render an inline banner instead of a
 * 500, so a transient outage degrades the Tab gracefully.
 */
export function createConfluenceUiRouter(
  opts: ConfluenceUiRouterOptions,
): Router {
  const router = Router();
  const log = opts.log ?? ((m: unknown) => console.log(m));

  router.get(
    '/most-read',
    renderRoute(async () => {
      let items: readonly ConfluencePageSummary[] = [];
      let fetchError: string | null = null;
      try {
        items = await fetchMostFavorited(opts.client, RESULTS_LIMIT);
      } catch (err) {
        fetchError = err instanceof Error ? err.message : String(err);
        log('[agent-confluence] most-read fetch failed:', fetchError);
      }

      return htmlDoc({
        title: 'Confluence — Meist gelesene Seiten',
        refreshSeconds: REFRESH_SECONDS,
        body: html`
          <main class="max-w-2xl mx-auto p-6 space-y-6">
            <header>
              <h1 class="text-2xl font-semibold tracking-tight">
                Meist gelesene Seiten
              </h1>
              <p class="text-sm text-slate-500">
                Top ${RESULTS_LIMIT} im Space
                <code class="text-xs bg-slate-100 px-1.5 py-0.5 rounded">${opts.client.spaceKey}</code>,
                sortiert nach Favoriten als Proxy für „Aufrufe". Aktualisiert sich alle 2 h.
              </p>
            </header>

            ${fetchError ? errorBanner(fetchError) : ''}

            ${renderPageList(items, 'lastModified')}

            <p class="text-[10px] text-slate-400 italic">
              Hinweis: Atlassian Cloud bietet via öffentlicher CQL keine
              Sortierung nach echten Seitenaufrufen — Favoriten sind die
              nächste verfügbare Annäherung. Echte View-Counts würden den
              Analytics-Endpoint pro Seite erfordern.
            </p>

            <footer class="text-[10px] uppercase tracking-wider text-slate-400 pt-4 border-t border-slate-200">
              Quelle: Confluence · CQL ORDER BY favourite DESC ·
              ${new Date().toISOString().slice(11, 19)} UTC
            </footer>
          </main>
        `,
      });
    }),
  );

  router.get(
    '/oldest',
    renderRoute(async () => {
      let items: readonly ConfluencePageSummary[] = [];
      let fetchError: string | null = null;
      try {
        items = await fetchOldestPages(opts.client, RESULTS_LIMIT);
      } catch (err) {
        fetchError = err instanceof Error ? err.message : String(err);
        log('[agent-confluence] oldest fetch failed:', fetchError);
      }

      return htmlDoc({
        title: 'Confluence — Älteste Seiten',
        refreshSeconds: REFRESH_SECONDS,
        body: html`
          <main class="max-w-2xl mx-auto p-6 space-y-6">
            <header>
              <h1 class="text-2xl font-semibold tracking-tight">
                Älteste Seiten
              </h1>
              <p class="text-sm text-slate-500">
                Top ${RESULTS_LIMIT} im Space
                <code class="text-xs bg-slate-100 px-1.5 py-0.5 rounded">${opts.client.spaceKey}</code>,
                sortiert nach Erstellungsdatum (älteste zuerst). Hilft beim
                Identifizieren veralteter Inhalte. Aktualisiert sich alle 2 h.
              </p>
            </header>

            ${fetchError ? errorBanner(fetchError) : ''}

            ${renderPageList(items, 'createdDate')}

            <footer class="text-[10px] uppercase tracking-wider text-slate-400 pt-4 border-t border-slate-200">
              Quelle: Confluence · CQL ORDER BY created ASC ·
              ${new Date().toISOString().slice(11, 19)} UTC
            </footer>
          </main>
        `,
      });
    }),
  );

  return router;
}

function renderPageList(
  items: readonly ConfluencePageSummary[],
  primaryDateField: 'lastModified' | 'createdDate',
): HtmlFragment {
  if (items.length === 0) {
    return safe(
      '<p class="text-sm text-slate-400 italic">Keine Seiten gefunden.</p>',
    );
  }
  const now = new Date();
  return html`
    <ul class="space-y-2">
      ${items.map((page, index) => {
        const primaryIso =
          primaryDateField === 'lastModified'
            ? page.lastModified
            : page.createdDate;
        const secondaryIso =
          primaryDateField === 'lastModified'
            ? page.createdDate
            : page.lastModified;
        const secondaryLabel =
          primaryDateField === 'lastModified' ? 'erstellt' : 'geändert';
        const age = ageInYears(primaryIso, now);
        const ageBadge =
          primaryDateField === 'createdDate' && age !== null && age >= 2
            ? html`
                <span
                  class="inline-block text-[10px] uppercase tracking-wider rounded px-2 py-0.5 bg-amber-100 text-amber-700"
                >
                  ${age} ${age === 1 ? 'Jahr' : 'Jahre'} alt
                </span>
              `
            : '';
        return html`
          <li
            class="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 transition-colors"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium text-slate-900 truncate">
                <span
                  class="inline-block w-6 text-xs text-slate-400 font-mono"
                  >${index + 1}.</span
                >
                ${page.url.length > 0
                  ? html`<a
                      href="${page.url}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-sky-700 hover:text-sky-900 underline decoration-sky-200 decoration-1 underline-offset-4 hover:decoration-sky-500"
                      >${page.title}<span
                        class="ml-1 text-[10px] text-sky-500/70"
                        aria-hidden="true"
                        >↗</span
                      ></a
                    >`
                  : html`<span>${page.title}</span>`}
              </div>
              ${page.author.length > 0
                ? html`
                    <div class="mt-1 ml-6 text-xs text-slate-500">
                      erstellt von
                      <span class="font-medium text-slate-700">${page.author}</span>
                    </div>
                  `
                : ''}
              ${ageBadge ? html`<div class="mt-1 ml-6">${ageBadge}</div>` : ''}
            </div>
            <div class="text-right shrink-0">
              <div class="text-xs font-mono text-slate-700">
                ${primaryIso.length > 0 ? formatGermanDate(primaryIso) : '—'}
              </div>
              <div
                class="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5"
              >
                ${primaryDateField === 'lastModified'
                  ? 'zuletzt geändert'
                  : 'erstellt'}
              </div>
              ${secondaryIso.length > 0
                ? html`
                    <div class="text-[11px] font-mono text-slate-500 mt-1.5">
                      ${formatGermanDate(secondaryIso)}
                    </div>
                    <div
                      class="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5"
                    >
                      ${secondaryLabel}
                    </div>
                  `
                : ''}
            </div>
          </li>
        `;
      })}
    </ul>
  `;
}

function errorBanner(message: string): HtmlFragment {
  return html`
    <div
      class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
    >
      <strong class="block text-sm font-semibold mb-1">
        Confluence konnte nicht gelesen werden
      </strong>
      <code class="block break-all text-rose-900/80">${message}</code>
      <p class="mt-2 text-rose-700/80">
        Das Tab versucht die Abfrage in 2 h erneut.
      </p>
    </div>
  `;
}
