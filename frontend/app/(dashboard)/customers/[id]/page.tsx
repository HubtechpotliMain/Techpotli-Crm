"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { isTempId } from "@/lib/optimistic-mutation";
import Link from "next/link";
import { Star } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/dashboard/page-header";
import { CustomerForm } from "@/components/customers/customer-form";
import { CustomerProfileSections } from "@/components/customers/customer-profile-sections";
import { ProjectForm } from "@/components/projects/project-form";
import { Modal } from "@/components/ui/modal";
import { CardSkeleton, CustomerDetailSkeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/store/auth-store";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { queryRetryDelay, shouldRetryQuery } from "@/lib/query-retry";
import { isSuperAdmin } from "@/lib/roles";
import { getApiErrorMessage } from "@/lib/api-error";
import { CustomerStatusSelect } from "@/components/customers/customer-status-select";

const CustomerServicesPanel = dynamic(
  () => import("@/components/customers/customer-services-panel").then((m) => m.CustomerServicesPanel),
  { loading: () => <CardSkeleton className="h-48" /> },
);
const CustomerRevenuePanel = dynamic(
  () => import("@/components/customers/customer-revenue-panel").then((m) => m.CustomerRevenuePanel),
  { loading: () => <CardSkeleton className="h-48" /> },
);
const CustomerPaymentsPanel = dynamic(
  () => import("@/components/customers/customer-payments-panel").then((m) => m.CustomerPaymentsPanel),
  { loading: () => <CardSkeleton className="h-48" /> },
);
const CustomerCredentialsPanel = dynamic(
  () => import("@/components/customers/customer-credentials-panel").then((m) => m.CustomerCredentialsPanel),
  { loading: () => <CardSkeleton className="h-48" /> },
);
const CustomerPortalWidget = dynamic(
  () => import("@/components/customers/customer-portal-widget").then((m) => m.CustomerPortalWidget),
  { loading: () => <CardSkeleton className="h-36" /> },
);
const CustomerDomainsPanel = dynamic(
  () => import("@/components/customers/customer-domains-panel").then((m) => m.CustomerDomainsPanel),
  { loading: () => <CardSkeleton className="h-48" /> },
);
const CustomerHostingPanel = dynamic(
  () => import("@/components/customers/customer-hosting-panel").then((m) => m.CustomerHostingPanel),
  { loading: () => <CardSkeleton className="h-48" /> },
);
const CustomerDocumentsPanel = dynamic(
  () => import("@/components/customers/customer-documents-panel").then((m) => m.CustomerDocumentsPanel),
  { loading: () => <CardSkeleton className="h-48" /> },
);
const CustomerTimelinePanel = dynamic(
  () => import("@/components/customers/customer-timeline-panel").then((m) => m.CustomerTimelinePanel),
  { loading: () => <CardSkeleton className="h-64" /> },
);
const CustomerCallLogsPanel = dynamic(
  () => import("@/components/customers/customer-call-logs-panel").then((m) => m.CustomerCallLogsPanel),
  { loading: () => <CardSkeleton className="h-48" /> },
);
const CustomerWorkHub = dynamic(
  () => import("@/components/customers/customer-work-hub").then((m) => m.CustomerWorkHub),
  { loading: () => <CardSkeleton className="h-64" /> },
);
const CustomerRecentUpdates = dynamic(
  () => import("@/components/customers/customer-work-hub").then((m) => m.CustomerRecentUpdates),
  { loading: () => <CardSkeleton className="h-36" /> },
);
const CustomerQuickNotes = dynamic(
  () => import("@/components/customers/customer-notes-panel").then((m) => m.CustomerQuickNotes),
  { loading: () => <CardSkeleton className="h-48" /> },
);
const CustomerEmailPanel = dynamic(
  () => import("@/components/customers/customer-email-panel").then((m) => m.CustomerEmailPanel),
  { loading: () => <CardSkeleton className="h-36" /> },
);

type Tab =
  | "overview"
  | "teamWork"
  | "services"
  | "revenue"
  | "payments"
  | "credentials"
  | "domains"
  | "hosting"
  | "documents"
  | "timeline"
  | "callLogs"
  | "edit";

type CustomerDetail = Record<string, unknown> & {
  services?: Array<Record<string, unknown>>;
  assignedEmployee?: { name?: string };
};

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "teamWork", label: "Team Work" },
  { id: "services", label: "Services" },
  { id: "revenue", label: "Revenue" },
  { id: "payments", label: "Payments" },
  { id: "credentials", label: "Credentials" },
  { id: "domains", label: "Domains" },
  { id: "hosting", label: "Hosting" },
  { id: "documents", label: "Documents" },
  { id: "timeline", label: "Timeline" },
  { id: "callLogs", label: "Call Logs" },
  { id: "edit", label: "Edit" },
];

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { authReady } = useAuthReady();
  const canDelete = isSuperAdmin(user?.role);
  const id = String(params.id);
  const [tab, setTab] = useState<Tab>("overview");
  const [showProject, setShowProject] = useState(false);
  const [favorited, setFavorited] = useState(false);

  const { data, isLoading, isFetching, error, failureCount } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const res = await api.get<CustomerDetail>(`/customers/${id}`);
      return res.data;
    },
    enabled: authReady && !isTempId(id),
    retry: shouldRetryQuery,
    retryDelay: queryRetryDelay,
  });

  const { data: favorites = [] } = useQuery({
    queryKey: ["customer-favorites"],
    queryFn: async () => {
      const res = await api.get<{ customer: { id: string } }[]>("/customers/favorites");
      return res.data;
    },
    enabled: authReady && !isLoading && !!data,
  });

  useEffect(() => {
    setFavorited(favorites.some((f) => String(f.customer.id) === id));
  }, [favorites, id]);

  const favoriteMutation = useOptimisticMutation({
    mutationFn: async () => {
      const res = await api.post<{ favorited: boolean }>(`/customers/${id}/favorite`);
      return res.data;
    },
    snapshotKeys: [["customer-favorites"]],
    invalidateKeys: [["customer-favorites"]],
    onMutate: () => {
      setFavorited((prev) => !prev);
    },
    onSuccess: (result) => {
      setFavorited(result.favorited);
    },
    onError: () => {
      setFavorited((prev) => !prev);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/customers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.push("/customers");
    },
    onError: (err) => {
      window.alert(getApiErrorMessage(err, "Failed to delete customer"));
    },
  });

  useEffect(() => {
    if (searchParams.get("newProject") === "1") {
      setShowProject(true);
      router.replace(`/customers/${id}`, { scroll: false });
    }
    const tabParam = searchParams.get("tab");
    if (tabParam === "teamWork") setTab("teamWork");
  }, [searchParams, id, router]);

  if (isTempId(id)) {
    return <p className="text-sm text-muted-foreground">Saving new customer…</p>;
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
        return <p className="text-sm text-red-500">Customer not found</p>;
      }
      if (isFetching || failureCount < 2) {
        return <p className="text-sm text-muted-foreground">Loading customer…</p>;
      }
      return (
        <p className="text-sm text-red-500">
          {getApiErrorMessage(error, "Could not load customer. Please refresh the page.")}
        </p>
      );
    }
    return <p className="text-sm text-red-500">Could not load customer. Please refresh the page.</p>;
  }

  if (!data) {
    return <CustomerDetailSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={String(data.companyName ?? "Customer")}
        description={String(data.ownerName ?? "")}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <CustomerStatusSelect
              customerId={id}
              status={String(data.status ?? "ACTIVE")}
              compact
            />
            <button
              type="button"
              onClick={() => favoriteMutation.mutate()}
              disabled={favoriteMutation.isPending}
              className="rounded-lg border border-border p-1.5 hover:bg-muted disabled:opacity-60"
              aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
            >
              <Star className={`h-4 w-4 ${favorited ? "fill-accent text-accent" : "text-muted-foreground"}`} />
            </button>
            <Link
              href={`/emails?recipientType=customer&recipientId=${id}&purpose=CHECK_IN`}
              className="rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
            >
              Open in Email Center
            </Link>
            <button
              type="button"
              onClick={() => setShowProject(true)}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              + Add Project
            </button>
            {canDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Delete this customer permanently? This cannot be undone.")) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:hover:bg-red-950/30"
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </button>
            ) : null}
            <Link href="/customers" className="text-sm text-primary hover:underline">
              ← Back
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1 rounded-lg border border-border p-0.5 text-xs w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 ${tab === t.id ? "bg-primary text-primary-foreground" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="space-y-4">
          <CustomerRecentUpdates customerId={id} onViewAll={() => setTab("teamWork")} />
          <CustomerEmailPanel customerId={id} customerEmail={data.email as string | null | undefined} />
          <CustomerPortalWidget customerId={id} />
          <CustomerProfileSections data={data} />
        </div>
      ) : null}
      {tab === "teamWork" ? (
        <div className="space-y-6">
          <CustomerWorkHub customerId={id} />
          <CustomerQuickNotes customerId={id} />
        </div>
      ) : null}
      {tab === "services" ? <CustomerServicesPanel customerId={id} /> : null}
      {tab === "revenue" ? <CustomerRevenuePanel customerId={id} /> : null}
      {tab === "payments" ? (
        <CustomerPaymentsPanel
          customerId={id}
          customerName={data.companyName ? String(data.companyName) : undefined}
          customerPhone={data.phone as string | null | undefined}
          customerEmail={data.email as string | null | undefined}
        />
      ) : null}
      {tab === "credentials" ? <CustomerCredentialsPanel customerId={id} /> : null}
      {tab === "domains" ? <CustomerDomainsPanel customerId={id} /> : null}
      {tab === "hosting" ? <CustomerHostingPanel customerId={id} /> : null}
      {tab === "documents" ? <CustomerDocumentsPanel customerId={id} /> : null}
      {tab === "timeline" ? <CustomerTimelinePanel customerId={id} /> : null}
      {tab === "callLogs" ? <CustomerCallLogsPanel customerId={id} /> : null}
      {tab === "edit" ? <CustomerForm customer={data} /> : null}

      <Modal open={showProject} onClose={() => setShowProject(false)} title="New project" size="lg">
        <ProjectForm
          defaultCustomerId={id}
          defaultCustomerOption={{
            value: id,
            label: String(data.companyName ?? "Customer"),
            sublabel: [data.phone, data.email].filter(Boolean).join(" · ") || undefined,
          }}
          onCancel={() => setShowProject(false)}
          onSuccess={(project) => {
            setShowProject(false);
            if (project.id) router.push(`/projects/${project.id}`);
          }}
        />
      </Modal>
    </div>
  );
}
