/* Evidence side panel, shared by the minutes page and 問答 (meeting-qa): segments of one meeting with one segment of
   context each side, the cited ones marked, each playable in place (▶ plays, pauses and resumes; Space does the same for
   the focused segment while the panel is open). Esc or the close button closes it and gives focus back to what opened it.
   The page provides <aside id="peek"> with #peekKind, #peekTitle, #peekClose and #peekList, and <audio id="player">;
   timeline.js (MeetingTimeline) must be loaded first. */
(function(root){
  const pad=n=>String(n).padStart(2,'0');
  const clock=ms=>{const s=Math.floor(ms/1000);return `${pad(Math.floor(s/60))}:${pad(s%60)}`};
  function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}

  // onClose: after the user closed the panel. notice: shows an error (a recording that cannot be loaded).
  function create({onClose=()=>{},notice=()=>{}}={}){
    const $=id=>document.getElementById(id),player=$('player');
    // view: {kind, title, meetingId, meeting (/api/meetings/<id>, null while loading), cited: [seq], focusSeq,
    //        intro: element shown above the segments (optional), empty: text when there is no segment to show}
    let view=null,clip=null,audioUrl=null,opener=null;

    function show(next){
      const opening=!view;
      if(opening)opener=document.activeElement!==document.body?document.activeElement:null;
      const same=view&&view.meetingId===next.meetingId&&view.meeting===next.meeting&&view.focusSeq===next.focusSeq
        &&String(view.cited)===String(next.cited)&&view.intro===next.intro;
      view=next;
      // The same segments: only the header may have changed, so the reader keeps their place in the list.
      if(same){$('peekKind').textContent=view.kind;$('peekTitle').textContent=view.title;return}
      render();
      if(opening)$('peek').focus({preventScroll:true});   // the panel itself, so Space plays rather than pressing a button
    }
    function hide(){
      if(!view)return;
      view=null;player.pause();render();
      if(opener?.isConnected)opener.focus({preventScroll:true});
      opener=null;
    }
    function closed(){hide();onClose()}

    function render(){
      // Below the sticky top bar, so the account and theme buttons stay reachable.
      document.documentElement.style.setProperty('--peek-top',`${document.querySelector('.topbar').offsetHeight}px`);
      document.body.classList.toggle('peeking',!!view);$('peek').hidden=!view;
      if(!view)return;
      $('peekKind').textContent=view.kind;$('peekTitle').textContent=view.title;
      const meeting=view.meeting;
      if(!meeting){$('peekList').replaceChildren(...[view.intro,el('p',{className:'muted small',textContent:'載入逐字稿中…'})].filter(Boolean));return}
      const rows=MeetingTimeline.evidenceContext(meeting.segments,view.cited).flatMap(({segment,cited,gapBefore})=>
        [gapBefore?el('div',{className:'peek-gap',textContent:'⋯'}):null,row(segment,cited)].filter(Boolean));
      $('peekList').replaceChildren(...[view.intro,...(rows.length?rows:[el('p',{className:'muted small',textContent:view.empty||'沒有引用的段落。'})])].filter(Boolean));
      $(`peek-${view.focusSeq}`)?.scrollIntoView({block:'nearest'});
    }
    function row(segment,cited){
      let playButton=null;
      if(view.meeting.hasRecording){
        playButton=el('button',{type:'button',className:'peek-play',title:'播放／暫停這段錄音（空白鍵）',onclick:()=>togglePlay(segment)});
        playButton.dataset.play=segment.seq;
      }
      const node=el('div',{className:`peek-seg${cited?' cited':''}${segment.seq===view.focusSeq?' focus':''}`,id:`peek-${segment.seq}`},
        el('div',{className:'peek-seg-head'},
          playButton||el('span',{className:'peek-time',textContent:clock(segment.startMs)}),
          cited?el('a',{className:'text-button',href:`/meetings/${view.meetingId}#seg-${segment.seq}`,textContent:'到校對頁修正'}):null),
        el('p',{className:'peek-source',textContent:segment.source}),
        segment.target?el('p',{className:'peek-target',textContent:segment.target}):null);
      if(playButton)syncButton(playButton);
      return node;
    }

    // Playback: the button plays, pauses and resumes its segment; another segment, or a finished clip, loads afresh.
    function togglePlay(segment){
      if(clip?.meetingId!==view.meetingId||clip.seq!==segment.seq||player.ended)return play(segment);
      if(player.paused)player.play().catch(error=>notice(error.message));else player.pause();
      syncPlayer();
    }
    function syncButton(button){
      const seq=Number(button.dataset.play),segment=view.meeting.segments.find(s=>s.seq===seq);
      const loaded=clip?.meetingId===view.meetingId&&clip.seq===seq&&!player.ended,playing=loaded&&!player.paused;
      button.textContent=playing?`❚❚ ${clock(clip.span.start+player.currentTime*1000)}`:loaded&&player.currentTime>0?`▶ 繼續 ${clock(clip.span.start+player.currentTime*1000)}`:`▶ ${clock(segment.startMs)}`;
      button.classList.toggle('playing',playing);
    }
    function syncPlayer(){if(view?.meeting)document.querySelectorAll('.peek-play').forEach(syncButton)}
    async function play(segment){
      const meetingId=view.meetingId,span=MeetingTimeline.playWindow(segment.startMs,segment.endMs,view.meeting.durationMs||Infinity,segment.timed);
      const asked=view;
      try{
        const response=await fetch(`/api/meetings/${meetingId}/audio?start=${span.start}&end=${span.end}`);
        if(!response.ok)throw new Error((await response.json().catch(()=>({}))).detail||'無法載入錄音');
        const blob=await response.blob();
        if(view?.meetingId!==asked.meetingId)return;   // closed, or another meeting's source opened, while it was loading
        if(audioUrl)URL.revokeObjectURL(audioUrl);
        audioUrl=URL.createObjectURL(blob);
        clip={meetingId,seq:segment.seq,span};player.src=audioUrl;await player.play();
      }catch(error){notice(error.message)}
    }
    $('peek').tabIndex=-1;
    for(const event of ['play','pause','ended','timeupdate'])player.addEventListener(event,syncPlayer);
    $('peekClose').onclick=closed;
    document.addEventListener('keydown',event=>{
      if(!view||event.defaultPrevented||document.querySelector('dialog[open]'))return;
      if(event.key==='Escape'){closed();return}
      // Space, with the focus in the panel, plays or pauses its segment; on a control Space is the control's own.
      if(event.key!==' '||!view.meeting?.hasRecording||!$('peek').contains(event.target)||event.target.closest('button,a'))return;
      const segment=view.meeting.segments.find(s=>s.seq===view.focusSeq);
      if(segment){event.preventDefault();togglePlay(segment)}
    });
    return {show,hide,get open(){return !!view}};
  }
  root.EvidencePanel={create};
})(globalThis);
