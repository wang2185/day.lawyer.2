
import { NextResponse } from 'next/server';
export async function POST(req: Request, { params }: { params: { path: string }}) {
  const body = await req.json().catch(() => ({}));
  console.log('Notify:', params.path, body);
  return NextResponse.json({ ok: true });
}
