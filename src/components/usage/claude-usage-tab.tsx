// src/pages/usage/claude-usage-tab.tsx
// Claude usage tab component

import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useLocale } from '@/hooks/use-locale';
import { useClaudeOAuthStore } from '@/providers/oauth/claude-oauth-store';
import {
  getRemainingPercentage as getClaudeRemainingPercentage,
  getTimeUntilReset as getClaudeTimeUntilReset,
  getUsageLevel as getClaudeUsageLevel,
  getWeeklyResetDisplay as getClaudeWeeklyResetDisplay,
} from '@/services/claude-usage-service';
import { useClaudeUsageStore } from '@/stores/claude-usage-store';

// Helper to get color classes based on usage level
function getLevelColor(level: string): string {
  switch (level) {
    case 'low':
      return 'text-green-600 dark:text-green-400';
    case 'medium':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'high':
      return 'text-orange-600 dark:text-orange-400';
    case 'critical':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-muted-foreground';
  }
}

export function ClaudeUsageTab() {
  const { t } = useLocale();

  // Claude OAuth state
  const isOAuthConnected = useClaudeOAuthStore((state) => state.isConnected);
  const startOAuth = useClaudeOAuthStore((state) => state.startOAuth);

  // Usage state
  const usageData = useClaudeUsageStore((state) => state.usageData);
  const isLoading = useClaudeUsageStore((state) => state.isLoading);
  const error = useClaudeUsageStore((state) => state.error);
  const initialize = useClaudeUsageStore((state) => state.initialize);
  const refresh = useClaudeUsageStore((state) => state.refresh);

  // Initialize on mount
  useEffect(() => {
    if (isOAuthConnected) {
      initialize();
    }
  }, [isOAuthConnected, initialize]);

  // Handle OAuth login
  const handleConnect = async () => {
    try {
      const url = await startOAuth();
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to start OAuth:', err);
    }
  };

  // Handle refresh
  const handleRefresh = async () => {
    await refresh();
  };

  // Not connected state
  if (!isOAuthConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.usage.title}</CardTitle>
          <CardDescription>{t.usage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.usage.notConnected}</AlertTitle>
            <AlertDescription>{t.usage.connectPrompt}</AlertDescription>
          </Alert>
          <Button onClick={handleConnect}>{t.usage.connectButton}</Button>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.usage.title}</CardTitle>
          <CardDescription>{t.usage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.usage.error}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={handleRefresh} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.usage.refreshing}
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t.usage.retry}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading && !usageData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.usage.title}</CardTitle>
          <CardDescription>{t.usage.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!usageData || !usageData.five_hour || !usageData.seven_day) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.usage.title}</CardTitle>
          <CardDescription>{t.usage.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.usage.noData}</AlertTitle>
            <AlertDescription>{t.usage.noDataDescription}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Get usage levels with safe access
  const fiveHourLevel = getClaudeUsageLevel(usageData.five_hour?.utilization_pct ?? 0);
  const sevenDayLevel = getClaudeUsageLevel(usageData.seven_day?.utilization_pct ?? 0);

  // Calculate remaining percentages
  const fiveHourRemaining = getClaudeRemainingPercentage(usageData.five_hour?.utilization_pct ?? 0);
  const sevenDayRemaining = getClaudeRemainingPercentage(usageData.seven_day?.utilization_pct ?? 0);

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button onClick={handleRefresh} disabled={isLoading} variant="outline" size="sm">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t.usage.refreshing}
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t.usage.refresh}
            </>
          )}
        </Button>
      </div>

      {/* 5-Hour Session Usage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t.usage.fiveHour.title}</CardTitle>
              <CardDescription>{t.usage.fiveHour.description}</CardDescription>
            </div>
            {usageData.five_hour.reset_at && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.usage.resetsIn}: {getClaudeTimeUntilReset(usageData.five_hour.reset_at)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.usage.used}: {(usageData.five_hour?.utilization_pct ?? 0).toFixed(1)}%
              </span>
              <span className={`text-sm font-medium ${getLevelColor(fiveHourLevel)}`}>
                {t.usage.remaining}: {fiveHourRemaining.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.five_hour?.utilization_pct ?? 0} className="h-2" />
          </div>
          {fiveHourLevel === 'critical' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t.usage.criticalWarning}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 7-Day Weekly Usage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t.usage.sevenDay.title}</CardTitle>
              <CardDescription>{t.usage.sevenDay.description}</CardDescription>
            </div>
            {usageData.seven_day.reset_at && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.usage.resetsIn}: {getClaudeWeeklyResetDisplay(usageData.seven_day.reset_at)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.usage.used}: {(usageData.seven_day?.utilization_pct ?? 0).toFixed(1)}%
              </span>
              <span className={`text-sm font-medium ${getLevelColor(sevenDayLevel)}`}>
                {t.usage.remaining}: {sevenDayRemaining.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.seven_day?.utilization_pct ?? 0} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Model-Specific Usage */}
      {(usageData.seven_day_sonnet || usageData.seven_day_opus) && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Sonnet Usage */}
          {usageData.seven_day_sonnet && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t.usage.sonnet.title}</CardTitle>
                    <CardDescription>{t.usage.sonnet.description}</CardDescription>
                  </div>
                  {usageData.seven_day_sonnet.reset_at && (
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t.usage.resetsIn}:{' '}
                      {getClaudeWeeklyResetDisplay(usageData.seven_day_sonnet.reset_at)}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {(usageData.seven_day_sonnet?.utilization_pct ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <Progress
                    value={usageData.seven_day_sonnet?.utilization_pct ?? 0}
                    className="h-2"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Opus Usage */}
          {usageData.seven_day_opus && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t.usage.opus.title}</CardTitle>
                    <CardDescription>{t.usage.opus.description}</CardDescription>
                  </div>
                  {usageData.seven_day_opus.reset_at && (
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t.usage.resetsIn}:{' '}
                      {getClaudeWeeklyResetDisplay(usageData.seven_day_opus.reset_at)}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {(usageData.seven_day_opus?.utilization_pct ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <Progress
                    value={usageData.seven_day_opus?.utilization_pct ?? 0}
                    className="h-2"
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Extra Usage */}
      {usageData.extra_usage && (
        <Card>
          <CardHeader>
            <CardTitle>{t.usage.extra.title}</CardTitle>
            <CardDescription>{t.usage.extra.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t.usage.extra.currentSpending}</p>
                <p className="text-2xl font-bold">
                  ${(usageData.extra_usage?.current_spending ?? 0).toFixed(2)}
                </p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-sm text-muted-foreground">{t.usage.extra.budgetLimit}</p>
                <p className="text-2xl font-bold">
                  ${(usageData.extra_usage?.budget_limit ?? 0).toFixed(2)}
                </p>
              </div>
            </div>
            <Progress
              value={
                ((usageData.extra_usage?.current_spending ?? 0) /
                  (usageData.extra_usage?.budget_limit ?? 1)) *
                100
              }
              className="h-2"
            />
          </CardContent>
        </Card>
      )}

      {/* Plan Info */}
      {usageData.rate_limit_tier && (
        <Card>
          <CardHeader>
            <CardTitle>{t.usage.plan.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-medium">{usageData.rate_limit_tier}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
