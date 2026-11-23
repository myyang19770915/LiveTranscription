// The live page's setup as one sentence (ui-night-celadon, meeting-setup-layout "Settings read as one sentence before a
// session"). compose(state) returns the sentence as parts [{text, field?}]; a part with a field names a setting, and the
// page draws it as a button that opens that setting's own control. Pure: no DOM, so node can test it.
(function (root) {
  const CJK = /[㐀-鿿豈-﫿]/;
  const LATIN_START = /^[A-Za-zÀ-ɏ]/;
  const LATIN_END = /[A-Za-z0-9À-ɏ]$/;

  // The spoken language as said in the sentence: the two automatic modes name what they listen for.
  function spoken(state) {
    if (state.source === 'zh_ja') return null;   // a pair: 中文和日文互相翻譯
    if (state.source === 'auto') return '中文或英文';
    return state.sourceLabel || state.source || '';
  }

  // Each clause is a list of parts; clauses are joined with 「，」 and the sentence has no full stop.
  function clauses(state) {
    const out = [];
    const mode = state.mode === 'interpret' ? 'interpret' : state.mode === 'translate' ? 'translate' : 'meeting';
    if (state.source === 'zh_ja') out.push([{text: '中文和日文', field: 'language'}, {text: '互相翻譯'}]);
    else {
      out.push([{text: '說'}, {text: spoken(state), field: 'language'}]);
      if (state.target === 'none') out.push([{text: '只記錄原文', field: 'targetLanguage'}]);
      else out.push([{text: mode === 'interpret' ? '口譯成' : '翻成'}, {text: state.targetLabel || state.target || '', field: 'targetLanguage'}]);
    }
    const mic = state.micLabel || '麥克風';
    if (state.audio === 'system') out.push([{text: '從'}, {text: '分頁／系統聲音', field: 'audioSource'}, {text: '收音'}]);
    else if (state.audio === 'mixed') out.push([{text: '從'}, {text: mic, field: 'microphone'}, {text: '和'}, {text: '分頁聲音', field: 'audioSource'}, {text: '收音'}]);
    else out.push([{text: '從'}, {text: mic, field: 'microphone'}, {text: '收音'}]);
    if (mode === 'interpret') out.push([{text: state.play === false ? '不播放譯音' : '同步播放譯音', field: 'interpretPlay'}]);
    if (mode === 'meeting') {
      const team = String(state.teamLabel || '').trim();
      out.push(team && state.team !== '' && state.team != null
        ? [{text: '記進'}, {text: team, field: 'team'}, {text: '的會議紀錄'}]
        : [{text: '記進會議紀錄'}]);   // no team (loading or none): no empty button
    } else out.push([{text: '存成你的紀錄'}]);
    return out;
  }

  // A space between a Chinese character and a Latin word, on whichever side has no button.
  function spaced(parts) {
    for (let i = 1; i < parts.length; i++) {
      const a = parts[i - 1], b = parts[i];
      const last = a.text.slice(-1), first = b.text.charAt(0);
      if ((CJK.test(last) && LATIN_START.test(b.text)) || (LATIN_END.test(a.text) && CJK.test(first))) {
        if (!a.field) a.text += ' ';
        else if (!b.field) b.text = ' ' + b.text;
        else a.text += ' ';
      }
    }
    return parts;
  }

  function compose(state) {
    const parts = [];
    clauses(state || {}).forEach((clause, i) => { if (i) parts.push({text: '，'}); parts.push(...clause.filter(p => p.text)); });
    const merged = [];   // neighbouring plain parts become one
    for (const p of spaced(parts.map(p => ({...p})))) {
      const prev = merged[merged.length - 1];
      if (prev && !prev.field && !p.field) prev.text += p.text; else merged.push(p);
    }
    return merged;
  }

  const api = {compose};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SetupSentence = api;
})(typeof window === 'object' ? window : globalThis);
