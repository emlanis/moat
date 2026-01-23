import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idlJson from "./moat_registry.idl.json";
import { MOAT_PROGRAM_ID } from "./constants";

type IdlWithAddress = Idl & {
  address?: string;
  metadata?: { address?: string };
};

const BATCH_SEED = new TextEncoder().encode("batch");
const HASH_BYTES = 32;

type BatchCommitSnake = {
  creator: PublicKey;
  batch_id: BN;
  kind: number;
  merkle_root: number[] | Uint8Array;
  memo_hash: number[] | Uint8Array;
  created_at: BN;
};

type BatchCommitCamel = {
  creator: PublicKey;
  batchId: BN;
  kind: number;
  merkleRoot: number[] | Uint8Array;
  memoHash: number[] | Uint8Array;
  createdAt: BN;
};

export function getProgram(provider: AnchorProvider): Program<Idl> {
  const baseIdl = idlJson as IdlWithAddress;

  // Anchor 0.32 expects the program id inside the IDL
  const idl: IdlWithAddress = {
    ...baseIdl,
    address: MOAT_PROGRAM_ID,
    metadata: {
      ...(baseIdl.metadata ?? {}),
      address: MOAT_PROGRAM_ID,
    },
  };

  return new Program(idl as Idl, provider);
}

const isU8Array = (value: number[] | Uint8Array): value is Uint8Array =>
  value instanceof Uint8Array;

const toBytes = (value: number[] | Uint8Array): Uint8Array =>
  isU8Array(value) ? value : Uint8Array.from(value);

const isBatchCommit = (
  value: unknown,
): value is BatchCommitSnake | BatchCommitCamel => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!(record.creator instanceof PublicKey)) return false;
  if (typeof record.kind !== "number") return false;
  const batchId = record.batchId ?? record.batch_id;
  const merkleRoot = record.merkleRoot ?? record.merkle_root;
  const memoHash = record.memoHash ?? record.memo_hash;
  const createdAt = record.createdAt ?? record.created_at;
  if (!(batchId instanceof BN)) return false;
  if (!(createdAt instanceof BN)) return false;
  if (!Array.isArray(merkleRoot) && !(merkleRoot instanceof Uint8Array))
    return false;
  if (!Array.isArray(memoHash) && !(memoHash instanceof Uint8Array))
    return false;
  return true;
};

const toU8 = (value: number): number => {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("Kind must be an integer between 0 and 255");
  }
  return value;
};

const assertHashLength = (value: Uint8Array, label: string) => {
  if (value.length !== HASH_BYTES) {
    throw new Error(`${label} must be ${HASH_BYTES} bytes`);
  }
};

const deriveBatchPda = (
  programId: PublicKey,
  creator: PublicKey,
  batchId: BN,
) => {
  const batchSeed = batchId.toArrayLike(Uint8Array, "le", 8);
  return PublicKey.findProgramAddressSync(
    [BATCH_SEED, creator.toBytes(), batchSeed],
    programId,
  )[0];
};

export async function commitBatch(
  provider: AnchorProvider,
  batchId: BN,
  merkleRoot: Uint8Array,
  memoHash: Uint8Array,
  kindNumber: number,
): Promise<string> {
  const program = getProgram(provider);
  const creator = provider.wallet.publicKey;
  const kind = toU8(kindNumber);

  assertHashLength(merkleRoot, "Merkle root");
  assertHashLength(memoHash, "Memo hash");

  const batchPda = deriveBatchPda(program.programId, creator, batchId);

  return await program.methods
    .commitBatch(batchId, Array.from(merkleRoot), Array.from(memoHash), kind)
    .accounts({
      creator,
      batch: batchPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function fetchBatchCommit(
  provider: AnchorProvider,
  creator: PublicKey,
  batchId: BN,
): Promise<{
  pda: PublicKey;
  creator: PublicKey;
  batchId: BN;
  kind: number;
  merkleRoot: Uint8Array;
  memoHash: Uint8Array;
  createdAt: BN;
}> {
  const program = getProgram(provider);
  const batchPda = deriveBatchPda(program.programId, creator, batchId);
  const account = await program.account.batchCommit.fetch(batchPda);
  if (!isBatchCommit(account)) {
    throw new Error("Unexpected batch commit shape");
  }

  const batchIdValue = "batchId" in account ? account.batchId : account.batch_id;
  const merkleRootValue =
    "merkleRoot" in account ? account.merkleRoot : account.merkle_root;
  const memoHashValue =
    "memoHash" in account ? account.memoHash : account.memo_hash;
  const createdAtValue =
    "createdAt" in account ? account.createdAt : account.created_at;

  return {
    pda: batchPda,
    creator: account.creator,
    batchId: batchIdValue,
    kind: account.kind,
    merkleRoot: toBytes(merkleRootValue),
    memoHash: toBytes(memoHashValue),
    createdAt: createdAtValue,
  };
}
