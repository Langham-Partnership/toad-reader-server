// READER-145. /addpushtoken, loaded from the real user_routes with a fake database connection.
//
// The first version of the previousToken change was refused with a 400 on every request that carried it, because
// paramsOk rejects any key it is not told about. These tests would have caught that.

import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).log = jest.fn();

type Call = { sql: string; vars: Record<string, unknown> };

const setUp = (fail: (sql: string) => boolean = () => false) => {
  const calls: Call[] = [];
  const installConnection = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).connection = {
      query: (
        sql: string,
        vars: Record<string, unknown>,
        cb: (err: Error | null, result?: unknown) => void,
      ) => {
        calls.push({ sql, vars });
        if (fail(sql)) cb(new Error('write failed'));
        else if (/SELECT pt\.id/.test(sql))
          cb(null, []); // no existing row: the token is new
        else cb(null, { affectedRows: 1 });
        return { sql };
      },
    };
  };

  const app = express();
  app.use(express.json());
  const signedIn = (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 7 };
    next();
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./user_routes')(app, signedIn, signedIn);
  // Installed after the require: loading the routes the first time replaces global.connection.
  installConnection();
  return { app, calls };
};

describe('POST /addpushtoken', () => {
  it('registers a token sent on its own, as older app versions do', async () => {
    const { app, calls } = setUp();
    await request(app)
      .post('/addpushtoken')
      .send({ token: 'ExponentPushToken[new]' })
      .expect(200);
    expect(calls.map((c) => c.sql.trim().split(/\s+/)[0])).toEqual([
      'SELECT',
      'INSERT',
    ]);
  });

  it('accepts previousToken, registers the new token, and retires the old one for this user only', async () => {
    const { app, calls } = setUp();
    await request(app)
      .post('/addpushtoken')
      .send({
        token: 'ExponentPushToken[new]',
        previousToken: 'ExponentPushToken[old]',
      })
      .expect(200);
    const retire = calls.find((c) => /deleted_at=:now/.test(c.sql));
    expect(retire).toBeDefined();
    expect(retire!.sql).toMatch(
      /WHERE user_id=:userId AND token=:previousToken/,
    );
    expect(retire!.vars).toMatchObject({
      userId: 7,
      previousToken: 'ExponentPushToken[old]',
    });
  });

  it('does not retire anything when previousToken equals the new token', async () => {
    const { app, calls } = setUp();
    await request(app)
      .post('/addpushtoken')
      .send({
        token: 'ExponentPushToken[same]',
        previousToken: 'ExponentPushToken[same]',
      })
      .expect(200);
    expect(calls.some((c) => /deleted_at=:now/.test(c.sql))).toBe(false);
  });

  it('still refuses keys it does not know', async () => {
    const { app } = setUp();
    await request(app)
      .post('/addpushtoken')
      .send({ token: 'x', somethingElse: 'y' })
      .expect(400);
  });

  it('does not retire the old token when the new one could not be saved', async () => {
    const { app, calls } = setUp((sql) => /^INSERT/.test(sql.trim()));
    await request(app)
      .post('/addpushtoken')
      .send({
        token: 'ExponentPushToken[new]',
        previousToken: 'ExponentPushToken[old]',
      })
      .expect(500);
    expect(calls.some((c) => /deleted_at=:now/.test(c.sql))).toBe(false);
  });
});
