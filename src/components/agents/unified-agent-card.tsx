// Unified agent card component for both marketplace and local agents

import type { MarketplaceAgent, Tag } from '@talkcody/shared';
import { Download, GitFork, Pause, Pencil, Play, Share2, Star, Trash2, User } from 'lucide-react';
import { BetaBadge } from '@/components/beta-badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { Agent } from '@/types';
import type { AgentDefinition } from '@/types/agent';

type UnifiedAgent = (MarketplaceAgent | AgentDefinition | Agent) & {
  _type?: 'marketplace' | 'local';
  // For local agents (database agents use source_type, not sourceType)
  marketplace_id?: string;
  is_enabled?: boolean;
  isBeta?: boolean;
};

interface UnifiedAgentCardProps {
  agent: UnifiedAgent;
  onClick: () => void;
  // Marketplace actions
  onInstall?: (agent: MarketplaceAgent) => void;
  isInstalling?: boolean;
  // Local agent actions
  onEdit?: () => void;
  onDelete?: () => void;
  onFork?: () => void;
  onShare?: () => void;
  onToggleActive?: () => void;
}

function isMarketplaceAgent(agent: UnifiedAgent): agent is MarketplaceAgent {
  return '_type' in agent && agent._type === 'marketplace';
}

function isLocalAgent(agent: UnifiedAgent): agent is AgentDefinition {
  return '_type' in agent && agent._type === 'local';
}

function isDatabaseAgent(agent: UnifiedAgent): agent is Agent {
  return 'source_type' in agent;
}

