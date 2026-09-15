// 챗봇 질문을 받아 답변을 돌려주는 API.
// 관리자 운영 현황 화면(app/admin)에서 쓸 수 있도록 매 질문을 chat_logs에 기록한다.

import { randomUUID } from "node:crypto";
import { answerQuestion } from "@/lib/chatbot";
import { DEPARTMENTS, type Department } from "@/lib/knowledge";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) {
    return Response.json({ error: "질문을 입력해 주세요." }, { status: 400 });
  }

  // 소속은 선택 사항이며, 목록에 없는 값은 무시한다
  const department = DEPARTMENTS.includes(body?.department)
    ? (body.department as Department)
    : null;

  const startedAt = Date.now();
  const answer = answerQuestion(question, department);

  // 좋아요/싫어요 피드백을 나중에 이 질문에 이어붙일 수 있도록, id를 미리 만들어 응답에 함께 내려준다
  // (로그 기록 완료를 기다리지 않아도 되어, 응답을 늦추지 않는다)
  const logId = randomUUID();

  // 로그 기록은 응답을 늦추거나 막지 않는다 (실패해도 챗봇 답변에는 영향 없음)
  createClient()
    .then((supabase) =>
      supabase.from("chat_logs").insert({
        id: logId,
        question,
        answered: answer.answered,
        category: answer.category ?? null,
        department,
      }),
    )
    .catch(() => {});

  return Response.json({ ...answer, elapsedMs: Date.now() - startedAt, logId });
}
