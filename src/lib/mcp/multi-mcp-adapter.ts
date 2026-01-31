// src/lib/mcp/multi-mcp-adapter.ts
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import { llmClient } from '@/services/llm/llm-client';
import type { MCPServer } from '@/types';

export interface MCPToolInfo {
  id: string;
  name: string;
  description: string;
  prefixedName: string;
  serverId: string;
  serverName: string;
  isAvailable: boolean;
}

export interface MCPServerConnection {
  server: MCPServer;
  tools: Record<string, MCPToolInfo>;
  isConnected: boolean;
  lastError?: string;
}

/**
 * Multi-MCP Adapter (Rust-backed)
 * Manages connections to MCP servers through Tauri commands.
 */
export class MultiMCPAdapter {
  private connections: Map<string, MCPServerConnection> = new Map();
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize();
    return this.initializationPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      const servers = await databaseService.getEnabledMCPServers();
      await this.initializeConnections(servers);
      this.isInitialized = true;
      logger.info('Multi-MCP Adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Multi-MCP Adapter:', error);
      this.initializationPromise = null;
      throw error;
    }
  }

  private async initializeConnections(servers: MCPServer[]): Promise<void> {
    const connectionPromises = servers.map((server) => this.connectToServer(server));
    await Promise.allSettled(connectionPromises);
  }

  private async connectToServer(server: MCPServer): Promise<void> {
    try {
      const tools = await llmClient.listMcpTools();
      const serverTools = tools.filter((tool) => tool.serverId === server.id);
      const toolMap: Record<string, MCPToolInfo> = {};

      for (const tool of serverTools) {
        const prefixedName = `${tool.serverId}__${tool.name}`;
        toolMap[tool.name] = {
          id: tool.name,
          name: tool.name,
          description: tool.description || `Tool from ${server.name}`,
          prefixedName,
          serverId: tool.serverId,
          serverName: tool.serverName || server.name,
          isAvailable: true,
        };
      }

      this.connections.set(server.id, {
        server,
        tools: toolMap,
        isConnected: true,
        lastError: undefined,
      });

      logger.info(
        `Connected to MCP server ${server.id} (${server.name}) with ${serverTools.length} tools`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to connect to MCP server ${server.id}:`, error);

      this.connections.set(server.id, {
        server,
        tools: {},
        isConnected: false,
        lastError: errorMessage,
      });
    }
  }

  async getAdaptedTools(): Promise<Record<string, any>> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const allTools: Record<string, any> = {};

    for (const connection of this.connections.values()) {
      if (connection.isConnected && connection.tools) {
        for (const toolInfo of Object.values(connection.tools)) {
          allTools[toolInfo.prefixedName] = {
            description: toolInfo.description,
            inputSchema: null,
          };
        }
      }
    }

    return allTools;
  }

  async getAdaptedTool(prefixedName: string): Promise<any> {
    const { serverId, toolName } = this.parsePrefixedName(prefixedName);

    if (!this.isInitialized) {
      await this.initialize();
    }

    const connection = this.connections.get(serverId);
    if (!connection || !connection.isConnected) {
      throw new Error(`MCP server '${serverId}' is not connected`);
    }

    const tool = connection.tools[toolName];
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in MCP server '${serverId}'`);
    }

    const details = await llmClient.getMcpTool(prefixedName);

    return {
      name: toolName,
      description: details.description || tool.description,
      inputSchema: details.inputSchema || null,
      serverId,
      serverName: details.serverName || tool.serverName,
      prefixedName,
    };
  }

  async listMCPTools(): Promise<MCPToolInfo[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const toolInfos: MCPToolInfo[] = [];

    for (const connection of this.connections.values()) {
      for (const toolInfo of Object.values(connection.tools)) {
        toolInfos.push(toolInfo);
      }
    }

    return toolInfos;
  }

  async listServerTools(serverId: string): Promise<MCPToolInfo[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const connection = this.connections.get(serverId);
    if (!connection) {
      return [];
    }

    return Object.values(connection.tools);
  }

  getToolInfo(prefixedName: string): Promise<any> {
    return this.getAdaptedTool(prefixedName);
  }

  getServerStatus(serverId: string): { isConnected: boolean; error?: string } {
    const connection = this.connections.get(serverId);
    if (!connection) {
      return { isConnected: false, error: 'Server not found' };
    }

    return {
      isConnected: connection.isConnected,
      error: connection.lastError,
    };
  }

  getAllServerStatuses(): Record<
    string,
    { isConnected: boolean; error?: string; toolCount: number }
  > {
    const statuses: Record<string, { isConnected: boolean; error?: string; toolCount: number }> =
      {};

    for (const [serverId, connection] of this.connections) {
      statuses[serverId] = {
        isConnected: connection.isConnected,
        error: connection.lastError,
        toolCount: Object.keys(connection.tools).length,
      };
    }

    return statuses;
  }

  async refreshConnections(): Promise<void> {
    try {
      await llmClient.refreshMcpConnections();
      const servers = await databaseService.getEnabledMCPServers();
      this.connections.clear();
      await this.initializeConnections(servers);
      this.isInitialized = true;
      logger.info('All MCP connections refreshed');
    } catch (error) {
      logger.error('Failed to refresh MCP connections:', error);
      throw error;
    }
  }

  async refreshServer(serverId: string): Promise<void> {
    try {
      await llmClient.refreshMcpServer(serverId);
      const server = await databaseService.getMCPServer(serverId);
      if (!server || !server.is_enabled) {
        logger.info(`Server ${serverId} is disabled or not found, skipping refresh`);
        return;
      }

      await this.connectToServer(server);
      logger.info(`Refreshed connection to MCP server ${serverId}`);
    } catch (error) {
      logger.error(`Failed to refresh MCP server ${serverId}:`, error);
      throw error;
    }
  }

  async testConnection(
    server: MCPServer
  ): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    try {
      const result = await llmClient.testMcpConnection(server.id);
      return {
        success: result.success,
        error: result.error || undefined,
        toolCount: result.toolCount ?? undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`Test connection failed for server ${server.id}:`, error);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isInitialized) {
      try {
        await this.initialize();
      } catch {
        return false;
      }
    }

    return llmClient.mcpHealthCheck();
  }

  private parsePrefixedName(prefixedName: string): {
    serverId: string;
    toolName: string;
  } {
    const parts = prefixedName.split('__');
    if (parts.length < 2) {
      throw new Error(
        `Invalid prefixed tool name format: ${prefixedName}. Expected format: {server_id}__{tool_name}`
      );
    }

    const serverId = parts[0] ?? '';
    const toolName = parts.slice(1).join('__');

    return { serverId, toolName };
  }
}

