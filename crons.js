require('dotenv').config();

const { log } = require('./src/utils/logger');
const dueDateReminders = require('./crons/due_date_reminders');
// const xapiPosts = require('./crons/xapi_posts')

const next = (err) => {
  if (err) {
    log(err, 3);
  }
};

const crons = async ({ forceRunAll } = {}) => {
  if (global.connection == null) {
    log('No connection to database', 3);
    return;
  }

  //const day = new Date().getDay()  // 0-6
  const hours = new Date().getHours(); // 0-23
  const minutes = new Date().getMinutes(); // 0-59

  // every minute
  // await xapiPosts({ next })  // commented out since (1) code was moved around and has not yet been tested since then, and (2) no tenant currently uses this

  if (minutes === 0 || forceRunAll) {
    // once per hour
    await dueDateReminders({ next });
  }

  if ((hours === 0 && minutes === 0) || forceRunAll) {
    // once per day
  }
};

module.exports.handler = crons;