export function UnifiedAgentCard({
  agent,
  onClick,
  onInstall,
  isInstalling = false,
  onEdit,
  onDelete,
  onFork,
  onShare,
  onToggleActive,
}: UnifiedAgentCardProps) {
  const isMarketplace = isMarketplaceAgent(agent);
  const isLocal = isLocalAgent(agent) || isDatabaseAgent(agent);
  const isSystemAgent = isDatabaseAgent(agent) && agent.source_type === 'system';
  const isEnabled = isDatabaseAgent(agent) ? agent.is_enabled : true;

  // Get display name and description
  const name = agent.name;
  const description = agent.description || '';

  // Get icon
  let iconUrl: string | undefined;
  if (isMarketplaceAgent(agent)) {
    iconUrl = agent.iconUrl;
  } else if (isDatabaseAgent(agent)) {
    iconUrl = agent.icon_url;
  }

  // Get author info (marketplace only)
  const author = isMarketplaceAgent(agent) ? agent.author : null;

  // Get tags (marketplace only)
  const tags = isMarketplaceAgent(agent) ? agent.tags : [];

  // Get stats (marketplace only)
  const installCount = isMarketplaceAgent(agent) ? agent.installCount : 0;
  const rating = isMarketplaceAgent(agent) ? agent.rating : 0;
  const ratingCount = isMarketplaceAgent(agent) ? agent.ratingCount : 0;
  const isFeatured = isMarketplaceAgent(agent) ? agent.isFeatured : false;

  return (
    <Card
      className="group relative cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 border-border/50 hover:border-primary/20 bg-gradient-to-br from-card via-card to-card/95 overflow-hidden"
      onClick={onClick}
    >
      {agent.isBeta && <BetaBadge variant="corner" className="z-10" />}
      {/* Subtle gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-primary/[0.03] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

      {/* Status indicator bar */}
      {!isEnabled && <div className="absolute top-0 left-0 right-0 h-0.5 bg-muted" />}
      {isEnabled && isLocal && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-green-500/50 via-emerald-500/50 to-green-500/50" />
      )}

      <CardHeader className="pb-3">
        <div className="flex items-start gap-4">
          {/* Enhanced agent icon with gradient background */}
          <div className="relative shrink-0">
            {iconUrl ? (
              <div className="relative w-14 h-14 rounded-xl overflow-hidden ring-2 ring-border/50 group-hover:ring-primary/30 transition-all">
                <img src={iconUrl} alt={name} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 flex items-center justify-center ring-2 ring-border/50 group-hover:ring-primary/30 transition-all backdrop-blur-sm">
                <User className="h-7 w-7 text-primary" />
              </div>
            )}

            {/* Active indicator */}
            {isEnabled && isLocal && (
              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-500 ring-2 ring-card flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Title and badges */}
            <div className="flex items-start gap-2 mb-1.5">
              <CardTitle className="text-lg font-semibold truncate group-hover:text-primary transition-colors">
                {name}
              </CardTitle>
              <div className="flex items-center gap-1.5 flex-wrap">
                {isFeatured && (
                  <Badge
                    variant="default"
                    className="shrink-0 bg-gradient-to-r from-amber-500/90 to-yellow-500/90 border-0 shadow-sm"
                  >
                    <Star className="h-3 w-3 mr-1 fill-current" />
                    Featured
                  </Badge>
                )}
                {isSystemAgent && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 bg-blue-500/10 text-blue-500 border-blue-500/20"
                  >
                    System
                  </Badge>
                )}
                {!isEnabled && (
                  <Badge
                    variant="outline"
                    className="shrink-0 opacity-70 border-muted-foreground/30"
                  >
                    Inactive
                  </Badge>
                )}
              </div>
            </div>

            {/* Description with better typography */}
            <CardDescription className="text-sm line-clamp-2 leading-relaxed">
              {description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="py-3 space-y-3">
        {/* Stats section with improved styling */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {isMarketplace && (
            <>
              <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded-md">
                <Download className="h-3.5 w-3.5" />
                <span className="font-medium">{installCount.toLocaleString()}</span>
              </div>

              {rating > 0 && (
                <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded-md">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  <span className="font-medium">{rating}</span>
                  <span className="opacity-60">({ratingCount})</span>
                </div>
              )}

              {author && (
                <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded-md">
                  <Avatar className="h-4 w-4">
                    <AvatarImage src={author.avatarUrl || ''} />
                    <AvatarFallback className="text-[10px]">
                      {author.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate font-medium">{author.name}</span>
                </div>
              )}
            </>
          )}

          {isLocal && isDatabaseAgent(agent) && (
            <>
              {agent.source_type === 'marketplace' && (
                <Badge
                  variant="outline"
                  className="text-xs bg-blue-500/5 border-blue-500/20 text-blue-500"
                >
                  Installed
                </Badge>
              )}
              {agent.source_type === 'local' && (
                <Badge
                  variant="outline"
                  className="text-xs bg-purple-500/5 border-purple-500/20 text-purple-500"
                >
                  Custom
                </Badge>
              )}
            </>
          )}
        </div>

        {/* Tags with improved styling */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 3).map((tag: Tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                className="text-xs bg-muted/30 hover:bg-muted/50 transition-colors border-border/50"
              >
                {tag.name}
              </Badge>
            ))}
            {tags.length > 3 && (
              <Badge variant="outline" className="text-xs bg-muted/30 border-border/50">
                +{tags.length - 3} more
              </Badge>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-3 pb-4 gap-2 flex-wrap">
        {/* Marketplace actions */}
        {isMarketplace && (
          <Button
            size="sm"
            className="flex-1 min-w-[120px] bg-primary hover:bg-primary/90 shadow-sm hover:shadow-md transition-all"
            onClick={(e) => {
              e.stopPropagation();
              onInstall?.(agent as MarketplaceAgent);
            }}
            disabled={isInstalling || !onInstall}
          >
            {isInstalling ? 'Installing...' : 'Install'}
          </Button>
        )}

        {/* Local agent actions - Icon buttons with labels */}
        {isLocal && (
          <div className="flex items-center justify-center gap-2 w-full">
            {!isSystemAgent && onEdit && (
              <button
                type="button"
                className="flex flex-col items-center gap-1 px-2 py-1.5 rounded-md hover:bg-primary/10 transition-all group"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors font-medium">
                  Edit
                </span>
              </button>
            )}

            {onFork && (
              <button
                type="button"
                className="flex flex-col items-center gap-1 px-2 py-1.5 rounded-md hover:bg-primary/10 transition-all group"
                onClick={(e) => {
                  e.stopPropagation();
                  onFork();
                }}
              >
                <GitFork className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors font-medium">
                  Fork
                </span>
              </button>
            )}

            {onShare && !isSystemAgent && (
              <button
                type="button"
                className="flex flex-col items-center gap-1 px-2 py-1.5 rounded-md hover:bg-primary/10 transition-all group"
                onClick={(e) => {
                  e.stopPropagation();
                  onShare();
                }}
              >
                <Share2 className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors font-medium">
                  Share
                </span>
              </button>
            )}

            {onToggleActive && (
              <button
                type="button"
                className="flex flex-col items-center gap-1 px-2 py-1.5 rounded-md hover:bg-primary/10 transition-all group"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleActive();
                }}
              >
                {isEnabled ? (
                  <>
                    <Pause className="h-4 w-4 text-muted-foreground group-hover:text-amber-500 transition-colors" />
                    <span className="text-[10px] text-muted-foreground group-hover:text-amber-500 transition-colors font-medium whitespace-nowrap">
                      Deactivate
                    </span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 text-muted-foreground group-hover:text-green-500 transition-colors" />
                    <span className="text-[10px] text-muted-foreground group-hover:text-green-500 transition-colors font-medium">
                      Activate
                    </span>
                  </>
                )}
              </button>
            )}

            {!isSystemAgent && onDelete && (
              <button
                type="button"
                className="flex flex-col items-center gap-1 px-2 py-1.5 rounded-md hover:bg-destructive/10 transition-all group"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground group-hover:text-destructive transition-colors" />
                <span className="text-[10px] text-muted-foreground group-hover:text-destructive transition-colors font-medium">
                  Delete
                </span>
              </button>
            )}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
