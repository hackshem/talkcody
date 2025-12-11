// Unified Turso Database Initialization
// Replaces database-init.ts and agent-database-init.ts

import { logger } from '@/lib/logger';
import type { TursoClient } from './turso-client';
import { TursoSchema } from './turso-schema';

export class TursoDatabaseInit {
  private constructor() {}

  /**
   * Initialize the unified Turso database
   */
  static async initialize(db: TursoClient): Promise<void> {
    logger.info('Initializing unified Turso database...');

    try {
      // Initialize connection first
      await db.initialize();

      // Create tables using the unified schema
      logger.info('Creating database schema...');
      await TursoSchema.createTables(db as any);

      logger.info('✅ Unified Turso database initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize Turso database:', error);
      throw error;
    }
  }

  /**
   * Run database migrations if needed
   */
  static async runMigrations(db: TursoClient): Promise<void> {
    logger.info('Checking for database migrations...');

    try {
      // Migration 1: Add forking fields to skills table
      await TursoDatabaseInit.migrateSkillsForkingFields(db);

      // Migration 2: Add model_type field to agents table
      await TursoDatabaseInit.migrateAgentsModelType(db);

      // Migration 3: Add stdio_env field to mcp_servers table
      await TursoDatabaseInit.migrateMCPServersStdioEnv(db);

      logger.info('✅ Database migrations check completed');
    } catch (error) {
      logger.error('❌ Database migration error:', error);
      // Don't throw - allow app to continue
    }
  }

  /**
   * Add forking metadata fields to skills table
   */
  private static async migrateSkillsForkingFields(db: TursoClient): Promise<void> {
    try {
      // Check if the migration is needed by checking if source_type column exists
      const result = await (db as any).execute(`
        SELECT COUNT(*) as count
        FROM pragma_table_info('skills')
        WHERE name = 'source_type'
      `);

      const columnExists = result.rows[0]?.count > 0;

      if (!columnExists) {
        logger.info('Migrating skills table to add forking fields...');

        // Add new columns
        await (db as any).execute(`ALTER TABLE skills ADD COLUMN source_type TEXT DEFAULT 'local'`);
        await (db as any).execute(`ALTER TABLE skills ADD COLUMN forked_from_id TEXT`);
        await (db as any).execute(`ALTER TABLE skills ADD COLUMN forked_from_marketplace_id TEXT`);
        await (db as any).execute(`ALTER TABLE skills ADD COLUMN is_shared INTEGER DEFAULT 0`);

        logger.info('✅ Skills table migration completed');
      }
    } catch (error) {
      logger.error('Error migrating skills table:', error);
      // Don't throw - allow app to continue
    }
  }

  /**
   * Add model_type field to agents table
   */
  private static async migrateAgentsModelType(db: TursoClient): Promise<void> {
    try {
      // Check if the migration is needed by checking if model_type column exists
      const result = await (db as any).execute(`
        SELECT COUNT(*) as count
        FROM pragma_table_info('agents')
        WHERE name = 'model_type'
      `);

      const columnExists = result.rows[0]?.count > 0;

      if (!columnExists) {
        logger.info('Migrating agents table to add model_type field...');

        // Add model_type column with default value
        await (db as any).execute(
          `ALTER TABLE agents ADD COLUMN model_type TEXT DEFAULT 'main_model'`
        );

        // Update existing agents to have main_model type
        await (db as any).execute(
          `UPDATE agents SET model_type = 'main_model' WHERE model_type IS NULL`
        );

        logger.info('✅ Agents table model_type migration completed');
      }
    } catch (error) {
      logger.error('Error migrating agents table model_type:', error);
      // Don't throw - allow app to continue
    }
  }

  /**
   * Add stdio_env field to mcp_servers table for environment variables
   */
  private static async migrateMCPServersStdioEnv(db: TursoClient): Promise<void> {
    try {
      // Check if the migration is needed by checking if stdio_env column exists
      const result = await (db as any).execute(`
        SELECT COUNT(*) as count
        FROM pragma_table_info('mcp_servers')
        WHERE name = 'stdio_env'
      `);

      const columnExists = result.rows[0]?.count > 0;

      if (!columnExists) {
        logger.info('Migrating mcp_servers table to add stdio_env field...');

        // Add stdio_env column with default empty object
        await (db as any).execute(`ALTER TABLE mcp_servers ADD COLUMN stdio_env TEXT DEFAULT '{}'`);

        logger.info('✅ MCP servers table stdio_env migration completed');
      }
    } catch (error) {
      logger.error('Error migrating mcp_servers table stdio_env:', error);
      // Don't throw - allow app to continue
    }
  }
}
