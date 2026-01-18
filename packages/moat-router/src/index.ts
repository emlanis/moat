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

export function validatePlan(plan: PayoutPlan) {
  if (!plan.recipients?.length) throw new Error("No recipients");
  return true;
}
