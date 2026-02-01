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

  it('adds enum type when Zod enum contains strings', () => {
    const inputSchema = z.object({
      operation: z.enum(['one', 'two']),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    const operationSchema = (jsonSchema.properties as Record<string, unknown>)
      ?.operation as Record<string, unknown>;

    expect(operationSchema).toEqual(
      expect.objectContaining({
        type: 'string',
        enum: ['one', 'two'],
      })
    );
  });

  it('adds enum type for native enums with string values', () => {
    const Status = { Pending: 'pending', Done: 'done' } as const;
    const inputSchema = z.object({
      status: z.nativeEnum(Status),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    const statusSchema = (jsonSchema.properties as Record<string, unknown>)
      ?.status as Record<string, unknown>;

    expect(statusSchema).toEqual(
      expect.objectContaining({
        type: 'string',
        enum: ['pending', 'done'],
      })
    );
  });

  it('keeps enum without type when mixed values are present', () => {
    const Mixed = { On: 'on', Off: 0 } as const;
    const inputSchema = z.object({
      value: z.nativeEnum(Mixed),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    const valueSchema = (jsonSchema.properties as Record<string, unknown>)
      ?.value as Record<string, unknown>;

    expect(valueSchema).toEqual(
      expect.objectContaining({
        enum: ['on', 0],
      })
    );
    expect(valueSchema.type).toBeUndefined();
  });

  it('adds enum type for Zod enums in nested objects', () => {
    const inputSchema = z.object({
      nested: z.object({
        state: z.enum(['ready', 'busy']),
      }),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    const nestedSchema = (jsonSchema.properties as Record<string, unknown>)
      ?.nested as Record<string, unknown>;
    const stateSchema = (nestedSchema.properties as Record<string, unknown>)
      ?.state as Record<string, unknown>;

    expect(stateSchema).toEqual(
      expect.objectContaining({
        type: 'string',
        enum: ['ready', 'busy'],
      })
    );
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
