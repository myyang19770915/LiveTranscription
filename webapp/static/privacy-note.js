/* Where meeting audio and text go, by recognition engine and cloud refinement (privacy-notice).
   Shown in the live page header and footer; it must stay true for every combination. */
(function(root){
  function text(engine,refine,quality){
    if(quality)return {label:'精準模式',sentence:'音訊與文字會傳送到外部服務'};   // re-recognition and the text model are external
    const cloud=engine==='mai'||engine==='hybrid';
    if(cloud&&refine)return {label:'雲端辨識與精修',sentence:'音訊與文字會傳送到外部服務'};
    if(cloud)return {label:'雲端辨識',sentence:engine==='hybrid'?'中文以外的音訊會傳送到 Azure':'音訊會傳送到 Azure'};
    if(refine)return {label:'雲端精修',sentence:'文字會傳送到外部模型服務'};
    return {label:'自架主機',sentence:'音訊與文字只在語橋主機處理'};
  }
  root.PrivacyNote={text};
  if(typeof module!=='undefined')module.exports=root.PrivacyNote;
})(typeof globalThis!=='undefined'?globalThis:this);
