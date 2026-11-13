/* Where to go after signing in (user-auth: "Sign-in returns to the requested page"). The sign-in page gets
   the page the user wanted as ?next=; only a path on this site is accepted, anything else leads to "/". */
(function(root){
  // A single leading "/" keeps it on this origin; "//host" and "/\host" are other hosts to a browser.
  function safe(next){
    if(typeof next!=='string'||next[0]!=='/')return '/';
    if(next[1]==='/'||next.includes('\\')||/[\u0000-\u001f\u007f]/.test(next))return '/';
    return next;
  }
  function loginUrl(path,search){
    const here=(path||'/')+(search||'');
    return here==='/'||here.length>2000?'/login':'/login?next='+encodeURIComponent(here);   // same limit as the server's redirect
  }
  // The sign-in page's own address tells where to go: ?next= checked, its #fragment kept (a redirect keeps it).
  function afterSignIn(search,hash){return safe(new URLSearchParams(search||'').get('next'))+(hash||'')}
  root.ReturnPath={safe,loginUrl,afterSignIn};
  if(typeof module!=='undefined')module.exports=root.ReturnPath;
})(typeof globalThis!=='undefined'?globalThis:this);
