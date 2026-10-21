const { handler } = require('../crons');

(async () => {
  await handler({ forceRunAll: true }); // Ensure cron tasks are run even if there is a delay in startup
  process.exit();
})();
