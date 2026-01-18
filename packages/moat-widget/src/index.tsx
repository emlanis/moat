import React from "react";
import type { PayoutPlan } from "@moat/router";

export function MoatPayoutWidget({ plan }: { plan: PayoutPlan }) {
  return (
    <div style={{border:"1px solid #333", padding:12, borderRadius:8}}>
      <div style={{fontWeight:600}}>Moat Payout Router</div>
      <div style={{opacity:0.8, fontSize:12}}>{plan.title}</div>
      <ul>
        {plan.recipients.map((r, i) => (
          <li key={i}>{r.name ?? r.address} · {r.amount}</li>
        ))}
      </ul>
      <button style={{marginTop:8}}>Execute (soon)</button>
    </div>
  );
}
