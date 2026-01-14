// Marketplace browsing routes (compatibility layer for legacy clients)
import { Hono } from 'hono';
import { remoteAgentsService } from '../services/remote-agents-service';

const marketplace = new Hono();

type SortBy = 'popular' | 'recent' | 'installs' | 'name';

type RemoteAgentLike = ReturnType<typeof remoteAgentsService.getConfigs>['remoteAgents'][number];

type NormalizedAgent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  longDescription?: string;
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
    bio: string | null;
    website: string | null;
    agentCount: number;
  };
  iconUrl?: string | null;
  bannerUrl?: string | null;
  installCount: number;
  usageCount: number;
  rating: number;
  ratingCount: number;
  latestVersion: string;
  categories: Array<{ id: string; name: string; slug: string; description: string }>;
  tags: Array<{ id: string; name: string; slug: string; usageCount: number }>;
  isFeatured: boolean;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  model?: string;
  systemPrompt?: string;
  rules?: string;
  outputFormat?: string;
};

const normalizeAgent = (agent: RemoteAgentLike): NormalizedAgent => {
  const tagsRaw = (agent as any).tags as string[] | undefined;
  const tagObjects = Array.isArray(tagsRaw)
    ? tagsRaw.map((tag) => ({ id: tag, name: tag, slug: tag, usageCount: 0 }))
    : [];

  const category = (agent as any).category as string | undefined;
  const categoryObjects = category
    ? [
        {
          id: category,
          name: category,
          slug: category,
          description: '',
        },
      ]
    : [];

  return {
    id: (agent as any).id || '',
    slug: (agent as any).slug || (agent as any).id || '',
    name: (agent as any).name || '',
    description: (agent as any).description || '',
    longDescription: (agent as any).longDescription || '',
    author: {
      id: (agent as any).author?.id || '',
      name: (agent as any).author?.name || '',
      avatarUrl: (agent as any).author?.avatarUrl ?? null,
      bio: (agent as any).author?.bio ?? null,
      website: (agent as any).author?.website ?? null,
      agentCount: (agent as any).author?.agentCount ?? 0,
    },
    iconUrl: (agent as any).iconUrl ?? null,
    bannerUrl: (agent as any).bannerUrl ?? null,
    installCount: (agent as any).installCount ?? 0,
    usageCount: (agent as any).usageCount ?? 0,
    rating: (agent as any).rating ?? 0,
    ratingCount: (agent as any).ratingCount ?? 0,
    latestVersion: (agent as any).latestVersion ?? '',
    categories: categoryObjects,
    tags: tagObjects,
    isFeatured: (agent as any).isFeatured ?? false,
    isPublished: (agent as any).isPublished ?? true,
    createdAt: (agent as any).createdAt ?? '',
    updatedAt: (agent as any).updatedAt ?? '',
    model: (agent as any).model,
    systemPrompt: (agent as any).systemPrompt,
    rules: (agent as any).rules,
    outputFormat: (agent as any).outputFormat,
  };
};

const filterAndSortAgents = (
  agents: RemoteAgentLike[],
  options: {
    limit: number;
    offset: number;
    sortBy: SortBy;
    search?: string;
    categoryIds?: string[];
    tagIds?: string[];
    isFeatured?: boolean;
  }
) => {
  const { limit, offset, sortBy, search, categoryIds, tagIds, isFeatured } = options;

  let filtered = agents.filter((agent) => {
    if (isFeatured !== undefined) {
      const featuredFlag = (agent as any).isFeatured ?? false;
      if (featuredFlag !== isFeatured) return false;
    }

    if (search) {
      const term = search.toLowerCase();
      const name = ((agent as any).name || '').toLowerCase();
      const desc = ((agent as any).description || '').toLowerCase();
      const longDesc = ((agent as any).longDescription || '').toLowerCase();
      if (!name.includes(term) && !desc.includes(term) && !longDesc.includes(term)) {
        return false;
      }
    }

    if (categoryIds && categoryIds.length > 0) {
      const category = (agent as any).category;
      if (!category || !categoryIds.includes(category)) return false;
    }

    if (tagIds && tagIds.length > 0) {
      const tags = ((agent as any).tags || []) as string[];
      if (!Array.isArray(tags) || !tags.some((tag) => tagIds.includes(tag))) {
        return false;
      }
    }

    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'recent': {
        const aDate = new Date((a as any).createdAt || 0).getTime();
        const bDate = new Date((b as any).createdAt || 0).getTime();
        return bDate - aDate;
      }
      case 'installs':
      case 'popular': {
        const aInstall = (a as any).installCount ?? 0;
        const bInstall = (b as any).installCount ?? 0;
        return bInstall - aInstall;
      }
      case 'name':
        return ((a as any).name || '').localeCompare((b as any).name || '');
      default:
        return 0;
    }
  });

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return { paginated, total };
};

