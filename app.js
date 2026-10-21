////////////// REQUIRES //////////////
require('./src/instrument.js');

const saml = require('@node-saml/passport-saml');
const Sentry = require('@sentry/node');
const express = require('express');
const cors = require('cors');
const app = express();
const http = require('http');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const passport = require('passport');
require('dotenv').load(); //loads the local environment
const util = require('./src/utils/util');
const jwt = require('jsonwebtoken');
const { i18nSetup } = require('inline-i18n');
const fs = require('fs');
const sendEmail = require('./src/utils/sendEmail');
require('array-flat-polyfill'); // Array.flat function
const { log } = require('./src/utils/logger.js');

////////////// SETUP SERVER //////////////

const port = parseInt(process.env.PORT, 10) || process.env.PORT || 8080;
app.set('port', port);
const server = http.createServer(app);

const sessionParser = util.session({
  store: util.sessionStore,
  secret: process.env.SESSION_SECRET || 'secret',
  saveUninitialized: false,
  resave: false,
  cookie: {
    httpOnly: false,
    maxAge: 1000 * 60 * 60 * 24 * 30 * 3,
    sameSite: 'none',
    secure: 'auto',
    // if they use this session at least once/3 months, it will never expire
  },
});
// log(['ENV >>> ', process.env])

////////////// WAIT FOR INITIAL SETUP //////////////

const readyPromises = [];
app.use(async (req, res, next) => {
  await Promise.all(readyPromises);
  next();
});

////////////// SETUP CORS //////////////
const corsOptionsDelegate = (req, callback) => {
  const corsOptions = {};

  if (process.env.IS_DEV || req.headers['x-tenant-auth']) {
    corsOptions.origin = true;
  } else {
    corsOptions.origin = util.getFrontEndOrigin({ req });
  }

  callback(null, corsOptions);
};

app.use(cors(corsOptionsDelegate));

////////////// SETUP STORAGE AND DB //////////////

// ensure session store is ready
readyPromises.push(
  util.sessionStore
    .onReady()
    .then(() => {
      log(['Session store ready'], 1);
    })
    .catch((error) => {
      log(['Session store error', error], 3);
      throw error;
    }),
);

////////////// SETUP I18N //////////////

const translationsDir = `./translations`;
const locales = ['en'];

readyPromises.push(
  new Promise((i18nPromiseResolve) => {
    fs.readdir(translationsDir, (err, files) => {
      if (err) {
        log(
          'Could not set up i18n because the translations dir was not found.',
          3,
        );
        i18nPromiseResolve();
        return;
      }

      files.forEach((file) => {
        const regex = /\.json$/;
        if (!regex.test(file)) return;
        locales.push(file.replace(regex, ''));
      });

      log(['locales:', locales], 1);

      i18nSetup({
        locales,
        fetchLocale: (locale) =>
          new Promise((resolve, reject) =>
            fs.readFile(
              `${translationsDir}/${locale}.json`,
              (err, contents) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(JSON.parse(contents));
                }
              },
            ),
          ),
      });
    });
    i18nPromiseResolve();
  }),
);

////////////// SETUP PASSPORT //////////////

passport.serializeUser((user, done) => {
  done(null, {
    userId: user.id,
    ssoData: user.ssoData,

    // The next two are only used for websockets.
    // On http requests, they will be overwritten.
    fullname: user.fullname,
    idpId: user.idpId,
  });
});

const getIdpPrefixedValues = (row) => ({
  idpId: row.idp_id,
  idpName: row.name,
  idpLang: row.language || 'en',
  idpAndroidAppURL: row.androidAppURL,
  idpIosAppURL: row.iosAppURL,
  idpXapiOn: row.xapiOn,
  idpReadingSessionsOn: row.readingSessionsOn,
  idpConsentText: row.consentText,
  idpMaxMBPerBook: row.maxMBPerBook,
  idpMaxMBPerFile: row.maxMBPerFile,
  idpDeviceLoginLimit: row.deviceLoginLimit,
});

