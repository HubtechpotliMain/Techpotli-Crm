"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { appendDetailListItem, createTempId, isTempId, patchDetailItem } from "@/lib/optimistic-mutation";
import Link from "next/link";
import { isAxiosError } from "axios";
import {
  ChevronDown,
  FileText,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  UserCheck,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  CONTACT_STATUSES,
  LEAD_ACTIVITY_TYPES,
  LEAD_PIPELINE_STATUSES,
  LEAD_PRIORITIES,
} from "@/lib/types";
import { GlassCard } from "@/components/ui/glass-card";
import { Modal } from "@/components/ui/modal";
import { LeadForm } from "@/components/leads/lead-form";
import { QuotationForm } from "@/components/quotations/quotation-form";
import { FormField, SelectInput, TextArea, TextInput } from "@/components/ui/form-field";
import { useAssignees } from "@/hooks/use-users";
import { useAuthStore } from "@/store/auth-store";
import { isAdmin, isSuperAdmin } from "@/lib/roles";
import { Trash2 } from "lucide-react";
import { formatDate, formatLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CompanyAvatar,
  LeadAiScoreBadge,
  LeadConversionBadge,
  LeadPriorityBadge,
  LeadStatusBadge,
} from "@/components/leads/lead-badges";
import { LeadPipelineStepper } from "@/components/leads/lead-pipeline-stepper";
import {
  ActivityTimeline,
  DetailBackLink,
  InfoRow,
  QuickFacts,
  StatusHistoryTimeline,
} from "@/components/leads/lead-detail-parts";
import { LeadDetailSkeleton } from "@/components/ui/skeleton";

