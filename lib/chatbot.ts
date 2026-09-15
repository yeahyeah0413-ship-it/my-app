// 질문을 가이드 문서와 매칭해 답변을 만들고, 매칭이 약하면 담당자를 안내하는 로직.
// PRD 5번 "AI가 지킬 규칙"을 코드로 강제하는 부분이다.

import {
  DEFAULT_OWNER,
  DEPARTMENT_INFO,
  GUIDE_ENTRIES,
  OWNERS_BY_BOX,
  OWNERS_BY_CATEGORY,
  STAFF_DIRECTORY,
  type AmountTier,
  type AnswerTable,
  type Category,
  type Department,
  type GuideEntry,
  type MatchTier,
  type Owner,
  type Staff,
} from "@/lib/knowledge";

/** 답변으로 인정하는 최소 점수. 이 미만이면 "모른다"고 답하고 담당자를 안내한다. */
const ANSWER_THRESHOLD = 2;

/** message 문자열 안의 한 구간. 화면에서 이 부분만 강조 표시한다. */
export type HighlightRange = { start: number; end: number };

export type ChatAnswer = {
  /** 가이드 문서에서 근거를 찾았는지 여부 */
  answered: boolean;
  /** 답변 본문 */
  message: string;
  /** 근거 문서 (근거를 찾은 경우에만) */
  source?: string;
  /** 안내할 담당자 (근거를 못 찾은 경우에만) */
  owner?: Owner;
  /** 소속을 고른 경우에만 붙는 추가 안내 (화면에서 강조 표시) */
  departmentNotes?: string[];
  /** message 안에서 강조 표시할 위치 (문자열 재검색이 아니라 좌표라 겹치는 단어도 정확한 자리만 강조된다) */
  highlights?: HighlightRange[];
  /** 나열보다 표가 더 읽기 쉬운 내용 (있으면 message 아래에 표로 보여준다) */
  tables?: AnswerTable[];
  /** 표 아래에 덧붙일 부연 설명 */
  afterNote?: string;
  /** 금액이 읽힌 경우, tables 안에서 강조할 행 id */
  highlightRowIds?: string[];
  /** 매칭된 문의 유형 (운영 현황 통계용) */
  category?: Category;
};

