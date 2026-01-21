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

  const batchSeed = batchId.toArrayLike(Uint8Array, "le", 8);
  const [batchPda] = PublicKey.findProgramAddressSync(
    [BATCH_SEED, creator.toBytes(), batchSeed],
    program.programId,
  );

  return await program.methods
    .commitBatch(batchId, Array.from(merkleRoot), Array.from(memoHash), kind)
    .accounts({
      creator,
      batch: batchPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}
