// Floating subtitles (live-translation): an always-on-top Document Picture-in-Picture window showing the last translated
// sentences and the current draft. app.js keeps it in step through Subtitles.update(); the user's choices (source shown,
// text size) live in localStorage. Without the API (Firefox, Safari, phones) the button is disabled and says why.
window.Subtitles=(()=>{
  const KEY='subtitles',SIZES=4;
  let win=null,latest={source:'',translation:'',draft:''},settings=load();
  function load(){
    try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');return {source:s.source===true,size:Math.min(SIZES,Math.max(1,Number(s.size)||2))}}
    catch{return {source:false,size:2}}
  }
  function save(){try{localStorage.setItem(KEY,JSON.stringify(settings))}catch{}}
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
    source.textContent=lastSentences(latest.source,1);source.hidden=!settings.source||!source.textContent;
    text.textContent=lastSentences(latest.translation,2);
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
    for(const href of ['/assets/tokens.css?v=20261108b','/assets/subtitles.css?v=20261108b']){const link=d.createElement('link');link.rel='stylesheet';link.href=href;d.head.append(link)}
    d.body.innerHTML='<div class="sub-bar"><button type="button" class="sub-toggle-source" aria-pressed="false" title="顯示最近一句原文">原文</button>'
      +'<button type="button" class="sub-smaller" title="縮小字">A−</button><button type="button" class="sub-bigger" title="放大字">A+</button>'
      +'<span class="sub-title">語橋 Live 字幕</span><button type="button" class="sub-close" title="關閉字幕視窗">✕</button></div>'
      +'<div class="sub-body"><p class="sub-source" hidden></p><p class="sub-text"></p><p class="sub-draft" hidden></p><p class="sub-empty">等待語音…</p></div>';
    d.querySelector('.sub-toggle-source').onclick=()=>{settings.source=!settings.source;save();render()};
    d.querySelector('.sub-bigger').onclick=()=>{settings.size=Math.min(SIZES,settings.size+1);save();render()};
    d.querySelector('.sub-smaller').onclick=()=>{settings.size=Math.max(1,settings.size-1);save();render()};
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
  return {open,close,update,lastSentences,supported};
})();
