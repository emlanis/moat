export type Recipient = {
  name?: string;
  address: string;
  chain: "solana" | "evm";
  amount: string;
};

export type PayoutPlan = {
  id: string;
  title: string;
  recipients: Recipient[];
};

export type CommitmentRecipient = {
  recipientCaip10: string;
  amount: string;
  assetCaip19: string;
};

export type CommitmentMemo = {
  title?: string;
  note?: string;
  createdAt: string;
};

export type CommitmentPlan = {
  id: string;
  creator: string;
  batchId: string;
  recipients: CommitmentRecipient[];
  memo: CommitmentMemo;
  mode?: "devnet-mock" | "mainnet-silentswap";
};

export function validatePlan(plan: PayoutPlan) {
  if (!plan.recipients?.length) throw new Error("No recipients");
  return true;
}

export {
  MOAT_LEAF_PREFIX,
  buildLeafHashes,
  hashLeaf,
  hashMemo,
  computeMerkleRoot,
  toHex,
} from "./merkle";
