import request from 'supertest';
import util from '../utils/util';
import express from 'express';
import setupApiRoutes from './api_routes';

jest.mock('express-mysql-session', () => () => jest.fn());

describe('api router', () => {
  const app = express();
  app.use(express.json()); // IMPORTANT: Parse JSON request bodies

  setupApiRoutes(app);

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('POST /updateuserinfo', () => {
    it('should update user info successfully with valid JWT', async () => {
      // Mock the decodeJWT middleware
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (util as any).decodeJWT = jest.fn(() => (req, res, next) => {
        req.idpId = 5;
        req.payload_decoded = {
          sub: 'user123',
          email: 'test@example.com',
          name: 'Test User',
        };
        return next();
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (util as any).updateUserInfo = jest.fn().mockResolvedValue(true);

      // Re-setup routes with mocked middleware
      const testApp = express();
      testApp.use(express.json()); // Parse JSON bodies
      setupApiRoutes(testApp);

      await request(testApp)
        .post('/updateuserinfo')
        .send({ someData: 'value' })
        .expect(200)
        .expect('Content-Type', /json/)
        .then((response) => {
          expect(response.body).toEqual({ success: true });
        });

      expect(util.updateUserInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          log: expect.any(Function),
          idpId: 5,
          userInfo: expect.objectContaining({
            email: 'test@example.com',
            name: 'Test User',
          }),
          req: expect.any(Object),
          next: expect.any(Function),
        }),
      );
    });

    it('should call updateUserInfo with correct parameters', async () => {
      const mockUserInfo = {
        sub: 'user456',
        email: 'another@example.com',
        name: 'Another User',
        roles: ['student'],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (util as any).decodeJWT = jest.fn(() => (req, res, next) => {
        req.idpId = 10;
        req.payload_decoded = mockUserInfo;
        return next();
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (util as any).updateUserInfo = jest.fn().mockResolvedValue(true);

      const testApp = express();
      testApp.use(express.json()); // Parse JSON bodies
      setupApiRoutes(testApp);

      await request(testApp).post('/updateuserinfo').send({}).expect(200);

      expect(util.updateUserInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          userInfo: mockUserInfo,
          idpId: 10,
          req: expect.any(Object),
          next: expect.any(Function),
        }),
      );
    });
  });
});
