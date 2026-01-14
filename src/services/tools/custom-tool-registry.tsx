import { createTool } from '@/lib/create-tool';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { ToolWithUI } from '@/types/tool';
import { CustomToolDoingFallback, CustomToolResultFallback } from './custom-tool-ui-fallback';

function fallbackDescription(definition: CustomToolDefinition) {
  return definition.description || definition.name;
}

export function adaptCustomTool(definition: CustomToolDefinition): ToolWithUI {
  const description = fallbackDescription(definition);

  const renderToolDoing =
    definition.renderToolDoing ??
    ((params: Record<string, unknown>) => {
      return <CustomToolDoingFallback toolName={definition.name} />;
    });

  const renderToolResult =
    definition.renderToolResult ??
    ((result: unknown, params: Record<string, unknown>) => {
      if (result && typeof result === 'object') {
        const resultObj = result as { success?: boolean; error?: string };
        if (resultObj.success === false || resultObj.error) {
          return (
            <CustomToolResultFallback
              success={resultObj.success ?? false}
              error={resultObj.error || 'Custom tool failed'}
            />
          );
        }
      }

      const message = typeof result === 'string' ? result : 'Custom tool executed';
      return <CustomToolResultFallback message={message} success={true} />;
    });

  return createTool({
    name: definition.name,
    description,
    inputSchema: definition.inputSchema,
    canConcurrent: definition.canConcurrent ?? false,
    hidden: definition.hidden,
    showResultUIAlways: definition.showResultUIAlways,
    execute: definition.execute,
    renderToolDoing,
    renderToolResult,
  });
}

export function adaptCustomTools(definitions: CustomToolDefinition[]): Record<string, ToolWithUI> {
  const tools: Record<string, ToolWithUI> = {};

  for (const definition of definitions) {
    tools[definition.name] = adaptCustomTool(definition);
  }

  return tools;
}
