// Demo backend: an in-browser stand-in for the Supabase client the map uses.
// No network. State lives in localStorage; «Сбросить демо» clears it. All people and bookings are fictional.
(function(){
'use strict';
const DEMO_URL='https://demo.invalid';
const STORE_KEY='qm-demo-state-v1',AUTH_KEY='qm-demo-signed-out';
const params=new URLSearchParams(window.location.search);
const MODE=params.get('as')==='admin'?'admin':'teacher';
const demo=JSON.parse(document.getElementById('demo-data').textContent);
const STAFF=demo.staff; // [{id,email,name,role}]
const ME=STAFF.find(person=>person.id===(MODE==='admin'?demo.adminId:demo.teacherId));
const PURPOSES=['Консультация по математике','Дополнительный урок','Подготовка к олимпиаде','Родительское собрание','Пробный экзамен','Репетиция выступления','Проектная работа','Клуб робототехники','Встреча кафедры','Индивидуальное занятие','Защита проектов','Пересдача','Методобъединение','Занятие с малой группой','Научный клуб'];
const BLOCKED=new Set(['f1-gym','f2-213','f2-214']);
const delay=(ms=90)=>new Promise(resolve=>setTimeout(resolve,ms));
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const nowIso=()=>new Date().toISOString();
function todayIso(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function addDays(iso,days){const d=new Date(`${iso}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function weekday(iso){return new Date(`${iso}T00:00:00Z`).getUTCDay();} // 0 = Sunday
function mulberry(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const minutes=t=>{const [h,m]=String(t).slice(0,5).split(':').map(Number);return h*60+m;};
const overlaps=(a,b,c,d)=>minutes(a)<minutes(d)&&minutes(c)<minutes(b);

// ---------- State ----------
let db=null;
function save(){try{localStorage.setItem(STORE_KEY,JSON.stringify(db));}catch(_e){}}
function load(){
 if(db)return db;
 try{const raw=localStorage.getItem(STORE_KEY);if(raw){const value=JSON.parse(raw);if(value&&value.v===1&&value.seedWeek===seedWeek()){db=value;return db;}}}catch(_e){}
 db=seed();save();return db;
}
function seedWeek(){const t=todayIso(),wd=weekday(t);return addDays(t,-((wd+6)%7));}
function bookableRooms(){
 const rooms=new Map();
 for(const floor of Object.values(D.floors))for(const room of floor.rooms)if(!BLOCKED.has(room.room_id)&&room.room_id!=='assembly-hall')rooms.set(room.room_id,room);
 return [...rooms.keys()];
}
function seed(){
 const monday=seedWeek(),today=todayIso(),random=mulberry(Number(monday.replace(/-/g,'')));
 const pick=list=>list[Math.floor(random()*list.length)];
 const rooms=bookableRooms(),bells=D.bells.secondary,others=STAFF.filter(p=>p.id!==demo.teacherId&&p.id!==demo.adminId);
 const state={v:1,seedWeek:monday,nextId:1001,nextAudit:1,bookings:[],audit:[],allowlist:[],adjustments:[],evacuation:[]};
 const place=(date,owner,count,preferToday)=>{
  for(let attempt=0,made=0;attempt<400&&made<count;attempt++){
   const room=pick(rooms),first=1+Math.floor(random()*9),length=random()<.7?1:2,last=Math.min(10,first+length-1);
   const starts_at=bells[first][0],ends_at=bells[last][1],payload={room_id:room,booking_date:date,starts_at,ends_at};
   if(typeof fixedConflict==='function'&&fixedConflict(payload))continue;
   if(state.bookings.some(b=>b.room_id===room&&b.booking_date===date&&overlaps(starts_at,ends_at,b.starts_at,b.ends_at)))continue;
   if(preferToday&&state.bookings.some(b=>b.created_by===owner.id&&b.booking_date===date&&overlaps(starts_at,ends_at,b.starts_at,b.ends_at)))continue;
   const created=new Date(Date.parse(`${date}T03:00:00Z`)-Math.floor(random()*5+1)*86400000).toISOString();
   const row={id:state.nextId++,room_id:room,booking_date:date,starts_at,ends_at,grade_band:'secondary',period_start:first,period_end:last,purpose:pick(PURPOSES),created_by:owner.id,created_by_name:owner.name,owner_email:owner.email,created_at:created,updated_at:created,sync_version:1};
   state.bookings.push(row);state.audit.push({id:state.nextAudit++,occurred_at:created,booking_id:row.id,action:'insert',actor_id:owner.id,actor_email:owner.email,actor_name:owner.name,old_booking:null,new_booking:clone(row)});
   made++;
  }
 };
 for(let i=-7;i<=20;i++){
  const date=addDays(monday,i),wd=weekday(date);if(wd===0||wd===6)continue;
  const near=Math.abs(Date.parse(date)-Date.parse(today))<=3*86400000;
  for(let k=0;k<(near?22:12);k++)place(date,pick(others),1);
 }
 // The demo teacher's own bookings: today and the next school days, so editing and deleting are one tap away.
 let own=0;for(let i=0;i<10&&own<3;i++){const date=addDays(today,i),wd=weekday(date);if(wd===0||wd===6)continue;const before=state.bookings.length;place(date,STAFF.find(p=>p.id===demo.teacherId),1,true);if(state.bookings.length>before)own++;}
 state.audit.sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at)).forEach((row,index)=>{row.id=index+1;});state.nextAudit=state.audit.length+1;
 return state;
}

// ---------- Auth ----------
let signedOut=sessionStorage.getItem(AUTH_KEY)==='1';
const listeners=new Set();
function makeSession(){return signedOut?null:{access_token:`demo-${MODE}-token`,token_type:'bearer',user:{id:ME.id,email:ME.email,user_metadata:{full_name:ME.name}}};}
let session=makeSession();
function emit(event){session=makeSession();for(const cb of listeners)setTimeout(()=>cb(event,session),0);}
const uid=()=>session?.user?.id||null;
const person=id=>STAFF.find(p=>p.id===id);
const isSuper=id=>id===demo.adminId;
const isAdminUser=id=>isSuper(id)||person(id)?.role==='admin';

// ---------- Tables ----------
function profiles(){return STAFF.map((p,index)=>{const override=load().allowlist.find(a=>a.email===p.email);return {user_id:p.id,email:p.email,display_name:override?.display_name||p.name,role:override?.role||p.role,approved:override?override.approved:true,weekly_booking_limit:override?override.weekly_booking_limit:null,last_seen_at:new Date(Date.now()-index*5400000).toISOString(),created_at:'2026-09-01T03:00:00Z',updated_at:'2026-09-01T03:00:00Z'};});}
function rowsOf(table){
 const s=load();
 switch(table){
  case 'room_bookings':return s.bookings;
  case 'booking_audit_log':return isSuper(uid())?s.audit:[];
  case 'map_profiles':return session?profiles().filter(p=>isSuper(uid())||p.user_id===uid()):[];
  case 'map_superadmins':return [{user_id:demo.adminId}];
  case 'map_staff_allowlist':return s.allowlist;
  case 'map_adjustments':return s.adjustments.filter(a=>a.published||isSuper(uid()));
  case 'map_evacuation':return s.evacuation.filter(e=>e.published||isSuper(uid()));
  case 'assessment_bookings':case 'assessment_cohorts':return [];
  default:return [];
 }
}
const err=(message,code='DEMO')=>({data:null,error:{message,code}});
function bookingError(payload,ignoreId){
 const s=load();
 if(!payload.room_id||!payload.booking_date||!payload.starts_at||!payload.ends_at||minutes(payload.ends_at)<=minutes(payload.starts_at))return err('Invalid booking','22023');
 if(BLOCKED.has(payload.room_id)&&!isSuper(uid()))return err('Room is not bookable','42501');
 if(s.bookings.some(b=>String(b.id)!==String(ignoreId)&&b.room_id===payload.room_id&&b.booking_date===payload.booking_date&&overlaps(payload.starts_at,payload.ends_at,b.starts_at,b.ends_at)))return err('conflicting key value violates exclusion constraint "room_bookings_no_overlap"','23P01');
 return null;
}
function audit(action,before,after){const s=load(),me=person(uid());s.audit.push({id:s.nextAudit++,occurred_at:nowIso(),booking_id:(after||before).id,action,actor_id:me.id,actor_email:me.email,actor_name:me.name,old_booking:clone(before),new_booking:clone(after)});}
const BOOKING_FIELDS=['room_id','booking_date','starts_at','ends_at','grade_band','period_start','period_end','purpose'];
function writeBookings(op,payload,matches){
 const s=load(),me=person(uid());if(!me)return err('Not signed in','42501');
 if(op==='insert'){
  const list=Array.isArray(payload)?payload:[payload];
  for(const item of list){const problem=bookingError(item,null);if(problem)return problem;}
  const rows=list.map(item=>{const row={id:s.nextId++,...Object.fromEntries(BOOKING_FIELDS.map(f=>[f,item[f]??null])),created_by:me.id,created_by_name:me.name,owner_email:me.email,created_at:nowIso(),updated_at:nowIso(),sync_version:1};s.bookings.push(row);audit('insert',null,row);return row;});
  save();return {data:clone(rows),error:null};
 }
 const targets=s.bookings.filter(matches);
 for(const row of targets)if(row.created_by!==me.id&&!isAdminUser(me.id))return err('permission denied for table room_bookings','42501');
 if(op==='update'){
  for(const row of targets){const next={...row,...Object.fromEntries(BOOKING_FIELDS.filter(f=>f in payload).map(f=>[f,payload[f]]))};const problem=bookingError(next,row.id);if(problem)return problem;}
  for(const row of targets){const before=clone(row);Object.assign(row,Object.fromEntries(BOOKING_FIELDS.filter(f=>f in payload).map(f=>[f,payload[f]])),{updated_at:nowIso(),sync_version:(row.sync_version||1)+1});audit('update',before,row);}
 }else if(op==='delete'){
  for(const row of targets)audit('delete',row,null);
  s.bookings=s.bookings.filter(row=>!targets.includes(row));
 }
 save();return {data:clone(targets),error:null};
}
function upsertInto(list,payload,keys){const items=Array.isArray(payload)?payload:[payload];for(const item of items){const index=list.findIndex(row=>keys.every(k=>String(row[k])===String(item[k])));const row={...(index>=0?list[index]:{}),...clone(item),updated_at:nowIso()};if(index>=0)list[index]=row;else list.push({created_at:nowIso(),...row});}}

class Query{
 constructor(table){this.table=table;this.op='select';this.filters=[];this.orders=[];this.limitN=null;this.rangeAB=null;this.mode=null;this.payload=null;this.options={};this.columns=null;}
 select(columns){if(this.op==='select')this.columns=columns;return this;}
 eq(c,v){this.filters.push(r=>String(r[c])===String(v));return this;}
 neq(c,v){this.filters.push(r=>String(r[c])!==String(v));return this;}
 is(c,v){this.filters.push(r=>(r[c]??null)===v);return this;}
 in(c,list){this.filters.push(r=>list.map(String).includes(String(r[c])));return this;}
 gte(c,v){this.filters.push(r=>r[c]>=v);return this;}
 lte(c,v){this.filters.push(r=>r[c]<=v);return this;}
 gt(c,v){this.filters.push(r=>r[c]>v);return this;}
 lt(c,v){this.filters.push(r=>r[c]<v);return this;}
 order(c,{ascending=true}={}){this.orders.push([c,ascending]);return this;}
 limit(n){this.limitN=n;return this;}
 range(a,b){this.rangeAB=[a,b];return this;}
 maybeSingle(){this.mode='maybe';return this;}
 single(){this.mode='single';return this;}
 insert(payload){this.op='insert';this.payload=payload;return this;}
 update(payload){this.op='update';this.payload=payload;return this;}
 upsert(payload,options={}){this.op='upsert';this.payload=payload;this.options=options;return this;}
 delete(){this.op='delete';return this;}
 then(resolve,reject){return delay().then(()=>this.run()).then(resolve,reject);}
 matches(){return row=>this.filters.every(f=>f(row));}
 run(){
  const s=load(),t=this.table;
  if(this.op!=='select'){
   if(!session)return err('JWT required','42501');
   if(t==='room_bookings')return writeBookings(this.op,this.payload,this.matches());
   if(!isSuper(uid()))return err('permission denied','42501');
   if(t==='map_staff_allowlist'){if(this.op==='upsert'||this.op==='insert')upsertInto(s.allowlist,this.payload,['email']);else if(this.op==='delete')s.allowlist=s.allowlist.filter(r=>!this.matches()(r));save();return {data:null,error:null};}
   if(t==='map_adjustments'){if(this.op==='upsert')upsertInto(s.adjustments,this.payload,['floor','target_type','target_id','published']);save();return {data:null,error:null};}
   return err('В демо-версии это действие отключено.');
  }
  let rows=rowsOf(t).filter(this.matches());
  for(const [c,asc] of [...this.orders].reverse())rows=[...rows].sort((a,b)=>(a[c]>b[c]?1:a[c]<b[c]?-1:0)*(asc?1:-1));
  if(this.rangeAB)rows=rows.slice(this.rangeAB[0],this.rangeAB[1]+1);
  if(this.limitN!=null)rows=rows.slice(0,this.limitN);
  rows=clone(rows);
  if(this.mode)return rows.length>1?err('multiple rows'):this.mode==='single'&&!rows.length?err('no rows','PGRST116'):{data:rows[0]||null,error:null};
  return {data:rows,error:null};
 }
}

// ---------- RPC ----------
const SYNC_OK=result=>({data:{v:1,ok:true,result},error:null});
const RPC={
 touch_map_presence:()=>({data:null,error:null}),
 map_active_schedule:()=>({data:null,error:null}),
 map_publish_schedule:()=>err('В демо-версии публикация расписания отключена: предпросмотр импорта работает, запись в базу — нет.'),
 calendar_sync_status_v1:()=>({data:{v:1,availability_usable:true,calendar_state:'disabled',projection_generation:'1'},error:null}),
 calendar_sync_public_busy_v1:()=>({data:{v:1,availability_usable:true,projection_generation:'1',as_of:nowIso(),intervals:[]},error:null}),
 calendar_sync_edit_context_v1:()=>SYNC_OK({write_guard_enabled:false,availability_usable:true,connection_generation:null,record:null}),
 calendar_sync_events_v1:()=>SYNC_OK({events:[],conflicts:[]}),
 map_staff_booking_stats_v2:()=>{const s=load(),today=todayIso();return {data:STAFF.map(p=>({user_id:p.id,total_bookings:s.bookings.filter(b=>b.created_by===p.id).length,upcoming_bookings:s.bookings.filter(b=>b.created_by===p.id&&b.booking_date>=today).length})),error:null};},
 recurring_booking_admin_state:()=>({data:{rules:[],skip_dates:[],today:todayIso()},error:null}),
 publish_map_adjustments:({p_floor})=>{const s=load();const drafts=s.adjustments.filter(a=>Number(a.floor)===Number(p_floor)&&!a.published);for(const d of drafts){s.adjustments=s.adjustments.filter(a=>!(a.published&&a.floor===d.floor&&a.target_type===d.target_type&&a.target_id===d.target_id));d.published=true;}save();return {data:null,error:null};},
 save_map_evacuation_draft:({p_floor,p_plan})=>{const s=load(),floor=Number(p_floor),pub=s.evacuation.find(e=>e.floor===floor&&e.published),draft=s.evacuation.find(e=>e.floor===floor&&!e.published),revision=Math.max(draft?.revision||0,pub?.revision||0)+1;s.evacuation=s.evacuation.filter(e=>e!==draft);s.evacuation.push({floor,published:false,plan:clone(p_plan),revision,updated_at:nowIso()});save();return {data:revision,error:null};},
 publish_map_evacuation:({p_floor})=>{const s=load(),floor=Number(p_floor),draft=s.evacuation.find(e=>e.floor===floor&&!e.published);if(!draft)return err('map_evacuation_stale');s.evacuation=s.evacuation.filter(e=>e.floor!==floor);s.evacuation.push({...draft,published:true,updated_at:nowIso()});save();return {data:null,error:null};},
 discard_map_evacuation_draft:({p_floor})=>{const s=load(),floor=Number(p_floor);s.evacuation=s.evacuation.filter(e=>!(e.floor===floor&&!e.published));save();return {data:null,error:null};}
};
const SUPER_RPC=new Set(['map_staff_booking_stats_v2','recurring_booking_admin_state','publish_map_adjustments','save_map_evacuation_draft','publish_map_evacuation','discard_map_evacuation_draft','map_publish_schedule']);

function createClient(){
 return {
  auth:{
   getSession:async()=>({data:{session},error:null}),
   onAuthStateChange:cb=>{listeners.add(cb);return {data:{subscription:{unsubscribe:()=>listeners.delete(cb)}}};},
   signOut:async()=>{signedOut=true;sessionStorage.setItem(AUTH_KEY,'1');emit('SIGNED_OUT');return {error:null};},
   signInWithOAuth:async()=>{signedOut=false;sessionStorage.removeItem(AUTH_KEY);emit('SIGNED_IN');setTimeout(()=>{const dialog=document.getElementById('auth-dialog');if(dialog?.open)dialog.close();},50);return {data:{},error:null};},
   signInWithOtp:async()=>{signedOut=false;sessionStorage.removeItem(AUTH_KEY);emit('SIGNED_IN');setTimeout(()=>{const dialog=document.getElementById('auth-dialog');if(dialog?.open)dialog.close();},50);return {data:{},error:null};}
  },
  from:table=>new Query(table),
  rpc:async(name,args={})=>{await delay();if(!RPC[name])return err('В демо-версии это действие отключено.');if(SUPER_RPC.has(name)&&!isSuper(uid()))return err('permission denied','42501');return RPC[name](args||{});},
  channel:()=>{const channel={on:()=>channel,subscribe:()=>channel,unsubscribe:()=>{}};return channel;},
  removeChannel:()=>{},
  functions:{invoke:async()=>({data:null,error:null})}
 };
}

// The map asks the auth server which sign-in providers exist; answer locally. Nothing leaves the browser.
const realFetch=window.fetch?.bind(window);
window.fetch=(input,init)=>{
 const url=typeof input==='string'?input:input?.url||'';
 if(url.startsWith(DEMO_URL)){
  const body=url.includes('/auth/v1/settings')?{external:{google:true}}:{error:'В демо-версии это действие отключено.'};
  return Promise.resolve(new Response(JSON.stringify(body),{status:url.includes('/auth/v1/settings')?200:404,headers:{'Content-Type':'application/json'}}));
 }
 return realFetch(input,init);
};

window.supabase={createClient};
window.quantumDemo={
 mode:MODE,
 reset(){try{localStorage.removeItem(STORE_KEY);localStorage.removeItem('quantum-evac-published-v1');sessionStorage.removeItem(AUTH_KEY);}catch(_e){}window.location.reload();}
};
})();
