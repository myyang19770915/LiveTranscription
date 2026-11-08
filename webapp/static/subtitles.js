// Floating subtitles (live-translation): an always-on-top Document Picture-in-Picture window showing the last translated
// sentences and the current draft. app.js keeps it in step through Subtitles.update(); the user's choices (source shown,
// text size) live in localStorage. Without the API (Firefox, Safari, phones) the button is disabled and says why.
window.Subtitles=(()=>{
  const KEY='subtitles',SIZES=4;
  let win=null,latest={done:'',pending:'',translation:'',draft:''},settings=load();
  function load(){
    try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');return {source:s.source===true,size:Math.min(SIZES,Math.max(1,Number(s.size)||2))}}
    catch{return {source:false,size:2}}
  }
  function save(){try{localStorage.setItem(KEY,JSON.stringify(settings))}catch{}}
  // The source toggle and text size are shared with 畫面＋字幕 (overlay.js): either side changes them, both redraw.
  const getSettings=()=>({...settings});
  function setSettings(partial){const size=partial.size===undefined?settings.size:Number(partial.size);settings={...settings,...partial,size:Math.min(SIZES,Math.max(1,Number.isFinite(size)?size:2))};save();render();window.Overlay?.refresh()}
  // The last n sentences of a text: split at 。！？!?. and line breaks; Chinese/Japanese sentences join without a space.
  function lastSentences(text,n){
    const parts=(text||'').split(/(?<=[。！？])\s*|(?<=[!?.])(?:\s+|$)|\n+/).map(s=>s.trim()).filter(Boolean).slice(-n);   // 3.5, U.S. stay whole
    return parts.join(parts.some(p=>/[぀-ヿ㐀-鿿]/.test(p))?'':' ');
  }
  const supported=()=>'documentPictureInPicture' in window;
  const button=()=>document.getElementById('subtitles');
  function render(){
    if(!win)return;
    const d=win.document;
    d.documentElement.dataset.theme=document.documentElement.dataset.theme||'dark';
    d.body.dataset.size=String(settings.size);
    const source=d.querySelector('.sub-source'),text=d.querySelector('.sub-text'),draft=d.querySelector('.sub-draft');
    // The source line: the previous finalized segment (即時翻譯) or sentence (開會), then the speech being translated now.
    source.querySelector('.sub-done').textContent=(latest.done||'').trim();source.querySelector('.sub-now').textContent=lastSentences(latest.pending,2);
    source.hidden=!settings.source||!source.textContent.trim();
    text.textContent=(latest.translation||'').trim();   // app.js already sends the last two finalized segments
    draft.textContent=latest.draft||'';draft.hidden=!latest.draft;
    d.querySelector('.sub-toggle-source').setAttribute('aria-pressed',String(settings.source));
    d.querySelector('.sub-empty').hidden=Boolean(text.textContent||draft.textContent);
    const body=d.querySelector('.sub-body');body.scrollTop=body.scrollHeight;   // the newest words stay in view
  }
  async function open(){
    if(win)return;
    const opened=await documentPictureInPicture.requestWindow({width:760,height:180});
    win=opened;
    const d=opened.document;
    d.documentElement.lang='zh-Hant';
    d.title='語橋 Live 字幕';
    for(const href of ['/assets/tokens.css?v=20261108d','/assets/subtitles.css?v=20261108c']){const link=d.createElement('link');link.rel='stylesheet';link.href=href;d.head.append(link)}
    d.body.innerHTML='<div class="sub-bar"><button type="button" class="sub-toggle-source" aria-pressed="false" title="顯示原文：上一段與正在講的">原文</button>'
      +'<button type="button" class="sub-smaller" title="縮小字">A−</button><button type="button" class="sub-bigger" title="放大字">A+</button>'
      +'<span class="sub-title">語橋 Live 字幕</span><button type="button" class="sub-close" title="關閉字幕視窗">✕</button></div>'
      +'<div class="sub-body"><p class="sub-source" hidden><span class="sub-done"></span> <span class="sub-now"></span></p><p class="sub-text"></p><p class="sub-draft" hidden></p><p class="sub-empty">等待語音…</p></div>';
    d.querySelector('.sub-toggle-source').onclick=()=>setSettings({source:!settings.source});
    d.querySelector('.sub-bigger').onclick=()=>setSettings({size:settings.size+1});
    d.querySelector('.sub-smaller').onclick=()=>setSettings({size:settings.size-1});
    d.querySelector('.sub-close').onclick=()=>opened.close();
    opened.addEventListener('pagehide',()=>{if(win===opened){win=null;button()?.setAttribute('aria-pressed','false')}});
    button()?.setAttribute('aria-pressed','true');
    render();
  }
  function close(){win?.close()}
  function update(next){latest={...latest,...next};render()}
  function init(){
    const b=button();
    if(!b)return;
    if(!supported()){b.disabled=true;b.title='需要桌面版 Chrome 或 Edge 116 以上';return}
    b.onclick=()=>{if(win)close();else open().catch(error=>{win=null;b.setAttribute('aria-pressed','false');window.toast?.(error.message||'無法開啟字幕視窗')})};
  }
  init();
  return {open,close,update,lastSentences,supported,getSettings,setSettings};
})();
