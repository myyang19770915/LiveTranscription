// Floating subtitles (live-translation): an always-on-top Document Picture-in-Picture window showing the recent
// finalized segments (each its source, when 原文 is on, above its translation; the newest at the bottom, as many as the
// window has room for) and then the speech being translated now with its draft. app.js keeps it in step through Subtitles.update(); the user's choices (source shown,
// text size) live in localStorage. Without the API (Firefox, Safari, phones) the button is disabled and says why.
// The list hugs the bottom of the window and glides to its new place when text makes it taller (smooth-subtitles):
// nothing already shown jumps a line at once.
window.Subtitles=(()=>{
  const KEY='subtitles',SIZES=4;
  let win=null,latest={done:'',pending:'',translation:'',draft:'',history:[]},settings=load();
  function load(){
    try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');return {source:s.source===true,size:Math.min(SIZES,Math.max(1,Number(s.size)||2))}}
    catch{return {source:false,size:2}}
  }
  function save(){try{localStorage.setItem(KEY,JSON.stringify(settings))}catch{}}
  // The source toggle and text size are shared with 畫面＋字幕 (overlay.js): either side changes them, both redraw.
  const getSettings=()=>({...settings});
  function setSettings(partial){const size=partial.size===undefined?settings.size:Number(partial.size);settings={...settings,...partial,size:Math.min(SIZES,Math.max(1,Number.isFinite(size)?size:2))};save();render();window.Overlay?.refresh()}
  // Sentences of a text: split at 。！？!?. and line breaks (3.5, U.S. stay whole); lastSentences joins the last n back,
  // Chinese/Japanese sentences without a space.
  const sentences=text=>(text||'').split(/(?<=[。！？])\s*|(?<=[!?.])(?:\s+|$)|\n+/).map(s=>s.trim()).filter(Boolean);
  const joinSentences=parts=>parts.join(parts.some(p=>/[぀-ヿ㐀-鿿]/.test(p))?'':' ');
  const lastSentences=(text,n)=>joinSentences(sentences(text).slice(-n));
  const supported=()=>'documentPictureInPicture' in window;
  // The blocks of a list (the floating window's, the overlay's areas) that is about to get new text: call
  // glide(blocks) before changing it and the returned function after. Every block that is at another place afterwards
  // starts where it was on screen and moves to its new place in about GLIDE_MS (longer for a longer way, so it never
  // rushes), instead of jumping there. settle(limit, heirs): heirs are [new block, old block] pairs, a new block that
  // starts where the old one was (a finalized segment where its draft was). A block marked
  // data-clip holds text that grows (the speech now, the draft): it is a frame that cuts off what is outside it, and
  // its one child is the text. When the text gets a new line, the lines already shown glide up inside the frame and
  // the new line comes in from below; blocks under it stay where they are.
  const GLIDE_MS=250;
  function glide(blocks){
    const view=blocks[0]?.ownerDocument.defaultView;
    if(!view||view.matchMedia('(prefers-reduced-motion: reduce)').matches)return ()=>{};
    const place=el=>el.getBoundingClientRect(),inner=block=>block.dataset.clip?block.firstElementChild:null;
    const before=blocks.map(block=>({block,top:place(block).top,bottom:place(block).bottom,text:inner(block)&&place(inner(block)).top,shown:block.getClientRects().length>0}));
    return (limit,heirs=[])=>{
      const moves=[];
      for(const {block,top,bottom,text,shown} of before){
        const child=inner(block);
        for(const el of [block,child])if(el){el.style.transition='none';el.style.transform='none'}
        if(!block.isConnected||!shown||!block.getClientRects().length)continue;
        const now=place(block),by=child?bottom-now.bottom:top-now.top;   // a frame moves with its lower edge
        if(Math.abs(by)>.5)moves.push([block,by]);
        if(child){const inside=text-place(child).top-by;if(Math.abs(inside)>.5)moves.push([child,inside])}
      }
      for(const [born,old] of heirs){
        const was=before.find(entry=>entry.block===old);
        if(was?.shown&&born.getClientRects().length&&Math.abs(was.bottom-place(born).bottom)>.5)moves.push([born,was.bottom-place(born).bottom]);
      }
      // More than the list's frame holds (a setting changed): at once.
      if(!moves.length||moves.some(([,by])=>Math.abs(by)>limit))return;
      for(const [el,by] of moves)el.style.transform=`translateY(${by}px)`;
      void blocks[0].ownerDocument.body.offsetHeight;   // the browser takes this as the starting point
      // One duration for all of them, from the longest way, so blocks that move together stay together.
      const ms=Math.min(700,Math.max(GLIDE_MS,Math.max(...moves.map(([,by])=>Math.abs(by)))*6));
      for(const [el] of moves){el.style.transition=`transform ${ms}ms ease-out`;el.style.transform='translateY(0)'}
    };
  }
  const setText=(el,text)=>{if(el.textContent!==text)el.textContent=text};
  // How much of a draft is settled, as a length: the next draft usually rewrites its end. What differs from the draft
  // before it is unsettled, and never fewer than the last 4 characters or more than the last 12 (Chinese, Japanese);
  // for text in words the last 2 to 5 words.
  function solid(before,text){
    let same=0;
    while(same<text.length&&same<(before||'').length&&text[same]===before[same])same++;
    if(/[\u3040-\u30ff\u3400-\u9fff]/.test(text))return Math.max(0,text.length-Math.min(12,Math.max(4,text.length-same)));
    const starts=[...text.matchAll(/\S+/g)].map(word=>word.index),changed=starts.filter(at=>at+1>same||at===starts.findLast(start=>start<=same)).length;
    return starts.at(-Math.min(5,Math.max(2,changed)))??0;
  }
  // A draft in `el`: its settled part, then its unsettled end in a lighter span.
  function setDraft(el,text,settled){
    const at=Math.min(text.length,Math.max(0,settled??text.length)),head=text.slice(0,at),tail=text.slice(at);
    if(el.firstChild?.nodeType!==3||el.childNodes.length!==2){el.replaceChildren(el.ownerDocument.createTextNode(''),Object.assign(el.ownerDocument.createElement('span'),{className:'unsure'}))}
    if(el.firstChild.data!==head)el.firstChild.data=head;
    setText(el.lastChild,tail);
  }
  // After fill(): which new block takes whose place. `was` are the list's blocks before; a new block stands for the
  // block that left (text that was replaced, in order), and one more than left is the segment finalized just now,
  // which starts where its draft was. Blocks that left at the top, before the first one that stayed, were only the
  // oldest going out of the list: nothing takes their place.
  function heirs(was,parent,draft){
    const first=was.findIndex(el=>el.isConnected),gone=was.filter((el,i)=>!el.isConnected&&(first<0||i>first));
    return [...parent.children].filter(el=>!was.includes(el)).map((el,i)=>[el,gone[i]||draft]);
  }
  // The children of `parent` become one element per item. An item keeps its element (found by key(item)) from one
  // call to the next, so glide() can tell where it was; items with the same key keep theirs in order.
  function fill(parent,items,key,make,apply){
    const old=new Map();
    for(const el of parent.children)(old.get(el.dataset.key)||old.set(el.dataset.key,[]).get(el.dataset.key)).push(el);
    const kept=new Set();
    items.forEach((item,i)=>{
      const k=key(item),el=old.get(k)?.shift()||Object.assign(make(),{});
      el.dataset.key=k;kept.add(el);
      if(parent.children[i]!==el)parent.insertBefore(el,parent.children[i]||null);
      apply(el,item,i);
    });
    for(const el of [...parent.children])if(!kept.has(el))el.remove();
  }
  const button=()=>document.getElementById('subtitles');
  function render(){
    if(!win)return;
    const d=win.document;
    d.documentElement.dataset.theme=document.documentElement.dataset.theme||'dark';
    d.body.dataset.size=String(settings.size);
    const list=d.querySelector('.sub-history'),was=[...list.children],settle=glide([...list.children,d.querySelector('.sub-now'),d.querySelector('.sub-draft')]);
    // Finalized segments, oldest first; all but the last two are dimmed so the newest stand out.
    const history=latest.history||[];
    fill(list,history,segment=>`${segment.source||''}\n${segment.target}`,()=>{
      const block=d.createElement('div');
      for(const name of ['sub-source','sub-text']){const p=d.createElement('p');p.className=name;block.append(p)}
      return block;
    },(block,segment,i)=>{
      const name=`sub-seg${i<history.length-2?' old':''}`,source=settings.source?segment.source||'':'';
      if(block.className!==name)block.className=name;
      setText(block.firstElementChild,source);block.firstElementChild.hidden=!source;
      setText(block.lastElementChild,segment.target);
    });
    // Then the speech being translated now (原文 on) and its draft, in the highlight colour. The speech is shown whole
    // in at most two lines with its end in view, so it only grows at its end while a segment is spoken.
    const now=d.querySelector('.sub-now'),draft=d.querySelector('.sub-draft');
    // Both keep a line while anything is shown: the segments above then move when a segment is finalized (up),
    // and not each time the speech or its draft appears or goes.
    setText(now.firstElementChild,(latest.pending||'').trim());setDraft(draft.firstElementChild,latest.draft||'',latest.draftSolid);
    const any=Boolean(history.length||draft.textContent||(settings.source&&now.textContent));
    now.hidden=!settings.source||!any;draft.hidden=!any;
    d.querySelector('.sub-toggle-source').setAttribute('aria-pressed',String(settings.source));
    d.querySelector('.sub-empty').hidden=any;
    settle(d.querySelector('.sub-body').clientHeight,heirs(was,list,draft));
  }
  async function open(){
    if(win)return;
    const opened=await documentPictureInPicture.requestWindow({width:760,height:260});
    win=opened;
    const d=opened.document;
    d.documentElement.lang='zh-Hant';
    d.title='語橋 Live 字幕';
    for(const href of ['/assets/tokens.css?v=20261115d','/assets/subtitles.css?v=20261115c']){const link=d.createElement('link');link.rel='stylesheet';link.href=href;d.head.append(link)}
    d.body.innerHTML='<div class="sub-bar"><button type="button" class="sub-toggle-source" aria-pressed="false" title="顯示原文">原文</button>'
      +'<button type="button" class="sub-smaller" title="縮小字">A−</button><button type="button" class="sub-bigger" title="放大字">A+</button>'
      +'<span class="sub-title">語橋 Live 字幕</span><button type="button" class="sub-close" title="關閉字幕視窗">✕</button></div>'
      +'<div class="sub-body"><div class="sub-roll"><div class="sub-history"></div><div class="sub-current"><p class="sub-now" data-clip="1" hidden><span></span></p><p class="sub-draft" data-clip="1" hidden><span></span></p></div></div><p class="sub-empty">等待語音…</p></div>';
    d.querySelector('.sub-toggle-source').onclick=()=>setSettings({source:!settings.source});
    d.querySelector('.sub-bigger').onclick=()=>setSettings({size:settings.size+1});
    d.querySelector('.sub-smaller').onclick=()=>setSettings({size:settings.size-1});
    d.querySelector('.sub-close').onclick=()=>opened.close();
    opened.addEventListener('pagehide',()=>{if(win===opened){win=null;button()?.setAttribute('aria-pressed','false')}});
    button()?.setAttribute('aria-pressed','true');
    render();
  }
  function close(){win?.close()}
  // Without a history (a caller that sends only the latest translation), that translation is the one segment shown.
  function update(next){
    latest={...latest,...next};
    if(next.history===undefined&&next.translation!==undefined)latest.history=next.translation?[{source:latest.done||'',target:next.translation}]:[];
    render();
  }
  function init(){
    const b=button();
    if(!b)return;
    if(!supported()){b.disabled=true;b.title='需要桌面版 Chrome 或 Edge 116 以上';return}
    b.onclick=()=>{if(win)close();else open().catch(error=>{win=null;b.setAttribute('aria-pressed','false');window.toast?.(error.message||'無法開啟字幕視窗')})};
  }
  init();
  return {open,close,update,lastSentences,sentences,joinSentences,supported,getSettings,setSettings,glide,fill,setText,heirs,solid,setDraft};
})();
