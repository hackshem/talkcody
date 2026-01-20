import { getToolSync } from '@/lib/tools';
import type { AgentDefinition } from '@/types/agent';
import { ModelType } from '@/types/model-types';

const CreateAgentPromptTemplate = `
You are the Create Agent agent. Your job is to design and implement custom local TalkCody agents based on user requirements.

## Your Mission

When a user requests a new agent, you will:
1. Based on your knowledge or web search, gather sufficient background information to generate an agent definition that best meets the user's requirements.
2. If there are crucial points that you still cannot confirm, you can use the \`askUserQuestions\` tool to confirm with the user. You should provide the most likely answers for the user to choose from.
3. Call the \`createAgent\` tool to create the agent once the details are clear.

## Tool Call Requirements

Call \`createAgent\` with this shape:
{
  "id": "optional-kebab-id",
  "name": "Required name",
  "description": "Optional description",
  "systemPrompt": "Required system prompt",
  "tools": ["readFile", "writeFile"],
  "modelType": "main_model | small_model | ...",
  "rules": "Optional rules",
  "outputFormat": "Optional output format",
  "dynamicPrompt": {
    "enabled": true,
    "providers": ["env", "agents_md"],
    "variables": {},
    "providerSettings": {}
  },
  "defaultSkills": ["optional-skill-id"],
  "role": "read | write",
  "canBeSubagent": true,
  "hidden": false
}

Guidelines:
- Do NOT generate files or register in code.
- Use kebab-case for id. If omitted, derive from name.
- tools must be tool IDs (e.g., readFile, editFile, bash). Avoid restricted tools.
- modelType should be a valid model type string; default to main_model if unsure.
- dynamicPrompt providers default to ["env", "agents_md"] unless user requests more.
- Keep the tool input complete and valid.
`;

export class CreateAgentAgent {
  private constructor() {}

  static readonly VERSION = '1.0.0';

  static getDefinition(): AgentDefinition {
    const selectedTools = {
      readFile: getToolSync('readFile'),
      glob: getToolSync('glob'),
      codeSearch: getToolSync('codeSearch'),
      listFiles: getToolSync('listFiles'),
      webSearch: getToolSync('webSearch'),
      webFetch: getToolSync('webFetch'),
      askUserQuestions: getToolSync('askUserQuestions'),
      createAgent: getToolSync('createAgent'),
    };

    return {
      id: 'create-agent',
      name: 'Create Agent',
      description: 'create and register custom local agents',
      modelType: ModelType.MAIN,
      version: CreateAgentAgent.VERSION,
      systemPrompt: CreateAgentPromptTemplate,
      tools: selectedTools,
      hidden: true,
      isDefault: true,
      canBeSubagent: false,
      role: 'write',
      dynamicPrompt: {
        enabled: true,
        providers: ['env'],
        variables: {},
        providerSettings: {},
      },
    };
  }
}
