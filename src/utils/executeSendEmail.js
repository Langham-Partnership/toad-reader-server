const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { log } = require('./logger');

// SES setup
const sesConfig = {
  region: process.env.SES_AWS_REGION || 'us-east-1',
};
if (process.env.SES_ACCESS_KEY_ID && process.env.SES_SECRET_ACCESS_KEY) {
  sesConfig.credentials = {
    accessKeyId: process.env.SES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
  };
}
const sesClient = new SESClient(sesConfig);

const executeSendEmail = ({ queuedEmail, resolve, reject }) => {
  const { toAddrs, ccAddrs, bccAddrs, fromAddr, replyToAddrs, subject, body } =
    queuedEmail;

  // READER-149. .then belongs on the promise sesClient.send() returns. It used to sit on the SendEmailCommand object,
  // which has no then(), so every send threw a TypeError before reaching SES.
  sesClient
    .send(
      new SendEmailCommand({
        Destination: {
          ToAddresses: toAddrs,
          CcAddresses: ccAddrs,
          BccAddresses: bccAddrs,
        },
        Message: {
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: body,
            },
          },
          Subject: {
            Charset: 'UTF-8',
            Data: subject,
          },
        },
        Source: fromAddr,
        ReplyToAddresses: replyToAddrs,
      }),
    )
    .then(
      () => resolve(true),
      (err) => {
        // Not the subject or body: for a login or account-deletion email they hold a code that is valid for 15 minutes.
        log(['Email error: ', err, JSON.stringify({ fromAddr, toAddrs })], 3);
        reject(err.message || 'email send failed');
      },
    );
};

module.exports = executeSendEmail;
