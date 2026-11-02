/* eslint-disable @typescript-eslint/no-explicit-any */

import express from 'express';
import request from 'supertest';
import util from '../utils/util';
import setupSearchRoutes from './search_routes';

jest.mock('express-mysql-session', () => () => jest.fn());

describe('search router', () => {
  const app = express();
  const ensureAuthenticatedAndCheckIDP = jest.fn();

  setupSearchRoutes(app, ensureAuthenticatedAndCheckIDP);

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /searchtermsuggest', () => {
    it('returns search term suggestions for regular user', async () => {
      ensureAuthenticatedAndCheckIDP.mockImplementation((req, _res, next) => {
        req.user = { id: 1, idpId: 2, isAdmin: false };
        return next();
      });

      const mockRows = [
        { term: 'testing', totalCount: 10 },
        { term: 'test', totalCount: 8 },
        { term: 'testimony', totalCount: 5 },
      ];

      (util as any).timestampToMySQLDatetime = jest
        .fn()
        .mockReturnValue('2024-01-01 00:00:00');
      (util as any).runQuery = jest.fn().mockResolvedValue(mockRows);

      const response = await request(app)
        .get('/searchtermsuggest?termPrefix=test')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        suggestions: ['testing', 'test', 'testimony'],
      });
    });

    it('returns search term suggestions for admin user', async () => {
      ensureAuthenticatedAndCheckIDP.mockImplementation((req, _res, next) => {
        req.user = { id: 1, idpId: 2, isAdmin: true };
        return next();
      });

      const mockRows = [{ term: 'admin', totalCount: 15 }];

      (util as any).timestampToMySQLDatetime = jest
        .fn()
        .mockReturnValue('2024-01-01 00:00:00');
      (util as any).runQuery = jest.fn().mockResolvedValue(mockRows);

      const response = await request(app)
        .get('/searchtermsuggest?termPrefix=adm')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        suggestions: ['admin'],
      });
    });

    it('returns suggestions for specific book', async () => {
      ensureAuthenticatedAndCheckIDP.mockImplementation((req, _res, next) => {
        req.user = { id: 1, idpId: 2, isAdmin: false };
        return next();
      });

      const mockRows = [{ term: 'chapter', totalCount: 20 }];

      (util as any).timestampToMySQLDatetime = jest
        .fn()
        .mockReturnValue('2024-01-01 00:00:00');
      (util as any).runQuery = jest.fn().mockResolvedValue(mockRows);

      const response = await request(app)
        .get('/searchtermsuggest/123?termPrefix=chap')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        suggestions: ['chapter'],
      });
    });

    it('handles empty results', async () => {
      ensureAuthenticatedAndCheckIDP.mockImplementation((req, _res, next) => {
        req.user = { id: 1, idpId: 2, isAdmin: false };
        return next();
      });

      (util as any).timestampToMySQLDatetime = jest
        .fn()
        .mockReturnValue('2024-01-01 00:00:00');
      (util as any).runQuery = jest.fn().mockResolvedValue([]);

      const response = await request(app)
        .get('/searchtermsuggest?termPrefix=xyz')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        suggestions: [],
      });
    });
  });

  describe('GET /search', () => {
    it('returns search results for regular user', async () => {
      ensureAuthenticatedAndCheckIDP.mockImplementation((req, _res, next) => {
        req.user = { id: 1, idpId: 2, isAdmin: false };
        return next();
      });

      const mockResults = [
        { id: 1, text: 'This is a test result', book_id: 5 },
        { id: 2, text: 'Another test result', book_id: 5 },
      ];

      (util as any).timestampToMySQLDatetime = jest
        .fn()
        .mockReturnValue('2024-01-01 00:00:00');
      (util as any).runQuery = jest.fn().mockResolvedValue(mockResults);
      (util as any).dedup = jest.fn((arr) => arr);
      (util as any).convertJsonColsFromStrings = jest.fn();

      const response = await request(app)
        .get('/search?searchStr=test&limit=50&offset=0')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        results: mockResults,
      });
    });

    it('returns 403 when user lacks access to specific book', async () => {
      ensureAuthenticatedAndCheckIDP.mockImplementation((req, _res, next) => {
        req.user = { id: 1, idpId: 2, isAdmin: false };
        return next();
      });

      (util as any).timestampToMySQLDatetime = jest
        .fn()
        .mockReturnValue('2024-01-01 00:00:00');
      (util as any).hasAccess = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .get('/search/123?searchStr=test')
        .expect(403);

      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('searches specific book when user has access', async () => {
      ensureAuthenticatedAndCheckIDP.mockImplementation((req, _res, next) => {
        req.user = { id: 1, idpId: 2, isAdmin: false };
        return next();
      });

      const mockResults = [
        { id: 1, text: 'Book specific result', book_id: 123 },
      ];

      (util as any).timestampToMySQLDatetime = jest
        .fn()
        .mockReturnValue('2024-01-01 00:00:00');
      (util as any).hasAccess = jest.fn().mockResolvedValue(true);
      (util as any).runQuery = jest.fn().mockResolvedValue(mockResults);
      (util as any).dedup = jest.fn((arr) => arr);
      (util as any).convertJsonColsFromStrings = jest.fn();

      const response = await request(app)
        .get('/search/123?searchStr=test')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        results: mockResults,
      });
    });

    it('handles empty search results', async () => {
      ensureAuthenticatedAndCheckIDP.mockImplementation((req, _res, next) => {
        req.user = { id: 1, idpId: 2, isAdmin: false };
        return next();
      });

      (util as any).timestampToMySQLDatetime = jest
        .fn()
        .mockReturnValue('2024-01-01 00:00:00');
      (util as any).runQuery = jest.fn().mockResolvedValue([]);
      (util as any).dedup = jest.fn((arr) => arr);
      (util as any).convertJsonColsFromStrings = jest.fn();

      const response = await request(app)
        .get('/search?searchStr=nonexistent')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        results: [],
      });
    });
  });
});
