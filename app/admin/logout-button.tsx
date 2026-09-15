"use client";

// 관리자 화면 전용 로그아웃 버튼. 챗봇 본문은 로그인 없이 공개돼 로그아웃 버튼이 필요 없어,
// 로그인이 필요한 이 화면에만 둔다.

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-full border border-black/15 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
    >
      로그아웃
    </button>
  );
}
