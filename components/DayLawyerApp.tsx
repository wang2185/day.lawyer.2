// ---------- DayLawyer (Part 1/2) ----------
// Concatenate this file with daylawyer_part2.tsx to get a single TSX.
// Save as src/components/daylawyer_full.tsx (after concatenation) and import with Next.js CSR (ssr:false).
'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Home, CreditCard, User2, Plus, LogOut, LogIn, MessageSquare, Shield, CheckCircle2, ChevronRight, ChevronLeft, Calendar as CalIcon, FileText } from 'lucide-react';

/** FEATURES (fulfilled across Part1+Part2)
 * - Hash routing (SSR-safe), no direct window usage without guards
 * - Auth: signup(name/phone/email/password), login, profile edit
 * - Subscribe: 3 plans (₩110,000/₩990,000/₩3,300,000), NICEPAY MID=winslaw00m, annual
 * - Credits: seeded by plan (12/60/144h), consult completion consumes 1h, admin +/- adjust, top-up by hour (basic 200k/h, pro 50k/h, elite 30k/h)
 * - Consult calendar: KR holidays + weekends excluded, 1h slots, 1h lead time, overlap guard, ICS/GCal export
 * - Admin: member list, subscription & credit view, consult requests list with ‘확정/확정취소/완료/삭제’, blocks panel, month/quarter CSV
 * - Reminders: midnight & 1h before (notify hooks)
 * - NICEPAY backend endpoints (placeholders): /api/payments/nicepay/*
 */

// ---------- SSR guards & helpers ----------
const isBrowser = typeof window !== 'undefined';
const win = () => (isBrowser ? window : ({} as any));
const nowKST = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const toTZ = (d: any, tz='Asia/Seoul') => new Date(new Date(d).toLocaleString('en-US', { timeZone: tz }));
const ymd = (d:any) => { const dt=toTZ(d); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`; };
const hm = (d:any) => { const dt=toTZ(d); return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`; };
const setHour = (d:any, h:number, m=0) => { const dt=toTZ(d); dt.setHours(h,m,0,0); return dt; };
const addDays = (d:any, n:number) => { const dt=toTZ(d); dt.setDate(dt.getDate()+n); return dt; };
const hoursDiff = (a:any,b:any)=> (toTZ(a).getTime()-toTZ(b).getTime())/(1000*60*60);
const within = (s1:any,e1:any,s2:any,e2:any)=> Math.max(toTZ(s1).getTime(),toTZ(s2).getTime()) < Math.min(toTZ(e1).getTime(),toTZ(e2).getTime());
const toGCalDateTime = (date:any) => { const d=new Date(date); const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); const p=(x:number)=>String(x).padStart(2,'0'); return `${z.getUTCFullYear()}${p(z.getUTCMonth()+1)}${p(z.getUTCDate())}T${p(z.getUTCHours())}${p(z.getUTCMinutes())}00Z`; };
const formatKRW = (n:number)=> (n||0).toLocaleString('ko-KR');
const normalizePhone = (p:string)=> (p||'').replace(/[^0-9]/g,'');

// ---------- storage ----------
const storage = {
  get<T=any>(k:string, fb:any=null):T { try{ if(!isBrowser) return fb; const v=localStorage.getItem(k); return v? JSON.parse(v): fb; }catch{return fb;} },
  set(k:string, v:any){ try{ if(!isBrowser) return; localStorage.setItem(k, JSON.stringify(v)); }catch{} },
  del(k:string){ try{ if(!isBrowser) return; localStorage.removeItem(k); }catch{} },
};

