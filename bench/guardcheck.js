const {plausibleRefinement}=require('../webapp/static/translation-context.js');
const t=(name,got,want)=>console.log(got===want?'ok  ':'FAIL',name);
t('echoes previous span',plausibleRefinement('正在三個城市進行非監督式 FSD，並且會擴展到，就像我說過的，','我的意思是，我們當然如我早前提到的，\n在三個城市進行非監督式 FSD，並且會擴展到，就像我說過的，',['我的意思是，我們當然如我早前提到的，']),false);
t('absorbs next span',plausibleRefinement('所以，所以我想我們會想要在...之前完成該軟體的編寫、驗證並發佈它。','所以，所以我想我們會想要在進入大規模且受監督的 FSD 之前，先完成該軟體的撰寫、驗證並發佈。',['大規模部署未經驗證的 FSD 或漫遊計程車，當我們知道軟體方面還有能提高安全性的重大架構改進時，這並不合理。','在進入大規模且受監督的 FSD 之前，先驗證並發佈它，']),false);
t('genuine fix kept',plausibleRefinement('なぜなら、水道や電気の修理をする能力はありませんし、2歳児のような……','なぜなら、水道や電気の修理をする能力はありませんし、2歳児のような知識も持っていないからです。',['物理的な知識、例えば、坂道を転がるということや、お湯は熱いということ']),true);
