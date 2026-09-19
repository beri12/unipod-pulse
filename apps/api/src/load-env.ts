/**
 * Loads .env before anything else is imported.
 *
 * ES module imports are evaluated before the importing file's own statements,
 * so anything that reads process.env while a module is being loaded would miss
 * a .env value if this ran inside main.ts. Importing this file first fixes the
 * order.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — rely on real environment variables.
}
