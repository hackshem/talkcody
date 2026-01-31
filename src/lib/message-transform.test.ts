import { describe, expect, it } from 'vitest';
import type { Message as ModelMessage } from '@/services/llm/types';
import { MessageTransform } from '@/lib/message-transform';

describe('MessageTransform.transform', () => {
  it('adds empty reasoning_content for DeepSeek when assistant content has no reasoning', () => {
    const msgs: ModelMessage[] = [];
    const assistantContent = [{ type: 'text', text: 'hello' }];

    const { transformedContent } = MessageTransform.transform(
      msgs,
      'deepseek-v3.2',
      'deepseek',
      assistantContent
    );

    expect(transformedContent?.content).toEqual(assistantContent);
    expect(transformedContent?.providerOptions).toEqual({
      openaiCompatible: {
        reasoning_content: '',
      },
    });
  });

  it('adds reasoning_content for DeepSeek when assistant content has reasoning', () => {
    const msgs: ModelMessage[] = [];
    const assistantContent = [
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'answer' },
    ];

    const { transformedContent } = MessageTransform.transform(
      msgs,
      'deepseek-v3.2',
      'deepseek',
      assistantContent
    );

    expect(transformedContent?.content).toEqual([{ type: 'text', text: 'answer' }]);
    expect(transformedContent?.providerOptions).toEqual({
      openaiCompatible: {
        reasoning_content: 'think',
      },
    });
  });

  it('only includes reasoning_content for Moonshot when reasoning exists', () => {
    const msgs: ModelMessage[] = [];
    const assistantContent = [{ type: 'text', text: 'hello' }];

    const { transformedContent } = MessageTransform.transform(
      msgs,
      'moonshot-v1',
      'moonshot',
      assistantContent
    );

    expect(transformedContent?.content).toEqual(assistantContent);
    expect(transformedContent?.providerOptions).toBeUndefined();
  });
});
