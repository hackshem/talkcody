// src/lib/mcp/multi-mcp-adapter.ts
import { experimental_createMCPClient, type experimental_MCPClient } from '@ai-sdk/mcp';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import type { MCPServer } from '@/types';
import { TransportFactory } from './transport-factory';

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
  client: experimental_MCPClient | null;
  tools: Record<string, any>;
  isConnected: boolean;
  lastError?: string;
}

/**
 * Multi-MCP Adapter
 * Manages connections to multiple MCP servers and aggregates their tools
 */
export class MultiMCPAdapter {
  private connections: Map<string, MCPServerConnection> = new Map();
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize the Multi-MCP adapter
   * Uses a promise lock to prevent concurrent initialization
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // If already initializing, wait for that to complete
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize();
    return this.initializationPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      // Get enabled MCP servers from database
      const servers = await databaseService.getEnabledMCPServers();

      // Initialize connections for each server
      await this.initializeConnections(servers);

      this.isInitialized = true;
      logger.info('Multi-MCP Adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Multi-MCP Adapter:', error);
      this.initializationPromise = null;
      throw error;
    }
  }

  /**
   * Initialize connections to all enabled servers
   */
  private async initializeConnections(servers: MCPServer[]): Promise<void> {
    const connectionPromises = servers.map((server) => this.connectToServer(server));
    await Promise.allSettled(connectionPromises);
  }

  /**
   * Connect to a specific MCP server
   */
  private async connectToServer(server: MCPServer): Promise<void> {
    const tryConnect = async (protocolHint?: 'http' | 'sse') => {
      // Create transport (optionally forcing protocol)
      const transport =
        protocolHint === 'sse'
          ? (TransportFactory as any).createSSETransport(server)
          : TransportFactory.createTransport(server);

      // For stdio transports, we need to call start() before creating the client
      if (server.protocol === 'stdio' && typeof (transport as any).start === 'function') {
        logger.info(`Starting stdio transport for server ${server.id}...`);
        await (transport as any).start();
      }

      logger.info(`Creating MCP client for server ${server.id}...`);
      logger.debug(`Transport details:`, {
        transportType: transport.constructor.name,
        isReady: (transport as any).isReady?.(),
        serverId: (transport as any).getServerId?.(),
      });

      // Add timeout to prevent hanging
      const clientPromise = experimental_createMCPClient({ transport });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('MCP client creation timeout (30s)')), 30000);
      });

      const client = (await Promise.race([
        clientPromise,
        timeoutPromise,
      ])) as experimental_MCPClient;
      logger.info(`MCP client created successfully for server ${server.id}`);

      logger.info(`Attempting to fetch tools from MCP server ${server.id}...`);
      const tools = await client.tools();
      logger.info(`Successfully fetched ${Object.keys(tools).length} tools from ${server.id}`);

      this.connections.set(server.id, {
        server,
        client,
        tools,
        isConnected: true,
        lastError: undefined,
      });

      logger.info(
        `Connected to MCP server ${server.id} (${server.name}) with ${Object.keys(tools).length} tools`
      );
    };

    // Validate server configuration
    const validation = TransportFactory.validateServerConfig(server);
    if (!validation.isValid) {
      throw new Error(`Invalid server configuration: ${validation.errors.join(', ')}`);
    }

    try {
      await tryConnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to connect to MCP server ${server.id}:`, error);

      this.connections.set(server.id, {
        server,
        client: null,
        tools: {},
        isConnected: false,
        lastError: errorMessage,
      });
    }
  }

  /**
   * Get all adapted tools from all connected servers
   * Returns tools with server-prefixed names: {server_id}__{tool_name}
   */
  async getAdaptedTools(): Promise<Record<string, any>> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const allTools: Record<string, any> = {};

    for (const connection of this.connections.values()) {
      if (connection.isConnected && connection.tools) {
        for (const [toolName, tool] of Object.entries(connection.tools)) {
          const prefixedName = `${connection.server.id}__${toolName}`;
          allTools[prefixedName] = tool;
        }
      }
    }

    return allTools;
  }

  /**
   * Get a specific adapted tool by prefixed name
   */
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

    return tool;
  }

  /**
   * List all available MCP tools with metadata
   */
  async listMCPTools(): Promise<MCPToolInfo[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const toolInfos: MCPToolInfo[] = [];

    for (const connection of this.connections.values()) {
      if (connection.isConnected && connection.tools) {
        for (const toolName of Object.keys(connection.tools)) {
          toolInfos.push({
            id: toolName,
            name: toolName,
            description: `Tool from ${connection.server.name}`,
            prefixedName: `${connection.server.id}__${toolName}`,
            serverId: connection.server.id,
            serverName: connection.server.name,
            isAvailable: true,
          });
        }
      }
    }

    return toolInfos;
  }

  /**
   * List tools from a specific server
   */
  async listServerTools(serverId: string): Promise<MCPToolInfo[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const connection = this.connections.get(serverId);
    if (!connection) {
      return [];
    }

    const toolInfos: MCPToolInfo[] = [];

    if (connection.isConnected && connection.tools) {
      for (const [toolName, tool] of Object.entries(connection.tools)) {
        try {
          // Try to get tool info if available
          let description = `Tool from ${connection.server.name}`;
          if (tool.description) {
            description = tool.description;
          }

          toolInfos.push({
            id: toolName,
            name: toolName,
            description,
            prefixedName: `${connection.server.id}__${toolName}`,
            serverId: connection.server.id,
            serverName: connection.server.name,
            isAvailable: true,
          });
        } catch (error) {
          logger.warn(
            `Failed to get info for tool '${toolName}' from server '${serverId}':`,
            error
          );

          // Add with basic info
          toolInfos.push({
            id: toolName,
            name: toolName,
            description: `Tool from ${connection.server.name}`,
            prefixedName: `${connection.server.id}__${toolName}`,
            serverId: connection.server.id,
            serverName: connection.server.name,
            isAvailable: false,
          });
        }
      }
    }

    return toolInfos;
  }

  /**
   * Get tool information for a specific tool
   */
  async getToolInfo(prefixedName: string): Promise<any> {
    const { serverId, toolName } = this.parsePrefixedName(prefixedName);

    const connection = this.connections.get(serverId);
    if (!connection || !connection.isConnected) {
      throw new Error(`MCP server '${serverId}' is not connected`);
    }

    const tool = connection.tools[toolName];
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in MCP server '${serverId}'`);
    }

    return {
      name: toolName,
      description: tool.description || `Tool from ${connection.server.name}`,
      inputSchema: (tool as any).inputSchema || null,
      parameters: (tool as any).parameters || null,
      serverId,
      serverName: connection.server.name,
      prefixedName,
    };
  }

  /**
   * Get server connection status
   */
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

  /**
   * Get all server statuses
   */
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

  /**
   * Refresh connections to all servers
   */
  async refreshConnections(): Promise<void> {
    try {
      // Close existing connections
      await this.closeAllConnections();

      // Clear connections
      this.connections.clear();

      // Re-initialize
      this.isInitialized = false;
      await this.initialize();

      logger.info('All MCP connections refreshed');
    } catch (error) {
      logger.error('Failed to refresh MCP connections:', error);
      throw error;
    }
  }

  /**
   * Refresh connection to a specific server
   */
  async refreshServer(serverId: string): Promise<void> {
    try {
      // Close existing connection
      const connection = this.connections.get(serverId);
      if (connection?.client) {
        await connection.client.close();
      }

      // Remove from connections
      this.connections.delete(serverId);

      // Get server config
      const server = await databaseService.getMCPServer(serverId);
      if (!server || !server.is_enabled) {
        logger.info(`Server ${serverId} is disabled or not found, skipping refresh`);
        return;
      }

      // Reconnect
      await this.connectToServer(server);

      logger.info(`Refreshed connection to MCP server ${serverId}`);
    } catch (error) {
      logger.error(`Failed to refresh MCP server ${serverId}:`, error);
      throw error;
    }
  }

  /**
   * Test connection to a specific server without storing the connection
   */
  async testConnection(
    server: MCPServer
  ): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    try {
      // Validate server configuration
      const validation = TransportFactory.validateServerConfig(server);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Invalid configuration: ${validation.errors.join(', ')}`,
        };
      }

      // Create transport
      const transport = TransportFactory.createTransport(server);

      // Create MCP client
      const client = await experimental_createMCPClient({
        transport,
      });

      // Test by fetching tools
      const tools = await client.tools();
      const toolCount = Object.keys(tools).length;

      // Close the test connection
      await client.close();

      return {
        success: true,
        toolCount,
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

  /**
   * Health check for all connected servers
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isInitialized) {
      try {
        await this.initialize();
      } catch {
        return false;
      }
    }

    // Check if at least one server is connected
    for (const connection of this.connections.values()) {
      if (connection.isConnected) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse a prefixed tool name into server ID and tool name
   */
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
    const toolName = parts.slice(1).join('__'); // Handle tool names that contain '__'

    return { serverId, toolName };
  }

  /**
   * Close all connections
   */
  private async closeAllConnections(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const connection of this.connections.values()) {
      if (connection.client) {
        closePromises.push(
          connection.client.close().catch((error: any) => {
            logger.warn(`Failed to close connection to ${connection.server.id}:`, error);
          })
        );
      }
    }

    await Promise.allSettled(closePromises);
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.closeAllConnections();
    this.connections.clear();
    this.isInitialized = false;
    logger.info('Multi-MCP Adapter cleaned up');
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
