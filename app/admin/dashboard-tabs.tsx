"use client";

// 관리자 화면 탭 전환 UI. 데이터는 서버 컴포넌트(app/admin/page.tsx)에서 미리 만들어
// 각 탭의 내용(ReactNode)으로 전달받고, 여기서는 어느 탭을 보여줄지만 다룬다.

import { useState, type ReactNode } from "react";

type Tab = "overview" | "feedback";

export default function DashboardTabs({
  overview,
  feedback,
}: {
  overview: ReactNode;
  feedback: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-black/10 dark:border-white/15">
        <button
          onClick={() => setTab("overview")}
          className={
            tab === "overview"
              ? "border-b-2 border-accent px-3 pb-2 text-sm font-medium text-accent"
              : "border-b-2 border-transparent px-3 pb-2 text-sm opacity-60 hover:opacity-100"
          }
        >
          운영 현황
        </button>
        <button
          onClick={() => setTab("feedback")}
          className={
            tab === "feedback"
              ? "border-b-2 border-accent px-3 pb-2 text-sm font-medium text-accent"
              : "border-b-2 border-transparent px-3 pb-2 text-sm opacity-60 hover:opacity-100"
          }
        >
          피드백 현황
        </button>
      </div>

      <div hidden={tab !== "overview"}>{overview}</div>
      <div hidden={tab !== "feedback"}>{feedback}</div>
    </div>
  );
}
