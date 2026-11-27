"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "./AppSidebar";
import { NewSermonModal } from "../sermon/NewSermonModal";

export function AuthenticatedShell({
  children,
  userEmail,
  ministryName,
  onSermonCreated,
}: {
  children: React.ReactNode;
  userEmail?: string;
  ministryName?: string;
  onSermonCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const [newModalOpen, setNewModalOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F8FA] text-[#0D1F28] md:h-screen md:flex-row md:overflow-hidden">
      <AppSidebar
        onNewSermon={() => setNewModalOpen(true)}
        userEmail={userEmail}
        ministryName={ministryName}
      />
      <main className="min-w-0 flex-1 overflow-y-auto bg-[#F7F8FA]">
        {children}
      </main>
      <NewSermonModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreated={(id) => {
          if (onSermonCreated) {
            onSermonCreated(id);
          } else {
            router.push(`/sermon/${id}`);
          }
        }}
      />
    </div>
  );
}
