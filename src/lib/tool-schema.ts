import { convertSchema, type JSONSchema7 } from '@/lib/json-schema/minimal-zod-converter';
import { logger } from '@/lib/logger';

const FALLBACK_SCHEMA: JSONSchema7 = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

function looksLikeJsonSchema(value: unknown): value is JSONSchema7 {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;

  // Exclude Zod internal format which has '~standard' or 'def.shape' properties
  if (
    '~standard' in record ||
    ('def' in record && record.def && typeof record.def === 'object' && 'shape' in record.def)
  ) {
    return false;
  }

  return (
    '$schema' in record ||
    'properties' in record ||
    'oneOf' in record ||
    'anyOf' in record ||
    'allOf' in record ||
    ('type' in record &&
      (record.type === 'object' ||
        record.type === 'string' ||
        record.type === 'number' ||
        record.type === 'integer' ||
        record.type === 'array' ||
        record.type === 'boolean' ||
        record.type === 'null'))
  );
}

export function toToolInputJsonSchema(inputSchema: unknown): JSONSchema7 {
  if (looksLikeJsonSchema(inputSchema)) {
    return inputSchema;
  }

  const converted = convertSchema(inputSchema);
  if (converted) {
    return converted;
  }

  logger.warn('[ToolSchema] Failed to normalize tool input schema', {
    error: 'Unsupported input schema',
  });
  return FALLBACK_SCHEMA;
}

/**
 * Normalizes a tool parameter schema to be OpenAI-compatible
 * - Ensures type: "object" is at the top
 * - Adds additionalProperties: false if not present
 * - Orders fields: type, properties, required, additionalProperties
 */
function normalizeParameterSchema(schema: JSONSchema7): JSONSchema7 {
  if (!schema || typeof schema !== 'object') {
    return FALLBACK_SCHEMA;
  }

  // If it's not an object type, return as-is
  if (schema.type !== 'object') {
    return schema;
  }

  // Build normalized schema with proper field order
  const normalized: JSONSchema7 = {
    type: 'object',
  };

  // Add properties if present
  if (schema.properties && typeof schema.properties === 'object') {
    normalized.properties = schema.properties;
  }

  // Add required if present
  if (Array.isArray(schema.required) && schema.required.length > 0) {
    normalized.required = schema.required;
  }

  // Always add additionalProperties: false for strict mode
  normalized.additionalProperties = false;

  return normalized;
}

/**
 * Tool definition in OpenAI-compatible format
 * Field order: type, name, description, parameters, strict
 */
export interface OpenAIToolDefinition {
  type: 'function';
  name: string;
  description?: string | null;
  parameters: JSONSchema7;
  strict: true;
}

/**
 * Converts a tool definition to OpenAI-compatible format
 * - Normalizes the schema
 * - Ensures correct field order
 * - Adds strict: true
 */
export function toOpenAIToolDefinition(
  name: string,
  description: string | null | undefined,
  inputSchema: unknown
): OpenAIToolDefinition {
  // Convert to JSON Schema if needed
  const jsonSchema = toToolInputJsonSchema(inputSchema);

  // Normalize the parameter schema
  const normalizedSchema = normalizeParameterSchema(jsonSchema);

  // Return with explicit field order for OpenAI compatibility
  return {
    type: 'function',
    name,
    description,
    parameters: normalizedSchema,
    strict: true,
  };
}
