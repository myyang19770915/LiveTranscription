// Signed-in user in the nav (#account), shared by every page. Exposes window.accountReady (the /api/me payload)
// and window.AvatarPhoto (member-avatars, avatar-self-service, avatar-crop): after an image is chosen, a crop dialog
// shows it with a square frame the user moves and resizes; only on 確定 is the framed area scaled to 160x160 and
// uploaded. The header avatar opens a menu to change one's own photo; a change is announced with a `yq:avatar` event
// so pages showing avatars can reload them. The dialog's styles are injected here once, because the live meeting
// page (themes.css) and the other pages (tokens.css) have different stylesheets; colours fall back between the two.
window.AvatarPhoto=(()=>{
  const SIZE=160,PREVIEW=64;
  const make=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(Boolean));return node};
  const clamp=(value,low,high)=>Math.min(Math.max(value,low),high);
  const CSS=`
.crop-dialog{width:max-content;max-width:calc(100vw - 32px);padding:20px;border:1px solid var(--border,var(--line));border-radius:16px;
  background:var(--panel,var(--surface));color:var(--text);box-shadow:0 24px 64px rgb(0 0 0/.35)}
.crop-dialog::backdrop{background:rgb(0 0 0/.55)}
.crop-dialog h2{margin:0;font-size:18px}
.crop-hint{margin:4px 0 14px;color:var(--muted);font-size:13px}
.crop-body{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;justify-content:center}
.crop-stage{position:relative;overflow:hidden;touch-action:none;user-select:none;border-radius:8px;background:#000}
.crop-stage canvas{display:block}
.crop-frame{position:absolute;box-sizing:border-box;border:2px solid #fff;box-shadow:0 0 0 9999px rgb(0 0 0/.55);cursor:move}
.crop-frame::after{content:"";position:absolute;inset:0;border:1px dashed rgb(255 255 255/.75);border-radius:50%;pointer-events:none}
.crop-frame:focus-visible{outline:3px solid var(--accent,var(--mint));outline-offset:2px}
.crop-handle{position:absolute;right:-2px;bottom:-2px;width:18px;height:18px;border-radius:4px 0 4px 0;background:#fff;cursor:nwse-resize}
.crop-side{display:grid;justify-items:center;gap:8px;color:var(--muted);font-size:12px}
.crop-preview{width:${PREVIEW}px;height:${PREVIEW}px;border-radius:50%;background:var(--field,var(--soft))}
.crop-size{width:100%;accent-color:var(--accent,var(--mint))}
.crop-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.crop-actions button{height:38px;padding:0 18px;border:1px solid var(--border,var(--line));border-radius:999px;background:transparent;
  color:var(--text);font:inherit;font-weight:600;cursor:pointer}
.crop-actions .crop-ok{border-color:transparent;background:var(--accent,var(--mint));color:var(--accent-ink)}`;
  function bitmapOf(file){
    if(!file.type.startsWith('image/')||file.type==='image/svg+xml')return Promise.reject(new Error('請選 PNG、JPEG 或 WebP 圖片'));
    return createImageBitmap(file).catch(()=>{throw new Error('讀不到這張圖片，請換一張')});
  }
  // The crop dialog: resolves to the source rectangle {x, y, size} in image pixels, or null when cancelled.
  function frameOn(bitmap){
    if(!document.getElementById('crop-style'))document.head.append(make('style',{id:'crop-style',textContent:CSS}));
    const {width,height}=bitmap;
    const longest=Math.max(120,Math.min(360,innerWidth-80));
    const scale=Math.min(longest/width,longest/height);
    const w=Math.round(width*scale),h=Math.round(height*scale);
    const full=Math.min(w,h),least=Math.max(24,Math.round(full*.2));
    const frame={size:full,x:(w-full)/2,y:(h-full)/2};
    const ratio=1/scale;
    const source=()=>({x:frame.x*ratio,y:frame.y*ratio,size:frame.size*ratio});

    const dpr=devicePixelRatio||1;
    const picture=make('canvas',{width:Math.round(w*dpr),height:Math.round(h*dpr)});
    Object.assign(picture.style,{width:`${w}px`,height:`${h}px`});
    picture.getContext('2d').drawImage(bitmap,0,0,picture.width,picture.height);
    const handle=make('span',{className:'crop-handle',title:'拖曳調整大小'});
    const box=make('div',{className:'crop-frame',tabIndex:0,ariaLabel:'裁切範圍，方向鍵移動'},handle);
    const stage=make('div',{className:'crop-stage'},picture,box);
    Object.assign(stage.style,{width:`${w}px`,height:`${h}px`});
    const preview=make('canvas',{className:'crop-preview',width:PREVIEW*dpr,height:PREVIEW*dpr,ariaLabel:'預覽'});
    const slider=make('input',{type:'range',className:'crop-size',min:least,max:full,step:1,value:full,ariaLabel:'框選大小'});
    const cancel=make('button',{type:'button',textContent:'取消'});
    const ok=make('button',{type:'button',className:'crop-ok',textContent:'確定'});
    const dialog=make('dialog',{className:'crop-dialog',ariaLabel:'裁切照片'},
      make('h2',{textContent:'裁切照片'}),
      make('p',{className:'crop-hint',textContent:'拖曳方框選擇範圍，拉右下角或用滑桿調整大小；也可用方向鍵移動、＋／－ 縮放。'}),
      make('div',{className:'crop-body'},stage,make('div',{className:'crop-side'},preview,make('span',{textContent:'預覽'}),slider)),
      make('div',{className:'crop-actions'},cancel,ok));

    function draw(){
      frame.size=clamp(frame.size,least,full);
      frame.x=clamp(frame.x,0,w-frame.size);frame.y=clamp(frame.y,0,h-frame.size);
      Object.assign(box.style,{left:`${frame.x}px`,top:`${frame.y}px`,width:`${frame.size}px`,height:`${frame.size}px`});
      slider.value=Math.round(frame.size);
      const r=source();
      const g=preview.getContext('2d');
      g.clearRect(0,0,preview.width,preview.height);   // transparent images must not keep earlier positions
      g.drawImage(bitmap,r.x,r.y,r.size,r.size,0,0,preview.width,preview.height);
    }
    // Drag the frame to move it, its handle to resize it (top-left corner fixed).
    box.onpointerdown=event=>{
      event.preventDefault();box.focus();
      const resizing=event.target===handle,start={px:event.clientX,py:event.clientY,...frame};
      box.setPointerCapture(event.pointerId);
      box.onpointermove=move=>{
        const dx=move.clientX-start.px,dy=move.clientY-start.py;
        if(resizing)frame.size=clamp(start.size+Math.max(dx,dy),least,Math.min(w-start.x,h-start.y));
        else{frame.x=start.x+dx;frame.y=start.y+dy}
        draw();
      };
      box.onpointerup=box.onpointercancel=()=>{box.onpointermove=null};
    };
    // Resize about the frame's centre; the size is clamped first so a frame at its limit does not drift.
    const resize=size=>{
      const next=clamp(size,least,full),cx=frame.x+frame.size/2,cy=frame.y+frame.size/2;
      Object.assign(frame,{size:next,x:cx-next/2,y:cy-next/2});draw();
    };
    // Arrow keys move (Shift: further); + and - resize.
    box.onkeydown=event=>{
      const step=event.shiftKey?20:4;
      const moves={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
      if(moves[event.key]){frame.x+=moves[event.key][0];frame.y+=moves[event.key][1];draw()}
      else if(event.key==='+'||event.key==='=')resize(frame.size+step);
      else if(event.key==='-')resize(frame.size-step);
      else return;
      event.preventDefault();
    };
    slider.oninput=()=>resize(Number(slider.value));
    return new Promise(resolve=>{
      let result=null;
      ok.onclick=()=>{result=source();dialog.close()};
      cancel.onclick=()=>dialog.close();
      dialog.onclose=()=>{dialog.remove();resolve(result)};
      // Keys belong to the dialog: the page's own shortcuts (Space plays audio, Esc closes a side panel) must not
      // react behind it. Esc still cancels, the browser closes a modal dialog by itself.
      dialog.addEventListener('keydown',event=>event.stopPropagation());
      document.body.append(dialog);
      draw();dialog.showModal();box.focus();
    });
  }
  // Ask the user for the area to keep; resolves to a 160x160 WebP (JPEG where WebP cannot be encoded), or null.
  async function crop(file){
    const bitmap=await bitmapOf(file);
    try{
      const area=await frameOn(bitmap);
      if(!area)return null;
      const canvas=make('canvas',{width:SIZE,height:SIZE});
      canvas.getContext('2d').drawImage(bitmap,area.x,area.y,area.size,area.size,0,0,SIZE,SIZE);
      const encode=type=>new Promise(resolve=>canvas.toBlob(resolve,type,.85));
      const webp=await encode('image/webp');
      return webp?.type==='image/webp'?webp:encode('image/jpeg');
    }finally{bitmap.close()}
  }
  async function failed(response,fallback){
    const detail=(await response.json().catch(()=>({}))).detail;
    return new Error(typeof detail==='string'?detail:fallback);
  }
  // Crop, then PUT the photo to url (the administrator API or /api/me/avatar); resolves to {username, avatarUrl},
  // or null when the user cancelled the crop (nothing is sent).
  async function upload(url,file){
    const photo=await crop(file);
    if(!photo)return null;
    const response=await fetch(url,{method:'PUT',headers:{'content-type':photo.type},body:photo});
    if(!response.ok)throw await failed(response,'照片上傳失敗，請再試一次');
    return response.json();
  }
  async function remove(url){
    const response=await fetch(url,{method:'DELETE'});
    if(!response.ok)throw await failed(response,'移除照片失敗，請再試一次');
  }
  // Ask for one image file; resolves to the file, or null when the picker is closed without one.
  function pick(){
    return new Promise(resolve=>{
      const input=Object.assign(document.createElement('input'),{type:'file',accept:'image/png,image/jpeg,image/webp',hidden:true});
      const done=file=>{input.remove();resolve(file)};
      input.onchange=()=>done(input.files[0]||null);
      input.oncancel=()=>done(null);
      document.body.append(input);
      input.click();
    });
  }
  const initial=(name,username)=>[...(name||username||'?')][0].toUpperCase();
  return {crop,upload,remove,pick,initial};
})();

