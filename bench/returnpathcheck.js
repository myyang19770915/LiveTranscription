// Spec user-auth: "Sign-in returns to the requested page" — the destination table and the sign-in address.
const R=require('../webapp/static/return-path.js');
const t=(name,got,want)=>{const ok=got===want;console.log(ok?'ok  ':'FAIL',name,JSON.stringify(got));if(!ok)process.exitCode=1};
for(const [next,want] of [
  ['/meetings','/meetings'],
  ['/actions?item=50','/actions?item=50'],
  [null,'/'],
  ['','/'],
  ['https://evil.example/','/'],
  ['//evil.example/','/'],
  ['/\\evil.example/','/'],
  ['/a\\b','/'],
  ['meetings','/'],
  ['javascript:alert(1)','/'],
  ['/a\nb','/'],
]) t(`safe(${JSON.stringify(next)})`,R.safe(next),want);
t('main page has no next',R.loginUrl('/',''),'/login');
t('deep link is encoded',R.loginUrl('/actions','?item=50'),'/login?next=%2Factions%3Fitem%3D50');
t('2000 characters still carried',R.loginUrl('/meetings','?'+'a'.repeat(1990)).startsWith('/login?next='),true);
t('2001 characters are not',R.loginUrl('/meetings','?'+'a'.repeat(1991)),'/login');
t('fragment is kept',R.afterSignIn('?next=%2Fmeetings%2Fabc','#seg-12'),'/meetings/abc#seg-12');
t('off-site next with a fragment',R.afterSignIn('?next=//example.com/','#x'),'/#x');
t('no next',R.afterSignIn('',''),'/');
// What the sign-in page reads back is what the page was.
t('round trip',R.safe(new URL('http://x'+R.loginUrl('/meetings/abc/minutes','?item=50')).searchParams.get('next')),'/meetings/abc/minutes?item=50');
