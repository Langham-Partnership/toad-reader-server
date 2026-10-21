const uuidv4 = require('uuid/v4');

const { log } = require('../src/utils/logger')
const util = require('../src/utils/util');

module.exports = async () => {

  const cronRunUid = uuidv4()
  const currentMySQLDatetime = util.timestampToMySQLDatetime();

  log(['Cron: xapi posts', cronRunUid]);

  global.connection.query('SELECT * FROM `idp` WHERE xapiOn=? AND (demo_expires_at IS NULL OR demo_expires_at>?)',
    [1, currentMySQLDatetime],
    function (err, rows) {
      if (err) {
        log([err, cronRunUid], 3);
        return;
      }

      var leftToDo = rows.length;

      var markDone = function() {
        if(--leftToDo <= 0) {
          log(['Cron: complete', cronRunUid]);
        }
      }

      if(rows.length === 0) {
        markDone();
        return;
      }

      rows.forEach(function(row) {

        // check configuration
        if(!row.xapiEndpoint || !row.xapiUsername || !row.xapiPassword || row.xapiMaxBatchSize < 1) {
          log(['Cron: The IDP with id #' + row.id + ' has xapi turned on, but it is misconfigured. Skipping.', cronRunUid]);
          markDone();
          return;
        }

        // get the xapi queue
        log(['Cron: Get xapiQueue for idp id #' + row.id, cronRunUid]);
        global.connection.query('SELECT * FROM `xapiQueue` WHERE idp_id=? ORDER BY created_at DESC LIMIT ?',
          [row.id, row.xapiMaxBatchSize],
          function (err, statementRows) {
            if (err) {
              log([err, cronRunUid], 3);
              markDone();
              return;
            }

            var statements = [];

            statementRows.forEach(function(statementRow) {
              statements.push(JSON.parse(statementRow.statement));
            });

            if(statements.length > 0) {

              var endpoint = row.xapiEndpoint.replace(/(\/statements|\/)$/, '') + '/statements';

              var options = {
                method: 'post',
                body: JSON.stringify(statements),
                headers: {
                  'Authorization': 'Basic ' + Buffer.from(row.xapiUsername + ":" + row.xapiPassword).toString('base64'),
                  'X-Experience-API-Version': '1.0.0',
                  'Content-Type': 'application/json',
                },
              }

              // post the xapi statements
              fetch(endpoint, options)
                .then(async res => {
                  if(res.status !== 200) {
                    let json = 'No response JSON'
                    try {
                      json = await res.json()
                    } catch {
                      // Do nothing
                    }
                    log(['Cron: Bad xapi post for idp id #' + row.id, json.warnings || json, JSON.stringify(statements), cronRunUid], 2);
                    markDone();
                    return;
                  }

                  log([statements.length + ' xapi statement(s) posted successfully for idp id #' + row.id, cronRunUid]);

                  var statementIds = [];
                  statementRows.forEach(function(statementRow) {
                    statementIds.push(statementRow.id);
                  });

                  log(['Cron: Delete successfully sent statements from xapiQueue queue. Ids: ' + statementIds.join(', '), cronRunUid]);
                  global.connection.query('DELETE FROM `xapiQueue` WHERE id IN(?)', [statementIds], function (err) {
                    if (err) log([err, cronRunUid], 3);
                    markDone();
                  });

                })
                .catch(function() {
                  log(['Cron: Xapi post failed for idp id #' + row.id, cronRunUid]);
                  markDone();
                })

            } else {
              markDone();
            }
          }
        );
      });
    }
  );

  log(["Cron: xapi posts complete", cronRunUid])

}
