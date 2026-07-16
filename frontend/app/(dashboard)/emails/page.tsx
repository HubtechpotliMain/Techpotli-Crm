"use client";

import { Suspense } from "react";
import EmailCenterPage from "./email-center-client";

export default function EmailsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading Email Center…</p>}>
      <EmailCenterPage />
    </Suspense>
  );
}
