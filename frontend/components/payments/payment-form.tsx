"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { useFormDraft } from "@/hooks/use-form-draft";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-error";
import { formatLabel } from "@/lib/format";
import { appendToMatchingLists, createTempId } from "@/lib/optimistic-mutation";
import { uploadFileWithProgress } from "@/lib/upload-file";
import { PAYMENT_METHODS, PAYMENT_STATUSES } from "@/lib/types";
import { CustomerPickerField, type CustomerOption } from "@/components/ui/customer-picker-field";
import { FormField, SelectInput, TextArea, TextInput } from "@/components/ui/form-field";
import { FormFooterActions, FormShell } from "@/components/ui/form-shell";
import { FormSection } from "@/components/ui/form-section";
import { SaveProgress, UploadProgress } from "@/components/ui/upload-progress";
import { CheckCircle2, Upload, X } from "lucide-react";

type PaymentFormData = {
  customerId: string;
  invoiceId: string;
  paidAmount: string;
  totalAmount: string;
  bookingAmount: string;
  status: string;
  paymentMethod: string;
  transactionId: string;
  notes: string;
  collectedAt: string;
  dueDate: string;
  proofKey: string;
  proofFilename: string;
  proofMimeType: string;
};

const emptyForm: PaymentFormData = {
  customerId: "",
  invoiceId: "",
  paidAmount: "",
  totalAmount: "",
  bookingAmount: "",
  status: "PAID",
  paymentMethod: "UPI",
  transactionId: "",
  notes: "",
  collectedAt: new Date().toISOString().slice(0, 10),
  dueDate: "",
  proofKey: "",
  proofFilename: "",
  proofMimeType: "",
};