/** 공백을 제거하고 소문자로 바꿔 비교하기 쉬운 형태로 만든다 */
function normalize(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/** "500만원", "1억원", "3,000만원" 같은 금액 표현을 원 단위 숫자로 읽는다. 못 읽으면 null. */
function parseAmountWon(question: string): number | null {
  const toNumber = (s: string) => Number(s.replace(/,/g, ""));

  const eok = question.match(/(\d[\d,]*)\s*억/);
  if (eok) return toNumber(eok[1]) * 100_000_000;

  const man = question.match(/(\d[\d,]*)\s*만/);
  if (man) return toNumber(man[1]) * 10_000;

  return null;
}

/** text 안에서 needle이 처음 나오는 위치를(fromIndex부터 찾아) 구간으로 돌려준다. 없으면 null. */
function findRange(text: string, needle: string, fromIndex = 0): HighlightRange | null {
  const start = text.indexOf(needle, fromIndex);
  if (start === -1) return null;
  return { start, end: start + needle.length };
}

/**
 * 금액에 해당하는 구간만 골라 강조 대상을 만든다.
 * 한 답변에 결재선 표가 여러 벌 있으면(group으로 구분) 표마다 하나씩 고른다.
 * 텍스트 답변이면 label 위치(문자열 강조), 표가 있으면 rowId(행 강조)를 돌려준다.
 */
function pickAmountHighlights(
  entry: GuideEntry,
  amount: number,
): { ranges: HighlightRange[]; rowIds: string[] } {
  if (!entry.amountTiers) return { ranges: [], rowIds: [] };

  const tightestByGroup = new Map<string, AmountTier>();
  for (const tier of entry.amountTiers) {
    if (amount > tier.upTo) continue;
    const key = tier.group ?? "default";
    const current = tightestByGroup.get(key);
    if (!current || tier.upTo < current.upTo) tightestByGroup.set(key, tier);
  }

  const tiers = [...tightestByGroup.values()];
  const ranges: HighlightRange[] = [];
  for (const tier of tiers) {
    if (!tier.label) continue;
    const range = findRange(entry.answer, tier.label);
    if (range) ranges.push(range);
  }

  return { ranges, rowIds: tiers.flatMap((tier) => (tier.rowId ? [tier.rowId] : [])) };
}

/**
 * 질문에서 매칭에 쓰인 키워드가 답변 본문에 그대로 있으면 강조 대상으로 고른다.
 * 예: "간이영수증도 되나요?" → 답변 속 "간이영수증"만 강조.
 * matchTiers가 처리하는 단어(국가명 등)는 위치가 헷갈릴 수 있어 여기서는 건너뛰고 matchTiers에 맡긴다.
 */
function pickKeywordHighlights(entry: GuideEntry, normalizedQuestion: string): HighlightRange[] {
  const matchTierWords = new Set<string>();
  for (const tier of entry.matchTiers ?? []) {
    for (const m of tier.match) matchTierWords.add(m);
  }

  const ranges: HighlightRange[] = [];
  for (const keyword of entry.keywords) {
    if (keyword.length < 2) continue; // 한 글자는 오탐이 많아 건너뛴다
    if (matchTierWords.has(keyword)) continue;
    if (!normalizedQuestion.includes(normalize(keyword))) continue;
    const range = findRange(entry.answer, keyword);
    if (range) ranges.push(range);
  }
  return ranges;
}

/**
 * 질문의 특정 단어(국가명 등)에 맞춰, 답변 안의 대응되는 다른 문구도 함께 강조한다.
 * 예: 질문에 "아프리카"가 있으면 "· A급지:" 부분도 같이 강조해 어느 급지인지 바로 보이게 한다.
 * 국가명은 같은 단어가 다른 급지 설명(제외 문구 등)에도 나올 수 있어, 그 급지의 라벨 위치 "이후"에서만
 * 찾아 엉뚱한 곳이 강조되지 않게 한다.
 */
function pickMatchTierHighlights(entry: GuideEntry, normalizedQuestion: string): HighlightRange[] {
  if (!entry.matchTiers) return [];

  const ranges: HighlightRange[] = [];
  for (const tier of entry.matchTiers as MatchTier[]) {
    const matchedKeyword = tier.match.find((m) => normalizedQuestion.includes(normalize(m)));
    if (!matchedKeyword) continue;

    const labelRange = findRange(entry.answer, tier.label);
    if (labelRange) ranges.push(labelRange);

    const keywordRange = findRange(entry.answer, matchedKeyword, labelRange?.end ?? 0);
    if (keywordRange) ranges.push(keywordRange);
  }
  return ranges;
}

/**
 * 질문과 가이드 문서의 키워드가 얼마나 겹치는지 점수를 매긴다.
 * 긴 키워드일수록 변별력이 높다고 보고 글자 수만큼 점수를 준다.
 */
function scoreEntry(normalizedQuestion: string, entry: GuideEntry): number {
  let score = 0;
  for (const keyword of entry.keywords) {
    if (normalizedQuestion.includes(normalize(keyword))) {
      score += keyword.length;
    }
  }
  return score;
}

/** 질문에 가장 잘 맞는 가이드 문서와 점수를 찾는다 */
function findBestEntry(question: string) {
  const normalizedQuestion = normalize(question);
  let best: GuideEntry | null = null;
  let bestScore = 0;

  for (const entry of GUIDE_ENTRIES) {
    const score = scoreEntry(normalizedQuestion, entry);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  return { best, bestScore };
}

/**
 * 담당자를 고른다.
 * 문의 유형이 파악되면 유형 담당자, 파악되지 않으면 기본 창구를 안내한다.
 * 소속별 매입 담당자(OWNERS_BY_DEPARTMENT)는 지출결의서 결재선 안내에서만 쓰고,
 * 여기서는 쓰지 않는다 — 주제를 모르는 질문을 소속의 매입 담당에게 연결하면 안 되기 때문이다.
 * (임의로 추측하지 않는다 — PRD 5번 규칙)
 */
function pickOwner(category: Category | null): Owner {
  if (category) return OWNERS_BY_CATEGORY[category];
  return DEFAULT_OWNER;
}

/**
 * 소속을 고른 경우에만 답변에 곁들일 안내 문장을 만든다.
 * 화면에서 본문과 분리해 강조 표시할 수 있도록 배열로 돌려준다.
 * 소속을 고르지 않았거나 항목에 notes가 없으면 빈 배열이다.
 */
function departmentNotes(entry: GuideEntry, department: Department | null): string[] {
  if (!department || !entry.notes) return [];

  const info = DEPARTMENT_INFO[department];
  const lines: string[] = [];

  for (const note of entry.notes) {
    if (note === "approvalBox") {
      lines.push(`[${department}] ${info.cLevel}입니다.`);
    }
    if (note === "approver") {
      const owner = OWNERS_BY_BOX[info.approvalBox];
      lines.push(`[${department}] 매입 담당은 ${owner.team} ${owner.name}입니다.`);
    }
    if (note === "chairmanException") {
      lines.push(
        info.chairmanException
          ? `[${department}] 의장 전결 특례 부서로, 3,000만원 초과 건은 CEO 승인 후 의장 최종승인이 추가됩니다.`
          : `[${department}] 의장 전결 특례 부서가 아니므로 1,000만원 초과는 CEO 최종승인까지입니다.`,
      );
    }
  }

  return lines;
}

/** "누가 담당인지" 묻는 질문인지 판단한다 */
function isStaffQuestion(question: string): boolean {
  return /담당|누구|누가|문의/.test(question);
}

/**
 * 챗봇 주제(경비·품의·지출결의·예산·자금·송금 등)와 조금이라도 관련 있는 질문인지 판단한다.
 * 가이드 문서·업무분장에 있는 키워드를 그대로 재사용해, 별도 목록을 관리하지 않아도
 * 새 항목이 늘어나면 자동으로 인식 범위도 넓어지게 한다.
 * 여기 걸리지 않는 질문(날씨, 점심메뉴 등)은 담당자를 추측해 연결하지 않고 답변 불가로 안내한다.
 */
const TOPIC_KEYWORDS: string[] = [
  "경비",
  "품의",
  "지출결의",
  "예산",
  "자금",
  "송금",
  ...GUIDE_ENTRIES.flatMap((entry) => entry.keywords),
  ...STAFF_DIRECTORY.flatMap((staff) => staff.duties),
];

function isInScope(question: string): boolean {
  const normalizedQuestion = normalize(question);
  return TOPIC_KEYWORDS.some(
    (keyword) => keyword.length >= 2 && normalizedQuestion.includes(normalize(keyword)),
  );
}

/** 업무 키워드 점수만으로 재경팀 담당자를 찾는다. 트리거 단어 여부는 보지 않는다. */
function scoreStaffMatches(question: string, department: Department | null): Staff[] | null {
  const normalizedQuestion = normalize(question);
  let bestScore = 0;
  let matched: Staff[] = [];

  for (const staff of STAFF_DIRECTORY) {
    let score = 0;
    for (const duty of staff.duties) {
      if (normalizedQuestion.includes(normalize(duty))) score += duty.length;
    }
    if (score > bestScore) {
      bestScore = score;
      matched = [staff];
    } else if (score === bestScore && score > 0) {
      matched.push(staff);
    }
  }

  if (bestScore < ANSWER_THRESHOLD) return null;

  // 매입처럼 박스에 따라 갈리는 담당은 소속을 알면 한 명으로 좁힌다
  if (department && matched.some((s) => s.box)) {
    const box = DEPARTMENT_INFO[department].approvalBox;
    const narrowed = matched.filter((s) => !s.box || s.box === box);
    if (narrowed.length) matched = narrowed;
  }

  return matched;
}

/**
 * 업무 키워드로 재경팀 담당자를 찾는다.
 * 담당자를 묻는 질문이 아니면 null을 돌려주고 일반 답변으로 넘어간다.
 * (내용을 묻는 질문과 헷갈리지 않도록, "담당/누구/누가/문의" 같은 표현이 있을 때만 바로 답한다.
 * 그런 표현이 없어도 다른 데서 답을 못 찾으면 answerQuestion에서 한 번 더 시도한다.)
 */
function findStaff(question: string, department: Department | null): Staff[] | null {
  if (!isStaffQuestion(question)) return null;
  return scoreStaffMatches(question, department);
}

/** 매입처럼 소속에 따라 갈리는 담당자를 설명할 때 붙일 소속 그룹 표기 (박스 색은 노출하지 않는다) */
function boxGroupLabel(box: "빨간색" | "파란색"): string {
  return box === "빨간색" ? "CPO·CIO·COO 소속 담당" : "그 외 소속 담당";
}

/** 찾은 담당자를 문장으로 만든다. 어떤 업무 때문에 이 담당자로 안내하는지 핵심 키워드를 함께 보여준다 */
function describeStaff(matched: Staff[]): string {
  const labels = [...new Set(matched.map((s) => s.label))].join("/");
  const names = matched
    .map((s) => `${s.team} ${s.name}${s.box ? ` (${boxGroupLabel(s.box)})` : ""}`)
    .join(", ");
  return `${labels} 관련 문의는 ${names}에게 문의해 주십시오.`;
}

/** 질문에 대한 답변을 만든다 */
export function answerQuestion(
  question: string,
  department: Department | null,
): ChatAnswer {
  // 담당자를 묻는 질문이면 업무분장에서 해당 담당자만 안내한다
  const staff = findStaff(question, department);
  if (staff) {
    return {
      answered: true,
      message: describeStaff(staff),
      source: "재무본부 재경팀 업무분장",
    };
  }

  const { best, bestScore } = findBestEntry(question);

  // 근거가 충분하면 가이드 문서 내용만 그대로 답한다
  if (best && bestScore >= ANSWER_THRESHOLD) {
    // 다만 문서에 실제 값이 없거나 다른 팀 공지를 따라야 하는 항목은 답변 대신 담당자를 안내한다
    if (best.routeToOwner) {
      const owner =
        best.routeToOwner === true ? OWNERS_BY_CATEGORY[best.category] : best.routeToOwner;
      return {
        answered: false,
        message: best.answer,
        owner,
        ...(best.tables ? { tables: best.tables } : {}),
        ...(best.afterNote ? { afterNote: best.afterNote } : {}),
        category: best.category,
      };
    }
    const notes = departmentNotes(best, department);
    const amount = parseAmountWon(question);
    const normalizedQuestion = normalize(question);
    const amountPick =
      amount !== null ? pickAmountHighlights(best, amount) : { ranges: [], rowIds: [] };
    const highlights = [
      ...amountPick.ranges,
      ...pickKeywordHighlights(best, normalizedQuestion),
      ...pickMatchTierHighlights(best, normalizedQuestion),
    ];
    return {
      answered: true,
      message: best.answer,
      source: best.source,
      ...(notes.length ? { departmentNotes: notes } : {}),
      ...(highlights.length ? { highlights } : {}),
      ...(best.tables ? { tables: best.tables } : {}),
      ...(best.afterNote ? { afterNote: best.afterNote } : {}),
      ...(amountPick.rowIds.length ? { highlightRowIds: amountPick.rowIds } : {}),
      category: best.category,
    };
  }

  // 가이드에서도 못 찾았으면, "담당/누구/문의" 같은 표현이 없었더라도 업무 키워드로 한 번 더 찾아본다
  // (예: "송금 일정이 어떻게 되나요?"처럼 담당자를 묻는 말투가 아니어도 담당자를 찾아줘야 하는 경우)
  const fallbackStaff = scoreStaffMatches(question, department);
  if (fallbackStaff) {
    return {
      answered: true,
      message: describeStaff(fallbackStaff),
      source: "재무본부 재경팀 업무분장",
    };
  }

  // 챗봇 주제와 아예 무관한 질문(날씨, 점심메뉴 등)은 담당자를 추측해 연결하지 않고 답변 불가로 안내한다
  if (!isInScope(question)) {
    return {
      answered: false,
      message:
        "죄송합니다. 이 챗봇은 품의서·지출결의서·경비 규정 관련 문의만 답변드릴 수 있습니다. 문의하신 내용은 답변드리기 어렵습니다.",
    };
  }

  // 주제와 관련은 있지만 근거가 없으면 지어내지 않고 담당자를 안내한다
  const owner = pickOwner(best?.category ?? null);
  return {
    answered: false,
    message:
      "죄송합니다. 사내 가이드 문서에서 근거를 찾지 못해 정확히 답변드리기 어렵습니다. 아래 담당자에게 문의해 주십시오.",
    owner,
    ...(best?.category ? { category: best.category } : {}),
  };
}
