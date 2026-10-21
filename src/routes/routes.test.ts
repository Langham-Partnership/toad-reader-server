import express from 'express';
import passport from 'passport';
import request from 'supertest';

import util from '../utils/util';
import setupRoutes from './routes';

// Prevent further routers from being loaded
global.requireRouter = jest.fn().mockReturnValue(jest.fn());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).log = jest.fn();

jest.mock('express-mysql-session', () => () => jest.fn());

describe('base router', () => {
  const app = express();

  // Set environment variables for S3 development mode
  process.env.USE_DEVELOPMENT_S3 = 'true';
  process.env.S3_BUCKET = 'test-bucket';

  const s3 = util.s3 as (typeof util.s3) & { send: jest.Mock };
  s3.send = jest.fn();
  const authFuncs = jest.fn();
  const ensureAuthenticated = jest.fn();
  const logIn = jest.fn();

  setupRoutes(app, passport, authFuncs, ensureAuthenticated, logIn);

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('GET /: forbidden', async () => {
    ensureAuthenticated.mockImplementation((req, res, next) => next());
    await request(app)
      .get('/')
      .expect(403)
      .expect('Content-Type', /json/)
      .expect('{"error":"Forbidden"}');
  });

  it('GET /epub_content/some_book.epub', async () => {
    ensureAuthenticated.mockImplementation((req, res, next) => {
      req.hasInitialCookiePathForEmbed = true;
      return next();
    });
    // Re-mock s3.send since jest.resetAllMocks() clears it between tests
    s3.send.mockResolvedValue({
      Body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('foo bar baz');
        },
      },
      LastModified: new Date(),
      ContentLength: 11,
      ETag: '"test-etag"',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (util as any).hasAccess = jest.fn().mockReturnValue(true);
    await request(app)
      .get('/epub_content/some_book.epub')
      .expect(200)
      .expect('Content-Type', /epub/)
      .expect('foo bar baz');
  });

  it.each([['/src/js/widget_setup.js', '/scripts/widget_setup.js']])(
    'GET %s',
    async (url) => {
      await request(app)
        .get(url)
        .expect(200)
        .expect('Content-Type', /javascript/);
    },
  );
});
