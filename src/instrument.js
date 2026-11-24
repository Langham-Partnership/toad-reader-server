// Import with `import * as Sentry from "@sentry/node"` if you are using ESM
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

// Query breadcrumbs (util.runQuery) carry the statement template only. Capping
// the length keeps bulk statements from bloating events, and limits what
// reaches Sentry if a caller ever inlines values into the SQL text.
const MAX_QUERY_BREADCRUMB_LENGTH = 500;

Sentry.init({
  dsn: 'https://7d0aa06bd81c0188c75a4629494e954c@o552165.ingest.us.sentry.io/4508880446423040',
  integrations: [nodeProfilingIntegration()],
  // Tracing
  tracesSampleRate: 1.0, //  Capture 100% of the transactions

  // Set sampling rate for profiling - this is relative to tracesSampleRate
  profilesSampleRate: 1.0,

  beforeBreadcrumb(breadcrumb) {
    if (
      breadcrumb.category === 'query' &&
      typeof breadcrumb.message === 'string' &&
      breadcrumb.message.length > MAX_QUERY_BREADCRUMB_LENGTH
    ) {
      breadcrumb.message = `${breadcrumb.message.slice(0, MAX_QUERY_BREADCRUMB_LENGTH)}… [truncated, ${breadcrumb.message.length} chars]`;
    }
    return breadcrumb;
  },
});
