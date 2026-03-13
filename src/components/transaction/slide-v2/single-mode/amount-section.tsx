"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Check, Plus, X } from "lucide-react";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  FormLabel,
} from "@/components/ui/form";
import { SmartAmountInput } from "@/components/ui/smart-amount-input";
import { formatShortVietnameseCurrency } from "@/lib/number-to-text";
import { SingleTransactionFormValues } from "../types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function AmountSection() {
  const form = useFormContext<SingleTransactionFormValues>();
  const amount = useWatch({ control: form.control, name: "amount" });
  const serviceFee = useWatch({ control: form.control, name: "service_fee" });
  const type = useWatch({ control: form.control, name: "type" });
  const isHideFee = type === "income" || type === "repayment";

  const [isFeeVisible, setIsFeeVisible] = useState<boolean>(() => {
    const existing = form.getValues("service_fee");
    return typeof existing === "number" && existing > 0;
  });

  useEffect(() => {
    if (isHideFee) {
      if ((form.getValues("service_fee") || 0) > 0) {
        form.setValue("service_fee", null, { shouldDirty: true });
      }
      setIsFeeVisible(false);
    }
  }, [form, isHideFee]);

  useEffect(() => {
    if (isHideFee) return;
    if ((Number(serviceFee) || 0) > 0) setIsFeeVisible(true);
  }, [isHideFee, serviceFee]);

  const principal = Number(amount) || 0;
  const fee = isFeeVisible ? Number(serviceFee) || 0 : 0;
  const total = principal + fee;

  const totalText = useMemo(() => {
    return new Intl.NumberFormat("vi-VN").format(total);
  }, [total]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="p-5 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">
                Principal Amount
              </p>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                {principal > 0
                  ? formatShortVietnameseCurrency(principal)
                  : "Zero amount"}
              </span>
            </div>
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <SmartAmountInput
                      value={field.value}
                      onChange={field.onChange}
                      hideLabel={true}
                      className="text-4xl font-black h-16 bg-slate-50 border border-slate-200 rounded-2xl shadow-inner focus-visible:ring-0 focus-visible:border-indigo-500 transition-all px-3"
                      placeholder="0"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {!isHideFee && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-[0.4em] text-slate-400">
                  Service Fee
                </span>
                {!isFeeVisible ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsFeeVisible(true)}
                    className="text-[9px] font-black uppercase tracking-[0.4em] text-indigo-600"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Fee
                  </Button>
                ) : (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Fee active
                  </span>
                )}
              </div>
              {isFeeVisible ? (
                <div className="flex items-center gap-3">
                  <FormField
                    control={form.control}
                    name="service_fee"
                    render={({ field }) => (
                      <FormItem className="flex-1 space-y-1">
                        <FormLabel className="text-[9px] font-black uppercase tracking-[0.4em] text-indigo-500">
                          Enter fee
                        </FormLabel>
                        <FormControl>
                          <SmartAmountInput
                            value={field.value || undefined}
                            onChange={field.onChange}
                            hideLabel={true}
                            placeholder="0"
                            className="h-12 font-black bg-white border border-slate-200 rounded-2xl focus-visible:border-indigo-500 focus-visible:ring-0 text-right px-3"
                            compact={true}
                            hideCurrencyText={true}
                            hideCalculator={true}
                            hideClearButton={true}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      form.setValue("service_fee", null, { shouldDirty: true });
                      setIsFeeVisible(false);
                    }}
                    className="h-12 w-12 rounded-2xl border border-slate-200 text-slate-500 hover:text-slate-700 transition"
                    aria-label="Remove service fee"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <p className="text-[9px] text-slate-400">
                  Service fee is optional and only shown on expense/debt flows.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-[1fr_auto] items-end">
            <div className="text-[9px] uppercase tracking-[0.4em] text-slate-400">
              {/* spacer */}
            </div>
            <div className="rounded-2xl bg-indigo-600 text-white p-4 flex flex-col items-center justify-center gap-1 min-w-[140px] shadow-lg shadow-indigo-100/70">
              <span className="text-[8px] uppercase tracking-[0.5em] text-indigo-100/80">
                Total
              </span>
              <span className="text-2xl font-black tabular-nums">
                {totalText}
              </span>
              {fee > 0 && (
                <span className="text-[9px] text-indigo-100 uppercase tracking-[0.4em]">
                  Fee: {new Intl.NumberFormat("vi-VN").format(fee)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
