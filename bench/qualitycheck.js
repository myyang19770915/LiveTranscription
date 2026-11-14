// Spec quality-pass: what the live page keeps and shows as quality events arrive (webapp/static/quality-view.js).
const Q=require('../webapp/static/quality-view.js');
const t=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);console.log(ok?'ok  ':'FAIL',name,JSON.stringify(got));if(!ok)process.exitCode=1};
const sentence=(source,target,startMs,endMs,lang='zh')=>({source,target,lang,startMs,endMs});
const final=(source,target,startMs,endMs)=>({source,target,detected:'',startMs,endMs});

// "A quality event arrives": live translations end at 9000 and 14000; two sentences ending at 10000 arrive.
{
  const live={transcript:'第一段即時文字第二段即時文字',timeMarks:[{end:7,ms:9000},{end:14,ms:14000}],
              finals:[final('第一段即時文字','live one',0,9000),final('第二段即時文字','live two',9000,14000)]};
  const state=Q.apply(Q.create(),{seq:1,throughMs:10500,final:false,sentences:[sentence('第一句。','One.',0,5000),sentence('第二句。','Two.',5000,10000)]},live.finals);
  const shown=Q.view(state,live);
  t('translation pane: two sentences then the live one ending at 14000',[...shown.targets,...shown.liveTargets],['One.','Two.','live two']);
  t('transcript pane: kept sources then the live text after 10000',[shown.sources,shown.liveSource],[['第一句。','第二句。'],'第二段即時文字']);
  t('kept through the last sentence, not the chunk end',state.throughMs,10000);
}

// "Text model times out": a failed event keeps the live segments of that range, in order, and later ones stay live.
{
  const finals=[final('甲','A',0,4000),final('乙','B',4000,9000),final('丙','C',9000,15000)];
  const state=Q.apply(Q.create(),{seq:1,failed:true,throughMs:10000,final:false},finals);
  t('live finals up to throughMs are kept',state.records.map(s=>s.target),['A','B']);
  t('the later one is still live',Q.view(state,{transcript:'',timeMarks:[],finals}).liveTargets,['C']);
  Q.apply(state,{seq:2,throughMs:16000,final:false,sentences:[sentence('丙。','C!',10000,15000)]},finals);
  t('the next chunk is kept after them',state.records.map(s=>s.target),['A','B','C!']);
  t('a kept live segment is not promoted twice',Q.apply(state,{seq:3,failed:true,throughMs:16000,final:false},finals).records.length,3);
}

// "Save during the meeting": 2 + 0 + 3 sentences are saved as sequence numbers 1 to 5, and earlier ones never move.
{
  const state=Q.create();
  Q.apply(state,{seq:1,throughMs:8000,final:false,sentences:[sentence('一','1',0,4000),sentence('二','2',4000,8000)]},[]);
  const first=state.records.slice();
  Q.apply(state,{seq:2,throughMs:14000,final:false,sentences:[]},[]);
  Q.apply(state,{seq:3,throughMs:26000,final:false,sentences:[sentence('三','3',8000,14000),sentence('四','4',14000,20000),sentence('五','5',20000,26000)]},[]);
  t('five segments in order',state.records.map((s,i)=>[i+1,s.source]),[[1,'一'],[2,'二'],[3,'三'],[4,'四'],[5,'五']]);
  t('the first two did not move',state.records.slice(0,2),first);
  t('an empty event keeps the live text where it was',Q.liveFrom(state,[{end:5,ms:8000},{end:9,ms:30000}]),5);
}

// "Service out of credit": three failures in a row, cleared by the next success.
{
  const state=Q.create();
  for(const seq of [1,2])Q.apply(state,{seq,failed:true,throughMs:seq*6000,final:false},[]);
  t('two failures: still available',Q.unavailable(state),false);
  Q.apply(state,{seq:3,failed:true,throughMs:18000,final:false},[]);
  t('three failures: unavailable',Q.unavailable(state),true);
  Q.apply(state,{seq:4,throughMs:24000,final:false,sentences:[]},[]);
  t('a success clears it',Q.unavailable(state),false);
}

// "Export after the session": after the final event the kept sentences are everything; nothing live is shown.
{
  const live={transcript:'尾巴還在',timeMarks:[{end:4,ms:9000}],finals:[final('尾巴還在','tail',5000,9000)]};
  const state=Q.apply(Q.create(),{seq:1,throughMs:9000,final:true,sentences:[sentence('尾巴還在。','The tail is still here.',5000,8000)]},live.finals);
  const shown=Q.view(state,live);
  t('nothing live after the final event',[shown.liveSource,shown.liveTargets],['',[]]);
  t('the export is the kept sentences',state.records.map(s=>`${s.source}→${s.target}`),['尾巴還在。→The tail is still here.']);
  const failed=Q.apply(Q.create(),{seq:1,failed:true,throughMs:8000,final:true},live.finals);
  t('a failed final event keeps every remaining live segment',failed.records.map(s=>s.target),['tail']);
}