// Menus as popovers (web-platform-polish, viewport-aware-dropdowns): popover="auto" puts an open menu in the top
// layer, so nothing on the page covers it, and the browser closes it on a click outside (light dismiss). Browsers
// without Popover (before 2025) get the `hidden` attribute and a hand-made outside click instead. The caller still
// places the menu and handles Escape, so the focus always goes back to the button that opened it.
// opener(): the button that opened the menu, or null. closed(focusWasInside): the menu is closing, by any means.
window.MenuPopover=(()=>{
  const native=typeof HTMLElement.prototype.showPopover==='function';
  const isOpen=menu=>native?menu.matches(':popover-open'):!menu.hidden;
  function setup(menu,opener,closed){
    // The opener pressed while its menu is open: the click that follows closes the menu and must not reopen it, also
    // where the light dismiss already closed it (browsers without the `source` option of showPopover).
    let pressed=null,pressedAt=0;
    document.addEventListener('pointerdown',event=>{
      const button=opener();
      pressed=button&&isOpen(menu)&&button.contains(event.target)?button:null;pressedAt=performance.now();
      if(!native&&isOpen(menu)&&!menu.contains(event.target)&&!pressed){menu.hidden=true;closed(false)}
    },true);
    if(native){
      menu.hidden=false;menu.setAttribute('popover','auto');
      menu.addEventListener('beforetoggle',event=>{if(event.newState==='closed')closed(menu.contains(document.activeElement))});
    }else menu.hidden=true;
    return {
      isOpen:()=>isOpen(menu),
      pressedAgain(button){const hit=pressed===button&&performance.now()-pressedAt<1000;pressed=null;return hit},
      show(button){
        if(isOpen(menu))return;
        if(!native){menu.hidden=false;return}
        try{menu.showPopover({source:button})}catch{menu.showPopover()}
      },
      hide(){if(!isOpen(menu))return;if(native)menu.hidePopover();else menu.hidden=true},
    };
  }
  return {setup};
})();