const deserializeUser = ({ userId, ssoData, next }) =>
  new Promise((resolve) => {
    const fields = `
    user.id,
    user.user_id_from_idp,
    user.email,
    user.fullname,
    user.adminLevel,
    user.idp_id,
    idp.name,
    idp.language,
    idp.androidAppURL,
    idp.iosAppURL,
    idp.xapiOn,
    idp.readingSessionsOn,
    idp.consentText,
    idp.maxMBPerBook,
    idp.maxMBPerFile,
    idp.entryPoint,
    idp.deviceLoginLimit
  `;

    global.connection.query(
      '' +
        'SELECT ' +
        fields +
        ' ' +
        'FROM `user` ' +
        'LEFT JOIN `idp` ON (user.idp_id=idp.id) ' +
        'WHERE user.id=? ',
      [userId],
      (err, rows) => {
        if (err) return next(err);

        if (rows.length !== 1) {
          return next(`User record not found: ${userId}`);
        }

        const row = rows[0];

        const user = {
          id: row.id,
          userIdFromIdp: row.user_id_from_idp,
          email: row.email,
          fullname: row.fullname,
          isAdmin: ['SUPER_ADMIN', 'ADMIN'].includes(row.adminLevel),
          ssoData,
          ...getIdpPrefixedValues(row),
        };

        resolve(user);
      },
    );
  });

passport.deserializeUser((partialUser, done) => {
  if (typeof partialUser !== 'object') {
    // to support old way of serializing users
    partialUser = { userId: partialUser };
  }
  deserializeUser({ ...partialUser, next: done }).then((user) => {
    done(null, user);
  });
});

// app.use((req, res, next) => {
//   log(['req >>>>>', req.originalUrl, req.path, req.headers, req.query, req.body])
//   next()
// })

const logIn = ({ userId, req, next, deviceLoginLimit }) => {
  deserializeUser({ userId, next }).then((user) => {
    req.login(user, function (err) {
      if (err) {
        return next(err);
      }

      if (deviceLoginLimit && user.id >= 0) {
        const id = `user sessions for id: ${user.id}`;
        util.sessionStore.get(id, (err, value) => {
          if (err) return next(err);

          let sessions = [];
          try {
            sessions = JSON.parse(value) || [];
          } catch {
            // Do nothing
          }

          if (!sessions.includes(req.sessionID)) {
            sessions =
              sessions.length >= deviceLoginLimit
                ? [req.sessionID]
                : [...sessions, req.sessionID];
            util.sessionStore.set(id, JSON.stringify(sessions), (err) => {
              if (err) return next(err);
              next();
            });
          } else {
            next();
          }
        });
      } else {
        return next();
      }
    });
  });
};

const authFuncs = {};

const strategyCallback = function (req, idp, profile, done) {
  log(['Profile from idp', profile], 2);

  const idpUserId = profile['idpUserId'];
  const idpId = parseInt(idp.id);

  if (!idpUserId) {
    log(['Bad login', profile], 3);
    done('Bad login.');
    return;
  }

  const returnUser = (loginInfo) =>
    deserializeUser({ ...loginInfo, next: done }).then((user) =>
      done(null, user),
    );

  if (idp.userInfoEndpoint) {
    const userInfo = {
      ssoData: profile,
      idpUserId,
    };

    util
      .getUserInfo({ idp, idpUserId, next: done, req, log, userInfo })
      .then(returnUser);
  } else {
    // old method: get userInfo from meta data

    const userInfo = {
      idpUserId,
      email: profile['urn:oid:0.9.2342.19200300.100.1.3'] || '',
      books: (profile['bookIds'] ? profile['bookIds'].split(' ') : []).map(
        (bId) => ({ id: parseInt(bId) }),
      ),
      ssoData: profile,
    };

    if (profile['isAdmin']) {
      userInfo.adminLevel = 'ADMIN';
    }

    const fullname = (
      (profile['urn:oid:2.5.4.42'] || '') +
      ' ' +
      (profile['urn:oid:2.5.4.4'] || '')
    ).trim();
    if (fullname) {
      userInfo.fullname = fullname;
    }

    if (!userInfo.email) {
      log(['Bad login', profile], 3);
      done('Bad login.');
    }

    util
      .updateUserInfo({
        log,
        userInfo,
        idpId,
        updateLastLoginAt: true,
        next: done,
        req,
      })
      .then(returnUser);
  }
};

