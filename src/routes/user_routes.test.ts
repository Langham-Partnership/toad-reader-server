import crypto from 'crypto';
import express, { Express, NextFunction, Request, Response } from 'express';
import request from 'supertest';

// ===== A THROWAWAY CLOUDFRONT KEY PAIR =====
// user_routes.js reads the key pair from the environment when it is loaded, so it is set before the import below. The
// private key is written the way the task definition holds it: on one line, with each line break as \n.
const keyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

process.env.CLOUDFRONT_KEY_PAIR_ID = 'KTESTKEYPAIR';
process.env.CLOUDFRONT_PRIVATE_KEY = keyPair.privateKey.replace(/\n/g, '\\n');
delete process.env.IS_DEV; // both routes answer 404 on dev

// ===== MOCK UTILITIES AND DEPENDENCIES =====
const mockUtilFunctions = {
  hasAccess: jest.fn(),
  hasClassroomAssetAccess: jest.fn(),
  getFrontEndOrigin: jest.fn(),
  // called when the routes are registered, so it has to return a middleware from the start
  setIdpLang: jest.fn(
    () => (_req: Request, _res: Response, next: NextFunction) => next(),
  ),
};

const mockLog = jest.fn();

jest.mock('../utils/util', () => mockUtilFunctions);
jest.mock('../utils/sendEmail', () => jest.fn());
jest.mock('inline-i18n', () => ({ i18n: jest.fn() }));
jest.mock('../utils/logger', () => ({ log: mockLog }));
import userRoutes from './user_routes.js';

// ===== WHAT CLOUDFRONT DOES WITH A SIGNED REQUEST =====
const ORIGIN = 'https://read.example.com';
const ONE_DAY = 60 * 60 * 24;

type Signed = Record<string, string>;

// CloudFront's base64 swaps the three characters that are unsafe in a cookie or a query string.
const fromCloudFrontBase64 = (value: string): string =>
  value.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/');

const getPolicy = (signed: Signed) =>
  JSON.parse(
    Buffer.from(fromCloudFrontBase64(signed.Policy), 'base64').toString(),
  );

