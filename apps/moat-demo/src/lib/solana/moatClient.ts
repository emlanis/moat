import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idlJson from "./moat_registry.idl.json";
import { MOAT_PROGRAM_ID } from "./constants";

type IdlWithAddress = Idl & {
  address?: string;
  metadata?: { address?: string };
};

type RegistryStateSnake = {
  admin: PublicKey;
  next_id: BN;
  bump: number;
};

type RegistryStateCamel = {
  admin: PublicKey;
  nextId: BN;
  bump: number;
};

type RegistryEntrySnake = {
  registry: PublicKey;
  id: number | BN;
  admin: PublicKey;
  target_program: PublicKey;
  kind: number;
  bump: number;
};

type RegistryEntryCamel = {
  registry: PublicKey;
  id: number | BN;
  admin: PublicKey;
  targetProgram: PublicKey;
  kind: number;
  bump: number;
};

const STATE_SEED = new TextEncoder().encode("state");
const ENTRY_SEED = new TextEncoder().encode("entry");
const U32_MAX = 0xffffffff;

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

const getRegistryPda = (programId: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([STATE_SEED], programId)[0];

const encodeU32Le = (value: number): Uint8Array => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, value, true);
  return new Uint8Array(buffer);
};

export async function callInitialize(
  provider: AnchorProvider,
): Promise<string> {
  const program = getProgram(provider);
  const statePda = getRegistryPda(program.programId);

  const existingState = await provider.connection.getAccountInfo(statePda);
  if (existingState) {
    throw new Error("Registry already initialized on devnet");
  }

  return await program.methods
    .initialize()
    .accounts({
      authority: provider.wallet.publicKey,
      state: statePda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

const isRegistryState = (
  value: unknown,
): value is RegistryStateSnake | RegistryStateCamel => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const admin = record.admin;
  const bump = record.bump;
  const nextId = record.nextId;
  const nextIdSnake = record.next_id;
  if (!(admin instanceof PublicKey)) return false;
  if (typeof bump !== "number") return false;
  if (nextId instanceof BN) return true;
  if (nextIdSnake instanceof BN) return true;
  return false;
};

export async function fetchRegistryState(
  provider: AnchorProvider,
): Promise<{ admin: PublicKey; nextId: BN; bump: number }> {
  const program = getProgram(provider);
  const statePda = getRegistryPda(program.programId);

  const account = await program.account.registryState.fetch(statePda);
  if (!isRegistryState(account)) {
    throw new Error("Unexpected registry state shape");
  }

  const nextId = "nextId" in account ? account.nextId : account.next_id;
  return {
    admin: account.admin,
    nextId,
    bump: account.bump,
  };
}

const isRegistryEntry = (
  value: unknown,
): value is RegistryEntrySnake | RegistryEntryCamel => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const registry = record.registry;
  const admin = record.admin;
  const bump = record.bump;
  const kind = record.kind;
  const targetProgram = record.targetProgram;
  const targetProgramSnake = record.target_program;
  if (!(registry instanceof PublicKey)) return false;
  if (!(admin instanceof PublicKey)) return false;
  if (typeof bump !== "number") return false;
  if (typeof kind !== "number") return false;
  if (targetProgram instanceof PublicKey) return true;
  if (targetProgramSnake instanceof PublicKey) return true;
  return false;
};

const toU32 = (value: BN): number => {
  const asNumber = value.toNumber();
  if (!Number.isSafeInteger(asNumber) || asNumber < 0 || asNumber > U32_MAX) {
    throw new Error("next_id overflow");
  }
  return asNumber;
};

const toU8 = (value: number): number => {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("Kind must be an integer between 0 and 255");
  }
  return value;
};

export async function registerEntry(
  provider: AnchorProvider,
  targetProgramIdBase58: string,
  kindNumber: number,
): Promise<string> {
  const program = getProgram(provider);
  const registryPda = getRegistryPda(program.programId);
  const state = await fetchRegistryState(provider);
  const nextId = toU32(state.nextId);
  const kind = toU8(kindNumber);
  const trimmedTargetProgram = targetProgramIdBase58.trim();
  if (!trimmedTargetProgram) {
    throw new Error("Target program id is required");
  }
  const targetProgram = new PublicKey(trimmedTargetProgram);
  const entrySeed = encodeU32Le(nextId);
  const [entryPda] = PublicKey.findProgramAddressSync(
    [ENTRY_SEED, registryPda.toBytes(), entrySeed],
    program.programId,
  );

  return await program.methods
    .registerEntry(targetProgram, kind)
    .accounts({
      authority: provider.wallet.publicKey,
      state: registryPda,
      entry: entryPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function fetchEntries(provider: AnchorProvider): Promise<
  Array<{
    publicKey: PublicKey;
    registry: PublicKey;
    id: number;
    admin: PublicKey;
    targetProgram: PublicKey;
    kind: number;
    bump: number;
  }>
> {
  const program = getProgram(provider);
  const registryPda = getRegistryPda(program.programId);
  const entries = await program.account.registryEntry.all([
    {
      memcmp: {
        offset: 8,
        bytes: registryPda.toBase58(),
      },
    },
  ]);

  return entries.map((entry) => {
    const account = entry.account;
    if (!isRegistryEntry(account)) {
      throw new Error("Unexpected registry entry shape");
    }
    const targetProgram =
      "targetProgram" in account ? account.targetProgram : account.target_program;
    const id =
      account.id instanceof BN ? toU32(account.id) : Number(account.id);
    return {
      publicKey: entry.publicKey,
      registry: account.registry,
      id,
      admin: account.admin,
      targetProgram,
      kind: account.kind,
      bump: account.bump,
    };
  }).sort((a, b) => a.id - b.id);
}
