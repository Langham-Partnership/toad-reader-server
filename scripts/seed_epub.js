#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const AWS = require('aws-sdk');
const admzip = require('adm-zip');

const config = {
  database: {
    host: process.env.DATABASE_HOSTNAME || 'mysql',
    port: process.env.DATABASE_PORT || 3306,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    bucket: process.env.S3_BUCKET,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  },
};

const s3 = new AWS.S3(config.s3);

const log = (message) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

const timestampToMySQLDatetime = () => {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
};

const seedEpub = async () => {
  const epubPath = '/app/epub_file.epub';

  log('Starting simple EPUB seeding process...');

  // Check if EPUB file exists
  if (!fs.existsSync(epubPath)) {
    log(`EPUB file not found at ${epubPath}`);
    return;
  }

  log(`Found EPUB file: ${epubPath}`);

  let connection;
  try {
    // Connect to database
    log('Connecting to database...');
    connection = await mysql.createConnection(config.database);
    log('Database connected');

    // Get basic file info
    const epubStats = fs.statSync(epubPath);
    const epubSize = Math.ceil(epubStats.size / 1024 / 1024); // Size in MB

    // Simple check - look for a book with King James Bible title
    // This is a reasonable assumption for the King James Bible EPUB file
    const [existingBooks] = await connection.execute(
      'SELECT id FROM book WHERE title LIKE "%King James%" OR title LIKE "%Bible%" OR isbn LIKE "%10%"',
    );

    if (existingBooks.length > 0) {
      log(
        `King James Bible already exists in database with ID ${existingBooks[0].id} - skipping import`,
      );
      return;
    }

    log('King James Bible does not exist - proceeding with import...');

    // Create book record with King James Bible details
    const bookRow = {
      title: 'The King James Version of the Bible',
      author: 'Project Gutenberg',
      isbn: 'PG-10', // Project Gutenberg eBook #10
      epubSizeInMB: epubSize,
      updated_at: timestampToMySQLDatetime(),
    };

    log('Inserting book record');
    const [result] = await connection.execute(
      'INSERT INTO book (title, author, isbn, epubSizeInMB, updated_at) VALUES (?, ?, ?, ?, ?)',
      [
        bookRow.title,
        bookRow.author,
        bookRow.isbn,
        bookRow.epubSizeInMB,
        bookRow.updated_at,
      ],
    );
    const bookId = result.insertId;

    log(`Book inserted with ID ${bookId}`);

    // Update book with rootUrl
    await connection.execute('UPDATE book SET rootUrl = ? WHERE id = ?', [
      `epub_content/book_${bookId}`,
      bookId,
    ]);

    log('Uploading EPUB to MinIO...');

    // Upload the EPUB file itself
    const epubKey = `epub_content/book_${bookId}/book.epub`;
    await s3
      .putObject({
        Bucket: config.s3.bucket,
        Key: epubKey,
        Body: fs.createReadStream(epubPath),
        ContentType: 'application/epub+zip',
      })
      .promise();

    log('EPUB file uploaded successfully');

    // Extract and upload EPUB contents
    log('Extracting EPUB contents...');
    const zip = new admzip(epubPath);
    const entries = zip.getEntries();

    let uploadCount = 0;
    for (const entry of entries) {
      if (!entry.isDirectory) {
        const entryKey = `epub_content/book_${bookId}/${entry.entryName}`;
        await s3
          .putObject({
            Bucket: config.s3.bucket,
            Key: entryKey,
            Body: entry.getData(),
            ContentType: getContentType(entry.entryName),
          })
          .promise();
        uploadCount++;
      }
    }

    log(`Uploaded ${uploadCount} extracted files`);

    // Get the default IDP ID (assumes we're seeding for the first IDP)
    const [idpRows] = await connection.execute(
      'SELECT id FROM idp ORDER BY id LIMIT 1',
    );
    if (idpRows.length === 0) {
      throw new Error('No IDP found in database');
    }
    const idpId = idpRows[0].id;

    // Associate book with IDP
    log(`Associating book with IDP ${idpId}`);
    await connection.execute(
      'INSERT INTO `book-idp` (book_id, idp_id) VALUES (?, ?)',
      [bookId, idpId],
    );

    // Make it a free book by adding to subscription-book with negative subscription_id
    log(`Making book free for IDP ${idpId}`);
    await connection.execute(
      'INSERT INTO `subscription-book` (subscription_id, book_id, version) VALUES (?, ?, ?)',
      [idpId * -1, bookId, 'BASE'],
    );

    log(`Successfully seeded KJV EPUB with book ID ${bookId}`);
  } catch (error) {
    log(`Error seeding EPUB: ${error.message}`);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

// Content type detection for EPUB files
const getContentType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  const types = {
    '.html': 'text/html',
    '.xhtml': 'application/xhtml+xml',
    '.css': 'text/css',
    '.xml': 'application/xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };
  return types[ext] || 'application/octet-stream';
};

// Run the seeding process
if (require.main === module) {
  seedEpub()
    .then(() => {
      log('EPUB seeding completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      log(`EPUB seeding failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = seedEpub;
