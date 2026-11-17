/* The output languages of 即時口譯 and the names shown for language codes (interpret-mode-on-home): used by the live
   page's 即時口譯 mode and by 我的紀錄. FULL are the 13 fully supported; MORE are also accepted, quality not assured. */
(function () {
  const FULL = [['zh', '中文（台灣繁體）'], ['en', 'English 英文'], ['ja', '日本語 日文'], ['ko', '한국어 韓文'], ['es', 'Español 西班牙文'],
    ['pt', 'Português 葡萄牙文'], ['fr', 'Français 法文'], ['de', 'Deutsch 德文'], ['it', 'Italiano 義大利文'], ['ru', 'Русский 俄文'],
    ['hi', 'हिन्दी 印地文'], ['id', 'Bahasa Indonesia 印尼文'], ['vi', 'Tiếng Việt 越南文']];
  const MORE = [['th', 'ไทย 泰文'], ['ms', 'Bahasa Melayu 馬來文'], ['tl', 'Tagalog 他加祿文'], ['ar', 'العربية 阿拉伯文'], ['tr', 'Türkçe 土耳其文'],
    ['nl', 'Nederlands 荷蘭文'], ['pl', 'Polski 波蘭文'], ['uk', 'Українська 烏克蘭文'], ['cs', 'Čeština 捷克文'], ['sv', 'Svenska 瑞典文'],
    ['da', 'Dansk 丹麥文'], ['no', 'Norsk 挪威文'], ['fi', 'Suomi 芬蘭文'], ['el', 'Ελληνικά 希臘文'], ['he', 'עברית 希伯來文'],
    ['hu', 'Magyar 匈牙利文'], ['ro', 'Română 羅馬尼亞文'], ['bg', 'Български 保加利亞文'], ['hr', 'Hrvatski 克羅埃西亞文'], ['sr', 'Српски 塞爾維亞文'],
    ['sk', 'Slovenčina 斯洛伐克文'], ['sl', 'Slovenščina 斯洛維尼亞文'], ['lt', 'Lietuvių 立陶宛文'], ['lv', 'Latviešu 拉脫維亞文'], ['et', 'Eesti 愛沙尼亞文'],
    ['fa', 'فارسی 波斯文'], ['ur', 'اردو 烏爾都文'], ['ta', 'தமிழ் 坦米爾文'], ['kn', 'ಕನ್ನಡ 康納達文'], ['mr', 'मराठी 馬拉地文'], ['ne', 'नेपाली 尼泊爾文'],
    ['sw', 'Kiswahili 史瓦希里文'], ['af', 'Afrikaans 南非語'], ['ca', 'Català 加泰隆尼亞文'], ['gl', 'Galego 加利西亞文'], ['cy', 'Cymraeg 威爾斯文'],
    ['is', 'Íslenska 冰島文'], ['mk', 'Македонски 馬其頓文'], ['bs', 'Bosanski 波士尼亞文'], ['be', 'Беларуская 白俄羅斯文'], ['hy', 'Հայերեն 亞美尼亞文'],
    ['az', 'Azərbaycan 亞塞拜然文'], ['kk', 'Қазақ 哈薩克文'], ['mi', 'Māori 毛利文']];
  const NAMES = Object.fromEntries([...FULL, ...MORE].map(([v, n]) => [v, n.replace(/（.*/, '').split(' ').pop()]));
  Object.assign(NAMES, {zh: '中文', auto: '中英混合', yue: '粵語', zh_ja: '中日雙向', iw: '希伯來文'});
  window.InterpretLangs = {FULL, MORE, name: code => NAMES[code] || code || '?',
    // An output-language <select> in two groups; `allowed` limits it to the server's list.
    fill(select, allowed, chosen) {
      const ok = new Set(allowed || [...FULL, ...MORE].map(([v]) => v));
      select.replaceChildren();
      for (const [label, list] of [['完整支援的 13 種', FULL], ['也可選用（翻譯品質未經保證）', MORE]]) {
        const group = document.createElement('optgroup'); group.label = label;
        for (const [v, t] of list) if (ok.has(v)) group.append(new Option(t, v));
        if (group.children.length) select.append(group);
      }
      select.value = [...select.options].some(o => o.value === chosen) ? chosen : (ok.has('en') ? 'en' : select.options[0]?.value || '');
    }};
})();
