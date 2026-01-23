import bs58 from "bs58";
import type { CommitmentMemo, CommitmentRecipient } from "./index";

export const MOAT_LEAF_PREFIX = "moat:v1";

const textEncoder = new TextEncoder();
const MAX_U32 = 0xffffffff;
const MAX_U64 = BigInt("18446744073709551615");
const ZERO_U64 = BigInt(0);

const getSubtle = () => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto is not available in this environment");
  }
  return subtle;
};

const concatBytes = (...chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

const toU32Le = (value: number) => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
    throw new Error("Index must be a valid u32");
  }
  const out = new Uint8Array(4);
  const view = new DataView(out.buffer);
  view.setUint32(0, value, true);
  return out;
};

const toU64Le = (value: bigint) => {
  if (value < ZERO_U64 || value > MAX_U64) {
    throw new Error("Batch id must be a valid u64");
  }
  const out = new Uint8Array(8);
  let remaining = value;
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
};

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const sha256 = async (data: Uint8Array) => {
  const digest = await getSubtle().digest("SHA-256", data);
  return new Uint8Array(digest);
};

export const hashMemo = async (memo: CommitmentMemo) => {
  const payload = JSON.stringify({
    title: memo.title ?? "",
    note: memo.note ?? "",
    createdAt: memo.createdAt,
  });
  return sha256(textEncoder.encode(payload));
};

type LeafInput = {
  creator: string;
  batchId: bigint;
  index: number;
  recipient: CommitmentRecipient;
};

export const hashLeaf = async (input: LeafInput) => {
  const creatorBytes = bs58.decode(input.creator);
  if (creatorBytes.length !== 32) {
    throw new Error("Creator pubkey must be 32 bytes");
  }

  const data = concatBytes(
    textEncoder.encode(MOAT_LEAF_PREFIX),
    creatorBytes,
    toU64Le(input.batchId),
    toU32Le(input.index),
    textEncoder.encode(input.recipient.recipientCaip10),
    textEncoder.encode(input.recipient.amount),
    textEncoder.encode(input.recipient.assetCaip19),
  );

  return sha256(data);
};

export const buildLeafHashes = async (
  creator: string,
  batchId: bigint,
  recipients: CommitmentRecipient[],
) =>
  Promise.all(
    recipients.map((recipient, index) =>
      hashLeaf({ creator, batchId, index, recipient }),
    ),
  );

export const computeMerkleRoot = async (leaves: Uint8Array[]) => {
  if (leaves.length === 0) {
    throw new Error("At least one leaf is required to build the Merkle root");
  }

  let level = leaves.slice();
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(await sha256(concatBytes(left, right)));
    }
    level = next;
  }

  return level[0];
};
