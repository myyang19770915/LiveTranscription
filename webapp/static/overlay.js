// 畫面＋字幕 (screen-subtitles): the shared tab's picture shown full-window on this page with a translucent subtitle box
// over it. Document Picture-in-Picture windows cannot be transparent, so the picture comes here instead: the video
// track getDisplayMedia already gave us. The box shows what the floating subtitles show (Subtitles.lastSentences and
// its source/size settings); its own background opacity and position live in localStorage.overlay.
window.Overlay=(()=>{
  const KEY='overlay',DEFAULTS={opacity:55,x:50,y:88},NO_TRACK='需要分頁／系統聲音來源',READY='把分享的畫面放大顯示，字幕半透明疊在上面';
  let track=null,latest={source:'',translation:'',draft:''},settings=load(),drag=null;
  const $=id=>document.getElementById(id);
  const view=()=>$('screenView'),box=()=>view()?.querySelector('.overlay-subs'),button=()=>$('overlay');
  function load(){
    try{
      const s=JSON.parse(localStorage.getItem(KEY)||'{}')||{},num=v=>typeof v==='number'&&Number.isFinite(v),pct=(v,d)=>num(v)?Math.min(100,Math.max(0,v)):d;
      return {opacity:num(s.opacity)?Math.min(100,Math.max(20,Math.round(s.opacity/5)*5)):DEFAULTS.opacity,x:pct(s.x,DEFAULTS.x),y:pct(s.y,DEFAULTS.y)};
    }catch{return {...DEFAULTS}}
  }
  function save(){try{localStorage.setItem(KEY,JSON.stringify(settings))}catch{}}
  const isOpen=()=>Boolean(view()&&!view().hidden);
  function place(){
    // The box centre in percent of the view; clamped so the whole box stays visible.
    const v=view(),b=box();if(!v||!b)return;
    const w=v.clientWidth,h=v.clientHeight,bw=b.offsetWidth,bh=b.offsetHeight;
    if(w&&h&&bw&&bh){
      const minX=bw/2/w*100,minY=bh/2/h*100;
      settings.x=Math.min(100-minX,Math.max(minX,settings.x));settings.y=Math.min(100-minY,Math.max(minY,settings.y));
    }
    b.style.left=`${settings.x}%`;b.style.top=`${settings.y}%`;
  }
  function render(){
    const b=box();if(!b||!isOpen())return;
    const shared=window.Subtitles?.getSettings?.()||{source:false,size:2};
    b.dataset.size=String(shared.size);b.style.setProperty('--ov-alpha',String(settings.opacity/100));
    const source=b.querySelector('.ov-source'),text=b.querySelector('.ov-text'),draft=b.querySelector('.ov-draft');
    source.textContent=window.Subtitles?.lastSentences(latest.source,1)||'';source.hidden=!shared.source||!source.textContent;
    text.textContent=window.Subtitles?.lastSentences(latest.translation,2)||'';
    draft.textContent=latest.draft||'';draft.hidden=!latest.draft;
    b.querySelector('.ov-toggle-source').setAttribute('aria-pressed',String(shared.source));
    b.querySelector('.ov-opacity input').value=String(settings.opacity);
    b.querySelector('.ov-empty').hidden=Boolean(text.textContent||draft.textContent);
    place();
  }
  function open(){
    if(!track||track.readyState!=='live'||isOpen())return;
    const v=view();v.querySelector('video').srcObject=new MediaStream([track]);
    v.hidden=false;button()?.setAttribute('aria-pressed','true');
    render();
  }
  function close(){
    const v=view();if(!v||v.hidden)return;
    if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});
    v.querySelector('video').srcObject=null;v.hidden=true;button()?.setAttribute('aria-pressed','false');
  }
  function setTrack(next){
    track=next&&next.readyState==='live'?next:null;
    const b=button();
    if(!track){close();if(b){b.disabled=true;b.title=NO_TRACK}}
    else if(b){b.disabled=false;b.title=READY}
  }
  function update(next){latest={...latest,...next};render()}
  function startDrag(event){
    if(event.target.closest('button, input, label'))return;
    const b=box(),v=view(),rect=b.getBoundingClientRect();
    drag={dx:event.clientX-(rect.left+rect.width/2),dy:event.clientY-(rect.top+rect.height/2),w:v.clientWidth,h:v.clientHeight,left:v.getBoundingClientRect().left,top:v.getBoundingClientRect().top};
    b.setPointerCapture(event.pointerId);b.classList.add('dragging');
  }
  function moveDrag(event){
    if(!drag)return;
    settings.x=(event.clientX-drag.dx-drag.left)/drag.w*100;settings.y=(event.clientY-drag.dy-drag.top)/drag.h*100;
    place();
  }
  function endDrag(event){
    if(!drag)return;
    drag=null;box()?.classList.remove('dragging');box()?.releasePointerCapture?.(event.pointerId);save();
  }
  function init(){
    const v=view(),b=box(),btn=button();
    if(!v||!b||!btn)return;
    btn.disabled=true;btn.title=NO_TRACK;
    btn.onclick=()=>{if(isOpen())close();else open()};
    b.querySelector('.ov-toggle-source').onclick=()=>window.Subtitles?.setSettings({source:!window.Subtitles.getSettings().source});
    b.querySelector('.ov-bigger').onclick=()=>window.Subtitles?.setSettings({size:window.Subtitles.getSettings().size+1});   // Subtitles clamps 1–4
    b.querySelector('.ov-smaller').onclick=()=>window.Subtitles?.setSettings({size:window.Subtitles.getSettings().size-1});
    b.querySelector('.ov-opacity input').oninput=event=>{settings.opacity=Number(event.target.value);save();render()};
    // The whole document goes full screen (the view covers it anyway), so toasts stay visible in full screen too.
    b.querySelector('.ov-full').onclick=()=>document.documentElement.requestFullscreen?.().catch(()=>window.toast?.('無法全螢幕'));
    b.querySelector('.ov-close').onclick=close;
    b.addEventListener('pointerdown',startDrag);b.addEventListener('pointermove',moveDrag);
    b.addEventListener('pointerup',endDrag);b.addEventListener('pointercancel',endDrag);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&isOpen()&&!document.fullscreenElement)close()});
    window.addEventListener('resize',()=>{if(isOpen())place()});
  }
  init();
  return {setTrack,open,close,update,isOpen,refresh:render};
})();
