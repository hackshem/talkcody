// Changelog data service for What's New dialog

export type ChangelogItem =
  | string
  | {
      title: string;
      description?: string;
      videoUrl?: string;
    };

export interface ChangelogContent {
  added?: ChangelogItem[];
  changed?: ChangelogItem[];
  fixed?: ChangelogItem[];
  removed?: ChangelogItem[];
  security?: ChangelogItem[];
  deprecated?: ChangelogItem[];
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
    version: '0.3.5',
    date: '2026-02-05',
    en: {
      added: [
        'Support for Claude Opus 4.6 model.',
        'Support for GPT 5.3 Codex model (OpenAI OAuth only).',
        'Support for disabling Tracing.',
      ],
      changed: [
        {
          title: 'Model Search Optimization',
          description: 'Model search now supports filtering by provider name.',
        },
      ],
      fixed: [
        'Fixed Issue #47: Windows workspace-root path handling bug.',
        'Fixed Issue #46: OpenAI OAuth login flow issues.',
      ],
    },
    zh: {
      added: [
        '支持 Claude Opus 4.6 模型',
        '支持 GPT 5.3 Codex 模型 （只有 Openai OAuth 方式支持）',
        '支持 关闭 Tracing 功能',
      ],
      changed: [
        {
          title: '模型搜索优化',
          description: '模型搜索支持按照 provider 名称过滤',
        },
      ],
      fixed: [
        '修复 Issue #47：修复 Windows 平台 workspace-root 路径处理的 bug。',
        '修复 Issue #46：修复 OpenAI OAuth 登录流程中的问题。',
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
