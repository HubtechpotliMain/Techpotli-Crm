"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-error";
import { formatDate, formatLabel, formatMoney } from "@/lib/format";
import { isTempId } from "@/lib/optimistic-mutation";
import { queryRetryDelay, shouldRetryQuery } from "@/lib/query-retry";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { CustomerDetailSkeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/ui/modal";
import { PaymentForm } from "@/components/payments/payment-form";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { useAuthStore } from "@/store/auth-store";
import { isAdmin } from "@/lib/roles";
import { DocumentPreviewModal } from "@/components/ui/document-preview-modal";

type PaymentDetail = Record<string, unknown> & {
  customer?: { id?: string; companyName?: string; phone?: string; email?: string };
  invoice?: { id?: string; invoiceNumber?: string };
  createdBy?: { id?: string; name?: string };
  createdById?: string;
  verifiedBy?: { name?: string };
  proofUrl?: string | null;
  proofS3Key?: string | null;
  proofFilename?: string | null;
  proofMimeType?: string | null;
  bookingAmount?: unknown;
  dueDate?: unknown;
};

function toDateInput(value: unknown) {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default function PaymentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = String(params.id);
  const { authReady } = useAuthReady();
  const user = useAuthStore((s) => s.user);
  const adminView = isAdmin(user?.role);
  const [showProof, setShowProof] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const { data, isLoading, isFetching, error, failureCount } = useQuery({
    queryKey: ["payment", id],
    queryFn: async () => {
      const res = await api.get<PaymentDetail>(`/payments/${id}`, {
        params: { includeProof: true },
      });
      return res.data;
    },
    enabled: authReady && !isTempId(id),
    retry: shouldRetryQuery,
    retryDelay: queryRetryDelay,
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/payments/${id}/verify`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payment", id] });
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
      void queryClient.invalidateQueries({ queryKey: ["payments-summary"] });
    },
  });

  const invoiceMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/payments/${id}/generate-invoice`);
      return res.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["payment", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      const invoiceId = (result as PaymentDetail)?.invoice?.id;
      if (invoiceId) router.push(`/invoices/${invoiceId}`);
    },
  });

  if (isTempId(id)) {
    return <p className="text-sm text-muted-foreground">Saving collection…</p>;
  }

  if (!authReady || isLoading || (isFetching && !data)) {
    return <CustomerDetailSkeleton />;
  }

  if (error) {
    if (isAxiosError(error)) {
      if (!error.response) {
        return (
          <p className="text-sm text-red-500">
            Cannot reach the API server. Start the backend with <code>npm run start:dev</code> in the backend folder.
          </p>
        );
      }
      if (error.response.status === 404) {
        return <p className="text-sm text-red-500">Payment not found</p>;
      }
      if (isFetching || failureCount < 2) {
        return <CustomerDetailSkeleton />;
      }
      return (
        <p className="text-sm text-red-500">
          {getApiErrorMessage(error, "Could not load collection. Please refresh the page.")}
        </p>
      );
    }
    return <p className="text-sm text-red-500">Could not load collection. Please refresh the page.</p>;
  }

  if (!data) {
    return <CustomerDetailSkeleton />;
  }

  const ownerId = String(data.createdById ?? data.createdBy?.id ?? "");
  const canEdit = adminView || (user?.id != null && ownerId === user.id);

  const mutationError =
    verifyMutation.isError
      ? getApiErrorMessage(verifyMutation.error, "Verification failed")
      : invoiceMutation.isError
        ? getApiErrorMessage(invoiceMutation.error, "Invoice generation failed")
        : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={String(data.customer?.companyName ?? "Collection")}
        description={`${formatLabel(String(data.status ?? ""))} · ${formatMoney(data.paidAmount)}`}
        action={
          <Link href="/payments" className="text-sm text-primary hover:underline">
            ← Back to collections
          </Link>
        }
      />

      {mutationError ? (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{mutationError}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit collection
          </button>
        ) : null}
        {data.invoice?.id ? (
          <button
            type="button"
            onClick={() => router.push(`/invoices/${data.invoice!.id}`)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            View invoice {data.invoice.invoiceNumber}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => invoiceMutation.mutate()}
            disabled={invoiceMutation.isPending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
          >
            {invoiceMutation.isPending ? "Generating…" : "Generate invoice"}
          </button>
        )}
        {adminView && !data.verifiedAt ? (
          <button
            type="button"
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
          >
            {verifyMutation.isPending ? "Verifying…" : "Verify collection"}
          </button>
        ) : null}
      </div>

      <GlassCard>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-semibold">{formatMoney(data.paidAmount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{formatLabel(String(data.status ?? "—"))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Method</dt>
            <dd>{data.paymentMethod ? formatLabel(String(data.paymentMethod)) : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Collected on</dt>
            <dd>{formatDate(data.collectedAt ?? data.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Recorded by</dt>
            <dd>{String(data.createdBy?.name ?? "—")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Transaction ID</dt>
            <dd>{String(data.transactionId ?? "—")}</dd>
          </div>
          {data.verifiedAt ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Verified</dt>
              <dd>
                {formatDate(data.verifiedAt)} by {String(data.verifiedBy?.name ?? "admin")}
              </dd>
            </div>
          ) : null}
          {data.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Notes</dt>
              <dd>{String(data.notes)}</dd>
            </div>
          ) : null}
        </dl>
      </GlassCard>

      {data.proofS3Key ? (
        <GlassCard>
          <p className="mb-3 text-sm font-medium">Payment proof</p>
          <button
            type="button"
            onClick={() => setShowProof(true)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            View payment proof
          </button>
        </GlassCard>
      ) : null}

      <DocumentPreviewModal
        open={showProof}
        onClose={() => setShowProof(false)}
        title="Payment proof"
        s3Key={String(data.proofS3Key ?? "")}
        mimeType={String(data.proofMimeType ?? "")}
      />

      <Modal
        open={showEdit}
        onOpenChange={setShowEdit}
        title="Edit collection"
        description={adminView ? "Update any field on this collection." : "Update your collection details."}
        size="lg"
        accent="emerald"
      >
        <PaymentForm
          mode="edit"
          paymentId={id}
          allowCustomerChange={adminView}
          lockCustomer={!adminView}
          existingProofUrl={data.proofUrl}
          defaultCustomerOption={
            data.customer?.id
              ? {
                  value: String(data.customer.id),
                  label: String(data.customer.companyName ?? "Customer"),
                  sublabel:
                    [data.customer.phone, data.customer.email].filter(Boolean).join(" · ") || undefined,
                }
              : null
          }
          defaultValues={{
            customerId: String(data.customer?.id ?? data.customerId ?? ""),
            invoiceId: String(data.invoiceId ?? data.invoice?.id ?? ""),
            paidAmount: String(data.paidAmount ?? ""),
            totalAmount: String(data.totalAmount ?? ""),
            bookingAmount: data.bookingAmount != null ? String(data.bookingAmount) : "",
            status: String(data.status ?? "PAID"),
            paymentMethod: String(data.paymentMethod ?? "UPI"),
            transactionId: String(data.transactionId ?? ""),
            notes: String(data.notes ?? ""),
            collectedAt: toDateInput(data.collectedAt ?? data.createdAt),
            dueDate: toDateInput(data.dueDate),
            proofKey: String(data.proofS3Key ?? ""),
            proofFilename: String(data.proofFilename ?? ""),
            proofMimeType: String(data.proofMimeType ?? ""),
          }}
          onCancel={() => setShowEdit(false)}
          onSuccess={() => {
            setShowEdit(false);
            void queryClient.invalidateQueries({ queryKey: ["payment", id] });
            void queryClient.invalidateQueries({ queryKey: ["payments"] });
            void queryClient.invalidateQueries({ queryKey: ["payments-summary"] });
          }}
        />
      </Modal>
    </div>
  );
}
