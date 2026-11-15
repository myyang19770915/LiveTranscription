// The loading row a result region shows while a slow request runs (loading-feedback): a spinner and a verb, plus three
// placeholder lines when the region held no results yet (an intro or empty-state card does not count and is hidden
// meanwhile). The region keeps its height: over earlier results the row floats instead of pushing them down. Hidden from assistive technology: the page's polite summary announces the wait.
// Callers show it only once the request has run for 200 ms, so fast requests never flash it.
const LoadingState={
  show(region,verb){
    LoadingState.hide(region);
    const hasResults=[...region.children].some(child=>!child.classList.contains('search-empty'));
    region.style.minHeight=`${region.offsetHeight}px`;
    region.classList.toggle('no-results',!hasResults);
    const row=document.createElement('div');row.className='loading-row';
    row.append(Object.assign(document.createElement('span'),{className:'spinner'}),verb);
    const state=document.createElement('div');state.className='loading-state';state.setAttribute('aria-hidden','true');
    state.append(row);
    if(!hasResults){
      const lines=document.createElement('div');lines.className='loading-lines';
      lines.append(...[0,1,2].map(()=>document.createElement('i')));
      state.append(lines);
    }
    state.classList.toggle('floating',hasResults);   // over the earlier results, so nothing moves
    region.prepend(state);
  },
  hide(region){
    region.querySelectorAll(':scope > .loading-state').forEach(node=>node.remove());
    region.style.minHeight='';
    region.classList.remove('no-results');
  },
};