// READER-153. Whether CloudFront would serve `address` for these signed values (the cookies without their CloudFront-
// prefix, or the query string). A custom policy comes with the request and its Resource may hold wildcards. Without
// one, CloudFront rebuilds a canned policy from the address that was asked for and from Expires, so the signature only
// matches when that exact address was signed.
const cloudFrontAllows = (address: string, signed: Signed): boolean => {
  const policy = signed.Policy
    ? Buffer.from(fromCloudFrontBase64(signed.Policy), 'base64').toString()
    : JSON.stringify({
        Statement: [
          {
            Resource: address,
            Condition: {
              DateLessThan: { 'AWS:EpochTime': Number(signed.Expires) },
            },
          },
        ],
      });

  const [{ Resource, Condition }] = JSON.parse(policy).Statement;
  const resourcePattern = new RegExp(
    `^${Resource.split('*')
      .map((part: string) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );

  return (
    crypto
      .createVerify('RSA-SHA1')
      .update(policy)
      .verify(
        keyPair.publicKey,
        fromCloudFrontBase64(signed.Signature),
        'base64',
      ) &&
    resourcePattern.test(address) &&
    Condition.DateLessThan['AWS:EpochTime'] > Date.now() / 1000
  );
};

const fromCookies = (cookies: Signed): Signed =>
  Object.fromEntries(
    Object.entries(cookies).map(([name, value]) => [
      name.replace(/^CloudFront-/, ''),
      value,
    ]),
  );

const fromQueryString = (queryString: string): Signed =>
  Object.fromEntries(new URLSearchParams(queryString));

// ===== TEST SUITE =====
describe('user_routes', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUtilFunctions.getFrontEndOrigin.mockReturnValue(ORIGIN);
    mockUtilFunctions.hasAccess.mockResolvedValue({ version: 'BASE' });
    mockUtilFunctions.hasClassroomAssetAccess.mockResolvedValue(true);

    app = express();

    const ensureAuthenticated = (
      _req: Request,
      _res: Response,
      next: NextFunction,
    ) => next();

    userRoutes(app, ensureAuthenticated, ensureAuthenticated);
  });

  // ===== BOOK COOKIES TESTS =====
  describe('GET /book_cookies/:bookId.json', () => {
    it('should sign a custom policy, the only kind that may hold a wildcard', async () => {
      const { status, body } = await request(app).get('/book_cookies/123.json');

      expect(status).toBe(200);
      expect(Object.keys(body).sort()).toEqual([
        'CloudFront-Key-Pair-Id',
        'CloudFront-Policy',
        'CloudFront-Signature',
      ]);
      expect(body['CloudFront-Key-Pair-Id']).toBe('KTESTKEYPAIR');

      const [{ Resource, Condition }] = getPolicy(fromCookies(body)).Statement;
      const inOneDay = Date.now() / 1000 + ONE_DAY;

      expect(Resource).toBe(`${ORIGIN}/epub_content/book_123/*`);
      expect(Condition.DateLessThan['AWS:EpochTime']).toBeGreaterThan(
        inOneDay - 60,
      );
      expect(Condition.DateLessThan['AWS:EpochTime']).toBeLessThanOrEqual(
        inOneDay,
      );
    });

    it('should open every file of the book, and nothing of another book', async () => {
      const { body } = await request(app).get('/book_cookies/123.json');
      const signed = fromCookies(body);

      [
        'META-INF/container.xml',
        'OEBPS/content.opf',
        'OEBPS/images/cover.jpg',
      ].forEach((file) => {
        expect(
          cloudFrontAllows(`${ORIGIN}/epub_content/book_123/${file}`, signed),
        ).toBe(true);
      });

      expect(
        cloudFrontAllows(
          `${ORIGIN}/epub_content/book_124/META-INF/container.xml`,
          signed,
        ),
      ).toBe(false);
      expect(
        cloudFrontAllows(
          `${ORIGIN}/epub_content/book_1234/META-INF/container.xml`,
          signed,
        ),
      ).toBe(false);
    });

    it('should refuse a user who has no access to the book', async () => {
      mockUtilFunctions.hasAccess.mockResolvedValue(false);

      const { status, body } = await request(app).get('/book_cookies/123.json');

      expect(status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden' });
    });

    // MySQL reads the string '12*' as the number 12, so the access check alone would let these through.
    it.each([
      ['a * in the id', '/book_cookies/12*.json'],
      ['a ? in the id', '/book_cookies/1%3F.json'],
      ['only a * as the id', '/book_cookies/*.json'],
    ])('should not sign a second wildcard: %s', async (_name, path) => {
      const { status, body } = await request(app).get(path);

      expect(status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden' });
      expect(mockUtilFunctions.hasAccess).not.toHaveBeenCalled();
    });

    it('should not sign a wildcard that arrives in the host', async () => {
      mockUtilFunctions.getFrontEndOrigin.mockReturnValue(
        `${ORIGIN}/epub_content/*?x=`,
      );

      const { status, body } = await request(app).get('/book_cookies/123.json');

      expect(status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden' });
      expect(mockUtilFunctions.hasAccess).not.toHaveBeenCalled();
    });
  });

  // ===== CLASSROOM QUERY STRING TESTS =====
  describe('GET /classroom_query_string/:classroomUid.json', () => {
    it('should sign a custom policy, the only kind that may hold a wildcard', async () => {
      const { status, body } = await request(app).get(
        '/classroom_query_string/abc-def.json',
      );

      expect(status).toBe(200);
      expect(body.queryString.startsWith('?')).toBe(true);

      const signed = fromQueryString(body.queryString);

      expect(Object.keys(signed).sort()).toEqual([
        'Key-Pair-Id',
        'Policy',
        'Signature',
      ]);
      expect(getPolicy(signed).Statement[0].Resource).toBe(
        `${ORIGIN}/enhanced_assets/abc-def/*`,
      );
    });

    it('should open every asset of the classroom, and nothing of another classroom', async () => {
      const { body } = await request(app).get(
        '/classroom_query_string/abc-def.json',
      );
      const signed = fromQueryString(body.queryString);

      expect(
        cloudFrontAllows(`${ORIGIN}/enhanced_assets/abc-def/video.mp4`, signed),
      ).toBe(true);
      expect(
        cloudFrontAllows(`${ORIGIN}/enhanced_assets/xyz/video.mp4`, signed),
      ).toBe(false);
    });

    it('should refuse a user who has no access to the classroom', async () => {
      mockUtilFunctions.hasClassroomAssetAccess.mockResolvedValue(false);

      const { status, body } = await request(app).get(
        '/classroom_query_string/abc-def.json',
      );

      expect(status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden' });
    });

    it('should not sign a second wildcard', async () => {
      const { status, body } = await request(app).get(
        '/classroom_query_string/abc*.json',
      );

      expect(status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden' });
      expect(mockUtilFunctions.hasClassroomAssetAccess).not.toHaveBeenCalled();
    });
  });
});
