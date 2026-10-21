#!/usr/bin/env node

const http = require('http');

const { log } = require('./src/utils/logger')

http
  .get(`http://localhost:${process.env.PORT || 8080}/Shibboleth.sso/Metadata`,
    (res) => {
      log(['statusCode', res.statusCode]);
      if ([200, 302, 304].includes(res.statusCode)) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
  .on('error', (err) => {
    log(err, 3);
    process.exit(1);
  });
