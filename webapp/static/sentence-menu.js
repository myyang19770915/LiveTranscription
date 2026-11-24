// The live page's sentence menus (ui-sentence-menus, meeting-setup-layout "Sentence words open their setting"): a setting
// word opens a listbox right below it with the options of its own control. The control stays the only state: choosing
// sets it and fires its change event, exactly as choosing it in the settings area would. One menu at a time.
// The menu is a popover (web-platform-polish): top layer, closed by a click outside. Uses window.MenuPopover, so
// account.js loads before this file.
(function () {
  let menu = null, opener = null, done = null, pop = null;

  function element() {
    if (menu) return menu;
    menu = Object.assign(document.createElement('div'), {id: 'sentenceMenu', className: 'sentence-menu', tabIndex: -1});
    menu.setAttribute('role', 'listbox');
    document.body.append(menu);
    pop = MenuPopover.setup(menu, () => opener, inside => finish(inside));
    menu.addEventListener('keydown', onKey);
    menu.addEventListener('click', event => { const option = event.target.closest('[role=option]'); if (option) choose(option); });
    addEventListener('resize', () => close(inMenu()));
    addEventListener('scroll', event => { if (event.target !== menu && !menu.contains(event.target)) close(inMenu()); }, true);   // the list's own scrolling keeps it open
    return menu;
  }

  // The options of a control: a select's own groups and options (hidden ones left out), or the two states of a checkbox.
  function itemsOf(control) {
    if (control.type === 'checkbox') return [{label: '同步播放譯音', value: 'on', selected: control.checked}, {label: '不播放譯音', value: 'off', selected: !control.checked}];
    const items = [];
    const add = option => { if (!option.hidden) items.push({label: option.textContent.trim(), value: option.value, selected: option.selected, disabled: option.disabled}); };
    for (const child of control.children) {
      if (child.tagName === 'OPTGROUP') {
        const options = [...child.children].filter(o => !o.hidden);
        if (!options.length) continue;
        items.push({group: child.label});
        options.forEach(add);
      } else add(child);
    }
    return items;
  }

  function inMenu() { return !!menu && menu.contains(document.activeElement); }   // the focus would be lost with the menu
  function options() { return [...menu.querySelectorAll('[role=option]:not([aria-disabled="true"])')]; }
  function focusOption(option) { if (!option) return; option.focus(); option.scrollIntoView({block: 'nearest'}); }

  function place(button) {
    const r = button.getBoundingClientRect(), gap = 8, margin = 12;
    menu.style.maxHeight = '';
    const below = innerHeight - r.bottom - gap - margin, above = r.top - gap - margin;
    const height = Math.min(menu.scrollHeight, 420);
    const up = height > below && above > below;
    menu.style.maxHeight = `${Math.max(160, Math.min(420, up ? above : below))}px`;
    const width = menu.offsetWidth;
    menu.style.left = `${Math.max(margin, Math.min(r.left, innerWidth - width - margin))}px`;
    menu.style.top = up ? `${Math.max(margin, r.top - gap - Math.min(menu.offsetHeight, above))}px` : `${r.bottom + gap}px`;
  }

  function open(button, control, onDone) {
    element();
    const again = pop.pressedAgain(button);
    if (pop.isOpen() && opener === button) { close(true); return; }
    if (again) return;   // that press already closed this word's menu (light dismiss)
    close(false);
    if (!control || control.disabled) return;
    opener = button; done = onDone;
    menu.dataset.field = control.id;
    menu.setAttribute('aria-label', button.getAttribute('aria-label') || '');
    menu.replaceChildren(...itemsOf(control).map((item, i) => {
      if (item.group) { const g = Object.assign(document.createElement('div'), {className: 'sentence-menu-group', textContent: item.group}); g.setAttribute('role', 'presentation'); return g; }
      const o = Object.assign(document.createElement('div'), {className: 'sentence-menu-option', id: `sentenceMenuOption${i}`, tabIndex: -1, textContent: item.label});
      o.setAttribute('role', 'option'); o.setAttribute('aria-selected', String(item.selected)); o.dataset.value = item.value;
      if (item.disabled) o.setAttribute('aria-disabled', 'true');
      return o;
    }));
    pop.show(button);
    button.setAttribute('aria-expanded', 'true');
    place(button);
    focusOption(menu.querySelector('[role=option][aria-selected="true"]:not([aria-disabled="true"])') || options()[0]);
  }

  function choose(option) {
    if (option.getAttribute('aria-disabled') === 'true') return;
    const control = document.getElementById(menu.dataset.field);
    if (control && !control.disabled) {
      if (control.type === 'checkbox') control.checked = option.dataset.value === 'on';
      else control.value = option.dataset.value;
      const field = menu.dataset.field, after = done;
      close(false);
      control.dispatchEvent(new Event('change', {bubbles: true}));
      after?.(field);
      return;
    }
    close(true);
  }

  function onKey(event) {
    const list = options(), at = list.indexOf(document.activeElement);
    const go = index => { event.preventDefault(); focusOption(list[(index + list.length) % list.length]); };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at < 0 ? list.length - 1 : at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(list.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (at >= 0) choose(list[at]); }
    else if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close(true);   // back on the word first, so Tab goes on to the next word, not past the page
  }

  // refocus: the menu closed without a choice and the focus goes back to the word that opened it.
  function close(refocus) {
    if (!pop || !pop.isOpen()) return;
    const button = finish(false);
    pop.hide();
    if (refocus && button?.isConnected) button.focus({preventScroll: true});
  }
  // The menu is closing, also by itself (a click outside): the word is no longer expanded, and a focus left inside
  // the menu goes back to the word.
  function finish(refocus) {
    const button = opener; opener = null; done = null;
    if (button) { button.setAttribute('aria-expanded', 'false'); if (refocus && button.isConnected) button.focus({preventScroll: true}); }
    return button;
  }

  window.SentenceMenu = {open, close, isOpen: () => !!pop && pop.isOpen()};
})();
