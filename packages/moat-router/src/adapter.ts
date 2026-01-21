import type { CommitmentPlan } from "./index";

export type SwapExecution = {
  orderId: string;
  status: string;
};

export interface SwapAdapter {
  execute(plan: CommitmentPlan): Promise<SwapExecution>;
}

export class MockAdapter implements SwapAdapter {
  async execute(plan: CommitmentPlan): Promise<SwapExecution> {
    return {
      orderId: `mock-${plan.id}`,
      status: "complete",
    };
  }
}

export class SilentSwapAdapter implements SwapAdapter {
  async execute(plan: CommitmentPlan): Promise<SwapExecution> {
    return {
      orderId: `todo-${plan.id}`,
      status: "not_configured",
    };
  }
}