// The header's page links (site-navigation). /review and /minutes belong to 會議紀錄, /ask to 搜尋.
const NAV_LINKS=[{key:'live',href:'/',text:'即時會議'},{key:'meetings',href:'/meetings',text:'會議紀錄'},
  {key:'interpret',href:'/interpret',text:'我的紀錄',narrow:true},{key:'actions',href:'/actions',text:'待辦看板'},
  {key:'metrics',href:'/metrics',text:'成效指標',narrow:true},{key:'admin',href:'/admin',text:'管理',admin:true,narrow:true},
  {key:'search',href:'/search',text:'搜尋'}];
function currentNav(path=location.pathname){
  if(path==='/')return 'live';
  if(['/meetings','/review','/minutes'].includes(path)||path.startsWith('/meetings/'))return 'meetings';
  if(path==='/ask')return 'search';
  if(path==='/admin/usage')return 'admin';   // the administration pages share the 管理 link (usage-admin)
  return NAV_LINKS.find(n=>n.href===path)?.key||'';
}
// The account this tab last saw (page-switching): the header is drawn from it at once, before /api/me answers, and
// redrawn only when the answer differs. Only for drawing; the server checks every request. Removed on 401 and sign-out.
const ACCOUNT_KEY='yq-me';
const remembered=(()=>{try{const me=JSON.parse(sessionStorage.getItem(ACCOUNT_KEY)||'null');return me&&me.username?me:null}catch{try{sessionStorage.removeItem(ACCOUNT_KEY)}catch{}return null}})();
const forget=()=>{try{sessionStorage.removeItem(ACCOUNT_KEY)}catch{}};
function drawHeader(me){
  const slot=document.getElementById('account');
  if(!slot)return;
  const make=(tag,props)=>Object.assign(document.createElement(tag),props);
  const name=make('span',{className:'account-name'});
  name.append(make('b',{textContent:me.displayName||me.username}));
  const signOut=async()=>{forget();await fetch('/api/logout',{method:'POST'});location.replace('/login')};
  const out=make('button',{type:'button',className:'account-logout',textContent:'登出',onclick:signOut});
  // The same links in the same order on every page (ui-consistency-pass); the current page's link stays, marked.
  const here=currentNav();
  const links=NAV_LINKS.filter(n=>!n.admin||me.admin).map(n=>{
    const a=make('a',{href:n.href,textContent:n.text,className:n.key==='search'?'nav-link account-search':'nav-link'});
    a.dataset.nav=n.key;if(n.key==='search')a.title='搜尋（/）';
    if(n.key===here){a.classList.add('current');a.setAttribute('aria-current','page')}
    return a;
  });
  slot.replaceChildren(...links,ownAvatar(me,make,signOut,here),name,out);
  prerenderLinks();
}
// Supporting browsers (Chrome, Edge) prepare a header link's page while the pointer rests on it (page-switching);
// others ignore the rules and load the page as before.
function prerenderLinks(){
  if(document.getElementById('yq-prerender')||!HTMLScriptElement.supports?.('speculationrules'))return;
  const rules=Object.assign(document.createElement('script'),{id:'yq-prerender',type:'speculationrules'});
  rules.textContent=JSON.stringify({prerender:[{where:{and:[{selector_matches:'#account a.nav-link'},{not:{selector_matches:'.current'}}]},eagerness:'moderate'}]});
  document.head.append(rules);
}
// A page prepared in the background may be shown much later: its data is fetched again when it is shown, so a change
// made meanwhile on another page is not hidden (page-switching). fn runs only for a page that was prepared.
window.onPageShown=fn=>{if(document.prerendering)document.addEventListener('prerenderingchange',()=>fn(),{once:true})};
if(remembered)drawHeader(remembered);
window.accountReady=fetch('/api/me').then(response=>{
  if(response.status===401){forget();location.replace(ReturnPath.loginUrl(location.pathname,location.search));return new Promise(()=>{})}
  return response.json();
}).then(me=>{
  const text=JSON.stringify(me);
  try{sessionStorage.setItem(ACCOUNT_KEY,text)}catch{}
  if(!remembered||JSON.stringify(remembered)!==text)drawHeader(me);
  return me;
});
// The account at once when this tab remembers it, else when /api/me answers: for menus and controls, never for access.
window.accountSoon=remembered?Promise.resolve(remembered):window.accountReady;