const parseBool = (value: string | null | undefined): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

/**
 * List agents with filtering and sorting
 * GET /api/marketplace/agents?limit=20&offset=0&sortBy=popular&search=coding&categoryIds=cat1,cat2&tagIds=tag1,tag2&isFeatured=true
 */
marketplace.get('/agents', (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const sortBy = (c.req.query('sortBy') || 'popular') as SortBy;
  const search = c.req.query('search') || undefined;
  const categoryIds = c.req.query('categoryIds')?.split(',').filter(Boolean);
  const tagIds = c.req.query('tagIds')?.split(',').filter(Boolean);
  const isFeatured = parseBool(c.req.query('isFeatured'));

  const configs = remoteAgentsService.getConfigs();
  const { paginated, total } = filterAndSortAgents(configs.remoteAgents, {
    limit,
    offset,
    sortBy,
    search,
    categoryIds,
    tagIds,
    isFeatured,
  });

  return c.json({
    count: total,
    total,
    limit,
    offset,
    agents: paginated.map(normalizeAgent),
  });
});

/**
 * Get featured agents
 * GET /api/marketplace/agents/featured?limit=10
 */
marketplace.get('/agents/featured', (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const configs = remoteAgentsService.getConfigs();
  const { paginated, total } = filterAndSortAgents(configs.remoteAgents, {
    limit,
    offset: 0,
    sortBy: 'popular',
    isFeatured: true,
  });

  return c.json({
    count: total,
    total,
    limit,
    offset: 0,
    agents: paginated.map(normalizeAgent),
  });
});

/**
 * Get agent by slug
 * GET /api/marketplace/agents/:slug
 */
marketplace.get('/agents/:slug', (c) => {
  const slug = c.req.param('slug');
  const configs = remoteAgentsService.getConfigs();
  const agent = configs.remoteAgents.find(
    (item) => (item as any).slug === slug || (item as any).id === slug
  );

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ agent: normalizeAgent(agent) });
});

/**
 * Download agent (track statistics)
 * POST /api/marketplace/agents/:slug/download
 */
marketplace.get('/agents/:slug/download', (c) => {
  const slug = c.req.param('slug');
  const configs = remoteAgentsService.getConfigs();
  const agent = configs.remoteAgents.find(
    (item) => (item as any).slug === slug || (item as any).id === slug
  );

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({
    message: 'Download tracking disabled',
    agent: normalizeAgent(agent),
  });
});

/**
 * Install agent (tracking disabled)
 * POST /api/marketplace/agents/:slug/install
 */
marketplace.post('/agents/:slug/install', (c) => {
  const slug = c.req.param('slug');
  const configs = remoteAgentsService.getConfigs();
  const agent = configs.remoteAgents.find(
    (item) => (item as any).slug === slug || (item as any).id === slug
  );

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({
    message: 'Installation tracking disabled',
  });
});

/**
 * Get all categories
 * GET /api/marketplace/categories
 */
marketplace.get('/categories', (c) => {
  const configs = remoteAgentsService.getConfigs();
  const categories = new Map<
    string,
    { id: string; name: string; slug: string; description: string }
  >();

  for (const agent of configs.remoteAgents) {
    const category = (agent as any).category as string | undefined;
    if (category && !categories.has(category)) {
      categories.set(category, {
        id: category,
        name: category,
        slug: category,
        description: '',
      });
    }
  }

  return c.json({ categories: Array.from(categories.values()) });
});

/**
 * Get all tags
 * GET /api/marketplace/tags
 */
marketplace.get('/tags', (c) => {
  const configs = remoteAgentsService.getConfigs();
  const tags = new Map<string, { id: string; name: string; slug: string; usageCount: number }>();

  for (const agent of configs.remoteAgents) {
    const tagList = ((agent as any).tags || []) as string[];
    if (Array.isArray(tagList)) {
      for (const tag of tagList) {
        if (!tags.has(tag)) {
          tags.set(tag, { id: tag, name: tag, slug: tag, usageCount: 0 });
        }
      }
    }
  }

  return c.json({ tags: Array.from(tags.values()) });
});

export default marketplace;
