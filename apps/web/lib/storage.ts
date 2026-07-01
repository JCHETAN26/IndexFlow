import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";

/**
 * Object storage for raw uploaded files, backed by MinIO (S3-compatible) in dev.
 * Extracted text + embeddings live in Postgres; the original bytes live here.
 */
const ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9100";
const BUCKET = process.env.MINIO_BUCKET ?? "indexflow";

const client = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true, // required for MinIO / path-style S3
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? "indexflow",
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? "indexflow123",
  },
});

let bucketReady = false;
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
  bucketReady = true;
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType?: string,
): Promise<void> {
  await ensureBucket();
  await client.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(
  key: string,
): Promise<{ body: Buffer; contentType?: string }> {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return { body: Buffer.from(bytes), contentType: res.ContentType };
}

export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/** Deterministic object key for a document's original file. */
export function storageKeyFor(documentId: string, fileName: string): string {
  return `documents/${documentId}/${fileName}`;
}
