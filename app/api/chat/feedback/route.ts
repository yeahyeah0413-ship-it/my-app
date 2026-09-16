// 챗봇 답변에 대한 좋아요/싫어요 피드백을 chat_logs에 반영하는 API.
// 관리자 운영 현황 화면에서 집계해 볼 수 있다.
//
// chat_logs는 관리자만 SELECT할 수 있도록 RLS가 걸려 있는데, Postgres RLS는
// UPDATE 시에도 그 행이 SELECT로 보여야 실제로 반영된다. 그래서 테이블을 직접
// update하면 로그인하지 않은 일반 사용자에게는 항상 조용히 0건 처리된다(에러 없이
// 겉보기엔 성공). 대신 feedback 값만 좁게 갱신하는 SECURITY DEFINER 함수를 거친다.

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
  const { error } = await supabase.rpc("chat_logs_set_feedback", {
    p_id: logId,
    p_feedback: feedback,
  });

  if (error) {
    return Response.json({ error: "피드백을 저장하지 못했습니다." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