// Nothing live is lost: segments finalized after a failure was reported, and everything after a failed or missing final event.
{
  const early=final('甲','A',0,4000),late=final('乙','B',4000,9800),tail=final('丙','C',9000,10900);
  const state=Q.apply(Q.create(),{seq:1,failed:true,throughMs:10000,final:false},[early]);
  t('kept at the failure',state.records.map(s=>s.target),['A']);
  Q.promote(state,[early,late,tail]);
  t('finalized later in the failed range: kept, the one ending just past it too',state.records.map(s=>s.target),['A','B','C']);
  t('kept once',Q.promote(state,[early,late,tail]).records.length,3);
  t('and no longer shown as live',Q.view(state,{transcript:'',timeMarks:[],finals:[early,late,tail]}).liveTargets,[]);
  const far=final('丁','D',11000,16000);
  t('a later segment is still live',Q.view(Q.promote(state,[far]),{transcript:'',timeMarks:[],finals:[far]}).liveTargets,['D']);
  // The final event failed (or never came): the sentence finalized after the connection closed is kept.
  Q.apply(state,{failed:true,final:true,throughMs:10000},[far]);
  const closing=final('戊','E',16000,18000);
  t('everything after a failed final event is kept',Q.promote(state,[far,closing]).records.map(s=>s.target),['A','B','C','D','E']);
  // All chunks failed, then a quiet ending reported as success: the late live segment of the failed range survives.
  const quiet=Q.apply(Q.create(),{seq:1,failed:true,throughMs:8000,final:false},[]);
  const lateOne=final('己','F',2000,8600);
  Q.apply(quiet,{seq:2,throughMs:9000,final:true,sentences:[]},[lateOne]);
  t('a final success after failures keeps the late live segment',quiet.records.map(s=>s.target),['F']);
}

// quality-revision "A sentence is revised" / "An unknown id": new text at the same position; unknown ids and malformed items are ignored.
{
  const state=Q.apply(Q.create(),{seq:1,throughMs:9000,final:false,sentences:[{id:1,...sentence('一。','One.',0,3000)},{id:2,...sentence('跟先生的感情變得穩定。','became stable.',3000,6000)},{id:3,...sentence('三。','Three.',6000,9000)}]},[]);
  const before=state.records.map(s=>({...s}));
  t('one sentence changed',Q.revise(state,{seq:1,sentences:[{id:2,source:'跟先生的感情變得不穩定。',target:'became unstable.'}]}),1);
  t('segment 2 has the new text, same span and language',state.records[1],{...before[1],source:'跟先生的感情變得不穩定。',target:'became unstable.'});
  t('segments 1 and 3 are unchanged',[state.records[0],state.records[2]],[before[0],before[2]]);
  t('both panes show it',[Q.view(state,{transcript:'',timeMarks:[],finals:[]}).sources[1],Q.view(state,{transcript:'',timeMarks:[],finals:[]}).targets[1]],['跟先生的感情變得不穩定。','became unstable.']);
  const after=JSON.stringify(state.records);
  t('unknown id: nothing changes',[Q.revise(state,{seq:2,sentences:[{id:9,source:'x',target:'y'}]}),JSON.stringify(state.records)],[0,after]);
  t('malformed: nothing changes',[Q.revise(state,{sentences:[{id:'2',source:'x',target:'y'},{id:2,source:'',target:'y'},{id:2,source:'x'},null]}),Q.revise(state,null),JSON.stringify(state.records)],[0,0,after]);
  // A live segment kept after a failed chunk has no id: a revision never touches it.
  const mixed=Q.apply(Q.create(),{seq:1,failed:true,throughMs:5000,final:false},[final('甲','A',0,4000)]);
  t('a kept live segment is not revised',[Q.revise(mixed,{sentences:[{id:1,source:'x',target:'y'}]}),mixed.records[0].target],[0,'A']);
}

// Malformed events change nothing.
t('ignored: not an object',Q.apply(Q.create(),null,[]).records.length,0);
t('ignored: sentence without text',Q.apply(Q.create(),{sentences:[{source:1,target:'x'}]},[]).records.length,0);
