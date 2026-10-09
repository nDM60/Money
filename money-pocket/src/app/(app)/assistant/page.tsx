"use client";
import { useApp } from "@/client/app";
import { PageHeader } from "@/components/ui";
import { ChatPanel } from "@/components/chat";

export default function AssistantPage() {
  const { t } = useApp();
  return (
    <div className="flex h-[calc(100dvh-11rem)] flex-col lg:h-[calc(100dvh-7rem)]">
      <PageHeader title={t("chat.title")} />
      <div className="min-h-0 flex-1"><ChatPanel /></div>
    </div>
  );
}
