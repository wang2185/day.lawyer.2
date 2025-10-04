
import { NextResponse } from 'next/server';
export async function POST(req: Request) {
  const url = new URL(req.url);
  const redirectTo = new URL('/#/_nicepayReturn', url.origin);
  return NextResponse.redirect(redirectTo.toString(), { status: 307 });
}
