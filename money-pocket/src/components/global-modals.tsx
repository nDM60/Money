"use client";
import { useApp } from "@/client/app";
import { TxForm } from "./forms/tx-form";
import { AccountForm, BudgetForm, GoalForm } from "./forms/forms";
import { Scanner } from "./scanner";

export function GlobalModals() {
  const { modals, close } = useApp();
  return (
    <>
      {modals.tx && <TxForm key={JSON.stringify(modals.tx.prefill ?? modals.tx.existing?.id ?? "")} {...modals.tx} onClose={() => close("tx")} />}
      {modals.account && <AccountForm {...modals.account} onClose={() => close("account")} />}
      {modals.budget && <BudgetForm {...modals.budget} onClose={() => close("budget")} />}
      {modals.goal && <GoalForm {...modals.goal} onClose={() => close("goal")} />}
      {modals.scanner && <Scanner initialMode={modals.scanner.mode} onClose={() => close("scanner")} />}
    </>
  );
}
