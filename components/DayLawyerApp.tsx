// ---------- DayLawyer (Part 2/2) ----------
'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalIcon } from 'lucide-react';
import {
  Shell, useHashRoute, useAuth, PageHome, PageSignup, PageAuth, PageProfile, PageSubscribe,
  isBrowser, win, ymd, hm, nowKST, setHour, addDays, within, hoursDiff, toGCalDateTime,
  isWeekend, isHoliday, useKRHolidays, buildICS, downloadICS, formatKRW,
  PLANS, PLAN_HOURS, TOPUP_RATE, storage, USERS_KEY, getCredits, setCredits, addCredits,
  NicepayTopupForm, notify
} from './daylawyer_part1'; // If bundler complains, concatenate files instead.

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
