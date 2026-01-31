import type { ContentPart, Message as ModelMessage } from '@/services/llm/types';

export namespace MessageTransform {
  function shouldApplyCaching(providerId: string, modelId: string): boolean {
    const lowerProviderId = providerId.toLowerCase();
    const lowerModelId = modelId.toLowerCase();

    return (
      lowerProviderId.includes('anthropic') ||
      lowerProviderId.includes('claude') ||
      lowerModelId.includes('anthropic') ||
      lowerModelId.includes('claude') ||
      lowerModelId.includes('minimax')
    );
  }

  function applyCacheToMessage(msg: ModelMessage, providerId: string): void {
    const normalized = providerId.toLowerCase();
    const providerOptions =
      normalized.includes('anthropic') || normalized.includes('claude')
        ? { anthropic: { cacheControl: { type: 'ephemeral' } } }
        : normalized.includes('openrouter')
          ? { openrouter: { cache_control: { type: 'ephemeral' } } }
          : { openaiCompatible: { cache_control: { type: 'ephemeral' } } };

    const msgWithOptions = msg as unknown as { providerOptions?: object };
    msgWithOptions.providerOptions = {
      ...(msgWithOptions.providerOptions ?? {}),
      ...providerOptions,
    };
  }

  function applyCaching(msgs: ModelMessage[], providerId: string): void {
    const finalMsgs = msgs.filter((msg) => msg.role !== 'system').slice(-2);
    for (const msg of finalMsgs) {
      applyCacheToMessage(msg, providerId);
    }
  }

  function extractReasoning(content: ContentPart[]): {
    content: ContentPart[];
    reasoningText: string;
  } {
    const reasoningParts = content.filter((part) => part.type === 'reasoning');
    const reasoningText = reasoningParts.map((part) => part.text).join('');
    const filteredContent = content.filter((part) => part.type !== 'reasoning');

    return { content: filteredContent, reasoningText };
  }

  export function transform(
    msgs: ModelMessage[],
    modelId: string,
    providerId?: string,
    assistantContent?: ContentPart[]
  ): {
    messages: ModelMessage[];
    transformedContent?: {
      content: ContentPart[];
      providerOptions?: { openaiCompatible: { reasoning_content: string } };
    };
  } {
    // Apply prompt caching for supported providers
    if (providerId && shouldApplyCaching(providerId, modelId)) {
      applyCaching(msgs, providerId);
    }

    const normalizedProviderId = providerId?.toLowerCase();

    // Transform assistant content for providers that require reasoning_content
    if (
      assistantContent &&
      (normalizedProviderId === 'moonshot' || normalizedProviderId === 'deepseek')
    ) {
      const extracted = extractReasoning(assistantContent);
      const hasToolCall = assistantContent.some((part) => part.type === 'tool-call');
      const shouldIncludeReasoningContent =
        normalizedProviderId === 'deepseek' ||
        extracted.reasoningText.length > 0 ||
        (normalizedProviderId === 'moonshot' && hasToolCall);
      const reasoningContent =
        normalizedProviderId === 'moonshot' &&
        shouldIncludeReasoningContent &&
        extracted.reasoningText.length === 0
          ? ' '
          : extracted.reasoningText;
      const transformedContent = {
        content: extracted.content,
        providerOptions: shouldIncludeReasoningContent
          ? {
              openaiCompatible: {
                reasoning_content: reasoningContent,
              },
            }
          : undefined,
      };

      return { messages: msgs, transformedContent };
    }

    // Default passthrough
    const transformedContent = assistantContent ? { content: assistantContent } : undefined;

    return { messages: msgs, transformedContent };
  }
}
