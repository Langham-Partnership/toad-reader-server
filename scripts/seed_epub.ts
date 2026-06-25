#!/usr/bin/env ts-node
'use strict';

import fs from 'fs';

import { Command } from '@commander-js/extra-typings';
import { fromBlob as fileTypeFromBlob } from 'file-type/browser'; // TODO: replace with file-type after we upgrade this library

import {
  processUploadedFile,
  type ProcessUploadedFileOptions,
} from '../src/routes/admin_routes';

const program = new Command();
program
  .name('seed_epub')
  .description('Seed EPUB files')
  .argument('<file>', 'The EPUB file to seed')
  .option('-r, --replace-existing', 'Replace existing book')
  .action(async (fileName, opts) => {
    let blob: Blob;
    try {
      blob = await fs.openAsBlob(fileName);
    } catch (err) {
      if (err instanceof TypeError) {
        throw program.error(`File not found: ${fileName}`);
      }
      throw program.error(err);
    }
    const file = new File([blob], fileName);
    await main(file, opts);
  });

class DummyResponseType {
  private incomplete: boolean = true;
  private _status?: number = undefined;
  private _headers: Record<string, string> = {};
  private _data: string = '';

  status(status: number) {
    if (this._status) {
      throw new Error('status already set');
    }
    this._status = status;
  }

  set(key: string, value: string) {
    if (this._status === undefined) {
      this.status(200);
    }
    if (this._data) {
      throw new Error('data already set');
    }
    if (key in this._headers) {
      throw new Error(`header ${key} already set`);
    }
    this._headers[key] = value;
  }

  write(data: string) {
    if (this._status === undefined) {
      this.status(200);
    }
    console.assert(this.incomplete, 'Response already complete');
    this._data += data;
  }

  end() {
    console.assert(this.incomplete, 'Response already complete');
    if (this._status === undefined) {
      this.status(200);
    }
    this.incomplete = false;
  }

  ok(): boolean {
    if (this.incomplete) {
      return false;
    }
    return 200 <= this._status && this._status <= 299;
  }

  format(): void {
    console.assert(!this.incomplete, 'Response not complete');
    console.log(`HTTP ${this._status}`);
    for (const [key, value] of Object.entries(this._headers)) {
      console.log(`${key}: ${value}`);
    }
    console.log();
    console.log(this._data);
  }
}

async function main(
  file: File,
  { replaceExisting }: { replaceExisting?: boolean } = {
    replaceExisting: false,
  },
): Promise<number> {
  const { mime } = (await fileTypeFromBlob(file)) || {};
  if (!mime?.startsWith('application/epub+zip')) {
    throw program.error('File is not an EPUB file');
  }
  const resp = new DummyResponseType(); // A dummy response to hold the response from processUploadedFile
  const opts: ProcessUploadedFileOptions = {
    query: {
      replaceExisting: replaceExisting ? 'true' : '',
    },
    user: {
      isAdmin: true,
      idpId: 21,
      idpMaxMBPerBook: 500,
    },
    getFrontendBaseUrl: () => 'https://localhost:19006',
    res_send: (data: object) => {
      opts.res_set('Content-Type', 'application/json');
      opts.res_write(JSON.stringify(data));
      opts.res_end();
    },
    res_status: (status: number) => resp.status(status),
    res_set: (key: string, value: string) => resp.set(key, value),
    res_write: (data: string) => resp.write(data),
    res_end: () => resp.end(),
    epubFilePaths: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    next: (err: any) => {
      throw err;
    },
    tmpDir: '/tmp/import-script',
  };
  await processUploadedFile(file.name, file, opts);
  resp.format();
  if (resp.ok()) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
