import { MoatPayoutWidget } from "@moat/widget";
import type { PayoutPlan } from "@moat/router";

export default function Page() {
  const plan: PayoutPlan = {
    id: "demo-1",
    title: "Creator rewards payout",
    recipients: [
      { name: "Alice", address: "sol_addr_1", chain: "solana", amount: "1.25" },
      { name: "Bob", address: "evm_addr_1", chain: "evm", amount: "0.50" }
    ]
  };

  return (
    <main style={{maxWidth:720, margin:"40px auto", padding:16}}>
      <h1 style={{fontSize:32, fontWeight:700}}>Moat</h1>
      <p style={{opacity:0.8}}>Drop-in private payouts for Solana apps (SilentSwap integration next).</p>
      <div style={{marginTop:16}}>
        <MoatPayoutWidget plan={plan} />
      </div>
    </main>
  );
}
