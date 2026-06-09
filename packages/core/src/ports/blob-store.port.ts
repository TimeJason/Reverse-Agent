export interface BlobRef {
  id: string;
  hash: string;
  media_type: string;
  size: number;
}

export interface PutBlobInput {
  content: Uint8Array;
  media_type: string;
}

export interface BlobStore {
  put(input: PutBlobInput): Promise<BlobRef>;
  get(ref: BlobRef): Promise<Uint8Array | null>;
}