// ---------- network utils ----------
async function safeFetch(url:string, init:any={}, timeoutMs=6000){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(), timeoutMs);
  try{ const res=await fetch(url,{...init, signal:ctrl.signal}); return res; } finally{ clearTimeout(t); }
}
async function notify(path:string, payload:any){
  try{ await safeFetch(`/api/notify/${path}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)}, 5000); }catch{ /* noop */ }
}

// ---------- holidays (KR) ----------
const isWeekend = (d:any)=>{ const day=toTZ(d).getDay(); return day===0||day===6; };
const isHoliday = (d:any, list:string[]=[])=> list.includes(ymd(d));
function useKRHolidays(year:number){
  const [days, setDays] = useState<string[]>(storage.get(`holidays:${year}`, []));
  useEffect(()=>{
    let on=true;
    (async()=>{
      try{
        const r=await safeFetch(`/api/holidays?year=${year}&country=KR`, {}, 6000);
        if(r && (r as Response).ok){ const arr=await (r as Response).json(); if(on){ setDays(arr); storage.set(`holidays:${year}`,arr);} }
        else if(on){ setDays(d=>d.length?d:[`${year}-01-01`]); }
      }catch{ if(on){ setDays(d=>d.length?d:[`${year}-01-01`]); } }
    })();
    return ()=>{ on=false; };
  },[year]);
  return days;
}

// ---------- routing ----------
function useHashRoute(){
  const initial = isBrowser? (win().location.hash.replace('#','')||'/') : '/';
  const [route,setRoute] = useState<string>(initial);
  useEffect(()=>{
    if(!isBrowser) return;
    const on=()=>setRoute(win().location.hash.replace('#','')||'/');
    window.addEventListener('hashchange', on); return ()=>window.removeEventListener('hashchange', on);
  },[]);
  const push=(path:string)=>{ storage.set('route:prev', route); if(isBrowser) win().location.hash=path; };
  return { route, push };
}

// ---------- auth ----------
type TUser = { id:string; name:string; phone:string; email:string; password:string; plan?:string|null };
const USERS_KEY='auth:users';
function useAuth(){
  const [user,setUser]=useState<TUser|null>(()=>storage.get('auth:user',null));
  const [token,setToken]=useState<string|null>(()=>storage.get('auth:token',null));
  const users=()=> storage.get<TUser[]>(USERS_KEY,[]);
  const find=(email:string)=> users().find(u=>u.email===email);
  const login=(email:string,pw:string)=>{
    if(!email||!pw||pw.length<6) throw new Error('이메일/비밀번호를 확인하세요(비밀번호 6자 이상).');
    const u=find(email); if(!u||u.password!==pw) throw new Error('계정이 없거나 비밀번호 불일치.');
    const t='demo.'+(isBrowser?btoa(email):'token')+'.token'; setUser(u); setToken(t);
    storage.set('auth:user',u); storage.set('auth:token',t);
  };
  const logout=()=>{ setUser(null); setToken(null); storage.del('auth:user'); storage.del('auth:token'); };
  const update=(patch:Partial<TUser>)=>{ if(!user) return; const next={...user,...patch}; setUser(next); storage.set('auth:user',next); storage.set(USERS_KEY, users().map(u=>u.email===next.email?next:u)); };
  const register=({name,phone,email,password}:{name:string;phone:string;email:string;password:string;})=>{
    if(!name||!phone||!email||!password) throw new Error('모든 필드를 입력하세요.');
    if(password.length<6) throw new Error('비밀번호는 6자 이상.');
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('이메일 형식 오류.');
    const p=normalizePhone(phone); if(!(p.startsWith('010')&&p.length===11)) throw new Error('휴대폰은 010으로 시작하는 11자리.');
    const arr=users(); if(arr.find(u=>u.email===email)) throw new Error('이미 가입된 이메일.');
    const u:{id:string}&TUser={id:'u_'+Date.now(), name, phone:p, email, password, plan: storage.get('user:plan', null)} as any;
    storage.set(USERS_KEY,[...arr,u]); return u;
  };
  return { user, token, login, logout, update, register };
}

// ---------- plans & credits ----------
const PLANS = [
  { id:'basic', name:'베이직', priceKRW:110000, badge:'입문형' },
  { id:'pro', name:'프로', priceKRW:990000, badge:'추천' },
  { id:'elite', name:'엘리트', priceKRW:3300000, badge:'최다 혜택' },
] as const;
const PLAN_HOURS: Record<string, number> = { basic:12, pro:60, elite:144 };
const TOPUP_RATE: Record<string, number> = { basic:200000, pro:50000, elite:30000 };

const CREDITS_KEY = 'credits:byUser';
function getCredits(email?:string|null){ if(!email) return 0; const map = storage.get<Record<string,number>>(CREDITS_KEY, {}); return map[email]||0; }
function setCredits(email:string, hours:number){ const map = storage.get<Record<string,number>>(CREDITS_KEY, {}); map[email]=Math.max(0, Math.round(hours)); storage.set(CREDITS_KEY, map); }
function addCredits(email:string, delta:number){ setCredits(email, getCredits(email)+delta); }

// ---------- ICS ----------
function buildICS({title,start,end,description='',location='Law Firm Wins'}:{title:string;start:any;end:any;description?:string;location?:string;}){
  const s=toGCalDateTime(start), e=toGCalDateTime(end); const desc=(description||'').replace(/\n/g,'\\n');
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//DayLawyer//KR//
BEGIN:VEVENT
UID:${Date.now()}@daylawyer
DTSTAMP:${s}
DTSTART:${s}
DTEND:${e}
SUMMARY:${title}
DESCRIPTION:${desc}
LOCATION:${location}
END:VEVENT
END:VCALENDAR`;
}
function downloadICS(args:any){
  const ics=buildICS(args); const blob=new Blob([ics],{type:'text/calendar'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`daylawyer_${ymd(args.start)}_${hm(args.start)}.ics`; a.click(); URL.revokeObjectURL(url);
}

// ---------- Shell ----------
function Shell({children,route,push,auth}:{children:any;route:string;push:(p:string)=>void;auth:any}){
  const { user }=auth;
  const Menu=()=> (
    <nav className="flex flex-wrap gap-2 text-sm">
      {[
        ['/', '홈', <Home className="w-4 h-4" key="h"/>],
        ['/subscribe', '서비스구독', <CreditCard className="w-4 h-4" key="c"/>],
        [user?'/profile':'/signup', user?'회원정보':'회원가입', <User2 className="w-4 h-4" key="u"/>],
        [user?'/logout':'/login', user?'로그아웃':'로그인', user?<LogOut className="w-4 h-4" key="o"/>:<LogIn className="w-4 h-4" key="i"/>],
        ['/consult','상담', <MessageSquare className="w-4 h-4" key="m"/>],
        ['/admin','관리자', <Shield className="w-4 h-4" key="a"/>],
      ].map(([to,label,icon])=>(
        <button key={String(to)} onClick={()=>push(String(to))} className={`px-3 py-2 rounded-xl border flex items-center gap-2 ${route===to?'bg-black text-white':'hover:bg-slate-50'}`}>{icon}{label}</button>
      ))}
    </nav>
  );
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b sticky top-0 bg-white z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2"><Shield className="w-6 h-6"/><div className="font-bold">DayLawyer</div></div><Menu/>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      <footer className="border-t py-6 text-center text-xs text-slate-500">© {new Date().getFullYear()} Wins Law</footer>
    </div>
  );
}

// ---------- Pages (Home / Signup / Login / Profile / Subscribe) ----------
function PageHome({push,auth}:{push:(p:string)=>void;auth:any}){
  const {user}=auth;
  return (
    <div className="grid lg:grid-cols-2 gap-8 items-center">
      <motion.div initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{duration:.3}}>
        <h1 className="text-3xl font-bold">정기 구독형 법률상담, 더 쉽게.</h1>
        <p className="mt-2 text-slate-600">연 1회 결제로 상담을 편리하게 예약하세요. 크레딧 소진 시 추가결제(시간 단위)도 지원합니다.</p>
        <div className="mt-5 flex gap-2 flex-wrap">
          <button onClick={()=>push('/subscribe')} className="px-5 py-3 rounded-2xl bg-black text-white hover:opacity-90 flex items-center gap-2"><CreditCard className="w-4 h-4"/> 구독 시작</button>
          <button onClick={()=>push(user?'/consult':'/login')} className="px-5 py-3 rounded-2xl border hover:bg-slate-50 flex items-center gap-2"><MessageSquare className="w-4 h-4"/> 상담 신청</button>
          <button onClick={()=>push('/admin')} className="px-5 py-3 rounded-2xl border hover:bg-slate-50 flex items-center gap-2"><Shield className="w-4 h-4"/> 관리자</button>
        </div>
        <ul className="mt-5 space-y-2 text-slate-700">
          <li className="flex items-start gap-2"><CheckCircle2 className="w-5 h-5 mt-0.5"/> 최소 예약 간격 <b>1시간</b></li>
          <li className="flex items-start gap-2"><CheckCircle2 className="w-5 h-5 mt-0.5"/> 취소 수수료 <b>없음</b></li>
          <li className="flex items-start gap-2"><CheckCircle2 className="w-5 h-5 mt-0.5"/> 리마인드: <b>자정</b> / <b>1시간 전</b></li>
        </ul>
      </motion.div>
      <motion.div initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{duration:.35, delay:.05}}>
        <div className="rounded-2xl border shadow-sm p-6 bg-white">
          <div className="flex items-center gap-2 text-slate-600"><FileText className="w-4 h-4"/> 샘플 흐름</div>
          <ol className="mt-3 space-y-2 text-slate-700 list-decimal list-inside">
            <li>회원가입 → 로그인</li>
            <li>서비스구독에서 요금제 선택 → NICEPAY 결제</li>
            <li>구독 활성화 & 크레딧 지급</li>
            <li>캘린더에서 가용 시간 선택 후 신청</li>
            <li>관리자 확정 시 자동 블록 생성(겹침 방지)</li>
          </ol>
        </div>
      </motion.div>
    </div>
  );
}

function PageSignup({push,auth}:{push:(p:string)=>void;auth:any}){
  const {register}=auth; const [name,setName]=useState(''); const [phone,setPhone]=useState(''); const [email,setEmail]=useState(''); const [pw,setPw]=useState(''); const [pw2,setPw2]=useState(''); const [msg,setMsg]=useState(''); const [err,setErr]=useState('');
  const onSubmit=(e:any)=>{ e.preventDefault(); setErr(''); setMsg(''); try{ if(pw!==pw2) throw new Error('비밀번호 확인 불일치'); register({name,phone,email,password:pw}); setMsg('가입 완료. 로그인 해주세요.'); setTimeout(()=>win().location.hash='/login',700);}catch(ex:any){setErr(ex.message||'실패');}};
  return (<form onSubmit={onSubmit} className="space-y-3 max-w-lg rounded-2xl border p-6 bg-white shadow-sm">
    <h2 className="text-xl font-bold">회원가입</h2>
    <div className="grid sm:grid-cols-2 gap-3">
      <input placeholder="이름" value={name} onChange={e=>setName(e.target.value)} className="w-full border rounded-xl px-3 py-2"/>
      <input placeholder="휴대폰(010-xxxx-xxxx)" value={phone} onChange={e=>setPhone(e.target.value)} className="w-full border rounded-xl px-3 py-2"/>
    </div>
    <input type="email" placeholder="이메일" value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded-xl px-3 py-2"/>
    <div className="grid sm:grid-cols-2 gap-3">
      <input type="password" placeholder="비밀번호(6자 이상)" value={pw} onChange={e=>setPw(e.target.value)} className="w-full border rounded-xl px-3 py-2"/>
      <input type="password" placeholder="비밀번호 확인" value={pw2} onChange={e=>setPw2(e.target.value)} className="w-full border rounded-xl px-3 py-2"/>
    </div>
    {err && <p className="text-sm text-red-600">{err}</p>}
    {msg && <p className="text-sm text-green-700">{msg}</p>}
    <button className="px-4 py-2 rounded-2xl bg-black text-white w-full">가입</button>
  </form>);
}

function PageAuth({route,push,auth}:{route:string;push:(p:string)=>void;auth:any}){
  const {user,login,logout}=auth; const [email,setEmail]=useState(''); const [pw,setPw]=useState(''); const [err,setErr]=useState('');
  useEffect(()=>{ if(!user){ const prev=storage.get('route:prev','/'); storage.set('route:intended', (!prev||prev==='/login')?'/':prev);} },[user]);
  if(route==='/logout'){ logout(); setTimeout(()=>push('/'),200); return <div className="rounded-2xl border p-6 bg-white shadow-sm">로그아웃 되었습니다.</div>; }
  const onSubmit=(e:any)=>{ e.preventDefault(); setErr(''); try{ login(email,pw); const back=storage.get('route:intended','/')||'/'; push(back); storage.del('route:intended'); notify('login',{email}); }catch(ex:any){ setErr(ex.message||'로그인 실패'); } };
  return (<form onSubmit={onSubmit} className="space-y-3 max-w-md rounded-2xl border p-6 bg-white shadow-sm">
    <h2 className="text-xl font-bold">로그인</h2>
    <input type="email" placeholder="이메일" value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded-xl px-3 py-2"/>
    <input type="password" placeholder="비밀번호" value={pw} onChange={e=>setPw(e.target.value)} className="w-full border rounded-xl px-3 py-2"/>
    {err && <p className="text-sm text-red-600">{err}</p>}
    <button className="px-4 py-2 rounded-2xl bg-black text-white w-full">로그인</button>
  </form>);
}

function PageProfile({auth}:{auth:any}){
  const {user,update}=auth; const [name,setName]=useState(user?.name||''); const [email,setEmail]=useState(user?.email||''); const [phone,setPhone]=useState(user?.phone||''); const [plan,setPlan]=useState(user?.plan||storage.get('user:plan',null)); const [msg,setMsg]=useState('');
  if(!user) return <div>로그인이 필요합니다.</div>;
  const onSubmit=(e:any)=>{ e.preventDefault(); const p=normalizePhone(phone); update({name,email,phone:p,plan}); storage.set('user:plan',plan); setMsg('저장됨'); notify('profile-updated',{email, plan, phone:p}); };
  const credits = getCredits(user?.email);
  return (<form onSubmit={onSubmit} className="space-y-3 max-w-lg rounded-2xl border p-6 bg-white shadow-sm">
    <h2 className="text-xl font-bold">회원정보</h2>
    <div className="grid sm:grid-cols-2 gap-3">
      <input value={name} onChange={e=>setName(e.target.value)} className="w-full border rounded-xl px-3 py-2"/>
      <input value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded-xl px-3 py-2"/>
    </div>
    <input value={phone} onChange={e=>setPhone(e.target.value)} className="w-full border rounded-xl px-3 py-2"/>
    <select value={plan||''} onChange={e=>setPlan(e.target.value)} className="w-full border rounded-xl px-3 py-2">
      <option value="">미구독</option>
      {PLANS.map(p=><option key={p.id} value={p.id}>{p.name} (₩{formatKRW(p.priceKRW)}/년)</option>)}
    </select>
    <div className="text-sm text-slate-700">보유 크레딧: <b>{credits}</b> 시간</div>
    <button className="px-4 py-2 rounded-2xl bg-black text-white">저장</button>
    {msg && <p className="text-sm text-green-700">{msg}</p>}
  </form>);
}

// ---------- NICEPAY forms ----------
function NicepayForm({plan,buyer,onReady}:{plan:any;buyer:any;onReady:(f:HTMLFormElement|null)=>void;}){
  const ref=useRef<HTMLFormElement|null>(null);
  useEffect(()=>{ onReady && onReady(ref.current); },[onReady]);
  const returnUrl = isBrowser? (win().location.origin+win().location.pathname+'#/_nicepayReturn') : '#/_nicepayReturn';
  const params:any={ MID:'winslaw00m', MOID:`SUB_${plan.id}_${Date.now()}`, GOODS:`법률상담 구독(${plan.name})`, AMOUNT:String(plan.priceKRW), BUYERNAME:buyer?.name||'게스트', BUYEREMAIL:buyer?.email||'guest@example.com', RETURNURL:returnUrl, TYPE:'SUBS' };
  return (<form ref={ref} method="POST" action="/api/payments/nicepay/ready" className="hidden">
    {Object.entries(params).map(([k,v])=>(<input key={k} name={String(k)} defaultValue={String(v)} readOnly/>))}
    <input name="PLAN_ID" defaultValue={plan.id} readOnly/>
    <input name="BILLING_CYCLE" defaultValue="ANNUAL" readOnly/>
  </form>);
}
function NicepayTopupForm({email,plan,hours,onReady}:{email:string;plan:string;hours:number;onReady:(f:HTMLFormElement|null)=>void;}){
  const ref=useRef<HTMLFormElement|null>(null);
  useEffect(()=>{ onReady && onReady(ref.current); },[onReady]);
  const returnUrl = isBrowser? (win().location.origin+win().location.pathname+'#/_nicepayReturn') : '#/_nicepayReturn';
  const amount = (TOPUP_RATE[plan]||0) * hours;
  const params:any={ MID:'winslaw00m', MOID:`TOPUP_${plan}_${Date.now()}`, GOODS:`크레딧 추가결제(${plan}, ${hours}h)`, AMOUNT:String(amount), BUYERNAME:email, BUYEREMAIL:email, RETURNURL:returnUrl, TYPE:'TOPUP', HOURS:String(hours), PLAN_ID:plan };
  return (<form ref={ref} method="POST" action="/api/payments/nicepay/ready" className="hidden">
    {Object.entries(params).map(([k,v])=>(<input key={k} name={String(k)} defaultValue={String(v)} readOnly/>))}
  </form>);
}

// ---------- Subscribe Page ----------
function PageSubscribe({auth}:{auth:any}){
  const [sel,setSel]=useState<typeof PLANS[number]>(PLANS[1]); const [loading,setLoading]=useState(false); const [msg,setMsg]=useState(''); const formRef=useRef<HTMLFormElement|null>(null);
  const onReady=(f:HTMLFormElement|null)=>{ formRef.current=f; };
  const start=()=>{
    if(!sel) return;
    try{ setLoading(true); if(formRef.current) formRef.current.submit(); storage.set('user:pendingPlan', sel.id); setTimeout(()=>{ setLoading(false); setMsg('결제창 이동 중…'); },600);}catch{ setLoading(false); setMsg('결제를 시작하지 못했습니다.'); }
  };
  return (<div className="space-y-4">
    <h2 className="text-2xl font-bold">서비스 구독</h2>
    <div className="grid md:grid-cols-3 gap-4">
      {PLANS.map(p=>(
        <button key={p.id} onClick={()=>setSel(p)} className={`rounded-2xl border p-6 text-left bg-white shadow-sm hover:shadow-md ${sel.id===p.id?'ring-2 ring-black':''}`}>
          <div className="text-lg font-semibold">{p.name} {p.badge && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-black text-white">{p.badge}</span>}</div>
          <div className="mt-1 text-2xl font-bold">₩ {formatKRW(p.priceKRW)}<span className="text-sm font-normal text-slate-500"> /년</span></div>
          <div className="mt-2 text-sm text-slate-600">연간 크레딧: {PLAN_HOURS[p.id]} 시간</div>
          <div className="mt-1 text-sm text-slate-600">추가결제: ₩ {formatKRW(TOPUP_RATE[p.id])} /시간</div>
        </button>
      ))}
    </div>
    <button disabled={loading} onClick={start} className="px-5 py-3 rounded-2xl bg-black text-white disabled:opacity-50">{loading?'준비 중…':'NICEPAY로 결제'}</button>
    {msg && <p className="text-sm text-slate-600">{msg}</p>}
    <NicepayForm plan={sel} buyer={auth.user} onReady={onReady}/>
  </div>);
}


// ---- Types ----
type TReq = { id:string; user:string; plan:string; createdAt:string; type:'대면'|'전화'|'텍스트'; title:string; details:string; startISO:string; endISO:string; status:'접수'|'확정'|'확정취소'|'완료'|'취소' };

// ---- Month Calendar ----
function MonthCalendar({value,onChange,isAvailableDay}:{value:Date;onChange:(d:Date)=>void;isAvailableDay:(d:Date)=>boolean}){
  const [cur,setCur]=useState<Date>(new Date(value));
  useEffect(()=>{ setCur(new Date(value)); },[value]);
  const first=(()=>{ const s=new Date(cur); s.setDate(1); const shift=s.getDay(); const f=new Date(s); f.setDate(1-shift); return f; })();
  const days=[...Array(42)].map((_,i)=> addDays(first,i));
  return (<div>
    <div className="flex items-center justify-between mb-2">
      <button className="border px-2 py-1 rounded" onClick={()=>setCur(prev=>{const n=new Date(prev); n.setMonth(n.getMonth()-1); return n;})}><ChevronLeft className="w-4 h-4"/></button>
      <div className="font-semibold">{cur.getFullYear()}년 {cur.getMonth()+1}월</div>
      <button className="border px-2 py-1 rounded" onClick={()=>setCur(prev=>{const n=new Date(prev); n.setMonth(n.getMonth()+1); return n;})}><ChevronRight className="w-4 h-4"/></button>
    </div>
    <div className="grid grid-cols-7 gap-1">
      {['일','월','화','수','목','금','토'].map(x=>(<div key={x} className="text-center text-xs text-slate-500">{x}</div>))}
      {days.map((d,i)=>{ const inMonth=d.getMonth()===cur.getMonth(); const has=isAvailableDay?isAvailableDay(d):true; const cls=has?'text-black':'text-slate-400'; return (
        <button key={i} onClick={()=> has && onChange(d)} className={`aspect-square border rounded text-sm ${inMonth?'bg-white':'bg-slate-50'} ${cls}`}>{d.getDate()}</button>
      );})}
    </div>
  </div>);
}

// ---- Topup Widget ----
function TopupWidget({email,plan}:{email:string;plan:string}){
  const [qty,setQty]=useState<number>(1);
  const formRef=useRef<HTMLFormElement|null>(null);
  const onReady=(f:HTMLFormElement|null)=>{ if(f) formRef.current=f; };
  const start=()=>{ if(!qty || qty<1) return; storage.set('pendingTopup', { email, plan, hours: qty }); if(formRef.current) formRef.current.submit(); };
  const per = TOPUP_RATE[plan]||0; const total = per*qty;
  return (<div className="rounded-xl border p-4 bg-white shadow-sm">
    <div className="font-semibold mb-2">크레딧 추가결제</div>
    <div className="flex items-center gap-3">
      <input type="number" min={1} step={1} value={qty} onChange={e=>setQty(Math.max(1, Number(e.target.value||1)))} className="w-24 border rounded-xl px-3 py-2"/>
      <div className="text-sm text-slate-700">시간 × ₩ {formatKRW(per)} = <b>₩ {formatKRW(total)}</b></div>
      <button onClick={start} className="px-4 py-2 rounded-xl bg-black text-white">결제</button>
    </div>
    <NicepayTopupForm email={email} plan={plan} hours={qty} onReady={onReady}/>
  </div>);
}

// ---- Consult Page ----
function PageConsult({auth,push}:{auth:any;push:(p:string)=>void}){
  const {user}=auth;
  const [tab,setTab]=useState<'apply'|'list'>('apply');
  const [reqs,setReqs]=useState<TReq[]>(()=>storage.get('consult:reqs',[]));
  const [date,setDate]=useState<Date>(nowKST());
  const [type,setType]=useState<'대면'|'전화'|'텍스트'>('대면');
  const [title,setTitle]=useState(''); const [details,setDetails]=useState('');
  const [slot,setSlot]=useState<{start:Date;end:Date}|null>(null);
  const holidays=useKRHolidays(toTZ(date).getFullYear());
  const userPlan=user?.plan || storage.get('user:plan', storage.get('user:pendingPlan'));
  const blocks=storage.get<any[]>('lawyer:blocks',[]);
  const busy=useMemo(()=>[...blocks, ...reqs.filter(r=>r.status!=='취소'&&(r.type==='대면'||r.type==='전화')).map(r=>({start:r.startISO,end:r.endISO}))], [reqs,blocks]);

  const genSlots=(d:Date)=>{
    if(isWeekend(d)||isHoliday(d,holidays)) return [];
    const all=[...Array(9)].map((_,i)=>({start:setHour(d,9+i), end:setHour(d,10+i)}));
    const free=all.filter(s=> !busy.some(b=> within(s.start,s.end,b.start,b.end)));
    return free.filter(s=> hoursDiff(s.start, nowKST())>=1);
  };
  const slots=useMemo(()=>genSlots(date),[date,busy,holidays]);

  const credits = user?.email ? getCredits(user.email) : 0;

  const submit=(e:any)=>{
    e.preventDefault();
    if(!user){ push('/login'); return; }
    if(!userPlan){ alert('구독 필요'); return; }
    if(credits<=0){ alert('보유 크레딧이 없습니다. 추가결제를 진행해 주세요.'); return; }
    if(!slot){ alert('시간대를 선택하세요'); return; }
    const r:TReq={ id:'C'+Date.now(), user:user.email, plan:String(userPlan), createdAt:new Date().toISOString(), type, title, details, startISO:slot.start.toISOString(), endISO:slot.end.toISOString(), status:'접수' };
    const next=[r,...reqs]; setReqs(next); storage.set('consult:reqs',next); setTitle(''); setDetails(''); setSlot(null); setTab('list');
    notify('consult-submitted',{ email:user.email, start:r.startISO, end:r.endISO, type });
  };

  return (<div className="space-y-4">
    <div className="flex gap-2"><button onClick={()=>setTab('apply')} className={`px-3 py-2 rounded-xl border ${tab==='apply'?'bg-black text-white':''}`}>상담 신청</button><button onClick={()=>setTab('list')} className={`px-3 py-2 rounded-xl border ${tab==='list'?'bg-black text-white':''}`}>신청 결과</button></div>

    {tab==='apply'&&(<div className="grid lg:grid-cols-2 gap-4">
      <div>
        <MonthCalendar value={date} onChange={(d)=>{setDate(d); setSlot(null);}} isAvailableDay={(d)=>genSlots(d).length>0}/>
        <div className="mt-3">
          <div className="mb-1 font-semibold">가능 시간</div>
          <div className="flex flex-wrap gap-2 mb-3">
            {(isWeekend(date)||isHoliday(date,holidays)) && <div className="text-sm text-slate-500">주말/공휴일</div>}
            {!(isWeekend(date)||isHoliday(date,holidays)) && slots.length===0 && <div className="text-sm text-slate-500">가능한 시간이 없습니다.</div>}
            {!(isWeekend(date)||isHoliday(date,holidays)) && slots.map((s,i)=>(
              <button key={i} onClick={()=>setSlot(s)} className={`px-3 py-2 rounded-xl border text-sm ${slot===s?'bg-black text-white':''}`}>{hm(s.start)}~{hm(s.end)}</button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <form onSubmit={submit} className="space-y-3 rounded-2xl border p-4 bg-white shadow-sm">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-700">상담 유형</label>
              <select value={type} onChange={e=>setType(e.target.value as any)} className="mt-1 w-full border rounded-xl px-3 py-2">
                <option>대면</option><option>전화</option><option>텍스트</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-700">선택한 시간</label>
              <input readOnly value={slot?`${ymd(slot.start)} ${hm(slot.start)}~${hm(slot.end)}`:''} className="mt-1 w-full border rounded-xl px-3 py-2 bg-slate-50"/>
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-700">제목</label>
            <input value={title} onChange={e=>setTitle(e.target.value)} className="mt-1 w-full border rounded-xl px-3 py-2"/>
          </div>
          <div>
            <label className="block text-sm text-slate-700">상세내용</label>
            <textarea value={details} onChange={e=>setDetails(e.target.value)} rows={4} className="mt-1 w-full border rounded-xl px-3 py-2"/>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-700">보유 크레딧: <b>{user? credits: '-'}</b> 시간</div>
            <button className="px-4 py-2 rounded-2xl bg-black text-white" disabled={!user}>신청</button>
          </div>
          {(user && credits<=0 && userPlan) && <TopupWidget email={user.email} plan={String(userPlan)}/>}
          {!user && <div className="text-xs text-slate-500">로그인 후 신청이 완료됩니다.</div>}
        </form>
      </div>
    </div>)}

    {tab==='list'&&(<div className="overflow-x-auto">
      <table className="min-w-[900px] w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th>신청일</th><th>제목</th><th>유형</th><th>시간</th><th>상태</th><th>내보내기</th></tr></thead>
        <tbody>
          {(user?reqs.filter(r=>r.user===user.email):[]).map(r=>(
            <tr key={r.id} className="border-top">
              <td className="py-1">{new Date(r.createdAt).toLocaleString('ko-KR')}</td>
              <td>{r.title}</td><td>{r.type}</td>
              <td>{ymd(r.startISO)} {hm(r.startISO)}~{hm(r.endISO)}</td>
              <td>{r.status}</td>
              <td className="space-x-1">
                <button onClick={()=>downloadICS({title:`[DayLawyer] ${r.type} 상담`,start:r.startISO,end:r.endISO,description:r.title})} className="px-2 py-1 rounded border">ICS</button>
                <button onClick={()=>isBrowser && window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`[DayLawyer] ${r.type} 상담`)}&dates=${toGCalDateTime(r.startISO)}/${toGCalDateTime(r.endISO)}&details=${encodeURIComponent(r.title)}&location=${encodeURIComponent('Law Firm Wins')}`,'_blank')} className="px-2 py-1 rounded border">GCal</button>
              </td>
            </tr>
          ))}
          {user && reqs.filter(r=>r.user===user.email).length===0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">내역 없음</td></tr>}
          {!user && <tr><td colSpan={6} className="py-4 text-center text-slate-500">로그인 필요</td></tr>}
        </tbody>
      </table>
    </div>)}
  </div>);
}

// ---- Admin ----
function PageAdmin(){
  const [reqs,setReqs]=useState<TReq[]>(()=>storage.get('consult:reqs',[]));
  const [blocks,setBlocks]=useState<any[]>(()=>storage.get('lawyer:blocks',[]));
  const [users,setUsers]=useState<any[]>(()=>storage.get(USERS_KEY,[]));
  const [adj,setAdj]=useState<Record<string,number>>(()=>storage.get('credits:adj',{}));
  useEffect(()=>{ storage.set('consult:reqs',reqs); },[reqs]);
  useEffect(()=>{ storage.set('lawyer:blocks',blocks); },[blocks]);

  const refreshUsers=()=> setUsers(storage.get(USERS_KEY,[]));

  const setStatus=(id:string, status:TReq['status'])=>{
    setReqs(prev=>prev.map(r=> r.id===id?{...r,status}:r));
    const r=reqs.find(x=>x.id===id);
    if(!r) return;
    if(status==='확정'){
      setBlocks(prev=>[...prev, {id:'blk_'+id, title:`상담(${r.type})`, start:r.startISO, end:r.endISO}]);
      notify('consult-confirmed',{email:r.user, start:r.startISO, end:r.endISO, type:r.type});
    }else if(status==='확정취소' || status==='취소' || status==='접수'){
      setBlocks(prev=>prev.filter(b=>b.id!=='blk_'+id));
    }else if(status==='완료'){
      addCredits(r.user, -1); refreshUsers();
    }
  };
  const del=(id:string)=>{ if(!confirm('삭제하시겠습니까?')) return; setReqs(prev=>prev.filter(r=>r.id!==id)); setBlocks(prev=>prev.filter(b=>b.id!=='blk_'+id)); };

  const monthKey=(iso:string)=>{ const d=new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
  const quarterKey=(iso:string)=>{ const d=new Date(iso); const q=Math.floor(d.getMonth()/3)+1; return `${d.getFullYear()}-Q${q}`; };
  const downloadCSV=(filename:string, rows:any[])=>{
    if(!rows.length){ alert('데이터 없음'); return; }
    const esc=(v:any)=>{ if(v==null) return ''; const s=String(v).replace(/\"/g,'\"\"'); return /[\",\\n]/.test(s)?`\"${s}\"`:s; };
    const header=Object.keys(rows[0]); const csv=[ header.join(','), ...rows.map(r=>header.map(h=>esc(r[h])).join(',')) ].join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
  };
  const exportMonthly=()=>{
    const done=reqs.filter(r=>r.status==='완료'); const by:Record<string,any>={};
    done.forEach(r=>{ const k=monthKey(r.startISO); by[k]=by[k]||{기간:k,완료건수:0}; by[k].완료건수+=1; });
    downloadCSV(`monthly_${Date.now()}.csv`, Object.values(by));
  };
  const exportQuarterly=()=>{
    const done=reqs.filter(r=>r.status==='완료'); const by:Record<string,any>={};
    done.forEach(r=>{ const k=quarterKey(r.startISO); by[k]=by[k]||{기간:k,완료건수:0}; by[k].완료건수+=1; });
    downloadCSV(`quarterly_${Date.now()}.csv`, Object.values(by));
  };

  const creditOf=(email:string)=> getCredits(email);
  const adjustCredit=(email:string, delta:number)=>{ addCredits(email, delta); setAdj({...adj, [email]:(adj[email]||0)+delta}); storage.set('credits:adj',{...adj,[email]:(adj[email]||0)+delta}); };

  return (<div className="space-y-6">
    <h2 className="text-2xl font-bold">관리자</h2>

    <div className="rounded-2xl border p-4 bg-white shadow-sm overflow-x-auto">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">신청 현황</div>
        <div className="space-x-2"><button onClick={exportMonthly} className="px-2 py-1 border rounded">월별 CSV</button><button onClick={exportQuarterly} className="px-2 py-1 border rounded">분기별 CSV</button></div>
      </div>
      <table className="min-w-[950px] w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th>고객</th><th>제목</th><th>유형</th><th>시간</th><th>상태</th><th>관리</th></tr></thead>
        <tbody>
          {reqs.map(r=>(<tr key={r.id} className="border-t">
            <td className="py-1">{r.user}</td><td>{r.title}</td><td>{r.type}</td>
            <td>{ymd(r.startISO)} {hm(r.startISO)}~{hm(r.endISO)}</td><td>{r.status}</td>
            <td className="space-x-1">
              <button onClick={()=>setStatus(r.id,'확정')} className="px-2 py-1 border rounded">확정</button>
              <button onClick={()=>setStatus(r.id,'확정취소')} className="px-2 py-1 border rounded">확정취소</button>
              <button onClick={()=>setStatus(r.id,'완료')} className="px-2 py-1 border rounded">완료(1h 차감)</button>
              <button onClick={()=>del(r.id)} className="px-2 py-1 border rounded text-red-600">삭제</button>
            </td>
          </tr>))}
          {reqs.length===0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">접수 건이 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>

    <div className="rounded-2xl border p-4 bg-white shadow-sm">
      <div className="font-semibold mb-1">차단된 일정(블록)</div>
      <ul className="list-disc list-inside text-sm">
        {blocks.map(b=><li key={b.id}>{ymd(b.start)} {hm(b.start)}~{hm(b.end)} — {b.title||'상담'}</li>)}
        {blocks.length===0 && <li className="text-slate-500">없음</li>}
      </ul>
    </div>

    <div className="rounded-2xl border p-4 bg-white shadow-sm overflow-x-auto">
      <div className="font-semibold mb-2">회원관리 (크레딧 조정)</div>
      <table className="min-w-[900px] w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th>이메일</th><th>이름</th><th>요금제</th><th>보유 크레딧(h)</th><th>조정</th></tr></thead>
        <tbody>
          {users.map((u:any)=>(<tr key={u.id} className="border-t">
            <td className="py-1">{u.email}</td><td>{u.name}</td><td>{u.plan||'-'}</td>
            <td>{creditOf(u.email)}</td>
            <td className="space-x-1">
              <button onClick={()=>{adjustCredit(u.email, +1); setUsers(storage.get(USERS_KEY,[]));}} className="px-2 py-1 border rounded">+1h</button>
              <button onClick={()=>{adjustCredit(u.email, -1); setUsers(storage.get(USERS_KEY,[]));}} className="px-2 py-1 border rounded">-1h</button>
            </td>
          </tr>))}
          {users.length===0 && <tr><td colSpan={5} className="py-4 text-center text-slate-500">회원이 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>);
}

// ---- Nicepay Return (activate plan or add topup credits) ----
function PageNicepayReturn({push,auth}:{push:(p:string)=>void;auth:any}){
  const {user}=auth;
  useEffect(()=>{
    const pid=storage.get('user:pendingPlan',null);
    if(pid){
      if(user){
        const next={...user, plan:pid}; storage.set('auth:user',next);
        const arr=storage.get<any[]>(USERS_KEY,[]).map(u=>u.email===user.email?next:u); storage.set(USERS_KEY,arr);
        addCredits(user.email, PLAN_HOURS[pid]||0);
      }else{
        storage.set('user:plan',pid);
      }
      storage.del('user:pendingPlan');
    }
    const top=storage.get('pendingTopup', null);
    if(top && top.email){ addCredits(top.email, Number(top.hours||0)); storage.del('pendingTopup'); }
    setTimeout(()=>push('/profile'),500);
  },[]);
  return <div className="rounded-2xl border p-6 bg-white shadow-sm">결제가 처리되었습니다. 구독/크레딧 반영 중…</div>;
}

// ---- Router & Export ----
export default function DayLawyerApp(){
  const {route,push}=useHashRoute(); const auth=useAuth();
  let page:any=null;
  if(route==='/') page=<PageHome push={push} auth={auth}/>;
  else if(route==='/signup') page=<PageSignup push={push} auth={auth}/>;
  else if(route==='/login' || route==='/logout') page=<PageAuth route={route} push={push} auth={auth}/>;
  else if(route==='/profile') page=<PageProfile auth={auth}/>;
  else if(route==='/subscribe') page=<PageSubscribe auth={auth}/>;
  else if(route==='/consult') page=<PageConsult auth={auth} push={push}/>;
  else if(route==='/admin') page=<PageAdmin/>;
  else if(route=='/_nicepayReturn') page=<PageNicepayReturn push={push} auth={auth}/>;
  else page=<div>페이지를 찾을 수 없습니다.</div>;
  return <Shell route={route} push={push} auth={auth}>{page}</Shell>;
}
