// app/page.tsx
'use client';

import dynamic from 'next/dynamic';

// "ssr:false"로 클라이언트에서만 렌더
const DayLawyerApp = dynamic(() => import('@/components/DayLawyerApp').then(m => m.default), {
  ssr: false,
  // loading: () => <div>Loading...</div>, // 선택
});

export default function Page() {
  return <DayLawyerApp />;
}
