"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { FileText, Receipt } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { appendToMatchingLists, createTempId, replaceMatchingListItemId } from "@/lib/optimistic-mutation";
import { isAxiosError } from "axios";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { CustomerPickerField } from "@/components/ui/customer-picker-field";
import { FormField, TextArea, TextInput } from "@/components/ui/form-field";
import { FormFooterActions, FormShell } from "@/components/ui/form-shell";
import { FormSection } from "@/components/ui/form-section";
import { cn } from "@/lib/utils";

type LineItem = { name: string; qty: string; rate: string };

type CustomerDetail = {
  id: string;
  companyName?: string;
  ownerName?: string | null;
  phone?: string | null;
  address?: string | null;
  state?: string | null;
  pincode?: string | null;
};

const emptyLineItem = (): LineItem => ({ name: "", qty: "1", rate: "" });

function looksLikeDelhi(state?: string | null) {
  const n = String(state ?? "").trim().toLowerCase();
  return n.includes("delhi");
}

export function InvoiceForm({
  onSuccess,
  onCancel,
}: {
  onSuccess?: (data: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isDelhi, setIsDelhi] = useState(false);
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem()]);
  const [shipTo, setShipTo] = useState({
    companyName: "",
    contactName: "",
    phone: "",
    address: "",
    state: "",
    stateCode: "",
    pincode: "",
  });
  const [error, setError] = useState<string | null>(null);

  const { data: customer } = useQuery({
    queryKey: ["customer", customerId, "invoice-form"],
    queryFn: async () => {
      const res = await api.get<CustomerDetail>(`/customers/${customerId}`);
      return res.data;
    },
    enabled: Boolean(customerId),
  });

  useEffect(() => {
    if (!customer) return;
    const delhi = looksLikeDelhi(customer.state);
    setIsDelhi(delhi);
    setShipTo({
      companyName: customer.companyName || "",
      contactName: customer.ownerName || "",
      phone: customer.phone || "",
      address: customer.address || "",
      state: customer.state || "",
      stateCode: delhi ? "07" : "",
      pincode: customer.pincode || "",
    });
  }, [customer]);

  const taxPreview = useMemo(() => {
    const subtotal = lineItems
      .filter((i) => i.name.trim())
      .reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
    const gstAmount = Math.round(subtotal * 18) / 100;
    const half = Math.round((gstAmount / 2) * 100) / 100;
    return {
      subtotal,
      gstAmount,
      cgst: isDelhi ? half : 0,
      sgst: isDelhi ? Math.round((gstAmount - half) * 100) / 100 : 0,
      igst: isDelhi ? 0 : gstAmount,
      grandTotal: Math.round((subtotal + gstAmount) * 100) / 100,
    };
  }, [lineItems, isDelhi]);

  const mutation = useOptimisticMutation({
    mutationFn: async () => {
      const items = lineItems
        .filter((i) => i.name.trim())
        .map((i) => {
          const qty = Number(i.qty) || 1;
          const rate = Number(i.rate) || 0;
          return { name: i.name.trim(), qty, rate, amount: qty * rate };
        });
      if (!items.length) throw new Error("Add at least one line item");
      const res = await api.post("/invoices", {
        customerId,
        dueDate: new Date(dueDate).toISOString(),
        isDelhi,
        notes: notes.trim() || undefined,
        lineItems: items,
        shipTo: {
          companyName: shipTo.companyName.trim() || undefined,
          contactName: shipTo.contactName.trim() || undefined,
          phone: shipTo.phone.trim() || undefined,
          address: shipTo.address.trim() || undefined,
          state: shipTo.state.trim() || undefined,
          stateCode: shipTo.stateCode.trim() || undefined,
          pincode: shipTo.pincode.trim() || undefined,
        },
      });
      return res.data;
    },
    snapshotKeys: [["invoices"]],
    invalidateKeys: [["invoices"]],
    onMutate: () => {
      const tempId = createTempId();
      appendToMatchingLists(queryClient, ["invoices"], { id: tempId, customerId, status: "DRAFT", dueDate });
      return { tempId };
    },
    onSuccess: (data, _vars, context) => {
      if (context?.tempId && data && typeof data === "object" && "id" in data) {
        replaceMatchingListItemId(queryClient, ["invoices"], context.tempId, data as { id: string });
      }
      if (data && typeof data === "object") onSuccess?.(data as Record<string, unknown>);
    },
    onError: (err) => {
      const message = isAxiosError(err)
        ? (err.response?.data as { message?: string | string[] })?.message ?? err.message
        : err instanceof Error
          ? err.message
          : "Failed to create invoice";
      setError(Array.isArray(message) ? message.join(", ") : String(message));
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customerId) {
      setError("Please select a customer");
      return;
    }
    if (!dueDate) {
      setError("Please set a due date");
      return;
    }
    mutation.mutate();
  }

  function updateLineItem(index: number, key: keyof LineItem, value: string) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  }

  function setShip<K extends keyof typeof shipTo>(key: K, value: string) {
    setShipTo((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormShell
        footer={
          <FormFooterActions onCancel={onCancel} submitLabel="Create invoice" pending={mutation.isPending} pendingLabel="Creating…" />
        }
      >
        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}

        <FormSection title="Bill to" description="Customer, place of supply, and due date" icon={FileText} accent="indigo">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <CustomerPickerField value={customerId} onChange={setCustomerId} required />
            </div>
            <FormField label="Due date">
              <TextInput value={dueDate} onChange={setDueDate} type="date" required />
            </FormField>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Customer from Delhi?</p>
              <div className="flex gap-2">
                {([true, false] as const).map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => {
                      setIsDelhi(v);
                      if (v) setShip("stateCode", "07");
                    }}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition",
                      isDelhi === v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    {v ? "Yes — 9% CGST + 9% SGST" : "No — 18% IGST"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection title="Consignee (Ship to)" description="Fetched from customer — edit if needed" accent="emerald">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Company / Name">
              <TextInput value={shipTo.companyName} onChange={(v) => setShip("companyName", v)} />
            </FormField>
            <FormField label="Contact">
              <TextInput value={shipTo.contactName} onChange={(v) => setShip("contactName", v)} />
            </FormField>
            <FormField label="Phone">
              <TextInput value={shipTo.phone} onChange={(v) => setShip("phone", v)} />
            </FormField>
            <FormField label="Pincode">
              <TextInput value={shipTo.pincode} onChange={(v) => setShip("pincode", v)} />
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Address">
                <TextArea value={shipTo.address} onChange={(v) => setShip("address", v)} rows={3} />
              </FormField>
            </div>
            <FormField label="State">
              <TextInput value={shipTo.state} onChange={(v) => setShip("state", v)} />
            </FormField>
            <FormField label="State code">
              <TextInput value={shipTo.stateCode} onChange={(v) => setShip("stateCode", v)} placeholder="e.g. 07" />
            </FormField>
          </div>
        </FormSection>

        <FormSection title="Line items" description="HSN/SAC 998314 applied on every bill" icon={Receipt} accent="cyan">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => setLineItems((prev) => [...prev, emptyLineItem()])}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              + Add item
            </button>
          </div>
          <div className="space-y-2">
            {lineItems.map((item, index) => (
              <div key={index} className="grid gap-2 rounded-xl border border-white/60 bg-white/70 p-3 shadow-sm sm:grid-cols-4">
                <FormField label={index === 0 ? "Description" : ""} className="sm:col-span-2">
                  <TextInput
                    value={item.name}
                    onChange={(v) => updateLineItem(index, "name", v)}
                    placeholder="Service or product"
                    required={index === 0}
                  />
                </FormField>
                <FormField label={index === 0 ? "Qty" : ""}>
                  <TextInput value={item.qty} onChange={(v) => updateLineItem(index, "qty", v)} type="number" />
                </FormField>
                <FormField label={index === 0 ? "Rate (₹)" : ""}>
                  <div className="flex gap-1">
                    <TextInput value={item.rate} onChange={(v) => updateLineItem(index, "rate", v)} type="number" />
                    {lineItems.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== index))}
                        className="shrink-0 rounded-lg border border-red-200 px-2 text-xs text-red-600"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </FormField>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Taxable</span>
              <span>{formatMoney(taxPreview.subtotal)}</span>
            </div>
            {isDelhi ? (
              <>
                <div className="mt-1 flex justify-between gap-2">
                  <span className="text-muted-foreground">CGST 9%</span>
                  <span>{formatMoney(taxPreview.cgst)}</span>
                </div>
                <div className="mt-1 flex justify-between gap-2">
                  <span className="text-muted-foreground">SGST 9%</span>
                  <span>{formatMoney(taxPreview.sgst)}</span>
                </div>
              </>
            ) : (
              <div className="mt-1 flex justify-between gap-2">
                <span className="text-muted-foreground">IGST 18%</span>
                <span>{formatMoney(taxPreview.igst)}</span>
              </div>
            )}
            <div className="mt-2 flex justify-between gap-2 border-t border-border pt-2 font-semibold">
              <span>Grand total</span>
              <span>{formatMoney(taxPreview.grandTotal)}</span>
            </div>
          </div>
        </FormSection>

        <FormField label="Notes">
          <TextArea value={notes} onChange={setNotes} placeholder="Optional invoice notes" />
        </FormField>
      </FormShell>
    </form>
  );
}
