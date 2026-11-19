/* Meeting setup: offer the terms of earlier meetings of the chosen series, or of the same topic (meeting-terms).
   Nothing is filled until the member chooses 帶入上次的名詞; what is already typed stays first. */
(function(){
  const $=id=>document.getElementById(id);
  const MAX=1000;
  let offered='',ticket=0,typing=null;

  function entries(text){
    return text.split(/[,，、;；\n]+/).map(raw=>{
      const [term,...rest]=raw.split('=');
      return {term:term.trim(),aliases:rest.join('=').split(/[/／|｜]/).map(a=>a.trim()).filter(Boolean)};
    }).filter(e=>e.term&&e.term.length<=40);
  }
  const joined=list=>list.map(e=>e.term+(e.aliases.length?'='+e.aliases.join('/'):'')).join('、');
  // What is typed stays exactly as it is; each earlier term not in it yet is added after it while the whole fits in MAX.
  function merged(typed,earlier){
    const known=new Set(entries(typed).map(e=>e.term));
    let text=typed.replace(/[\s、,，;；]+$/,'');
    for(const e of entries(earlier)){
      if(known.has(e.term))continue;
      const next=text?`${text}、${joined([e])}`:joined([e]);
      if(next.length>MAX)break;
      text=next;known.add(e.term);
    }
    return text;
  }

  function show(){
    const button=$('earlierTerms');
    const count=entries(offered).length;
    const typed=$('context').value;
    button.hidden=!count||$('context').disabled||merged(typed,offered)===typed.replace(/[\s、,，;；]+$/,'');
    button.textContent=`帶入上次的名詞（${count} 個）`;
    button.title=offered.replaceAll('、','、 ');
  }
  async function refresh(){
    const team=$('team')?.value,series=window.MeetingSeries?.seriesId(),title=$('topic')?.value.trim()||'';
    const mine=++ticket;
    offered='';show();
    if(!team||(!series&&!title))return;
    const query=series?`series_id=${series}`:`title=${encodeURIComponent(title)}`;
    try{
      const response=await fetch(`/api/teams/${team}/terms?${query}`);
      const data=response.ok?await response.json():{glossary:''};
      if(mine!==ticket)return;
      offered=data.glossary||'';show();
    }catch{}
  }

  $('earlierTerms').onclick=()=>{
    $('context').value=merged($('context').value,offered).slice(0,MAX);
    $('context').dispatchEvent(new Event('input',{bubbles:true}));
    show();$('context').focus();
  };
  $('context').addEventListener('input',show);
  document.addEventListener('series-changed',refresh);
  $('team')?.addEventListener('change',refresh);
  $('topic')?.addEventListener('input',()=>{if(window.MeetingSeries?.seriesId())return;clearTimeout(typing);typing=setTimeout(refresh,600)});
  // Hidden while a meeting runs (app.js disables 會議情境 then).
  new MutationObserver(show).observe($('context'),{attributes:true,attributeFilter:['disabled']});
  window.EarlierTerms={refresh,merged};
})();
