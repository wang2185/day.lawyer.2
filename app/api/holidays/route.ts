
import { NextResponse } from 'next/server';
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get('year') || new Date().getFullYear().toString();
  const sample = [`${year}-01-01`, `${year}-03-01`, `${year}-05-05`, `${year}-06-06`, `${year}-08-15`, `${year}-10-03`, `${year}-10-09`, `${year}-12-25`];
  return NextResponse.json(sample);
}
