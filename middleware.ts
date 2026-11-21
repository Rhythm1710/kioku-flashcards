import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  if (!req.cookies.get('sid')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/study/:path*', '/add', '/browse', '/edit/:path*', '/import'],
};
