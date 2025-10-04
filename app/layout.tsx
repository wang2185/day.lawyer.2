
export const metadata = { title: "DayLawyer · 법률상담 구독", description: "구독형 법률상담 데모" };
import "./globals.css";
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="ko"><body>{children}</body></html>);
}
