// 畫面＋字幕 (screen-subtitles): the shared tab's picture shown full-window on this page with a translucent subtitle box
// over it. Document Picture-in-Picture windows cannot be transparent, so the picture comes here instead: the video
// track getDisplayMedia already gave us. The box is subtitle-sized with two areas of fixed height (smooth-subtitles):
// 原文 2 lines (the previous segment's source, then the speech now) and 譯文 3 lines (the last finalized segments, one
// to a line, then the draft as the last of them, so a segment is finalized where its draft was). Each area is a list
// that hugs the bottom; its lines glide up when text is added (Subtitles.glide). It shares the floating window's text size;
// the 原文 toggle (on by default here), background opacity and position live in localStorage.overlay.
window.Overlay=(()=>{
  const KEY='overlay',DEFAULTS={opacity:55,x:50,y:88,source:true},NO_TRACK='需要分頁／系統聲音來源',READY='把分享的畫面放大顯示，字幕半透明疊在上面';
  const SEGMENTS=3;   // finalized segments kept in the translation area: what three lines can show
  let track=null,latest={done:'',pending:'',translation:'',draft:'',history:[]},settings=load(),drag=null;
  const $=id=>document.getElementById(id);
  const view=()=>$('screenView'),box=()=>view()?.querySelector('.overlay-subs'),button=()=>$('overlay');
  function load(){
    try{
      const s=JSON.parse(localStorage.getItem(KEY)||'{}')||{},num=v=>typeof v==='number'&&Number.isFinite(v),pct=(v,d)=>num(v)?Math.min(100,Math.max(0,v)):d;
      return {opacity:num(s.opacity)?Math.min(100,Math.max(20,Math.round(s.opacity/5)*5)):DEFAULTS.opacity,x:pct(s.x,DEFAULTS.x),y:pct(s.y,DEFAULTS.y),source:typeof s.source==='boolean'?s.source:DEFAULTS.source};
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
    const shared=window.Subtitles?.getSettings?.()||{size:2};
    b.dataset.size=String(shared.size);b.style.setProperty('--ov-alpha',String(settings.opacity/100));
    const source=b.querySelector('.ov-source'),text=b.querySelector('.ov-text'),draft=b.querySelector('.ov-draft'),S=window.Subtitles;
    const now=source.querySelector('.ov-now'),done=source.querySelector('.ov-done'),was=[...text.children],said=[...done.children],settle=S?.glide([...done.children,now,...text.children,draft]);
    // The sources of the last finalized segments (without any, the one source given), then the speech now: when it is
    // finalized its source stays where it was said and the older one leaves at the top.
    const recent=(latest.history||[]).slice(-2).map(segment=>(segment.source||'').trim()).filter(Boolean),sources=recent.length?recent:[(latest.done||'').trim()].filter(Boolean);
    S?.fill(done,sources,text=>text,()=>document.createElement('p'),(p,text)=>S.setText(p,text));S?.setText(now.firstElementChild,(latest.pending||'').trim());
    source.hidden=!settings.source;   // an empty source keeps its lines: the box height does not change
    S?.fill(text,(latest.history||[]).slice(-SEGMENTS),segment=>`${segment.source||''}\n${segment.target}`,()=>Object.assign(document.createElement('p'),{className:'ov-seg'}),(p,segment)=>S.setText(p,(segment.target||'').trim()));
    S?.setDraft(draft.firstElementChild,latest.draft||'',latest.draftSolid);
    b.querySelector('.ov-toggle-source').setAttribute('aria-pressed',String(settings.source));
    b.querySelector('.ov-opacity input').value=String(settings.opacity);
    b.querySelector('.ov-empty').hidden=Boolean(text.textContent||draft.textContent);
    settle?.(b.querySelector('.ov-lines').clientHeight,[...S.heirs(was,text,draft),...S.heirs(said,done,now)]);   // the newest words of each area stay in view; what was shown glides up
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
  // Without a history (a caller that sends only the latest translation), that translation is the one segment shown.
  function update(next){
    latest={...latest,...next};
    if(next.history===undefined&&next.translation!==undefined)latest.history=next.translation?[{source:latest.done||'',target:next.translation}]:[];
    render();
  }
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
    b.querySelector('.ov-toggle-source').onclick=()=>{settings.source=!settings.source;save();render()};   // this view's own toggle
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
