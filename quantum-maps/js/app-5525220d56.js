'use strict';
const D=JSON.parse(document.getElementById('data').textContent);
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DAYS=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const short=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const aliases={'214':'STPV STEM','213':'STEM','202':'Лаборатория биологии','FTC':'Робототехника · FTC','Куратор':'Кураторская'};
const REPORT_PAGE_SIZE=1000;
const AUDIT_PAGE_SIZE=50;
const PRESENCE_INTERVAL_MS=10*60*1000;
const CLUB_PERIOD_START=9;
const CLUB_PERIOD_END=10;
const HALL_NOTICE='Бронирование подлежит проверке администрацией. Время или место могут быть изменены. Проверяйте актуальные данные в разделе бронирований.';
const HALL_NOTICE_IDS=new Set(['assembly-hall']);
const isHallRoom=roomId=>HALL_NOTICE_IDS.has(roomId);
const bookingAllowedRoom=roomId=>roomId!=='f1-gym'&&(!['f2-213','f2-214'].includes(roomId)||Boolean(session?.user?.id&&superadmin));
const GYM_BOOKING_NOTICE='Бронирование недоступно';
const restrictedBookingNotice=roomId=>roomId==='f1-gym'?GYM_BOOKING_NOTICE:'Бронирование кабинетов 213 и 214 доступно только суперадмину';
// Кабинет 201 по вт и чт на 8 уроке (15:15–15:55) готовят к Cooking Lab: новую бронь туда ставит только суперадмин.
// Старые брони можно править, переносить и удалять. Сервер проверяет то же в private.set_room_booking_identity.
const SUPERADMIN_SLOTS=[{room_id:'f2-201',days:[1,3],starts_at:'15:15',ends_at:'15:55',notice:'Кабинет 201 по вторникам и четвергам на 8 уроке (15:15–15:55) бронирует только суперадмин'}];
const lockedBookingSlot=payload=>session?.user?.id&&superadmin?null:SUPERADMIN_SLOTS.find(rule=>payload?.room_id===rule.room_id&&Boolean(payload.booking_date&&payload.starts_at&&payload.ends_at)&&rule.days.includes(dayIndexFor(payload.booking_date))&&overlaps(payload.starts_at,payload.ends_at,rule.starts_at,rule.ends_at))||null;
const bookingPlacementChanged=(original,payload)=>!original||['room_id','booking_date','starts_at','ends_at'].some(field=>String(payload[field]).slice(0,field.endsWith('_at')?5:100)!==String(original[field]).slice(0,field.endsWith('_at')?5:100));
const CALENDAR_FETCH_TIMEOUT_MS=15000;
const CALENDAR_PREVIEW_TIMEOUT_MS=35000;
// One formatter for the whole session: building Intl.DateTimeFormat on every call is slow on older Macs.
let clockFormatter=null;
const clock=()=>{if(!clockFormatter)clockFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});return Object.fromEntries(clockFormatter.formatToParts(new Date()).map(p=>[p.type,p.value]));};
const dateFrom=d=>`${d.year}-${d.month}-${d.day}`;
const dateObj=d=>new Date(`${d}T12:00:00Z`);
const DATE_MIN_YEAR=1900,DATE_MAX_YEAR=2100,ISO_DATE=/^(\d{4})-(\d{2})-(\d{2})$/,DISPLAY_DATE=/^(\d{2})\/(\d{2})\/(\d{4})$/;
function parseISODate(value){const match=String(value??'').trim().match(ISO_DATE);if(!match)return null;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);if(year<DATE_MIN_YEAR||year>DATE_MAX_YEAR||month<1||month>12||day<1||day>31)return null;const date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?{year,month,day,iso:`${match[1]}-${match[2]}-${match[3]}`}:null;}
function displayDigits(value){return String(value??'').replace(/\D/g,'').slice(0,8);}
function formatDateInput(value){const digits=displayDigits(value);return digits.length<=2?digits:digits.length<=4?`${digits.slice(0,2)}/${digits.slice(2)}`:`${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;}
function displayToIsoDate(value){const raw=String(value??'').trim(),match=raw.match(DISPLAY_DATE)||(/^\d{8}$/.test(raw)?raw.match(/^(\d{2})(\d{2})(\d{4})$/):null);if(!match)return null;return parseISODate(`${match[3]}-${match[2]}-${match[1]}`)?.iso||null;}
function isoToDisplayDate(value){const parsed=parseISODate(value);return parsed?`${String(parsed.day).padStart(2,'0')}/${String(parsed.month).padStart(2,'0')}/${parsed.year}`:'';}
function dateInputError(value){const text=String(value??'').trim();if(!text)return 'Введите дату в формате ДД/ММ/ГГГГ.';if(!displayToIsoDate(text))return displayDigits(text).length<8?'Введите дату полностью в формате ДД/ММ/ГГГГ.':'Введите существующую дату в формате ДД/ММ/ГГГГ.';return '';}
function formatTimestamp(value){const date=new Date(value);if(!Number.isFinite(date.getTime()))return String(value??'');const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Qyzylorda',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;}
function setDateFieldError(id,error){const display=$(`${id}-display`),message=$(`${id}-error`);if(!display)return;display.setAttribute('aria-invalid',error?'true':'false');if(message)message.textContent=error||'';}
function clearDateField(id,error=''){const canonical=$(id),display=$(`${id}-display`);if(canonical){canonical.value='';canonical.dataset.iso='';}if(display)display.value='';setDateFieldError(id,error);}
function syncDateField(id,iso){const canonical=$(id),display=$(`${id}-display`);if(!canonical||!display)return '';const normalized=parseISODate(iso)?.iso||'';canonical.value=normalized;canonical.dataset.iso=normalized;display.value=isoToDisplayDate(normalized);setDateFieldError(id,'');return normalized;}
function dateFieldValue(id){const canonical=$(id),display=$(`${id}-display`);if(!canonical||!display)return null;const canonicalValue=String(canonical.value||'');if(canonicalValue!==String(canonical.dataset.iso||'')){const parsed=parseISODate(canonicalValue);if(parsed){syncDateField(id,parsed.iso);return parsed.iso;}clearDateField(id,canonicalValue?'Введите существующую дату в формате ДД/ММ/ГГГГ.':'');return null;}
 const iso=displayToIsoDate(display.value);if(iso){if(canonical.value!==iso)canonical.value=iso;canonical.dataset.iso=iso;setDateFieldError(id,'');return iso;}canonical.value='';canonical.dataset.iso='';setDateFieldError(id,dateInputError(display.value));return null;}
function dateInputCaret(value,digitCount){const target=Math.max(0,Math.min(8,digitCount));if(target<=2)return target;if(target<=4)return target+1;return target+2;}
function handleDateDisplayInput(id,event){const input=event.target,oldValue=input.value,selection=Number.isFinite(input.selectionStart)?input.selectionStart:oldValue.length,digitsBefore=displayDigits(oldValue.slice(0,selection)).length,formatted=formatDateInput(oldValue);if(formatted!==oldValue){input.value=formatted;const caret=dateInputCaret(formatted,digitsBefore);try{input.setSelectionRange(caret,caret);}catch(_error){}}
 const iso=displayToIsoDate(formatted);if(iso)syncDateField(id,iso);else{$(id).value='';$(id).dataset.iso='';setDateFieldError(id,dateInputError(formatted));}return iso;}
function bindDateField(id,onInput=()=>{}){const canonical=$(id),display=$(`${id}-display`),picker=document.querySelector(`[data-date-picker="${id}"]`);if(!canonical||!display)return;canonical.setAttribute('aria-hidden','true');canonical.setAttribute('tabindex','-1');canonical.setAttribute('aria-label',canonical.getAttribute('aria-label')||display.getAttribute('aria-label')||'Дата');canonical.addEventListener('change',()=>{const iso=parseISODate(canonical.value)?.iso||'';if(iso)syncDateField(id,iso);else clearDateField(id,canonical.value?'Введите существующую дату в формате ДД/ММ/ГГГГ.':'');onInput('change',iso||null);});canonical.addEventListener('input',()=>{const iso=parseISODate(canonical.value)?.iso||'';if(iso)syncDateField(id,iso);else clearDateField(id,canonical.value?'Введите существующую дату в формате ДД/ММ/ГГГГ.':'');onInput('input',iso||null);});display.addEventListener('input',event=>onInput('input',handleDateDisplayInput(id,event)));display.addEventListener('change',()=>onInput('change',dateFieldValue(id)));display.addEventListener('blur',()=>onInput('blur',dateFieldValue(id)));display.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();display.blur();}});picker?.addEventListener('click',event=>{event.preventDefault();if(typeof canonical.showPicker==='function'){try{canonical.showPicker();return;}catch(_error){}}canonical.classList.add('date-picker-fallback');canonical.removeAttribute('aria-hidden');canonical.removeAttribute('tabindex');canonical.focus({preventScroll:true});});}
// status() runs tens of thousands of times per occupancy pass; weekdays and 'HH:MM' minutes are memoized.
const dayIndexCache=new Map();
const dayIndexFor=date=>{let value=dayIndexCache.get(date);if(value===undefined){value=(dateObj(date).getUTCDay()+6)%7;dayIndexCache.set(date,value);}return value;};
const dayIndex=()=>dayIndexFor(state.date);
const minuteCache=new Map();
const min=t=>{let value=minuteCache.get(t);if(value===undefined){const [h,m]=t.split(':').map(Number);value=h*60+m;minuteCache.set(t,value);}return value;};
const fmt=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
function normalizedTime(value){const match=String(value||'').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);return match?`${match[1].padStart(2,'0')}:${match[2]}`:null;}
function periodRangeForTimes(band,start,end){const bells=D.bells[band],periods=bells.map(([a,b],period)=>min(start)<min(b)&&min(a)<min(end)?period:null).filter(period=>period!==null);if(periods.length)return [periods[0],periods[periods.length-1]];const next=bells.findIndex(([,b])=>min(start)<min(b)),period=next<0?bells.length-1:next;return [period,period];}
// Обед — окно между уроками без урока (schedule/lunch_breaks.json). Его можно забронировать отдельной кнопкой.
function lunchFor(band){const slot=D.lunch?.[band];return Array.isArray(slot)&&slot.length===2&&min(slot[0])<min(slot[1])?slot:null;}
function lunchIndex(band){const lunch=lunchFor(band),bells=D.bells[band];return lunch&&bells?bells.findIndex(([a])=>min(a)>=min(lunch[1])):-1;}
function isLunchTime(band,start,end){const lunch=lunchFor(band);return Boolean(lunch&&String(start||'').slice(0,5)===lunch[0]&&String(end||'').slice(0,5)===lunch[1]);}
function periodSlots(band){const slots=(D.bells[band]||[]).map(([a,b],period)=>({period,a,b})),lunch=lunchFor(band),at=lunchIndex(band);if(lunch&&at>0)slots.splice(at,0,{lunch:true,a:lunch[0],b:lunch[1]});return slots;}
function periodSummaryLabel(band,start,end,startTime,endTime){const lunch=lunchFor(band),lessons=start===end?`${start} урок`:`${start}–${end} урок`;if(isLunchTime(band,startTime,endTime))return 'Обед';if(lunch&&startTime===lunch[0])return `Обед и ${lessons}`;if(lunch&&endTime===lunch[1])return `${lessons} и обед`;return lessons;}
let c=clock();
const state={floor:'2',date:dateFrom(c),minute:Number(c.hour)*60+Number(c.minute),selected:'f2-217',band:'secondary',view:[0,0,1295,720],drag:null,pinch:null,suppressClick:false,editor:{open:false,target:'shell',points:false,addPoint:false,selectedVertex:null,history:[],future:[]}};
const floorNames={'1':'Первый этаж','2':'Второй этаж','3':'Третий этаж','4':'Четвёртый этаж'};
const floorData=()=>D.floors[state.floor];
const roomFloors=id=>Object.keys(D.floors).filter(f=>D.floors[f].rooms.some(r=>r.room_id===id));
const allRooms=[...new Map(Object.values(D.floors).flatMap(f=>f.rooms).map(r=>[r.room_id,r])).values()];
let byRoom=new Map();
function indexLessons(){byRoom=new Map(allRooms.map(r=>[r.room_id,D.lessons.filter(l=>l.map_room_id===r.room_id)]));}
indexLessons();
const clubsByRoom=new Map(allRooms.map(r=>[r.room_id,(D.clubs||[]).filter(club=>club.map_room_id===r.room_id)]));
let cloud=null,session=null,profile=null,superadmin=false,googleAuthEnabled=false,bookings=[],availabilityBookings=[],availabilityRequest=0,bookingChannel=null,bookingLoadRequest=0,adjustments=[],staffEntries=[],staffBookingStats=new Map(),staffLoading=false,bookingReport=[],bookingReportRequest=0,bookingOpenRequest=0,bookingBoardInternalClose=false,bookingDraftSnapshot=null,presenceAt=0,toastTimer=null,deferredInstall=null,scheduleImport=null,scheduleInfo=null,scheduleImportRequest=0,scheduleRemoteRequest=0,scheduleRemoteLoad=null,schedulePublishInFlight=false,scheduleRemoteError='',accessRequest=0,auditEntries=[],auditLastId=null,auditHasMore=false,auditLoading=false,auditAppending=false,auditLoaded=false,auditError='',auditRequest=0,auditViewToken=0,auditAccessBlocked=false,calendarStatus=null,calendarPending=null,calendarRequest=0,calendarExpiryTimer=null,calendarBusy=false,calendarPreviewRequest=0,calendarPreviewController=null;
const hasCloud=()=>Boolean(D.supabase?.url&&D.supabase?.publishableKey&&window.supabase?.createClient);
const roomBookings=id=>bookings.filter(b=>b.room_id===id&&b.booking_date===state.date);
const currentBooking=id=>roomBookings(id).filter(b=>min(b.starts_at)<=state.minute&&state.minute<min(b.ends_at));
const isAdmin=()=>superadmin||profile?.role==='admin';
const canBook=()=>Boolean(session&&profile?.approved);
const canManage=b=>Boolean(session&&(b.created_by===session.user.id||isAdmin()));
// Calendar UI consumes API v1 Records; provider identities never enter this module.
const HALL_ROOM='assembly-hall',SYNC_FRESH_MS=5*60*1000;
let hallSnapshots=new Map(),hallReadRequest=0,syncViewRequest=0,syncEvents=[],syncConflicts=[],syncList=null,syncEdit=null,syncEditRequest=0,syncCommandBusy=false,bookingCommandBusy=false,bookingOriginal=null,bookingEditContext=null,bookingContextError=null,bookingContextRequest=0,bookingModalRevision=0,bookingRetry=null,eventRetry=null,conflictRetries=new Map();
const syncAccess=()=>Boolean(cloud&&session?.user?.id&&profile?.approved);
const syncAdmin=()=>syncAccess()&&isAdmin();
const decimalVersion=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value);
const syncErrors={AUTH_REQUIRED:'Войдите снова.',FORBIDDEN:'Недостаточно прав.',NOT_FOUND:'Запись больше недоступна.',INVALID_ARGUMENT:'Проверьте дату и время.',VERSION_CONFLICT:'Бронь изменилась.',MAPPING_REVISION_CONFLICT:'Событие изменилось.',ETAG_CONFLICT:'Событие изменилось в Google.',GENERATION_CONFLICT:'Подключение изменилось.',STALE_AVAILABILITY:'Доступность зала устарела.',SCHEDULE_UNKNOWN:'Расписание зала ещё не подтверждено.',SCHEDULE_CONFLICT:'В это время есть урок или кружок.',BOOKING_OVERLAP:'Это время уже занято.',QUOTA_EXCEEDED:'Достигнут лимит будущих бронирований.',LINK_CONFLICT:'Связь с календарём требует проверки.',EVENT_NOT_EDITABLE:'Это событие нельзя изменить.',SYNC_DISABLED:'Изменения календаря пока отключены.',IDEMPOTENCY_KEY_REUSED:'Повторите действие с обновлёнными данными.',RETRYABLE:'Не удалось подтвердить результат. Повторите действие.',INTERNAL:'Не удалось подтвердить результат. Повторите действие.'};
const staleSyncCode=code=>['VERSION_CONFLICT','MAPPING_REVISION_CONFLICT','ETAG_CONFLICT','GENERATION_CONFLICT','LINK_CONFLICT'].includes(code);
function syncError(code){return syncErrors[code]||'Не удалось подтвердить результат. Повторите действие.';}
async function syncRpc(name,args={}){
 if(/^calendar_sync_(booking_(create|update|cancel)|event_(update|cancel)|conflict_(keep_map|accept_google|manual))_v1$/.test(name)&&!decimalVersion(args.p_expected_connection_generation))return {ok:false,error:{code:'GENERATION_CONFLICT',retryable:false}};
 try{if(!cloud?.rpc)return {ok:false,error:{code:'RETRYABLE',retryable:true}};const {data,error}=await cloud.rpc(name,args);if(error||data?.v!==1||typeof data.ok!=='boolean')return {ok:false,error:{code:'RETRYABLE',retryable:true}};return data;}catch{return {ok:false,error:{code:'RETRYABLE',retryable:true}};}
}
function commandFor(previous,name,args){const hash=JSON.stringify([session?.user?.id,name,args]);return previous?.hash===hash?previous:{hash,id:window.crypto.randomUUID()};}
function currentHallSnapshot(date){const value=hallSnapshots.get(date);return value&&Date.now()-value.fetchedAt<SYNC_FRESH_MS?value:null;}
function hallAvailability(date){const value=currentHallSnapshot(date);if(!value)return 'unknown';if(value.status.calendar_state==='disabled')return value.writeGuard===true||value.writeGuard==='unknown'?'unknown':'disabled';const age=Date.now()-Date.parse(value.busy?.as_of);return value.status.availability_usable===true&&value.busy?.availability_usable===true&&value.status.projection_generation===value.busy.projection_generation&&Number.isFinite(age)&&age>=0&&age<SYNC_FRESH_MS?'ready':'unknown';}
function hallIntervals(date){return hallAvailability(date)==='ready'?currentHallSnapshot(date).busy.intervals:[];}
// Asia/Qyzylorda is UTC+05:00 for the supported 2026 runtime horizon.
function localInstant(date,time='00:00'){return Date.parse(`${date}T${time.length===5?time+':00':time}+05:00`);}
function intervalOverlap(interval,date,start,end){const a=interval.is_all_day?localInstant(interval.all_day_start):Date.parse(interval.start_at),b=interval.is_all_day?localInstant(interval.all_day_end):Date.parse(interval.end_at);return a<localInstant(date,end)&&localInstant(date,start)<b;}
function hallOccupied(date,start,end){return hallIntervals(date).some(interval=>intervalOverlap(interval,date,start,end));}
async function readHallSnapshot(date){
 if(!cloud?.rpc)return null;
 try{const results=await Promise.all([cloud.rpc('calendar_sync_status_v1'),cloud.rpc('calendar_sync_public_busy_v1',{p_from:date,p_to:date})]);const [status,busy]=results;if(status.error||status.data?.v!==1||typeof status.data.availability_usable!=='boolean')return null;const b=busy.error?null:busy.data;if(b&&(b.v!==1||typeof b.availability_usable!=='boolean'||!Array.isArray(b.intervals)||b.intervals.length>10000||!b.intervals.every(interval=>typeof interval.is_all_day==='boolean'&&(interval.is_all_day?parseISODate(interval.all_day_start)&&parseISODate(interval.all_day_end)&&interval.all_day_start<interval.all_day_end:Number.isFinite(Date.parse(interval.start_at))&&Date.parse(interval.start_at)<Date.parse(interval.end_at)))))return null;return {status:status.data,busy:b,fetchedAt:Date.now()};}catch{return null;}
}
async function refreshHall(date=state.date){const request=++hallReadRequest,key=sessionKey(session),value=await readHallSnapshot(date);if(value?.status.calendar_state==='disabled'&&syncAccess()){const context=await editContext();value.writeGuard=context.ok?context.result.write_guard_enabled:'unknown';}if(request!==hallReadRequest||key!==sessionKey(session)||date!==state.date)return false;const same=hallSnapshotRows(currentHallSnapshot(date))===hallSnapshotRows(value);if(value)hallSnapshots.set(date,value);else hallSnapshots.delete(date);if(!same){updateMap();renderCard();}return Boolean(value);}
// What the map shows from a hall snapshot: everything but the time it was fetched. A stale snapshot counts as none.
function hallSnapshotRows(value){return value?JSON.stringify({...value,fetchedAt:0}):'none';}
function validSyncRecord(row,writeGuard){
 if(!row)return false;
 // An inert, unlinked map booking has no generation to invent. Only explicit
 // guard-off context permits that null; any binding or guarded path needs a real one.
 const inertGeneration=row.connection_generation===null&&writeGuard===false&&row.origin==='map'&&row.sync_state==='unlinked'&&row.event_ref===null&&row.mapping_revision===null&&row.etag===null&&decimalVersion(row.booking_id)&&decimalVersion(row.booking_version);
 return ['map','google'].includes(row.origin)&&typeof row.summary==='string'&&typeof row.is_private==='boolean'&&typeof row.is_all_day==='boolean'&&(decimalVersion(row.connection_generation)||inertGeneration)&&typeof row.can_edit==='boolean'&&typeof row.can_cancel==='boolean'&&['pending','synced','conflict','failed','unlinked'].includes(row.sync_state)&&(!row.booking_id||decimalVersion(row.booking_id))&&(row.booking_version===null||decimalVersion(row.booking_version))&&(row.mapping_revision===null||decimalVersion(row.mapping_revision))&&(row.etag===null||typeof row.etag==='string')&&(row.is_all_day?parseISODate(row.start_date)&&parseISODate(row.end_date)&&row.start_date<row.end_date:Number.isFinite(Date.parse(row.start_at))&&Date.parse(row.start_at)<Date.parse(row.end_at));
}
async function editContext(bookingId=null,eventRef=null){const reply=await syncRpc('calendar_sync_edit_context_v1',{p_booking_id:bookingId||null,p_event_ref:eventRef||null});if(!reply.ok)return reply;const value=reply.result;if(!value||typeof value.write_guard_enabled!=='boolean'||typeof value.availability_usable!=='boolean'||value.connection_generation!==null&&!decimalVersion(value.connection_generation)||value.write_guard_enabled&&!decimalVersion(value.connection_generation)||value.record!==null&&(!validSyncRecord(value.record,value.write_guard_enabled)||decimalVersion(value.record.connection_generation)&&value.record.connection_generation!==value.connection_generation))return {ok:false,error:{code:'RETRYABLE',retryable:true}};return reply;}
function syncPreconditions(context){const row=context.record;return {p_expected_booking_version:row?.booking_version??null,p_expected_mapping_revision:row?.mapping_revision??null,p_expected_etag:row?.etag??null,p_expected_connection_generation:context.connection_generation};}
async function refreshConflict(item){if(!item)return null;const reply=await syncRpc('calendar_sync_events_v1',{p_from:state.date,p_to:state.date});return reply.ok&&Array.isArray(reply.result?.conflicts)?reply.result.conflicts.find(conflict=>conflict.conflict_id===item.conflict_id)||item:item;}
async function kickCalendar(){if(!syncAccess()||!cloud.functions?.invoke)return;try{await cloud.functions.invoke('google-calendar-sync',{body:{action:'kick'}});}catch{} }
function syncStateLabel(state){return {pending:'Сохранено · ожидает Google',synced:'Синхронизировано',conflict:'Требуется решение администратора',failed:'Ошибка синхронизации',unlinked:'Без связи с Google'}[state]||'Статус неизвестен';}
function syncRecordTime(row){return row.is_all_day?`${isoToDisplayDate(row.start_date)} — ${isoToDisplayDate(row.end_date)} · весь день; дата окончания не включена`:`${formatTimestamp(row.start_at)} — ${formatTimestamp(row.end_at)}`;}
function syncRecordHtml(row,index){const linked=Boolean(row.booking_id),editable=syncAdmin()&&!linked&&!row.is_private&&(row.can_edit||row.can_cancel);return `<article class="sync-event"><strong>${esc(row.is_private?'Закрытое событие':row.summary.slice(0,160))}</strong><span>${esc(syncRecordTime(row))}</span><small class="sync-state">${esc(syncStateLabel(row.sync_state))}</small>${linked?`<button type="button" class="secondary-button" data-sync-booking="${index}">Открыть актуальную бронь</button>`:editable?`<button type="button" class="secondary-button" data-sync-event="${index}">Изменить это событие</button>`:''}</article>`;}
function renderSyncEvents(){
 const target=$('hall-calendar-events');if(!target)return;target.innerHTML=syncEvents.map(syncRecordHtml).join('')||'<p>Событий за период нет.</p>';
 target.querySelectorAll('[data-sync-booking]').forEach(button=>button.onclick=async()=>{const row=syncEvents[Number(button.dataset.syncBooking)];if(!syncAccess()||!row?.booking_id)return;closeSyncCalendar();await openBookingReportRow(row.booking_id);});
 target.querySelectorAll('[data-sync-event]').forEach(button=>button.onclick=()=>openSyncEvent(syncEvents[Number(button.dataset.syncEvent)]));
 const conflicts=$('hall-calendar-conflicts');conflicts.innerHTML=syncConflicts.map((item,index)=>`<article class="sync-conflict"><strong>Изменения требуют проверки</strong><small>Бронь и Google изменились. Решение применится только к текущей версии.</small>${syncAdmin()?`<div class="calendar-actions"><button type="button" data-sync-conflict="${index}" data-choice="keep_map">Оставить карту</button><button type="button" data-sync-conflict="${index}" data-choice="accept_google">Принять Google</button><button type="button" data-sync-conflict="${index}" data-choice="manual">Задать вручную</button></div>`:''}</article>`).join('');
 conflicts.querySelectorAll('[data-sync-conflict]').forEach(button=>{const item=syncConflicts[Number(button.dataset.syncConflict)];button.disabled=item.can_resolve!==true||syncCommandBusy;button.onclick=()=>resolveSyncConflict(item,button.dataset.choice);});
}
function invalidateSyncEvents(){syncViewRequest++;syncEvents=[];syncConflicts=[];syncList=null;if($('hall-calendar-events'))$('hall-calendar-events').innerHTML='';if($('hall-calendar-conflicts'))$('hall-calendar-conflicts').innerHTML='';}
function closeSyncCalendar(){invalidateSyncEvents();hideModal($('hall-calendar-dialog'));}
async function loadSyncEvents(){
 if(!syncAccess())return false;const from=dateFieldValue('hall-calendar-from'),to=dateFieldValue('hall-calendar-to'),message=$('hall-calendar-message');invalidateSyncEvents();if(!from||!to||to<from||(dateObj(to)-dateObj(from))/86400000>30){message.textContent='Выберите период до 31 дня.';return false;}const request=++syncViewRequest,key=sessionKey(session);message.textContent='Загружаем события…';const reply=await syncRpc('calendar_sync_events_v1',{p_from:from,p_to:to});if(request!==syncViewRequest||key!==sessionKey(session)||!syncAccess()||!$('hall-calendar-dialog').hasAttribute('open'))return false;
 const value=reply.result;if(!reply.ok||!value||typeof value.write_guard_enabled!=='boolean'||value.connection_generation!==null&&!decimalVersion(value.connection_generation)||value.write_guard_enabled&&!decimalVersion(value.connection_generation)||!Array.isArray(value.events)||value.events.length>1000||!value.events.every(row=>validSyncRecord(row,value.write_guard_enabled))||!Array.isArray(value.conflicts)||value.conflicts.length>100||typeof value.truncated!=='boolean'){message.textContent=syncError(reply.error?.code);return false;}
 syncList=value;syncEvents=value.events;syncConflicts=value.conflicts;renderSyncEvents();message.textContent=`${value.as_of?'На '+formatTimestamp(value.as_of)+'. ':''}${value.availability_usable?'Доступность проверена.':'Доступность не подтверждена.'}${value.truncated?' Показана часть событий. Для проверки свободного времени используйте «Свободные кабинеты».':''}`;return true;
}
async function openSyncCalendar(){if(!syncAccess())return false;syncDateField('hall-calendar-from',state.date);const end=dateObj(state.date);end.setUTCDate(end.getUTCDate()+30);syncDateField('hall-calendar-to',end.toISOString().slice(0,10));showModal($('hall-calendar-dialog'));return loadSyncEvents();}
function closeSyncEvent(){if(syncCommandBusy)return false;if(syncEdit?.draft!==JSON.stringify(syncEventDraft())&&!window.confirm?.('Отменить изменения и закрыть форму?'))return false;syncEditRequest++;syncEdit=null;hideModal($('hall-event-dialog'));return true;}
function syncEventDraft(){return ['hall-event-summary','hall-event-all-day','hall-event-start-date-display','hall-event-end-date-display','hall-event-start-time','hall-event-end-time'].map(id=>[id,$(id).value,$(id).checked]);}
function updateSyncEventFields(){const allDay=$('hall-event-all-day').checked;$('hall-event-times').hidden=allDay;$('hall-event-start-time').required=!allDay;$('hall-event-end-time').required=!allDay;}
function instantFields(value){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));return {date:dateFrom(parts),time:`${parts.hour}:${parts.minute}`};}
async function openSyncEvent(row,conflict=null){
 if(syncCommandBusy||bookingCommandBusy||!syncAdmin()||!row||row.is_private||row.booking_id||!row.event_ref)return false;if($('hall-event-dialog').hasAttribute('open')&&!closeSyncEvent())return false;const request=++syncEditRequest,key=sessionKey(session),reply=await editContext(null,row.event_ref);if(request!==syncEditRequest||key!==sessionKey(session)||!syncAdmin())return false;
 const record=reply.result?.record;if(!reply.ok||!record||record.is_private||record.booking_id||(!record.can_edit&&!record.can_cancel)){toast(syncError(reply.error?.code||'EVENT_NOT_EDITABLE'));return false;}
 syncEdit={context:reply.result,conflict};eventRetry=null;$('hall-event-summary').value=record.summary;$('hall-event-all-day').checked=record.is_all_day;const start=record.is_all_day?{date:record.start_date,time:'09:00'}:instantFields(record.start_at),end=record.is_all_day?{date:record.end_date,time:'10:00'}:instantFields(record.end_at);syncDateField('hall-event-start-date',start.date);syncDateField('hall-event-end-date',end.date);$('hall-event-start-time').value=start.time;$('hall-event-end-time').value=end.time;$('hall-event-message').textContent='Изменяется только это событие или один экземпляр повторения.';updateSyncEventFields();$('hall-event-save').disabled=!record.can_edit;$('hall-event-cancel').disabled=!record.can_cancel;syncEdit.draft=JSON.stringify(syncEventDraft());showModal($('hall-event-dialog'));return true;
}
function syncEventPayload(){const start=dateFieldValue('hall-event-start-date'),end=dateFieldValue('hall-event-end-date'),allDay=$('hall-event-all-day').checked,summary=$('hall-event-summary').value.trim();if(!start||!end||!summary)return null;if(allDay)return start<end?{p_summary:summary,p_start_date:start,p_end_date:end,p_start_at:null,p_end_at:null}:null;const a=normalizedTime($('hall-event-start-time').value),b=normalizedTime($('hall-event-end-time').value);if(!a||!b||localInstant(start,a)>=localInstant(end,b))return null;return {p_summary:summary,p_start_date:null,p_end_date:null,p_start_at:new Date(localInstant(start,a)).toISOString(),p_end_at:new Date(localInstant(end,b)).toISOString()};}
function setEventBusy(value){syncCommandBusy=value;$('hall-event-form').querySelectorAll('input,button').forEach(field=>field.disabled=value);if(!value&&syncEdit){$('hall-event-save').disabled=!syncEdit.context.record.can_edit;$('hall-event-cancel').disabled=!syncEdit.context.record.can_cancel;}}
async function submitSyncEvent(cancel=false){
 if(syncCommandBusy||!syncAdmin()||!syncEdit)return false;const context=syncEdit.context,row=context.record,payload=cancel?{}:syncEventPayload(),message=$('hall-event-message');if(row.is_private||row.booking_id||!(cancel?row.can_cancel:row.can_edit)||!payload){message.textContent='Проверьте права, даты и время.';return false;}if(cancel&&!window.confirm?.('Отменить только это событие?'))return false;
 const request=syncEditRequest,key=sessionKey(session),intent=JSON.stringify([session?.user?.id,cancel,row.event_ref,payload,syncEdit.conflict?.conflict_id||null]),replay=eventRetry?.intent===intent;setEventBusy(true);message.textContent='Проверяем текущую версию…';let fresh=await editContext(null,row.event_ref);
 // A lost cancellation response may follow committed deletion. Fetch current
 // connection context, then replay only the original typed receipt command.
 if(cancel&&replay&&!fresh.ok&&fresh.error?.code==='NOT_FOUND')fresh=await editContext();
 if(request!==syncEditRequest||key!==sessionKey(session)||!syncAdmin()){setEventBusy(false);return false;}
 const current=fresh.result?.record;if(!fresh.ok||!replay&&(!current||current.is_private||current.booking_id||!(cancel?current.can_cancel:current.can_edit))){setEventBusy(false);message.textContent=syncError(fresh.error?.code||'EVENT_NOT_EDITABLE');return false;}
 // Keep displayed preconditions for a changed remote record: the command must conflict,
 // not silently overwrite an edit the user has never seen.
 const expected=replay?null:context;
 const name=cancel?'calendar_sync_event_cancel_v1':syncEdit.conflict?'calendar_sync_conflict_manual_v1':'calendar_sync_event_update_v1',args={p_event_ref:row.event_ref,...syncPreconditions(expected||context),...payload};delete args.p_expected_booking_version;
 if(syncEdit.conflict&&!cancel){delete args.p_event_ref;Object.assign(args,{p_conflict_id:syncEdit.conflict.conflict_id,p_expected_etag:syncEdit.conflict.etag,p_expected_booking_version:null,p_room_id:null,p_booking_date:null,p_starts_at:null,p_ends_at:null,p_grade_band:null,p_period_start:null,p_period_end:null,p_purpose:null});}
 if(!replay)eventRetry={...commandFor(null,name,args),intent,name,args};message.textContent='Сохраняем…';const reply=await syncRpc(eventRetry.name,{p_command_id:eventRetry.id,...eventRetry.args});setEventBusy(false);if(request!==syncEditRequest||key!==sessionKey(session)||!syncAdmin())return false;
 if(!reply.ok){message.textContent=syncError(reply.error?.code);if(reply.error?.retryable===false)eventRetry=null;if(staleSyncCode(reply.error?.code)){const fresh=await editContext(null,row.event_ref),conflict=await refreshConflict(syncEdit?.conflict);if(request===syncEditRequest&&key===sessionKey(session)&&fresh.ok&&fresh.result.record){syncEdit.context=fresh.result;syncEdit.conflict=conflict;eventRetry=null;message.textContent+=' Текущая версия загружена; ваш текст и время сохранены. Проверьте их и повторите.';setEventBusy(false);}}return false;}
 syncEdit=null;syncEditRequest++;hideModal($('hall-event-dialog'));toast(reply.result?.sync_state==='synced'?'Изменения синхронизированы.':'Изменения сохранены. Ожидается Google.');void kickCalendar();void refreshHall();await loadSyncEvents();return true;
}
async function resolveSyncConflict(item,choice){
 if(syncCommandBusy||!syncAdmin()||!item?.conflict_id||item.can_resolve!==true)return false;
 if(choice==='manual'){if(item.booking_id){bookingConflictChoice=item;closeSyncCalendar();return openBookingReportRow(item.booking_id);}const row=syncEvents.find(row=>row.event_ref===item.event_ref);return openSyncEvent(row,item);}
 if(!['keep_map','accept_google'].includes(choice)||!window.confirm?.(choice==='keep_map'?'Оставить текущие данные карты?':'Принять текущие изменения Google?'))return false;
 const key=sessionKey(session);syncCommandBusy=true;renderSyncEvents();let result;
 try{const reply=await editContext(item.booking_id||null,item.booking_id?null:item.event_ref);if(key!==sessionKey(session)||!syncAdmin()||!reply.ok||!reply.result.record)return false;const context=reply.result;if(context.record.is_private){toast('Закрытое событие нельзя изменять.');return false;}const name=`calendar_sync_conflict_${choice}_v1`,args={p_conflict_id:item.conflict_id,p_expected_booking_version:item.booking_version,p_expected_mapping_revision:item.mapping_revision,p_expected_etag:item.etag,p_expected_connection_generation:item.connection_generation},retry=commandFor(conflictRetries.get(item.conflict_id),name,args);conflictRetries.set(item.conflict_id,retry);result=await syncRpc(name,{p_command_id:retry.id,...args});}finally{syncCommandBusy=false;renderSyncEvents();}
 if(key!==sessionKey(session)||!syncAdmin())return false;if(!result.ok){if(result.error?.retryable===false)conflictRetries.delete(item.conflict_id);toast(syncError(result.error?.code));await loadSyncEvents();return false;}conflictRetries.delete(item.conflict_id);toast('Решение сохранено. Ожидается Google.');void kickCalendar();void refreshHall();await loadSyncEvents();return true;
}
let bookingConflictChoice=null;
function updateSyncVisibility(){if($('hall-calendar-toggle'))$('hall-calendar-toggle').hidden=!syncAccess();if(!syncAccess()){invalidateSyncEvents();syncEditRequest++;syncEdit=null;hideModal($('hall-calendar-dialog'));hideModal($('hall-event-dialog'));}}
function setupSyncUi(){
 const button=document.createElement('button');button.id='hall-calendar-toggle';button.type='button';button.className='board-toggle';button.textContent='Календарь зала';button.hidden=true;button.onclick=openSyncCalendar;$('availability-toggle').parentNode.appendChild(button);
 ['hall-calendar-from','hall-calendar-to','hall-event-start-date','hall-event-end-date'].forEach(id=>{const picker=document.querySelector('[data-date-picker="date"]').cloneNode(true);picker.dataset.datePicker=id;picker.setAttribute('aria-label','Открыть календарь');$(id).parentNode.insertBefore(picker,$(id));$(id+'-display').setAttribute('aria-label',$(id+'-display').closest('label').textContent.trim());$(id+'-display').setAttribute('aria-describedby',id+'-error');bindDateField(id,id.startsWith('hall-calendar')?()=>{invalidateSyncEvents();$('hall-calendar-message').textContent='Нажмите «Обновить события» для нового периода.';}:()=>{});});
 $('hall-calendar-refresh').onclick=loadSyncEvents;$('hall-calendar-close').onclick=closeSyncCalendar;$('hall-event-close').onclick=closeSyncEvent;$('hall-event-all-day').onchange=updateSyncEventFields;$('hall-event-form').onsubmit=event=>{event.preventDefault();return submitSyncEvent();};$('hall-event-cancel').onclick=()=>submitSyncEvent(true);
 $('hall-event-dialog').addEventListener('cancel',event=>{event.preventDefault();closeSyncEvent();});$('hall-calendar-dialog').addEventListener('cancel',()=>invalidateSyncEvents());
 const poll=()=>{if(document.visibilityState==='hidden')return;void refreshHall();if(syncAccess()&&$('hall-calendar-dialog').hasAttribute('open'))void loadSyncEvents();};
 window.addEventListener('focus',poll);document.addEventListener('visibilitychange',poll);const timer=window.setInterval?.(poll,60000);timer?.unref?.();updateSyncVisibility();
}
const actorName=()=>profile?.display_name||session?.user?.user_metadata?.full_name||session?.user?.email?.split('@')[0]||'Сотрудник';
const defaultAdjustment=()=>({dx:0,dy:0,rotation:0,scale:1,scale_x:1,scale_y:1,skew_x:0,skew_y:0,geometry:null});
const adjustmentFor=(type,id)=>{
 const rows=adjustments.filter(a=>a.floor===Number(state.floor)&&a.target_type===type&&a.target_id===id);
 return (state.editor.open&&rows.find(a=>!a.published))||rows.find(a=>a.published)||defaultAdjustment();
};
const transformFor=(type,id,point=[647.5,360])=>{const a=adjustmentFor(type,id),[cx,cy]=point,sx=Number(a.scale_x??a.scale)||1,sy=Number(a.scale_y??a.scale)||1,kx=Number(a.skew_x)||0,ky=Number(a.skew_y)||0;return `translate(${Number(a.dx)||0} ${Number(a.dy)||0}) rotate(${Number(a.rotation)||0} ${cx} ${cy}) translate(${cx} ${cy}) skewX(${kx}) skewY(${ky}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`;};
function changeFloor(number,id){
 if(!D.floors[number])return;
 bookingOpenRequest++;
 state.floor=String(number);
 const rooms=floorData().rooms;
 state.selected=id&&rooms.some(r=>r.room_id===id)?id:rooms.some(r=>r.room_id===state.selected)?state.selected:rooms.find(r=>byRoom.get(r.room_id)?.length||clubsByRoom.get(r.room_id)?.length)?.room_id||rooms[0]?.room_id;
 state.view=homeView();
 $('tooltip').hidden=true;
 draw();applyView();animateFloorEnter();renderCard();
 $('search-results').hidden=true;
}
// The floor fades in on the <svg> element itself: an opacity animation runs on the compositor without repainting the plan.
// No transform here: moving the <svg> makes Chrome re-lay out every SVG label on each frame.
// Slow devices: when frames keep taking longer than 50 ms while the map is in use, the map drops its transitions and
// the floor fade (body.lite-map) and remembers that on this device for two weeks.
const LITE_KEY='quantum-map-lite',LITE_DAYS=14;
let frameWatch=null;const frameStats={frames:0,slow:0};
function liteMap(){return document.body.classList.contains('lite-map');}
try{const since=Number(localStorage.getItem(LITE_KEY));if(since&&Date.now()-since<LITE_DAYS*864e5)document.body.classList.add('lite-map');}catch(_error){}
function watchFrames(){
 if(liteMap()||typeof requestAnimationFrame!=='function'||typeof performance==='undefined')return;
 const now=performance.now();if(frameWatch){frameWatch.until=now+1000;return;}
 frameWatch={last:now,until:now+1000};
 const tick=time=>{
  const watch=frameWatch;if(!watch)return;const gap=time-watch.last;watch.last=time;
  if(gap>0&&gap<1000&&!document.hidden){frameStats.frames++;if(gap>50)frameStats.slow++;}
  if(frameStats.frames>=60&&frameStats.slow/frameStats.frames>.25){frameWatch=null;document.body.classList.add('lite-map');try{localStorage.setItem(LITE_KEY,String(Date.now()));}catch(_error){}return;}
  if(time<watch.until)requestAnimationFrame(tick);else frameWatch=null;
 };
 requestAnimationFrame(tick);
}
function animateFloorEnter(){const map=$('map');if(typeof map.animate!=='function'||liteMap()||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;map.animate([{opacity:.35},{opacity:1}],{duration:280,easing:'ease-out'});}
function updateFloorNav(){
 $('floor-title').textContent=floorNames[state.floor];
 $('room-count').textContent=floorData().rooms.length;
 $('map').setAttribute('aria-label','Интерактивная карта: '+floorNames[state.floor]);
 refreshOccupancy();renderFloorList();renderScrubBars();
}
function lessonTimes(l){
 const grades=(l.classes||[]).map(s=>Number(String(s).match(/^\d+/)?.[0])).filter(Boolean);
 const band=grades.length&&grades.every(g=>g<=5)?'primary':grades.length&&grades.every(g=>g>=6)?'secondary':null;
 return band&&D.bells[band][l.period]?D.bells[band][l.period]:[l.start,l.end];
}
function clubPeriods(club){
 const sourceStart=min(club.start),sourceEnd=min(club.end),periodStart=Number.isInteger(club.period_start)?club.period_start:(sourceStart<17*60?CLUB_PERIOD_START:CLUB_PERIOD_END),periodEnd=Number.isInteger(club.period_end)?club.period_end:(sourceEnd>17*60?CLUB_PERIOD_END:periodStart),start=Math.max(CLUB_PERIOD_START,Math.min(CLUB_PERIOD_END,periodStart));
 return [start,Math.max(start,Math.max(CLUB_PERIOD_START,Math.min(CLUB_PERIOD_END,periodEnd)))];
}
function clubTimes(club){const [start,end]=clubPeriods(club),bells=D.bells.secondary;return [bells[start][0],bells[end][1]];}
function daily(id){const day=DAYS[dayIndex()];return(byRoom.get(id)||[]).filter(l=>l.day===day);}
function dailyClubs(id,date=state.date){const day=DAYS[dayIndexFor(date)];return(clubsByRoom.get(id)||[]).filter(club=>club.day===day).sort((a,b)=>clubPeriods(a)[0]-clubPeriods(b)[0]);}
function currentLessons(id){return daily(id).filter(l=>{const [a,b]=lessonTimes(l);return min(a)<=state.minute&&state.minute<min(b);});}
function currentClubs(id){return dailyClubs(id).filter(club=>{const [start,end]=clubPeriods(club);return D.bells.secondary.some(([a,b],period)=>start<=period&&period<=end&&min(a)<=state.minute&&state.minute<min(b));});}
function current(id){return [...currentLessons(id),...currentClubs(id)];}
function status(id){if(current(id).length||currentBooking(id).length)return 'busy';if(id===HALL_ROOM){if(hallOccupied(state.date,fmt(state.minute),fmt(Math.min(1440,state.minute+1))))return 'busy';const mode=hallAvailability(state.date);if(mode==='unknown')return 'unknown';if(mode==='ready')return 'free';}return !byRoom.get(id)?.length?'unknown':'free';}
function statusText(id){return currentBooking(id).length?'Кабинет занят по брони':currentClubs(id).length?'Идёт кружок':currentLessons(id).length?'Идёт урок по расписанию':id===HALL_ROOM&&hallOccupied(state.date,fmt(state.minute),fmt(Math.min(1440,state.minute+1)))?'Зал занят по календарю':id===HALL_ROOM&&hallAvailability(state.date)==='unknown'?'Доступность зала не подтверждена':status(id)==='unknown'?(scheduleRemoteError||'Расписание не загружено'):'Свободен по расписанию';}
function points(p){return p.map(v=>v.map(x=>Math.round(x*100)/100).join(',')).join(' ');}
const geometryClone=value=>value?JSON.parse(JSON.stringify(value)):null;
function validGeometry(value){return Boolean(value&&value.kind==='polygon'&&Array.isArray(value.rings)&&value.rings.length&&value.rings.every(ring=>Array.isArray(ring)&&ring.length>=3&&ring.length<=256&&ring.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite))));}
function outlineRings(path){return (String(path).match(/M[^Z]*Z/gi)||[]).map(part=>{const values=(part.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number),ring=[];for(let i=0;i+1<values.length;i+=2)ring.push([values[i],values[i+1]]);return ring;}).filter(ring=>ring.length>=3);}
function geometryPath(geometry){return geometry.rings.map(ring=>'M'+ring.map(point=>point.map(n=>Math.round(n*100)/100).join(' ')).join('L')+'Z').join(' ');}
function geometryFor(type,id){const geometry=adjustmentFor(type,id)?.geometry;return validGeometry(geometry)?geometry:null;}
function roomPoints(room){return geometryFor('room',room.room_id)?.rings[0]||room.p;}
function baseGeometry(type,id){if(type==='room'){const room=floorData().rooms.find(value=>value.room_id===id);return room?{kind:'polygon',rings:[geometryClone(room.p)]}:null;}if(type==='shell'){const rings=outlineRings(floorData().outline);return rings.length?{kind:'polygon',rings}:null;}return null;}
function center(p){let a=0,x=0,y=0;p.forEach((v,i)=>{const w=p[(i+1)%p.length],k=v[0]*w[1]-w[0]*v[1];a+=k;x+=(v[0]+w[0])*k;y+=(v[1]+w[1])*k;});return [x/(3*a),y/(3*a)];}
const outline=()=>{const geometry=geometryFor('shell',state.floor);return geometry?geometryPath(geometry):floorData().outline;};
function roomSvg(r){
 // The visible face stays on the 2D footprint; only the depth extends down.
 const top=roomPoints(r),[cx,cy]=labelPoint(top),base=top.map(([x,y])=>[x,y+8]);
 const labelLines=r.n.length>11?r.n.split(' '):[r.n];
 const boxWidth=Math.max(...top.map(p=>p[0]))-Math.min(...top.map(p=>p[0]));
 const font=Math.max(9,Math.min(18,boxWidth/Math.max(...labelLines.map(l=>l.length))*.95));
 let walls='';
 top.forEach((p,i)=>{const j=(i+1)%top.length;walls+=`<polygon class="wall" points="${points([p,top[j],base[j],base[i]])}"/>`;});
 const subtitle=r.room_id==='assembly-hall'?'ЭТАЖИ 3–4':r.n==='202'?'BIO LAB':r.n==='FTC'?'ROBOTICS':['213','214'].includes(r.n)?'STEM':'';
 const bottom=cy-5+(labelLines.length-1)*font*.65;
 return `<g class="room" data-id="${esc(r.room_id)}" transform="${transformFor('room',r.room_id,[cx,cy])}" role="button" tabindex="0" aria-label="${esc(r.n)}"><title>${esc(r.n)}</title><g class="unit"><polygon class="depth" points="${points(top)}" transform="translate(2 5)" fill="#4d494a" opacity=".14"/>${walls}<polygon class="floor" points="${points(top)}"/><polygon class="outline" points="${points(top)}"/><polygon class="rim" points="${points(top)}"/><text x="${cx}" y="${cy-5-(labelLines.length-1)*font*.65}" style="font-size:${font}px">${labelLines.map((l,i)=>`<tspan x="${cx}" dy="${i?font*1.3:0}">${esc(l)}</tspan>`).join('')}</text>${subtitle?`<text class="sub-label" x="${cx}" y="${bottom+12}">${subtitle}</text>`:''}${boxWidth>40?`<circle class="dot" cx="${cx}" cy="${bottom+(subtitle?23:14)}" r="2.3"/>`:''}</g>${vertexOverlay('room',r.room_id)}</g>`;
}
function labelPoint(p){
 const inside=([x,y])=>{let hit=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
 const middle=center(p);
 if(inside(middle))return middle;
 const xs=p.map(v=>v[0]),ys=p.map(v=>v[1]);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 let best=p[0],score=-Infinity;
 for(let i=1;i<16;i++)for(let j=1;j<16;j++){
  const q=[minX+(maxX-minX)*i/16,minY+(maxY-minY)*j/16];if(!inside(q))continue;
  const distance=Math.min(...p.map((a,k)=>{const b=p[(k+1)%p.length],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(q[0]-a[0]-t*dx,q[1]-a[1]-t*dy);}));
  if(distance>score){score=distance;best=q;}
 }
 return best;
}
function editorSupportsPoints(){return state.editor.target==='room'||state.editor.target==='shell';}
function vertexOverlay(type,id){
 if(!state.editor.open||!state.editor.points||state.editor.target!==type||(type==='room'&&state.selected!==id))return '';
 const geometry=geometryFor(type,id)||baseGeometry(type,id);if(!geometry)return '';
 return `<g class="vertex-overlay" data-geometry-type="${type}" aria-hidden="true">${geometry.rings.map((ring,ringIndex)=>`<g data-ring="${ringIndex}"><polygon class="vertex-guide" points="${points(ring)}"/>${ring.map((point,index)=>{const next=ring[(index+1)%ring.length];return `<line class="vertex-edge" data-ring="${ringIndex}" data-edge="${index}" x1="${point[0]}" y1="${point[1]}" x2="${next[0]}" y2="${next[1]}"/><circle class="vertex-handle ${state.editor.selectedVertex?.ring===ringIndex&&state.editor.selectedVertex?.point===index?'active':''}" data-ring="${ringIndex}" data-point="${index}" cx="${point[0]}" cy="${point[1]}" r="6"/>`;}).join('')}</g>`).join('')}</g>`;
}
function spiral(){let steps='';const [cx,cy]=D.stairs[state.floor].spiral;for(let i=0;i<15;i++){const a=(i*19+25)*Math.PI/180,b=(i*19+43)*Math.PI/180;const p=[[cx+9*Math.cos(a),cy+9*Math.sin(a)],[cx+25*Math.cos(a),cy+25*Math.sin(a)],[cx+25*Math.cos(b),cy+25*Math.sin(b)],[cx+9*Math.cos(b),cy+9*Math.sin(b)]];steps+=`<polygon points="${points(p)}" fill="${i%2?'#c95040':'#b74032'}" stroke="#f2b8a0" stroke-width=".65"/>`;}
return `<g class="stair" role="button" tabindex="0" aria-label="Красная винтовая лестница" id="spiral"><title>Винтовая лестница · красная</title><circle cx="${cx}" cy="${cy}" r="30" fill="#fefefe"/><ellipse class="depth" cx="${cx+2}" cy="${cy+7}" rx="26" ry="25" fill="#743e2c" opacity=".12"/><g class="spiral-geometry" transform="rotate(-95 ${cx} ${cy})">${steps}<circle cx="${cx}" cy="${cy}" r="6" fill="#963326" stroke="#e49177" stroke-width="2"/><path d="M${cx+20} ${cy+17} A26 26 0 1 1 ${cx+24} ${cy-9}" fill="none" stroke="#923d30" stroke-width="2"/></g><text x="${cx}" y="${cy+42}" text-anchor="middle" font-size="7" fill="#a14b3a">ВИНТОВАЯ ЛЕСТНИЦА</text></g>`;}
function stairDetails(){
 const stairData=D.stairs[state.floor],regions=stairData.regions;
 const cleanupRooms=stairData.cleanupRooms==='all'?floorData().rooms:floorData().rooms.filter(r=>stairData.cleanupRooms.includes(r.n));
 // Hide dense source strokes only in the stair areas, on the background layer.
 // The new symbols are schematic: their tread count is not a measured stair count.
 return `<defs><mask id="stair-cleanup" maskUnits="userSpaceOnUse" x="0" y="0" width="1295" height="720" style="mask-type:luminance"><rect width="1295" height="720" fill="white"/>${regions.map(([x,y,w,h])=>`<rect x="${x-1}" y="${y-1}" width="${w+2}" height="${h+2}" fill="black"/>`).join('')}${cleanupRooms.map(r=>`<polygon class="mask-room" points="${points(roomPoints(r))}" fill="black" stroke="black" stroke-width="6" stroke-linejoin="round"/>`).join('')}</mask></defs>${stairMarkers()}`;
}
function stairFlight([cx,cy,width,length,angle,treadAngle=0]){
 const vertical=Math.abs(treadAngle)%180===90;
 const run=vertical?width:length;
 const count=Math.max(1,Math.floor((run-8)/5)-1);
 const spacing=(run-8)/(count+1);
 const treads=Array.from({length:count},(_,i)=>{
  const offset=-run/2+4+(i+1)*spacing;
  return vertical?`M${offset} ${-length/2+2}V${length/2-2}`:`M${-width/2+2} ${offset}H${width/2-2}`;
 }).join(' ');
 return `<g class="stair-flight" transform="translate(${cx} ${cy}) rotate(${angle})"><rect class="stair-landing" x="${-width/2}" y="${-length/2}" width="${width}" height="${length}" rx="1.5"/><path class="stair-treads" d="${treads}"/></g>`;
}
function stairMarkers(){return D.stairs[state.floor].drawings.map(flights=>`<g class="stair-marker" role="img" aria-label="Лестница"><title>Лестница · ${floorNames[state.floor]} · условное изображение</title>${flights.map(stairFlight).join('')}</g>`).join('');}
// No SVG filters on the map: every pan and zoom re-rasterizes them, which stalls older Intel Macs.
// The platform shadow is four stacked translucent strokes instead of a Gaussian blur.
function draw(){
 $('tooltip').hidden=true;tooltipRoom=null;
 const shape=outline();
  $('map').innerHTML=`<defs><linearGradient id="stone" x2=".4" y2="1"><stop stop-color="#FEFEFE"/><stop offset="1" stop-color="#BDBFC1"/></linearGradient></defs><g id="scene" transform="${transformFor('floor',state.floor)}"><g id="layer-shell" class="map-layer layer-shell" transform="${transformFor('shell',state.floor)}"><g class="platform-shadow" transform="translate(6 24)" aria-hidden="true"><path class="ps-1" d="${shape}"/><path class="ps-2" d="${shape}"/><path class="ps-3" d="${shape}"/><path class="ps-4" d="${shape}"/></g><path class="depth" d="${shape}" transform="translate(0 10)" fill="#083A81"/><path class="shell-face" d="${shape}" fill="url(#stone)" stroke="#226BD1" stroke-width="2" stroke-linejoin="round"/>${vertexOverlay('shell',state.floor)}</g><g id="layer-plan" class="map-layer layer-plan" transform="${transformFor('plan',state.floor)}"><g class="architecture" id="architecture-plan" mask="url(#stair-cleanup)">${floorData().background}</g>${stairDetails()}${D.stairs[state.floor].spiral?spiral():''}</g><g id="layer-rooms" class="map-layer layer-rooms" transform="${transformFor('rooms',state.floor)}">${floorData().rooms.slice().sort((a,b)=>center(roomPoints(a))[1]-center(roomPoints(b))[1]).map(roomSvg).join('')}</g>${typeof evacLayer==='function'?evacLayer():''}</g>`;
 $('map').querySelectorAll('.room').forEach(el=>{const r=floorData().rooms.find(r=>r.room_id===el.dataset.id);el.addEventListener('click',()=>{if(!state.suppressClick&&(!state.editor.open||state.editor.target==='room'))select(r.room_id);});el.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&(!state.editor.open||state.editor.target==='room')){e.preventDefault();select(r.room_id);}});el.addEventListener('pointerenter',e=>tooltip(e,r,true));el.addEventListener('pointermove',e=>tooltip(e,r));el.addEventListener('pointerleave',()=>{$('tooltip').hidden=true;});});
 if($('spiral')){$('spiral').onclick=showStair;$('spiral').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showStair();}};}updateFloorNav();updateMap();if(typeof evacAfterDraw==='function')evacAfterDraw();
}
// The text is rebuilt only when the pointer enters a room; moves inside it just reposition the tooltip.
let tooltipRoom=null;
function tooltip(e,r,refresh=false){if(state.drag)return;const rect=$('canvas').getBoundingClientRect();if(refresh||tooltipRoom!==r.room_id||$('tooltip').hidden){tooltipRoom=r.room_id;$('tooltip').innerHTML=`${esc(r.n)}${aliases[r.n]?' · '+esc(aliases[r.n]):''}${typeof evacActive==='function'&&evacActive()?'':`<small>${esc(statusText(r.room_id))}</small>`}`;}$('tooltip').hidden=false;$('tooltip').style.left=Math.max(8,Math.min(e.clientX-rect.left+12,rect.width-242))+'px';$('tooltip').style.top=Math.max(8,Math.min(e.clientY-rect.top+14,rect.height-66))+'px';}
// ---------- Light campus: clock, floors with sparklines, room callout and the day scrubber ----------
const MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DAY_START=8*60,DAY_END=18*60,DAY_STEP=5;
let occupancyKey='',occupancy={},scrubbing=false;
// Focus, realtime and the poll reload bookings as a new array with the same rows; compare the rows, not the array.
function bookingsSignature(list){return list.map(b=>`${b.id}|${b.room_id}|${b.booking_date}|${b.starts_at}|${b.ends_at}`).join(';');}
// Busy rooms per floor every five minutes of the selected day; recomputed only when the day or bookings change.
function floorOccupancy(floor){const rooms=D.floors[floor].rooms.map(r=>r.room_id),saved=state.minute,values=[];for(let t=DAY_START;t<=DAY_END;t+=DAY_STEP){state.minute=t;values.push(rooms.filter(id=>status(id)==='busy').length);}state.minute=saved;return values;}
function refreshOccupancy(){const key=`${state.date}|${bookingsSignature(bookings)}`;if(key===occupancyKey)return false;occupancyKey=key;occupancy=Object.fromEntries(Object.keys(D.floors).map(f=>[f,floorOccupancy(f)]));return true;}
function liveMinute(){const c=clock();return dateFrom(c)===state.date?Number(c.hour)*60+Number(c.minute):null;}
function sparkPoint(index,value,total){return [(index/((DAY_END-DAY_START)/DAY_STEP)*88+2).toFixed(1),(28-value/Math.max(1,total)*24).toFixed(1)];}
function renderFloorList(){
 const floors=Object.keys(D.floors).sort((a,b)=>Number(b)-Number(a));
 $('floors').innerHTML=floors.map(f=>{const total=D.floors[f].rooms.length,values=occupancy[f]||[],points=values.map((v,i)=>i%6?null:sparkPoint(i,Math.max(...values.slice(i,i+6)),total).join(',')).filter(Boolean).join(' ');return `<button type="button" data-floor="${f}" class="${f===state.floor?'active':''}" aria-pressed="${f===state.floor}" aria-label="${floorNames[f]}"><span class="floor-n">${f}</span><span class="floor-t"><b data-floor-busy>0</b> из ${total} заняты</span><svg class="spark" viewBox="0 0 92 30" aria-hidden="true" focusable="false"><polyline points="${points}"/><circle r="3.5" cx="2" cy="28"/></svg></button>`;}).join('');
 $('floors').querySelectorAll('button').forEach(b=>b.onclick=()=>changeFloor(b.dataset.floor));
}
function updateFloorCounts(){
 const t=Math.max(DAY_START,Math.min(DAY_END,state.minute)),index=Math.round((t-DAY_START)/DAY_STEP);
 $('floors').querySelectorAll('button').forEach(button=>{const f=button.dataset.floor,rooms=D.floors[f].rooms,busy=rooms.filter(r=>status(r.room_id)==='busy').length,bucket=index-index%6,[x,y]=sparkPoint(index,Math.max(0,...(occupancy[f]||[]).slice(bucket,bucket+6)),rooms.length),dot=button.querySelector('circle');button.querySelector('[data-floor-busy]').textContent=busy;if(dot){dot.setAttribute('cx',x);dot.setAttribute('cy',y);}});
}
function periodLine(){
 if(dayIndex()>4)return 'Выходной: уроков по расписанию нет';
 const bells=D.bells.secondary,t=state.minute,current=bells.findIndex(([a,b])=>min(a)<=t&&t<min(b));
 if(current>=0)return `Идёт ${current} урок · до перемены ${min(bells[current][1])-t} мин`;
 const next=bells.findIndex(([a])=>min(a)>t);
 const lunch=lunchFor('secondary'),atLunch=Boolean(lunch&&min(lunch[0])<=t&&t<min(lunch[1]));
 return next===0?`Уроки начнутся в ${bells[0][0]}`:next>0?`${atLunch?'Обед':'Перемена'} · ${next} урок в ${bells[next][0]}`:'Уроки на сегодня закончились';
}
function updateClockMeta(){
 const [, month, day]=state.date.split('-'),live=liveMinute()===state.minute;
 $('clock-weekday').textContent=`${DAYS[dayIndex()]}, ${Number(day)} ${MONTHS[Number(month)-1]}`;
 $('now').textContent=live?'Сейчас':'Вернуться к сейчас';$('now').classList.toggle('is-live',live);
 $('period-line').textContent=periodLine();
}
function renderFreeNow(){
 const free=floorData().rooms.filter(r=>status(r.room_id)==='free'),when=liveMinute()===state.minute?'сейчас':`в ${fmt(state.minute)}`;
 $('free-now').innerHTML=free.length?`<span class="free-label">Свободно ${when}:</span> ${free.map((r,i)=>`${i?`<span class="sep${i>5?' extra':''}"> · </span>`:''}<button type="button" data-free-room="${esc(r.room_id)}" class="${i>5?'extra':''}">${esc(r.n)}</button>`).join('')}${free.length>6?`<span class="more-count"> и ещё ${free.length-6}</span>`:''}`:`Свободных кабинетов ${when} на этаже нет`;
 $('free-now').insertAdjacentHTML('beforeend','<button type="button" class="free-more" data-free-more>Другое время</button>');$('free-now').querySelector('[data-free-more]').onclick=openAvailability;
 $('free-now').querySelectorAll('[data-free-room]').forEach(button=>button.onclick=()=>select(button.dataset.freeRoom));
}
function renderScrubBars(){
 const values=occupancy[state.floor]||[],total=floorData().rooms.length,width=100/Math.max(1,values.length),[, month, day]=state.date.split('-');
 $('scrub-bars').innerHTML=values.map((v,i)=>`<i data-t="${DAY_START+i*DAY_STEP}" style="left:${(i*width).toFixed(3)}%;width:calc(${width.toFixed(3)}% - 1px);height:${Math.max(3,v/Math.max(1,total)*100).toFixed(1)}%"></i>`).join('');
 $('scrubber-label').textContent=`Занятость за день · ${floorNames[state.floor]}`;$('scrubber-date').textContent=`${DAYS[dayIndex()]}, ${day}/${month}`;
}
function updateScrubHead(){
 const t=Math.max(DAY_START,Math.min(DAY_END,state.minute));
 $('scrub-head').style.left=`${(t-DAY_START)/(DAY_END-DAY_START)*100}%`;$('scrub-time').textContent=fmt(state.minute);
 $('scrub-bars').querySelectorAll('i').forEach(bar=>bar.classList.toggle('past',Number(bar.dataset.t)<state.minute));
}
function scrubTo(event){const rect=$('scrub-track').getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-rect.left)/(rect.width||1)));state.minute=Math.round((DAY_START+x*(DAY_END-DAY_START))/DAY_STEP)*DAY_STEP;updateMap();renderCard();}
function renderCallout(){
 if(typeof evacActive==='function'&&evacActive()){evacRenderCallout();return;}
 const box=$('room-callout'),r=floorData().rooms.find(r=>r.room_id===state.selected);if(!r){box.hidden=true;box.innerHTML='';return;}
 const st=cardStatus(r.room_id),active=roomEvents(r.room_id).find(e=>e.start<=state.minute&&state.minute<e.end),progress=active?Math.round((state.minute-active.start)/Math.max(1,active.end-active.start)*100):null;
 const place=r.room_id==='assembly-hall'?'Этажи 3–4 · один зал':[aliases[r.n]||(r.n==='FTC'?'Лаборатория':/^\d/.test(r.n)?'Учебное пространство':''),floorNames[state.floor]].filter(Boolean).join(' · ');
 const action=!bookingAllowedRoom(r.room_id)?`<p class="callout-lock">${iconSvg('lock')}<span>${r.room_id==='f1-gym'?'Спортзал не бронируется':'Бронируют только суперадмины'}</span></p>`:hasCloud()?`<button type="button" class="primary-button" data-callout-book>${canBook()?'Забронировать':'Войти и забронировать'}</button>`:'';
 box.innerHTML=`<div class="callout-card"><div class="callout-head"><b>${esc(r.n)}</b><span>${esc(place)}</span></div><p class="callout-status">${esc(st.label)}${st.detail?` ${esc(st.detail)}`:''}</p>${st.note?`<p class="callout-note">${esc(st.note)}</p>`:''}${progress!==null?`<div class="callout-progress"><i style="width:${progress}%"></i></div>`:''}<div class="callout-actions"><button type="button" class="secondary-button" data-callout-day>Весь день</button>${action}</div></div>`;
 box.querySelector('[data-callout-day]').onclick=()=>openRoomPanel();
 const book=box.querySelector('[data-callout-book]');if(book)book.onclick=()=>canBook()?openBooking():session?toast('Ваша почта пока не в списке сотрудников. Обратитесь к администратору.'):openAuth();
 box.hidden=false;positionCallout();
}
// The callout follows the selected room through pan and zoom: above it, or beside it near the top edge.
function positionCallout(){
 const box=$('room-callout'),floor=$('map').querySelector('.room.selected .floor'),canvas=$('canvas');
 if(!floor||!box.innerHTML||!floor.getBoundingClientRect||!canvas.getBoundingClientRect){box.hidden=true;return;}
 const c=canvas.getBoundingClientRect(),r=floor.getBoundingClientRect();if(!c.width)return;
 const height=box.offsetHeight||190,width=300,cx=r.left+r.width/2-c.left,above=r.top-c.top>height+24,right=r.right-c.left+width+24<c.width;
 box.classList.toggle('beside',!above);box.classList.toggle('left',!above&&!right);
 box.style.left=`${above?Math.max(width/2,Math.min(c.width-width/2,cx)):right?r.right-c.left:r.left-c.left}px`;
 box.style.top=`${above?r.top-c.top:Math.max(height/2,Math.min(c.height-height/2,r.top+r.height/2-c.top))}px`;
 box.hidden=cx<0||cx>c.width||r.bottom<c.top||r.top>c.bottom||$('room-card').closest('.panel').classList.contains('open');
}
function openRoomPanel(){const panel=$('room-card').closest('.panel');panel.classList.add('open','expanded');$('room-callout').hidden=true;$('sheet-handle').setAttribute('aria-expanded','true');$('panel-close').focus?.();}
function closeRoomPanel(){const panel=$('room-card').closest('.panel');panel.classList.remove('open','expanded');$('sheet-handle').setAttribute('aria-expanded','false');positionCallout();}
function renderCampus(){if(refreshOccupancy()){renderFloorList();renderScrubBars();}updateFloorCounts();updateClockMeta();renderFreeNow();updateScrubHead();positionCallout();}
function updateMap(){let busy=0,free=0;$('map').querySelectorAll('.room').forEach(el=>{const id=el.dataset.id,s=status(id);el.classList.toggle('selected',id===state.selected);el.setAttribute('aria-pressed',String(id===state.selected));el.classList.toggle('busy',s==='busy');el.classList.toggle('free',s==='free');el.classList.toggle('booked',roomBookings(id).length>0);el.classList.toggle('unknown',s==='unknown');el.classList.toggle('editor-target',state.editor.open&&state.editor.target==='room'&&id===state.selected);if(s==='busy')busy++;if(s==='free')free++;});['shell','plan','rooms'].forEach(type=>$(`layer-${type}`)?.classList.toggle('editor-layer-target',state.editor.open&&state.editor.target===type));$('busy-count').textContent=busy;$('free-count').textContent=free;$('time').value=state.minute;$('time-input').value=fmt(state.minute);$('time-value').textContent=fmt(state.minute);renderCampus();}
function select(id,preferredFloor){const floors=roomFloors(id);if(!floors.length)return;bookingOpenRequest++;const target=preferredFloor&&floors.includes(preferredFloor)?preferredFloor:floors.includes(state.floor)?state.floor:floors[0];if(target!==state.floor){changeFloor(target,id);return;}state.selected=id;revealRoom(id);updateMap();renderCard();if(state.editor.open&&state.editor.target==='room')updateEditorFields();$('search-results').hidden=true;}
function showStair(){state.selected=null;updateMap();$('room-card').innerHTML=`<div class="room-heading"><div class="room-title"><h2 class="long-title">Винтовая лестница</h2></div><p class="room-eyebrow">Ориентир · ${floorNames[state.floor]}</p><p class="room-name">Красная, как в школе</p></div><p class="empty">Лестница отмечена в центральной части этажа. Выберите кабинет, чтобы вернуться к расписанию.</p>`;}
const overlaps=(a,b,c,d)=>min(a)<min(d)&&min(c)<min(b);
const iconSvg=name=>`<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
function bookingCards(id){
 const items=roomBookings(id);
 if(!items.length)return '';
 return `<div class="booking-list">${items.map(b=>`<div class="booking-card"><strong>${esc(String(b.starts_at).slice(0,5))}–${esc(String(b.ends_at).slice(0,5))} · ${esc(b.purpose)}</strong><span>${esc(b.created_by_name||'Сотрудник')}</span>${canManage(b)?`<button class="booking-edit" data-booking="${b.id}" type="button">Изменить</button>`:''}</div>`).join('')}</div>`;
}
// Everything that occupies the room on the selected day, in minutes, for "until when" in the card status.
function roomEvents(id){
 const events=daily(id).map(l=>{const [a,b]=lessonTimes(l);return {start:min(a),end:min(b),label:l.subject_teacher};});
 dailyClubs(id).forEach(club=>{const [first,last]=clubPeriods(club),bells=D.bells.secondary;if(bells[first]&&bells[last])events.push({start:min(bells[first][0]),end:min(bells[last][1]),label:`Кружок · ${club.title}`});});
 roomBookings(id).forEach(x=>events.push({start:min(String(x.starts_at).slice(0,5)),end:min(String(x.ends_at).slice(0,5)),label:`Бронь · ${x.purpose}`}));
 return events.sort((a,b)=>a.start-b.start);
}
function cardStatus(id){
 const s=status(id),now=state.minute,events=roomEvents(id);
 if(s==='unknown')return {s,label:'Нет данных',detail:'',note:statusText(id)};
 if(s==='busy'){const active=events.filter(e=>e.start<=now&&now<e.end);return {s,label:statusText(id).replace(' по расписанию','').replace('Кабинет занят','Занят'),detail:active.length?`до ${fmt(Math.max(...active.map(e=>e.end)))}`:'',note:active[0]?.label||''};}
 const next=events.find(e=>e.start>now);
 return {s,label:'Свободен',detail:next?`до ${fmt(next.start)}`:'до конца дня',note:next?`Дальше: ${next.label}`:''};
}
// Строка «Обед» в расписании кабинета: уроков в это окно нет, показываем брони и календарь зала.
function lunchSlotRow(r,[a,b],saved,known){
 const reserved=saved.filter(x=>overlaps(a,b,x.starts_at,x.ends_at)),calendarBusySlot=r.room_id===HALL_ROOM&&hallOccupied(state.date,a,b);
 const currentSlot=min(a)<=state.minute&&state.minute<min(b),past=!currentSlot&&min(b)<=state.minute;
 const content=calendarBusySlot?`<div class="lesson-title">Занято по календарю или брони</div><div class="lesson-meta">${a}–${b}</div>`:known?`<div class="lesson-title">Свободно</div><div class="lesson-meta">${a}–${b}</div>`:`<div class="lesson-title">${r.room_id===HALL_ROOM?'Доступность не подтверждена':'Нет данных об уроках'}</div><div class="lesson-meta">${a}–${b}</div>`;
 const reservations=reserved.map(x=>`<div class="slot-booking"><strong>Бронь · ${esc(x.purpose)}</strong><span>${esc(x.created_by_name||'Сотрудник')} · ${esc(String(x.starts_at).slice(0,5))}–${esc(String(x.ends_at).slice(0,5))}</span></div>`).join('');
 const classes=['slot','lunch-slot',!calendarBusySlot&&known&&'free',!known&&'unknown-slot',(reserved.length||calendarBusySlot)&&'reserved',currentSlot&&'current',past&&'past'].filter(Boolean).join(' ');
 return `<div class="${classes}"><div class="period"><span class="period-time">${a}</span><small>обед</small></div><div>${content}${reservations}</div></div>`;
}
function renderCard(){
 if(typeof evacActive==='function'&&evacActive()){evacRenderCard();return;}
 const r=floorData().rooms.find(r=>r.room_id===state.selected);if(!r)return;
 const lessons=daily(r.room_id),clubs=dailyClubs(r.room_id),known=r.room_id===HALL_ROOM&&hallAvailability(state.date)!=='disabled'?hallAvailability(state.date)==='ready':roomKnown(r.room_id),saved=roomBookings(r.room_id);
 const hasScheduleActivity=known||clubs.length||saved.length;
 const slotRows=Array.from({length:11},(_,period)=>{
  const ls=lessons.filter(l=>Number(l.period)===period),cs=clubs.filter(club=>{const [start,end]=clubPeriods(club);return start<=period&&period<=end;}),[a,b]=D.bells[state.band][period];
  const reserved=saved.filter(x=>overlaps(a,b,x.starts_at,x.ends_at)),calendarBusySlot=r.room_id===HALL_ROOM&&hallOccupied(state.date,a,b);
  const occupied=ls.length||cs.length,currentSlot=(occupied?ls.some(l=>{const [x,y]=lessonTimes(l);return min(x)<=state.minute&&state.minute<min(y);})||Boolean(cs.length&&min(a)<=state.minute&&state.minute<min(b)):min(a)<=state.minute&&state.minute<min(b))||reserved.some(x=>min(x.starts_at)<=state.minute&&state.minute<min(x.ends_at));
  const past=!currentSlot&&min(b)<=state.minute;
  const lessonContent=ls.map(l=>{const times=lessonTimes(l);return `<div class="slot-item"><div class="lesson-title">${esc(l.subject_teacher)}</div><div class="lesson-meta">${esc((l.classes||[]).join(', '))} · ${esc(times[0])}–${esc(times[1])}</div></div>`;});
  const clubContent=cs.map(club=>`<div class="slot-item"><div class="lesson-title club-lesson">Кружок · ${esc(club.title)}</div><div class="lesson-meta">${club.details?.length?`${club.details.map(esc).join(' · ')} · `:''}${a}–${b}</div></div>`);
  const content=occupied?[...lessonContent,...clubContent].join(''):calendarBusySlot?`<div class="lesson-title">Занято по календарю или брони</div><div class="lesson-meta">${a}–${b}</div>`:known?`<div class="lesson-title">Свободно</div><div class="lesson-meta">${a}–${b}</div>`:`<div class="lesson-title">${r.room_id===HALL_ROOM?'Доступность не подтверждена':'Нет данных об уроках'}</div><div class="lesson-meta">${a}–${b}</div>`;
  const reservations=reserved.map(x=>`<div class="slot-booking"><strong>Бронь · ${esc(x.purpose)}</strong><span>${esc(x.created_by_name||'Сотрудник')} · ${esc(String(x.starts_at).slice(0,5))}–${esc(String(x.ends_at).slice(0,5))}</span></div>`).join('');
  const classes=['slot',!occupied&&!calendarBusySlot&&known&&'free',!occupied&&!known&&'unknown-slot',cs.length&&'club-slot',(reserved.length||calendarBusySlot)&&'reserved',currentSlot&&'current',past&&'past'].filter(Boolean).join(' ');
  return `<div class="${classes}"><div class="period"><span class="period-time">${a}</span><small><strong>${period}</strong> ур.</small></div><div>${content}${reservations}</div></div>`;
 });
 const lunch=lunchFor(state.band),lunchAt=lunchIndex(state.band);if(lunch&&lunchAt>0)slotRows.splice(lunchAt,0,lunchSlotRow(r,lunch,saved,known));
 const slots=slotRows.join('');
 const slotLock=lockedBookingSlot({room_id:r.room_id,booking_date:state.date,starts_at:'00:00',ends_at:'23:59'});
 const bookingAction=!bookingAllowedRoom(r.room_id)?`<p class="card-lock">${iconSvg('lock')}<span>${restrictedBookingNotice(r.room_id)}</span></p>`:hasCloud()?`<button id="book-room" class="booking-button" type="button">${canBook()?'Забронировать кабинет':session?'Доступ ожидает подтверждения':'Войти и забронировать кабинет'}</button>${slotLock?`<p class="card-note" data-slot-lock>${slotLock.notice}.</p>`:''}`:'<p class="card-note">Онлайн-бронирование пока не подключено.</p>';
 const hallNotice=isHallRoom(r.room_id)?`<p class="booking-notice" data-booking-notice>${HALL_NOTICE}</p>`:'';
 const isHall=r.room_id==='assembly-hall',st=cardStatus(r.room_id);
 const place=isHall?'Этажи 3–4 · один зал':[aliases[r.n]||(r.n==='FTC'?'Лаборатория':/^\d/.test(r.n)?'Учебное пространство':''),floorNames[state.floor]].filter(Boolean).join(' · ');
 const [, month, day]=state.date.split('-');
 $('room-card').innerHTML=`<div class="room-heading"><div class="room-title"><h2 class="${r.n.length>8?'long-title':''}">${esc(r.n)}</h2></div><p class="room-eyebrow">${esc(place)}</p>${isHall?'<p class="room-name">Вход с третьего и четвёртого этажей</p>':''}<div class="room-status"><span class="status ${st.s}"><i></i>${esc(st.label)}</span>${st.detail||st.note?`<div><strong>${esc(st.detail)}</strong>${st.note?`<small>${esc(st.note)}</small>`:''}</div>`:''}</div></div>${hallNotice}${bookingAction}${saved.length?`<div class="panel-title">Брони на дату <small>${saved.length}</small></div>${bookingCards(r.room_id)}`:''}<div class="panel-title">${esc(DAYS[dayIndex()])}, ${day}/${month}${known&&hasScheduleActivity?`<label class="band-select"><span class="sr-only">Звонки для свободных окон</span><select id="band" aria-label="Звонки для свободных окон"><option value="secondary" ${state.band==='secondary'?'selected':''}>6–11 кл.</option><option value="primary" ${state.band==='primary'?'selected':''}>1–5 кл.</option></select></label>`:''}</div>${hasScheduleActivity?`<div class="timeline">${slots}</div>`:'<p class="empty">В выгрузке EduPage для этого помещения нет занятий. Его доступность пока не подтверждена.</p>'}<p class="panel-note">Уроки из EduPage · кружки на 9–10 уроках · брони видят все</p>`;
 $('band')?.addEventListener('change',e=>{state.band=e.target.value;renderCard();});
 $('book-room')?.addEventListener('click',()=>canBook()?openBooking():session?toast('Ваша почта пока не в списке сотрудников. Обратитесь к администратору.'):openAuth());
 $('room-card').querySelectorAll('[data-booking]').forEach(button=>button.onclick=()=>openBooking(bookings.find(b=>String(b.id)===button.dataset.booking)));
 renderCallout();
 if(r.room_id===HALL_ROOM){const snapshot=currentHallSnapshot(state.date),mode=hallAvailability(state.date),note=document.createElement('p');note.className='card-note';note.textContent=mode==='disabled'?'Календарь пока отключён. Используется расписание карты.':mode==='ready'?`Доступность проверена: ${formatTimestamp(snapshot.busy.as_of)}.`:'Доступность зала не подтверждена. Новые изменения требуют свежей проверки.';$('room-card').appendChild(note);if(syncAccess()){const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent='События календаря зала';button.onclick=openSyncCalendar;$('room-card').appendChild(button);}if($('book-room')&&mode==='unknown')$('book-room').disabled=true;}
}
 function updateDate(reload=false){if(reload){bookingLoadRequest++;bookings=[];}syncDateField('date',state.date);$('days').innerHTML=short.map((d,i)=>`<button data-day="${i}" class="${i===dayIndex()?'active':''}" aria-label="${DAYS[i]}" aria-pressed="${i===dayIndex()}">${d}</button>`).join('');$('days').querySelectorAll('button').forEach(b=>b.onclick=()=>shiftDate(Number(b.dataset.day)-dayIndex()));updateMap();renderCard();if(reload)loadBookings();void refreshHall();}
function shiftDate(delta){bookingOpenRequest++;const d=dateObj(state.date);d.setUTCDate(d.getUTCDate()+delta);state.date=d.toISOString().slice(0,10);updateDate(true);}
function showModal(dialog){if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');}
function hideModal(dialog){if(dialog.close)dialog.close();else dialog.removeAttribute('open');}
function bookingFormSnapshot(){return Array.from($('booking-form').querySelectorAll('input,select,textarea')).map(field=>[field.id,field.value,field.checked??null]);}
function captureBookingDraft(){bookingDraftSnapshot=JSON.stringify(bookingFormSnapshot());}
function bookingFormDirty(){return bookingDraftSnapshot!==null&&bookingDraftSnapshot!==JSON.stringify(bookingFormSnapshot());}
function clearBookingDraft(){bookingDraftSnapshot=null;}
function closeBookingDialog(){if(bookingCommandBusy)return false;if(bookingFormDirty()&&!window.confirm?.('Отменить изменения и закрыть форму?'))return false;bookingModalRevision++;bookingContextRequest++;bookingConflictChoice=null;clearBookingDraft();hideModal($('booking-dialog'));return true;}
function handleBookingDialogCancel(event){if(bookingCommandBusy){event.preventDefault();return;}if(!bookingFormDirty()){bookingModalRevision++;bookingContextRequest++;bookingConflictChoice=null;clearBookingDraft();return;}if(!window.confirm?.('Отменить изменения и закрыть форму?'))event.preventDefault();else{bookingModalRevision++;bookingContextRequest++;bookingConflictChoice=null;clearBookingDraft();}}
function closeBookingBoard(internal=false){if(!internal)bookingOpenRequest++;if(internal)bookingBoardInternalClose=true;hideModal($('booking-board-dialog'));if(internal)bookingBoardInternalClose=false;}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true;},4200);}
function calendarIdentity(){return session?.user?.id||'';}
function calendarAccessAllowed(){return Boolean(superadmin&&!auditAccessBlocked&&session?.user?.id&&session?.access_token);}
function calendarCurrent(request,capturedUser,capturedToken){return request===calendarRequest&&calendarAccessAllowed()&&session?.user?.id===capturedUser&&session?.access_token===capturedToken&&$('calendar-dialog')?.hasAttribute('open');}
function invalidateCalendarPreview(message=''){calendarPreviewRequest++;calendarPreviewController?.abort();calendarPreviewController=null;calendarPreviewRequestBusy=false;const results=$('calendar-preview-results'),status=$('calendar-preview-message');if(results)results.textContent='';if(status){status.className='form-message';status.textContent=message;}updateCalendarPreviewButton();}
function calendarPreviewButtonEnabled(){return Boolean(calendarAccessAllowed()&&calendarStatus?.connected===true&&!calendarBusy);}
function updateCalendarPreviewButton(){const button=$('calendar-preview-run');if(button)button.disabled=!calendarPreviewButtonEnabled()||calendarPreviewRequestBusy;}
let calendarPreviewRequestBusy=false;
function calendarPreviewRange(){const start=dateFieldValue('calendar-preview-from'),through=dateFieldValue('calendar-preview-through');if(!start||!through)return {error:'Введите обе даты в формате ДД/ММ/ГГГГ.'};if(start<'2020-01-01'||through>'2100-12-31')return {error:'Период сверки должен быть с 2020 по 2100 год.'};if(start>through)return {error:'Начало периода не может быть позже последнего дня.'};const days=(dateObj(through)-dateObj(start))/86400000+1;if(days>31)return {error:'Период может составлять не более 31 дня.'};const end=dateObj(through);end.setUTCDate(end.getUTCDate()+1);return {start,end:end.toISOString().slice(0,10)};}
function calendarPreviewCurrent(request,user,token,start,through){return request===calendarPreviewRequest&&calendarAccessAllowed()&&calendarStatus?.connected===true&&session?.user?.id===user&&session?.access_token===token&&$('calendar-dialog')?.hasAttribute('open')&&dateFieldValue('calendar-preview-from')===start&&dateFieldValue('calendar-preview-through')===through;}
function calendarPreviewError(status,data){const code=String(data?.error||data?.code||'');if(status===401)return 'Сессия устарела. Войдите снова.';if(status===403)return 'Недостаточно прав для просмотра календаря.';if(status===0)return 'Не удалось получить ответ вовремя. Попробуйте ещё раз.';if(['invalid_range','date_range_invalid'].includes(code))return 'Проверьте даты периода сверки.';if(code==='calendar_not_connected'||code==='not_connected')return 'Подключение календаря не найдено. Проверьте статус подключения.';if(code==='preview_changed')return 'Данные изменились во время сверки. Запустите проверку ещё раз.';if(['calendar_incomplete','preview_too_large','provider_failed','providerfailed'].includes(code))return 'Не удалось получить полную сверку. Попробуйте позже.';if(status===404||status===503)return 'Предварительная сверка пока недоступна.';return 'Не удалось загрузить предварительную сверку. Попробуйте ещё раз.';}
function calendarPreviewTime(value){const text=String(value??'');if(!text||text.length>80)return 'Время не указано';return formatTimestamp(text);}
function calendarPreviewHtml(data,expectedStart,expectedEnd){
 const counts=data.counts,events=data.events,bookings=data.bookings,conflicts=data.conflicts;
 if(data.mode!=='preview'||data.complete!==true||!counts||!Array.isArray(events)||!Array.isArray(bookings)||!Array.isArray(conflicts)||!events.every(event=>event&&typeof event==='object')||!bookings.every(booking=>booking&&typeof booking==='object')||!conflicts.every(conflict=>conflict&&typeof conflict==='object')||!['events','occupying','free','cancelled','bookings','conflicts'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0))return null;
 const eventById=new Map(events.map(event=>[String(event.id),event])),bookingById=new Map(bookings.map(booking=>[String(booking.id),booking]));
 const parsedStart=parseISODate(data.start_date);
 if(!parsedStart||parsedStart.iso!==expectedStart||data.end_date!==expectedEnd)return null;
 const lastDay=dateObj(expectedEnd);lastDay.setUTCDate(lastDay.getUTCDate()-1);
 const dateRange=`${isoToDisplayDate(parsedStart.iso)}—${isoToDisplayDate(lastDay.toISOString().slice(0,10))}`;
 const eventRows=events.map(event=>{const title=event.private===true?'Закрытое событие':String(event.title??'Событие').slice(0,160);const labels=[event.private===true?'Закрытое':event.occupies_time===true?'Занимает время':'Прозрачное событие',event.all_day===true?'Весь день':'',event.private!==true&&event.recurring===true?'Повторяется':''].filter(Boolean).join(' · ');return `<li><strong>${esc(title)}</strong><span>${esc(calendarPreviewTime(event.start_at))} — ${esc(calendarPreviewTime(event.end_at))} · ${esc(labels)}</span></li>`;}).join('');
 const bookingRows=bookings.map(booking=>{const when=`${isoToDisplayDate(String(booking.booking_date||''))} ${String(booking.starts_at||'').slice(0,5)}–${String(booking.ends_at||'').slice(0,5)}`;return `<li><strong>${esc(when)}</strong><span>${esc(String(booking.purpose||'').slice(0,240))} · ${esc(String(booking.created_by_name||'Сотрудник').slice(0,120))}</span></li>`;}).join('');
 const conflictRows=conflicts.map(conflict=>{const event=eventById.get(String(conflict.event_id)),booking=bookingById.get(String(conflict.booking_id));if(!event||!booking)return '';const when=`${isoToDisplayDate(String(booking.booking_date||''))} ${String(booking.starts_at||'').slice(0,5)}–${String(booking.ends_at||'').slice(0,5)}`;const eventTitle=event.private===true?'Закрытое событие':String(event.title??'Событие').slice(0,160);return `<li><strong>${esc(when)} · ${esc(eventTitle)}</strong><span>${esc(String(booking.purpose||'').slice(0,240))} · ${esc(String(booking.created_by_name||'Сотрудник').slice(0,120))}</span></li>`;}).join('');
 return `<div class="calendar-preview-summary"><span>События: <strong>${counts.events}</strong></span><span>Занимают время: <strong>${counts.occupying}</strong></span><span>Прозрачные события: <strong>${counts.free}</strong></span><span>Отменены: <strong>${counts.cancelled}</strong></span><span>Брони: <strong>${counts.bookings}</strong></span><span>Совпадения: <strong>${counts.conflicts}</strong></span></div><p class="calendar-preview-stamp">Период: ${esc(dateRange)} · На момент проверки; события и брони могут измениться.</p><h4>События календаря</h4>${eventRows?`<ul>${eventRows}</ul>`:'<p>Событий за период нет.</p>'}<h4>Брони актового зала</h4>${bookingRows?`<ul>${bookingRows}</ul>`:'<p>Броней за период нет.</p>'}<h4>Совпадения по времени брони</h4>${conflictRows?`<ul class="calendar-preview-conflicts">${conflictRows}</ul>`:'<p>Совпадений по времени брони не найдено.</p>'}<p class="calendar-preview-disclaimer">Это сравнение событий с бронями. Оно не импортирует расписание и не определяет свободное время зала.</p>`;
}
async function loadCalendarPreview(){if(!calendarPreviewButtonEnabled()||calendarPreviewRequestBusy)return false;const range=calendarPreviewRange(),message=$('calendar-preview-message');invalidateCalendarPreview();if(range.error){message.className='form-message error';message.textContent=range.error;return false;}const start=range.start,through=dateFieldValue('calendar-preview-through'),request=++calendarPreviewRequest,user=calendarIdentity(),token=session.access_token,controller=new AbortController();calendarPreviewController=controller;calendarPreviewRequestBusy=true;updateCalendarPreviewButton();message.className='form-message';message.textContent='Загружаем сверку…';const timer=setTimeout(()=>controller.abort(),CALENDAR_PREVIEW_TIMEOUT_MS);let result={status:0,data:null};try{const response=await fetch(`${D.supabase.url}/functions/v1/google-calendar-preview`,{method:'POST',headers:{apikey:D.supabase.publishableKey,Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({start_date:start,end_date:range.end}),signal:controller.signal});let data=null;try{data=await response.json();}catch{}result={status:response.status,data};}catch{}finally{clearTimeout(timer);}if(!calendarPreviewCurrent(request,user,token,start,through))return false;calendarPreviewRequestBusy=false;calendarPreviewController=null;updateCalendarPreviewButton();if(result.status!==200||!result.data||typeof result.data!=='object'||Array.isArray(result.data)){message.className='form-message error';message.textContent=calendarPreviewError(result.status,result.data);return false;}const rendered=calendarPreviewHtml(result.data,start,range.end);if(rendered===null){message.className='form-message error';message.textContent='Сервер вернул неполную сверку. Повторите запрос позже.';return false;}$('calendar-preview-results').innerHTML=rendered;message.className='form-message success';message.textContent='Сверка загружена.';return true;}
function clearCalendarPending(){calendarPending=null;clearTimeout(calendarExpiryTimer);calendarExpiryTimer=null;const link=$('calendar-open-google');if(link){link.hidden=true;link.removeAttribute('href');}updateCalendarDialog();}
function calendarMessage(status){return status===401?'Сессия устарела. Войдите снова.':status===403?'Недостаточно прав для подключения календаря.':status===503?'Подключение календаря пока недоступно: сервер ещё не настроен.':'Не удалось выполнить действие с календарём. Попробуйте ещё раз.';}
function calendarPendingTerminal(value){return ['expired','superseded','confirmed','failed','cancelled'].includes(String(value||'').toLowerCase());}
function calendarExpiry(expiresAt){const when=Date.parse(expiresAt);if(!Number.isFinite(when))return false;clearTimeout(calendarExpiryTimer);const delay=Math.max(0,when-Date.now());calendarExpiryTimer=setTimeout(()=>{if(calendarPending?.expiresAt===expiresAt){clearCalendarPending();$('calendar-message').className='form-message error';$('calendar-message').textContent='Срок проверки истёк. Начните подключение заново.';}},delay);return when>Date.now();}
function updateCalendarDialog(){const status=$('calendar-status'),link=$('calendar-open-google'),start=$('calendar-start'),check=$('calendar-check'),confirm=$('calendar-confirm'),disconnect=$('calendar-disconnect');if(!status)return;const value=calendarStatus||{};status.innerHTML=value.connected?`<strong>Подключено</strong><span>${esc(value.google_email||'Google Calendar')} · локальное подключение активно</span>`:'<strong>Не подключено</strong><span>Подключение к календарю пока не подтверждено.</span>';const validPending=Boolean(calendarPending&&calendarPending.userId===calendarIdentity()&&calendarPending.expiresAt&&Date.parse(calendarPending.expiresAt)>Date.now()&&value.pending===true&&value.pending_status==='staged'&&String(value.pending_attempt_id)===String(calendarPending.attemptId));if(start)start.disabled=calendarBusy;if(check)check.disabled=calendarBusy;confirm.disabled=!validPending||calendarBusy;disconnect.hidden=!value.connected;disconnect.disabled=calendarBusy;if(!calendarPending){link.hidden=true;link.removeAttribute('href');}else link.hidden=false;updateCalendarPreviewButton();}
async function calendarFetch(path,body,capturedUser,capturedToken){if(!cloud||!capturedToken||!capturedUser)return {status:401,data:null};const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),CALENDAR_FETCH_TIMEOUT_MS);try{const response=await fetch(`${D.supabase.url}/functions/v1/google-calendar-connect/${path}`,{method:'POST',headers:{apikey:D.supabase.publishableKey,Authorization:`Bearer ${capturedToken}`,'content-type':'application/json'},body:JSON.stringify(body||{}),signal:controller.signal});let data=null;try{data=await response.json();}catch{}return {status:response.status,data};}catch{return {status:0,data:null};}finally{clearTimeout(timer);}}
async function loadCalendarStatus({internal=false}={}){if(!calendarAccessAllowed()||calendarBusy&&!internal)return false;const request=++calendarRequest,capturedUser=calendarIdentity(),capturedToken=session.access_token;calendarBusy=true;updateCalendarDialog();const result=await calendarFetch('status',{},capturedUser,capturedToken);if(!calendarCurrent(request,capturedUser,capturedToken))return false;calendarBusy=false;if(result.status!==200||!result.data||typeof result.data!=='object'||Array.isArray(result.data)){calendarStatus=null;invalidateCalendarPreview();clearCalendarPending();$('calendar-message').className='form-message error';$('calendar-message').textContent=calendarMessage(result.status);updateCalendarDialog();return false;}calendarStatus=result.data;if(calendarStatus.connected!==true)invalidateCalendarPreview();const server=calendarStatus;if(calendarPending&&(!calendarExpiry(calendarPending.expiresAt)||server.pending!==true||String(server.pending_attempt_id)!==String(calendarPending.attemptId)||calendarPendingTerminal(server.pending_status)))clearCalendarPending();updateCalendarDialog();return true;}
async function startCalendarConnection(){if(calendarBusy||!calendarAccessAllowed())return false;invalidateCalendarPreview();const request=++calendarRequest,capturedUser=calendarIdentity(),capturedToken=session.access_token;clearCalendarPending();calendarBusy=true;$('calendar-message').className='form-message';$('calendar-message').textContent='Готовим подключение…';updateCalendarDialog();const result=await calendarFetch('start',{},capturedUser,capturedToken);if(!calendarCurrent(request,capturedUser,capturedToken))return false;calendarBusy=false;if(result.status!==200||!result.data?.authorization_url||!/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth(?:\?|$)/u.test(result.data.authorization_url)||!result.data.attempt_id||typeof result.data.confirmation_secret!=='string'||!calendarExpiry(result.data.expires_at)){ $('calendar-message').className='form-message error';$('calendar-message').textContent=calendarMessage(result.status);updateCalendarDialog();return false;}calendarPending={attemptId:result.data.attempt_id,secret:result.data.confirmation_secret,expiresAt:result.data.expires_at,userId:capturedUser};const link=$('calendar-open-google');link.href=result.data.authorization_url;link.target='_blank';link.rel='noopener noreferrer';link.hidden=false;$('calendar-message').className='form-message success';$('calendar-message').textContent='Откройте Google, завершите доступ и вернитесь сюда. Затем нажмите «Проверить доступ».';updateCalendarDialog();await loadCalendarStatus({internal:true});return calendarCurrent(calendarRequest,capturedUser,capturedToken)&&Boolean(calendarPending);}
async function confirmCalendarConnection(){if(calendarBusy||!calendarPending||!calendarAccessAllowed())return false;invalidateCalendarPreview();const request=++calendarRequest,capturedUser=calendarIdentity(),capturedToken=session.access_token,pending=calendarPending;if(pending.userId!==capturedUser||!calendarExpiry(pending.expiresAt))return false;calendarBusy=true;$('calendar-message').className='form-message';$('calendar-message').textContent='Подтверждаем подключение…';updateCalendarDialog();const result=await calendarFetch('confirm',{attempt_id:pending.attemptId,confirmation_secret:pending.secret},capturedUser,capturedToken);if(!calendarCurrent(request,capturedUser,capturedToken))return false;calendarBusy=false;if(result.status!==200||result.data?.ok!==true){$('calendar-message').className='form-message error';$('calendar-message').textContent=calendarMessage(result.status);updateCalendarDialog();return false;}clearCalendarPending();$('calendar-message').className='form-message success';$('calendar-message').textContent='Подключение подтверждено. Синхронизация событий пока не включена.';await loadCalendarStatus({internal:true});return true;}
async function disconnectCalendar(){if(calendarBusy||!calendarAccessAllowed()||!window.confirm?.('Отключить локальное подключение? Доступ Google Calendar отозван не будет.'))return false;invalidateCalendarPreview();const request=++calendarRequest,capturedUser=calendarIdentity(),capturedToken=session.access_token;calendarBusy=true;$('calendar-message').className='form-message';$('calendar-message').textContent='Отключаем локальное подключение…';updateCalendarDialog();const result=await calendarFetch('disconnect',{},capturedUser,capturedToken);if(!calendarCurrent(request,capturedUser,capturedToken))return false;calendarBusy=false;if(result.status!==200||result.data?.ok!==true){$('calendar-message').className='form-message error';$('calendar-message').textContent=calendarMessage(result.status);updateCalendarDialog();return false;}calendarStatus={connected:false};invalidateCalendarPreview();clearCalendarPending();$('calendar-message').className='form-message success';$('calendar-message').textContent='Локальное подключение отключено. Доступ Google не отозван.';updateCalendarDialog();return true;}
function closeCalendar(){calendarRequest++;invalidateCalendarPreview();calendarBusy=false;hideModal($('calendar-dialog'));}
async function openCalendar(){if(!calendarAccessAllowed()){toast('Календарь доступен только суперадмину.');return false;}if(!dateFieldValue('calendar-preview-from')){const today=dateFrom(clock()),last=dateObj(today);last.setUTCDate(last.getUTCDate()+30);syncDateField('calendar-preview-from',today);syncDateField('calendar-preview-through',last.toISOString().slice(0,10));}invalidateCalendarPreview();$('calendar-message').textContent='';showModal($('calendar-dialog'));updateCalendarDialog();return loadCalendarStatus();}
function openSettings(){if(!calendarAccessAllowed()){toast('Настройки доступны только суперадмину.');return false;}showModal($('settings-dialog'));return true;}
function updateCalendarVisibility(){const allowed=calendarAccessAllowed(),settingsButton=$('settings-toggle'),button=$('calendar-toggle');if(settingsButton)settingsButton.hidden=!allowed;if(button)button.hidden=!allowed;if(!allowed){calendarRequest++;invalidateCalendarPreview();calendarBusy=false;clearCalendarPending();if($('settings-dialog')?.hasAttribute('open'))hideModal($('settings-dialog'));if($('calendar-dialog')?.hasAttribute('open'))hideModal($('calendar-dialog'));}}
const auditFieldDefinitions=[
 {key:'room',label:'Кабинет',read:s=>String(s?.room_label||reportRoomLabel(s?.room_id)||'—'),compare:s=>`${String(s?.room_id||'')}|${String(s?.room_label||'')}`},
 {key:'date',label:'Дата',read:s=>isoToDisplayDate(s?.booking_date)||String(s?.booking_date||'—')},
 {key:'time',label:'Время',read:s=>{const start=String(s?.starts_at||'').slice(0,5),end=String(s?.ends_at||'').slice(0,5);return start&&end?`${start}–${end}`:start||end||'—';}},
 {key:'period',label:'Уроки',read:s=>{const start=s?.period_start,end=s?.period_end;if(start===null||start===undefined||end===null||end===undefined||start===''||end==='')return '—';if(isLunchTime(s?.grade_band,s?.starts_at,s?.ends_at))return 'обед';return start===end?`урок ${start}`:`уроки ${start}–${end}`;}},
 {key:'band',label:'Расписание звонков',read:s=>s?.grade_band==='primary'?'1–5 классы':s?.grade_band==='secondary'?'6–11 классы':String(s?.grade_band||'—')},
 {key:'purpose',label:'Для чего',read:s=>String(s?.purpose||'—')}
];
const auditActionLabels={create:'Создана',update:'Изменена',delete:'Удалена'};
const sessionKey=value=>value?.user?.id?`${value.user.id}:${value.access_token||''}`:'';
const auditAccessAllowed=()=>Boolean(cloud&&session?.user?.id&&superadmin&&!auditAccessBlocked);
const auditPerson=(name,email,fallback)=>{const cleanName=String(name||'').trim(),cleanEmail=String(email||'').trim();return cleanName&&cleanEmail?`${cleanName} · ${cleanEmail}`:cleanName||cleanEmail||fallback;};
function auditChanges(row){
 const before=row?.old_booking&&typeof row.old_booking==='object'?row.old_booking:null,after=row?.new_booking&&typeof row.new_booking==='object'?row.new_booking:null;
 if(row?.action==='create')return auditFieldDefinitions.map(field=>({label:field.label,before:'—',after:field.read(after)}));
 if(row?.action==='delete')return auditFieldDefinitions.map(field=>({label:field.label,before:field.read(before),after:'—'}));
 const changes=auditFieldDefinitions.filter(field=>(field.compare||field.read)(before)!==(field.compare||field.read)(after)).map(field=>({label:field.label,before:field.read(before),after:field.read(after)}));
 return changes.length?changes:[{label:'',before:'Без изменений',after:'Без изменений',noop:true}];
}
function renderAuditChanges(row){return auditChanges(row).map(change=>change.noop?`<div class="audit-change audit-noop"><span>${esc(change.before)}</span></div>`:`<div class="audit-change"><span class="audit-change-label">${esc(change.label)}</span><span class="audit-before"><small>Было</small>${esc(change.before)}</span><span class="audit-arrow" aria-hidden="true">→</span><span class="audit-after"><small>Стало</small>${esc(change.after)}</span></div>`).join('');}
function renderAuditCard(row){
 const booking=row?.new_booking||row?.old_booking||{},actor=auditPerson(row?.actor_name,row?.actor_email,row?.actor_id?`ID ${row.actor_id}`:'Система'),owner=auditPerson(booking.created_by_name,booking.owner_email||booking.created_by,'Владелец не указан'),action=auditActionLabels[row?.action]||'Событие';
 const context=auditFieldDefinitions.slice(0,3).map(field=>`<span><small>${esc(field.label)}</small>${esc(field.read(booking))}</span>`).join('');
 return `<article class="audit-entry" data-audit-id="${esc(row?.id)}"><div class="audit-entry-head"><div><strong>${esc(action)}</strong><span>Бронь №${esc(row?.booking_id??'—')}</span></div><time datetime="${esc(row?.occurred_at)}">${esc(formatTimestamp(row?.occurred_at))}</time></div><div class="audit-context">${context}</div><div class="audit-people"><span><small>Изменил</small>${esc(actor)}</span><span><small>Владелец брони</small>${esc(owner)}</span></div><div class="audit-changes">${renderAuditChanges(row)}</div></article>`;
}
function setBookingAuditMessage(text='',error=false){const message=$('booking-audit-message');if(!message)return;message.className=`form-message${error?' error':''}`;message.textContent=text;}
function renderBookingAudit(){
 const list=$('booking-audit-list'),summary=$('booking-audit-summary');if(!list||!summary)return;summary.textContent=auditLoaded?`Событий: ${auditEntries.length}${auditHasMore?' · есть ещё':''}`:'';
 if(auditLoading&&!auditEntries.length){list.innerHTML='<p class="audit-state">Загружаем историю…</p>';return;}
 if(!auditEntries.length){list.innerHTML=auditError?`<div class="audit-state audit-state-error">Не удалось загрузить историю.<br><button id="booking-audit-retry" class="secondary-button" type="button">Повторить</button></div>`:auditLoaded?'<p class="audit-state">Изменений пока нет.</p>':'';list.querySelector('#booking-audit-retry')?.addEventListener('click',()=>loadBookingAudit(false));return;}
 list.innerHTML=auditEntries.map(renderAuditCard).join('')+(auditError?`<div class="audit-append-error"><span>Не удалось загрузить более старые события.</span><button id="booking-audit-retry" class="secondary-button" type="button">Повторить</button></div>`:'')+(auditHasMore?`<button id="booking-audit-older" class="secondary-button audit-older" type="button" ${auditAppending?'disabled':''}>${auditAppending?'Загружаем…':'Загрузить более старые'}</button>`:'');
 list.querySelector('#booking-audit-retry')?.addEventListener('click',()=>loadBookingAudit(Boolean(auditEntries.length&&auditLastId)));
 list.querySelector('#booking-audit-older')?.addEventListener('click',()=>loadBookingAudit(true));
}
function resetBookingAuditState(){auditRequest++;auditEntries=[];auditLastId=null;auditHasMore=false;auditLoading=false;auditAppending=false;auditLoaded=false;auditError='';setBookingAuditMessage('');renderBookingAudit();}
function closeBookingAudit(){auditViewToken++;resetBookingAuditState();hideModal($('booking-audit-dialog'));}
function failAuditAccessCheck(){auditAccessBlocked=true;if($('booking-audit-dialog')?.hasAttribute('open'))closeBookingAudit();else resetBookingAuditState();updateAuditVisibility();updateCalendarVisibility();}
function updateAuditVisibility(){const allowed=Boolean(superadmin&&session?.user?.id&&!auditAccessBlocked),button=$('booking-audit-toggle');if(button)button.hidden=!allowed;if(!allowed&&$('booking-audit-dialog')?.hasAttribute('open'))closeBookingAudit();}
function auditRequestIsCurrent(request,key,view){return request===auditRequest&&view===auditViewToken&&$('booking-audit-dialog').hasAttribute('open')&&auditAccessAllowed()&&sessionKey(session)===key;}
async function loadBookingAudit(append=false){
 if(!auditAccessAllowed()){if($('booking-audit-dialog')?.hasAttribute('open'))closeBookingAudit();return false;}
 if(auditLoading||auditAppending||append&&!auditHasMore)return false;
 if(!append){auditEntries=[];auditLastId=null;auditHasMore=false;auditLoaded=false;auditError='';}
 const request=++auditRequest,view=auditViewToken,key=sessionKey(session),cursor=append?auditLastId:null;auditLoading=!append;auditAppending=append;setBookingAuditMessage(append?'Загружаем более старые события…':'Загружаем историю…');renderBookingAudit();
 try{
  let query=cloud.from('booking_audit_log').select('id,occurred_at,booking_id,action,actor_id,actor_email,actor_name,old_booking,new_booking').order('id',{ascending:false}).limit(AUDIT_PAGE_SIZE);if(cursor!==null&&cursor!==undefined)query=query.lt('id',cursor);const result=await query;
  if(!auditRequestIsCurrent(request,key,view))return false;if(result?.error)throw result.error;const rows=Array.isArray(result?.data)?result.data:[];const known=new Set(auditEntries.map(row=>String(row.id)));auditEntries=append?auditEntries.concat(rows.filter(row=>!known.has(String(row.id)))):rows;auditLastId=rows.length?rows[rows.length-1].id:null;auditHasMore=rows.length===AUDIT_PAGE_SIZE;auditLoaded=true;auditError='';auditLoading=false;auditAppending=false;setBookingAuditMessage('');renderBookingAudit();return true;
 }catch(error){
  if(!auditRequestIsCurrent(request,key,view))return false;auditError=String(error?.message||error||'неизвестная ошибка');auditLoaded=true;auditLoading=false;auditAppending=false;setBookingAuditMessage(append?'Не удалось загрузить более старые события.':'Не удалось загрузить историю броней. Попробуйте ещё раз.',true);renderBookingAudit();return false;
 }
}
async function openBookingAudit(){if(!auditAccessAllowed()){toast('История броней доступна только суперадмину.');return false;}auditViewToken++;resetBookingAuditState();showModal($('booking-audit-dialog'));return loadBookingAudit(false);}
function bookingActionError(message){const text=`Не удалось открыть бронь: ${message}`;$('booking-report-message').className='form-message error';$('booking-report-message').textContent=text;$('booking-message').className='form-message error';$('booking-message').textContent=text;toast(text);}
function openAuth(){
 if(!hasCloud()){toast('Сначала нужно подключить Supabase.');return;}
 $('auth-message').textContent='';$('auth-email').value=session?.user?.email||'';showModal($('auth-dialog'));setTimeout(()=>$('auth-email').focus(),0);
}
async function signInGoogle(){
 if(!cloud){openAuth();return;}const message=$('auth-message');message.className='form-message';message.textContent='Открываем Google…';const redirectTo=window.location.origin+window.location.pathname;
 const {error}=await cloud.auth.signInWithOAuth({provider:'google',options:{redirectTo,queryParams:{hd:'demo-school.edu'}}});if(error){openAuth();message.classList.add('error');message.textContent=`Не получилось войти через Google: ${error.message}`;}
}
function updateAuthButton(){
 if(typeof assessmentAuthChanged==='function')assessmentAuthChanged();
 if(typeof evacAuthChanged==='function')evacAuthChanged();
 const button=$('auth-button');
 button.textContent=session?`${actorName()} · Выйти`:'Войти';button.classList.toggle('signed-in',Boolean(session));
 button.title=session?`${superadmin?'Суперадмин':isAdmin()?'Администратор':profile?.approved?'Сотрудник':'Нет доступа'} · выйти`:googleAuthEnabled?'Войти через Google':'Войти по ссылке из письма';
 updateEditorVisibility();
 updateStaffVisibility();
 updateScheduleVisibility();
 updateCalendarVisibility();
 updateSyncVisibility();
 updateAuditVisibility();
 renderCard();
}
// Lesson grid in the booking and availability forms. The selects stay the source of truth; chips only drive them.
const periodAnchor={};
function renderPeriodGrid(prefix){
 const grid=$(`${prefix}-periods`);if(!grid)return;
 const band=$(`${prefix}-band`).value,start=Number($(`${prefix}-start`).value),end=Number($(`${prefix}-end`).value);
 const date=prefix==='booking'?dateFieldValue('booking-date'):'',room=prefix==='booking'?$('booking-room').value:'',ignore=prefix==='booking'?$('booking-id').value:'';
 const startTime=normalizedTime($(`${prefix}-start-time`).value),endTime=normalizedTime($(`${prefix}-end-time`).value),timed=Boolean(startTime&&endTime&&min(startTime)<min(endTime)),slots=periodSlots(band);
 grid.innerHTML=slots.map(slot=>{
  const {a,b}=slot,payload={room_id:room,booking_date:date,starts_at:a,ends_at:b},locked=Boolean(date&&room&&lockedBookingSlot(payload)),busy=locked||Boolean(date&&room)&&(fixedConflict(payload)||bookingConflict(payload,ignore)),covered=timed&&overlaps(a,b,startTime,endTime),selected=slot.lunch?covered:slot.period>=start&&slot.period<=end&&(!timed||covered),cls=`${busy?' busy':''}${locked?' locked':''}${selected?' selected':''}`;
  return slot.lunch?`<button type="button" class="period-chip lunch-chip${cls}" data-lunch="true" aria-pressed="${selected}" aria-label="Обед, ${a}–${b}${busy?', занято':''}"><b>Обед</b><small>${a}</small></button>`:`<button type="button" class="period-chip${cls}" data-period="${slot.period}" aria-pressed="${selected}" aria-label="${slot.period} урок, ${a}–${b}${locked?', бронирует только суперадмин':busy?', занято':''}"${locked?' title="Бронирует только суперадмин"':''}><b>${slot.period}</b><small>${a}</small></button>`;
 }).join('');
 const summary=$(`${prefix}-period-summary`);
 if(summary)summary.textContent=startTime&&endTime?`${periodSummaryLabel(band,start,end,startTime,endTime)} · ${startTime}–${endTime}`:'';
 const fill=prefix==='booking'?fillBookingPeriods:fillAvailabilityPeriods,keyOf=button=>button.dataset.lunch?'lunch':Number(button.dataset.period),order=key=>slots.findIndex(slot=>key==='lunch'?slot.lunch:slot.period===key);
 grid.querySelectorAll('[data-period],[data-lunch]').forEach(button=>button.onclick=()=>{
  const key=keyOf(button),anchor=periodAnchor[prefix];
  if(anchor===undefined||anchor===null){periodAnchor[prefix]=key;if(key==='lunch')selectSlotTimes(prefix,slots[order(key)]);else fill(key,key);}
  else{periodAnchor[prefix]=null;const [lo,hi]=[order(anchor),order(key)].sort((x,y)=>x-y);if(slots[lo].lunch||slots[hi].lunch)selectSlotTimes(prefix,slots[lo],slots[hi]);else fill(slots[lo].period,slots[hi].period);}
  if(prefix==='availability')invalidateAvailability();grid.querySelector(key==='lunch'?'[data-lunch]':`[data-period="${key}"]`)?.focus();
 });
}
// Обед — не урок, поэтому выбирается по точному времени; номер урока в записи берётся из periodRangeForTimes.
function selectSlotTimes(prefix,first,last=first){$(`${prefix}-start-time`).value=first.a;$(`${prefix}-end-time`).value=last.b;syncExactTimeSelection(prefix);}
function fillBookingPeriods(start=1,end=start){
 const band=$('booking-band').value,bells=D.bells[band];
 $('booking-start').innerHTML=bells.map(([a,b],i)=>`<option value="${i}" ${i===Number(start)?'selected':''}>${i} · ${a}–${b}</option>`).join('');
 $('booking-end').innerHTML=bells.map(([a,b],i)=>`<option value="${i}" ${i===Number(end)?'selected':''} ${i<Number(start)?'disabled':''}>${i} · ${a}–${b}</option>`).join('');
 if(Number($('booking-end').value)<Number(start))$('booking-end').value=String(start);
 $('booking-start-time').value=bells[Number(start)][0];$('booking-end-time').value=bells[Number($('booking-end').value)][1];
 renderPeriodGrid('booking');
}
function openBooking(existing=null,defaults={}){
 if(bookingCommandBusy||syncCommandBusy)return false;
 if(!existing&&!bookingAllowedRoom(state.selected)){toast(restrictedBookingNotice(state.selected));return false;}
 if(bookingConflictChoice&&String(bookingConflictChoice.booking_id)!==String(existing?.id))bookingConflictChoice=null;
 if(existing&&(!session||!canBook()||!canManage(existing))){bookingActionError('у вас нет прав на редактирование этой записи.');return false;}
 if(!session){openAuth();return false;}if(!canBook()){toast('Доступ к бронированию кабинетов ещё не подтверждён.');return false;}const r=floorData().rooms.find(r=>r.room_id===state.selected);if(!r)return false;
 bookingModalRevision++;bookingOriginal=existing?{...existing}:null;bookingEditContext=null;bookingRetry=null;$('booking-id').value=existing?.id||'';$('booking-room').innerHTML=allRooms.filter(room=>bookingAllowedRoom(room.room_id)||existing?.room_id===room.room_id).map(room=>`<option value="${esc(room.room_id)}" ${room.room_id===(existing?.room_id||r.room_id)?'selected':''} ${bookingAllowedRoom(room.room_id)?'':'disabled'}>${esc(room.n)}</option>`).join('');$('booking-title').textContent=`Кабинет ${r.n}`;syncDateField('booking-date',existing?.booking_date||defaults.date||state.date);$('booking-band').value=existing?.grade_band||defaults.band||state.band;$('booking-purpose').value=existing?.purpose||'';
 periodAnchor.booking=null;fillBookingPeriods(existing?.period_start??defaults.start??1,existing?.period_end??defaults.end??existing?.period_start??defaults.start??1);$('booking-delete').hidden=!existing;$('booking-message').textContent='';showModal($('booking-dialog'));setTimeout(()=>$('booking-purpose').focus(),0);
 $('booking-start-time').value=normalizedTime(String(existing?.starts_at||defaults.starts_at||'').slice(0,5))||$('booking-start-time').value;$('booking-end-time').value=normalizedTime(String(existing?.ends_at||defaults.ends_at||'').slice(0,5))||$('booking-end-time').value;renderPeriodGrid('booking');captureBookingDraft();
 updateBookingRoomAccess();
 if(existing?.room_id===HALL_ROOM||r.room_id===HALL_ROOM)void refreshBookingContext();
 return true;
}
 function bookingPayload(){
  const band=$('booking-band').value,bookingDate=dateFieldValue('booking-date'),startsAt=normalizedTime($('booking-start-time').value),endsAt=normalizedTime($('booking-end-time').value);if(!bookingDate||!startsAt||!endsAt||min(endsAt)<=min(startsAt))return null;const [start,end]=periodRangeForTimes(band,startsAt,endsAt);
  return {room_id:$('booking-room').value||state.selected,booking_date:bookingDate,starts_at:startsAt,ends_at:endsAt,grade_band:band,period_start:start,period_end:end,purpose:$('booking-purpose').value.trim()};
}
function hallBookingTransition(payload){return bookingOriginal?.room_id===HALL_ROOM||payload?.room_id===HALL_ROOM;}
function updateBookingRoomAccess(){const roomId=$('booking-room').value,blocked=!bookingAllowedRoom(roomId);$('booking-form').querySelector('[type="submit"]').disabled=bookingCommandBusy||blocked;$('booking-notice').textContent=blocked?`${restrictedBookingNotice(roomId)}. Существующую бронь можно удалить или перенести в другое помещение.`:isHallRoom(roomId)?HALL_NOTICE:'';$('booking-notice').hidden=!blocked&&!isHallRoom(roomId);}
function setBookingBusy(value){bookingCommandBusy=value;$('booking-form').querySelectorAll('input,select,textarea,button').forEach(field=>field.disabled=value);updateBookingRoomAccess();}
async function refreshBookingContext(){const request=++bookingContextRequest,revision=bookingModalRevision,key=sessionKey(session),reply=await editContext(bookingOriginal?.id||null);if(request!==bookingContextRequest||revision!==bookingModalRevision||key!==sessionKey(session)||!$('booking-dialog').hasAttribute('open'))return null;bookingContextError=reply.ok?null:reply.error?.code;bookingEditContext=reply.ok?reply.result:null;return bookingEditContext;}
function typedBookingFields(payload){return Object.fromEntries(Object.entries(payload).map(([key,value])=>['p_'+key,value]));}
async function submitBookingCommand(cancel=false){
 if(!cancel&&!bookingAllowedRoom($('booking-room').value||state.selected)){$('booking-message').textContent=restrictedBookingNotice($('booking-room').value||state.selected);return false;}
 if(bookingCommandBusy)return false;const id=$('booking-id').value,payload=bookingPayload(),message=$('booking-message'),revision=bookingModalRevision,key=sessionKey(session),original=bookingOriginal;
 message.className='form-message';if(!cloud||!canBook()||id&&(!original||!canManage(original))){message.textContent='Для бронирования нужен доступ сотрудника.';return false;}
 if(!cancel&&(!payload||!payload.purpose)){message.textContent='Проверьте дату, время и назначение брони.';return false;}if(cancel&&(!id||!window.confirm?.('Удалить эту бронь?')))return false;
 const intent=JSON.stringify([session?.user?.id,cancel,id,cancel?null:payload,bookingConflictChoice?.conflict_id||null]),replay=bookingRetry?.intent===intent;
 // The committed booking can arrive through realtime after its response was
 // lost. An identical typed retry must reach the original receipt, not reject
 // its own booking as a new overlap. SQL still authorizes every command.
 const locked=!cancel&&!replay&&bookingPlacementChanged(original,payload)?lockedBookingSlot(payload):null;
 if(locked){message.textContent=`${locked.notice}.`;return false;}
 if(!cancel&&!replay&&(bookingConflict(payload,id)||fixedConflict(payload))){message.textContent='На это время уже есть бронь, урок или кружок.';return false;}
 setBookingBusy(true);message.textContent='Сохраняем…';let reply,typed=false;
 try{
  const touchesHall=original?.room_id===HALL_ROOM||!cancel&&payload.room_id===HALL_ROOM;
  let context=null;
  // Capture preconditions once for the user's draft. On an ambiguous retry these stay fixed.
  if(touchesHall){const displayed=bookingEditContext;context=await refreshBookingContext();if(cancel&&replay&&!context&&bookingContextError==='NOT_FOUND'){const fresh=await editContext();context=fresh.ok?fresh.result:null;}if(revision!==bookingModalRevision||key!==sessionKey(session))return false;if(!context){message.textContent='Не удалось проверить подключение зала. Ваш черновик сохранён.';return false;}typed=context.write_guard_enabled||replay;
   if(typed&&!replay&&(!decimalVersion(context.connection_generation)||id&&(!context.record||!decimalVersion(context.record.booking_version))||id&&!(cancel?context.record.can_cancel:context.record.can_edit))){message.textContent='Не удалось проверить текущую версию или права на бронь.';return false;}
   const expectedVersion=displayed?.record?.booking_version||original?.sync_version?.toString();
   if(typed&&!replay&&id&&(expectedVersion&&expectedVersion!==context.record.booking_version||displayed&&JSON.stringify(syncPreconditions(displayed))!==JSON.stringify(syncPreconditions(context)))){bookingRetry=null;message.textContent='Запись изменилась. Текущая версия загружена; черновик сохранён. Проверьте его и повторите.';return false;}
   const changesTimeOrRoom=!original||payload&&['room_id','booking_date','starts_at','ends_at'].some(field=>String(payload[field]).slice(0,field.endsWith('_at')?5:100)!==String(original[field]).slice(0,field.endsWith('_at')?5:100));
   if(typed&&!cancel&&!replay&&payload.room_id===HALL_ROOM&&changesTimeOrRoom&&!context.availability_usable){message.textContent='Доступность зала не подтверждена. Обновите проверку и повторите.';return false;}
  }
  if(typed){let name=cancel?'calendar_sync_booking_cancel_v1':id?'calendar_sync_booking_update_v1':'calendar_sync_booking_create_v1',args=cancel?{p_booking_id:id,...syncPreconditions(context),p_reason:'Отменено на карте'}:id?{p_booking_id:id,...syncPreconditions(context),...typedBookingFields(payload)}:{...typedBookingFields(payload),p_expected_connection_generation:context.connection_generation};
   if(!cancel&&bookingConflictChoice){name='calendar_sync_conflict_manual_v1';args={p_conflict_id:bookingConflictChoice.conflict_id,...syncPreconditions(context),p_expected_etag:bookingConflictChoice.etag,...typedBookingFields(payload),p_summary:payload.purpose,p_start_at:new Date(localInstant(payload.booking_date,payload.starts_at)).toISOString(),p_end_at:new Date(localInstant(payload.booking_date,payload.ends_at)).toISOString(),p_start_date:null,p_end_date:null};}
   if(!replay)bookingRetry={...commandFor(null,name,args),intent,name,args};reply=await syncRpc(bookingRetry.name,{p_command_id:bookingRetry.id,...bookingRetry.args});
  }else{const query=cancel?cloud.from('room_bookings').delete().eq('id',id):id?cloud.from('room_bookings').update(payload).eq('id',id):cloud.from('room_bookings').insert(payload);const result=await query;reply=result.error?{ok:false,error:{code:result.error.code==='23P01'?'BOOKING_OVERLAP':/(Upcoming|Weekly) booking limit reached/.test(String(result.error.message))?'QUOTA_EXCEEDED':result.error.code==='42501'?'FORBIDDEN':'INTERNAL',retryable:true}}:{ok:true};}
  if(revision!==bookingModalRevision||key!==sessionKey(session))return false;
  if(!reply.ok){message.className='form-message error';message.textContent=syncError(reply.error?.code);if(reply.error?.retryable===false)bookingRetry=null;if(staleSyncCode(reply.error?.code)){await refreshBookingContext();const conflict=await refreshConflict(bookingConflictChoice);if(revision!==bookingModalRevision||key!==sessionKey(session))return false;bookingConflictChoice=conflict;bookingRetry=null;message.textContent+=' Текущая версия загружена; черновик сохранён. Проверьте его и повторите.';}else if(['STALE_AVAILABILITY','SCHEDULE_UNKNOWN'].includes(reply.error?.code)){bookingEditContext=null;void refreshHall();}return false;}
  bookingConflictChoice=null;clearBookingDraft();bookingModalRevision++;hideModal($('booking-dialog'));if(!cancel){state.date=payload.booking_date;select(payload.room_id);updateDate();}await loadBookings();if(typed){toast(reply.result?.sync_state==='synced'?'Изменения синхронизированы.':'Бронь сохранена. Изменение в Google ожидается.');void kickCalendar();void refreshHall();}else toast(cancel?'Бронь удалена.':id?'Бронь обновлена.':'Кабинет забронирован. Теперь это видят все.');return true;
 }catch{if(revision===bookingModalRevision&&key===sessionKey(session))message.textContent='Не удалось подтвердить результат. Черновик сохранён; повторите действие.';return false;}finally{setBookingBusy(false);}
}
function bookingConflict(payload,ignoreId=''){
 return bookings.some(b=>String(b.id)!==String(ignoreId)&&b.room_id===payload.room_id&&b.booking_date===payload.booking_date&&overlaps(payload.starts_at,payload.ends_at,b.starts_at,b.ends_at));
}
function fixedConflict(payload){
 const day=DAYS[dayIndexFor(payload.booking_date)];
 const lessonConflict=(byRoom.get(payload.room_id)||[]).filter(l=>l.day===day).some(l=>{const [a,b]=lessonTimes(l);return overlaps(payload.starts_at,payload.ends_at,a,b);});
 const clubConflict=(clubsByRoom.get(payload.room_id)||[]).filter(club=>club.day===day).some(club=>{const [first,last]=clubPeriods(club);return D.bells.secondary.some(([a,b],period)=>period>=first&&period<=last&&overlaps(payload.starts_at,payload.ends_at,a,b));});
 return lessonConflict||clubConflict;
}
function fillAvailabilityPeriods(start=1,end=start){
 const band=$('availability-band').value,bells=D.bells[band];
 $('availability-start').innerHTML=bells.map(([a,b],i)=>`<option value="${i}" ${i===Number(start)?'selected':''}>${i} · ${a}–${b}</option>`).join('');
 $('availability-end').innerHTML=bells.map(([a,b],i)=>`<option value="${i}" ${i===Number(end)?'selected':''} ${i<Number(start)?'disabled':''}>${i} · ${a}–${b}</option>`).join('');
 if(Number($('availability-end').value)<Number(start))$('availability-end').value=String(start);
 $('availability-start-time').value=bells[Number(start)][0];$('availability-end-time').value=bells[Number($('availability-end').value)][1];
 renderPeriodGrid('availability');
}
 function availabilityCriteria(){
 const floor=$('availability-floor').value,date=dateFieldValue('availability-date'),band=$('availability-band').value,startsAt=normalizedTime($('availability-start-time').value),endsAt=normalizedTime($('availability-end-time').value),bells=D.bells[band];
 if(!D.floors[floor]||!date||!bells||!startsAt||!endsAt||min(endsAt)<=min(startsAt))return null;const [start,end]=periodRangeForTimes(band,startsAt,endsAt);
 return {floor,date,band,start,end,starts_at:startsAt,ends_at:endsAt,custom:startsAt!==bells[start][0]||endsAt!==bells[end][1]};
}
function syncExactTimeSelection(prefix){const start=normalizedTime($(prefix+'-start-time').value),end=normalizedTime($(prefix+'-end-time').value);if(!start||!end||min(end)<=min(start))return false;const periods=periodRangeForTimes($(prefix+'-band').value,start,end);(prefix==='booking'?fillBookingPeriods:fillAvailabilityPeriods)(...periods);$(prefix+'-start-time').value=start;$(prefix+'-end-time').value=end;renderPeriodGrid(prefix);return true;}
function fixedConflictFor(roomId,criteria){return fixedConflict({room_id:roomId,booking_date:criteria.date,starts_at:criteria.starts_at,ends_at:criteria.ends_at});}
function bookingConflictFor(roomId,criteria){return availabilityBookings.some(booking=>booking.room_id===roomId&&booking.booking_date===criteria.date&&overlaps(criteria.starts_at,criteria.ends_at,booking.starts_at,booking.ends_at));}
function roomKnown(roomId){return Boolean(byRoom.get(roomId)?.length);}
function availabilityRoomCard(room,criteria,unknown=false){
 const subtitle=aliases[room.n]||(/^\d/.test(room.n)?'Учебное пространство':room.n),buttonLabel=canBook()?'Забронировать':session?'Нет доступа':'Войти и забронировать';
 return `<article class="availability-room ${unknown?'unknown':''}"><div><strong>${esc(room.n)}</strong><span>${esc(subtitle)}</span><small>${unknown?room.room_id===HALL_ROOM?'Доступность требует проверки':'Нет загруженного расписания, требуется проверка':'Свободен по загруженному расписанию'}</small></div><button class="${canBook()?'primary-button':'secondary-button'}" data-availability-room="${esc(room.room_id)}" type="button" ${session&&!canBook()||room.room_id===HALL_ROOM&&hallAvailability(criteria.date)==='unknown'?'disabled':''}>${buttonLabel}</button></article>`;
}
function renderAvailability(criteria=availabilityCriteria()){
 if(!criteria)return;const rooms=D.floors[criteria.floor].rooms.filter(room=>bookingAllowedRoom(room.room_id)&&!lockedBookingSlot({room_id:room.room_id,booking_date:criteria.date,starts_at:criteria.starts_at,ends_at:criteria.ends_at})).sort((a,b)=>a.n.localeCompare(b.n,'ru',{numeric:true})),available=[],unknown=[],occupied=[];
 for(const room of rooms){if(fixedConflictFor(room.room_id,criteria)||bookingConflictFor(room.room_id,criteria)||room.room_id===HALL_ROOM&&hallOccupied(criteria.date,criteria.starts_at,criteria.ends_at)){occupied.push(room);continue;}const known=room.room_id===HALL_ROOM&&hallAvailability(criteria.date)!=='disabled'?hallAvailability(criteria.date)==='ready':roomKnown(room.room_id);(known?available:unknown).push(room);}
 $('availability-summary').innerHTML=`<span><strong>${available.length}</strong> свободно</span><span><strong>${unknown.length}</strong> требуют проверки</span><span><strong>${occupied.length}</strong> занято</span>`;
 const periodLabel=isLunchTime(criteria.band,criteria.starts_at,criteria.ends_at)?'Обед':criteria.custom?'Точное время':criteria.start===criteria.end?`${criteria.start} урок`:`${criteria.start}–${criteria.end} уроки`;
 $('availability-message').className='form-message success';$('availability-message').textContent=`${floorNames[criteria.floor]} · ${reportDateLabel(criteria.date)} · ${periodLabel} · ${criteria.starts_at}–${criteria.ends_at}`;
 $('availability-results').innerHTML=`${available.length?`<section class="availability-group"><h3>Свободны по расписанию</h3>${available.map(room=>availabilityRoomCard(room,criteria)).join('')}</section>`:''}${unknown.length?`<section class="availability-group availability-unknown"><h3>Без расписания</h3>${unknown.map(room=>availabilityRoomCard(room,criteria,true)).join('')}</section>`:''}${!available.length&&!unknown.length?'<p class="staff-empty">На выбранное время свободных помещений на этаже нет.</p>':''}`;
 $('availability-results').querySelectorAll('[data-availability-room]').forEach(button=>button.onclick=()=>bookAvailabilityRoom(button.dataset.availabilityRoom,criteria));
}
async function searchAvailability(){
 const criteria=availabilityCriteria(),message=$('availability-message'),button=$('availability-search'),request=++availabilityRequest;message.className='form-message';if(!criteria){message.classList.add('error');message.textContent='Проверьте этаж, дату и диапазон уроков.';return;}button.disabled=true;message.textContent='Проверяем расписание и брони…';
 $('availability-results').innerHTML='';$('availability-summary').innerHTML='';
 if(D.supabase?.url&&D.supabase?.publishableKey&&!cloud){button.disabled=false;message.classList.add('error');message.textContent='Не удалось подключиться к общим броням. Попробуйте через несколько секунд.';return;}
 if(cloud){const {data,error}=await cloud.from('room_bookings').select('*').eq('booking_date',criteria.date).order('starts_at');if(request!==availabilityRequest)return;if(error){button.disabled=false;message.classList.add('error');message.textContent='Не удалось проверить общие брони. Попробуйте ещё раз.';return;}availabilityBookings=data||[];}else availabilityBookings=criteria.date===state.date?[...bookings]:[];
 if(D.floors[criteria.floor].rooms.some(room=>room.room_id===HALL_ROOM)){const key=sessionKey(session),snapshot=await readHallSnapshot(criteria.date);if(snapshot?.status.calendar_state==='disabled'&&syncAccess()){const context=await editContext();snapshot.writeGuard=context.ok?context.result.write_guard_enabled:'unknown';}if(request!==availabilityRequest||key!==sessionKey(session))return;if(snapshot)hallSnapshots.set(criteria.date,snapshot);else hallSnapshots.delete(criteria.date);}
 button.disabled=false;renderAvailability(criteria);
}
function invalidateAvailability(){availabilityRequest++;$('availability-search').disabled=false;$('availability-summary').innerHTML='';$('availability-results').innerHTML='';$('availability-message').className='form-message';$('availability-message').textContent='Нажмите «Найти свободные», чтобы проверить новое время.';}
function nearestPeriod(band=state.band){const bells=D.bells[band],current=bells.findIndex(([,end])=>state.minute<min(end));return current<0?bells.length-1:current;}
async function openAvailability(){
 $('availability-floor').value=state.floor;syncDateField('availability-date',state.date);$('availability-band').value=state.band;const start=nearestPeriod(state.band);fillAvailabilityPeriods(start,start);$('availability-summary').innerHTML='';$('availability-results').innerHTML='';$('availability-message').textContent='';showModal($('availability-dialog'));await searchAvailability();
}
function bookAvailabilityRoom(roomId,criteria){
 if(!bookingAllowedRoom(roomId)){toast(restrictedBookingNotice(roomId));return false;}
 const locked=lockedBookingSlot({room_id:roomId,booking_date:criteria?.date,starts_at:criteria?.starts_at,ends_at:criteria?.ends_at});if(locked){toast(locked.notice);return false;}
 if(roomId===HALL_ROOM&&hallAvailability(criteria.date)==='unknown')return;
 state.date=criteria.date;state.band=criteria.band;bookings=[...availabilityBookings];hideModal($('availability-dialog'));changeFloor(criteria.floor,roomId);updateDate(false);if(!session){openAuth();return;}if(!canBook()){toast('Доступ к бронированию кабинетов ещё не подтверждён.');return;}openBooking(null,{date:criteria.date,band:criteria.band,start:criteria.start,end:criteria.end,starts_at:criteria.starts_at,ends_at:criteria.ends_at});
}
const IMPORT_DAYS={Пн:'Понедельник',Вт:'Вторник',Ср:'Среда',Чт:'Четверг',Пт:'Пятница'};
const IMPORT_DAY_NAMES={...IMPORT_DAYS,Понедельник:'Понедельник',Вторник:'Вторник',Среда:'Среда',Четверг:'Четверг',Пятница:'Пятница'};
const IMPORT_ROOM_ALIASES={'Bio Lab':'Biology Lab','Chem Lab':'Chemistry Lab','Phys Lab':'Physics Lab','STPV_STEM':'SATPAYEV STEM (214)','STEM (213)':'STEM Lab (213)','STEM P (417)':'STEM Primary2 (417)','STEM Primary':'STEM Primary (103)'};
const IMPORT_TIME=/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/;
const IMPORT_CLASS=/\b(\d{1,2}[A-ZА-Я](?:\s*,\s*\d{1,2}[A-ZА-Я])*)\b/u;
const IMPORT_COMPACT_HOMEWORK=/^HW(\d{1,2}[A-ZА-Я])$/u;
const IMPORT_TEACHER_WORD=/[\u0400-\u04FF]/u;
// EduPage puts the teacher either after the classes ("Phy 11A,11B Имя Фамилия Physics 1A") or before them
// ("Phy Имя Фамилия 11A,11B Physics 1A"). Teacher names are two Cyrillic words; stream groups are usually Latin
// but may be Cyrillic ("Имя устаз Олимп Матем"), so a prefix already ending in a teacher makes the whole tail the group.
function importTeacherBeforeClasses(prefix){const words=prefix?prefix.split(' '):[];return words.length>2&&words.slice(-2).every(word=>IMPORT_TEACHER_WORD.test(word));}
function splitImportedTeacher(tail){const words=tail?tail.split(' '):[];let count=0;while(count<Math.min(words.length,2)&&IMPORT_TEACHER_WORD.test(words[count]))count++;return {teacher:words.slice(0,count).join(' '),group:words.slice(count).join(' ')||null};}
const cleanImportText=value=>String(value||'').replace(/\s+/g,' ').trim();
function importElementText(element){if(!element)return '';const clone=element.cloneNode(true);for(const lineBreak of clone.querySelectorAll('br'))lineBreak.replaceWith(' ');return cleanImportText(clone.textContent);}
function importedRoomNumber(name){return name.match(/^(\d{3})\b/)?.[1]||name.match(/\((\d{3})\)/)?.[1]||null;}
function parseImportedCell(value){
 let text=cleanImportText(value),start=null,end=null,classes=null,group=null,subjectTeacher='';const raw=text,timeMatch=text.match(IMPORT_TIME);
 if(timeMatch){start=timeMatch[1].padStart(5,'0');end=timeMatch[2].padStart(5,'0');text=text.slice(0,timeMatch.index).trim();}
 const compactHomework=text.match(IMPORT_COMPACT_HOMEWORK);if(compactHomework){classes=[compactHomework[1]];text='HW';}else{const classMatch=text.match(IMPORT_CLASS);if(classMatch){classes=classMatch[1].split(',').map(item=>item.trim());const prefix=text.slice(0,classMatch.index).trim(),rest=text.slice(classMatch.index+classMatch[0].length).trim(),tail=importTeacherBeforeClasses(prefix)?{teacher:'',group:rest||null}:splitImportedTeacher(rest);group=tail.group;text=[prefix,tail.teacher].filter(Boolean).join(' ');}}
 subjectTeacher=text;return {start,end,classes,group,subject_teacher:subjectTeacher,raw};
}
function parseImportedSheet(table,room){
 const lessons=[];for(const row of [...table.querySelectorAll('tr')]){const cells=[...row.querySelectorAll('td,th')],day=IMPORT_DAYS[importElementText(cells[0])];if(!day)continue;cells.slice(1,12).forEach((cell,period)=>{const raw=importElementText(cell);if(!raw)return;lessons.push({room_label:room,room_num:importedRoomNumber(room),day,period,...parseImportedCell(raw)});});}return lessons;
}
function decodeQuotedPrintable(value,charset='utf-8'){
 const source=value.replace(/=\r?\n/g,''),bytes=[];for(let i=0;i<source.length;i++){if(source[i]==='='&&/^[0-9a-f]{2}$/i.test(source.slice(i+1,i+3))){bytes.push(parseInt(source.slice(i+1,i+3),16));i+=2;}else bytes.push(source.charCodeAt(i)&255);}return new TextDecoder(charset,{fatal:false}).decode(Uint8Array.from(bytes));
}
function decodeMimePart(body,encoding,charset){
 if(encoding==='base64'){const binary=window.atob(body.replace(/\s/g,''));return new TextDecoder(charset,{fatal:false}).decode(Uint8Array.from(binary,char=>char.charCodeAt(0)));}
 if(encoding==='quoted-printable')return decodeQuotedPrintable(body,charset);if((encoding==='8bit'||encoding==='binary')&&![...body].some(char=>char.charCodeAt(0)>255))return new TextDecoder(charset,{fatal:false}).decode(Uint8Array.from(body,char=>char.charCodeAt(0)));return body;
}
function mimeHeaders(value){const result={};for(const line of value.replace(/\r?\n[ \t]+/g,' ').split(/\r?\n/)){const split=line.indexOf(':');if(split>0)result[line.slice(0,split).toLowerCase()]=line.slice(split+1).trim();}return result;}
function mimeBasename(value){const clean=value.split(/[?#]/)[0].replace(/\\/g,'/');try{return decodeURIComponent(clean.slice(clean.lastIndexOf('/')+1)).toLocaleLowerCase();}catch(_error){return clean.slice(clean.lastIndexOf('/')+1).toLocaleLowerCase();}}
function importBinaryString(value){const bytes=value instanceof Uint8Array?value:new Uint8Array(value);let result='';for(let offset=0;offset<bytes.length;offset+=32768)result+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return result;}
function parseImportedSummaryTable(table){
 const rows=[...table.querySelectorAll('tr')],dayRowIndex=rows.findIndex(row=>[...row.querySelectorAll('td,th')].some(cell=>IMPORT_DAY_NAMES[importElementText(cell)])),headerRowIndex=rows.findIndex((row,index)=>index>dayRowIndex&&importElementText(row.querySelector('td,th'))==='Кабинет');
 if(dayRowIndex<0||headerRowIndex<0)throw new Error('В сводной таблице не найдены дни недели или заголовок «Кабинет».');
 const columnDays=[];let column=0;for(const cell of rows[dayRowIndex].querySelectorAll('td,th')){const day=IMPORT_DAY_NAMES[importElementText(cell)]||null,span=Math.max(1,Number(cell.getAttribute('colspan'))||1);for(let index=0;index<span;index++)columnDays[column+index]=day;column+=span;}
 const headers=[...rows[headerRowIndex].querySelectorAll('td,th')],rooms=[],lessons=[];
 for(const row of rows.slice(headerRowIndex+1)){const cells=[...row.querySelectorAll('td,th')],room=importElementText(cells[0]);if(!room)continue;rooms.push(room);for(let index=1;index<cells.length;index++){const raw=importElementText(cells[index]),day=columnDays[index],period=Number(importElementText(headers[index]));if(!raw||!day||!Number.isInteger(period))continue;lessons.push({room_label:room,room_num:importedRoomNumber(room),day,period,...parseImportedCell(raw)});}}
 if(!rooms.length)throw new Error('Не удалось прочитать кабинеты из файла.');return {rooms,lessons};
}
function parseSingleEdupageSheet(raw){
 const split=raw.search(/\r?\n\r?\n/),separator=split>=0?(raw.slice(split).match(/^\r?\n\r?\n/)?.[0]||'\n\n'):'',headers=split>=0?mimeHeaders(raw.slice(0,split)):{},contentType=headers['content-type']||'';
 const charset=contentType.match(/charset="?([^";\s]+)/i)?.[1]||'utf-8',encoding=(headers['content-transfer-encoding']||'').toLowerCase(),body=split>=0?raw.slice(split+separator.length):raw,html=/^text\/html/i.test(contentType)?decodeMimePart(body,encoding,charset):raw,table=new window.DOMParser().parseFromString(html,'text/html').querySelector('table');
 if(!table)throw new Error('В файле не найдена таблица расписания EduPage.');const parsed=parseImportedSummaryTable(table);return {...parsed,parseIssues:[]};
}
function parseEdupageArchive(raw){
 const boundary=raw.match(/boundary="?([^";\r\n]+)"?/i)?.[1];if(!boundary)return parseSingleEdupageSheet(raw);const parts=new Map(),partTypes=new Map();
 for(const block of raw.split(`--${boundary}`).slice(1)){const split=block.search(/\r?\n\r?\n/);if(split<0)continue;const separator=block.match(/\r?\n\r?\n/)?.[0]||'\n\n',headers=mimeHeaders(block.slice(0,split)),location=headers['content-location'];if(!location)continue;const name=mimeBasename(location),contentType=headers['content-type']||'',charset=contentType.match(/charset="?([^";\s]+)/i)?.[1]||'utf-8',body=block.slice(split+separator.length).replace(/\r?\n--$/,'');parts.set(name,decodeMimePart(body,(headers['content-transfer-encoding']||'').toLowerCase(),charset));partTypes.set(name,contentType);}
 const tabstrip=parts.get('tabstrip.htm');if(!tabstrip)throw new Error('В файле не найден список кабинетов EduPage.');const navigation=new window.DOMParser().parseFromString(tabstrip,'text/html'),rooms=[],lessons=[],parseIssues=[];
 for(const link of navigation.querySelectorAll('a[href]')){const room=cleanImportText(link.textContent),href=mimeBasename(link.getAttribute('href')),sheet=parts.get(href);if(!room)continue;rooms.push(room);if(!sheet){parseIssues.push({type:'missing-sheet',room_label:room,source:href});continue;}if(!/^text\/html/i.test(partTypes.get(href)||'')){parseIssues.push({type:'invalid-sheet-mime',room_label:room,source:href});continue;}const table=new window.DOMParser().parseFromString(sheet,'text/html').querySelector('table');if(!table){parseIssues.push({type:'missing-table',room_label:room,source:href});continue;}lessons.push(...parseImportedSheet(table,room));}
 if(!rooms.length)throw new Error('Не удалось прочитать кабинеты из файла.');return {rooms,lessons,parseIssues};
}
function matchesImportOverride(lesson,criteria){return Object.entries(criteria||{}).every(([key,value])=>lesson[key]===value);}
const IMPORT_EXPECTED_ROOM_IDS=['f1-gym','f1-103'];
const roomIndexForCoverage=roomId=>allRooms.find(room=>room.room_id===roomId)?.n||roomId;
function importMappingFor(label,lesson,mapping,roomIndex){
 const roomLabel=IMPORT_ROOM_ALIASES[label]||label,normalized=lesson?{...lesson,room_label:roomLabel}:null,base=mapping.get(roomLabel),override=normalized?(D.lessonOverrides||[]).find(item=>matchesImportOverride(normalized,item.match)):null,roomId=override?.map_room_id||base?.map_room_id,target=roomIndex.get(roomId);
 return {roomLabel,normalized,base,override,roomId,target};
}
function mapImportedSchedule(parsed){
 const mapping=new Map((D.roomMapping||[]).map(item=>[item.schedule_label,item])),roomIndex=new Map(allRooms.map(room=>[room.room_id,room])),unmapped=new Set(),lessons=[],coverage=new Map();
 const coverageFor=label=>{if(!coverage.has(label)){const resolved=importMappingFor(label,null,mapping,roomIndex);coverage.set(label,{sourceLabel:label,rawCount:0,mappedCount:0,targetRoomIds:resolved.roomId&&resolved.target?[resolved.roomId]:[],targetMapLabels:resolved.target?[resolved.target.n]:[],targetRoomId:resolved.roomId&&resolved.target?resolved.roomId:null,targetMapLabel:resolved.target?.n||null,mappingStatus:resolved.base?.status||'unresolved',parseIssues:(parsed.parseIssues||[]).filter(issue=>issue.room_label===label)});}return coverage.get(label);};
 for(const room of parsed.rooms||[])coverageFor(room);
 for(const lesson of parsed.lessons){const row=coverageFor(lesson.room_label);row.rawCount++;const resolved=importMappingFor(lesson.room_label,lesson,mapping,roomIndex),{roomLabel,normalized,base,override,roomId,target}=resolved;if(!base||!roomId||!target){unmapped.add(lesson.room_label);continue;}if(!row.targetRoomIds.includes(roomId))row.targetRoomIds.push(roomId);if(!row.targetMapLabels.includes(target.n))row.targetMapLabels.push(target.n);row.targetRoomId=row.targetRoomIds.length===1?roomId:null;row.targetMapLabel=row.targetMapLabels.length===1?target.n:null;row.mappingStatus=override?.status||base.status||'manual_confirmed';row.mappedCount++;lessons.push({...normalized,map_room_id:roomId,map_label:target.n,floor:Number(roomFloors(roomId)[0]||base.floor),mapping_status:row.mappingStatus});}
 return {lessons,unmapped:[...unmapped].sort((a,b)=>a.localeCompare(b,'ru')),coverage:[...coverage.values()]};
}
function importTimeKey(value){return String(value||'').replace(/^(\d):/,'0$1:');}
function importLessonKey(lesson){return [lesson.map_room_id,lesson.day,lesson.period,importTimeKey(lesson.start),importTimeKey(lesson.end),lesson.raw].join('|');}
function validRemoteLesson(lesson,roomIds){
 if(!lesson||typeof lesson!=='object'||Array.isArray(lesson))return false;
 const text=(value,max=Infinity)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
 const time=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
 return text(lesson.room_label,160)&&(lesson.room_num===null||lesson.room_num===undefined||text(lesson.room_num))&&DAYS.slice(0,5).includes(lesson.day)&&Number.isInteger(lesson.period)&&lesson.period>=0&&lesson.period<=10&&time(lesson.start)&&time(lesson.end)&&min(lesson.start)<min(lesson.end)&&Array.isArray(lesson.classes)&&lesson.classes.every(value=>value===null||typeof value==='string')&&(lesson.group===null||lesson.group===undefined||text(lesson.group))&&text(lesson.subject_teacher,500)&&text(lesson.raw,1000)&&typeof lesson.map_room_id==='string'&&roomIds.has(lesson.map_room_id)&&text(lesson.map_label)&&Number.isInteger(lesson.floor)&&lesson.floor>=1&&lesson.floor<=4&&text(lesson.mapping_status,80);
}
function validImportedLesson(lesson){
 if(!lesson||typeof lesson!=='object'||Array.isArray(lesson))return false;
 const text=(value,max=Infinity)=>typeof value==='string'&&value.trim().length>0&&value.length<=max,time=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
 return text(lesson.room_label,160)&&DAYS.slice(0,5).includes(lesson.day)&&Number.isInteger(lesson.period)&&lesson.period>=0&&lesson.period<=10&&time(lesson.start)&&time(lesson.end)&&min(lesson.start)<min(lesson.end)&&Array.isArray(lesson.classes)&&lesson.classes.length>0&&lesson.classes.every(value=>text(value))&&text(lesson.subject_teacher,500)&&text(lesson.raw,1000);
}
function validateImportedSchedule(parsed,mapped){
 const malformed=parsed.lessons.filter(lesson=>!validImportedLesson(lesson)).length,seen=new Set(),duplicates=mapped.lessons.reduce((count,lesson)=>{const key=importLessonKey(lesson);if(seen.has(key))return count+1;seen.add(key);return count;},0),current=new Set(D.lessons.map(importLessonKey)),incoming=new Set(mapped.lessons.map(importLessonKey)),added=[...incoming].filter(key=>!current.has(key)).length,removed=[...current].filter(key=>!incoming.has(key)).length,currentRoomCounts=Object.fromEntries(allRooms.map(room=>[room.room_id,D.lessons.filter(lesson=>lesson.map_room_id===room.room_id).length])),incomingRoomCounts=Object.fromEntries(allRooms.map(room=>[room.room_id,mapped.lessons.filter(lesson=>lesson.map_room_id===room.room_id).length])),coverage=mapped.coverage||[],emptyMappedRooms=coverage.filter(row=>row.rawCount===0&&row.targetRoomId).map(row=>({...row,status:'unknown'})),unresolvedEmptyRooms=coverage.filter(row=>row.rawCount===0&&!row.targetRoomId).map(row=>({...row,status:'unknown'})),missingExpectedRooms=IMPORT_EXPECTED_ROOM_IDS.map(roomId=>({roomId,mapLabel:roomIndexForCoverage(roomId),sourceLabels:coverage.filter(row=>row.targetRoomIds.includes(roomId)).map(row=>row.sourceLabel),status:'unknown'})).filter(row=>!incomingRoomCounts[row.roomId]);
 const roomsLosingAllLessons=allRooms.filter(room=>currentRoomCounts[room.room_id]>0&&!incomingRoomCounts[room.room_id]).map(room=>({roomId:room.room_id,mapLabel:room.n,currentCount:currentRoomCounts[room.room_id],incomingCount:0})),parseIssues=parsed.parseIssues||[];
 return {roomCount:parsed.rooms.length,lessonCount:parsed.lessons.length,mappedCount:mapped.lessons.length,malformed,duplicates,unmapped:mapped.unmapped,added,removed,coverage,emptyMappedRooms,unresolvedEmptyRooms,missingExpectedRooms,roomsLosingAllLessons,parseIssues,valid:parsed.rooms.length>=1&&parsed.rooms.length<=500&&parsed.lessons.length>=100&&parsed.lessons.length<=5000&&!malformed&&!duplicates&&!mapped.unmapped.length&&!parseIssues.length&&mapped.lessons.length===parsed.lessons.length};
}
async function fileSha256(bytes){const subtle=window.crypto?.subtle||globalThis.crypto?.subtle;if(!subtle)throw new Error('Браузер не поддерживает безопасную проверку файла.');const digest=await subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');}
function formatScheduleDate(value){return value?formatTimestamp(value):'';}
function renderScheduleCurrent(){const target=$('schedule-current');if(!target)return;target.innerHTML=scheduleInfo?`Сейчас опубликован <strong>${esc(scheduleInfo.source_file)}</strong><br>${scheduleInfo.lesson_count} занятий · ${scheduleInfo.room_count} кабинетов · ${esc(formatScheduleDate(scheduleInfo.imported_at))}`:'Сейчас используется расписание, встроенное при сборке сайта.';}
function renderSchedulePreview(){
 const target=$('schedule-preview');if(!scheduleImport){target.innerHTML='<p>После выбора файла здесь появится проверка.</p>';return;}const v=scheduleImport.validation,warnings=[],coverage=v.coverage||[];if(v.roomCount<1||v.roomCount>500)warnings.push(`Число кабинетов вне диапазона 1–500: ${v.roomCount}`);if(v.lessonCount<100||v.lessonCount>5000)warnings.push(`Число занятий вне диапазона 100–5000: ${v.lessonCount}`);if(v.unmapped.length)warnings.push(`Нет привязки для строк: ${v.unmapped.join(', ')}`);if(v.malformed)warnings.push(`Не разобрано строк: ${v.malformed}`);if(v.duplicates)warnings.push(`Повторов: ${v.duplicates}`);if(v.parseIssues?.length)warnings.push(`Ошибки листов: ${v.parseIssues.map(issue=>`${issue.room_label} · ${issue.type}`).join(', ')}`);if(v.emptyMappedRooms?.length)warnings.push(`Пустые привязанные листы: ${v.emptyMappedRooms.map(row=>`${row.sourceLabel} → ${row.targetMapLabel||row.targetRoomId} · неизвестно`).join(', ')}`);if(v.unresolvedEmptyRooms?.length)warnings.push(`Пустые листы без привязки: ${v.unresolvedEmptyRooms.map(row=>`${row.sourceLabel} · неизвестно`).join(', ')}`);if(v.missingExpectedRooms?.length)warnings.push(`Нет входящих строк для ожидаемых кабинетов: ${v.missingExpectedRooms.map(row=>`${row.mapLabel} (${row.roomId}) · неизвестно`).join(', ')}`);if(v.roomsLosingAllLessons?.length)warnings.push(`Текущие кабинеты потеряют все строки: ${v.roomsLosingAllLessons.map(row=>`${row.mapLabel} (${row.roomId}), было ${row.currentCount}`).join(', ')}`);
 const coverageMarkup=coverage.length?`<div class="schedule-coverage-wrap"><table class="schedule-coverage" aria-label="Покрытие кабинетов импортом"><thead><tr><th>Источник</th><th>Строк</th><th>Привязано</th><th>Текущий кабинет</th><th>Статус</th></tr></thead><tbody>${coverage.map(row=>{const empty=row.rawCount===0,unresolved=!row.targetRoomIds?.length,status=empty||unresolved||row.mappedCount!==row.rawCount,labels=row.targetMapLabels?.join(', ')||'—',targetRoomIds=row.targetRoomIds?.join(', ')||'—',statusText=empty?'Неизвестно, строк нет':unresolved?'Неизвестно, нет привязки':row.mappedCount===row.rawCount?'Покрыто':'Частично';return `<tr class="${status?'schedule-coverage-warning':''}"><td>${esc(row.sourceLabel)}</td><td>${row.rawCount}</td><td>${row.mappedCount}</td><td>${esc(labels)} <small>${esc(targetRoomIds)}</small></td><td>${statusText}</td></tr>`}).join('')}</tbody></table></div>`:'';
 target.innerHTML=`<div class="schedule-preview-grid"><div class="schedule-stat"><strong>${v.roomCount}</strong><span>кабинетов в файле</span></div><div class="schedule-stat"><strong>${v.lessonCount}</strong><span>занятий</span></div><div class="schedule-stat"><strong>+${v.added}</strong><span>новых строк</span></div><div class="schedule-stat"><strong>−${v.removed}</strong><span>убрано строк</span></div></div><p class="schedule-file-name">${esc(scheduleImport.fileName)}</p>${warnings.length?`<p class="schedule-warning">${esc(warnings.join(' · '))}</p>`:'<p class="schedule-ok">Файл полностью разобран, все непустые строки привязаны.</p>'}${coverageMarkup}`;
}
function clearScheduleImport(){if(schedulePublishInFlight)return false;scheduleImportRequest++;scheduleImport=null;$('schedule-file').value='';$('schedule-publish').disabled=true;$('schedule-clear').disabled=true;$('schedule-message').className='form-message';$('schedule-message').textContent='';renderSchedulePreview();return true;}
async function inspectScheduleFile(file){
 if(schedulePublishInFlight)return;clearScheduleImport();if(!file)return;const request=scheduleImportRequest;if(file.size>8*1024*1024){$('schedule-message').className='form-message error';$('schedule-message').textContent='Файл больше 8 МБ.';return;}const message=$('schedule-message');message.className='form-message';message.textContent='Читаем и проверяем файл…';try{const bytes=await file.arrayBuffer(),raw=importBinaryString(bytes),parsed=parseEdupageArchive(raw),mapped=mapImportedSchedule(parsed),validation=validateImportedSchedule(parsed,mapped),sha256=await fileSha256(bytes);if(request!==scheduleImportRequest||schedulePublishInFlight)return;scheduleImport={fileName:file.name,sha256,roomCount:parsed.rooms.length,lessons:mapped.lessons,validation};renderSchedulePreview();$('schedule-clear').disabled=false;$('schedule-publish').disabled=!validation.valid;message.className=validation.valid?'form-message success':'form-message error';message.textContent=validation.valid?'Проверка пройдена. Можно публиковать.':'Публикация заблокирована, исправьте указанные проблемы.';}catch(error){if(request!==scheduleImportRequest||schedulePublishInFlight)return;message.className='form-message error';message.textContent=`Не удалось прочитать файл: ${error.message}`;}
}
// A newer load supersedes an older one, which then resolves false; callers that must see the final state await scheduleRemoteLoad.
function loadRemoteSchedule(){const load=fetchRemoteSchedule();scheduleRemoteLoad=load;return load;}
async function fetchRemoteSchedule(){
 if(!cloud)return false;const request=++scheduleRemoteRequest;try{const result=await cloud.rpc('map_active_schedule');if(request!==scheduleRemoteRequest)return false;const {data,error}=result||{};if(error)throw error;if(data===null){if(scheduleInfo)throw new Error('активное расписание не найдено');scheduleRemoteError='';renderScheduleCurrent();return true;}const remoteLessons=data?.lessons,remoteImport=data?.import,declaredCount=remoteImport?.lesson_count,roomCount=remoteImport?.room_count,roomIds=new Set(allRooms.map(room=>room.room_id));if(!remoteImport||typeof remoteImport!=='object'||Array.isArray(remoteImport)||!Number.isInteger(declaredCount)||declaredCount<100||declaredCount>5000||!Number.isInteger(roomCount)||roomCount<1||roomCount>500||typeof remoteImport.source_file!=='string'||remoteImport.source_file.trim().length<1||remoteImport.source_file.length>255||typeof remoteImport.source_sha256!=='string'||!/^[0-9a-f]{64}$/i.test(remoteImport.source_sha256)||typeof remoteImport.imported_at!=='string'||!Number.isFinite(Date.parse(remoteImport.imported_at))||!Array.isArray(remoteLessons)||remoteLessons.length!==declaredCount||!remoteLessons.every(lesson=>validRemoteLesson(lesson,roomIds)))throw new Error('получен неполный или некорректный ответ');D.lessons=remoteLessons;scheduleInfo=remoteImport;scheduleRemoteError='';indexLessons();renderScheduleCurrent();$('schedule-source').textContent=`EduPage · ${scheduleInfo.source_file||'онлайн'} · кружки 2026–2027`;updateMap();renderCard();if($('availability-dialog').hasAttribute('open')){availabilityBookings=[];invalidateAvailability();try{await searchAvailability();}catch(error){console.warn('Availability refresh after schedule load failed',error);}}return true;}catch(error){if(request!==scheduleRemoteRequest)return false;const detail=String(error?.message||error||'неизвестная ошибка');scheduleRemoteError=`Расписание не обновлено: ${detail}`;$('schedule-source').textContent=`${scheduleRemoteError}. Используется последняя версия.`;console.warn('Schedule load failed',error);return false;}
}
function updateScheduleVisibility(){const allowed=Boolean(superadmin),button=$('schedule-toggle');button.hidden=!allowed;if(!allowed&&$('schedule-dialog').hasAttribute('open'))hideModal($('schedule-dialog'));}
async function openScheduleImport(){if(!superadmin||!cloud){toast('Импорт доступен только суперадмину.');return;}clearScheduleImport();renderScheduleCurrent();showModal($('schedule-dialog'));}
async function publishScheduleImport(){
 if(schedulePublishInFlight||!scheduleImport?.validation.valid||!superadmin||!cloud)return false;if(!window.confirm?.(`Опубликовать ${scheduleImport.validation.lessonCount} занятий из ${scheduleImport.fileName} для всех пользователей?`))return false;const selected=scheduleImport,generation=scheduleImportRequest,button=$('schedule-publish'),clearButton=$('schedule-clear'),fileInput=$('schedule-file'),message=$('schedule-message'),deepFreeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(deepFreeze);}return value;},validation=deepFreeze({unmapped_rooms:0,malformed_rows:selected.validation.malformed,duplicate_rows:selected.validation.duplicates,added_rows:selected.validation.added,removed_rows:selected.validation.removed}),payload=deepFreeze({p_source_file:String(selected.fileName),p_source_sha256:String(selected.sha256),p_room_count:Number(selected.roomCount),p_lessons:selected.lessons.map(lesson=>({...lesson,classes:Array.isArray(lesson.classes)?[...lesson.classes]:lesson.classes})),p_validation:validation});schedulePublishInFlight=true;button.disabled=true;clearButton.disabled=true;fileInput.disabled=true;message.className='form-message';message.textContent='Публикуем расписание…';try{const result=await cloud.rpc('map_publish_schedule',payload),error=result?.error;if(error){message.className='form-message error';message.textContent=String(error.message).includes('already active')?'Этот файл уже опубликован.':`Не удалось опубликовать: ${error.message}`;return false;}if(scheduleImport===selected&&scheduleImportRequest===generation){scheduleImportRequest++;scheduleImport=null;fileInput.value='';clearButton.disabled=true;button.disabled=true;renderSchedulePreview();}let load=loadRemoteSchedule(),refreshed=await load;while(!refreshed&&scheduleRemoteLoad!==load){load=scheduleRemoteLoad;refreshed=await load;}const confirmed=refreshed&&scheduleInfo&&String(scheduleInfo.source_sha256||'').toLowerCase()===String(selected.sha256).toLowerCase();if(!confirmed){message.className='form-message error';message.textContent='Расписание сохранено, но не удалось подтвердить обновление. Используется последняя версия.';return false;}message.className='form-message success';message.textContent='Готово. Новое расписание опубликовано для всех.';toast('Расписание EduPage обновлено.');return true;}catch(error){message.className='form-message error';message.textContent=`Не удалось опубликовать: ${error?.message||error}`;return false;}finally{schedulePublishInFlight=false;fileInput.disabled=false;clearButton.disabled=!scheduleImport;button.disabled=!scheduleImport?.validation?.valid;}
}
// Session, date and rows of the last bookings this function rendered: an identical reload (window focus, realtime echo)
// does not re-render the map and the card, as long as nothing changed the bookings in between.
let loadedBookingsKey='';
async function loadBookings(){
 void refreshHall();
 if(!cloud){bookings=[];updateMap();renderCard();return;}
 const requestedDate=state.date,request=++bookingLoadRequest;
 try{
  const {data,error}=await cloud.from('room_bookings').select('*').eq('booking_date',requestedDate).order('starts_at');
  if(request!==bookingLoadRequest||requestedDate!==state.date)return false;
  if(error){toast('Не удалось обновить брони.');return false;}const next=(data||[]).filter(booking=>booking.booking_date===requestedDate),rows=JSON.stringify(next),key=`${sessionKey(session)}|${requestedDate}|${rows}`,same=key===loadedBookingsKey&&JSON.stringify(bookings)===rows;bookings=next;loadedBookingsKey=key;if(!same){updateMap();renderCard();}return true;
 }catch(_error){
  if(request!==bookingLoadRequest||requestedDate!==state.date)return false;
  toast('Не удалось обновить брони.');return false;
 }
}
function syncRealtime(){
 if(bookingChannel){cloud.removeChannel(bookingChannel);bookingChannel=null;}
 if(!cloud)return;
 bookingChannel=cloud.channel('quantum-map-live').on('postgres_changes',{event:'*',schema:'public',table:'room_bookings'},()=>{loadBookings();if($('availability-dialog').hasAttribute('open'))searchAvailability();}).on('postgres_changes',{event:'*',schema:'public',table:'map_adjustments'},()=>loadAdjustments()).on('postgres_changes',{event:'*',schema:'public',table:'map_evacuation'},()=>{if(typeof evacLoad==='function')evacLoad();}).on('postgres_changes',{event:'UPDATE',schema:'public',table:'map_schedule_imports'},payload=>{if(payload.new?.active)loadRemoteSchedule();}).subscribe();
}
async function loadAccess(){
 const request=++accessRequest,capturedSession=session,capturedKey=sessionKey(capturedSession);
  if(!cloud||!capturedSession||!capturedSession.user?.id)return false;
 try{
  const [profileResult,superResult]=await Promise.all([
   cloud.from('map_profiles').select('display_name,role,approved').eq('user_id',capturedSession.user.id).maybeSingle(),
   cloud.from('map_superadmins').select('user_id').eq('user_id',capturedSession.user.id).maybeSingle()
  ]);
  if(request!==accessRequest||session!==capturedSession||sessionKey(session)!==capturedKey)return false;
   if(profileResult?.error||superResult?.error){failAuditAccessCheck();toast('Не удалось проверить роль.');return false;}
   auditAccessBlocked=false;profile=profileResult.data||null;superadmin=Boolean(superResult.data);updateAuthButton();updateCalendarVisibility();return true;
 }catch(error){
   if(request!==accessRequest||session!==capturedSession||sessionKey(session)!==capturedKey)return false;failAuditAccessCheck();toast('Не удалось проверить роль.');return false;
  }
}
function applyAuthStateChange(next){
 const previousUserId=session?.user?.id||'',nextUserId=next?.user?.id||'',identityChanged=previousUserId!==nextUserId;
  const tokenChanged=session?.access_token!==next?.access_token;
 accessRequest++;
 session=next;
 hallReadRequest++;hallSnapshots.clear();invalidateSyncEvents();syncEditRequest++;bookingContextRequest++;bookingEditContext=null;bookingModalRevision++;
 if(identityChanged){
  bookingRetry=null;eventRetry=null;conflictRetries.clear();bookingConflictChoice=null;syncEdit=null;hideModal($('hall-event-dialog'));hideModal($('hall-calendar-dialog'));
  profile=null;superadmin=false;auditAccessBlocked=false;auditViewToken++;resetBookingAuditState();
   calendarRequest++;invalidateCalendarPreview();clearCalendarPending();calendarStatus=null;updateCalendarVisibility();
  bookingOpenRequest++;bookingReportRequest++;bookingReport=[];renderBookingReport();
  clearBookingDraft();$('booking-id').value='';$('booking-delete').hidden=true;hideModal($('booking-dialog'));
  }else{
   if(tokenChanged){calendarRequest++;invalidateCalendarPreview();calendarBusy=false;calendarStatus=null;updateCalendarDialog();}
  auditRequest++;auditLoading=false;auditAppending=false;
  if($('booking-audit-dialog')?.hasAttribute('open')){setBookingAuditMessage('Проверяем доступ к истории…');renderBookingAudit();}
 }
 updateAuthButton();
 return identityChanged;
}
function handleAuthStateChange(_event,next){
 applyAuthStateChange(next);
 const capturedSession=next,capturedKey=sessionKey(capturedSession);
  setTimeout(async()=>{if(session!==capturedSession||sessionKey(session)!==capturedKey)return;const accessVerified=await loadAccess();if(session!==capturedSession||sessionKey(session)!==capturedKey)return;if(accessVerified&&calendarAccessAllowed()&&$('calendar-dialog')?.hasAttribute('open'))await loadCalendarStatus();if(session!==capturedSession||sessionKey(session)!==capturedKey)return;if(accessVerified&&auditAccessAllowed()&&$('booking-audit-dialog')?.hasAttribute('open'))await loadBookingAudit(false);if(session!==capturedSession||sessionKey(session)!==capturedKey)return;await recordPresence();await Promise.all([loadBookings(),loadAdjustments(),typeof evacLoad==='function'?evacLoad():null]);if(session!==capturedSession||sessionKey(session)!==capturedKey)return;syncRealtime();},0);
}
function updateStaffVisibility(){
 const allowed=Boolean(superadmin);$('staff-toggle').hidden=!allowed;
 if(!allowed&&$('staff-dialog').hasAttribute('open'))hideModal($('staff-dialog'));
 if(!allowed){recurringState=null;if($('recurring-panel')){$('recurring-panel').hidden=true;$('recurring-rules').innerHTML='';$('recurring-skips').innerHTML='';}}
}
function staffInitials(entry){
 const source=(entry.display_name||entry.email.split('@')[0]).trim();return source.split(/[\s._-]+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toLocaleUpperCase()).join('')||'Q';
}
function mergeStaffEntries(profiles,allowlist){
 const overrides=new Map(allowlist.map(row=>[row.email,row])),seen=new Set();
 const entries=profiles.map(row=>{const override=overrides.get(row.email);seen.add(row.email);return {...row,explicit:Boolean(override),display_name:override?.display_name||row.display_name||'',role:override?.role||row.role,approved:override?override.approved:row.approved,weekly_booking_limit:override?override.weekly_booking_limit:row.weekly_booking_limit,pending:false};});
 for(const override of allowlist)if(!seen.has(override.email))entries.push({user_id:null,email:override.email,display_name:override.display_name||'',role:override.role,approved:override.approved,weekly_booking_limit:override.weekly_booking_limit,last_seen_at:null,explicit:true,pending:true,created_at:override.created_at,updated_at:null});
 return entries.sort((a,b)=>(b.approved-a.approved)||(a.display_name||a.email).localeCompare(b.display_name||b.email,'ru'));
}
function seenLabel(value){return value?formatTimestamp(value):'ещё не заходил';}
function renderStaffPanel(){
 const q=$('staff-search').value.trim().toLocaleLowerCase(),visible=staffEntries.filter(entry=>(`${entry.display_name} ${entry.email}`).toLocaleLowerCase().includes(q));
 const active=staffEntries.filter(entry=>entry.approved).length,admins=staffEntries.filter(entry=>entry.approved&&entry.role==='admin').length,blocked=staffEntries.length-active;
 $('staff-summary').innerHTML=`<span><strong>${active}</strong> с доступом</span><span><strong>${admins}</strong> администраторов</span><span><strong>${blocked}</strong> заблокировано</span>`;
 if(staffLoading){$('staff-list').innerHTML='<p class="staff-empty">Загружаем сотрудников…</p>';return;}
 if(!visible.length){$('staff-list').innerHTML=`<p class="staff-empty">${q?'Ничего не найдено.':'Пока никто не входил в карту.'}</p>`;return;}
 $('staff-list').innerHTML=visible.map(entry=>{const self=entry.user_id===session?.user?.id,role=self?'admin':entry.role,status=self?'Суперадмин':!entry.approved?'Доступ закрыт':entry.pending?'Ещё не входил':entry.role==='admin'?'Администратор':'Сотрудник',stats=staffBookingStats.get(entry.user_id)||{total:0,upcoming:0},limit=role==='admin'?'':entry.weekly_booking_limit??3,limitLabel=role==='admin'?'Лимит: без ограничения для администратора':entry.weekly_booking_limit?`Индивидуальный лимит: ${entry.weekly_booking_limit} будущих броней`:'По умолчанию: 3 будущие брони';return `<article class="staff-row ${entry.approved?'':'blocked'}" data-staff-email="${esc(entry.email)}"><div class="staff-person"><span class="staff-avatar">${esc(staffInitials(entry))}</span><div><strong>${esc(entry.display_name||entry.email.split('@')[0])}</strong><span>${esc(entry.email)}</span><small>${esc(status)}${entry.explicit?' · настроено вручную':' · автоматически'}</small><small>${esc(limitLabel)}</small><small>Последний вход: ${esc(seenLabel(entry.last_seen_at))} · броней: ${stats.total}, будущих: ${stats.upcoming}</small></div></div><label>Имя<input data-staff-name type="text" maxlength="120" value="${esc(entry.display_name||'')}" placeholder="Имя сотрудника"></label><label>Роль<select data-staff-role ${self?'disabled':''}><option value="staff" ${role==='staff'?'selected':''}>Сотрудник</option><option value="admin" ${role==='admin'?'selected':''}>Администратор</option></select></label><label>Лимит будущих<input data-staff-limit type="number" min="1" max="100" inputmode="numeric" value="${limit}" placeholder="${role==='admin'?'Без ограничения':'По умолчанию 3'}"></label><label class="staff-access"><input data-staff-approved type="checkbox" ${entry.approved?'checked':''} ${self?'disabled':''}><span>Разрешить бронирование</span></label><div class="staff-row-actions"><button class="primary-button" data-staff-save type="button">Сохранить</button>${entry.explicit&&!self?'<button class="secondary-button" data-staff-auto type="button">Вернуть авто</button>':''}</div></article>`;}).join('');
 $('staff-list').querySelectorAll('[data-staff-save]').forEach(button=>button.onclick=()=>saveStaffRow(button.closest('.staff-row')));
 $('staff-list').querySelectorAll('[data-staff-auto]').forEach(button=>button.onclick=()=>resetStaffRow(button.closest('.staff-row')));
}
async function loadStaffPanel(){
 if(!cloud||!superadmin)return;staffLoading=true;renderStaffPanel();$('staff-message').textContent='';
 const [profilesResult,allowlistResult,statsResult]=await Promise.all([cloud.from('map_profiles').select('user_id,email,display_name,role,approved,weekly_booking_limit,last_seen_at,created_at,updated_at').order('email'),cloud.from('map_staff_allowlist').select('email,display_name,role,approved,weekly_booking_limit,created_at').order('email'),cloud.rpc('map_staff_booking_stats_v2')]);
 staffLoading=false;if(profilesResult.error||allowlistResult.error||statsResult.error){$('staff-message').className='form-message error';$('staff-message').textContent='Не удалось загрузить сотрудников.';renderStaffPanel();return;}
 staffBookingStats=new Map((statsResult.data||[]).map(row=>[row.user_id,{total:Number(row.total_bookings)||0,upcoming:Number(row.upcoming_bookings)||0}]));
 staffEntries=mergeStaffEntries(profilesResult.data||[],allowlistResult.data||[]);renderStaffPanel();renderRecurringOwners();
}
async function openStaffPanel(){if(!superadmin||!cloud){toast('Панель доступна только суперадмину.');return;}$('staff-search').value='';showModal($('staff-dialog'));await Promise.all([loadStaffPanel(),loadRecurringPanel()]);renderRecurringOwners();}
async function saveStaffRow(row){
 if(!superadmin||!row)return;const email=row.dataset.staffEmail,current=staffEntries.find(entry=>entry.email===email),button=row.querySelector('[data-staff-save]');button.disabled=true;$('staff-message').className='form-message';$('staff-message').textContent='Сохраняем…';
 const self=current?.user_id===session?.user?.id,role=self?'admin':row.querySelector('[data-staff-role]').value,limitValue=row.querySelector('[data-staff-limit]').value.trim(),effectiveLimit=role==='admin'?null:(limitValue?Number(limitValue):3);if(effectiveLimit!==null&&(effectiveLimit<1||effectiveLimit>100)){button.disabled=false;$('staff-message').className='form-message error';$('staff-message').textContent='Лимит должен быть от 1 до 100 или пустым.';return;}const payload={email,display_name:row.querySelector('[data-staff-name]').value.trim()||null,role,approved:self?true:row.querySelector('[data-staff-approved]').checked,weekly_booking_limit:effectiveLimit};
 const {error}=await cloud.from('map_staff_allowlist').upsert(payload,{onConflict:'email'});button.disabled=false;if(error){$('staff-message').className='form-message error';$('staff-message').textContent=`Не удалось сохранить: ${error.message}`;return;}await loadStaffPanel();$('staff-message').className='form-message success';$('staff-message').textContent=`Настройки ${email} сохранены.`;
}
async function resetStaffRow(row){
 if(!superadmin||!row)return;const email=row.dataset.staffEmail;if(!window.confirm?.(`Вернуть автоматические права для ${email}?`))return;$('staff-message').className='form-message';$('staff-message').textContent='Возвращаем автоматическое правило…';const {error}=await cloud.from('map_staff_allowlist').delete().eq('email',email);if(error){$('staff-message').className='form-message error';$('staff-message').textContent=`Не удалось изменить доступ: ${error.message}`;return;}await loadStaffPanel();$('staff-message').className='form-message success';$('staff-message').textContent=`Для ${email} снова действует автоматическое правило.`;
}
// Recurring bookings: superadmin-only rules; the bookings themselves look ordinary.
let recurringState=null;
const RECURRING_BLOCKED_ROOMS=new Set(['assembly-hall','f1-gym','f2-213','f2-214']);
const RECURRING_DAY_SHORT=['Пн','Вт','Ср','Чт','Пт','Сб'];
const RECURRING_RUN_NOTES={OK:'работает',PAUSED:'на паузе',EXPIRED:'срок истёк',OWNER_CANNOT_BOOK:'у сотрудника нет права бронировать',ERROR:'ошибка запуска'};
const RECURRING_STATUSES={booked:'забронировано',adopted:'своя бронь',skipped_holiday:'пропуск: день без броней',skipped_lesson:'пропуск: урок',skipped_occupied:'пропуск: занято',skipped_room:'пропуск: кабинет закрыт'};
const RECURRING_ERRORS={RECURRING_OWNER_CANNOT_BOOK:'У сотрудника нет права бронировать.',RECURRING_ROOM_UNAVAILABLE:'Один из кабинетов закрыт для брони.',RECURRING_INVALID:'Проверьте дни, кабинеты и даты.',RECURRING_NOT_FOUND:'Правило уже удалено.'};
const recurringRoomLabel=id=>allRooms.find(room=>room.room_id===id)?.n||id;
function recurringDateField(id,label){return `<div class="date-entry"><input id="${id}-display" class="date-display" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="ДД/ММ/ГГГГ" aria-label="${label}" aria-describedby="${id}-error"><button class="date-picker-button" type="button" data-date-picker="${id}" aria-label="Открыть календарь: ${label}"><svg class="icon date-picker-icon" aria-hidden="true" focusable="false"><use href="#i-calendar"/></svg></button><input id="${id}" class="date-canonical" type="date" tabindex="-1" aria-hidden="true" aria-label="${label}"><span id="${id}-error" class="date-error" aria-live="polite"></span></div>`;}
// Sets both the live selection and the default option (also in DOM test doubles).
function setRecurringSelect(select,value){try{select.value=String(value);}catch(_error){}for(const option of select.querySelectorAll('option')){if(option.value===String(value))option.setAttribute('selected','');else option.removeAttribute('selected');}}
function recurringToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function recurringAddDays(iso,days){const date=new Date(`${iso}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function recurringRooms(){return allRooms.filter(room=>!RECURRING_BLOCKED_ROOMS.has(room.room_id)&&bookingAllowedRoom(room.room_id));}
function recurringMessage(text,kind=''){const node=$('recurring-message');if(!node)return;node.className=`form-message${kind?` ${kind}`:''}`;node.textContent=text;}
function recurringError(error){const message=String(error?.message||''),code=Object.keys(RECURRING_ERRORS).find(key=>message.includes(key));return code?RECURRING_ERRORS[code]:`Не удалось выполнить: ${message||'ошибка сервера'}`;}
function ensureRecurringPanel(){
 let panel=$('recurring-panel');if(panel)return panel;
 panel=document.createElement('section');panel.id='recurring-panel';panel.className='recurring-panel';panel.hidden=true;
 const roomOptions=recurringRooms().map(room=>`<option value="${esc(room.room_id)}">${esc(room.n)}</option>`).join('');
 panel.innerHTML=`<div class="recurring-head"><h3>Постоянные брони</h3><p>Система держит ближайшие брони сотрудника и ставит следующую дату, когда прошла самая ранняя. Брони выглядят как обычные, писем нет. Раздел видит только суперадмин.</p></div><div id="recurring-rules" class="recurring-rules"></div><form id="recurring-form" class="recurring-form"><input id="recurring-id" type="hidden" value=""><label>Сотрудник<select id="recurring-owner"></select></label><label>Цель брони<input id="recurring-purpose" type="text" maxlength="160" value="Офисные часы"></label><label>Классы<select id="recurring-band"><option value="secondary">6–11 классы</option><option value="primary">1–5 классы</option></select></label><label>Урок<select id="recurring-period"></select></label><label>Держать вперёд<input id="recurring-horizon" type="number" min="1" max="12" inputmode="numeric" value="3"></label><label>С${recurringDateField('recurring-from','Начало правила')}</label><label>По${recurringDateField('recurring-until','Конец правила')}</label><div class="recurring-days">${[1,2,3,4,5].map(day=>`<label>${RECURRING_DAY_SHORT[day-1]}<select data-recurring-day="${day}"><option value="">—</option>${roomOptions}</select></label>`).join('')}</div><p id="recurring-conflicts" class="recurring-conflicts" aria-live="polite"></p><div class="staff-row-actions"><button class="primary-button" type="submit">Сохранить правило</button><button id="recurring-cancel" class="secondary-button" type="button" hidden>Отменить изменение</button></div></form><form id="recurring-skip-form" class="recurring-skip-form"><label>День без автоброней${recurringDateField('recurring-skip-date','День без автоброней')}</label><label>Причина<input id="recurring-skip-note" type="text" maxlength="160" placeholder="Праздник или каникулы"></label><button class="secondary-button" type="submit">Добавить день</button></form><div id="recurring-skips" class="recurring-skips"></div><p id="recurring-message" class="form-message" aria-live="polite"></p>`;
 const footnote=document.querySelector('#staff-dialog .staff-footnote');footnote.parentNode.insertBefore(panel,footnote);
 for(const id of ['recurring-from','recurring-until','recurring-skip-date'])bindDateField(id);
 $('recurring-band').onchange=()=>{renderRecurringPeriods();renderRecurringConflicts();};
 $('recurring-period').onchange=renderRecurringConflicts;
 for(const select of panel.querySelectorAll('[data-recurring-day]'))select.onchange=renderRecurringConflicts;
 $('recurring-form').onsubmit=saveRecurringRule;$('recurring-cancel').onclick=()=>{resetRecurringForm();recurringMessage('');};
 $('recurring-skip-form').onsubmit=saveRecurringSkip;$('recurring-rules').onclick=handleRecurringRuleClick;$('recurring-skips').onclick=handleRecurringSkipClick;
 resetRecurringForm();
 return panel;
}
function renderRecurringPeriods(selected){const select=$('recurring-period');if(!select)return;const band=$('recurring-band').value||'secondary',current=selected??Number(select.value||9);select.innerHTML=D.bells[band].map(([a,b],period)=>`<option value="${period}" ${period===current?'selected':''}>${period} · ${a}–${b}</option>`).join('');}
function renderRecurringOwners(selected){const select=$('recurring-owner');if(!select)return;const value=selected??select.value,owners=staffEntries.filter(entry=>entry.user_id&&entry.approved).sort((a,b)=>(a.display_name||a.email).localeCompare(b.display_name||b.email,'ru'));select.innerHTML=`<option value="">Выберите сотрудника</option>${owners.map(entry=>`<option value="${esc(entry.user_id)}" ${entry.user_id===value?'selected':''}>${esc(entry.display_name||entry.email)} · ${esc(entry.email)}</option>`).join('')}`;}
function recurringSlots(){const band=$('recurring-band').value||'secondary',period=Number($('recurring-period').value),bell=D.bells[band]?.[period];if(!bell)return [];const [starts_at,ends_at]=bell;return [...document.querySelectorAll('[data-recurring-day]')].filter(select=>select.value).map(select=>({weekday:Number(select.getAttribute('data-recurring-day')),room_id:select.value,starts_at,ends_at,period_start:period,period_end:period}));}
function recurringConflictText(slot){const day=DAYS[slot.weekday-1],notes=[];for(const lesson of (byRoom.get(slot.room_id)||[]).filter(l=>l.day===day)){const [a,b]=lessonTimes(lesson);if(overlaps(slot.starts_at,slot.ends_at,a,b))notes.push(`урок ${a}–${b}`);}for(const club of (clubsByRoom.get(slot.room_id)||[]).filter(item=>item.day===day)){const [first,last]=clubPeriods(club);if(D.bells.secondary.some(([a,b],period)=>period>=first&&period<=last&&overlaps(slot.starts_at,slot.ends_at,a,b)))notes.push(`кружок «${club.title}»`);}return notes.length?`${RECURRING_DAY_SHORT[slot.weekday-1]} ${recurringRoomLabel(slot.room_id)}: ${notes.join(', ')}`:'';}
function renderRecurringConflicts(){const node=$('recurring-conflicts');if(!node)return;const lines=recurringSlots().map(recurringConflictText).filter(Boolean);node.textContent=lines.length?`По расписанию занято: ${lines.join('; ')}. Даты с уроком система пропустит, кружки сервер не проверяет.`:'';}
function recurringSlotsSummary(rule){const times=[...new Set(rule.slots.map(slot=>`${slot.starts_at}–${slot.ends_at}`))];return `${rule.slots.map(slot=>`${RECURRING_DAY_SHORT[slot.weekday-1]} ${recurringRoomLabel(slot.room_id)}`).join(' · ')} · ${times.join(', ')}`;}
function recurringOccurrenceLabel(item){return ['booked','adopted'].includes(item.status)&&!item.active?'отменена':RECURRING_STATUSES[item.status]||item.status;}
function renderRecurringRules(){
 const panel=ensureRecurringPanel();panel.hidden=!superadmin;if(!superadmin)return;
 const rules=recurringState?.rules||[],today=recurringState?.today||recurringToday();
 $('recurring-rules').innerHTML=rules.length?rules.map(rule=>{const upcoming=(rule.occurrences||[]).filter(item=>item.date>=today).slice(0,9);return `<article class="recurring-rule${rule.paused?' paused':''}" data-recurring-rule="${esc(rule.id)}"><div class="recurring-rule-main"><strong>${esc(rule.owner_name||rule.owner_email||'Сотрудник')}</strong><span>${esc(recurringSlotsSummary(rule))}</span><small>${esc(rule.purpose)} · держать ${esc(rule.horizon)} · ${esc(isoToDisplayDate(rule.valid_from))}–${esc(isoToDisplayDate(rule.valid_until))} · ${esc(RECURRING_RUN_NOTES[rule.last_run_note]||'ещё не запускалось')}</small><ul class="recurring-occurrences">${upcoming.map(item=>`<li class="${esc(item.status)}">${esc(isoToDisplayDate(item.date))} ${esc(recurringRoomLabel(item.room_id))} — ${esc(recurringOccurrenceLabel(item))}</li>`).join('')||'<li>Ближайших дат пока нет</li>'}</ul></div><div class="staff-row-actions"><button class="secondary-button" type="button" data-recurring-edit>Изменить</button><button class="secondary-button" type="button" data-recurring-pause>${rule.paused?'Возобновить':'Пауза'}</button><button class="secondary-button" type="button" data-recurring-delete>Удалить</button></div></article>`;}).join(''):'<p class="staff-empty">Постоянных броней нет.</p>';
 $('recurring-skips').innerHTML=(recurringState?.skip_dates||[]).map(skip=>`<span class="recurring-skip">${esc(isoToDisplayDate(skip.date))}${skip.note?` · ${esc(skip.note)}`:''}<button type="button" data-recurring-skip="${esc(skip.date)}" aria-label="Убрать день ${esc(isoToDisplayDate(skip.date))}"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-close"/></svg></button></span>`).join('');
}
function resetRecurringForm(rule=null){
 $('recurring-id').value=rule?.id??'';renderRecurringOwners(rule?.owner_id??'');$('recurring-owner').disabled=Boolean(rule);
 $('recurring-purpose').value=rule?.purpose??'Офисные часы';setRecurringSelect($('recurring-band'),rule?.grade_band??'secondary');renderRecurringPeriods(rule?.slots?.[0]?.period_start??9);
 $('recurring-horizon').value=String(rule?.horizon??3);const today=recurringToday();syncDateField('recurring-from',rule?.valid_from??today);syncDateField('recurring-until',rule?.valid_until??recurringAddDays(today,56));
 for(const select of document.querySelectorAll('[data-recurring-day]')){const day=Number(select.getAttribute('data-recurring-day'));setRecurringSelect(select,rule?.slots?.find(slot=>slot.weekday===day)?.room_id??'');}
 $('recurring-cancel').hidden=!rule;renderRecurringConflicts();
}
async function loadRecurringPanel(){ensureRecurringPanel();if(!cloud||!superadmin){renderRecurringRules();return;}const {data,error}=await cloud.rpc('recurring_booking_admin_state');if(error){recurringMessage('Постоянные брони недоступны: база ещё не обновлена или нет доступа.','error');return;}recurringState=data;renderRecurringRules();}
async function recurringCall(name,args,success){recurringMessage('Сохраняем…');const {data,error}=await cloud.rpc(name,args);if(error){recurringMessage(recurringError(error),'error');return false;}recurringState=data;renderRecurringRules();recurringMessage(success,'success');return true;}
async function saveRecurringRule(e){
 e?.preventDefault?.();if(!superadmin||!cloud)return;
 const id=$('recurring-id').value,owner=$('recurring-owner').value,purpose=$('recurring-purpose').value.trim(),slots=recurringSlots(),valid_from=dateFieldValue('recurring-from'),valid_until=dateFieldValue('recurring-until'),horizon=Number($('recurring-horizon').value||3);
 const problem=!id&&!owner?'Выберите сотрудника.':!purpose?'Укажите цель брони.':!slots.length?'Выберите кабинет хотя бы на один день.':!valid_from||!valid_until||valid_until<valid_from?'Проверьте даты правила.':!(Number.isInteger(horizon)&&horizon>=1&&horizon<=12)?'Держать вперёд можно от 1 до 12 броней.':'';
 if(problem){recurringMessage(problem,'error');return;}
 const rule={id:id?Number(id):null,owner_id:owner||null,purpose,grade_band:$('recurring-band').value||'secondary',horizon,valid_from,valid_until,slots};
 if(await recurringCall('recurring_booking_rule_save',{p_rule:rule},id?'Правило обновлено.':'Правило сохранено, ближайшие брони поставлены.'))resetRecurringForm();
}
async function handleRecurringRuleClick(e){
 const button=e.target?.closest?.('button'),card=button?.closest('[data-recurring-rule]');if(!button||!card||!superadmin||!cloud)return;
 const rule=(recurringState?.rules||[]).find(item=>String(item.id)===card.getAttribute('data-recurring-rule'));if(!rule)return;
 if(button.hasAttribute('data-recurring-edit')){resetRecurringForm(rule);recurringMessage(`Изменяете правило: ${rule.owner_name||rule.owner_email}.`);return;}
 if(button.hasAttribute('data-recurring-pause'))return recurringCall('recurring_booking_rule_pause',{p_id:rule.id,p_paused:!rule.paused},rule.paused?'Правило возобновлено.':'Правило на паузе.');
 if(button.hasAttribute('data-recurring-delete')){if(!window.confirm?.(`Удалить правило для ${rule.owner_name||rule.owner_email}? Уже поставленные брони останутся обычными бронями.`))return;return recurringCall('recurring_booking_rule_delete',{p_id:rule.id},'Правило удалено, брони остались.');}
}
async function saveRecurringSkip(e){e?.preventDefault?.();if(!superadmin||!cloud)return;const date=dateFieldValue('recurring-skip-date');if(!date){recurringMessage('Введите дату в формате ДД/ММ/ГГГГ.','error');return;}if(await recurringCall('recurring_booking_skip_date_set',{p_date:date,p_note:$('recurring-skip-note').value.trim()||null,p_enabled:true},'День добавлен. Уже поставленные на эту дату брони не удаляются.')){clearDateField('recurring-skip-date');$('recurring-skip-note').value='';}}
function handleRecurringSkipClick(e){const button=e.target?.closest?.('[data-recurring-skip]');if(!button||!superadmin||!cloud)return;return recurringCall('recurring_booking_skip_date_set',{p_date:button.getAttribute('data-recurring-skip'),p_note:null,p_enabled:false},'День убран.');}
const reportRoomLabel=id=>allRooms.find(room=>room.room_id===id)?.n||id;
function reportDateLabel(value){const iso=parseISODate(value)?.iso;if(!iso)return value;const weekday=new Intl.DateTimeFormat('ru-RU',{weekday:'short',timeZone:'UTC'}).format(dateObj(iso));return `${weekday}, ${isoToDisplayDate(iso)}`;}
function renderBookingReport(){
 const people=new Set(bookingReport.map(row=>row.created_by)),rooms=new Set(bookingReport.map(row=>row.room_id));$('booking-report-summary').innerHTML=`<span><strong>${bookingReport.length}</strong> броней</span><span><strong>${people.size}</strong> сотрудников</span><span><strong>${rooms.size}</strong> кабинетов</span>`;
 if(!bookingReport.length){$('booking-report-list').innerHTML='<p class="staff-empty">На выбранные даты броней нет.</p>';$('booking-report-export').disabled=true;return;}$('booking-report-export').disabled=false;
 const groups=new Map();for(const row of bookingReport){if(!groups.has(row.booking_date))groups.set(row.booking_date,[]);groups.get(row.booking_date).push(row);}
 $('booking-report-list').innerHTML=[...groups].map(([date,rows])=>`<section class="booking-report-day"><h3>${esc(reportDateLabel(date))}<span>${rows.length}</span></h3><div class="booking-table-wrap"><table><thead><tr><th>Время</th><th>Кабинет</th><th>Сотрудник</th><th>Для чего</th><th>Действие</th></tr></thead><tbody>${rows.map(row=>`<tr data-booking-report-id="${esc(row.id)}" tabindex="0"><td>${esc(String(row.starts_at).slice(0,5))}–${esc(String(row.ends_at).slice(0,5))}</td><td><strong>${esc(reportRoomLabel(row.room_id))}</strong></td><td>${esc(row.created_by_name||'Сотрудник')}</td><td>${esc(row.purpose)}</td><td><button class="booking-report-row" data-booking-report-id="${esc(row.id)}" type="button" aria-label="Открыть бронь ${esc(row.id)}">Открыть бронь</button></td></tr>`).join('')}</tbody></table></div></section>`).join('');
 $('booking-report-list').querySelectorAll('tr[data-booking-report-id]').forEach(row=>{const open=()=>openBookingReportRow(row.dataset.bookingReportId);row.onclick=event=>{if(!event.target.closest('button'))open();};row.onkeydown=event=>{if((event.key==='Enter'||event.key===' ')&&!event.target.closest('button')){event.preventDefault();open();}};});
 $('booking-report-list').querySelectorAll('button.booking-report-row').forEach(button=>button.onclick=event=>{event.stopPropagation();return openBookingReportRow(button.dataset.bookingReportId);});
}
async function fetchBookingById(id){
 try{const query=cloud.from('room_bookings').select('*').eq('id',id);return typeof query.maybeSingle==='function'?await query.maybeSingle():await query;}catch(error){return {data:null,error};}
}
function bookingNavigation(row){
 const roomId=String(row?.room_id||''),date=parseISODate(row?.booking_date)?.iso,band=String(row?.grade_band||''),startsAt=normalizedTime(String(row?.starts_at||'').slice(0,5)),endsAt=normalizedTime(String(row?.ends_at||'').slice(0,5)),floors=roomFloors(roomId);
 if(!row?.id)return {error:'у записи нет идентификатора.'};
 if(!date||!startsAt||!endsAt||min(endsAt)<=min(startsAt))return {error:'у записи нет корректного времени или даты.'};
 if(!D.bells[band])return {error:'у записи не указано расписание звонков.'};
 if(!floors.length)return {error:'кабинет записи больше не сопоставлен с картой.'};
 return {roomId,date,band,startsAt,endsAt,floor:floors.includes(state.floor)?state.floor:floors[0]};
}
async function openBookingReportRow(id){
 if(!cloud){bookingActionError('онлайн-брони недоступны.');return false;}
 const request=++bookingOpenRequest,message=$('booking-report-message');message.className='form-message';message.textContent='Открываем актуальную бронь…';
 const result=await fetchBookingById(id);if(request!==bookingOpenRequest)return false;
 if(result?.error){bookingActionError('не удалось перечитать запись из сети.');return false;}
 const row=Array.isArray(result?.data)?result.data[0]:result?.data;if(!row){bookingActionError('запись удалена или больше недоступна.');return false;}
 const navigation=bookingNavigation(row);if(navigation.error){bookingActionError(navigation.error);return false;}
 state.date=navigation.date;state.minute=min(navigation.startsAt);state.band=navigation.band;bookings=[];bookingLoadRequest++;closeBookingBoard(true);changeFloor(navigation.floor,navigation.roomId);updateDate(false);const navigationRequest=bookingOpenRequest,loaded=await loadBookings();if(navigationRequest!==bookingOpenRequest)return false;if(!loaded){bookingActionError('не удалось загрузить брони выбранной даты из сети.');return false;}const latest=bookings.find(item=>String(item.id)===String(row.id));if(!latest){bookingActionError('запись была удалена или перемещена. Обновите список броней.');return false;}const latestNavigation=bookingNavigation(latest);if(latestNavigation.error){bookingActionError(latestNavigation.error);return false;}if(latestNavigation.roomId!==navigation.roomId||latestNavigation.date!==navigation.date||latestNavigation.startsAt!==navigation.startsAt||latestNavigation.endsAt!==navigation.endsAt||latestNavigation.band!==navigation.band){bookingActionError('запись изменилась во время открытия. Обновите список броней.');return false;}message.textContent='';
 if(canManage(latest)&&canBook())openBooking(latest);return true;
}
async function loadBookingReport(){
 if(!cloud)return;bookingOpenRequest++;const from=dateFieldValue('booking-report-from'),to=dateFieldValue('booking-report-to'),message=$('booking-report-message'),request=++bookingReportRequest;message.className='form-message';if(!from||!to||from>to){bookingReport=[];renderBookingReport();message.classList.add('error');message.textContent=!from||!to?'Введите обе даты в формате ДД/ММ/ГГГГ.':'Дата начала не может быть позже даты окончания.';return;}bookingReport=[];renderBookingReport();message.textContent='Загружаем брони…';const rows=[];for(let offset=0;;offset+=REPORT_PAGE_SIZE){const {data,error}=await cloud.from('room_bookings').select('id,room_id,booking_date,starts_at,ends_at,purpose,created_by,created_by_name,created_at,updated_at').gte('booking_date',from).lte('booking_date',to).order('booking_date').order('starts_at').range(offset,offset+REPORT_PAGE_SIZE-1);if(request!==bookingReportRequest||from!==dateFieldValue('booking-report-from')||to!==dateFieldValue('booking-report-to'))return;if(error){message.classList.add('error');message.textContent='Не удалось загрузить список броней.';return;}rows.push(...(data||[]));if(!data||data.length<REPORT_PAGE_SIZE)break;}if(request!==bookingReportRequest)return;bookingReport=rows;message.textContent='';renderBookingReport();
}
async function openBookingReport(){return;
 if(!cloud){toast('Онлайн-брони пока недоступны.');return;}const today=dateFrom(clock());if(!dateFieldValue('booking-report-from'))syncDateField('booking-report-from',today);if(!dateFieldValue('booking-report-to')){const end=dateObj(today);end.setUTCDate(end.getUTCDate()+30);syncDateField('booking-report-to',end.toISOString().slice(0,10));}showModal($('booking-board-dialog'));await loadBookingReport();
}
function exportBookingReport(){
 const from=dateFieldValue('booking-report-from'),to=dateFieldValue('booking-report-to');if(!bookingReport.length||!from||!to||from>to){$('booking-report-message').className='form-message error';$('booking-report-message').textContent='Проверьте диапазон дат перед экспортом.';return;}const cell=value=>{const text=String(value??''),safe=/^[=+\-@]/.test(text)?`'${text}`:text;return `"${safe.replace(/"/g,'""')}"`;},rows=[['Дата','Начало','Окончание','Кабинет','Сотрудник','Для чего','Создано'],...bookingReport.map(row=>[isoToDisplayDate(row.booking_date)||row.booking_date,String(row.starts_at).slice(0,5),String(row.ends_at).slice(0,5),reportRoomLabel(row.room_id),row.created_by_name||'Сотрудник',row.purpose,formatTimestamp(row.created_at)])],csv='\ufeff'+rows.map(row=>row.map(cell).join(';')).join('\r\n'),blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=window.URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`quantum-bookings-${from}-${to}.csv`;document.body.appendChild(link);link.click();link.remove();window.URL.revokeObjectURL(url);
 }
function invalidateBookingReport(){bookingReportRequest++;bookingOpenRequest++;bookingReport=[];renderBookingReport();}
async function recordPresence(){if(!cloud||!session||Date.now()-presenceAt<PRESENCE_INTERVAL_MS)return;presenceAt=Date.now();await cloud.rpc('touch_map_presence');}
async function loadAdjustments(){
 if(!cloud){adjustments=[];return;}
 const {data,error}=await cloud.from('map_adjustments').select('floor,target_type,target_id,dx,dy,rotation,scale,scale_x,scale_y,skew_x,skew_y,geometry,published,updated_at');
 if(error){toast('Не удалось загрузить выравнивание карты.');return;}
 adjustments=data||[];draw();applyView();if(state.editor.open)updateEditorFields();
}
async function updateProviderAvailability(){
 if(!window.fetch||!cloud)return;try{const response=await window.fetch(`${D.supabase.url}/auth/v1/settings`,{headers:{apikey:D.supabase.publishableKey}}),settings=await response.json();googleAuthEnabled=Boolean(settings?.external?.google);$('google-auth').hidden=!googleAuthEnabled;document.querySelector('.auth-divider').hidden=!googleAuthEnabled;$('auth-dialog').querySelector('.modal-card>p').textContent=googleAuthEnabled?'Войдите через уже открытый корпоративный Google-аккаунт. Отдельного пароля для карты не будет.':'Введите корпоративную почту. Мы пришлём одну ссылку для входа — пароль не нужен.';}catch(_error){googleAuthEnabled=false;$('google-auth').hidden=true;document.querySelector('.auth-divider').hidden=true;}
}
const editorTargetNames={shell:'Корпус 2.5D',plan:'План 2D · коридоры и лестницы',rooms:'Все кабинеты 2.5D',room:'Один кабинет'};
function editorIdentity(){return state.editor.target==='room'?['room',state.selected]:[state.editor.target,state.floor];}
function editableAdjustment(){
 const [type,id]=editorIdentity();let row=adjustments.find(a=>a.floor===Number(state.floor)&&a.target_type===type&&a.target_id===id&&!a.published);
 if(!row){const base=adjustments.find(a=>a.floor===Number(state.floor)&&a.target_type===type&&a.target_id===id&&a.published)||defaultAdjustment(),legacyScale=Number(base.scale)||1;row={floor:Number(state.floor),target_type:type,target_id:id,dx:Number(base.dx)||0,dy:Number(base.dy)||0,rotation:Number(base.rotation)||0,scale:legacyScale,scale_x:Number(base.scale_x??legacyScale)||1,scale_y:Number(base.scale_y??legacyScale)||1,skew_x:Number(base.skew_x)||0,skew_y:Number(base.skew_y)||0,geometry:geometryClone(base.geometry),published:false};adjustments.push(row);}
 return row;
}
function ensureEditorGeometry(){const [type,id]=editorIdentity(),row=editableAdjustment();if(!validGeometry(row.geometry))row.geometry=baseGeometry(type,id);return row.geometry;}
function resetEditorHistory(){state.editor.selectedVertex=null;state.editor.history=[];state.editor.future=[];state.editor.addPoint=false;updateEditorPointControls();}
function geometrySnapshot(){return geometryClone(editableAdjustment().geometry);}
function rememberGeometry(){state.editor.history.push(geometrySnapshot());if(state.editor.history.length>60)state.editor.history.shift();state.editor.future=[];}
function restoreGeometry(value){editableAdjustment().geometry=geometryClone(value);state.editor.selectedVertex=null;draw();applyView();updateEditorPointControls();}
function undoGeometry(){if(!state.editor.history.length)return;state.editor.future.push(geometrySnapshot());restoreGeometry(state.editor.history.pop());}
function redoGeometry(){if(!state.editor.future.length)return;state.editor.history.push(geometrySnapshot());restoreGeometry(state.editor.future.pop());}
function updateEditorPointControls(){
 const supported=editorSupportsPoints(),active=supported&&state.editor.points;
 $('editor-points').disabled=!supported;$('editor-points').classList.toggle('active',active);$('editor-points').textContent=active?'Точки включены':'Править точки';
 $('editor-add-point').disabled=!active;$('editor-add-point').classList.toggle('active',active&&state.editor.addPoint);
 const geometry=active?geometryFor(...editorIdentity()):null,selected=state.editor.selectedVertex,ring=selected&&geometry?.rings[selected.ring];
 $('editor-delete-point').disabled=!active||!ring||ring.length<=3;$('editor-undo').disabled=!active||!state.editor.history.length;$('editor-redo').disabled=!active||!state.editor.future.length;
 $('editor-point-help').textContent=!supported?'Точки доступны для корпуса и одного кабинета.':!active?'Включите точки, чтобы менять отдельные углы.':state.editor.addPoint?'Нажмите на нужный отрезок, чтобы поставить новую точку.':'Тяните белые точки. Двойной клик по линии добавляет точку.';
}
function togglePointEditor(){if(!editorSupportsPoints())return;state.editor.points=!state.editor.points;resetEditorHistory();if(state.editor.points)ensureEditorGeometry();draw();applyView();updateEditorFields();}
function localEditorElement(){const [type,id]=editorIdentity();return type==='shell'?$('layer-shell'):$('map').querySelector(`[data-id="${id}"]`);}
function localPoint(clientX,clientY){
 const target=localEditorElement(),svg=$('map'),matrix=target?.getScreenCTM?.();
 if(matrix&&svg.createSVGPoint){const point=svg.createSVGPoint();point.x=clientX;point.y=clientY;const local=point.matrixTransform(matrix.inverse());return [local.x,local.y];}
 const rect=svg.getBoundingClientRect(),[x,y,w,h]=state.view;return [x+(clientX-rect.left)*w/rect.width,y+(clientY-rect.top)*h/rect.height];
}
function snapPoint(point){const snap=$('edit-snap').checked?2:0;return snap?point.map(value=>Math.round(value/snap)*snap):point.map(value=>Math.round(value*100)/100);}
function insertVertex(event,edge){if(!state.editor.open||!state.editor.points||!editorSupportsPoints())return;const geometry=ensureEditorGeometry(),ringIndex=Number(edge.dataset.ring),edgeIndex=Number(edge.dataset.edge),ring=geometry.rings[ringIndex];if(!ring)return;rememberGeometry();ring.splice(edgeIndex+1,0,snapPoint(localPoint(event.clientX,event.clientY)));state.editor.selectedVertex={ring:ringIndex,point:edgeIndex+1};state.editor.addPoint=false;draw();applyView();updateEditorPointControls();}
function deleteSelectedVertex(){const selected=state.editor.selectedVertex,geometry=ensureEditorGeometry(),ring=selected&&geometry?.rings[selected.ring];if(!ring||ring.length<=3)return;rememberGeometry();ring.splice(selected.point,1);state.editor.selectedVertex=null;draw();applyView();updateEditorPointControls();}
function updateEditorVisibility(){
 const allowed=superadmin&&window.innerWidth>=1024;$('editor-toggle').hidden=!allowed;
 if(!allowed&&state.editor.open){state.editor.open=false;$('editor-panel').hidden=true;$('map').classList.remove('editing');draw();applyView();}
}
function updateEditorTransform(){
 const [type,id]=editorIdentity(),row=editableAdjustment();
 if(type==='room'){const room=floorData().rooms.find(r=>r.room_id===id);if(room)$('map').querySelector(`[data-id="${id}"]`)?.setAttribute('transform',transformFor('room',id,labelPoint(room.p)));}
 else $(`layer-${type}`)?.setAttribute('transform',transformFor(type,state.floor));
 $('edit-x').value=String(Math.round(Number(row.dx)*100)/100);$('edit-y').value=String(Math.round(Number(row.dy)*100)/100);$('edit-rotation').value=String(Number(row.rotation)||0);$('edit-scale-x').value=String(Number(row.scale_x??row.scale)||1);$('edit-scale-y').value=String(Number(row.scale_y??row.scale)||1);$('edit-skew-x').value=String(Number(row.skew_x)||0);$('edit-skew-y').value=String(Number(row.skew_y)||0);
}
function updateEditorFields(){
 if(!state.editor.open)return;const room=floorData().rooms.find(r=>r.room_id===state.selected);
 if(state.editor.target==='room'&&!room)state.editor.target='shell';
 ['shell','plan','rooms','room'].forEach(type=>$(`edit-${type}`).classList.toggle('active',state.editor.target===type));
 $('editor-target-name').textContent=state.editor.target==='room'?`Кабинет ${room?.n||''}`:editorTargetNames[state.editor.target];updateEditorTransform();updateEditorPointControls();updateMap();
}
function setEditorValues(){const row=editableAdjustment();row.dx=Number($('edit-x').value)||0;row.dy=Number($('edit-y').value)||0;row.rotation=Math.max(-360,Math.min(360,Number($('edit-rotation').value)||0));row.scale=1;row.scale_x=Math.max(.5,Math.min(1.5,Number($('edit-scale-x').value)||1));row.scale_y=Math.max(.5,Math.min(1.5,Number($('edit-scale-y').value)||1));row.skew_x=Math.max(-45,Math.min(45,Number($('edit-skew-x').value)||0));row.skew_y=Math.max(-45,Math.min(45,Number($('edit-skew-y').value)||0));updateEditorTransform();}
function openEditor(){if(!superadmin||window.innerWidth<1024){toast('Редактор доступен только суперадмину на компьютере.');return;}state.editor.open=true;$('editor-panel').hidden=false;$('map').classList.add('editing');$('map-hint').textContent='Двигайте слой объект целиком или включите редактирование точек';draw();applyView();updateEditorFields();}
function closeEditor(){state.editor.open=false;state.editor.points=false;resetEditorHistory();$('editor-panel').hidden=true;$('map').classList.remove('editing');$('map-hint').textContent='Нажмите на кабинет, чтобы открыть расписание';draw();applyView();}
async function saveEditorDraft(silent=false){
 if(!superadmin||!cloud)return false;const row=editableAdjustment(),message=$('editor-message');message.className='form-message';if(!silent)message.textContent='Сохраняем…';
 const payload={floor:row.floor,target_type:row.target_type,target_id:row.target_id,dx:row.dx,dy:row.dy,rotation:row.rotation,scale:row.scale,scale_x:row.scale_x,scale_y:row.scale_y,skew_x:row.skew_x,skew_y:row.skew_y,geometry:validGeometry(row.geometry)?row.geometry:null,published:false,updated_by:session.user.id};
 const {error}=await cloud.from('map_adjustments').upsert(payload,{onConflict:'floor,target_type,target_id,published'});if(error){message.classList.add('error');message.textContent=`Не удалось сохранить: ${error.message}`;return false;}if(!silent){message.classList.add('success');message.textContent='Черновик сохранён. Его видите только вы.';}return true;
}
async function publishEditor(){if(!await saveEditorDraft(true))return;const message=$('editor-message');message.className='form-message';message.textContent='Публикуем…';const {error}=await cloud.rpc('publish_map_adjustments',{p_floor:Number(state.floor)});if(error){message.classList.add('error');message.textContent=`Не удалось опубликовать: ${error.message}`;return;}await loadAdjustments();message.classList.add('success');message.textContent='Изменения этажа опубликованы для всех.';}
async function initCloud(){
 if(!hasCloud()){updateAuthButton();return;}
 cloud=window.supabase.createClient(D.supabase.url,D.supabase.publishableKey,{auth:{persistSession:true,detectSessionInUrl:true}});
 await updateProviderAvailability();
  const {data,error}=await cloud.auth.getSession();if(error)toast('Не удалось проверить вход.');session=data?.session||null;updateAuthButton();await loadAccess();await recordPresence();await Promise.all([loadBookings(),loadAdjustments(),loadRemoteSchedule(),typeof evacLoad==='function'?evacLoad():null]);syncRealtime();
   cloud.auth.onAuthStateChange(handleAuthStateChange);
}
// Phones: the plan is wide and the screen is narrow, so the whole floor shrinks to unreadable labels.
// Open closer instead, with the selected room in the middle; the whole floor is one tap on the fit button.
// The view keeps the map's own aspect ratio, so nothing is letterboxed and panning maps 1:1 to the finger.
const PHONE_VIEW_WIDTH=700,VIEW_PAD=24;
const phoneMap=()=>window.matchMedia?.('(max-width: 780px)').matches??false;
let viewFrame=0,gestureFrame=0,gestureIdle=0,paintedView=null,gestureBox=null;
// While a gesture moves the map, its on-screen box is the one measured when the gesture started (the transform scales the element).
function mapBox(){if(gestureBox)return gestureBox;const box=$('map').getBoundingClientRect?.();return box&&box.width>0&&box.height>0?box:null;}
function pointsBounds(points){if(!points.length)return null;const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return {x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};}
function roomCenter(id){const room=floorData().rooms.find(r=>r.room_id===id),b=room&&pointsBounds(room.p);return b?[(b.x0+b.x1)/2,(b.y0+b.y1)/2]:null;}
function fitView(){
 const box=phoneMap()?mapBox():null,b=box&&pointsBounds(floorData().rooms.flatMap(r=>r.p));if(!b)return [0,0,1295,720];
 const unit=Math.max((b.x1-b.x0+VIEW_PAD*2)/box.width,(b.y1-b.y0+VIEW_PAD*2)/box.height),w=box.width*unit,h=box.height*unit;
 return [(b.x0+b.x1-w)/2,(b.y0+b.y1-h)/2,w,h];
}
function homeView(){
 const box=phoneMap()?mapBox():null,b=box&&pointsBounds(floorData().rooms.flatMap(r=>r.p));if(!b)return [0,0,1295,720];
 // Close enough to read room numbers, but never so close that the floor's height does not fit.
 const unit=Math.min(Math.max(PHONE_VIEW_WIDTH/box.width,(b.y1-b.y0+VIEW_PAD*2)/box.height),1295/box.width),w=box.width*unit,h=box.height*unit;
 const center=roomCenter(state.selected)||[(b.x0+b.x1)/2,0],lo=b.x0-VIEW_PAD+w/2,hi=b.x1+VIEW_PAD-w/2;
 const cx=lo>hi?(b.x0+b.x1)/2:Math.max(lo,Math.min(hi,center[0]));
 return [cx-w/2,(b.y0+b.y1-h)/2,w,h];
}
// Keep the zoom, slide the plan so that the room is not hidden behind an edge.
// Only the axis where the room is out of view moves, and the plan never slides past its own edge.
function revealRoom(id){
 if(!phoneMap())return;const c=roomCenter(id),b=pointsBounds(floorData().rooms.flatMap(r=>r.p));if(!c||!b)return;
 const axis=(at,start,size,lo,hi)=>{if(at>=start+size*.15&&at<=start+size*.85)return start;const min=lo-VIEW_PAD,max=hi+VIEW_PAD-size;return min>max?(lo+hi-size)/2:Math.max(min,Math.min(max,at-size/2));};
 const [x,y,w,h]=state.view,nx=axis(c[0],x,w,b.x0,b.x1),ny=axis(c[1],y,h,b.y0,b.y1);if(nx===x&&ny===y)return;
 state.view=[nx,ny,w,h];applyView();
}
// Crossing the phone breakpoint (a resized window, a rotated tablet) starts again from the home view.
let phoneLayout=phoneMap();
window.addEventListener('resize',()=>{if(phoneMap()===phoneLayout)return;phoneLayout=phoneMap();state.view=homeView();applyView();});
function applyView(){
 if(viewFrame){cancelAnimationFrame(viewFrame);viewFrame=0;}if(gestureFrame){cancelAnimationFrame(gestureFrame);gestureFrame=0;}clearTimeout(gestureIdle);gestureIdle=0;
 if(paintedView){paintedView=null;gestureBox=null;$('map').style.transform='';$('canvas').classList.remove('gesturing');}
 $('map').setAttribute('viewBox',state.view.join(' '));positionCallout();
}
// Buttons and keys: the SVG is re-laid out and repainted once per frame.
function scheduleView(){if(typeof requestAnimationFrame!=='function'){applyView();return;}if(!viewFrame)viewFrame=requestAnimationFrame(()=>{viewFrame=0;applyView();});}
// Pan, pinch and wheel: during the gesture the plan painted at the last viewBox is moved and scaled with a CSS
// transform, which the compositor does without laying out or repainting the SVG. endGesture() sets the real viewBox once.
function gestureView(){
 if(typeof requestAnimationFrame!=='function'){applyView();return;}
 if(!paintedView){const box=mapBox();if(!box){scheduleView();return;}gestureBox=box;paintedView=($('map').getAttribute('viewBox')||state.view.join(' ')).split(/[\s,]+/).map(Number);$('canvas').classList.add('gesturing');}
 if(!gestureFrame)gestureFrame=requestAnimationFrame(()=>{gestureFrame=0;paintGesture();});
}
// Where a viewBox puts the plan inside the map box (preserveAspectRatio xMidYMid meet): screen = s * point + offset.
function viewPlacement([x,y,w,h],box){const s=Math.min(box.width/w,box.height/h);return {s,ox:(box.width-s*w)/2-s*x,oy:(box.height-s*h)/2-s*y};}
function paintGesture(){
 if(!paintedView)return;const from=viewPlacement(paintedView,gestureBox),to=viewPlacement(state.view,gestureBox),k=to.s/from.s;
 $('map').style.transform=`translate(${to.ox-k*from.ox}px,${to.oy-k*from.oy}px) scale(${k})`;positionCallout();
}
function endGesture(){if(paintedView)applyView();}
function zoom(factor,clientX=null,clientY=null,gesture=false){const [x,y,w,h]=state.view,next=Math.max(450,Math.min(1600,w*factor)),ratio=next/w,rect=mapBox()||$('map').getBoundingClientRect(),fx=clientX===null?.5:Math.max(0,Math.min(1,(clientX-rect.left)/rect.width)),fy=clientY===null?.5:Math.max(0,Math.min(1,(clientY-rect.top)/rect.height));state.view=[x+(w-next)*fx,y+(h-h*ratio)*fy,next,h*ratio];if(gesture)gestureView();else scheduleView();}
// Phones: the room card is a bottom sheet, the handle opens the whole day.
const toggleRoomSheet=()=>{const panel=$('sheet-handle').closest('.panel'),open=!panel.classList.contains('expanded');panel.classList.toggle('expanded',open);$('sheet-handle').setAttribute('aria-expanded',String(open));};
$('sheet-handle').onclick=toggleRoomSheet;
// Phones keep the date controls and the search folded until asked for.
$('when-toggle').onclick=()=>{const open=$('when-toggle').getAttribute('aria-expanded')!=='true';$('when-toggle').setAttribute('aria-expanded',String(open));$('when-toggle').closest('.side').classList.toggle('when-open',open);};
$('search-toggle').onclick=()=>{const open=!document.body.classList.contains('search-open');document.body.classList.toggle('search-open',open);$('search-toggle').setAttribute('aria-expanded',String(open));if(open)$('search').focus();};
$('panel-close').onclick=closeRoomPanel;window.addEventListener('resize',positionCallout);
$('scrub-track').addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();scrubbing=true;$('scrub-track').setPointerCapture?.(e.pointerId);scrubTo(e);});$('scrub-track').addEventListener('pointermove',e=>{if(scrubbing)scrubTo(e);});['pointerup','pointercancel'].forEach(type=>$('scrub-track').addEventListener(type,()=>{scrubbing=false;}));
$('room-card').addEventListener('click',e=>{if(window.matchMedia?.('(max-width: 780px)').matches&&e.target.closest('.room-heading'))toggleRoomSheet();});
$('zoom-in').onclick=()=>zoom(.82);$('zoom-out').onclick=()=>zoom(1.22);$('fit').onclick=()=>{state.view=fitView();applyView();};
 bindDateField('date',(_event,iso)=>{if(iso&&iso!==state.date){bookingOpenRequest++;state.date=iso;updateDate(true);}});
 bindDateField('booking-date');['booking-date','booking-date-display','booking-room'].forEach(id=>$(id).addEventListener('change',()=>renderPeriodGrid('booking')));$('booking-date-display').addEventListener('input',()=>renderPeriodGrid('booking'));
 bindDateField('calendar-preview-from',()=>invalidateCalendarPreview());bindDateField('calendar-preview-through',()=>invalidateCalendarPreview());
 bindDateField('availability-date',()=>invalidateAvailability());
 bindDateField('booking-report-from',()=>invalidateBookingReport());
 bindDateField('booking-report-to',()=>invalidateBookingReport());
$('prev-day').onclick=()=>shiftDate(-1);$('next-day').onclick=()=>shiftDate(1);
$('time').oninput=e=>{state.minute=Number(e.target.value);updateMap();renderCard();};
function commitTimeInput(){const input=$('time-input'),match=input.value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);if(!match){input.value=fmt(state.minute);toast('Введите время от 00:00 до 23:59.');return false;}state.minute=Number(match[1])*60+Number(match[2]);updateMap();renderCard();return true;}
$('time-input').oninput=e=>{if(/^([01]?\d|2[0-3]):[0-5]\d$/.test(e.target.value.trim()))commitTimeInput();};$('time-input').onchange=commitTimeInput;$('time-input').onblur=()=>{if($('time-input').value!==fmt(state.minute))commitTimeInput();};$('time-input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commitTimeInput();$('time-input').blur();}};$('now').onclick=()=>{const c=clock();state.date=dateFrom(c);state.minute=Number(c.hour)*60+Number(c.minute);updateDate(true);};
$('search').oninput=e=>{const q=e.target.value.trim().toLocaleLowerCase();if(!q){$('search-results').hidden=true;return;}const matches=allRooms.filter(r=>(r.n+' '+(aliases[r.n]||'')+' '+(r.schedule_labels||[]).join(' ')).toLocaleLowerCase().includes(q));$('search-results').innerHTML=matches.length?matches.map(r=>`<button data-room="${esc(r.room_id)}">${esc(r.n)} ${aliases[r.n]?'· '+esc(aliases[r.n]):''}<small>${roomFloors(r.room_id).join(' / ')} этаж</small></button>`).join(''):'<p>Кабинет не найден</p>';$('search-results').hidden=false;$('search-results').querySelectorAll('button').forEach(b=>b.onclick=()=>{select(b.dataset.room);$('map').querySelector(`[data-id="${b.dataset.room}"]`).focus();});};
$('search').onkeydown=e=>{if(e.key==='Escape'){$('search-results').hidden=true;}if(e.key==='Enter')$('search-results').querySelector('button')?.click();};
document.addEventListener('click',e=>{if(!e.target.closest('.search,.search-results'))$('search-results').hidden=true;});
$('auth-button').onclick=async()=>{if(session){if(window.confirm?.('Выйти из аккаунта?'))await cloud.auth.signOut();}else if(googleAuthEnabled)await signInGoogle();else openAuth();};
$('google-auth').onclick=signInGoogle;
$('auth-form').onsubmit=async e=>{e.preventDefault();const email=$('auth-email').value.trim().toLowerCase(),message=$('auth-message');message.className='form-message';if(!email.endsWith('@demo-school.edu')){message.classList.add('error');message.textContent='Используйте почту @demo-school.edu.';return;}message.textContent='Отправляем…';const options={shouldCreateUser:true};if(window.location?.protocol==='https:'||window.location?.protocol==='http:')options.emailRedirectTo=window.location.origin+window.location.pathname;const {error}=await cloud.auth.signInWithOtp({email,options});if(error){message.classList.add('error');message.textContent=`Не получилось отправить ссылку: ${error.message}`;return;}message.classList.add('success');message.textContent='Готово. Откройте письмо и нажмите ссылку — карта войдёт автоматически.';};
$('staff-toggle').onclick=openStaffPanel;
$('schedule-toggle').onclick=openScheduleImport;$('schedule-file').onchange=e=>inspectScheduleFile(e.target.files?.[0]);$('schedule-clear').onclick=clearScheduleImport;$('schedule-publish').onclick=publishScheduleImport;
$('staff-search').oninput=renderStaffPanel;
 $('staff-add-form').onsubmit=async e=>{e.preventDefault();if(!superadmin||!cloud)return;const email=$('staff-add-email').value.trim().toLowerCase(),limitValue=$('staff-add-limit').value.trim(),role=$('staff-add-role').value,message=$('staff-message'),button=e.submitter||e.currentTarget.querySelector('button[type="submit"]'),effectiveLimit=role==='admin'?null:(limitValue?Number(limitValue):3);message.className='form-message';if(!/^[^@\s]+@demo-school[.]edu$/.test(email)){message.classList.add('error');message.textContent='Введите корпоративную почту @demo-school.edu.';return;}if(effectiveLimit!==null&&(effectiveLimit<1||effectiveLimit>100)){message.classList.add('error');message.textContent='Лимит должен быть от 1 до 100 или пустым.';return;}button.disabled=true;message.textContent='Добавляем…';const payload={email,display_name:$('staff-add-name').value.trim()||null,role,approved:true,weekly_booking_limit:effectiveLimit},{error}=await cloud.from('map_staff_allowlist').upsert(payload,{onConflict:'email'});button.disabled=false;if(error){message.classList.add('error');message.textContent=`Не удалось добавить: ${error.message}`;return;}$('staff-add-form').reset();await loadStaffPanel();message.className='form-message success';message.textContent=`${email} добавлен. Доступ сработает при первом входе.`;};
  $('booking-report-refresh').onclick=loadBookingReport;$('booking-report-export').onclick=exportBookingReport;$('booking-audit-toggle').onclick=openBookingAudit;$('booking-audit-refresh').onclick=()=>loadBookingAudit(false);$('settings-toggle').onclick=openSettings;$('calendar-toggle').onclick=()=>{hideModal($('settings-dialog'));return openCalendar();};$('calendar-start').onclick=startCalendarConnection;$('calendar-check').onclick=loadCalendarStatus;$('calendar-confirm').onclick=confirmCalendarConnection;$('calendar-disconnect').onclick=disconnectCalendar;if($('calendar-preview-run'))$('calendar-preview-run').onclick=loadCalendarPreview;
$('availability-toggle').onclick=openAvailability;$('availability-search').onclick=searchAvailability;
$('availability-band').onchange=()=>{fillAvailabilityPeriods(Number($('availability-start').value),Number($('availability-end').value));invalidateAvailability();};
$('availability-start').onchange=()=>{fillAvailabilityPeriods(Number($('availability-start').value),Math.max(Number($('availability-start').value),Number($('availability-end').value)));invalidateAvailability();};
['availability-floor','availability-date'].forEach(id=>$(id).onchange=invalidateAvailability);
$('availability-end').onchange=()=>{fillAvailabilityPeriods(Number($('availability-start').value),Number($('availability-end').value));invalidateAvailability();};
['availability-start-time','availability-end-time'].forEach(id=>{$(id).oninput=invalidateAvailability;$(id).onchange=()=>{syncExactTimeSelection('availability');invalidateAvailability();};});
$('booking-band').onchange=()=>fillBookingPeriods(Number($('booking-start').value),Number($('booking-end').value));
$('booking-start').onchange=()=>fillBookingPeriods(Number($('booking-start').value),Math.max(Number($('booking-start').value),Number($('booking-end').value)));
$('booking-end').onchange=()=>fillBookingPeriods(Number($('booking-start').value),Number($('booking-end').value));
['booking-start-time','booking-end-time'].forEach(id=>$(id).onchange=()=>syncExactTimeSelection('booking'));
 $('booking-form').onsubmit=e=>{e.preventDefault();return submitBookingCommand();};
 $('booking-delete').onclick=()=>submitBookingCommand(true);
 $('booking-room').onchange=()=>{bookingContextRequest++;bookingEditContext=null;const roomId=$('booking-room').value,room=allRooms.find(room=>room.room_id===roomId);$('booking-title').textContent=`Кабинет ${room?.n||''}`;updateBookingRoomAccess();if(bookingAllowedRoom(roomId)&&(bookingOriginal?.room_id===HALL_ROOM||roomId===HALL_ROOM))void refreshBookingContext();};
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.dataset.close==='booking-board-dialog'?closeBookingBoard():button.dataset.close==='booking-dialog'?closeBookingDialog():button.dataset.close==='booking-audit-dialog'?closeBookingAudit():button.dataset.close==='calendar-dialog'?closeCalendar():hideModal($(button.dataset.close)));
  document.querySelectorAll('dialog').forEach(dialog=>{dialog.addEventListener('click',e=>{if(e.target===dialog){if(dialog.id==='booking-dialog'||dialog.id==='hall-event-dialog')return;if(dialog.id==='hall-calendar-dialog')closeSyncCalendar();else if(dialog.id==='booking-board-dialog')closeBookingBoard();else if(dialog.id==='booking-audit-dialog')closeBookingAudit();else if(dialog.id==='calendar-dialog')closeCalendar();else hideModal(dialog);}});dialog.addEventListener('cancel',event=>{if(dialog.id==='booking-dialog')handleBookingDialogCancel(event);else if(dialog.id==='booking-board-dialog'&&!bookingBoardInternalClose)bookingOpenRequest++;else if(dialog.id==='booking-audit-dialog')closeBookingAudit();else if(dialog.id==='calendar-dialog')closeCalendar();});});
window.addEventListener('focus',()=>{if(cloud){loadBookings();recordPresence();}});
const pointers=new Map();
['pointermove','wheel'].forEach(type=>$('canvas').addEventListener(type,watchFrames,{passive:true}));$('scrub-track').addEventListener('pointermove',watchFrames,{passive:true});$('time').addEventListener('input',watchFrames);
$('map').addEventListener('pointerdown',e=>{
 if(e.button!==0)return;pointers.set(e.pointerId,[e.clientX,e.clientY]);state.suppressClick=false;
 if(pointers.size===2){const p=[...pointers.values()];state.pinch={distance:Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]),view:[...state.view]};state.drag=null;return;}
 if(state.editor.open&&state.editor.points){
  const handle=e.target.closest?.('.vertex-handle');
  if(handle){state.editor.selectedVertex={ring:Number(handle.dataset.ring),point:Number(handle.dataset.point)};rememberGeometry();state.drag={kind:'vertex',id:e.pointerId};state.suppressClick=true;$('map').classList.add('dragging');updateEditorPointControls();return;}
  if(state.editor.target==='room'){const room=e.target.closest?.('.room');if(room&&room.dataset.id!==state.selected){state.selected=room.dataset.id;resetEditorHistory();ensureEditorGeometry();draw();applyView();updateEditorFields();}}
  state.drag=null;return;
 }
 if(state.editor.open){if(state.editor.target==='room'){const room=e.target.closest?.('.room');if(room&&room.dataset.id!==state.selected)select(room.dataset.id);}const row=editableAdjustment();state.drag={kind:'editor',x:e.clientX,y:e.clientY,dx:Number(row.dx)||0,dy:Number(row.dy)||0,id:e.pointerId};}
 else state.drag={kind:'pan',x:e.clientX,y:e.clientY,view:[...state.view],id:e.pointerId};
});
$('map').addEventListener('pointermove',e=>{
 if(pointers.has(e.pointerId))pointers.set(e.pointerId,[e.clientX,e.clientY]);
 if(state.pinch&&pointers.size===2){const p=[...pointers.values()],distance=Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]),factor=state.pinch.distance/distance,[x,y,w,h]=state.pinch.view,next=Math.max(450,Math.min(1600,w*factor)),ratio=next/w;state.view=[x+(w-next)/2,y+(h-h*ratio)/2,next,h*ratio];gestureView();return;}
 if(!state.drag)return;
 if(state.drag.kind==='vertex'){const selected=state.editor.selectedVertex,geometry=ensureEditorGeometry(),ring=selected&&geometry?.rings[selected.ring];if(ring){ring[selected.point]=snapPoint(localPoint(e.clientX,e.clientY));state.suppressClick=true;$('tooltip').hidden=true;draw();applyView();}return;}
 const dx=e.clientX-state.drag.x,dy=e.clientY-state.drag.y;if(Math.hypot(dx,dy)>4){state.suppressClick=true;$('map').classList.add('dragging');$('map').setPointerCapture?.(e.pointerId);$('tooltip').hidden=true;const rect=mapBox()||$('map').getBoundingClientRect(),scale=Math.max(state.view[2]/rect.width,state.view[3]/rect.height);if(state.drag.kind==='editor'){const row=editableAdjustment(),snap=$('edit-snap').checked?2:0;row.dx=state.drag.dx+dx*scale;row.dy=state.drag.dy+dy*scale;if(snap){row.dx=Math.round(row.dx/snap)*snap;row.dy=Math.round(row.dy/snap)*snap;}updateEditorTransform();}else{state.view=[state.drag.view[0]-dx*scale,state.drag.view[1]-dy*scale,state.drag.view[2],state.drag.view[3]];gestureView();}}
});
$('map').addEventListener('click',e=>{const edge=e.target.closest?.('.vertex-edge');if(edge&&state.editor.points&&state.editor.addPoint){e.preventDefault();e.stopPropagation();insertVertex(e,edge);}});
$('map').addEventListener('dblclick',e=>{const edge=e.target.closest?.('.vertex-edge');if(edge&&state.editor.points){e.preventDefault();e.stopPropagation();insertVertex(e,edge);}});
// A wheel or trackpad has no end event: the gesture ends after 160 ms without wheel events.
$('map').addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey||Math.abs(e.deltaY)>Math.abs(e.deltaX)*1.2)zoom(Math.exp(e.deltaY*.0015),e.clientX,e.clientY,true);else{const factor=state.view[2]/(mapBox()||$('map').getBoundingClientRect()).width;state.view[0]+=e.deltaX*factor;state.view[1]+=e.deltaY*factor;gestureView();}clearTimeout(gestureIdle);gestureIdle=setTimeout(endGesture,160);},{passive:false});
$('map').addEventListener('keydown',e=>{const step=e.shiftKey?60:20;if(['+','='].includes(e.key)){e.preventDefault();zoom(.82);}else if(e.key==='-'){e.preventDefault();zoom(1.22);}else if(e.key==='0'){e.preventDefault();state.view=fitView();applyView();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')state.view[0]-=step;if(e.key==='ArrowRight')state.view[0]+=step;if(e.key==='ArrowUp')state.view[1]-=step;if(e.key==='ArrowDown')state.view[1]+=step;applyView();}});
function endDrag(e){if(e?.pointerId!==undefined)pointers.delete(e.pointerId);if(pointers.size<2)state.pinch=null;state.drag=null;$('map').classList.remove('dragging');endGesture();setTimeout(()=>{state.suppressClick=false;},0);}window.addEventListener('pointerup',endDrag);window.addEventListener('pointercancel',endDrag);
$('editor-toggle').onclick=openEditor;$('editor-close').onclick=closeEditor;['shell','plan','rooms','room'].forEach(type=>$(`edit-${type}`).onclick=()=>{state.editor.target=type;state.editor.points=false;resetEditorHistory();draw();applyView();updateEditorFields();});['edit-x','edit-y','edit-rotation','edit-scale-x','edit-scale-y','edit-skew-x','edit-skew-y'].forEach(id=>$(id).oninput=setEditorValues);$('editor-points').onclick=togglePointEditor;$('editor-add-point').onclick=()=>{if(!state.editor.points)return;state.editor.addPoint=!state.editor.addPoint;updateEditorPointControls();};$('editor-delete-point').onclick=deleteSelectedVertex;$('editor-undo').onclick=undoGeometry;$('editor-redo').onclick=redoGeometry;$('editor-reset').onclick=()=>{const row=editableAdjustment();if(state.editor.points)rememberGeometry();Object.assign(row,defaultAdjustment());if(state.editor.points)row.geometry=baseGeometry(...editorIdentity());draw();applyView();updateEditorFields();$('editor-message').textContent='Сброшено в черновике. Опубликуйте, чтобы это увидели все.';};$('editor-save').onclick=()=>saveEditorDraft();$('editor-publish').onclick=publishEditor;window.addEventListener('resize',updateEditorVisibility);
document.addEventListener('keydown',e=>{if(!state.editor.open||!state.editor.points||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redoGeometry():undoGeometry();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redoGeometry();}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelectedVertex();}});
const installButton=$('install-button'),installUa=window.navigator?.userAgent||'',iosInstall=/iPad|iPhone|iPod/.test(installUa)||(/Macintosh/.test(installUa)&&Number(window.navigator?.maxTouchPoints)>1),androidInstall=/Android/i.test(installUa),standaloneInstall=Boolean(window.navigator?.standalone||window.matchMedia?.('(display-mode: standalone)').matches),mobileInstall=iosInstall||androidInstall;
function updateInstallCopy(){if(iosInstall)$('install-copy').innerHTML='<p>Откройте карту именно в <strong>Safari</strong>, нажмите кнопку «Поделиться» и выберите <strong>«На экран Домой»</strong>.</p><p>Если пункт не виден, прокрутите список действий вниз. Режим «Версия для ПК» включать не нужно.</p>';else if(androidInstall)$('install-copy').innerHTML='<p>Откройте меню браузера <strong>⋮</strong> и выберите <strong>«Установить приложение»</strong> или <strong>«Добавить на главный экран»</strong>.</p><p>В Chrome системное окно обычно появляется сразу после нажатия кнопки «Установить».</p>';}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;if(mobileInstall&&!standaloneInstall)installButton.hidden=false;});installButton.onclick=async()=>{if(deferredInstall){const prompt=deferredInstall;deferredInstall=null;await prompt.prompt();const choice=await prompt.userChoice;if(choice?.outcome==='accepted')installButton.hidden=true;else installButton.hidden=false;}else{updateInstallCopy();showModal($('install-dialog'));}};window.addEventListener('appinstalled',()=>{installButton.hidden=true;toast('Quantum Map установлена.');});
if(mobileInstall&&!standaloneInstall)installButton.hidden=false;

setupSyncUi();draw();state.view=homeView();applyView();updateDate();initCloud();

// Shares the existing map session. No pupil names, IDs or memberships reach this module.
var assessmentUI;
function assessmentAuthChanged(){if(assessmentUI)assessmentUI.authChanged();}
(() => {
  const el=id=>document.getElementById(id);
  const core=['Physics','Biology','Chemistry','Economics','Business','Computer Science'];
  const math=['Mathematics','Further Mathematics'];
  const common=['Английский язык','Казахский язык','Русский язык','История Казахстана','Всемирная история','География','Информатика'];
  const today=()=>dateFrom(clock());
  const addDays=(iso,n)=>{const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const monday=iso=>addDays(iso,-((new Date(`${iso}T12:00:00Z`).getUTCDay()+6)%7));
  const dateLabel=iso=>isoToDisplayDate(iso);
  // Mirrors the server: once a work has started its author can no longer cancel it.
  const upcoming=b=>{const c=clock();return `${b.assessment_date}T${b.starts_at.slice(0,5)}`>`${dateFrom(c)}T${c.hour}:${c.minute}`;};
  const initial=today()<'2026-09-01'?'2026-09-01':today()>'2027-08-31'?'2027-08-31':today();
  const s={week:monday(initial),catalog:D.assessments?.cohorts||[],rows:[],ready:false,loaded:false,
    coordinator:false,summary:null,summaryRequest:0,visible:false,load:0,check:0,authKey:'',busy:false,available:false,timer:null,request:null,cancel:null};
  const printState={request:0,busy:false,html:'',fingerprint:''};
  const allowed=()=>Boolean(cloud&&session?.user?.id&&profile?.approved);
  const userKey=()=>`${session?.user?.id||''}:${profile?.approved?'yes':'no'}:${typeof superadmin!=='undefined'&&superadmin?'super':''}`;
  const byId=id=>s.catalog.find(c=>c.id===id);
  const opt=(value,label)=>`<option value="${esc(value)}">${esc(label)}</option>`;
  const errors={ASSESSMENT_FORBIDDEN:'Войдите с разрешённой учётной записью сотрудника.',
    ASSESSMENT_TEACHER_UNKNOWN:'Преподаватель больше не доступен для назначения. Обновите расписание.',
    ASSESSMENT_SOCH_RESTRICTED:'СОЧ в 5–11-х классах назначают только координатор и суперадмин.',
    ASSESSMENT_INVALID:'Проверьте дату и время. Бронировать можно будущее время в текущем учебном году.',
    ASSESSMENT_COHORT_UNKNOWN:'Класс или группа изменились. Обновите расписание.',
    ASSESSMENT_ROSTER_MISSING:'Состав этой группы ещё не загружен.',
    ASSESSMENT_SUBJECT:'Предмет не соответствует выбранной группе.',
    ASSESSMENT_GROUP_REQUIRED:'Для этого предмета выберите учебную группу.',
    ASSESSMENT_MATH_CLASS:'В 11B и 11G — Further Mathematics, в остальных 11-х — Mathematics.',
    ASSESSMENT_DAILY_LIMIT:'У одного или нескольких учеников уже 3 СОРа в этот день. Выберите другую дату.',
    ASSESSMENT_OVERLAP:'В это время уже есть работа у участников группы или у вас. Выберите другое время.',
    ASSESSMENT_REQUEST_REUSED:'Эта бронь уже изменена. Обновите расписание.',
    ASSESSMENT_NOT_FOUND:'Бронь больше не найдена.',
    ASSESSMENT_PAST:'Работа уже началась или прошла. Отменить её может только администратор.'};
  function errorText(e){return Object.entries(errors).find(([code])=>String(e?.message||e).includes(code))?.[1]||'Не удалось связаться с расписанием. Повторите попытку.';}
  async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('TIMEOUT')),15000);})]);}finally{clearTimeout(timer);}}
  async function rpc(name,args){const r=await bounded(cloud.rpc(name,args));if(r.error)throw r.error;return r.data;}
  function setMessage(id,text,kind=''){el(id).textContent=text;el(id).className=id==='assessment-check'?`assessment-check ${kind}`:`form-message ${kind}`;}
  function updateAccess(){
    el('assessment-print-open').disabled=!s.ready;
    el('assessment-teacher-label').hidden=!s.coordinator;el('assessment-overview-open').hidden=!s.coordinator;el('assessment-overview-open').disabled=!s.ready;
    const soch=el('assessment-form').querySelector('input[value="SOCH"]'),restricted=Number(el('assessment-grade').value)>=5&&!s.coordinator;
    soch.disabled=restricted;el('assessment-soch-note').hidden=!restricted;
    if(restricted&&soch.checked){soch.checked=false;el('assessment-form').querySelector('input[value="SOR"]').checked=true;s.available=false;}
    el('assessment-period-end').disabled=el('assessment-period').value==='custom';
    el('assessment-grade').disabled=s.busy;
    el('assessment-fields').disabled=!allowed()||!s.ready||s.busy;
    el('assessment-submit').disabled=!allowed()||!s.ready||s.busy||!s.available;
    el('assessment-login').hidden=Boolean(session);el('assessment-form').hidden=!session;
    el('assessment-access').textContent=!session?'Просмотр открыт всем. Для бронирования войдите.':
      !profile?.approved?'Вашей учётной записи нужен доступ сотрудника.':!s.ready?'Бронирование станет доступно после загрузки расписания.':s.coordinator?'Вы планируете работы от имени школы.':'Вы бронируете свои работы.';
  }
  function selectedSubject(){return el('assessment-subject').value==='other'?el('assessment-other').value.trim():el('assessment-subject').value;}
  function fillCohorts(){
    const grade=Number(el('assessment-grade').value),subject=el('assessment-subject').value;
    const grouped=grade>=10&&core.includes(subject)||grade===10&&math.includes(subject);
    let cohorts=s.catalog.filter(c=>c.grade===grade&&(grouped?c.subject===subject:!!c.class_name));
    if(grade===11&&math.includes(subject))cohorts=cohorts.filter(c=>(['11B','11G'].includes(c.class_name)?'Further Mathematics':'Mathematics')===subject);
    const old=el('assessment-cohort').value;
    el('assessment-cohort').innerHTML=cohorts.map(c=>opt(c.id,c.label)).join('');
    if(cohorts.some(c=>c.id===old))el('assessment-cohort').value=old;
    el('assessment-other-label').hidden=subject!=='other';
    el('assessment-other').required=subject==='other';
    el('assessment-audience-note').textContent=grouped?'Смешанная группа. Учитываются СОРы её участников по всем предметам.':grade===11&&math.includes(subject)?'Математика проводится целым классом.':'Работа учитывается у всех учеников класса.';
    invalidate();
  }
  function fillGrade(){
    const grade=Number(el('assessment-grade').value);
    el('assessment-filter').innerHTML=opt('','Все классы и группы')+s.catalog.filter(c=>c.grade===grade).map(c=>opt(c.id,c.label)).join('');
    const old=el('assessment-subject').value;
    const subjects=grade>=10?[...core,...math,...common]:['Математика','Физика','Биология','Химия',...common];
    el('assessment-subject').innerHTML=subjects.map(x=>opt(x,x)).join('')+opt('other','Другой предмет');
    if(subjects.includes(old)||old==='other')el('assessment-subject').value=old;
    const bells=D.bells[grade<=5?'primary':'secondary'];
    el('assessment-period').innerHTML=bells.slice(1,9).map(([a,b],i)=>opt(String(i+1),`${i+1} урок · ${a}–${b}`)).join('')+opt('custom','Указать время');
    el('assessment-period-end').innerHTML=bells.slice(1,9).map(([a,b],i)=>opt(String(i+1),`${i+1} урок · ${a}–${b}`)).join('');
    fillTime();fillCohorts();renderWeek();loadSummary();
  }
  function fillTime(keepEnd=false){
    const p=el('assessment-period').value;if(p==='custom'){invalidate();return;}
    const bells=D.bells[Number(el('assessment-grade').value)<=5?'primary':'secondary'];
    if(!keepEnd||Number(el('assessment-period-end').value)<Number(p))el('assessment-period-end').value=p;
    el('assessment-start').value=bells[Number(p)][0];el('assessment-end').value=bells[Number(el('assessment-period-end').value)][1];invalidate();
  }
  function payload(){return {p_cohort:el('assessment-cohort').value,p_subject:selectedSubject(),
    p_type:el('assessment-form').querySelector('input[name="assessment-type"]:checked')?.value||'SOR',
    p_teacher:s.coordinator?(el('assessment-teacher').value||null):null,p_date:dateFieldValue('assessment-date')||'',p_start:normalizedTime(el('assessment-start').value)||'',p_end:normalizedTime(el('assessment-end').value)||''};}
  function valid(p){return p.p_cohort&&p.p_subject&&/^\d{4}-\d{2}-\d{2}$/.test(p.p_date)&&p.p_date>=today()&&p.p_date>='2026-09-01'&&p.p_date<='2027-08-31'&&/^\d{2}:\d{2}$/.test(p.p_start)&&/^\d{2}:\d{2}$/.test(p.p_end)&&p.p_start<p.p_end;}
  function invalidate(){
    s.check++;s.available=false;clearTimeout(s.timer);updateAccess();
    if(!allowed()||!s.ready){setMessage('assessment-check','Для проверки времени войдите и дождитесь загрузки расписания.');return;}
    if(payload().p_type==='SOCH'&&Number(el('assessment-grade').value)>=5&&!s.coordinator){setMessage('assessment-check',errors.ASSESSMENT_SOCH_RESTRICTED,'blocked');return;}
    if(!valid(payload())){setMessage('assessment-check','Укажите предмет, дату и время. Начало должно быть раньше окончания.');return;}
    setMessage('assessment-check','Проверяем нагрузку и пересечения…');s.timer=setTimeout(check,250);
  }
  async function check(){
    const ticket=++s.check,key=userKey(),p=payload(),fingerprint=JSON.stringify(p);s.available=false;updateAccess();
    try{
      const r=await rpc('assessment_check',p);
      if(ticket!==s.check||key!==userKey()||fingerprint!==JSON.stringify(payload()))return;
      if(!Number.isFinite(r?.max_sor)||!Array.isArray(r?.conflicts)||typeof r?.limit_reached!=='boolean')throw new Error('BAD_RESPONSE');
      if(r.limit_reached)setMessage('assessment-check',errors.ASSESSMENT_DAILY_LIMIT,'blocked');
      else if(r.conflicts.length)setMessage('assessment-check',r.conflicts.map(b=>`${b.pupil_conflict?'Заняты ученики':''}${b.pupil_conflict&&b.teacher_conflict?' и ':''}${b.teacher_conflict?`занят преподаватель ${b.instructor_name||''}`:''}: ${b.subject} · ${b.label} · ${b.starts_at.slice(0,5)}–${b.ends_at.slice(0,5)}`).join('; '),'blocked');
      else{ s.available=true;setMessage('assessment-check',p.p_type==='SOR'?`Время свободно. Максимальная нагрузка участников после бронирования: ${r.max_sor+1} из 3 СОРов.`:`Время свободно. Максимум у участников сейчас: ${r.max_sor} СОРов. СОЧ не увеличит этот счётчик.`,'available');if(s.coordinator&&!p.p_teacher)el('assessment-check').textContent+=' Преподаватель не назначен: его занятость не проверена.'; }
    }catch(e){if(ticket===s.check&&key===userKey())setMessage('assessment-check',errorText(e),'blocked');}
    finally{if(ticket===s.check)updateAccess();}
  }
  function renderWeek(){
    const weekEnd=addDays(s.week,6);el('assessment-week-label').textContent=s.week.slice(0,7)===weekEnd.slice(0,7)?`${s.week.slice(8,10)}–${dateLabel(weekEnd)}`:`${dateLabel(s.week)} — ${dateLabel(weekEnd)}`;
    const grade=Number(el('assessment-grade').value),filter=byId(el('assessment-filter').value),mine=el('assessment-mine').checked;
    const rows=s.rows.filter(b=>byId(b.cohort_id)?.grade===grade&&(!filter||(filter.related_ids||[filter.id]).includes(b.cohort_id))&&(!mine||b.created_by===session?.user?.id||b.instructor_id===session?.user?.id));
    // Weekdays always show; an empty weekend collapses into one line under the week.
    const dayItems=i=>rows.filter(b=>b.assessment_date===addDays(s.week,i)),quietWeekend=!dayItems(5).length&&!dayItems(6).length;
    el('assessment-week').innerHTML=Array.from({length:quietWeekend?5:7},(_,i)=>{
      const date=addDays(s.week,i),items=dayItems(i);
      return `<section class="assessment-day ${i>4?'weekend':''} ${date===today()?'is-today':''}" aria-label="${esc(dateLabel(date))}"><button type="button" class="assessment-day-heading" data-assessment-date="${date}" aria-label="Выбрать ${dateLabel(date)}" aria-pressed="${el('assessment-date').value===date}"><strong>${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][i]}</strong><span>${date.slice(8,10)}/${date.slice(5,7)}</span></button>${loadBadge(date)}${items.length?items.map(b=>`<article class="assessment-card ${b.assessment_type==='SOCH'?'soch':''}"><span class="assessment-kind">${b.assessment_type==='SOR'?'СОР':'СОЧ'}</span><span class="assessment-time">${esc(b.starts_at.slice(0,5))}–${esc(b.ends_at.slice(0,5))}</span><strong>${esc(b.subject)}</strong><small>${esc(byId(b.cohort_id)?.label||b.cohort_id)}</small><small>${b.instructor_name?`Преподаватель: ${esc(b.instructor_name)}`:'Преподаватель не назначен'}</small><small>Забронировал: ${esc(b.teacher_name)}</small>${b.note?`<small>${esc(b.note)}</small>`:''}${allowed()&&(isAdmin()||b.created_by===session.user.id&&upcoming(b))?`<button class="assessment-cancel" type="button" data-assessment-cancel="${esc(b.id)}">Отменить бронь</button>`:''}</article>`).join(''):`<p class="assessment-day-empty">${s.loaded?'<span aria-hidden="true">—</span><span class="sr-only">Нет запланированных работ</span>':'Расписание не загружено'}</p>`}</section>`;
    }).join('')+(quietWeekend?`<p class="assessment-weekend">Сб ${addDays(s.week,5).slice(8,10)}/${addDays(s.week,5).slice(5,7)} и Вс ${addDays(s.week,6).slice(8,10)}/${addDays(s.week,6).slice(5,7)}: ${s.loaded?'работ нет':'расписание не загружено'}</p>`:'');
  }
  function loadBadge(date){
    if(!allowed())return '';
    const row=s.summary?.find(r=>r.assessment_date===date);
    if(!row||!row.roster_ready)return '<p class="assessment-load pending">Нагрузка не подтверждена</p>';
    const unsafe=row.max_sor>3||row.overlap_pairs>0;
    const marks=[0,1,2].map(i=>`<i class="${i<row.max_sor?'on':''}"></i>`).join('');
    return '<p class="assessment-load '+(unsafe?'blocked':row.max_sor>=3?'full':'verified')+'"><span class="load-marks" aria-hidden="true">'+marks+'</span>Максимум у ученика: <strong>'+row.max_sor+' из 3 СОРов</strong><span>'+(row.overlap_pairs?'Пересечения: '+row.overlap_pairs:'Пересечений у учеников нет')+'</span></p>';
  }
  async function loadSummary(){
    const ticket=++s.summaryRequest,key=userKey();s.summary=null;renderWeek();
    if(!s.ready||!allowed())return;
    const p={p_from:s.week,p_to:addDays(s.week,6),p_grade:Number(el('assessment-grade').value),p_cohort:el('assessment-filter').value||null};
    try{const data=await rpc('assessment_load_summary',p);if(ticket!==s.summaryRequest||key!==userKey())return;
      if(!Array.isArray(data)||data.length!==7||data.some(r=>!Number.isInteger(r.max_sor)||!Number.isInteger(r.overlap_pairs)||typeof r.roster_ready!=='boolean'))throw Error('SUMMARY');
      s.summary=data;
    }catch{if(ticket!==s.summaryRequest)return;s.summary=null;}renderWeek();
  }
  function printCriteria(){return {cohort:el('assessment-print-class').value,from:dateFieldValue('assessment-print-from')||'',to:dateFieldValue('assessment-print-to')||'',kind:el('assessment-print-kind').value};}
  function validPrintDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;}
  function endPrint(){document.body.classList.remove('assessment-printing');el('assessment-print-sheet').hidden=true;}
  function invalidatePrint(){
    printState.request++;printState.busy=false;printState.html='';printState.fingerprint='';
    el('assessment-print-fields').disabled=false;el('assessment-print-run').disabled=true;
    el('assessment-print-preview').hidden=true;el('assessment-print-preview').innerHTML='';el('assessment-print-sheet').innerHTML='';
    setMessage('assessment-print-message','');endPrint();
  }
  function openPrint(overview=false){
    if(!s.ready||overview&&!s.coordinator)return;invalidatePrint();
    el('assessment-print-title').textContent=overview?'Все СОР / СОЧ':'Печать расписания';
    el('assessment-print-help').textContent=overview?'Все классы и группы за выбранный период. Каждая работа указана один раз.':'Все учителя выбранного класса, включая его core-группы. Фильтр «Мои брони» на печать не влияет.';
    const classes=s.catalog.filter(c=>c.class_name).sort((a,b)=>a.grade-b.grade||a.class_name.localeCompare(b.class_name));
    el('assessment-print-class').innerHTML=(s.coordinator?opt('all','Все классы и группы'):'')+classes.map(c=>opt(c.id,c.label)).join('');
    const selected=byId(el('assessment-filter').value),fallback=classes.find(c=>c.grade===Number(el('assessment-grade').value));
    el('assessment-print-class').value=selected?.class_name?selected.id:fallback?.id||classes[0]?.id||'';
    el('assessment-print-kind').value='SOR';el('assessment-print-from').value=s.week<'2026-09-01'?'2026-09-01':s.week>'2027-08-31'?'2027-08-31':s.week;
    el('assessment-print-to').value=addDays(el('assessment-print-from').value,6)>'2027-08-31'?'2027-08-31':addDays(el('assessment-print-from').value,6);
    if(overview){el('assessment-print-class').value='all';el('assessment-print-kind').value='ALL';}
    for(const id of ['assessment-print-from','assessment-print-to'])syncDateField(id,el(id).value);
    el('assessment-print-dialog').showModal();
  }
  async function preparePrint(event){
    event.preventDefault();if(printState.busy||!cloud)return;
    const p=printCriteria();invalidatePrint();
    if(!p.cohort||!validPrintDate(p.from)||!validPrintDate(p.to)||p.from>p.to||p.from<'2026-09-01'||p.to>'2027-08-31'||!['SOR','SOCH','ALL'].includes(p.kind)||(p.cohort==='all'&&!s.coordinator)){
      setMessage('assessment-print-message','Выберите класс и корректный период в пределах учебного года.','error');return;
    }
    const ticket=++printState.request;printState.busy=true;el('assessment-print-fields').disabled=true;
    setMessage('assessment-print-message','Загружаем актуальные записи для печати…');
    try{
      // Fresh catalog and all pages, independent of the weekly view and "My bookings".
      const result=await bounded(cloud.from('assessment_cohorts').select('id,label,grade,class_name,subject,related_ids').order('id'));
      if(result.error)throw result.error;
      if(ticket!==printState.request)return;
      const catalog=result.data,overview=p.cohort==='all',cohort=overview?{id:'all',class_name:'Все классы и группы',grade:11,related_ids:catalog?.map(c=>c.id)}:catalog?.find(c=>c.id===p.cohort&&c.class_name);
      if(!cohort||!Array.isArray(cohort.related_ids)||(!overview&&!cohort.related_ids.includes(cohort.id)))throw new Error('PRINT_CATALOG');
      const related=new Set(cohort.related_ids),all=[];let page;
      do{
        const r=overview?{data:await rpc('assessment_overview',{p_from:p.from,p_to:p.to,p_kind:p.kind,p_offset:all.length}),error:null}:await bounded(cloud.from('assessment_bookings').select('*').is('cancelled_at',null)
          .gte('assessment_date',p.from).lte('assessment_date',p.to).order('assessment_date').order('starts_at').order('id').range(all.length,all.length+999));
        if(ticket!==printState.request)return;if(r.error)throw r.error;
        if(!Array.isArray(r.data))throw new Error('PRINT_ROWS');page=r.data;all.push(...page);
      }while(page.length===1000);
      if(ticket!==printState.request||JSON.stringify(p)!==JSON.stringify(printCriteria())||!el('assessment-print-dialog').open)return;
      const rows=all.filter(b=>!b.cancelled_at&&related.has(b.cohort_id)&&b.assessment_date>=p.from&&b.assessment_date<=p.to&&(p.kind==='ALL'||b.assessment_type===p.kind))
        .sort((a,b)=>a.assessment_date.localeCompare(b.assessment_date)||a.starts_at.localeCompare(b.starts_at)||a.subject.localeCompare(b.subject,'ru')||String(a.id).localeCompare(String(b.id)));
      const labelDate=dateLabel,kind=p.kind==='SOR'?'СОР':p.kind==='SOCH'?'СОЧ':'СОР / СОЧ';
      const names=new Map(catalog.map(c=>[c.id,c]));
      const timestamp=formatTimestamp(new Date());
      const html=`<article class="assessment-print-content"><div class="print-brand">DEMO STEM SCHOOL · 2026–2027</div><h1>Расписание ${kind} · ${esc(cohort.class_name)}</h1><p>${labelDate(p.from)} — ${labelDate(p.to)} включительно</p>${rows.length?`<table><thead><tr><th scope="col">Дата</th><th scope="col">Время</th><th scope="col">Предмет</th><th scope="col">Для кого</th><th scope="col">Учитель</th></tr></thead><tbody>${rows.map(b=>`<tr><td>${labelDate(b.assessment_date)}</td><td>${esc(b.starts_at.slice(0,5))}–${esc(b.ends_at.slice(0,5))}</td><td><strong>${esc(b.subject)}</strong>${p.kind==='ALL'?`<small>${b.assessment_type==='SOR'?'СОР':'СОЧ'}</small>`:''}${b.note?`<small>${esc(b.note)}</small>`:''}</td><td>${b.cohort_id===cohort.id?'Весь класс':esc(names.get(b.cohort_id)?.label||b.cohort_id)}</td><td>${b.instructor_name?esc(b.instructor_name):'Не назначен'}<small>Забронировал: ${esc(b.teacher_name)}</small></td></tr>`).join('')}</tbody></table>`:`<p>На выбранный период ${p.kind==='SOR'?'СОРы':p.kind==='SOCH'?'СОЧ':'СОРы и СОЧ'} не запланированы.</p>`}${cohort.grade>=10?'<p class="print-footnote">Работы core-групп и математических групп относятся только к их участникам из этого класса. Общее число работ класса за день не равно нагрузке каждого ученика.</p>':''}<p class="print-footnote">Сформировано ${esc(timestamp)}. Актуальное расписание — во вкладке «СОР / СОЧ» Quantum Maps.</p></article>`;
      printState.html=html;printState.fingerprint=JSON.stringify(p);el('assessment-print-preview').innerHTML=html;
      el('assessment-print-preview').hidden=false;el('assessment-print-run').disabled=false;
      setMessage('assessment-print-message',`Готово. Работ в расписании: ${rows.length}.`,'success');
    }catch(e){if(ticket===printState.request)setMessage('assessment-print-message','Не удалось подготовить расписание. Проверьте подключение и попробуйте ещё раз.','error');}
    finally{if(ticket===printState.request){printState.busy=false;el('assessment-print-fields').disabled=false;}}
  }
  function beginPrint(){
    if(!printState.html||printState.fingerprint!==JSON.stringify(printCriteria())||!el('assessment-print-dialog').open)return false;
    el('assessment-print-sheet').innerHTML=printState.html;el('assessment-print-sheet').hidden=false;
    document.body.classList.add('assessment-printing');return true;
  }
  async function load(){
    const ticket=++s.load;s.loaded=false;s.ready=false;s.rows=[];s.summary=null;s.summaryRequest++;s.check++;clearTimeout(s.timer);s.available=false;updateAccess();renderWeek();
    el('assessment-status').className='assessment-status';el('assessment-status').textContent='Загружаем расписание…';
    if(!cloud){el('assessment-status').textContent='Подключаем общее расписание…';return;}
    const week=s.week;
    try{
      const [catalog,first,access]=await Promise.all([
        bounded(cloud.from('assessment_cohorts').select('id,label,grade,class_name,subject,related_ids').order('id')),
        bounded(cloud.from('assessment_bookings').select('*').is('cancelled_at',null).gte('assessment_date',week).lte('assessment_date',addDays(week,6)).order('assessment_date').order('starts_at').order('id').range(0,999)),allowed()?rpc('assessment_access',{}):Promise.resolve({coordinator:false})]);
      if(catalog.error)throw catalog.error;if(first.error)throw first.error;
      const rows=[...(first.data||[])];let page=first.data||[];
      while(page.length===1000){const r=await bounded(cloud.from('assessment_bookings').select('*').is('cancelled_at',null).gte('assessment_date',week).lte('assessment_date',addDays(week,6)).order('assessment_date').order('starts_at').order('id').range(rows.length,rows.length+999));if(r.error)throw r.error;page=r.data||[];rows.push(...page);}
      if(ticket!==s.load)return;
      const teachers=access?.coordinator?await rpc('assessment_teachers',{}):[];if(ticket!==s.load)return;
      if(!Array.isArray(teachers))throw Error('TEACHERS');
      const teacher=el('assessment-teacher').value;el('assessment-teacher').innerHTML=opt('','Не назначен')+teachers.map(t=>opt(t.user_id,t.display_name)).join('');
      if(teachers.some(t=>t.user_id===teacher))el('assessment-teacher').value=teacher;
      if(!catalog.data?.length){el('assessment-status').textContent='Составы классов и групп ещё не подключены. Бронирование пока закрыто.';return;}
      const previousFilter=el('assessment-filter').value,draft=payload(),period=el('assessment-period').value,periodEnd=el('assessment-period-end').value;
      s.catalog=catalog.data;s.rows=rows;s.loaded=true;s.ready=true;s.coordinator=access?.coordinator===true;
      fillGrade();
      el('assessment-period').value=period;el('assessment-period-end').value=periodEnd;el('assessment-start').value=draft.p_start;el('assessment-end').value=draft.p_end;
      if(s.catalog.some(c=>c.id===previousFilter))el('assessment-filter').value=previousFilter;
      el('assessment-status').textContent='Общее расписание · обновлено '+new Intl.DateTimeFormat('ru',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Qyzylorda',hourCycle:'h23'}).format(new Date());
      renderWeek();loadSummary();invalidate();
    }catch(e){if(ticket!==s.load)return;el('assessment-status').className='assessment-status error';el('assessment-status').textContent=/PGRST20[25]|42P01/.test(e?.code||'')?'Раздел СОР / СОЧ ещё не подключён к общей базе. Бронирование пока закрыто.':'Не удалось загрузить расписание. Нажмите «Обновить». Свободное время сейчас не подтверждено.';}
    finally{if(ticket===s.load)updateAccess();}
  }
  async function save(event){
    event.preventDefault();if(s.busy||!s.available||!allowed()||!s.ready)return;
    const p={...payload(),p_note:el('assessment-note').value.trim()},fingerprint=JSON.stringify(p),key=userKey();
    if(s.request?.fingerprint!==fingerprint)s.request={fingerprint,id:crypto.randomUUID()};
    const id=s.request.id;s.busy=true;s.check++;clearTimeout(s.timer);updateAccess();setMessage('assessment-message','Сохраняем бронь…');
    try{await rpc('assessment_create',{p_id:id,...p});if(key!==userKey())return;
      s.request=null;el('assessment-note').value='';setMessage('assessment-message','Бронь сохранена.','success');s.week=monday(p.p_date);await load();
      if(key===userKey()){s.check++;clearTimeout(s.timer);s.available=false;setMessage('assessment-check','Бронь добавлена. Для следующей работы выберите другой предмет, группу или время.');}
    }catch(e){if(key===userKey()){setMessage('assessment-message',errorText(e),'error');invalidate();}}
    finally{if(key===userKey()){s.busy=false;updateAccess();}}
  }
  function openCancel(id){const b=s.rows.find(x=>x.id===id);if(!b||!allowed()||s.busy)return;s.cancel=b;el('assessment-cancel-description').textContent=`${b.subject} · ${byId(b.cohort_id)?.label} · ${dateLabel(b.assessment_date)} · ${b.starts_at.slice(0,5)}`;setMessage('assessment-cancel-message','');el('assessment-cancel-dialog').showModal();}
  async function cancel(event){event.preventDefault();if(s.busy||!s.cancel||!allowed())return;const id=s.cancel.id,key=userKey();s.busy=true;el('assessment-cancel-confirm').disabled=true;updateAccess();
    try{await rpc('assessment_cancel',{p_id:id});if(key!==userKey())return;el('assessment-cancel-dialog').close();s.cancel=null;await load();}
    catch(e){if(key===userKey()){setMessage('assessment-cancel-message',errorText(e),'error');renderWeek();}}
    finally{if(key===userKey()){s.busy=false;el('assessment-cancel-confirm').disabled=false;updateAccess();}}
  }
  function authChanged(){const key=userKey();if(s.authKey!==key){s.authKey=key;s.coordinator=false;s.summary=null;s.summaryRequest++;invalidatePrint();if(el('assessment-print-dialog').open)el('assessment-print-dialog').close();s.check++;s.load++;clearTimeout(s.timer);s.request=null;s.available=false;s.busy=false;s.cancel=null;el('assessment-cancel-confirm').disabled=false;if(el('assessment-cancel-dialog').open)el('assessment-cancel-dialog').close();setMessage('assessment-message','');if(s.visible)load();}updateAccess();renderWeek();}
  // Tabs: map, assessments, evacuation. Evacuation reuses the map panel in its own mode (evacuation.js).
  const TABS=['map','assessments','evacuation'].filter(t=>el(`${t}-tab`));
  function selectTab(name,focus=false){if(typeof name==='boolean')name=name?'assessments':'map';const assessment=name==='assessments';s.visible=assessment;el('map-panel').hidden=assessment;el('assessments-panel').hidden=!assessment;
    const title=document.querySelector('.edition strong');if(title)title.textContent=assessment?'СОР / СОЧ':name==='evacuation'?'Эвакуация':'Карта школы';
    for(const t of TABS){const on=t===name;el(`${t}-tab`).setAttribute('aria-selected',String(on));el(`${t}-tab`).tabIndex=on?0:-1;}
    if(typeof evacuationSetMode==='function')evacuationSetMode(name==='evacuation');
    if(focus)el(`${name}-tab`).focus();if(assessment)load();
  }
  for(const t of TABS){el(`${t}-tab`).onclick=()=>selectTab(t);el(`${t}-tab`).onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=TABS.indexOf(t),n=TABS.length;selectTab(TABS[e.key==='Home'?0:e.key==='End'?n-1:e.key==='ArrowRight'?(i+1)%n:(i-1+n)%n],true);};}
  el('assessment-grade').innerHTML=[...new Set(s.catalog.map(c=>c.grade))].sort((a,b)=>a-b).map(g=>opt(String(g),`${g} классы`)).join('');el('assessment-grade').value='10';
  bindDateField('assessment-date',()=>{invalidate();renderWeek();});syncDateField('assessment-date',initial);
  el('assessment-grade').onchange=fillGrade;el('assessment-subject').onchange=fillCohorts;
  el('assessment-period').onchange=()=>fillTime();el('assessment-period-end').onchange=()=>fillTime(true);
  for(const id of ['assessment-start','assessment-end'])el(id).oninput=()=>{el('assessment-period').value='custom';invalidate();};
  for(const id of ['assessment-other','assessment-cohort','assessment-date','assessment-teacher'])el(id).oninput=invalidate;
  for(const radio of el('assessment-form').querySelectorAll('input[name="assessment-type"]'))radio.onchange=invalidate;
  el('assessment-filter').onchange=()=>{renderWeek();loadSummary();};el('assessment-mine').onchange=renderWeek;
  el('assessment-prev').onclick=()=>{s.week=addDays(s.week,-7);load();};el('assessment-next').onclick=()=>{s.week=addDays(s.week,7);load();};el('assessment-today').onclick=()=>{s.week=monday(initial);load();};el('assessment-refresh').onclick=load;
  el('assessment-login').onclick=()=>el('auth-button').click();el('assessment-form').onsubmit=save;
  el('assessment-week').onclick=e=>{const button=e.target.closest('[data-assessment-cancel]');if(button){openCancel(button.dataset.assessmentCancel);return;}const day=e.target.closest('[data-assessment-date]');if(day&&!s.busy){syncDateField('assessment-date',day.dataset.assessmentDate);invalidate();renderWeek();el('assessment-date-display').focus({preventScroll:true});el('assessment-form-title').scrollIntoView?.({behavior:'smooth',block:'start'});}};
  el('assessment-cancel-close').onclick=()=>el('assessment-cancel-dialog').close();el('assessment-cancel-form').onsubmit=cancel;
  document.body.appendChild(el('assessment-print-sheet'));
  el('assessment-print-open').onclick=()=>openPrint();el('assessment-overview-open').onclick=()=>openPrint(true);el('assessment-print-form').onsubmit=preparePrint;
  el('assessment-print-close').onclick=()=>{el('assessment-print-dialog').close();invalidatePrint();};
  el('assessment-print-dialog').addEventListener('close',invalidatePrint);
  for(const id of ['assessment-print-from','assessment-print-to'])bindDateField(id,invalidatePrint);
  for(const id of ['assessment-print-class','assessment-print-from','assessment-print-to','assessment-print-kind'])el(id).oninput=invalidatePrint;
  el('assessment-print-run').onclick=()=>{if(!beginPrint())return;try{window.print();}catch{endPrint();setMessage('assessment-print-message','Печать недоступна в этом браузере. Откройте страницу в обычном браузере и повторите.','error');}};
  window.addEventListener('beforeprint',beginPrint);window.addEventListener('afterprint',endPrint);
  window.addEventListener('focus',()=>{if(s.visible&&!s.busy)load();});
  assessmentUI={authChanged};fillGrade();authChanged();
  if(window.location?.hash==='#assessments')selectTab(true);
})();

// ---------- Evacuation tab: arrows along corridors, exits, per-room routes and the superadmin editor ----------
// Geometry and routing are pure (EVAC); the UI below needs app.js globals and starts only next to the map.
const EVAC=(()=>{
 const SNAP=9,EXIT_R=28,ENTRY_MAX=90,ENTRY_SLACK=25,OWN_R=14,GRID=10;
 const empty=()=>({arrows:[],exits:[],blocks:[]});
 const num=v=>Math.round(Number(v)*10)/10;
 const clone=p=>({arrows:(p?.arrows||[]).filter(a=>Array.isArray(a?.pts)&&a.pts.length>=2).map(a=>({id:String(a.id),pts:a.pts.map(([x,y])=>[num(x),num(y)])})),exits:(p?.exits||[]).map(e=>({id:String(e.id),x:num(e.x),y:num(e.y),kind:e.kind==='stair'?'stair':'exit',label:String(e.label||'').trim().slice(0,80)||(e.kind==='stair'?'Лестница':'Выход')})),blocks:(p?.blocks||[]).filter(b=>Array.isArray(b?.pts)&&b.pts.length>=3).map(b=>({id:String(b.id),pts:b.pts.map(([x,y])=>[num(x),num(y)])}))});
 // Older databases accept only arrows and exits: an empty list of zones is not sent at all.
 const forServer=p=>{const c=clone(p);if(!c.blocks.length)delete c.blocks;return c;};
 const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 function project(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0,q=[a[0]+t*dx,a[1]+t*dy];return {t,q,d:dist(p,q)};}
 function crossT(a,b,c,d){const r=[b[0]-a[0],b[1]-a[1]],s=[d[0]-c[0],d[1]-c[1]],den=r[0]*s[1]-r[1]*s[0];if(Math.abs(den)<1e-9)return null;const t=((c[0]-a[0])*s[1]-(c[1]-a[1])*s[0])/den,u=((c[0]-a[0])*r[1]-(c[1]-a[1])*r[0])/den;return t>=0&&t<=1&&u>=0&&u<=1?t:null;}
 function inside(p,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>p[1])!==(yj>p[1])&&p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi)c=!c;}return c;}
 // A corridor segment is closed when it touches an impassable zone: crosses its edge or lies inside it.
 function segBlocked(a,b,blocks){
  for(const z of blocks||[]){const poly=z.pts;if(inside(a,poly)||inside(b,poly)||inside([(a[0]+b[0])/2,(a[1]+b[1])/2],poly))return true;
   for(let i=0;i<poly.length;i++)if(crossT(a,b,poly[i],poly[(i+1)%poly.length])!==null)return true;}
  return false;
 }
 const arrowBlocked=(a,blocks)=>a.pts.some((p,i)=>i+1<a.pts.length&&segBlocked(p,a.pts[i+1],blocks));
 // Closest point of segment ab to a room. An arrow leaving the room enters the route where it crosses the wall.
 function segToPoly(a,b,poly){
  let leave=null;for(let i=0;i<poly.length;i++){const t=crossT(a,b,poly[i],poly[(i+1)%poly.length]);if(t!==null&&(leave===null||t>leave))leave=t;}
  if(leave!==null)return {d:0,q:[a[0]+leave*(b[0]-a[0]),a[1]+leave*(b[1]-a[1])]};
  if(inside(a,poly))return {d:0,q:b.slice()};
  let best={d:Infinity,q:a};
  for(let i=0;i<poly.length;i++){const c=poly[i],e=poly[(i+1)%poly.length],p1=project(c,a,b);if(p1.d<best.d)best={d:p1.d,q:p1.q};for(const end of [a,b]){const p2=project(end,c,e);if(p2.d<best.d)best={d:p2.d,q:end.slice()};}}
  return best;
 }
 const EVAC_polyDist=(p,poly)=>dist(p,closestOnPoly(p,poly));
 function closestOnPoly(p,poly){let best={d:Infinity,q:p};for(let i=0;i<poly.length;i++){const pr=project(p,poly[i],poly[(i+1)%poly.length]);if(pr.d<best.d)best=pr;}return best.q;}
 // Directed graph: arrow vertices closer than SNAP merge; a vertex lying on another arrow's segment splits it (T-junction).
 function build(plan){
  const nodes=[],edges=[];
  const nodeAt=p=>{for(let i=0;i<nodes.length;i++)if(dist(nodes[i],p)<=SNAP)return i;nodes.push([p[0],p[1]]);return nodes.length-1;};
  const ids=plan.arrows.map(a=>a.pts.map(nodeAt)),starts=new Set(ids.map(chain=>chain[0]));
  plan.arrows.forEach((a,ai)=>{const chainIds=ids[ai];for(let k=0;k+1<chainIds.length;k++){const u=chainIds[k],v=chainIds[k+1];if(u===v)continue;const A=nodes[u],B=nodes[v],mids=[];
   nodes.forEach((n,i)=>{if(i===u||i===v)return;const pr=project(n,A,B);if(pr.d<=SNAP&&pr.t>0&&pr.t<1)mids.push([pr.t,i]);});
   const chain=[u,...mids.sort((x,y)=>x[0]-y[0]).map(m=>m[1]),v];
   for(let j=0;j+1<chain.length;j++)if(chain[j]!==chain[j+1]&&!segBlocked(nodes[chain[j]],nodes[chain[j+1]],plan.blocks))edges.push({from:chain[j],to:chain[j+1],len:dist(nodes[chain[j]],nodes[chain[j+1]])});}});
  return {nodes,edges,starts};
 }
 // Distance from every node to the nearest allowed exit along the arrows (reverse Dijkstra from the exits).
 function toExits(g,exits){
  const N=g.nodes.length,d=new Array(N).fill(Infinity),next=new Array(N).fill(-1),exitOf=new Array(N).fill(null),done=new Array(N).fill(false),rev=Array.from({length:N},()=>[]);
  exits.forEach(e=>g.nodes.forEach((n,i)=>{const l=dist(n,[e.x,e.y]);if(l<=EXIT_R&&l<d[i]){d[i]=l;exitOf[i]=e;}}));
  g.edges.forEach(e=>rev[e.to].push(e));
  for(;;){let u=-1;for(let i=0;i<N;i++)if(!done[i]&&d[i]<Infinity&&(u<0||d[i]<d[u]))u=i;if(u<0)break;done[u]=true;
   for(const e of rev[u]){const nd=d[u]+e.len;if(nd<d[e.from]){d[e.from]=nd;next[e.from]=u;exitOf[e.from]=exitOf[u];}}}
  return {d,next,exitOf};
 }
 // Stairs lead down, so on the first floor only real exits finish a route.
 const targetsFor=(plan,floor)=>plan.exits.filter(e=>e.kind==='exit'||String(floor)!=='1');
 function analyze(plan,floor){
  const targets=targetsFor(plan,floor),g=build(plan),r=toExits(g,targets);
  // start: {poly} for a room, {point} for a stair landing.
  // start.ownOnly (a stair landing on a floor above the first): only an arrow drawn from the landing counts.
  function route(start){
   // A stair that comes down right next to an exit door: go out there.
   if(start.point){const t=targets.filter(e=>e.kind==='exit').map(e=>({e,d:dist([e.x,e.y],start.point)})).filter(x=>x.d<=EXIT_R).sort((a,b)=>a.d-b.d)[0];if(t)return {exit:t.e,points:[start.point.map(num),[t.e.x,t.e.y]],length:Math.round(t.d)};}
   const hits=[];
   for(const e of g.edges){if(r.d[e.to]===Infinity)continue;const A=g.nodes[e.from],B=g.nodes[e.to],hit=start.poly?segToPoly(A,B,start.poly):project(start.point,A,B);if(hit.d>ENTRY_MAX)continue;
    // The step from the door to the corridor must not jump over a closed passage either.
    const from=start.poly?(hit.d>0?closestOnPoly(hit.q,start.poly):hit.q):start.point;if(hit.d>0&&segBlocked(from,hit.q,plan.blocks))continue;
    hits.push({e,hit,cost:hit.d+dist(hit.q,B)+r.d[e.to]});}
   if(!hits.length)return null;
   // An arrow drawn from the room's door is that room's own route and wins over passing corridors.
   // An arrow drawn from the room's door, or from the stair sign, is that start's own route.
   const own=hits.filter(h=>g.starts.has(h.e.from)&&(start.poly?inside(g.nodes[h.e.from],start.poly)||EVAC_polyDist(g.nodes[h.e.from],start.poly)<=OWN_R:dist(g.nodes[h.e.from],start.point)<=EXIT_R));
   if(start.ownOnly&&!own.length)return null;
   const pool=own.length?own:hits,nearest=Math.min(...pool.map(h=>h.hit.d)),best=pool.filter(h=>h.hit.d<=nearest+ENTRY_SLACK).sort((a,b)=>a.cost-b.cost)[0];
   const pts=[best.hit.q];let u=best.e.to,guard=0;
   while(u>=0&&guard++<=g.nodes.length){pts.push(g.nodes[u]);if(r.next[u]<0)break;u=r.next[u];}
   const exit=r.exitOf[best.e.to];pts.push([exit.x,exit.y]);
   const anchor=start.poly?(best.hit.d>0?closestOnPoly(best.hit.q,start.poly):best.hit.q):start.point;
   if(dist(anchor,pts[0])>0.5)pts.unshift(anchor);
   return {exit,points:pts.map(([x,y])=>[num(x),num(y)]),length:Math.round(best.cost)};
  }
  return {route};
 }
 // Chevrons along a polyline, every `spacing` map units, carried over the corners.
 function chevrons(pts,spacing=34,start=spacing/2){const out=[];let s=start;for(let i=0;i+1<pts.length;i++){const a=pts[i],b=pts[i+1],len=dist(a,b);if(!len)continue;const ang=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;while(s<len){out.push([num(a[0]+(b[0]-a[0])*s/len),num(a[1]+(b[1]-a[1])*s/len),Math.round(ang)]);s+=spacing;}s-=len;}return out;}
 function nearestStair(plan,p,max=90){let best=null;for(const e of plan.exits)if(e.kind==='stair'){const d=dist([e.x,e.y],p);if(d<=max&&(!best||d<best.d))best={e,d};}return best?.e||null;}
 return {SNAP,EXIT_R,GRID,empty,clone,forServer,dist,project,build,analyze,chevrons,nearestStair,inside,segBlocked,arrowBlocked};
})();

// var: app.js draws the map before this file runs, so the hooks must see an initialised binding.
var evac=null;
function evacActive(){return Boolean(evac?.state.on);}
function evacuationSetMode(on){if(evac)evac.setMode(on);}
function evacLayer(){return evac?evac.layer():'';}
function evacAfterDraw(){if(evac)evac.afterDraw();}
function evacRenderCard(){if(evac)evac.renderCard();}
function evacRenderCallout(){if(evac)evac.renderCallout();}
function evacLoad(){return evac?evac.load():Promise.resolve();}
function evacAuthChanged(){if(evac)evac.authChanged();}

if(typeof state!=='undefined'&&typeof document!=='undefined'&&document.getElementById('evacuation-tab'))evac=(()=>{
 // Last published plans are kept on the device: shown at once and when offline.
 const CACHE_KEY='quantum-evac-published-v1';
 const readCache=()=>{try{const v=JSON.parse(window.localStorage?.getItem(CACHE_KEY)||'{}');return v&&typeof v==='object'?v:{};}catch(_e){return {};}};
 const writeCache=rows=>{try{window.localStorage?.setItem(CACHE_KEY,JSON.stringify(rows));}catch(_e){}};
 const ev={on:false,published:readCache(),drafts:{},loadError:'',editing:false,tool:'arrow',work:{},current:[],hover:null,selected:null,busy:false,continuation:null,message:'',messageKind:''};
 const builtIn=floor=>EVAC.clone(D.evacuation?.[floor]||EVAC.empty());
 const publishedPlan=floor=>ev.published[floor]?EVAC.clone(ev.published[floor].plan):builtIn(floor);
 const work=()=>ev.work[state.floor];
 const planFor=floor=>ev.editing&&ev.work[floor]?ev.work[floor].plan:publishedPlan(floor);
 const roomPoly=r=>roomPoints(r);
 const uid=prefix=>`${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
 const markerIcon=kind=>kind==='stair'?'<path class="evac-sign-glyph" d="M-6 5h4v-4h4v-4h4v-4"/>':'<text class="evac-sign-text" y="3">ВЫХОД</text>';
 // Stairs of floors 2-4 without a stair sign near them on the first floor (the continuation starts from that sign).
 const STAIR_MATCH=90,STAIR_GROUP=40;
 function missingStairs(){
  const groups=[];for(const f of ['2','3','4'])for(const e of planFor(f).exits)if(e.kind==='stair'){const g=groups.find(x=>EVAC.dist([x.x,x.y],[e.x,e.y])<=STAIR_GROUP);if(g){g.labels.push(`${f} эт.: ${e.label}`);g.floors.push(Number(f));}else groups.push({x:e.x,y:e.y,labels:[`${f} эт.: ${e.label}`],floors:[Number(f)]});}
  const first=planFor('1').exits.filter(e=>e.kind==='stair');
  const exitsAbove=g=>{const low=Math.min(...g.floors);if(low<3)return false;const d=descend(String(low),[g.x,g.y]);return Boolean(d&&d.floor!=='1');};
  return groups.filter(g=>!first.some(e=>EVAC.dist([e.x,e.y],[g.x,g.y])<=STAIR_MATCH)&&!exitsAbove(g));
 }
 let analysis=null,analysisKey='';
 function currentAnalysis(){const plan=planFor(state.floor),key=state.floor+JSON.stringify(plan);if(key!==analysisKey){analysisKey=key;analysis=EVAC.analyze(plan,state.floor);}return analysis;}
 function routeForRoom(id){const r=floorData().rooms.find(x=>x.room_id===id);return r?currentAnalysis().route({poly:roomPoly(r)}):null;}
 const FLOOR_ACC={'1':'первый','2':'второй','3':'третий'},FLOOR_PREP={'1':'первом','2':'втором','3':'третьем'};
 // A stair goes down floor by floor. Above the first floor the way out ends on that floor when an exit is right
 // at the landing or an arrow is drawn from the landing to an exit; otherwise the stair goes on down.
 // The landing is the stair sign on that floor nearest to where the stair came from.
 function descend(fromFloor,point){
  let at=point;
  for(let f=Number(fromFloor)-1;f>=1;f--){
   const floor=String(f),plan=planFor(floor),stair=EVAC.nearestStair(plan,at);if(stair)at=[stair.x,stair.y];
   const a=EVAC.analyze(plan,floor);
   if(f===1)return {floor,route:a.route({point:at})};
   const r=a.route({point:at,ownOnly:true});if(r&&r.exit.kind==='exit')return {floor,route:r};
  }
  return null;
 }
 // The way out on the floor the stair led to.
 function continuationRoute(){const c=ev.continuation;if(!c||state.floor!==c.to)return null;const d=descend(c.floor,[c.x,c.y]);return d&&d.floor===c.to?d.route:null;}
 function downstairs(route){if(!route||route.exit.kind!=='stair'||state.floor==='1')return null;return descend(state.floor,[route.exit.x,route.exit.y]);}
 const autoLabel=(kind,p)=>{let best=null;for(const r of floorData().rooms){const d=EVAC.dist(center(roomPoly(r)),p);if(!best||d<best.d)best={r,d};}const base=kind==='stair'?'Лестница':'Выход';return best?/^\d/.test(best.r.n)?`${base} у ${best.r.n}`:`${base} · ${best.r.n}`:base;};

 function routeSvg(route,cls){if(!route)return '';const pts=points(route.points);return `<g class="evac-route ${cls||''}"><polyline class="evac-route-halo" points="${pts}"/><polyline class="evac-route-line" points="${pts}"/><polyline class="evac-route-flow" points="${pts}"/>${EVAC.chevrons(route.points,26,14).map(([x,y,a])=>`<path class="evac-route-chevron" d="M-4.5 -5L3 0L-4.5 5" transform="translate(${x} ${y}) rotate(${a})"/>`).join('')}</g>`;}
 // Arrowhead at the last point, pointing along the last segment; the line stops at its base.
 function arrowHead(pts){const n=pts.length,[x,y]=pts[n-1],[px,py]=pts[n-2],ang=Math.round(Math.atan2(y-py,x-px)*180/Math.PI);return `<path class="evac-head" d="M-9 -6.5L1 0L-9 6.5Z" transform="translate(${x} ${y}) rotate(${ang})"/>`;}
 function shorten(pts,by=8){const n=pts.length,a=pts[n-2],b=pts[n-1],len=EVAC.dist(a,b),k=len>by+2?(len-by)/len:0.5;return [a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k];}
 function layerInner(){
  const plan=planFor(state.floor),editing=ev.editing,sel=ev.selected;
  const selectedRoute=ev.continuation?continuationRoute():state.selected?routeForRoom(state.selected):null;
  const sc=editing?scale():1;
  const isSel=a=>editing&&sel?.type==='arrow'&&sel.id===a.id;
  const handles=a=>a.pts.map(([x,y],i)=>{const end=i===a.pts.length-1,start=i===0;return `<circle class="evac-handle${start?' start':end?' end':''}" cx="${x}" cy="${y}" r="${((start||end)?5.5:4.5)/sc}"/>`;}).join('');
  const blockedIds=editing?new Set(plan.arrows.filter(a=>EVAC.arrowBlocked(a,plan.blocks)).map(a=>a.id)):new Set();
  const arrows=plan.arrows.map(a=>`<g class="evac-arrow${isSel(a)?' selected':''}${blockedIds.has(a.id)?' blocked':''}" data-arrow="${esc(a.id)}"><polyline class="evac-hit" points="${points(a.pts)}"/><polyline class="evac-line" points="${points(a.pts.slice(0,-1).concat([shorten(a.pts)]))}"/>${EVAC.chevrons(a.pts.slice(0,-1).concat([shorten(a.pts,22)])).map(([x,y,r])=>`<path class="evac-chevron" d="M-3.5 -4L2.5 0L-3.5 4" transform="translate(${x} ${y}) rotate(${r})"/>`).join('')}${arrowHead(a.pts)}${isSel(a)?handles(a):editing?a.pts.map(([x,y])=>`<circle class="evac-vertex" cx="${x}" cy="${y}" r="${2.6/sc}"/>`).join(''):''}</g>`).join('');
  const target=selectedRoute?.exit;
  const ghosts=editing&&state.floor==='1'?missingStairs().map(g=>`<g class="evac-ghost" transform="translate(${g.x} ${g.y})"><title>Сюда спускается лестница. ${esc(g.labels.join('; '))}</title><circle class="evac-ghost-ring" r="15"/>${markerIcon('stair')}</g>`).join(''):'';
  const exits=plan.exits.map(e=>`<g class="evac-sign ${e.kind}${target&&target.id===e.id?' target':''}${editing&&sel?.type==='exit'&&sel.id===e.id?' selected':''}" data-exit="${esc(e.id)}" transform="translate(${e.x} ${e.y})"><title>${esc(e.label)}</title>${editing?`<circle class="evac-zone" r="${EVAC.EXIT_R}"/>`:''}${e.kind==='stair'?'<circle class="evac-sign-bg" r="11"/>':'<rect class="evac-sign-bg" x="-21" y="-9" width="42" height="18" rx="4"/>'}${markerIcon(e.kind)}</g>`).join('');
  const isSelBlock=z=>editing&&sel?.type==='block'&&sel.id===z.id;
  const blocks=plan.blocks.map(z=>`<g class="evac-block${isSelBlock(z)?' selected':''}" data-block="${esc(z.id)}"><polygon class="evac-block-fill" points="${points(z.pts)}"/><polygon class="evac-block-edge" points="${points(z.pts)}"/>${isSelBlock(z)?z.pts.map(([x,y])=>`<circle class="evac-handle" cx="${x}" cy="${y}" r="${4.5/sc}"/>`).join(''):''}</g>`).join('');
  const blockTool=editing&&(ev.tool==='block'||sel?.type==='block');
  const grid=blockTool?'<rect class="evac-grid" x="-200" y="-200" width="1700" height="1120"/>':'';
  const last=ev.current[ev.current.length-1],rubberPts=ev.tool==='block'?[last,ev.hover||last,ev.current[0]]:[last,ev.hover||last];
  const drawing=editing&&ev.current.length?`${ev.tool==='block'&&ev.current.length>=2?`<polygon class="evac-block-fill drawing" points="${points(ev.current)}"/>`:''}<polyline class="evac-drawing${ev.tool==='block'?' block':''}" points="${points(ev.current)}"/><polyline id="evac-rubber" class="evac-rubber${ev.tool==='block'?' block':''}" points="${points(rubberPts)}"/>${ev.current.map(([x,y],i)=>`<circle class="evac-vertex drawing${ev.tool==='block'&&i===0?' first':''}" cx="${x}" cy="${y}" r="${(ev.tool==='block'&&i===0?4.5:3)/sc}"/>`).join('')}`:'';
  const hint=editing?`<circle id="evac-snap" class="evac-snap" r="${(blockTool?4:7)/sc}" cx="${ev.snapHint?.[0]??0}" cy="${ev.snapHint?.[1]??0}"${ev.snapHint?'':' hidden'}/>`:'';
  // Hatching and the grid are patterns in map units; no filters (see the performance rules).
  const defs=`<defs><pattern id="evac-hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><rect class="evac-hatch-bg" width="7" height="7"/><line class="evac-hatch-line" x1="0" y1="0" x2="0" y2="7"/></pattern>${grid?`<pattern id="evac-grid-dots" patternUnits="userSpaceOnUse" x="-${EVAC.GRID/2}" y="-${EVAC.GRID/2}" width="${EVAC.GRID}" height="${EVAC.GRID}"><circle class="evac-grid-dot" cx="${EVAC.GRID/2}" cy="${EVAC.GRID/2}" r="${Math.min(1.4,1.1/sc)}"/></pattern>`:''}</defs>`;
  return `${defs}${grid}${ghosts}${exits}<g class="evac-arrows${selectedRoute?' dimmed':''}">${arrows}</g><g class="evac-blocks">${blocks}</g>${routeSvg(selectedRoute)}${drawing}${hint}`;
 }
 function layer(){if(!ev.on)return '';return `<g id="layer-evac" class="map-layer layer-evac${ev.editing?' editing tool-'+ev.tool:''}" transform="${transformFor('rooms',state.floor)}">${layerInner()}</g>`;}
 function refreshLayer(){const g=$('layer-evac');if(!g){draw();applyView();return;}g.setAttribute('class',`map-layer layer-evac${ev.editing?' editing tool-'+ev.tool:''}`);g.innerHTML=layerInner();markRooms();}
 function markRooms(){if(!ev.on)return;const a=currentAnalysis();$('map').querySelectorAll('.room').forEach(el=>{const r=floorData().rooms.find(x=>x.room_id===el.dataset.id);el.classList.toggle('evac-noroute',Boolean(r)&&!a.route({poly:roomPoly(r)}));});}
 function afterDraw(){if(!ev.on)return;markRooms();renderSide();}

 // ----- Side panel, card and callout -----
 function coverage(){const rooms=floorData().rooms,a=currentAnalysis();return {total:rooms.length,ok:rooms.filter(r=>a.route({poly:roomPoly(r)})).length};}
 function renderSide(){
  const box=$('evac-side');if(!box)return;const plan=planFor(state.floor),cov=coverage(),w=work();
  const exits=plan.exits.filter(e=>e.kind==='exit'),stairs=plan.exits.filter(e=>e.kind==='stair');
  const source=ev.editing?(w?.base!=null?'Черновик':'Черновик ещё не сохранён'):ev.published[state.floor]?'Опубликовано':'Встроенная схема';
  const draftNote=!ev.editing&&superadmin&&ev.drafts[state.floor]?'<p class="evac-hint">Есть неопубликованный черновик этого этажа.</p>':'';
  $('evac-floor-title').textContent=floorNames[state.floor];
  $('evac-summary').innerHTML=`${plan.arrows.length||plan.exits.length?`Маршрут есть у <strong>${cov.ok}</strong> из <strong>${cov.total}</strong> помещений`:'Маршруты этого этажа ещё не нарисованы'}`;
  $('evac-exit-list').innerHTML=[...exits,...stairs].map(e=>`<li class="${e.kind}"><i aria-hidden="true"></i>${esc(e.label)}</li>`).join('')||'<li class="empty">Выходы не отмечены</li>';
  $('evac-source').innerHTML=`${esc(source)}${ev.loadError?` · <span class="evac-error">${esc(ev.loadError)}</span>`:''}`;
  $('evac-draft-note').innerHTML=draftNote;
  const keyBlock=$('evac-key-block-row');if(keyBlock)keyBlock.hidden=!plan.blocks.length;
  $('evac-edit-toggle').hidden=!(superadmin&&window.innerWidth>=1024)||ev.editing;
  renderEditor();
 }
 // Would the room have a way out if nothing were closed? Then say the way is blocked, not missing.
 function closedByZone(id){const plan=planFor(state.floor),r=floorData().rooms.find(x=>x.room_id===id);return Boolean(r&&plan.blocks.length&&EVAC.analyze({...plan,blocks:[]},state.floor).route({poly:roomPoly(r)}));}
 function stepsFor(route,down,closed=false){
  if(!route)return closed?'<p class="empty evac-closed">Обычный путь перекрыт: красная штриховка на схеме — прохода нет. Выходите к ближайшему открытому выходу по указанию учителя.</p>':'<p class="empty">Маршрут для этого помещения ещё не нарисован. Выходите к ближайшему выходу по указанию учителя.</p>';
  const stair=route.exit.kind==='stair';
  return `<div class="evac-target"><span class="evac-target-icon ${route.exit.kind}" aria-hidden="true"></span><div><small>${stair?'Лестница':'Выход'}</small><strong>${esc(route.exit.label)}</strong></div></div><ol class="evac-steps"><li>Выйдите из кабинета в коридор.</li><li>Идите по зелёным стрелкам ${stair?'к лестнице':'к выходу'} «${esc(route.exit.label)}».</li>${stair?`<li>Спуститесь на ${FLOOR_ACC[down?.floor||'1']} этаж${down?.route?` и идите к выходу «${esc(down.route.exit.label)}»`:''}.</li>`:''}</ol>`;
 }
 // What to say about the selection. It goes to the room panel (phone sheet) and, on desktop,
 // to the left side panel: nothing floats over the map and hides the arrows.
 const targetHtml=label=>`<div class="evac-target"><span class="evac-target-icon exit" aria-hidden="true"></span><div><small>Выход</small><strong>${esc(label)}</strong></div></div>`;
 function cardParts(){
  if(ev.continuation&&state.floor===ev.continuation.to){const c=ev.continuation,route=continuationRoute(),to=c.to;return {title:c.name,eyebrow:`Эвакуация · путь на ${FLOOR_PREP[to]} этаже`,body:route?`${targetHtml(route.exit.label)}<ol class="evac-steps"><li>Спуститесь по лестнице на ${FLOOR_ACC[to]} этаж.</li><li>${route.points.length<=2?`«${esc(route.exit.label)}» — сразу у лестницы.`:`Идите по зелёным стрелкам к выходу «${esc(route.exit.label)}».`}</li></ol>`:`<p class="empty">От этой лестницы на ${FLOOR_PREP[to]} этаже маршрут ещё не нарисован.</p>`,action:'<button class="secondary-button evac-action" type="button" data-evac-action="back">Вернуться к кабинету</button>',focus:route,from:null};}
  const r=floorData().rooms.find(x=>x.room_id===state.selected);
  if(!r)return {title:'Эвакуация',eyebrow:floorNames[state.floor],body:'<p class="empty">Нажмите на кабинет, чтобы увидеть, куда выходить.</p>',action:'',empty:true};
  const route=routeForRoom(r.room_id),down=downstairs(route);
  return {title:r.n,eyebrow:`Эвакуация · ${floorNames[state.floor]}`,body:stepsFor(route,down,!route&&closedByZone(r.room_id)),action:route?.exit.kind==='stair'&&state.floor!=='1'?`<button class="secondary-button evac-action" type="button" data-evac-action="continue">Показать путь на ${FLOOR_PREP[down?.floor||'1']} этаже</button>`:'',room:r,route,down,focus:route,from:roomPoly(r)};
 }
 function cardRender(){
  if(ev.continuation){if(state.floor!==ev.continuation.to)ev.continuation=null;else if(ev.continuation.anchor===undefined)ev.continuation.anchor=state.selected;else if(ev.continuation.anchor!==state.selected)ev.continuation=null;}
  refreshLayer();writeHash();
  const part=cardParts();
  $('room-card').innerHTML=`<div class="room-heading"><div class="room-title"><h2 class="${part.title.length>8?'long-title':''}">${esc(part.title)}</h2></div><p class="room-eyebrow">${esc(part.eyebrow)}</p></div>${part.body}${part.action}${noteHtml()}`;
  const side=$('evac-room');if(side){side.hidden=Boolean(part.empty);side.innerHTML=part.empty?'':`<div class="evac-room-head"><h2>${esc(part.title)}</h2><span>${esc(part.eyebrow)}</span></div>${part.body}${part.action}`;}
  for(const button of document.querySelectorAll('[data-evac-action]'))button.onclick=()=>{
   if(button.dataset.evacAction==='back'){const back=ev.continuation;if(!back)return;ev.continuation=null;changeFloor(back.floor,back.room);}
   else if(part.room&&part.route)showDownstairs(part.room,part.route,part.down);
  };
  // The route is part of the key: a published plan that loads later can change it.
  const key=`${state.floor}|${part.room?.room_id||''}|${ev.continuation?'down':''}|${part.focus?JSON.stringify(part.focus.points):''}`;
  if(key!==ev.focusKey){ev.focusKey=key;if(part.focus&&(isPhone()||ev.focusOnce)){ev.focusOnce=false;const route=part.focus,from=part.from;(window.requestAnimationFrame||(f=>setTimeout(f,16)))(()=>focusRoute(route,from));}}
  calloutRender();
 }
 const isPhone=()=>window.matchMedia?.('(max-width: 780px)').matches??window.innerWidth<=780;
 // Fit the route (and its room) into the part of the map that the bottom sheet does not cover.
 // Never closer than the map's own zoom limit, so the plan stays readable.
 function focusRoute(route,from){
  const svg=$('map'),box=svg.getBoundingClientRect?.();if(!box||!box.width||!box.height)return;
  const panel=$('room-card').closest('.panel'),pr=panel?.getBoundingClientRect?.(),bottom=pr&&pr.top>box.top+120&&pr.top<box.bottom?pr.top:box.bottom,visible=bottom-box.top;
  const pts=route.points.concat(from||[]),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),pad=48;
  const minX=Math.min(...xs)-pad,maxX=Math.max(...xs)+pad,minY=Math.min(...ys)-pad,maxY=Math.max(...ys)+pad;
  const unit=Math.max((maxX-minX)/box.width,(maxY-minY)/visible,450/box.width);
  const w=box.width*unit,h=box.height*unit,cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  state.view=[cx-w/2,cy-visible*unit/2,w,h];applyView();
 }
 const noteHtml=()=>'<p class="card-note">Схема ориентировочная. Главное — план эвакуации на этаже и указания ответственного за эвакуацию.</p>';
 function showDownstairs(r,route,down){const to=down?.floor||'1';ev.continuation={x:route.exit.x,y:route.exit.y,room:r.room_id,floor:state.floor,name:r.n,to};changeFloor(to);}
 // No floating bubble in evacuation mode: it covered the route. The side panel says the same.
 function calloutRender(){const box=$('room-callout');box.hidden=true;box.innerHTML='';}

 // ----- Mode, loading, auth -----
 function setMode(on){
  if(ev.on===on)return;ev.on=on;document.body.classList.toggle('evac-mode',on);ev.continuation=null;
  if(!on&&ev.editing)stopEditing();
  $('map-hint').textContent=on?'Нажмите на кабинет, чтобы увидеть путь к выходу':'Нажмите на кабинет, чтобы открыть расписание';
  writeHash();draw();applyView();renderCard();
 }
 function writeHash(){try{const room=ev.continuation?ev.continuation.room:state.selected,want=ev.on?`#evacuation${room?'/'+room:''}`:'';if((location.hash||'')!==want&&(ev.on||location.hash.startsWith('#evacuation')))history.replaceState(null,'',want||location.pathname+location.search);}catch(_e){}}
 async function load(){
  if(!cloud){ev.published={};ev.drafts={};ev.loadError='';if(ev.on){draw();applyView();renderCard();}return;}
  const {data,error}=await cloud.from('map_evacuation').select('floor,published,plan,revision,updated_at');
  if(error){ev.loadError=Object.keys(ev.published).length?'нет связи, показана сохранённая на устройстве схема':'не удалось загрузить опубликованную схему, показана встроенная';}else{
   ev.loadError='';ev.published={};ev.drafts={};for(const row of data||[])(row.published?ev.published:ev.drafts)[String(row.floor)]=row;writeCache(Object.fromEntries(Object.entries(ev.published).map(([f,r])=>[f,{floor:r.floor,published:true,plan:r.plan,revision:r.revision}])));
   for(const [floor,w] of Object.entries(ev.work))if(!w.dirty){const d=ev.drafts[floor];if((d?.revision??null)!==w.base){ev.work[floor]=freshWork(floor);}}
  }
  if(ev.on){draw();applyView();renderCard();}
 }
 function authChanged(){if(!superadmin){if(ev.editing)stopEditing();ev.work={};ev.drafts={};}if(ev.on)renderSide();}

 // ----- Editor (superadmin, desktop) -----
 function freshWork(floor){const d=ev.drafts[floor];return {plan:d?EVAC.clone(d.plan):publishedPlan(floor),base:d?.revision??null,dirty:false,history:[],future:[]};}
 function startEditing(){if(!superadmin)return;ev.editing=true;document.body.classList.add('evac-editing');ev.tool='arrow';ev.current=[];ev.selected=null;ev.continuation=null;setMessage('');draw();applyView();renderCard();}
 function stopEditing(){ev.editing=false;document.body.classList.remove('evac-editing');ev.current=[];ev.selected=null;ev.hover=null;if(ev.on){draw();applyView();renderCard();}}
 function ensureWork(){if(!ev.work[state.floor])ev.work[state.floor]=freshWork(state.floor);return ev.work[state.floor];}
 function remember(){const w=ensureWork();w.history.push(JSON.stringify(w.plan));if(w.history.length>100)w.history.shift();w.future=[];w.dirty=true;}
 function undo(){const w=ensureWork();if(ev.current.length){ev.current=[];refreshLayer();return;}if(!w.history.length)return;w.future.push(JSON.stringify(w.plan));w.plan=JSON.parse(w.history.pop());w.dirty=true;ev.selected=null;changed();}
 function redo(){const w=ensureWork();if(!w.future.length)return;w.history.push(JSON.stringify(w.plan));w.plan=JSON.parse(w.future.pop());w.dirty=true;changed();}
 function changed(){refreshLayer();renderSide();if(state.selected)renderCard();}
 function setMessage(text,kind=''){ev.message=text;ev.messageKind=kind;const m=$('evac-editor-message');if(m){m.className=`form-message${kind?' '+kind:''}`;m.textContent=text;}}
 function renderEditor(){
  const panel=$('evac-editor');if(!panel)return;panel.hidden=!ev.editing;document.body.dataset.evacTool=ev.editing?ev.tool:'';if(!ev.editing)return;ensureWork();
  const w=work();for(const b of panel.querySelectorAll('[data-evac-tool]')){const on=b.dataset.evacTool===ev.tool;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));}
  $('evac-finish').hidden=!(ev.tool==='arrow'&&ev.current.length>=2||ev.tool==='block'&&ev.current.length>=3);
  $('evac-finish').textContent=ev.tool==='block'?'Замкнуть зону':'Закончить стрелку';
  const sel=selectedItem();$('evac-selection').hidden=!sel;
  if(sel){$('evac-selection-title').textContent=ev.selected.type==='arrow'?'Выбрана стрелка':ev.selected.type==='block'?'Выбрана зона «нет прохода»':sel.kind==='stair'?'Выбрана лестница':'Выбран выход';$('evac-label-row').hidden=ev.selected.type!=='exit';$('evac-reverse').hidden=ev.selected.type!=='arrow';if(ev.selected.type==='exit'&&document.activeElement!==$('evac-label'))$('evac-label').value=sel.label;}
  $('evac-undo').disabled=!w.history.length&&!ev.current.length;$('evac-redo').disabled=!w.future.length;
  const crossing=w.plan.arrows.filter(a=>EVAC.arrowBlocked(a,w.plan.blocks)).length;
  const missing=state.floor==='1'?missingStairs().length:0;
  $('evac-block-note').textContent=[crossing?`Через зоны «нет прохода» идут стрелки: ${crossing}. Они подсвечены красным, по ним маршрут не строится.`:'',missing?`Лестниц с верхних этажей без знака здесь: ${missing} (синие пунктирные кружки). Поставьте на них «Лестницу» и нарисуйте от неё стрелку к выходу.`:''].filter(Boolean).join(' ');
  const dirtyFloors=Object.entries(ev.work).filter(([,x])=>x.dirty).map(([f])=>f);
  $('evac-editor-state').textContent=w.dirty?'Есть несохранённые изменения':w.base!=null?'Черновик сохранён, не опубликован':ev.published[state.floor]?'Как опубликовано':'Встроенная схема';
  $('evac-dirty-floors').textContent=dirtyFloors.filter(f=>f!==state.floor).length?`Не сохранено также: ${dirtyFloors.filter(f=>f!==state.floor).map(f=>f+' этаж').join(', ')}`:'';
  for(const id of ['evac-save','evac-publish','evac-discard'])$(id).disabled=ev.busy;
  $('evac-discard').hidden=w.base==null;
  $('evac-hint').textContent=ev.tool==='arrow'?'Кликайте по коридору по ходу движения; последняя точка — наконечник. Двойной клик или Enter — закончить, Esc — отменить. Alt — без прилипания.':ev.tool==='select'?'Тяните точку, стрелку, знак или зону, чтобы передвинуть. Двойной клик по линии — новая точка, по точке — удалить её. Delete — удалить выбранное. Alt — без прилипания.':ev.tool==='block'?'Ставьте точки по сетке вокруг места, где прохода нет. Клик по первой точке, двойной клик или Enter — замкнуть зону. Backspace — убрать точку, Esc — отменить, Alt — без сетки.':`Нажмите на карту, чтобы поставить знак. Конец стрелки должен попасть в его зелёную зону.${state.floor==='1'&&ev.tool==='stair'?' Клик по синему пунктирному кружку ставит лестницу точно туда, куда спускаются с верхних этажей.':''}`;
 }
 function selectedItem(){const s=ev.selected;if(!s||!ev.editing)return null;const plan=ensureWork().plan;return s.type==='arrow'?plan.arrows.find(a=>a.id===s.id):s.type==='block'?plan.blocks.find(z=>z.id===s.id):plan.exits.find(e=>e.id===s.id);}
 function scale(){const m=$('layer-evac')?.getScreenCTM?.();return m?Math.hypot(m.a,m.b)||1:1;}
 function mapPoint(e){const g=$('layer-evac'),svg=$('map'),m=g?.getScreenCTM?.();if(m&&svg.createSVGPoint){const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const l=p.matrixTransform(m.inverse());return [l.x,l.y];}return localPoint(e.clientX,e.clientY);}
 const round=p=>p.map(v=>Math.round(v*10)/10);
 // Snap to other arrows' points, then onto their lines, so arrows join the network.
 // Exits do not pull points in: an arrow end only has to land in the exit's zone.
 // skip = {arrow, index}: the point being dragged and its own two segments are ignored.
 function snapInfo(p,skip=null){
  const plan=ensureWork().plan,r=10/scale(),own=(a,i)=>skip&&a.id===skip.arrow&&i===skip.index,ownSeg=(a,i)=>skip&&a.id===skip.arrow&&(i===skip.index||i+1===skip.index);
  let best=null;for(const a of plan.arrows)a.pts.forEach((v,i)=>{if(own(a,i))return;const d=EVAC.dist(v,p);if(d<=r&&(!best||d<best.d))best={d,q:v};});
  for(const [x,y] of ev.current.slice(0,-1)){const d=EVAC.dist([x,y],p);if(d<=r&&(!best||d<best.d))best={d,q:[x,y]};}
  if(best)return {q:best.q.slice(),snapped:true};
  for(const a of plan.arrows)for(let i=0;i+1<a.pts.length;i++){if(ownSeg(a,i))continue;const pr=EVAC.project(p,a.pts[i],a.pts[i+1]);if(pr.d<=r&&(!best||pr.d<best.d))best=pr;}
  return best?{q:round(best.q),snapped:true}:{q:round(p),snapped:false};
 }
 const snap=(p,free=false)=>free?round(p):snapInfo(p).q;
 // skip = {block, index}: the corner being dragged.
 function gridSnap(p,skip=null){
  const plan=ensureWork().plan,r=8/scale();let best=null;
  for(const z of plan.blocks)z.pts.forEach((v,i)=>{if(skip&&z.id===skip.block&&i===skip.index)return;const d=EVAC.dist(v,p);if(d<=r&&(!best||d<best.d))best={d,q:v};});
  if(best)return best.q.slice();
  const g=EVAC.GRID;return [Math.round(p[0]/g)*g,Math.round(p[1]/g)*g];
 }
 function onSign(e,p){const dx=Math.abs(p[0]-e.x),dy=Math.abs(p[1]-e.y);return e.kind==='stair'?Math.hypot(dx,dy)<=13:dx<=23&&dy<=11;}
 // What is under the pointer: a point of the selected arrow, any arrow point, a sign, then an arrow line.
 function hitTest(p){
  const plan=ensureWork().plan,r=9/scale(),near=(a,rad)=>{let best=-1,bd=Infinity;a.pts.forEach((v,i)=>{const d=EVAC.dist(v,p);if(d<=rad&&d<bd){bd=d;best=i;}});return best;};
  const selected=ev.selected?.type==='arrow'&&plan.arrows.find(a=>a.id===ev.selected.id);
  if(selected){const i=near(selected,r*1.3);if(i>=0)return {kind:'vertex',id:selected.id,index:i};}
  for(const a of plan.arrows){const i=near(a,r);if(i>=0)return {kind:'vertex',id:a.id,index:i};}
  const selBlock=ev.selected?.type==='block'&&plan.blocks.find(z=>z.id===ev.selected.id);
  if(selBlock){const i=near(selBlock,r*1.3);if(i>=0)return {kind:'bvertex',id:selBlock.id,index:i};}
  for(let k=plan.exits.length-1;k>=0;k--)if(onSign(plan.exits[k],p))return {kind:'exit',id:plan.exits[k].id};
  let best=null;for(const a of plan.arrows)for(let i=0;i+1<a.pts.length;i++){const pr=EVAC.project(p,a.pts[i],a.pts[i+1]);if(pr.d<=r&&(!best||pr.d<best.d))best={d:pr.d,id:a.id,i,q:pr.q};}
  if(best)return {kind:'arrow',id:best.id,segment:best.i,q:best.q};
  for(let k=plan.blocks.length-1;k>=0;k--){const z=plan.blocks[k];for(let i=0;i<z.pts.length;i++){const pr=EVAC.project(p,z.pts[i],z.pts[(i+1)%z.pts.length]);if(pr.d<=r&&(!best||pr.d<best.d))best={d:pr.d,id:z.id,i,q:pr.q};}}
  if(best)return {kind:'bedge',id:best.id,segment:best.i,q:best.q};
  for(let k=plan.blocks.length-1;k>=0;k--)if(EVAC.inside(p,plan.blocks[k].pts))return {kind:'block',id:plan.blocks[k].id};
  return null;
 }
 const selectionOf=hit=>hit?{type:hit.kind==='exit'?'exit':['block','bvertex','bedge'].includes(hit.kind)?'block':'arrow',id:hit.id}:null;
 function pick(p){return selectionOf(hitTest(p));}
 function finishArrow(){const pts=ev.current.filter((p,i,a)=>i===0||EVAC.dist(p,a[i-1])>1);ev.current=[];ev.hover=null;if(pts.length>=2){if(pts.length>64)return setMessage('Слишком длинная стрелка: не больше 64 точек.','error');remember();const id=uid('a');ensureWork().plan.arrows.push({id,pts});ev.selected={type:'arrow',id};}changed();}
 function finishBlock(){const pts=ev.current.filter((p,i,a)=>i===0||EVAC.dist(p,a[i-1])>1);ev.current=[];ev.hover=null;ev.snapHint=null;
  if(pts.length>=3){if(ensureWork().plan.blocks.length>=100)return setMessage('На этаже не больше 100 зон.','error');remember();const id=uid('z');ensureWork().plan.blocks.push({id,pts});ev.selected={type:'block',id};}
  else if(pts.length>1)setMessage('Зоне нужно хотя бы три точки.','error');
  changed();}
 const finishDrawing=()=>ev.tool==='block'?finishBlock():finishArrow();
 function deleteSelected(){const s=ev.selected;if(!s)return;remember();const plan=ensureWork().plan;if(s.type==='arrow')plan.arrows=plan.arrows.filter(a=>a.id!==s.id);else if(s.type==='block')plan.blocks=plan.blocks.filter(z=>z.id!==s.id);else plan.exits=plan.exits.filter(e=>e.id!==s.id);ev.selected=null;changed();}
 function reverseSelected(){const a=selectedItem();if(!a||ev.selected.type!=='arrow')return;remember();a.pts.reverse();changed();}
 function onMapClick(e){
  if(!ev.on||!ev.editing)return;
  if(ev.swallowClick){ev.swallowClick=false;e.stopPropagation();e.preventDefault();return;}
  if(state.suppressClick)return;
  e.stopPropagation();e.preventDefault();
  const p=mapPoint(e),plan=ensureWork().plan;
  if(ev.tool==='arrow'){if(ev.current.length>=64)return setMessage('Слишком длинная стрелка: не больше 64 точек.','error');ev.current.push(snap(p,e.altKey));ev.hover=null;ev.snapHint=null;refreshLayer();renderEditor();return;}
  if(ev.tool==='block'){
   if(e.detail>1)return; // the second click of a double click: the double click itself closes the zone
   const q=e.altKey?round(p):gridSnap(p);
   // A click on the first corner closes the zone.
   if(ev.current.length>=3&&EVAC.dist(q,ev.current[0])<=8/scale()){finishBlock();return;}
   if(ev.current.length>=64)return setMessage('Не больше 64 точек в зоне.','error');
   ev.current.push(q);ev.hover=null;refreshLayer();renderEditor();return;}
  if(ev.tool==='exit'||ev.tool==='stair'){if(plan.exits.length>=60)return setMessage('На этаже не больше 60 знаков.','error');remember();const ghost=ev.tool==='stair'&&state.floor==='1'?missingStairs().find(g=>EVAC.dist([g.x,g.y],p)<=18):null,q=ghost?[ghost.x,ghost.y]:round(p),item={id:uid('e'),x:q[0],y:q[1],kind:ev.tool,label:autoLabel(ev.tool,q)};plan.exits.push(item);ev.selected={type:'exit',id:item.id};changed();return;}
  ev.selected=pick(p);refreshLayer();renderEditor();
 }
 function onMapDblClick(e){
  if(!ev.on||!ev.editing)return;e.stopPropagation();e.preventDefault();
  if(ev.tool==='arrow'){finishArrow();return;}
  if(ev.tool==='block'){finishBlock();return;}
  if(ev.tool!=='select')return;
  const hit=hitTest(mapPoint(e));
  if(hit&&(hit.kind==='bvertex'||hit.kind==='bedge')){const z=ensureWork().plan.blocks.find(x=>x.id===hit.id);if(!z)return;ev.selected={type:'block',id:z.id};
   if(hit.kind==='bvertex'){if(z.pts.length<=3){setMessage('У зоны должно быть хотя бы три точки. Удалить зону — кнопка «Удалить».','error');return;}remember();z.pts.splice(hit.index,1);changed();return;}
   if(z.pts.length>=64){setMessage('Не больше 64 точек в зоне.','error');return;}
   remember();z.pts.splice(hit.segment+1,0,gridSnap(hit.q));changed();return;}
  const a=hit&&['vertex','arrow'].includes(hit.kind)&&ensureWork().plan.arrows.find(x=>x.id===hit.id);if(!a)return;
  ev.selected={type:'arrow',id:a.id};
  if(hit.kind==='vertex'){if(a.pts.length<=2){setMessage('У стрелки должно быть хотя бы две точки. Удалить стрелку — кнопка «Удалить».','error');return;}remember();a.pts.splice(hit.index,1);changed();return;}
  if(a.pts.length>=64){setMessage('Не больше 64 точек в стрелке.','error');return;}
  remember();a.pts.splice(hit.segment+1,0,round(hit.q));changed();
 }
 // Dragging in the "Править" tool: a point, a whole arrow or a sign. Pans the map when nothing is hit.
 let frame=0;
 const scheduleRefresh=()=>{if(frame)return;frame=(window.requestAnimationFrame||(f=>setTimeout(f,16)))(()=>{frame=0;refreshLayer();});};
 function onPointerDown(e){
  if(!ev.on||!ev.editing||ev.tool!=='select'||e.button!==0)return;
  const p=mapPoint(e),hit=hitTest(p);if(!hit)return;
  e.stopImmediatePropagation();e.preventDefault();
  ev.selected=selectionOf(hit);
  ev.drag={...hit,start:p,orig:JSON.parse(JSON.stringify(ensureWork().plan)),moved:false,pointer:e.pointerId,sx:e.clientX,sy:e.clientY};
  try{$('map').setPointerCapture?.(e.pointerId);}catch(_e){}
  $('map').classList.add('evac-dragging');refreshLayer();renderEditor();
 }
 function onDragMove(e){
  const d=ev.drag;if(!d||e.pointerId!==d.pointer)return;
  if(!d.moved){if(Math.hypot(e.clientX-d.sx,e.clientY-d.sy)<3)return;d.moved=true;remember();}
  const p=mapPoint(e),plan=ensureWork().plan;
  if(d.kind==='vertex'){const a=plan.arrows.find(x=>x.id===d.id);if(!a)return;const info=e.altKey?{q:round(p),snapped:false}:snapInfo(p,{arrow:d.id,index:d.index});a.pts[d.index]=info.q;ev.snapHint=info.snapped?info.q:null;}
  else if(d.kind==='bvertex'){const z=plan.blocks.find(x=>x.id===d.id);if(!z)return;const q=e.altKey?round(p):gridSnap(p,{block:d.id,index:d.index});z.pts[d.index]=q;ev.snapHint=q;}
  else if(d.kind==='block'||d.kind==='bedge'){const z=plan.blocks.find(x=>x.id===d.id),o=d.orig.blocks.find(x=>x.id===d.id);if(z&&o){const g=e.altKey?0.1:EVAC.GRID,dx=Math.round((p[0]-d.start[0])/g)*g,dy=Math.round((p[1]-d.start[1])/g)*g;z.pts=o.pts.map(([x,y])=>round([x+dx,y+dy]));}}
  else if(d.kind==='exit'){const m=plan.exits.find(x=>x.id===d.id),o=d.orig.exits.find(x=>x.id===d.id);if(m&&o){[m.x,m.y]=round([o.x+p[0]-d.start[0],o.y+p[1]-d.start[1]]);}}
  else{const a=plan.arrows.find(x=>x.id===d.id),o=d.orig.arrows.find(x=>x.id===d.id);if(a&&o)a.pts=o.pts.map(([x,y])=>round([x+p[0]-d.start[0],y+p[1]-d.start[1]]));}
  scheduleRefresh();
 }
 function onDragEnd(e){
  const d=ev.drag;if(!d||(e.pointerId!==undefined&&e.pointerId!==d.pointer))return;
  ev.drag=null;ev.snapHint=null;$('map').classList.remove('evac-dragging');
  if(d.moved){ev.swallowClick=true;changed();}else refreshLayer();
 }
 function onMapMove(e){
  if(!ev.on||!ev.editing||ev.drag||(ev.tool!=='arrow'&&ev.tool!=='block'))return;
  const info=ev.tool==='block'?{q:e.altKey?round(mapPoint(e)):gridSnap(mapPoint(e)),snapped:!e.altKey}:e.altKey?{q:round(mapPoint(e)),snapped:false}:snapInfo(mapPoint(e)),dot=$('evac-snap');
  if(dot){dot.toggleAttribute('hidden',!info.snapped);if(info.snapped){dot.setAttribute('cx',info.q[0]);dot.setAttribute('cy',info.q[1]);}}
  if(!ev.current.length)return;ev.hover=info.q;const rubber=$('evac-rubber');if(rubber)rubber.setAttribute('points',points(ev.tool==='block'?[ev.current[ev.current.length-1],ev.hover,ev.current[0]]:[ev.current[ev.current.length-1],ev.hover]));
 }
 function onKey(e){
  if(!ev.on||!ev.editing||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
  if(e.key==='Enter'&&ev.current.length){e.preventDefault();finishDrawing();return;}
  if(e.key==='Escape'&&(ev.current.length||ev.selected)){e.preventDefault();e.stopPropagation();ev.current=[];ev.selected=null;refreshLayer();renderEditor();return;}
  if(e.key==='Backspace'&&ev.current.length){e.preventDefault();ev.current.pop();refreshLayer();renderEditor();return;}
  if((e.key==='Delete'||e.key==='Backspace')&&ev.selected){e.preventDefault();deleteSelected();}
 }
 const stale=error=>/map_evacuation_stale/.test(error?.message||'');
 async function save(){
  const w=ensureWork(),floor=state.floor;ev.busy=true;renderEditor();setMessage('Сохраняем черновик…');
  try{const {data,error}=await cloud.rpc('save_map_evacuation_draft',{p_floor:Number(floor),p_plan:EVAC.forServer(w.plan),p_base_revision:w.base});
   if(error){setMessage(stale(error)?'Черновик этого этажа уже изменили в другом окне. Обновите страницу, чтобы не затереть чужие правки.':/Invalid evacuation plan/.test(error.message||'')&&w.plan.blocks.length?'База ещё не знает о зонах «нет прохода»: нужно применить миграцию map-evacuation-blocks. Пока сохранить можно только без зон.':`Не удалось сохранить: ${error.message}`,'error');return false;}
   w.base=Number(data);w.dirty=false;ev.drafts[floor]={floor:Number(floor),published:false,plan:EVAC.clone(w.plan),revision:w.base};setMessage('Черновик сохранён. Его видят только суперадмины.','success');return true;}
  finally{ev.busy=false;renderSide();}
 }
 async function publish(){
  const w=ensureWork(),floor=state.floor;
  if(w.dirty||w.base==null){if(!await save())return;}
  ev.busy=true;renderEditor();setMessage('Публикуем…');
  try{const {error}=await cloud.rpc('publish_map_evacuation',{p_floor:Number(floor),p_revision:w.base});
   if(error){setMessage(stale(error)?'Черновик изменился, пока вы его публиковали. Обновите страницу и проверьте его.':`Не удалось опубликовать: ${error.message}`,'error');return;}
   delete ev.work[floor];await load();ensureWork();setMessage(`Маршруты: ${floorNames[floor].toLowerCase()} опубликован для всех.`,'success');}
  finally{ev.busy=false;renderSide();}
 }
 async function discard(){
  const w=ensureWork(),floor=state.floor;if(w.base==null)return;if(!window.confirm('Удалить черновик этого этажа и вернуться к опубликованной схеме?'))return;
  ev.busy=true;renderEditor();
  try{const {error}=await cloud.rpc('discard_map_evacuation_draft',{p_floor:Number(floor)});if(error){setMessage(`Не удалось удалить черновик: ${error.message}`,'error');return;}
   delete ev.work[floor];await load();ensureWork();ev.selected=null;setMessage('Черновик удалён.','success');}
  finally{ev.busy=false;changed();}
 }

 $('map').addEventListener('click',onMapClick,true);
 $('map').addEventListener('pointerdown',onPointerDown,true);
 window.addEventListener('pointermove',onDragMove);
 window.addEventListener('pointerup',onDragEnd);
 window.addEventListener('pointercancel',onDragEnd);
 $('map').addEventListener('dblclick',onMapDblClick,true);
 $('map').addEventListener('pointermove',onMapMove);
 document.addEventListener('keydown',onKey);
 window.addEventListener('beforeunload',e=>{if(Object.values(ev.work).some(w=>w.dirty)){e.preventDefault();e.returnValue='';}});
 window.addEventListener('resize',()=>{if(ev.on)renderSide();});
 $('evac-edit-toggle').onclick=startEditing;
 $('evac-editor-close').onclick=()=>{if(Object.values(ev.work).some(w=>w.dirty)&&!window.confirm('Есть несохранённые изменения. Закрыть редактор? Они останутся до перезагрузки страницы.'))return;stopEditing();};
 for(const b of document.querySelectorAll('[data-evac-tool]'))b.onclick=()=>{ev.tool=b.dataset.evacTool;ev.current=[];ev.hover=null;if(ev.tool!=='select')ev.selected=null;refreshLayer();renderEditor();};
 $('evac-finish').onclick=finishDrawing;$('evac-undo').onclick=undo;$('evac-redo').onclick=redo;
 $('evac-delete').onclick=deleteSelected;$('evac-reverse').onclick=reverseSelected;
 let labelRemembered=false;
 $('evac-label').onfocus=()=>{labelRemembered=false;};
 $('evac-label').oninput=()=>{const item=selectedItem();if(item&&ev.selected.type==='exit'){if(!labelRemembered){remember();labelRemembered=true;}item.label=$('evac-label').value.slice(0,80);ensureWork().dirty=true;refreshLayer();renderSide();}};
 $('evac-label').onblur=()=>{const item=selectedItem();if(item&&ev.selected.type==='exit'&&!item.label.trim()){item.label=autoLabel(item.kind,[item.x,item.y]);changed();}};
 $('evac-save').onclick=()=>save();$('evac-publish').onclick=publish;$('evac-discard').onclick=discard;
 return {setMode,layer,afterDraw,renderCard:cardRender,renderCallout:calloutRender,load,authChanged,writeHash,get state(){return ev;}};
})();
// Deep link for QR codes on doors: #evacuation or #evacuation/<room_id>.
if(evac&&typeof location!=='undefined'&&/^#evacuation(\/|$)/.test(location.hash||'')){const id=decodeURIComponent(location.hash.split('/')[1]||'');if(id&&roomFloors(id).length){evac.state.focusOnce=true;select(id);}document.getElementById('evacuation-tab').click();}

(function(){const admin=window.quantumDemo.mode==='admin';document.getElementById(admin?'demo-as-admin':'demo-as-teacher').setAttribute('aria-current','page');document.getElementById('demo-reset').onclick=()=>{if(window.confirm('Вернуть демо к исходным данным? Ваши брони и правки удалятся.'))window.quantumDemo.reset();};})();