// re-compute all computed_book_access rows and update where necessary
// global.connection.query(
//   `SELECT id FROM idp`,
//   async (err, rows) => {
//     if(err) {
//       log(["Could not re-compute all computed_book_access rows.", err], 3)
//       return
//     }

//     for(let row of rows) {
//       await util.updateComputedBookAccess({ idpId: row.id, log })
//     }
//   }
// )

// setup SAML strategies for IDPs
readyPromises.push(
  (async () => {
    let rows;

    // try 5 times before giving up
    for (let i = 0; i < 5; i++) {
      rows = await util.runQuery({
        query: 'SELECT * FROM `idp` WHERE entryPoint IS NOT NULL',
        next: (err) => {
          log(
            [
              'Could not setup IDPs.',
              i < 4 ? `(Will retry)` : `(No more retries)`,
              err,
            ],
            3,
          );
        },
      });
      if (rows) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!rows) {
      await sendEmail({
        toAddrs: `${process.env.SUPPORT_EMAIL}`,
        subject: `SERVER ERROR: Could not run start-up query to create IDP endpoints`,
        body: `Fix this problem immediately as it means that tenants with Shibboleth cannot log in.`,
      });
      return;
    }

    rows.forEach(function (row) {
      const baseUrl = util.getDataOrigin(row);
      const samlStrategy = new saml.Strategy(
        {
          audience: false,
          callbackUrl: baseUrl + '/login/' + row.id + '/callback',
          decryptionPvk: row.spkey,
          digestAlgorithm: 'sha256',
          disableRequestedAuthnContext: false,
          entryPoint: row.entryPoint,
          identifierFormat: null,
          idpCert: row.idpcert,
          issuer: baseUrl + '/shibboleth',
          logoutCallbackUrl: baseUrl + '/logout/callback',
          logoutUrl: row.logoutUrl,
          passReqToCallback: true,
          privateKey: row.spkey,
          signatureAlgorithm: 'sha256',
          validateInResponseTo: 'ifPresent',
          wantAssertionsSigned: true,
          wantAuthnResponseSigned: true,
        },
        function (req, profile, done) {
          strategyCallback(req, row, profile, done);
        },
      );

      const dataDomain = util.getDataDomain(row);

      passport.use(dataDomain, samlStrategy);

      authFuncs[dataDomain] = {
        getMetaData: function () {
          return samlStrategy.generateServiceProviderMetadata(
            row.spcert,
            row.spcert,
          );
        },
        logout: function (req, res, next) {
          log(['Logout', req.user], 2);

          switch (process.env.AUTH_METHOD_OVERRIDE || row.authMethod) {
            case 'SESSION_SHARING': {
              log('Redirect to session-sharing SLO');
              res.redirect(
                row.sessionSharingAsRecipientInfo.logoutUrl ||
                  `${util.getFrontendBaseUrl(req)}#/error#${encodeURIComponent(JSON.stringify({ message: 'Your session has timed out. Please log out and log back in again.', widget: 1 }))}`,
              );
              break;
            }
            case 'SHIBBOLETH': {
              if (req.user.ssoData) {
                log('Redirect to SLO');
                samlStrategy.logout(
                  { user: req.user.ssoData },
                  function (err2, req2) {
                    if (err2) return next(err2);

                    log('Back from SLO');
                    //redirect to the IdP Logout URL
                    res.redirect(req2);
                  },
                );
              } else {
                // not sure why it gets here sometimes, but it does
                log(
                  'No ssoData. Skipping SLO and redirecting to /logout/callback.',
                  2,
                );
                res.redirect('/logout/callback');
              }
              break;
            }
            default: {
              log('No call to SLO', 2);
              res.redirect('/logout/callback');
            }
          }
        },
      };
    });

    log(['Successfully setup IDPs.'], 1);
  })(),
);

