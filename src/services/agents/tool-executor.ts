// src/services/agents/tool-executor.ts
import type { ToolSet } from 'ai';
import { createErrorContext, extractAndFormatError } from '@/lib/error-utils';
import { logger } from '@/lib/logger';
import { getToolMetadata } from '@/lib/tools';
import type { Tracer } from '@/lib/tracer';
import { decodeObjectHtmlEntities, generateId } from '@/lib/utils';
import type { AgentLoopState, UIMessage } from '@/types/agent';
import { type ExecutionStage, ToolDependencyAnalyzer } from './tool-dependency-analyzer';
import { isValidToolName, normalizeToolName } from './tool-name-normalizer';

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolExecutionOptions {
  tools: ToolSet;
  loopState: AgentLoopState;
  model: string;
  abortController?: AbortController;
  onToolMessage?: (message: UIMessage) => void;
  tracer?: Tracer;
}

/**
 * ToolExecutor handles tool execution and grouping
 */
export class ToolExecutor {
  private readonly dependencyAnalyzer: ToolDependencyAnalyzer;

  constructor() {
    this.dependencyAnalyzer = new ToolDependencyAnalyzer();
  }

  /**
   * Parse nested JSON strings in object fields
   * Handles cases where LLM returns arrays/objects as JSON strings
   */
  private parseNestedJsonStrings(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.parseNestedJsonStrings(item));
    }

    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // Check if the string looks like a JSON array or object
        const trimmed = value.trim();
        if (
          (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
          (trimmed.startsWith('{') && trimmed.endsWith('}'))
        ) {
          try {
            result[key] = JSON.parse(value);
            logger.info(`[ToolExecutor] Parsed JSON string for field '${key}'`, {
              original: value,
              parsed: result[key],
            });
          } catch (_error) {
            // If parsing fails, keep as string
            result[key] = value;
          }
        } else {
          result[key] = value;
        }
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.parseNestedJsonStrings(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Execute tool calls with smart concurrency analysis
   * This method automatically analyzes dependencies and maximizes parallelism
   */
  async executeWithSmartConcurrency(
    toolCalls: ToolCallInfo[],
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    // Generate execution plan using dependency analyzer
    const plan = this.dependencyAnalyzer.analyzeDependencies(toolCalls, options.tools);

    logger.info('Executing with smart concurrency', {
      totalTools: plan.summary.totalTools,
      totalStages: plan.summary.totalStages,
      totalGroups: plan.summary.totalGroups,
      concurrentGroups: plan.summary.concurrentGroups,
    });

    // Execute all stages sequentially
    const allResults: Array<{ toolCall: ToolCallInfo; result: unknown }> = [];

    for (const stage of plan.stages) {
      onStatus?.(`${stage.description}`);

      const stageResults = await this.executeStage(stage, options, onStatus);
      allResults.push(...stageResults);

      // Check for abort signal between stages
      if (options.abortController?.signal.aborted) {
        logger.info('Smart concurrency execution aborted between stages');
        break;
      }
    }

    return allResults;
  }

  /**
   * Execute a single stage (which may contain multiple groups)
   */
  private async executeStage(
    stage: ExecutionStage,
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    logger.info(`Executing stage: ${stage.name}`, {
      description: stage.description,
      groupCount: stage.groups.length,
    });

    const results: Array<{ toolCall: ToolCallInfo; result: unknown }> = [];

    // Execute all groups in this stage sequentially
    for (const group of stage.groups) {
      logger.info(`Executing group: ${group.id}`, {
        concurrent: group.concurrent,
        toolCount: group.tools.length,
        reason: group.reason,
        targetFiles: group.targetFiles,
      });

      const groupResults = await this.executeToolGroup(
        {
          concurrent: group.concurrent,
          tools: group.tools,
        },
        options,
        onStatus
      );

      results.push(...groupResults);

      // Check for abort signal between groups
      if (options.abortController?.signal.aborted) {
        logger.info('Stage execution aborted between groups');
        break;
      }
    }

    return results;
  }

  /**
   * Execute a single tool call
   */
  async executeToolCall(toolCall: ToolCallInfo, options: ToolExecutionOptions): Promise<unknown> {
    const { tools, loopState, model, abortController, onToolMessage } = options;

    const toolStartTime = Date.now();

    try {
      // Validate and normalize tool name to prevent API errors
      // Some AI models may return tool names with invalid characters (e.g., "bash Tool" instead of "bash")
      let normalizedToolName = toolCall.toolName;

      if (!isValidToolName(toolCall.toolName)) {
        logger.warn('[ToolExecutor] Invalid tool name detected, attempting normalization', {
          originalToolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
        });

        const normalized = normalizeToolName(toolCall.toolName);

        if (normalized) {
          normalizedToolName = normalized;
          // Update the toolCall object with normalized name
          toolCall.toolName = normalizedToolName;
          logger.info('[ToolExecutor] Successfully normalized tool name', {
            originalToolName: toolCall.toolName,
            normalizedToolName,
            toolCallId: toolCall.toolCallId,
          });
        } else {
          // If normalization fails, let it proceed with original name
          // The tool-not-found handler will provide better error messages
          logger.error('[ToolExecutor] Failed to normalize invalid tool name', {
            originalToolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
          });
        }
      }

      const tool = tools[normalizedToolName];
      if (tool && typeof tool.execute === 'function') {
        // Decode HTML entities in tool arguments to fix encoding issues from LLM output
        const decodedInput = decodeObjectHtmlEntities(toolCall.input);

        // If decodedInput is a JSON string, parse it to object
        let parsedInput = decodedInput;
        if (typeof decodedInput === 'string') {
          try {
            parsedInput = JSON.parse(decodedInput);
          } catch (error) {
            // If parsing fails, keep it as string (might be intentional string parameter)
            logger.warn('[ToolExecutor] Failed to parse input as JSON, keeping as string', {
              toolName: toolCall.toolName,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
            parsedInput = decodedInput;
          }
        } else if (typeof decodedInput === 'object' && decodedInput !== null) {
          // Parse stringified arrays/objects within the object fields
          parsedInput = this.parseNestedJsonStrings(decodedInput);
        }

        // Prepare tool arguments - create a mutable copy to allow adding properties
        // Ensure toolArgs is at least an empty object to prevent undefined from breaking parameter destructuring
        const toolArgs: Record<string, unknown> =
          typeof parsedInput === 'object' && parsedInput !== null
            ? { ...parsedInput }
            : parsedInput !== undefined
              ? { value: parsedInput }
              : {};

        // Pass special parameters to callAgent tool
        if (toolCall.toolName === 'callAgent') {
          if (abortController) {
            toolArgs._abortController = abortController;
          }
          // Pass toolCallId so callAgent can use it as the execution ID
          toolArgs._toolCallId = toolCall.toolCallId;
        }

        // Get tool metadata to check if we should render the "doing" UI
        const toolMetadata = getToolMetadata(toolCall.toolName);

        // Always send tool-call message for persistence, regardless of renderDoingUI
        // The UI can decide whether to render based on the metadata
        if (onToolMessage) {
          const toolCallMessage: UIMessage = {
            id: toolCall.toolCallId,
            role: 'tool',
            content: [
              {
                type: 'tool-call',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolArgs,
              },
            ],
            timestamp: new Date(),
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            nestedTools: [],
            // Add metadata flag so UI knows whether to render
            renderDoingUI: toolMetadata.renderDoingUI,
          };

          onToolMessage(toolCallMessage);
        } else {
          logger.warn(
            '[ToolExecutor-Send] ⚠️ onToolMessage callback is undefined, skipping tool-call message',
            {
              toolName: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
            }
          );
        }

        const toolResult = await (tool as any).execute(toolArgs);
        const toolDuration = Date.now() - toolStartTime;

        logger.info('Tool execution completed', {
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          args: toolArgs,
          duration: toolDuration,
          success: true,
        });

        // Create tool-result message after execution
        if (onToolMessage) {
          const toolResultMessage: UIMessage = {
            id: `tool-${toolCall.toolName}-${generateId(6)}`, // Use unique ID with tool name prefix
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolArgs,
                output: toolResult,
              },
            ],
            timestamp: new Date(),
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
          };
          onToolMessage(toolResultMessage);
          logger.info('[ToolExecutor] ✅ Tool-result message sent successfully');
        } else {
          logger.warn(
            '[ToolExecutor] ⚠️ onToolMessage callback is undefined, skipping tool-result message'
          );
        }

        return toolResult;
      } else {
        // Tool not found
        const toolDuration = Date.now() - toolStartTime;
        logger.error('Tool not found', undefined, {
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          duration: toolDuration,
        });

        const result = this.handleToolNotFound(toolCall, tools, model, loopState);

        return result;
      }
    } catch (error) {
      const toolDuration = Date.now() - toolStartTime;
      logger.error('Tool execution failed', error, {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        duration: toolDuration,
      });

      const result = this.handleToolExecutionError(error, toolCall, model, loopState);
      return result;
    }
  }

  /**
   * Execute a group of tool calls (concurrent or sequential)
   * Used internally by executeStage for executing groups
   */
  private async executeToolGroup(
    group: { concurrent: boolean; tools: ToolCallInfo[] },
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    if (group.concurrent && group.tools.length > 1) {
      return this.executeConcurrentTools(group.tools, options, onStatus);
    } else {
      return this.executeSequentialTools(group.tools, options, onStatus);
    }
  }

  /**
   * Execute tools concurrently
   */
  private async executeConcurrentTools(
    toolCalls: ToolCallInfo[],
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    logger.info(`Executing ${toolCalls.length} tools concurrently`);
    onStatus?.(`Processing ${toolCalls.length} tools concurrently`);

    const toolExecutionPromises = toolCalls.map(async (toolCall) => ({
      toolCall,
      result: await this.executeToolCall(toolCall, options),
    }));

    return await Promise.all(toolExecutionPromises);
  }

  /**
   * Execute tools sequentially
   */
  private async executeSequentialTools(
    toolCalls: ToolCallInfo[],
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    logger.info(`Executing ${toolCalls.length} tools sequentially`);

    const results: Array<{ toolCall: ToolCallInfo; result: unknown }> = [];

    for (const toolCall of toolCalls) {
      // Check for abort signal
      if (options.abortController?.signal.aborted) {
        logger.info('Tool execution aborted during sequential execution');
        break;
      }

      onStatus?.(`Processing tool ${toolCall.toolName}`);
      const result = await this.executeToolCall(toolCall, options);
      results.push({ toolCall, result });
    }

    return results;
  }

  /**
   * Handle tool not found error
   */
  private handleToolNotFound(
    toolCall: ToolCallInfo,
    tools: ToolSet,
    model: string,
    loopState: AgentLoopState
  ): unknown {
    const availableTools = Object.keys(tools);
    const errorMessage = `Tool '${toolCall.toolName}' not found or does not have execute method. Available tools: ${availableTools.join(', ')}`;

    const errorContext = createErrorContext(model, {
      iteration: loopState.currentIteration,
      messageCount: loopState.messages.length,
      phase: 'tool-validation',
      toolName: toolCall.toolName,
      toolInput: toolCall.input,
    });

    logger.error(`Tool not found: ${errorMessage}`, {
      ...errorContext,
      availableTools,
      requestedTool: toolCall.toolName,
      toolInput: toolCall.input,
    });

    return {
      success: false,
      error: errorMessage,
      availableTools,
      requestedTool: toolCall.toolName,
      errorType: 'tool-not-found',
    };
  }

  /**
   * Handle tool execution error
   */
  private handleToolExecutionError(
    error: unknown,
    toolCall: ToolCallInfo,
    model: string,
    loopState: AgentLoopState
  ): unknown {
    const errorContext = createErrorContext(model, {
      iteration: loopState.currentIteration,
      messageCount: loopState.messages.length,
      phase: 'tool-execution',
      toolName: toolCall.toolName,
      toolInput: toolCall.input,
    });

    const { errorDetails, formattedError } = extractAndFormatError(error, errorContext);

    logger.error(`Error executing tool ${toolCall.toolName}:`, formattedError);

    return {
      success: false,
      error: `Tool execution failed: ${errorDetails.message}`,
      toolName: toolCall.toolName,
      errorDetails: {
        name: errorDetails.name,
        message: errorDetails.message,
        status: errorDetails.status,
        code: errorDetails.code,
        timestamp: errorDetails.timestamp,
      },
    };
  }
}
