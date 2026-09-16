/**
 * Runs before anything imports the application.
 *
 * Demo mode is switched off for the suite: with it on, retrieval deliberately
 * sees only seeded demo content, so the documents this suite uploads would be
 * invisible. That isolation is the behaviour under test in the final block,
 * not a setting the rest of the suite should inherit.
 */
process.env.DEMO_MODE = 'false';

// Keep test output readable; failures still surface through assertions.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';

// Rate limiting would otherwise trip on a suite that signs in repeatedly.
process.env.RATE_LIMIT_LIMIT = '10000';
