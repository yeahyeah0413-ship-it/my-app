// 운영 현황 관리자 화면. role이 admin인 계정만 볼 수 있다 (proxy에서는 로그인 여부만 확인하고,
// 관리자 여부는 여기서 다시 확인한다 — Next.js 공식 가이드가 권장하는 이중 확인).

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { GUIDE_ENTRIES } from "@/lib/knowledge";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user) redirect("/login");
  if (user.app_metadata?.role !== "admin") redirect("/");

  const [{ count: totalCount }, { count: unansweredCount }, { data: recentUnanswered }] =
    await Promise.all([
      supabase.from("chat_logs").select("*", { count: "exact", head: true }),
      supabase
        .from("chat_logs")
        .select("*", { count: "exact", head: true })
        .eq("answered", false),
      supabase
        .from("chat_logs")
        .select("question, department, category, created_at")
        .eq("answered", false)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const total = totalCount ?? 0;
  const unanswered = unansweredCount ?? 0;
  const answeredRate = total > 0 ? Math.round(((total - unanswered) / total) * 100) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-sm">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">운영 현황 (관리자)</h1>
        <Link href="/" className="rounded-full border border-black/15 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">
          챗봇으로
        </Link>
      </div>

      <section className="mb-8 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs opacity-60">전체 질문</p>
          <p className="text-lg font-semibold">{total}</p>
        </div>
        <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs opacity-60">답변 못한 질문</p>
          <p className="text-lg font-semibold">{unanswered}</p>
        </div>
        <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs opacity-60">답변률</p>
          <p className="text-lg font-semibold">{answeredRate === null ? "-" : `${answeredRate}%`}</p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-semibold">답변 못한 질문 (최근 50건)</h2>
        {recentUnanswered && recentUnanswered.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-black/5 dark:bg-white/10">
                  <th className="px-2.5 py-1.5 text-left font-medium">질문</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">소속</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">시각</th>
                </tr>
              </thead>
              <tbody>
                {recentUnanswered.map((row, i) => (
                  <tr key={i} className="border-t border-black/10 dark:border-white/15">
                    <td className="px-2.5 py-1.5 align-top">{row.question}</td>
                    <td className="px-2.5 py-1.5 align-top opacity-70">{row.department ?? "-"}</td>
                    <td className="px-2.5 py-1.5 align-top opacity-70">
                      {new Date(row.created_at).toLocaleString("ko-KR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="opacity-60">아직 답변 못한 질문이 없습니다.</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">QnA 목록 ({GUIDE_ENTRIES.length}건)</h2>
        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-black/5 dark:bg-white/10">
                <th className="px-2.5 py-1.5 text-left font-medium">ID</th>
                <th className="px-2.5 py-1.5 text-left font-medium">분류</th>
                <th className="px-2.5 py-1.5 text-left font-medium">키워드</th>
                <th className="px-2.5 py-1.5 text-left font-medium">답변</th>
                <th className="px-2.5 py-1.5 text-left font-medium">근거</th>
              </tr>
            </thead>
            <tbody>
              {GUIDE_ENTRIES.map((entry) => (
                <tr key={entry.id} className="border-t border-black/10 align-top dark:border-white/15">
                  <td className="px-2.5 py-1.5 whitespace-nowrap opacity-70">{entry.id}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap opacity-70">{entry.category}</td>
                  <td className="px-2.5 py-1.5">{entry.keywords.join(", ")}</td>
                  <td className="px-2.5 py-1.5">{entry.answer}</td>
                  <td className="px-2.5 py-1.5 opacity-70">{entry.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
