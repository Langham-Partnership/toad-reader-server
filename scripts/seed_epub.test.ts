import * as fs from 'fs';
import * as mysql from 'mysql2/promise';

// Mock dependencies
jest.mock('fs');
jest.mock('mysql2/promise');

// Import the module to test
import * as seedEpub from './seed_epub';

describe('seed_epub.ts', () => {
  let mockConnection: {
    execute: jest.Mock;
    end: jest.Mock;
  };
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock console.log to capture log messages
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    
    // Mock database connection
    mockConnection = {
      execute: jest.fn(),
      end: jest.fn(),
    };
    (mysql.createConnection as jest.MockedFunction<typeof mysql.createConnection>).mockResolvedValue(mockConnection as unknown as mysql.Connection);
    
    // Set up required environment variables
    process.env.DATABASE_HOSTNAME = 'test-mysql';
    process.env.DATABASE_USERNAME = 'test-user';
    process.env.DATABASE_PASSWORD = 'test-pass';
    process.env.DATABASE_NAME = 'test-db';
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    jest.resetAllMocks();
  });

  describe('when EPUB file does not exist', () => {
    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
    });

    it('should log error and return early', async () => {
      await seedEpub();
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('EPUB file not found at /app/epub_file.epub')
      );
      expect(mysql.createConnection).not.toHaveBeenCalled();
    });
  });

  describe('when King James Bible already exists (idempotency)', () => {
    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 * 1024 * 2 });
      mockConnection.execute.mockResolvedValueOnce([[{ id: 1 }]]);
    });

    it('should skip import and not create duplicates', async () => {
      await seedEpub();
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('King James Bible already exists in database with ID 1 - skipping import')
      );
      expect(mockConnection.execute).toHaveBeenCalledTimes(1);
    });
  });


});