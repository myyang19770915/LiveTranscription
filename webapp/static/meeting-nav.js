/* The two views of one meeting — 逐字稿校對 (/meetings/<id>) and 會議紀要 (/meetings/<id>/minutes) — share this
   header: the same back link, title, meta line and tab strip, so switching tabs only swaps the content below.
   A tab switch replaces the history entry, so the browser's back button and 返回會議紀錄 both go to the list. */
(function(){
  const $=id=>document.getElementById(id);
  const parts=location.pathname.split('/').filter(Boolean);
  const meetingId=parts[1],view=parts[2]==='minutes'?'minutes':'review';
  const LIST_KEY='yq-meeting-list',CACHE_KEY=`yq-meeting:${meetingId}`;
  const LANG={zh:'中文',en:'英文',ja:'日文',zh_ja:'中日雙向',auto:'中英自動',ko:'韓文',yue:'粵語',id:'印尼文'};
  const VIEW_NAME={review:'逐字稿校對',minutes:'會議紀要'};
  const pad=n=>String(n).padStart(2,'0');
  const clock=ms=>{const s=Math.floor(ms/1000);return `${pad(Math.floor(s/60))}:${pad(s%60)}`};
  const store={get(key){try{return sessionStorage.getItem(key)}catch{return null}},set(key,value){try{sessionStorage.setItem(key,value)}catch{}}};

  // Tabs: hrefs for middle-click; a plain click replaces this entry instead of stacking a new one.
  const tabs={review:$('tabReview'),minutes:$('tabMinutes')};
  tabs.review.href=`/meetings/${meetingId}`;tabs.minutes.href=`/meetings/${meetingId}/minutes`;
  tabs[view].setAttribute('aria-current','page');
  for(const tab of Object.values(tabs))tab.addEventListener('click',event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    if(tab.getAttribute('aria-current')!=='page')location.replace(tab.href);
  });

  // Back: the list as the user left it (filters live in its address). Arriving from the list remembers it;
  // when the entry right before this one is that list, going back also restores its scroll position.
  try{
    const from=document.referrer&&new URL(document.referrer);
    if(from&&from.origin===location.origin&&from.pathname==='/meetings')store.set(LIST_KEY,from.href);
  }catch{}
  const back=$('back');
  back.href=store.get(LIST_KEY)||'/meetings';
  back.addEventListener('click',event=>{
    try{
      const nav=window.navigation,i=nav?.currentEntry?.index;
      if(i>0&&new URL(nav.entries()[i-1].url).pathname==='/meetings'){event.preventDefault();nav.back()}
    }catch{}
  });

  // Title and meta: drawn from the last visit at once (no flash on a tab switch), then from the server.
  function show(meeting){
    const title=window.MeetingCatalog.displayTitle(meeting);
    const source=meeting.sourceLanguage||meeting.language,target=meeting.targetLanguage;
    const meta=[meeting.series?`${meeting.team} · ${meeting.series}`:meeting.team,new Date(meeting.startedAt).toLocaleString('zh-TW',{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),
      meeting.hasRecording?`錄音 ${clock(meeting.durationMs)}`:'沒有錄音',
      source==='zh_ja'?'中日雙向':target==='none'?`${LANG[source]||source||''}・不翻譯`:`${LANG[source]||source||''} → ${LANG[target]||target||''}`,`建立者 ${meeting.createdBy}`];
    draw(title,meta);
    store.set(CACHE_KEY,JSON.stringify({title,meta}));
  }
  function draw(title,meta){
    $('title').textContent=title;document.title=`${title} · ${VIEW_NAME[view]} — 語橋 Live`;
    $('meta').replaceChildren(...meta.map((text,i)=>Object.assign(document.createElement('span'),{className:i?'':'count',textContent:text})));
  }
  try{const cached=JSON.parse(store.get(CACHE_KEY));if(cached)draw(cached.title,cached.meta)}catch{}

  window.MeetingNav={meetingId,show,clock,LANG};
})();
