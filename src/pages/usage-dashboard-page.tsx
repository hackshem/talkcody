// src/pages/usage-dashboard-page.tsx
// Unified dashboard page for displaying usage from multiple providers

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ClaudeUsageTab,
  GitHubCopilotUsageTab,
  MinimaxUsageTab,
  OpenAIUsageTab,
  ZhipuUsageTab,
} from '@/components/usage';

export function UsageDashboardPage() {
  return (
    <div className="container mx-auto p-6">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Usage Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor your AI subscription usage across providers
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="claude" className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-5">
            <TabsTrigger value="claude">Claude</TabsTrigger>
            <TabsTrigger value="openai">OpenAI</TabsTrigger>
            <TabsTrigger value="github-copilot">GitHub Copilot</TabsTrigger>
            <TabsTrigger value="zhipu">Zhipu AI</TabsTrigger>
            <TabsTrigger value="minimax">MiniMax</TabsTrigger>
          </TabsList>
          <TabsContent value="claude" className="mt-6">
            <ClaudeUsageTab />
          </TabsContent>
          <TabsContent value="openai" className="mt-6">
            <OpenAIUsageTab />
          </TabsContent>
          <TabsContent value="github-copilot" className="mt-6">
            <GitHubCopilotUsageTab />
          </TabsContent>
          <TabsContent value="zhipu" className="mt-6">
            <ZhipuUsageTab />
          </TabsContent>
          <TabsContent value="minimax" className="mt-6">
            <MinimaxUsageTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
