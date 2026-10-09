import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { config } from '../config';

const isMissing = (e: unknown) => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.name === 'NoSuchBucket' || err?.$metadata?.httpStatusCode === 404;
};

/**
 * Content-addressed object storage (docs/ARCHITECTURE.md §5.2).
 * Key layout: blobs/<sha256[0:2]>/<sha256>
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  });
  private readonly bucket = config.s3.bucket;
  private readonly log = new Logger('Storage');

  async onModuleInit() {
    await this.ensureBucket();
  }

  /** Creates the bucket on first start. Any other failure (wrong endpoint, credentials, network) stops startup with a clear message. */
  async ensureBucket() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (e) {
      if (!isMissing(e)) throw new Error(`Object storage at ${config.s3.endpoint} is not reachable or refused the credentials: ${(e as Error).message}`);
      this.log.log(`creating bucket ${this.bucket}`);
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  static sha256(buf: Buffer) {
    return createHash('sha256').update(buf).digest('hex');
  }

  static keyFor(sha: string) {
    return `blobs/${sha.slice(0, 2)}/${sha}`;
  }

  /** Stores the buffer if not already present. Returns the storage key. */
  async putBlob(buf: Buffer, sha: string, mimeType?: string | null): Promise<string> {
    const key = StorageService.keyFor(sha);
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return key; // dedupe
    } catch (e) {
      if (!isMissing(e)) throw e; // a real storage failure must not be mistaken for "not there yet"
    }
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buf,
        ContentType: mimeType ?? 'application/octet-stream',
      }),
    );
    return key;
  }

  /** Stores a non-deduplicated object (e.g. a Yjs snapshot) under an explicit key. */
  async putRaw(key: string, buf: Buffer | Uint8Array, contentType = 'application/octet-stream') {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentType: contentType }));
  }

  async getBuffer(key: string): Promise<Buffer> {
    const out = await this.get(key);
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  /** The object's bytes, or one byte range of them (`start`…`end` inclusive) for media seeking. */
  async getStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const out = await this.get(key, range);
    return out.Body as Readable;
  }

  /** A missing object is a 404 for the caller (a blob row whose content is gone), not a 500. */
  private async get(key: string, range?: { start: number; end: number }) {
    try {
      return await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }));
    } catch (e) {
      if (isMissing(e)) {
        this.log.warn(`object ${key} is missing from storage`);
        throw new NotFoundException('The stored content is missing');
      }
      throw e;
    }
  }
}
