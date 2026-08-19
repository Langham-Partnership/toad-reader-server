import request from 'supertest';
import express from 'express';
import patchRoute from '../routes/patch_route';
import util from '../utils/util';
import patchLatestLocation from '../routes/patch_keys/patch_latest_location';
import patchHighlights from '../routes/patch_keys/patch_highlights';
import patchClassrooms from '../routes/patch_keys/patch_classrooms';

jest.mock('../utils/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../utils/util', () => ({
  s3CopyFolder: jest.fn(),
}));

jest.mock('../routes/patch_keys/patch_latest_location', () => ({
  addPreQueries: jest.fn(),
  addPatchQueries: jest.fn(),
}));

jest.mock('../routes/patch_keys/patch_highlights', () => ({
  addPreQueries: jest.fn(),
  addPatchQueries: jest.fn(),
}));

jest.mock('../routes/patch_keys/patch_classrooms', () => ({
  addPreQueries: jest.fn(),
  addPatchQueries: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
type PatchQuestionParams = {
  queriesToRun: {
    query: string;
    vars?: any[];
  }[];
  latest_location?: any;
  updated_at?: any;
  userId?: number;
  bookId?: number;
  dbLatestLocations?: any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

type PatchResult = {
  patch: string;
  success: boolean;
  containedOldPatch: boolean;
};

type AddPatchQueriesFn = (params: PatchQuestionParams) => PatchResult;

const mockAddPatchQueriesLatest =
  patchLatestLocation.addPatchQueries as jest.MockedFunction<AddPatchQueriesFn>;

const mockAddPatchQueriesHighlights =
  patchHighlights.addPatchQueries as jest.MockedFunction<AddPatchQueriesFn>;

const mockAddPatchQueriesClassrooms =
  patchClassrooms.addPatchQueries as jest.MockedFunction<AddPatchQueriesFn>;

describe('PATCH /users/:userId/books/:bookId.json', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // fake auth middleware
    const ensureAuth = (req, _res, next) => {
      req.user = { id: 1 };
      next();
    };

    // fake db
    global.connection = {
      query: jest.fn((_, __, cb) => cb(null, [[]])),
    };

    patchRoute(app, ensureAuth);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 403 if userId does not match req.user.id', async () => {
    const res = await request(app).patch('/users/2/books/10.json').send({});

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 if any patch module reports failure', async () => {
    mockAddPatchQueriesLatest.mockReturnValue({
      patch: 'latest_location',
      success: false,
      containedOldPatch: false,
    });
    mockAddPatchQueriesHighlights.mockReturnValue({
      patch: 'highlights',
      success: false,
      containedOldPatch: false,
    });
    mockAddPatchQueriesClassrooms.mockReturnValue({
      patch: 'classrooms',
      success: false,
      containedOldPatch: false,
    });
    //patchLatestLocation.addPatchQueries.mockReturnValue({ success: false , patch: "asd", containedOldPatch: false})
    // patchHighlights.addPatchQueries.mockReturnValue({ success: true })
    // patchClassrooms.addPatchQueries.mockReturnValue({ success: true })

    const res = await request(app).patch('/users/1/books/10.json').send({});

    expect(res.status).toBe(400);
  });

  it('returns 412 if patch contains old data', async () => {
    mockAddPatchQueriesLatest.mockReturnValue({
      patch: 'latest_location',
      success: true,
      containedOldPatch: true,
    });
    mockAddPatchQueriesHighlights.mockReturnValue({
      patch: 'highlights',
      success: true,
      containedOldPatch: true,
    });
    mockAddPatchQueriesClassrooms.mockReturnValue({
      patch: 'classrooms',
      success: true,
      containedOldPatch: true,
    });

    const res = await request(app).patch('/users/1/books/10.json').send({});

    expect(res.status).toBe(412);
  });

  it('runs queued queries and returns 200 on success', async () => {
    mockAddPatchQueriesLatest.mockImplementation(({ queriesToRun }) => {
      queriesToRun.push({
        query: 'UPDATE book SET foo=1',
        vars: [],
      });
      return {
        patch: 'latest_location',
        success: true,
        containedOldPatch: false,
      };
    });

    mockAddPatchQueriesHighlights.mockReturnValue({
      patch: 'highlights',
      success: true,
      containedOldPatch: false,
    });
    mockAddPatchQueriesClassrooms.mockReturnValue({
      patch: 'classrooms',
      success: true,
      containedOldPatch: false,
    });

    const res = await request(app).patch('/users/1/books/10.json').send({});

    expect(res.status).toBe(200);
    expect(global.connection.query).toHaveBeenCalled();
  });

  it('triggers s3CopyFolder when classroom insert query is executed', async () => {
    mockAddPatchQueriesLatest.mockImplementation(({ queriesToRun }) => {
      queriesToRun.push({
        query: 'INSERT INTO classroom VALUES (?)',
        vars: [{ uid: '123', based_off_classroom_uid: '456' }],
      });
      return {
        patch: 'latest_location',
        success: true,
        containedOldPatch: false,
      };
    });

    mockAddPatchQueriesHighlights.mockReturnValue({
      patch: 'highlights',
      success: true,
      containedOldPatch: false,
    });
    mockAddPatchQueriesClassrooms.mockReturnValue({
      patch: 'classrooms',
      success: true,
      containedOldPatch: false,
    });

    await request(app).patch('/users/1/books/10.json').send({});

    expect(util.s3CopyFolder).toHaveBeenCalledWith({
      source: 'enhanced_assets/456/',
      destination: 'enhanced_assets/123/',
    });
  });

  it('calls next() for non PATCH/POST methods', async () => {
    const res = await request(app).get('/users/1/books/10.json');

    expect(res.status).toBe(404);
  });
});
