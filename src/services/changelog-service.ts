// Changelog data service for What's New dialog

export interface ChangelogContent {
  added?: string[];
  changed?: string[];
  fixed?: string[];
  removed?: string[];
  security?: string[];
  deprecated?: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  en: ChangelogContent;
  zh: ChangelogContent;
}

// Changelog data - update this when releasing new versions
// Only include the most recent versions that users care about
export const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    version: '0.1.17',
    date: '2025-12-11',
    en: {
      added: [
        'Support for multiple sessions running in parallel, significantly improving workflow efficiency',
        'Custom AI provider configuration support',
        'New built-in Minimax Coding Plan MCP with web search and image input support',
        'New built-in GLM Coding Plan MCP with web search and image input support',
        'New built-in AI provider: Moonshot',
        'New built-in model: GLM-4.6 v',
      ],
      changed: [
        'Optimized Bash tool output for better performance',
        'Optimized GitHub PR tool output for better performance',
        'Optimized Context Compaction logic for improved multi-turn conversation performance',
      ],
      fixed: [
        'Fixed HTTP MCP server header configuration bug',
        'Fixed Stdio MCP server not supporting custom environment variables',
        'Fixed database exit issue when using multiple windows',
      ],
    },
    zh: {
      added: [
        '支持多个会话并行执行, 大幅提升工作流效率',
        '支持自定义 AI 提供商',
        '新增内置 Minimax Coding Plan MCP，支持网页搜索和图像输入',
        '新增内置 GLM Coding Plan MCP，支持网页搜索和图像输入',
        '新增内置 AI 提供商：moonshot',
        '新增内置模型：GLM-4.6 v',
      ],
      changed: [
        '优化 Bash 工具输出以提升性能',
        '优化 Github PR 工具输出以提升性能',
        '优化 Context Compaction 逻辑，提升多轮对话性能',
      ],
      fixed: [
        '修复 HTTP MCP 服务器请求头配置问题',
        '修复 Stdio MCP 服务器不支持自定义环境变量的问题',
        '修复多窗口时，数据库提前退出时的问题',
      ],
    },
  },
];

export function getChangelogForVersion(version: string): ChangelogEntry | undefined {
  return CHANGELOG_DATA.find((entry) => entry.version === version);
}

export function getLatestChangelog(): ChangelogEntry | undefined {
  return CHANGELOG_DATA[0];
}