export function PaymentForm({
  defaultValues,
  defaultCustomerOption,
  paymentId,
  mode = "create",
  lockCustomer = false,
  allowCustomerChange = true,
  existingProofUrl,
  onSuccess,
  onCancel,
}: {
  defaultValues?: Partial<PaymentFormData>;
  defaultCustomerOption?: CustomerOption | null;
  paymentId?: string;
  mode?: "create" | "edit";
  /** Force customer field read-only (employees editing own collection) */
  lockCustomer?: boolean;
  allowCustomerChange?: boolean;
  existingProofUrl?: string | null;
  onSuccess?: (data: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [saveStage, setSaveStage] = useState<"idle" | "saving" | "done">("idle");

  const isEdit = mode === "edit" && Boolean(paymentId);
  const customerLocked = lockCustomer || !allowCustomerChange || !!defaultValues?.customerId;

  const initial = { ...emptyForm, ...defaultValues };
  const draftScope =
    defaultValues?.invoiceId ?? defaultValues?.customerId ?? "general";
  const draftEnabled = !isEdit && !defaultValues?.invoiceId && !defaultValues?.customerId;
  const { form, setForm, restored, dirty, clearDraft, discardDraft } = useFormDraft({
    draftKey: isEdit ? `payment:edit:${paymentId}` : `payment:new:${draftScope}`,
    initial,
    enabled: draftEnabled,
  });

  const hasProof = Boolean(form.proofKey && form.proofFilename);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  async function handleProofFile(file: File) {
    setError(null);
    setUploadPercent(0);

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setLocalPreview(url);
    } else {
      setLocalPreview(null);
    }

    setForm((prev) => ({
      ...prev,
      proofFilename: file.name,
      proofMimeType: file.type,
      proofKey: "",
    }));

    try {
      const result = await uploadFileWithProgress(file, setUploadPercent);
      setForm((prev) => ({
        ...prev,
        proofKey: result.key,
        proofFilename: result.filename,
        proofMimeType: result.mimeType ?? file.type,
      }));
    } catch (err) {
      setForm((prev) => ({
        ...prev,
        proofKey: "",
        proofFilename: "",
        proofMimeType: "",
      }));
      setLocalPreview(null);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setError(getApiErrorMessage(err, "Failed to upload proof"));
    } finally {
      setUploadPercent(null);
    }
  }

  function clearProof() {
    setForm((prev) => ({
      ...prev,
      proofKey: "",
      proofFilename: "",
      proofMimeType: "",
    }));
    setLocalPreview(null);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  const mutation = useOptimisticMutation({
    mutationFn: async () => {
      setSaveStage("saving");
      const paid = Number(form.paidAmount);
      const total = form.totalAmount ? Number(form.totalAmount) : paid;
      const payload = {
        customerId: form.customerId.trim(),
        invoiceId: form.invoiceId || undefined,
        paidAmount: paid,
        totalAmount: total,
        bookingAmount: form.bookingAmount ? Number(form.bookingAmount) : undefined,
        status: form.status,
        paymentMethod: form.paymentMethod || undefined,
        transactionId: form.transactionId.trim() || undefined,
        notes: form.notes.trim() || undefined,
        collectedAt: form.collectedAt ? new Date(form.collectedAt).toISOString() : undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        proofS3Key: form.proofKey || undefined,
        proofFilename: form.proofFilename || undefined,
        proofMimeType: form.proofMimeType || undefined,
      };

      if (isEdit && paymentId) {
        const { customerId, ...rest } = payload;
        const body = allowCustomerChange ? { ...rest, customerId } : rest;
        const res = await api.patch(`/payments/${paymentId}`, body);
        return res.data;
      }

      const res = await api.post("/payments", payload);
      return res.data;
    },
    snapshotKeys: [["payments"], ...(paymentId ? [["payment", paymentId]] : [])],
    invalidateKeys: [
      ["payments"],
      ["payments-summary"],
      ...(paymentId ? [["payment", paymentId]] : []),
    ],
    onMutate: () => {
      if (isEdit) return {};
      const tempId = createTempId();
      appendToMatchingLists(queryClient, ["payments"], {
        id: tempId,
        customerId: form.customerId,
        paidAmount: Number(form.paidAmount),
        status: form.status,
        paymentMethod: form.paymentMethod,
        collectedAt: form.collectedAt,
        proofFilename: form.proofFilename || undefined,
      });
      return { tempId };
    },
    onSuccess: (data) => {
      setSaveStage("done");
      clearDraft();
      if (!isEdit) clearProof();
      onSuccess?.(data as Record<string, unknown>);
      setTimeout(() => setSaveStage("idle"), 1500);
    },
    onError: (err) => {
      setSaveStage("idle");
      setError(getApiErrorMessage(err, isEdit ? "Failed to update collection" : "Failed to record payment"));
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.customerId?.trim()) {
      setError("Please select a company before saving.");
      return;
    }
    if (!form.paidAmount || Number(form.paidAmount) <= 0) {
      setError("Enter a valid amount received.");
      return;
    }
    if (uploadPercent !== null) {
      setError("Please wait for the proof upload to finish.");
      return;
    }
    if (form.proofFilename && !form.proofKey) {
      setError("Proof file did not finish uploading. Please try again.");
      return;
    }

    mutation.mutate();
  }

  function set<K extends keyof PaymentFormData>(key: K, value: PaymentFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const uploading = uploadPercent !== null;
  const isBusy = mutation.isPending || uploading;
  const proofPreviewSrc = localPreview || existingProofUrl || null;

  return (
    <form onSubmit={handleSubmit}>
      <FormShell
        footer={
          <FormFooterActions
            onCancel={onCancel}
            submitLabel={isEdit ? "Save changes" : "Record collection"}
            pending={isBusy}
            pendingLabel="Saving…"
          />
        }
      >
      {restored ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Draft restored from this browser</span>
          <button type="button" onClick={discardDraft} className="font-medium text-foreground hover:underline">
            Discard draft
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <FormSection title="Customer" description="Who made this payment?" accent="emerald">
        <CustomerPickerField
          value={form.customerId}
          onChange={(v) => set("customerId", v)}
          label="Company / Customer"
          required
          lockSelection={customerLocked}
          defaultOption={defaultCustomerOption}
        />
      </FormSection>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Amount received (₹)">
          <TextInput
            value={form.paidAmount}
            onChange={(v) => set("paidAmount", v)}
            type="number"
            required
          />
        </FormField>
        <FormField label="Total deal amount (₹)">
          <TextInput
            value={form.totalAmount}
            onChange={(v) => set("totalAmount", v)}
            type="number"
            placeholder="Optional"
          />
        </FormField>
      </div>

      {isEdit || allowCustomerChange ? (
        <FormField label="Booking amount (₹)">
          <TextInput
            value={form.bookingAmount}
            onChange={(v) => set("bookingAmount", v)}
            type="number"
            placeholder="Optional"
          />
        </FormField>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Payment method">
          <SelectInput
            value={form.paymentMethod}
            onChange={(v) => set("paymentMethod", v)}
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: formatLabel(m) }))}
          />
        </FormField>
        <FormField label="Status">
          <SelectInput
            value={form.status}
            onChange={(v) => set("status", v)}
            options={PAYMENT_STATUSES.map((s) => ({ value: s, label: formatLabel(s) }))}
          />
        </FormField>
      </div>

      <FormField label="Transaction / UPI reference">
        <TextInput value={form.transactionId} onChange={(v) => set("transactionId", v)} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Collection date">
          <TextInput value={form.collectedAt} onChange={(v) => set("collectedAt", v)} type="date" />
        </FormField>
        <FormField label="Due date">
          <TextInput value={form.dueDate} onChange={(v) => set("dueDate", v)} type="date" />
        </FormField>
      </div>

      <FormField label="Payment proof">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleProofFile(file);
          }}
        />
        {hasProof || form.proofFilename || proofPreviewSrc ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            {proofPreviewSrc && (form.proofMimeType?.startsWith("image/") || localPreview) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={proofPreviewSrc}
                alt="Proof preview"
                className="max-h-32 rounded-md object-contain"
              />
            ) : null}
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                {form.proofKey ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : null}
                <span className="truncate">{form.proofFilename || "Existing proof"}</span>
              </span>
              <button
                type="button"
                onClick={clearProof}
                disabled={uploading}
                className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {uploading ? (
              <UploadProgress percent={uploadPercent ?? 0} label="Uploading proof…" />
            ) : form.proofKey ? (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">Ready to submit</p>
            ) : null}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs font-medium text-primary hover:underline"
            >
              Replace proof
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            Upload screenshot or PDF
          </button>
        )}
        {uploading && !form.proofFilename ? (
          <UploadProgress percent={uploadPercent ?? 0} label="Uploading proof…" className="mt-2" />
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          Proof required for collections of ₹1,000 or more when status is Paid.
        </p>
      </FormField>

      <FormField label="Notes">
        <TextArea value={form.notes} onChange={(v) => set("notes", v)} placeholder="Optional notes" />
      </FormField>

      {dirty && draftEnabled ? (
        <p className="text-xs text-muted-foreground">Draft auto-saved in this browser</p>
      ) : null}

      {saveStage !== "idle" ? (
        <SaveProgress stage={saveStage === "done" ? "done" : "saving"} />
      ) : null}

      </FormShell>
    </form>
  );
}
