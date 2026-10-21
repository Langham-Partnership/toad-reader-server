const logger = {
  log: (msgs, importanceLevel) => {
    const logLevel = parseInt(process.env.LOG_LEVEL) || 3   // 1=verbose, 2=important, 3=errors only
    importanceLevel = importanceLevel || 1
    if (importanceLevel >= logLevel) {
      if (!Array.isArray(msgs)) {
        msgs = [msgs]
      }
      const timestamp = new Date().toLocaleString('en-US', {
        timeZone: 'UTC',
        timeZoneName: 'short',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false, // 24-hour format
      }); // Start logs with timestamp to enabled log lines to be detected https://docs.aws.amazon.com/batch/latest/userguide/using_awslogs.html#create_awslogs_logdriver_options
      msgs.unshift(timestamp, ['LOG ', 'INFO', 'ERR '][importanceLevel - 1])
      console.log.apply(this, msgs)
    }
  }
}

module.exports = logger