// The header avatar and its menu: 更換照片, and 移除照片 when there is a photo.
// phoneItems: 待辦看板 and 登出 for a header too narrow for their buttons (the meeting page on phones, accounts.css).
function ownAvatar(me,make,signOut,here=''){
  const wrap=make('span',{className:'account-me'});
  const button=make('button',{type:'button',className:'account-avatar',title:'更換我的照片',ariaLabel:'我的照片'});
  button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
  const menu=make('div',{className:'account-menu'});
  menu.setAttribute('role','menu');
  const message=make('p',{className:'account-menu-error',hidden:true});
  const face=()=>{
    const letter=()=>make('span',{className:'account-initial',textContent:AvatarPhoto.initial(me.displayName,me.username)});
    if(!me.avatarUrl)return letter();
    const img=make('img',{src:me.avatarUrl,alt:'',width:28,height:28});
    img.onerror=()=>img.replaceWith(letter());
    return img;
  };
  // A popover below the avatar, right edges aligned (web-platform-polish, MenuPopover): a click outside closes it, and
  // it works from the keyboard as a menu button (site-navigation "The avatar menu works from the keyboard").
  let shown=false;
  const dismiss=event=>{if(event.type==='scroll'&&menu.contains(event.target))return;close(menu.contains(document.activeElement))};
  const finish=refocus=>{   // the menu is closing, by any means
    if(!shown)return;
    shown=false;button.setAttribute('aria-expanded','false');
    removeEventListener('resize',dismiss);removeEventListener('scroll',dismiss,true);
    if(refocus)button.focus({preventScroll:true});
  };
  const pop=MenuPopover.setup(menu,()=>shown?button:null,finish);
  const items=()=>[...menu.querySelectorAll('[role=menuitem]')].filter(item=>item.checkVisibility?.()??item.getClientRects().length>0);   // the ones shown at this width
  const place=()=>{const r=button.getBoundingClientRect();menu.style.top=`${r.bottom+6}px`;menu.style.left=`${Math.max(12,r.right-menu.offsetWidth)}px`};
  // focus: 'first' or 'last' item, or null to leave the focus where it is.
  const open=(focus=null)=>{
    if(!shown){
      pop.show(button);shown=true;button.setAttribute('aria-expanded','true');place();
      addEventListener('resize',dismiss);addEventListener('scroll',dismiss,true);
    }
    const list=items();
    (focus==='first'?list[0]:focus==='last'?list.at(-1):null)?.focus();
  };
  const close=(refocus=false)=>{if(!shown)return;finish(refocus);pop.hide()};
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();close(true);return}
    const list=items(),at=list.indexOf(document.activeElement);
    const go=index=>{event.preventDefault();list[(index+list.length)%list.length]?.focus()};
    if(event.key==='ArrowDown')go(at+1);
    else if(event.key==='ArrowUp')go(at<0?list.length-1:at-1);
    else if(event.key==='Home')go(0);
    else if(event.key==='End')go(list.length-1);
  });
  button.addEventListener('keydown',event=>{
    if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
    event.preventDefault();message.hidden=true;open(event.key==='ArrowUp'?'last':'first');
  });
  const show=avatarUrl=>{me.avatarUrl=avatarUrl;button.replaceChildren(face());render()};
  const changed=avatarUrl=>{
    show(avatarUrl);
    window.dispatchEvent(new CustomEvent('yq:avatar',{detail:{username:me.username,avatarUrl}}));
  };
  // Another part of the page changed this user's photo (an administrator's own row on the team page).
  window.addEventListener('yq:avatar-own',event=>show(event.detail.avatarUrl));
  const run=async work=>{
    message.hidden=true;
    try{await work()}catch(error){message.textContent=error.message;message.hidden=false;open()}
  };
  const item=(text,onclick,className='')=>{const node=make('button',{type:'button',textContent:text,onclick,className});node.setAttribute('role','menuitem');return node};
  function render(){
    menu.replaceChildren(...[
      item('更換照片',()=>run(async()=>{
        const file=await AvatarPhoto.pick();
        if(!file)return;
        close();   // the crop dialog takes over; an error reopens the menu with its message
        const result=await AvatarPhoto.upload('/api/me/avatar',file);
        if(result)changed(result.avatarUrl);   // null: the crop was cancelled, nothing changed
        close();
      })),
      me.avatarUrl?item('移除照片',()=>run(async()=>{await AvatarPhoto.remove('/api/me/avatar');changed(null);close()})):null,
      item('我的 Email',()=>{close();emailDialog(me,make)}),
      // Page links the header hides on narrow windows (site-navigation): topbar.css shows each one only at the widths
      // where its header link is hidden (900px: the `narrow` ones; 700px: all but 搜尋). Never the current page.
      ...NAV_LINKS.filter(n=>n.key!=='search'&&n.key!==here&&(!n.admin||me.admin))
        .map(n=>item(n.text,()=>{location.href=n.href},`menu-nav menu-${n.key}${n.narrow?' at-900':''}`)),
      item('登出',signOut,'menu-phone'),
      message].filter(Boolean));
  }
  render();
  button.append(face());
  button.onclick=()=>{
    const again=pop.pressedAgain(button);
    if(shown){close(true);return}
    if(again)return;   // that press already closed the menu (light dismiss)
    message.hidden=true;open('first');
  };
  wrap.append(button,menu);
  return wrap;
}

