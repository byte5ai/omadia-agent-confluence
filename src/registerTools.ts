import type {
  LocalSubAgentTool,
  NativeToolSpec,
  PluginContext,
  ToolRegistrationOptions,
} from '@omadia/plugin-api';

/**
 * Tool-runtime contract (spec 2042 §5.10, ADR-0014): a capability plugin
 * registers each tool with the kernel via `ctx.tools.register(spec, handler)`.
 * The kernel offers the tools to the agents the operator granted this plugin
 * to; the calling agent decides when to use them. This plugin has no persona,
 * no system prompt and no model loop of its own.
 *
 * The tools themselves are built by `@omadia/integration-confluence` and
 * published as the `confluence.toolkit` service (a `LocalSubAgentTool[]`).
 * This plugin re-registers them under its own grant, so an operator can give
 * an agent the playbook tools without giving it the whole integration.
 */

/** Knowledge that used to live in the playbook skill, appended per tool. */
export type ToolDocs = Readonly<Record<string, string>>;

export interface RegisterToolkitOptions {
  /** Text appended to the description of the tool with this name. */
  readonly docs?: ToolDocs;
  /** Registration options (e.g. `writeCapabilities`) per tool name. */
  readonly options?: Readonly<Record<string, ToolRegistrationOptions>>;
}

/**
 * Register every toolkit tool with the kernel. The handler returns the text
 * of the tool result: a string verbatim, a structured result as its `output`.
 *
 * Returns one dispose function that unregisters every tool; call it from
 * `close()`.
 */
export function registerToolkitTools(
  ctx: PluginContext,
  tools: readonly LocalSubAgentTool[],
  opts: RegisterToolkitOptions = {},
): () => void {
  const disposers = tools.map((tool) => {
    const name = tool.spec.name;
    const extra = opts.docs?.[name];
    const spec: NativeToolSpec = {
      name,
      description: extra ? `${tool.spec.description}\n\n${extra}` : tool.spec.description,
      input_schema: {
        type: 'object',
        properties: tool.spec.input_schema.properties,
        ...(tool.spec.input_schema.required.length > 0
          ? { required: tool.spec.input_schema.required }
          : {}),
      },
    };
    return ctx.tools.register(
      spec,
      async (input) => {
        const result = await tool.handle(input);
        return typeof result === 'string' ? result : result.output;
      },
      opts.options?.[name],
    );
  });
  return () => {
    for (const dispose of disposers) dispose();
  };
}
