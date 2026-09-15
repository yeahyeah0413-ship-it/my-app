// Proxy(Next.js 16의 Middleware)에서 매 요청마다 세션을 갱신하고,
// 관리자 화면(/admin)에 로그인하지 않은 사용자가 접근하면 /login으로 돌려보낸다.
// 챗봇 본문("/")은 로그인 없이 누구나 이용할 수 있다.
// 서버 컴포넌트는 쿠키를 쓸 수 없어서, 세션 갱신은 여기서만 할 수 있다.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Fluid compute 환경을 고려해 전역 변수에 담지 않고, 매 요청마다 새로 만든다.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // createServerClient와 getClaims() 사이에는 다른 코드를 넣지 않는다.
  // 여기서 실수하면 사용자가 알 수 없이 로그아웃되는 문제를 디버깅하기 어려워진다.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  // 관리자 화면만 로그인을 요구한다. 어디로 가려 했는지 redirect 쿼리로 남겨 로그인 후 이어서 갈 수 있게 한다.
  if (!user && request.nextUrl.pathname.startsWith("/admin")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // 이미 로그인한 사용자가 로그인 페이지로 가면, 원래 가려던 곳(없으면 챗봇)으로 돌려보낸다.
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = request.nextUrl.searchParams.get("redirect") || "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // supabaseResponse를 그대로 반환해야 한다. 새 응답을 만들 경우
  // 쿠키를 그대로 옮기지 않으면 브라우저와 서버의 세션이 어긋난다.
  return supabaseResponse;
}