// 我的 Email (minutes-mail): the address minutes and reminders go to. One from the company directory is read-only;
// otherwise the member enters or clears their own. Styles are injected like the crop dialog's (two stylesheets).
function emailDialog(me,make){
  if(!document.getElementById('email-style'))document.head.append(make('style',{id:'email-style',textContent:`
.email-dialog{width:min(420px,calc(100vw - 32px));padding:20px;border:1px solid var(--border,var(--line));border-radius:16px;
  background:var(--panel,var(--surface));color:var(--text);box-shadow:0 24px 64px rgb(0 0 0/.35)}
.email-dialog::backdrop{background:rgb(0 0 0/.55)}
.email-dialog h2{margin:0;font-size:18px}
.email-dialog p{margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.6}
.email-dialog .email-value{margin-top:14px;color:var(--text);font-size:15px;font-weight:600;overflow-wrap:anywhere}
.email-dialog input{box-sizing:border-box;width:100%;height:42px;margin-top:14px;padding:0 12px;border:1px solid var(--border,var(--line));
  border-radius:10px;background:var(--field,var(--soft));color:var(--text);font:inherit;font-size:15px}
.email-dialog input:focus{outline:none;border-color:var(--accent,var(--mint));box-shadow:0 0 0 3px var(--accent-soft,rgb(0 0 0/.1))}
.email-dialog .email-error{color:var(--danger,#e5484d);font-weight:600}
.email-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.email-actions button{height:38px;padding:0 18px;border:1px solid var(--border,var(--line));border-radius:999px;background:transparent;
  color:var(--text);font:inherit;font-weight:600;cursor:pointer}
.email-actions .email-save{border-color:transparent;background:var(--accent,var(--mint));color:var(--accent-ink)}
.email-actions .email-clear{margin-right:auto;color:var(--muted)}`}));
  const fixed=me.emailSource==='ldap';
  const error=make('p',{className:'email-error',hidden:true,role:'alert'});
  const input=fixed?null:make('input',{type:'email',value:me.email||'',maxLength:254,placeholder:'name@company.com',ariaLabel:'Email'});
  const close=make('button',{type:'button',textContent:fixed?'關閉':'取消'});
  const save=fixed?null:make('button',{type:'submit',className:'email-save',textContent:'儲存'});
  const clear=!fixed&&me.email?make('button',{type:'button',className:'email-clear',textContent:'清除'}):null;
  const actions=make('div',{className:'email-actions'});   // make() here takes no children
  actions.append(...[clear,close,save].filter(Boolean));
  const form=make('form',{method:'dialog'});
  form.append(make('h2',{textContent:'我的 Email'}),
    make('p',{textContent:fixed?'由公司目錄提供，如需更改請洽 IT。':'用來收會議紀要與待辦提醒。公司目錄沒有提供你的 Email，請自行填寫。'}),
    ...(fixed?[make('p',{className:'email-value',textContent:me.email})]:[input]),error,
    actions);
  const dialog=make('dialog',{className:'email-dialog',ariaLabel:'我的 Email'});
  dialog.append(form);
  const store=async email=>{
    error.hidden=true;
    const response=await fetch('/api/me/email',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({email})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){error.textContent=typeof result.detail==='string'?result.detail:'儲存失敗';error.hidden=false;return}
    Object.assign(me,{email:result.email,emailSource:result.emailSource});dialog.close();
  };
  form.onsubmit=event=>{event.preventDefault();if(save)store(input.value)};
  if(clear)clear.onclick=()=>store('');
  close.onclick=()=>dialog.close();
  dialog.onclose=()=>dialog.remove();
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  document.body.append(dialog);
  dialog.showModal();
  (input||close).focus();
}

// "/" opens search from any page (meeting-search), unless typing or a dialog is open; on the search page it focuses the box.
document.addEventListener('keydown',event=>{
  if(event.key!=='/'||event.ctrlKey||event.metaKey||event.altKey||event.defaultPrevented)return;
  if(event.target.closest?.('input, textarea, select, [contenteditable="true"]')||document.querySelector('dialog[open]'))return;
  event.preventDefault();
  const box=['/search','/ask'].includes(location.pathname)&&document.getElementById('q');   // the question box on 問答 (meeting-qa)
  if(box){box.focus();box.select()}else location.href='/search';
});
