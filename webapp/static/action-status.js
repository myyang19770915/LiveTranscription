/* Status of a confirmed action item, shared by the board (/actions) and the minutes page: a status menu
   (已取消 asks for the reason first), the overdue badge, the status note and the change history. */
(function(root){
  const STATUS=[['todo','未開始'],['doing','進行中'],['done','已完成'],['cancelled','已取消']];
  const LABEL=Object.fromEntries(STATUS);
  function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
  const pad=n=>String(n).padStart(2,'0');
  const when=iso=>{const d=new Date(iso);return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`};
  const itemUrl=(meetingId,item)=>`/api/meetings/${meetingId}/minutes/items/${item.id}`;

  function overdue(item){return item.overdueDays>0?el('span',{className:'overdue',textContent:`逾期 ${item.overdueDays} 天`}):null}

  // Resolves {item, message}: a 409 carries the item as someone else left it, shown with their message.
  async function send(meetingId,item,status,note){
    const response=await fetch(`${itemUrl(meetingId,item)}/status`,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({version:item.version,status,note})});
    const result=await response.json().catch(()=>({}));
    if(response.status===409&&result.item)return {item:result.item,message:result.detail};
    if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'狀態更新失敗');
    return {item:result,message:''};
  }

  function history(meetingId,item){
    const list=el('ol',{className:'status-history'},el('li',{className:'muted small',textContent:'載入中…'}));
    fetch(`${itemUrl(meetingId,item)}/updates`).then(r=>r.ok?r.json():Promise.reject()).then(rows=>{
      list.replaceChildren(...(rows.length?rows.map(h=>el('li',{},
        el('span',{textContent:`${LABEL[h.from]} → ${LABEL[h.to]}`}),
        el('small',{className:'muted',textContent:` ${h.by} · ${when(h.at)}`}),
        h.note?el('p',{className:'status-history-note',textContent:h.note}):null,
        // Applied from an in-meeting progress suggestion: where it was said.
        h.meetingId?el('a',{className:'status-history-meeting',href:`/meetings/${h.meetingId}${h.evidence?.length?`#seg-${h.evidence[0]}`:''}`,textContent:'於會議中提到'}):null))
        :[el('li',{className:'muted small',textContent:'還沒有狀態變更'})]));
    }).catch(()=>list.replaceChildren(el('li',{className:'muted small',textContent:'無法載入歷程'})));
    return list;
  }

  // onChange(item, message) after the server answered; onError(message) when it refused.
  function control(item,{meetingId,onChange,onError}){
    const select=el('select',{className:`input compact status-select status-${item.status}`,ariaLabel:'狀態'},
      ...STATUS.map(([value,label])=>el('option',{value,textContent:label})));
    select.value=item.status;
    const reason=el('input',{className:'input compact',maxLength:500,placeholder:'取消原因（必填）',ariaLabel:'取消原因'});
    const reasonError=el('span',{className:'field-error',hidden:true,textContent:'請填寫取消原因'});
    const reasonForm=el('form',{className:'status-reason',hidden:true},reason,
      el('button',{type:'submit',className:'secondary-button compact',textContent:'取消待辦'}),
      el('button',{type:'button',className:'text-button',textContent:'返回',onclick:()=>{select.value=item.status;reasonForm.hidden=true}}),reasonError);
    const historyButton=el('button',{type:'button',className:'text-button',textContent:'歷程'});
    const wrap=el('div',{className:'status-control'},
      el('div',{className:'status-row'},select,overdue(item),historyButton),
      item.statusNote?el('p',{className:'status-note',textContent:`${item.status==='cancelled'?'取消原因':'備註'}：${item.statusNote}`}):null,
      reasonForm);
    async function change(status,note){
      select.disabled=true;
      try{const {item:next,message}=await send(meetingId,item,status,note);onChange(next,message)}
      catch(error){select.value=item.status;onError(error.message)}
      finally{select.disabled=false}
    }
    select.onchange=()=>{
      if(select.value==='cancelled'){reasonForm.hidden=false;reasonError.hidden=true;reason.focus();return}
      reasonForm.hidden=true;change(select.value,'');
    };
    reasonForm.onsubmit=event=>{event.preventDefault();
      if(!reason.value.trim()){reasonError.hidden=false;reason.focus();return}
      change('cancelled',reason.value.trim());
    };
    historyButton.onclick=()=>{
      const open=wrap.querySelector('.status-history');
      if(open){open.remove();historyButton.textContent='歷程'}else{wrap.append(history(meetingId,item));historyButton.textContent='收起歷程'}
    };
    return wrap;
  }
  root.ActionStatus={STATUS,LABEL,overdue,control,send};
})(window);