const ensureAuthenticated = async (req, res, next) => {
  const isValidLogin = () =>
    new Promise((resolve) => {
      if (!req.user.idpDeviceLoginLimit || req.user.id < 0)
        return resolve(true);

      const id = `user sessions for id: ${req.user.id}`;
      util.sessionStore.get(id, (err, value) => {
        let sessions = [];
        try {
          sessions = JSON.parse(value) || [];
        } catch {
          // Do nothing
        }

        if (!sessions.includes(req.sessionID)) {
          return resolve(false);
        }

        return resolve(true);
      });
    });

  if (req.headers['x-tenant-auth']) {
    const idpDomain = util.getIDPDomain({
      host: req.hostname || req.headers.host,
    });
    log([
      'x-tenant-auth header found',
      req.headers['x-tenant-auth'],
      idpDomain,
    ]);

    const [row = {}] = await util.runQuery({
      query: 'SELECT *, id AS idp_id FROM idp WHERE domain=:domain',
      vars: {
        domain: idpDomain,
      },
      next,
    });

    try {
      req.tenantAuthInfo = jwt.verify(
        req.headers['x-tenant-auth'],
        row.userInfoJWT,
        {
          maxAge: '15m',
        },
      );

      log(['x-tenant-auth req.tenantAuthInfo', req.tenantAuthInfo]);

      req.user = req.user || getIdpPrefixedValues(row);

      return next();
    } catch (err) {
      log(['x-tenant-auth error', err], 3);
      return next(err);
    }
  } else if (req.isAuthenticated()) {
    if (await isValidLogin()) {
      return next();
    } else {
      req.logout();
      return res.status(403).send({ error: 'Please login' });
    }
  } else if (
    req.method == 'GET' &&
    (req.originalUrl.match(/^\/confirmlogin(?:-web)?(?:\?.*)?$/) || // TODO: This is temporary, while old apps still active
      (req.headers['app-request'] &&
        req.originalUrl.match(/^\/usersetup\.json/)) ||
      req.originalUrl.match(/^\/(book\/[^/]*|\?.*)?$/))
  ) {
    // library or book call

    // if(req.query.widget) {
    //   return res.send(`
    //     <script>
    //       parent.postMessage({
    //           action: 'forbidden',
    //           iframeid: window.name,
    //           payload: 'Unable to display book. You are not logged in.',
    //       }, '*')
    //     </script>
    //   `)
    // }

    log('Checking if IDP requires authentication');
    global.connection.query(
      'SELECT * FROM `idp` WHERE domain=?',
      [util.getIDPDomain({ host: req.hostname || req.headers.host })],
      function (err, rows) {
        if (err) return next(err);
        const idp = rows[0];

        if (!idp) {
          log(['Tenant not found: ', req.hostname || req.headers.host], 2);

          // Debug mode: return detailed JSON response for debugging
          if (process.env.DEBUG === 'true') {
            return res.status(404).json({
              error: `Tenant not found: ${req.hostname || req.headers.host}`,
              expectedIdpDomain: util.getIDPDomain({
                host: req.hostname || req.headers.host,
              }),
              failedQuery: 'SELECT * FROM `idp` WHERE domain=?',
            });
          }

          // Production/staging: redirect to marketing URL
          return res.redirect(
            'https://' + process.env.MARKETING_DOMAIN + '?tenant_not_found=1',
          );
        } else {
          const idpId = parseInt(idp.id);

          const expiresAt =
            idp.demo_expires_at &&
            util.mySQLDatetimeToTimestamp(idp.demo_expires_at);
          if (expiresAt && expiresAt < util.getUTCTimeStamp()) {
            log(['IDP no longer exists (#2)', idpId], 2);
            return res.redirect(
              'https://' + process.env.MARKETING_DOMAIN + '?domain_expired=1',
            );
          } else {
            const authMethod =
              process.env.AUTH_METHOD_OVERRIDE ||
              (req.query.embedAuthJWT && 'EMBED_AUTH_JWT') || // a form of session sharing
              idp.authMethod;

            switch (authMethod) {
              case 'EMBED_AUTH_JWT':
              case 'SESSION_SHARING': {
                const sessionSharingAsRecipientInfo =
                  util.parseSessionSharingAsRecipientInfo(idp);

                try {
                  const jwtToDecode =
                    authMethod === 'EMBED_AUTH_JWT'
                      ? req.query.embedAuthJWT
                      : req.cookies[sessionSharingAsRecipientInfo.cookie];
                  const token = jwt.verify(
                    jwtToDecode,
                    sessionSharingAsRecipientInfo.secret,
                  );

                  const logInSessionSharingUser = (loginInfo) => {
                    // the IDP does authentication via session-sharing
                    log('Logging in with session-sharing', 2);
                    logIn({ ...loginInfo, req, next });
                  };

                  if (idp.userInfoEndpoint) {
                    util
                      .getUserInfo({
                        idp,
                        idpUserId: token.id,
                        req,
                        res,
                        next,
                        log,
                      })
                      .then(logInSessionSharingUser);
                  } else {
                    // old method: get userInfo from meta data

                    util
                      .updateUserInfo({
                        log,
                        userInfo: Object.assign({}, token, {
                          idpUserId: token.id,
                        }),
                        idpId,
                        updateLastLoginAt: true,
                        next,
                        req,
                      })
                      .then(logInSessionSharingUser);
                  }
                } catch (e) {
                  log(['Error logging in with session-sharing', e], 3);
                  res.redirect(
                    (sessionSharingAsRecipientInfo || {}).loginUrl ||
                      `${util.getFrontendBaseUrl(req)}#/error#${encodeURIComponent(JSON.stringify({ message: 'Your session has timed out. Please log out and log back in again.', widget: 1 }))}`,
                  );
                }

                break;
              }

              case 'NONE_OR_EMAIL': {
                // the IDP does not require authentication, so log them in as userId = -idpId
                log('Logging in without authentication', 2);
                logIn({ userId: idpId * -1, req, next });
                break;
              }

              case 'SHIBBOLETH': {
                // the IDP does require authentication
                log('Redirecting to authenticate', 2);
                const encodedCookie = encodeURIComponent(util.getCookie(req));
                req.session.loginRedirect = `${req.url}${/\?/.test(req.url) ? `&` : `?`}cookieOverride=${encodedCookie}`;
                return res.redirect(
                  `/login/${idpId}?cookieOverride=${encodedCookie}`,
                );
              }

              default: {
                return res.status(403).send({ error: 'Please login' });
              }
            }
          }
        }
      },
    );
  } else {
    return res.status(403).send({ error: 'Please login' });
  }
};

