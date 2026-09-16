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
  const logId = randomUUID();

  // 이 insert가 끝나기 전에 응답을 돌려주면, 사용자가 답변을 보자마자 바로 피드백을 눌렀을 때
  // 그 요청이 로그 행이 생기기도 전에 도착해 "성공"만 하고 실제로는 아무것도 갱신하지 못하는
  // 경쟁 상태가 생긴다. 그래서 insert 완료까지는 기다리되, 실패해도 챗봇 답변에는 영향 없게 한다.
  try {
    const supabase = await createClient();
    await supabase.from("chat_logs").insert({
      id: logId,
      question,
      answered: answer.answered,
      category: answer.category ?? null,
      department,
      answer: answer.message,
    });
  } catch {
    // 로그 기록 실패는 조용히 무시한다
  }

  return Response.json({ ...answer, elapsedMs: Date.now() - startedAt, logId });
}
