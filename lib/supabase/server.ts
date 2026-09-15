// 서버 컴포넌트·서버 액션·라우트 핸들러에서 쓰는 Supabase 클라이언트.
// Fluid compute 환경을 고려해 전역 변수에 담지 않고, 매 요청마다 새로 만든다.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 서버 컴포넌트에서 호출된 경우 쿠키를 쓸 수 없다.
            // proxy에서 세션을 갱신하고 있다면 무시해도 된다.
          }
        },
      },
    },
  );
}