////////////// MIDDLEWARE //////////////

// see http://stackoverflow.com/questions/14014446/how-to-save-and-retrieve-session-from-redis

app.use(bodyParser.json({ limit: '50mb' })); // for parsing application/json
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use('/c/:cookieOverride/**', (req, res, next) => {
  const { cookieOverride } = req.params;
  req.headers.cookie = cookieOverride;
  req.originalUrl = req._parsedUrl.pathname = `/${req.params[0]}`;
  req.hasInitialCookiePathForEmbed = true;
  next();
});
app.use(function (req, res, next) {
  try {
    req.headers.cookie =
      req.headers['x-cookie-override'] ||
      req.query.cookieOverride ||
      JSON.parse(req.body.RelayState).cookieOverride ||
      req.headers.cookie;
  } catch {
    // Do nothing
  }
  next();
});
app.use(cookieParser());
app.set('trust proxy', 1);
app.use(sessionParser);
app.use(passport.initialize());
app.use(passport.session());

////////////// ROUTES //////////////

// require('./src/sockets/sockets')({ server, sessionParser, log })

// force HTTPS
app.use('*', function (req, res, next) {
  if (
    !req.secure &&
    req.headers['x-forwarded-proto'] !== 'https' &&
    process.env.REQUIRE_HTTPS
  ) {
    if (!/^[0-9.]+$/.test(req.headers.host)) {
      // don't log all the health checks coming from IPs
      log(['Go to HTTPS', req.headers.host + req.url]);
    }
    const secureUrl = 'https://' + req.headers.host + req.url;
    res.redirect(secureUrl);
  } else {
    next();
  }
});

require('./src/routes/routes')(
  app,
  passport,
  authFuncs,
  ensureAuthenticated,
  logIn,
  log,
);

Sentry.setupExpressErrorHandler(app);

process.on('unhandledRejection', (reason) => {
  log(['Unhandled node error', reason.stack || reason], 3);
});

////////////// LISTEN //////////////

// Classic server

server.listen(port);
