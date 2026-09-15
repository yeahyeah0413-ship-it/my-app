// 챗봇 답변에 대한 좋아요/싫어요 피드백을 chat_logs에 반영하는 API.
// 관리자 운영 현황 화면에서 집계해 볼 수 있다.

import { createClient } from "@/lib/supabase/server";

const VALID_FEEDBACK = ["up", "down"] as const;
type Feedback = (typeof VALID_FEEDBACK)[number];

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const logId = typeof body?.logId === "string" ? body.logId : null;
  // feedback이 null이면 이미 누른 선택을 취소하는 것으로 본다
  const feedback: Feedback | null = VALID_FEEDBACK.includes(body?.feedback)
    ? (body.feedback as Feedback)
    : null;

  if (!logId || (body?.feedback !== null && feedback === null)) {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("chat_logs").update({ feedback }).eq("id", logId);

  if (error) {
    return Response.json({ error: "피드백을 저장하지 못했습니다." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
