const S=require('../webapp/static/segmentation.js');
const cases=[
 '何度も同じ場所を回る。そんな問題を解決するシェアリングサービスブルースマートパーキングスマホで目的地に近い駐車場を簡単検索時間指定で予約できるから確実に駐車ヤフーカーナビ連携で予約の場所までも迷わないしかも一分単位で生産できる小銭不要のスマホ決済だから無駄な料金無駄な時間無駄な手間とはもうさよなら目印はこの青いセンサー日本全国の使っていない駐車場間スペースを誰もがシェアしシェアされる子どもの送り迎えもいつもの出かけも家族旅行もそして仕事ももっとスマートにブルースマートパーキング始まる全国続々拡大はい我々のシェアリングパーキングシェアリングサービスブルーですね',
 '例えばバックオフィス業務とかああいうのってあの関節部門なんで数字が出せないんですよねでミスを起こしたものだけミスを起こしたって言われちゃうとだから牛乳配達でもそうでルーティン業務なんで僕は何が相手の期待値が上まるかってわからないとだからうちの会社でも例えば三ヶ月後に誰のヘルプもなしに自分一人でお客さんからの説明を即答できる状態そういう風に相手の期待を言語で握ってそれに対して上回ったか上回ってないかこの期待値をちゃんと設定するっていう能力はめちゃくちゃ高いですね',
 '他說我們今天要討論的是這個新的工作流，因為很多同事都還不熟悉，所以我先介紹一下整體的架構，然後再請大家提問，我們有三個部分要說明，第一個是資料的來源，第二個是處理流程，',
];
// The 即時翻譯 profile (live-subtitle-segments): run-on Chinese is cut at settled commas from 40 characters.
const live='他說我們今天要討論的是這個新的工作流，因為很多同事都還不熟悉，所以我先介紹一下整體的架構，然後再請大家提問，我們有三個部分要說明，第一個是資料的來源，第二個是處理流程，第三個是最後的輸出格式，大家如果有問題可以隨時打斷我，我們就先從資料的來源開始講起，';
cases.push([live,'live']);
let failed=false;
for(const item of cases){
  const [text,profile]=Array.isArray(item)?item:[item,'meeting'];
  let start=0;const out=[],lengths=[];
  // Simulate live arrival: the planner sees growing text, as in the app.
  for(let n=1;n<=text.length;n++){
    const p=S.plan(text.slice(0,n),start,[],0,false,profile);
    if(p.final){const seg=text.slice(start,p.end);out.push(`${seg}  ⟨${p.reason}⟩`);lengths.push(seg.length);if(profile==='live'&&/因為很多同事都還不熟悉，$/.test(seg)){console.log('FAIL cut after 因為…，');failed=true}start=p.end}
  }
  out.push(`${text.slice(start)}  ⟨tail⟩`);
  if(profile==='live'){console.log(`[live] segment lengths: ${lengths.join(', ')}`);if(!lengths.length||lengths.some(n=>n<16||n>60)){console.log('FAIL live segments must be 16–60 characters');failed=true}}
  console.log(out.join('\n')+'\n');
}
// Bulk arrival (the whole run-on in one update): live still keeps the segment at or under 60 characters.
const bulk=S.plan(live,0,[],0,false,'live');
console.log(`[live] bulk arrival: end=${bulk.end} final=${bulk.final}`);
if(!bulk.final||bulk.end>60||bulk.end<16){console.log('FAIL bulk live segment must be 16–60');failed=true}
process.exit(failed?1:0);
