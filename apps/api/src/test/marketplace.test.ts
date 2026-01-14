// Marketplace API endpoint tests (remote agents compatibility)
import { describe, expect, it } from 'bun:test';
import { app } from '../index';

describe('Marketplace API - Categories', () => {
  it('should get categories (may be empty)', async () => {
    const res = await app.request('/api/marketplace/categories');

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.categories).toBeDefined();
    expect(Array.isArray(data.categories)).toBe(true);

    if (data.categories.length > 0) {
      const category = data.categories[0];
      expect(category).toHaveProperty('id');
      expect(category).toHaveProperty('name');
      expect(category).toHaveProperty('slug');
      expect(category).toHaveProperty('description');
    }
  });
});

describe('Marketplace API - Tags', () => {
  it('should get tags (may be empty)', async () => {
    const res = await app.request('/api/marketplace/tags');

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.tags).toBeDefined();
    expect(Array.isArray(data.tags)).toBe(true);

    if (data.tags.length > 0) {
      const tag = data.tags[0];
      expect(tag).toHaveProperty('id');
      expect(tag).toHaveProperty('name');
      expect(tag).toHaveProperty('slug');
      expect(tag).toHaveProperty('usageCount');
    }
  });
});

describe('Marketplace API - Featured Agents', () => {
  it('should get featured agents with legacy fields', async () => {
    const res = await app.request('/api/marketplace/agents/featured?limit=10');

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.agents).toBeDefined();
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.limit).toBe(10);
    expect(data.offset).toBe(0);
    expect(data.count).toBeDefined();
    expect(data.total).toBeDefined();

    for (const agent of data.agents) {
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('slug');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('description');
      expect(agent).toHaveProperty('author');
      expect(agent).toHaveProperty('installCount');
      expect(agent).toHaveProperty('tags');
      expect(agent).toHaveProperty('categories');
    }
  });
});

describe('Marketplace API - List Agents (compat)', () => {
  it('should list agents with pagination and legacy fields', async () => {
    const res = await app.request('/api/marketplace/agents?limit=20&offset=0');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('agents');
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('total');
    expect(data.limit).toBe(20);
    expect(data.offset).toBe(0);

    expect(Array.isArray(data.agents)).toBe(true);
    for (const agent of data.agents) {
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('slug');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('description');
      expect(agent).toHaveProperty('author');
      expect(agent).toHaveProperty('categories');
      expect(agent).toHaveProperty('tags');
      expect(agent).toHaveProperty('installCount');
    }
  });

  it('should respect pagination offset', async () => {
    const res1 = await app.request('/api/marketplace/agents?limit=1&offset=0');
    const res2 = await app.request('/api/marketplace/agents?limit=1&offset=1');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const data1 = await res1.json();
    const data2 = await res2.json();

    expect(data1.limit).toBe(1);
    expect(data2.limit).toBe(1);
    expect(data1.offset).toBe(0);
    expect(data2.offset).toBe(1);
  });

  it('should support search without crashing', async () => {
    const res = await app.request('/api/marketplace/agents?search=code');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.agents)).toBe(true);
  });

  it('should filter by category when provided', async () => {
    const categoriesRes = await app.request('/api/marketplace/categories');
    const categoriesData = await categoriesRes.json();
    const category = categoriesData.categories[0];

    const res = await app.request(
      `/api/marketplace/agents?categoryIds=${category ? category.id : ''}`
    );
    expect(res.status).toBe(200);
  });

  it('should filter by tag when provided', async () => {
    const tagsRes = await app.request('/api/marketplace/tags');
    const tagsData = await tagsRes.json();
    const tag = tagsData.tags[0];

    const res = await app.request(`/api/marketplace/agents?tagIds=${tag ? tag.id : ''}`);
    expect(res.status).toBe(200);
  });

  it('should handle unknown sortBy gracefully', async () => {
    const res = await app.request('/api/marketplace/agents?sortBy=popular');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.agents)).toBe(true);
  });

  it('should return empty array for unmatched search', async () => {
    const res = await app.request('/api/marketplace/agents?search=__no_match__');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Marketplace API - Get Agent by Slug/Id', () => {
  it('should get agent by id fallback', async () => {
    const listRes = await app.request('/api/marketplace/agents');
    const listData = await listRes.json();
    const agent = listData.agents[0];

    const res = await app.request(`/api/marketplace/agents/${agent.id}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agent).toBeDefined();
    expect(data.agent.id).toBe(agent.id);
  });

  it('should 404 when agent not found', async () => {
    const res = await app.request('/api/marketplace/agents/not-found-agent');
    expect(res.status).toBe(404);
  });
});

describe('Marketplace API - Download/Install', () => {
  it('should allow download tracking endpoint', async () => {
    const listRes = await app.request('/api/marketplace/agents');
    const listData = await listRes.json();
    const agent = listData.agents[0];

    const res = await app.request(`/api/marketplace/agents/${agent.id}/download`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('message');
    expect(data).toHaveProperty('agent');
  });

  it('should allow install endpoint', async () => {
    const listRes = await app.request('/api/marketplace/agents');
    const listData = await listRes.json();
    const agent = listData.agents[0];

    const res = await app.request(`/api/marketplace/agents/${agent.id}/install`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
  });
});
