"use client";

// 품의서·지출결의서 작성 가이드 챗봇 화면.
// 시작 시 "자주 묻는 질문에서 고르기"와 "직접 질문하기" 중 하나를 선택한 뒤,
// 가이드 답변 또는 담당자 안내를 보여준다. (PRD 4번 이용 흐름)

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HighlightRange } from "@/lib/chatbot";
import { DEPARTMENTS, type AnswerTable, type Owner } from "@/lib/knowledge";
import { createClient } from "@/lib/supabase/client";

type Message = {
  role: "user" | "bot";
  text: string;
  source?: string;
  owner?: Owner;
  /** 소속을 고른 경우에만 붙는 추가 안내. 본문과 분리해 강조 표시한다 */
  departmentNotes?: string[];
  /** text 안에서 강조 표시할 위치 (좌표라 같은 단어가 여러 번 나와도 정확한 자리만 강조된다) */
  highlights?: HighlightRange[];
  /** 나열보다 표가 더 읽기 쉬운 내용 */
  tables?: AnswerTable[];
  /** 표 아래에 덧붙일 부연 설명 */
  afterNote?: string;
  /** 표에서 강조할 행 id */
  highlightRowIds?: string[];
  elapsedMs?: number;
};

/** text 중 highlights 좌표에 해당하는 부분만 강조 표시하도록 조각낸다 */
function renderHighlighted(text: string, highlights?: HighlightRange[]) {
  if (!highlights || highlights.length === 0) return text;

  const ranges = [...highlights].sort((a, b) => a.start - b.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, i) => {
    if (range.start < cursor) return; // 겹치면 건너뛴다
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <mark
        key={i}
        className="rounded bg-yellow-200 px-0.5 font-semibold text-inherit dark:bg-yellow-300/30"
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return nodes;
}

/** 답변에 곁들여진 표를 렌더링한다. 금액이 읽힌 경우 해당 행을 강조한다 */
function AnswerTables({ tables, highlightRowIds }: { tables: AnswerTable[]; highlightRowIds?: string[] }) {
  return (
    <div className="space-y-3">
      {tables.map((table, tableIndex) => (
        <div key={tableIndex} className="space-y-1">
          {table.title && <p className="text-xs font-medium opacity-70">{table.title}</p>}
          <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-black/5 dark:bg-white/10">
                  {table.headers.map((header, i) => (
                    <th key={i} className="px-2.5 py-1.5 text-left font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => {
                  const isHighlighted = !!row.id && highlightRowIds?.includes(row.id);
                  return (
                    <tr
                      key={rowIndex}
                      className={
                        isHighlighted
                          ? "bg-yellow-200 font-semibold dark:bg-yellow-300/30"
                          : "border-t border-black/10 dark:border-white/15"
                      }
                    >
                      {row.cells.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-2.5 py-1.5 align-top">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 화면 모드: 시작 선택 / 자주 묻는 질문 / 직접 질문 */
type Mode = "select" | "faq" | "free";

/** 자주 묻는 질문 목록 */
const SAMPLE_QUESTIONS = [
  "해외 출장비 국가별 급지가 어떻게 되나요?",
  "해외 출장비 규정은 어떻게 되나요?",
  "품의서(비용 관련) 전결 규정은 어떻게 되나요?",
  "지출결의서 전결 규정은 어떻게 되나요?",
];

export default function Page() {
  const [mode, setMode] = useState<Mode>("select");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [department, setDepartment] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getClaims().then(({ data }) => {
      setIsAdmin(data?.claims?.app_metadata?.role === "admin");
    });
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, department: department || null }),
      });
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text: data.message ?? data.error ?? "답변을 가져오지 못했습니다.",
          source: data.source,
          owner: data.owner,
          departmentNotes: data.departmentNotes,
          highlights: data.highlights,
          tables: data.tables,
          afterNote: data.afterNote,
          highlightRowIds: data.highlightRowIds,
          elapsedMs: data.elapsedMs,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      ]);
    } finally {
      setLoading(false);
      // 새 메시지가 보이도록 맨 아래로 스크롤
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      });
    }
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col px-4 py-6">
      <header className="shrink-0 border-b border-black/10 pb-4 dark:border-white/15">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">품의서·지출결의서 작성 가이드 챗봇</h1>
            <p className="mt-1 text-sm opacity-60">
              작성 기준을 확인하고, 답변이 어려운 문의는 담당자를 안내해 드립니다.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {mode !== "select" && (
              <button
                onClick={() => setMode("select")}
                className="rounded-full border border-black/15 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                처음으로
              </button>
            )}
            {isAdmin && (
              <Link
                href="/admin"
                className="rounded-full border border-black/15 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                관리자
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="rounded-full border border-black/15 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              로그아웃
            </button>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <span className="opacity-70">소속</span>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
          >
            <option value="">선택 안 함</option>
            {DEPARTMENTS.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </label>
      </header>

      {mode === "select" ? (
        // 시작 화면: 이용 방법 선택
        <div className="flex flex-1 flex-col justify-center gap-3">
          <p className="text-sm opacity-60">어떻게 시작할까요?</p>

          <button
            onClick={() => setMode("faq")}
            className="rounded-2xl border border-black/15 px-5 py-4 text-left hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            <span className="block font-medium">자주 묻는 질문에서 고르기</span>
            <span className="mt-1 block text-sm opacity-60">
              목록에서 골라 바로 답변을 확인합니다.
            </span>
          </button>

          <button
            onClick={() => setMode("free")}
            className="rounded-2xl border border-black/15 px-5 py-4 text-left hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            <span className="block font-medium">직접 질문하기</span>
            <span className="mt-1 block text-sm opacity-60">
              궁금한 내용을 자유롭게 입력합니다.
            </span>
          </button>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-6">
            {messages.length === 0 && (
              <p className="text-sm opacity-60">
                {mode === "faq"
                  ? "아래 목록에서 질문을 골라 주세요."
                  : "궁금한 내용을 입력해 주세요."}
              </p>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    msg.role === "user"
                      ? "max-w-[85%] rounded-2xl bg-foreground px-4 py-2.5 text-sm text-background"
                      : "max-w-[85%] space-y-2 rounded-2xl border border-black/10 px-4 py-2.5 text-sm dark:border-white/15"
                  }
                >
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {renderHighlighted(msg.text, msg.highlights)}
                  </p>

                  {msg.tables && msg.tables.length > 0 && (
                    <AnswerTables tables={msg.tables} highlightRowIds={msg.highlightRowIds} />
                  )}

                  {msg.afterNote && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed opacity-70">
                      {msg.afterNote}
                    </p>
                  )}

                  {msg.departmentNotes && msg.departmentNotes.length > 0 && (
                    <div className="space-y-1 rounded-lg bg-blue-50 px-3 py-2 dark:bg-blue-950/40">
                      {msg.departmentNotes.map((note, noteIndex) => (
                        <p key={noteIndex} className="font-semibold text-blue-700 dark:text-blue-300">
                          {note}
                        </p>
                      ))}
                    </div>
                  )}

                  {msg.source && <p className="text-xs opacity-60">근거: {msg.source}</p>}

                  {msg.owner &&
                    (msg.owner.name === `${msg.owner.team} 담당자` ? (
                      // 담당자 이름이 따로 없고 팀 명의로만 안내하는 경우 "OO팀 OO팀 담당자"처럼
                      // 팀명이 중복 표시되지 않도록 문장으로 안내한다
                      <div className="rounded-lg bg-black/5 px-3 py-2 text-xs dark:bg-white/10">
                        <p className="font-medium">{msg.owner.team}에 문의하여 주십시오.</p>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-black/5 px-3 py-2 text-xs dark:bg-white/10">
                        <p className="font-medium">
                          {msg.owner.team} {msg.owner.name}
                        </p>
                        <p className="opacity-70">{msg.owner.contact}</p>
                      </div>
                    ))}

                  {msg.role === "bot" && msg.elapsedMs !== undefined && (
                    <p className="text-xs opacity-40">응답 {msg.elapsedMs}ms</p>
                  )}
                </div>
              </div>
            ))}

            {loading && <p className="text-sm opacity-50">답변을 찾고 있습니다…</p>}
          </div>

          <div className="shrink-0 border-t border-black/10 pt-4 dark:border-white/15">
            {mode === "free" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="flex gap-2"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="예: 접대비는 얼마까지 인정되나요?"
                  className="flex-1 rounded-full border border-black/15 bg-transparent px-4 py-2.5 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:opacity-40"
                >
                  전송
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <p className="text-xs opacity-60">자주 묻는 질문</p>
                <div className="flex flex-wrap gap-2">
                  {SAMPLE_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      disabled={loading}
                      className="rounded-full border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setMode("free")}
                  className="text-xs underline opacity-60 hover:opacity-100"
                >
                  찾는 질문이 없다면 직접 질문하기
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
