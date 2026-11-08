/* Pure source-span planner; ASR stalls never count as silence. */
(function(root){
  // Connectives leave a clause open even before a full stop ("為什麼？因為…" must stay together).
  const connective=/(?:因為|因为|雖然|虽然|但是|例如|如果|然後|然后|很多的?|我們在|我们在|以及|或者|所以|針對|针对|從|从|其實|其实|叫做|透過|透过|通過|通过|還有|还有|的話|的话|意味著|意味着|也就是說|也就是说|多くの|例えば|because|although|such as)[，,。！？.!?\s]*$/iu;
  // Particles, pronouns and light verbs only leave it open when no sentence-final mark follows.
  const open=/(?:的|呢|啊|嘛|哦|喔|那|就|也|都|一個|一个|把|去|是|有|在|跟|和|我們|我们|你們|你们|我|你|他|它|這個|这个|那個|那个)[，,、\s]*$/u;
  // A comma right after a 因為/如果/雖然 clause still awaits its 所以/就/但 half.
  const dangling=s=>/[，,]\s*$/u.test(s)&&/^(?:因為|因为|如果|雖然|虽然|既然|要是|假如|只要)/u.test(s.replace(/[，,]\s*$/u,'').split(/[，,。！？!?；;]/u).at(-1).trim());
  const unfinished=s=>connective.test(s.trim())||open.test(s.trim())||dangling(s.trim());
  const shortComplete=s=>/^(你好|謝謝|谢谢|再見|再见|好的|是的|不是|こんにちは|ありがとう)[。！!？?\s]*$/u.test(s.trim());
  // Lectures pause mid-sentence; a VAD pause only ends a segment at a written sentence end,
  // at a comma once the span is long, or as a last resort for very long unpunctuated speech.
  // Japanese ASR often drops punctuation for minutes; a polite predicate (ます/ました/です/ください…)
  // not followed by a connecting particle (が/ので/と…) is the sentence end it would have written.
  const jaEnds=/(?:ま(?:す|した|せん|しょう)|で(?:す|した|しょう)|ください)(?:か|ね|よね|よ)?(?![がけかのとっしもなばよねわまでたじ]|から)/gu;
  const kana=s=>/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
  const jaEnd=s=>[...s.matchAll(jaEnds)].some(m=>m.index+m[0].length===s.length);
  // Unpunctuated kana is only cut at a predicate end, never mid-word ("お待ち|ください").
  const pauseEnds=s=>/[。！？!?；;.]\s*$/u.test(s)||(s.length>=60&&/[，,、]\s*$/u.test(s))||(kana(s)?jaEnd(s):s.length>=120);
  // profile 'live' (即時翻譯 subtitles): run-on Chinese/Japanese is cut at a settled comma from 40 characters, so a
  // finalized segment is one or two subtitle lines; meetings keep 100 (minutes quality, bench scores).
  function plan(text,start,pauses=[],switchAt=0,force=false,profile='meeting'){
    const pending=text.slice(start),ends=[];
    const live=profile==='live'&&/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(pending),runOn=live?40:100,minClause=live?16:40;
    const ready=end=>!unfinished(text.slice(start,end))&&(end-start>=24||shortComplete(text.slice(start,end)));
    for(const m of pending.matchAll(/[。！？!?；;]+|\.(?=\s|$)/gu)){
      const end=start+m.index+m[0].length;
      // "flash二." may be a spoken decimal whose "點零" has not arrived yet; wait for the next word.
      const decimal=/^[。.]$/u.test(m[0])&&/[零〇一二兩两三四五六七八九十0-9]$/u.test(text.slice(0,start+m.index))&&/^\s*(?:[點点]|$)/u.test(text.slice(end));
      if(ready(end)&&!decimal&&!/[為为]什[麼么][？?]$/.test(text.slice(start,end)))ends.push(end);
    }
    // A pause at a comma is mid-sentence: wait until a few following words exist, because the
    // translator reads them to know how the clause ends ("它沒有兩歲孩子的，｜物理知識").
    const settled=end=>!/[，,、]\s*$/u.test(text.slice(start,end))||text.length-end>=8;
    for(const end of pauses)if(end>start&&end<=text.length&&ready(end)&&pauseEnds(text.slice(start,end).trim())&&settled(end))ends.push(end);
    if(switchAt>start)ends.push(switchAt);
    if(ends.length)return {end:Math.min(...ends),final:true,reason:'boundary'};
    if(force)return {end:text.length,final:true,reason:unfinished(pending)?'incomplete-end':'end'};
    // Unpunctuated Japanese: finalize at the first settled predicate end so the span stays one sentence.
    if(kana(pending)&&pending.length>=40){
      const safe=[...pending.matchAll(jaEnds)].map(m=>start+m.index+m[0].length).filter(end=>end-start>=24&&text.length-end>=6&&ready(end));
      if(safe.length)return {end:safe[0],final:true,reason:'ja-predicate'};
    }
    // Run-on talk ("…出せないんですよねでミスを…") and ad copy with no polite ends at all grew into
    // 300-character walls. Past 90 characters a full stop or a polite end before で/な/た is accepted;
    // past 160, a plain verb end where a new phrase starts in kanji or katakana ("解決する|シェア").
    if(kana(pending)&&pending.length>=90){
      const cut=(re,min,max,pick)=>{
        const ends=[...pending.matchAll(re)].map(m=>start+m.index+m[0].length).filter(end=>end-start>=min&&end-start<=max&&text.length-end>=6&&ready(end));
        return ends.length?pick(ends):0;
      };
      const loose=cut(/[。！？!?]|(?:ま(?:す|した|せん|しょう)|で(?:す|した|しょう)|ください)(?:よ?ね|よ|か)?(?![がけかのしもばじっと])/gu,24,160,ends=>ends[0]);
      if(loose)return {end:loose,final:true,reason:'ja-loose'};
      // い/ない/いう usually modify the next noun (青いセンサー, そういう風), so they are not ends here.
      const plain=pending.length>=160&&cut(/(?:[るただ]|(?<!い)う)(?=[\p{Script=Han}\p{Script=Katakana}])/gu,60,160,ends=>ends[0]);
      if(plain)return {end:plain,final:true,reason:'ja-plain'};
    }
    // Long run-on speech: finalize at the last settled comma (text already follows it) so one
    // draft line does not keep rewriting 150+ characters.
    if(pending.length>=runOn){
      const safe=[...pending.matchAll(/[，,、；;]/gu)].map(m=>start+m.index+1).filter(end=>end-start>=minClause&&end-start<=160&&text.length-end>=8&&ready(end));
      // Text can arrive in bulk (a re-punctuated MAI phrase, a translation that was still running): live keeps a segment
      // at or under 60 characters by taking the last comma within that, else the earliest.
      const pick=live?(safe.filter(end=>end-start<=60).at(-1)||safe[0]):safe.at(-1);
      if(safe.length)return {end:pick,final:true,reason:'long-clause'};
    }
    if(pending.length>=320){
      const safe=[...pending.slice(0,320).matchAll(/[，,、\s]/gu)].map(m=>start+m.index+1).filter(end=>end-start>=100&&ready(end));
      if(safe.length)return {end:safe.at(-1),final:true,reason:'clause-limit'};
    }
    // Bounded request without consuming or silently dropping the original.
    return {end:Math.min(text.length,start+600),final:false,reason:'collecting'};
  }
  root.TranslationSegmentation={plan,unfinished};
  if(typeof module!=='undefined')module.exports=root.TranslationSegmentation;
})(typeof globalThis!=='undefined'?globalThis:this);