type LeadDetail = Record<string, unknown> & {
  activities?: Array<Record<string, unknown> & { user?: { name?: string } }>;
  statusHistory?: Array<Record<string, unknown> & { changedBy?: { name?: string } }>;
  quotations?: Array<Record<string, unknown>>;
  assignedTo?: { id?: string; name?: string };
  convertedToCustomerId?: string;
  interestedServices?: string[];
  lostReason?: string;
  aiScore?: number | null;
  aiScoreReason?: string | null;
};

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const adminView = isAdmin(user?.role);
  const canDelete = isSuperAdmin(user?.role);
  const { data: assignees = [] } = useAssignees();
  const moreRef = useRef<HTMLDivElement>(null);

  const [showEdit, setShowEdit] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showLost, setShowLost] = useState(false);
  const [showQuotation, setShowQuotation] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [assignForm, setAssignForm] = useState({ assignedToId: "", followUpDate: "", priority: "MEDIUM", remarks: "" });
  const [activityForm, setActivityForm] = useState({
    type: "CALL",
    contactStatus: "",
    outcome: "",
    notes: "",
    nextFollowUp: "",
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["lead", id],
    queryFn: async () => {
      const res = await api.get<LeadDetail>(`/leads/${id}`);
      return res.data;
    },
    enabled: !isTempId(id),
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["lead", id] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["leads-kanban"] });
  };

  const leadKey = ["lead", id] as const;

  const assignMutation = useOptimisticMutation({
    mutationFn: async () => {
      const res = await api.patch(`/leads/${id}/assign`, {
        assignedToId: assignForm.assignedToId,
        followUpDate: assignForm.followUpDate || undefined,
        priority: assignForm.priority,
        remarks: assignForm.remarks || undefined,
      });
      return res.data;
    },
    snapshotKeys: [leadKey],
    invalidateKeys: [leadKey, ["leads"], ["leads-kanban"]],
    onMutate: () => {
      patchDetailItem(queryClient, leadKey, {
        assignedToId: assignForm.assignedToId,
        followUpDate: assignForm.followUpDate || null,
        priority: assignForm.priority,
      });
      setShowAssign(false);
    },
  });

  const activityMutation = useOptimisticMutation({
    mutationFn: async () => {
      const res = await api.post(`/leads/${id}/activities`, {
        type: activityForm.type,
        contactStatus: activityForm.contactStatus || undefined,
        outcome: activityForm.outcome.trim() || undefined,
        notes: activityForm.notes,
        nextFollowUp: activityForm.nextFollowUp ? new Date(activityForm.nextFollowUp).toISOString() : undefined,
      });
      return res.data;
    },
    snapshotKeys: [leadKey],
    invalidateKeys: [leadKey, ["leads"], ["leads-kanban"]],
    onMutate: () => {
      appendDetailListItem(queryClient, leadKey, "activities", {
        id: createTempId(),
        type: activityForm.type,
        contactStatus: activityForm.contactStatus || null,
        outcome: activityForm.outcome.trim() || null,
        notes: activityForm.notes,
        createdAt: new Date().toISOString(),
      });
      setActivityForm({ type: "CALL", contactStatus: "", outcome: "", notes: "", nextFollowUp: "" });
      setShowActivity(false);
    },
  });

  const statusMutation = useOptimisticMutation({
    mutationFn: async (status: string) => {
      const res = await api.patch(`/leads/${id}`, { status });
      return res.data;
    },
    snapshotKeys: [leadKey],
    invalidateKeys: [leadKey, ["leads"], ["leads-kanban"]],
    onMutate: (status) => {
      patchDetailItem(queryClient, leadKey, { status });
    },
  });

  const lostMutation = useOptimisticMutation({
    mutationFn: async () => {
      const res = await api.patch(`/leads/${id}`, { status: "LOST", lostReason: lostReason.trim() });
      return res.data;
    },
    snapshotKeys: [leadKey],
    invalidateKeys: [leadKey, ["leads"], ["leads-kanban"]],
    onMutate: () => {
      patchDetailItem(queryClient, leadKey, { status: "LOST", lostReason: lostReason.trim() });
      setShowLost(false);
      setLostReason("");
    },
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ id: string }>(`/leads/${id}/convert`);
      return res.data;
    },
    onSuccess: (customer) => {
      invalidate();
      router.push(`/customers/${customer.id}?newProject=1`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/leads/${id}`);
    },
    onSuccess: () => router.push("/leads"),
  });

  if (isTempId(id)) {
    return <p className="text-sm text-muted-foreground">Saving new lead…</p>;
  }

  if (isLoading) return <LeadDetailSkeleton />;

  if (error || !data) {
    const forbidden = isAxiosError(error) && error.response?.status === 403;
    return (
      <GlassCard className="mx-auto max-w-md py-12 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
          <XCircle className="h-7 w-7 text-red-500" />
        </div>
        <p className="font-medium text-foreground">
          {forbidden ? "You do not have access to this lead" : "Lead not found"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {forbidden ? "This lead belongs to another salesperson." : "It may have been removed."}
        </p>
        <Link
          href="/leads"
          className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Back to leads
        </Link>
      </GlassCard>
    );
  }

  const isConverted = !!data.convertedToCustomerId || data.status === "WON";
  const isLost = data.status === "LOST";
  const isClosed = isConverted || isLost;
  const status = String(data.status ?? "");
  const showConvertProminent = status === "NEGOTIATION" || status === "PROPOSAL_SENT";

  const mutationError = (err: unknown) =>
    isAxiosError(err)
      ? String((err.response?.data as { message?: string | string[] })?.message ?? err.message)
      : "Action failed";

  return (
    <div className="space-y-6">
      <DetailBackLink />

      <GlassCard noPadding>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 md:px-6">
          <div className="flex items-start gap-4">
            <CompanyAvatar name={String(data.companyName ?? "?")} className="h-14 w-14 text-lg" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{String(data.companyName ?? "Lead")}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{String(data.contactName ?? "")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <LeadStatusBadge status={status} size="md" showIcon />
                {data.priority ? <LeadPriorityBadge priority={String(data.priority)} /> : null}
                <LeadConversionBadge
                  status={status}
                  convertedToCustomerId={data.convertedToCustomerId}
                />
                {typeof data.aiScore === "number" ? (
                  <LeadAiScoreBadge score={data.aiScore} reason={data.aiScoreReason} />
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isClosed ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowActivity(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm"
                >
                  <Phone className="h-3.5 w-3.5" />
                  Log activity
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuotation(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium transition hover:bg-muted"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Create quotation
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Convert this lead to a customer?")) convertMutation.mutate();
                  }}
                  disabled={convertMutation.isPending}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-60",
                    showConvertProminent
                      ? "bg-accent text-accent-foreground shadow-sm"
                      : "border border-accent/40 text-accent hover:bg-accent/10",
                  )}
                >
                  {convertMutation.isPending ? "Converting…" : "Convert to Client"}
                </button>
                <div className="relative" ref={moreRef}>
                  <button
                    type="button"
                    onClick={() => setShowMore((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium transition hover:bg-muted"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    More
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {showMore ? (
                    <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-border bg-background py-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => { setShowEdit(true); setShowMore(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit lead
                      </button>
                      {adminView ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAssignForm({
                              assignedToId: String(data.assignedTo?.id ?? data.assignedToId ?? ""),
                              followUpDate: data.followUpDate ? String(data.followUpDate).slice(0, 10) : "",
                              priority: String(data.priority ?? "MEDIUM"),
                              remarks: "",
                            });
                            setShowAssign(true);
                            setShowMore(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
                        >
                          <UserCheck className="h-3.5 w-3.5" /> Assign
                        </button>
                      ) : null}
                      <Link
                        href={`/emails?recipientType=lead&recipientId=${id}&purpose=FOLLOW_UP`}
                        onClick={() => setShowMore(false)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Open in Email Center
                      </Link>
                      <button
                        type="button"
                        onClick={() => { setShowLost(true); setShowMore(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Mark lost
                      </button>
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => {
                            setShowMore(false);
                            if (window.confirm("Delete this lead permanently?")) deleteMutation.mutate();
                          }}
                          disabled={deleteMutation.isPending}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete lead
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            ) : data.convertedToCustomerId ? (
              <Link
                href={`/customers/${data.convertedToCustomerId}`}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
              >
                View customer
              </Link>
            ) : null}
          </div>
        </div>

        <QuickFacts
          phone={data.phone ? String(data.phone) : undefined}
          email={data.email ? String(data.email) : undefined}
          budget={data.budget}
          followUpDate={data.followUpDate}
        />

        {!isClosed ? <LeadPipelineStepper currentStatus={status} /> : null}
      </GlassCard>

      {convertMutation.isError ? (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{mutationError(convertMutation.error)}</p>
      ) : null}

      {!isClosed ? (
        <GlassCard className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">Change status:</span>
          <div className="w-48">
            <SelectInput
              value=""
              onChange={(v) => v && statusMutation.mutate(v)}
              placeholder="Select status"
              options={LEAD_PIPELINE_STATUSES.map((s) => ({ value: s, label: formatLabel(s) }))}
            />
          </div>
          {statusMutation.isPending ? <span className="text-xs text-muted-foreground">Updating…</span> : null}
        </GlassCard>
      ) : null}

      {isLost && data.lostReason ? (
        <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-600">
          <span className="font-medium">Lost reason:</span> {String(data.lostReason)}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard>
          <h3 className="mb-4 text-sm font-semibold">Contact & deal info</h3>
          <div className="space-y-2">
            <InfoRow icon={Phone} label="Phone" value={String(data.phone ?? "—")} href={data.phone ? `tel:${data.phone}` : undefined} />
            <InfoRow icon={Mail} label="Email" value={String(data.email ?? "—")} href={data.email ? `mailto:${data.email}` : undefined} />
            <InfoRow icon={UserCheck} label="Sales person" value={data.assignedTo?.name ?? "—"} />
            <InfoRow icon={FileText} label="Source" value={formatLabel(String(data.source ?? "—"))} />
          </div>
          {(data.interestedServices as string[] | undefined)?.length ? (
            <div className="mt-4 border-t border-border/40 pt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Interested services</p>
              <div className="flex flex-wrap gap-1.5">
                {(data.interestedServices as string[]).map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                  >
                    {formatLabel(s)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {data.remarks ? (
            <div className="mt-4 border-t border-border/40 pt-4">
              <p className="text-xs font-medium text-muted-foreground">Remarks</p>
              <p className="mt-1.5 text-sm leading-relaxed">{String(data.remarks)}</p>
            </div>
          ) : null}
        </GlassCard>

        <GlassCard>
          <h3 className="mb-4 text-sm font-semibold">Activity timeline</h3>
          <ActivityTimeline
            activities={data.activities ?? []}
            onLogActivity={!isClosed ? () => setShowActivity(true) : undefined}
          />
        </GlassCard>

        <GlassCard className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Quotations</h3>
            {!isClosed ? (
              <button
                type="button"
                onClick={() => setShowQuotation(true)}
                className="text-xs font-medium text-primary hover:underline"
              >
                + New quotation
              </button>
            ) : null}
          </div>
          {(data.quotations ?? []).length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {(data.quotations ?? []).map((q) => (
                <div
                  key={String(q.id)}
                  className="rounded-xl border border-border/60 bg-muted/20 p-3 transition hover:border-primary/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/quotations/${q.id}`} className="font-semibold text-primary hover:underline">
                      {String(q.quotationNumber ?? "—")}
                    </Link>
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                      {String(q.status ?? "—")}
                    </span>
                  </div>
                  <p className="mt-2 text-lg font-bold">₹{String(q.grandTotal ?? 0)}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Valid until {q.validUntil ? formatDate(q.validUntil) : "—"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">No quotations yet.</p>
          )}
        </GlassCard>

        <GlassCard className="lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold">Status history</h3>
          <StatusHistoryTimeline history={data.statusHistory ?? []} />
        </GlassCard>
      </div>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit lead" size="lg">
        <LeadForm lead={data} onCancel={() => setShowEdit(false)} onSuccess={() => setShowEdit(false)} />
      </Modal>

      <Modal open={showAssign} onClose={() => setShowAssign(false)} title="Assign lead">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); assignMutation.mutate(); }} className="space-y-4">
          {assignMutation.isError ? <p className="text-sm text-red-500">{mutationError(assignMutation.error)}</p> : null}
          <FormField label="Assign to">
            <SelectInput
              value={assignForm.assignedToId}
              onChange={(v) => setAssignForm((f) => ({ ...f, assignedToId: v }))}
              placeholder="Select employee"
              required
              options={assignees.map((a) => ({ value: a.id, label: a.name }))}
            />
          </FormField>
          <FormField label="Follow-up date">
            <TextInput value={assignForm.followUpDate} onChange={(v) => setAssignForm((f) => ({ ...f, followUpDate: v }))} type="date" />
          </FormField>
          <FormField label="Priority">
            <SelectInput
              value={assignForm.priority}
              onChange={(v) => setAssignForm((f) => ({ ...f, priority: v }))}
              options={LEAD_PRIORITIES.map((p) => ({ value: p, label: formatLabel(p) }))}
            />
          </FormField>
          <FormField label="Remarks">
            <TextArea value={assignForm.remarks} onChange={(v) => setAssignForm((f) => ({ ...f, remarks: v }))} />
          </FormField>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAssign(false)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={assignMutation.isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {assignMutation.isPending ? "Assigning…" : "Assign lead"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={showActivity} onClose={() => setShowActivity(false)} title="Log call / activity">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); activityMutation.mutate(); }} className="space-y-4">
          {activityMutation.isError ? <p className="text-sm text-red-500">{mutationError(activityMutation.error)}</p> : null}
          <FormField label="Activity type">
            <SelectInput
              value={activityForm.type}
              onChange={(v) => setActivityForm((f) => ({ ...f, type: v }))}
              options={LEAD_ACTIVITY_TYPES.map((t) => ({ value: t, label: formatLabel(t) }))}
            />
          </FormField>
          <FormField label="Contact status">
            <SelectInput
              value={activityForm.contactStatus}
              onChange={(v) => setActivityForm((f) => ({ ...f, contactStatus: v }))}
              placeholder="How did the call go?"
              options={CONTACT_STATUSES.map((s) => ({ value: s, label: formatLabel(s) }))}
            />
          </FormField>
          <FormField label="Outcome / what they said">
            <TextArea
              value={activityForm.outcome}
              onChange={(v) => setActivityForm((f) => ({ ...f, outcome: v }))}
              placeholder="Interest level, objections, next steps they mentioned"
            />
          </FormField>
          <FormField label="Detailed notes">
            <TextArea value={activityForm.notes} onChange={(v) => setActivityForm((f) => ({ ...f, notes: v }))} required />
          </FormField>
          <FormField label="Next follow-up">
            <TextInput value={activityForm.nextFollowUp} onChange={(v) => setActivityForm((f) => ({ ...f, nextFollowUp: v }))} type="date" />
          </FormField>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowActivity(false)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={activityMutation.isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {activityMutation.isPending ? "Saving…" : "Log activity"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={showQuotation} onClose={() => setShowQuotation(false)} title="Create quotation" size="lg">
        <QuotationForm
          leadId={id}
          defaultClientName={String(data.companyName ?? data.contactName ?? "")}
          defaultClientEmail={String(data.email ?? "")}
          onCancel={() => setShowQuotation(false)}
          onSuccess={() => {
            invalidate();
            setShowQuotation(false);
          }}
        />
      </Modal>

      <Modal open={showLost} onClose={() => setShowLost(false)} title="Mark lead as lost">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); lostMutation.mutate(); }} className="space-y-4">
          {lostMutation.isError ? <p className="text-sm text-red-500">{mutationError(lostMutation.error)}</p> : null}
          <FormField label="Reason for losing this lead">
            <TextArea value={lostReason} onChange={setLostReason} required placeholder="Why did they not convert?" />
          </FormField>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowLost(false)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={lostMutation.isPending} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {lostMutation.isPending ? "Saving…" : "Mark as lost"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
