// Spec privacy-notice: "The live page states where audio and text go" — the wording table.
const P=require('../webapp/static/privacy-note.js');
const t=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);console.log(ok?'ok  ':'FAIL',name,JSON.stringify(got));if(!ok)process.exitCode=1};
for(const [engine,refine,label,sentence] of [
  ['local',false,'自架主機','音訊與文字只在語橋主機處理'],
  ['local',true,'雲端精修','文字會傳送到外部模型服務'],
  ['hybrid',false,'雲端辨識','中文以外的音訊會傳送到 Azure'],
  ['mai',false,'雲端辨識','音訊會傳送到 Azure'],
  ['hybrid',true,'雲端辨識與精修','音訊與文字會傳送到外部服務'],
  ['mai',true,'雲端辨識與精修','音訊與文字會傳送到外部服務'],
  ['unknown',false,'自架主機','音訊與文字只在語橋主機處理'],
]) t(`${engine} refine=${refine}`,P.text(engine,refine),{label,sentence});
// cloud-translation: the translation model is an external service, so text leaves in every case.
for(const [engine,refine,label,sentence] of [
  ['local',false,'雲端翻譯','文字會傳送到外部模型服務'],
  ['local',true,'雲端翻譯與精修','文字會傳送到外部模型服務'],
  ['hybrid',false,'雲端辨識與翻譯','音訊與文字會傳送到外部服務'],
  ['mai',false,'雲端辨識與翻譯','音訊與文字會傳送到外部服務'],
  ['mai',true,'雲端辨識與精修','音訊與文字會傳送到外部服務'],
]) t(`external translation: ${engine} refine=${refine}`,P.text(engine,refine,false,true),{label,sentence});
for(const engine of ['local','mai'])t(`${engine} with 精準模式`,P.text(engine,false,true),{label:'精準模式',sentence:'音訊與文字會傳送到外部服務'});
