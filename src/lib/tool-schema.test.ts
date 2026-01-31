import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toToolInputJsonSchema, toOpenAIToolDefinition } from './tool-schema';

describe('toToolInputJsonSchema', () => {
  it('converts Zod schema to JSON schema', () => {
    const inputSchema = z.object({
      message: z.string(),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    expect(jsonSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: {
          message: expect.objectContaining({ type: 'string' }),
        },
      })
    );

    expect((jsonSchema as Record<string, unknown>)._def).toBeUndefined();
  });

  it('handles default values in Zod schemas', () => {
    const inputSchema = z.object({
      mode: z.enum(['a', 'b']).default('a'),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    const modeSchema = (jsonSchema.properties as Record<string, unknown>)?.mode as Record<
      string,
      unknown
    >;
    expect(modeSchema?.default).toBe('a');
  });

  it('passes through JSON schema input unchanged', () => {
    const jsonSchema = {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    };

    const result = toToolInputJsonSchema(jsonSchema);

    expect(result).toBe(jsonSchema);
  });

  it('returns fallback schema for invalid input', () => {
    const result = toToolInputJsonSchema(null);

    expect(result).toBeDefined();
    expect(result.properties).toEqual({});
    expect(result.additionalProperties).toBe(false);
  });

  it('converts to OpenAI tool definition format', () => {
    const toolDef = toOpenAIToolDefinition('testTool', 'A test tool', z.object({ message: z.string() }));
    
    expect(toolDef).toBeDefined();
    expect(toolDef.type).toBe('function');
    expect(toolDef.name).toBe('testTool');
    expect(toolDef.description).toBe('A test tool');
    expect(toolDef.strict).toBe(true);
    expect(toolDef.parameters).toBeDefined();
    expect(toolDef.parameters.type).toBe('object');
    expect(toolDef.parameters.additionalProperties).toBe(false);
  });
});