// Export singleton instance
export const multiMCPAdapter = new MultiMCPAdapter();

// Utility functions for backward compatibility
export const getMCPToolsForAI = async (): Promise<Record<string, any>> => {
  return await multiMCPAdapter.getAdaptedTools();
};

export const mergeWithMCPTools = async (
  localTools: Record<string, any>
): Promise<Record<string, any>> => {
  try {
    const mcpTools = await getMCPToolsForAI();
    return {
      ...localTools,
      ...mcpTools,
    };
  } catch (error) {
    logger.warn('Failed to load MCP tools, continuing with local tools only:', error);
    return localTools;
  }
};

/**
 * Check if a tool name is an MCP tool (has server prefix)
 * Format: {server_id}__{tool_name}
 */
export const isMCPTool = (toolName: string): boolean => {
  return toolName.includes('__') && toolName.split('__').length >= 2;
};

/**
 * Extract the original MCP tool name from the prefixed name
 */
export const extractMCPToolName = (prefixedName: string): string => {
  const parts = prefixedName.split('__');
  return parts.slice(1).join('__');
};

/**
 * Extract the server ID from the prefixed name
 */
export const extractMCPServerId = (prefixedName: string): string => {
  const parts = prefixedName.split('__');
  return parts[0] ?? '';
};
