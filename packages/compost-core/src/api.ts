/**
 * compost-core public API entry point.
 *
 * Phase 0 exposes: applyMigrations, getMigrationStatus.
 * Phase 1+ adds: observe, query, reflect, feedback.
 */

export { applyMigrations, getMigrationStatus } from "./schema/migrator";
