/* @ds-bundle: {"format":4,"namespace":"Kern","components":[{"name":"AppShell"},{"name":"ThemeToggle"},{"name":"Tabs"},{"name":"Button"},{"name":"Field"},{"name":"Switch"},{"name":"Segmented"},{"name":"Badge"},{"name":"Status"},{"name":"Alert"},{"name":"Progress"},{"name":"Dialog"},{"name":"Card"},{"name":"Stat"},{"name":"Sparkline"},{"name":"Meter"},{"name":"SignalBars"},{"name":"DataTable"},{"name":"KeyValue"},{"name":"Copy"},{"name":"JsonTree"}]} */
(function () {
  'use strict';
  var STORAGE_KEY = 'kern-theme';
  var THEMES = ['dark', 'light'];
  var SVG = 'http://www.w3.org/2000/svg';

  function svgIcon(paths) {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  var ICONS = {
    sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85"/>',
    moon: '<path d="M13.5 9.6A5.5 5.5 0 0 1 6.4 2.5a5.5 5.5 0 1 0 7.1 7.1Z"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.9c0-.8-.6-1.4-1.4-1.4H3.9c-.8 0-1.4.6-1.4 1.4v5.2c0 .8.6 1.4 1.4 1.4h1.6"/>',
    check: '<path d="m3.5 8.5 3 3 6-7"/>',
    close: '<path d="m4 4 8 8M12 4l-8 8"/>'
  };

  /* ---------- Theme ---------- */
  function readStored() {
    try { var v = localStorage.getItem(STORAGE_KEY); return THEMES.indexOf(v) >= 0 ? v : null; } catch (e) { return null; }
  }
  function getTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    return THEMES.indexOf(t) >= 0 ? t : 'dark';
  }
  function setTheme(theme, opts) {
    if (THEMES.indexOf(theme) < 0) return;
    document.documentElement.setAttribute('data-theme', theme);
    if (!opts || opts.persist !== false) { try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* storage blocked */ } }
    document.dispatchEvent(new CustomEvent('kern-themechange', { detail: { theme: theme } }));
  }
  function initTheme(opts) {
    var fallback = (opts && opts.default) || 'dark';
    if (fallback === 'system') fallback = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(readStored() || fallback, { persist: false });
  }

  function define(name, cls) { if (!customElements.get(name)) customElements.define(name, cls); }

  class ThemeToggle extends HTMLElement {
    static get observedAttributes() { return ['label-light', 'label-dark']; }
    attributeChangedCallback() { if (this._btn) this._label(); }
    connectedCallback() {
      if (this._btn) return;
      var self = this;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'k-btn k-btn--ghost k-btn--icon' + (this.hasAttribute('small') ? ' k-btn--sm' : '');
      btn.innerHTML = svgIcon(ICONS.moon).replace('<svg', '<svg class="k-icon-moon"') + svgIcon(ICONS.sun).replace('<svg', '<svg class="k-icon-sun"');
      btn.addEventListener('click', function () { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); });
      this.appendChild(btn);
      this._btn = btn;
      this._sync = function () { self._label(); };
      this._obs = new MutationObserver(this._sync);
      this._obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      this._label();
    }
    disconnectedCallback() { if (this._obs) this._obs.disconnect(); }
    _label() {
      var dark = getTheme() === 'dark';
      var l = dark ? (this.getAttribute('label-light') || 'Zu hellem Design wechseln') : (this.getAttribute('label-dark') || 'Zu dunklem Design wechseln');
      this._btn.setAttribute('aria-label', l);
      this._btn.title = l;
    }
  }

  /* ---------- Sparkline ---------- */
  class Sparkline extends HTMLElement {
    static get observedAttributes() { return ['values', 'min', 'max', 'fill']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    set values(v) { this.setAttribute('values', (v || []).join(',')); }
    get values() { return (this.getAttribute('values') || '').split(',').map(Number).filter(function (n) { return !isNaN(n); }); }
    render() {
      var v = this.values;
      var W = 100, H = 32;
      var min = this.hasAttribute('min') ? Number(this.getAttribute('min')) : Math.min.apply(null, v);
      var max = this.hasAttribute('max') ? Number(this.getAttribute('max')) : Math.max.apply(null, v);
      if (!v.length) { this.innerHTML = ''; return; }
      if (max === min) { max += 1; min -= 1; }
      var pts = v.map(function (n, i) {
        var x = v.length === 1 ? W : (i / (v.length - 1)) * W;
        var y = H - 2 - ((n - min) / (max - min)) * (H - 4);
        return x.toFixed(2) + ',' + y.toFixed(2);
      });
      var area = this.hasAttribute('fill') ? '<polygon points="0,' + H + ' ' + pts.join(' ') + ' ' + W + ',' + H + '" fill="currentColor" fill-opacity="0.14" stroke="none"/>' : '';
      this.innerHTML = '<svg xmlns="' + SVG + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(this.getAttribute('label') || 'Verlauf') + '">' + area +
        '<polyline points="' + pts.join(' ') + '" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    }
  }

  /* ---------- Meter ---------- */
  class Meter extends HTMLElement {
    static get observedAttributes() { return ['value', 'max', 'warn', 'danger', 'label', 'unit', 'neutral']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      var value = Number(this.getAttribute('value') || 0), max = Number(this.getAttribute('max') || 100);
      var pct = Math.max(0, Math.min(100, (value / max) * 100));
      var warn = this.hasAttribute('warn') ? Number(this.getAttribute('warn')) : 75;
      var danger = this.hasAttribute('danger') ? Number(this.getAttribute('danger')) : 90;
      var level = this.hasAttribute('neutral') ? 'neutral' : pct >= danger ? 'danger' : pct >= warn ? 'warn' : 'ok';
      this.setAttribute('data-level', level);
      var unit = this.getAttribute('unit') || '%';
      var shown = unit === '%' ? Math.round(pct) + ' %' : value + ' ' + unit;
      var label = this.getAttribute('label') || '';
      this.setAttribute('role', 'meter');
      this.setAttribute('aria-valuenow', String(value));
      this.setAttribute('aria-valuemin', '0');
      this.setAttribute('aria-valuemax', String(max));
      if (label) this.setAttribute('aria-label', label);
      this.innerHTML = '<div class="k-meter__head"><span>' + esc(label) + '</span><span class="k-meter__value">' + shown + '</span></div>' +
        '<div class="k-meter__track"><div class="k-meter__fill" style="width:' + pct + '%"></div></div>';
    }
  }

  /* ---------- SignalBars ---------- */
  function rssiLevel(rssi) { return rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -75 ? 2 : rssi >= -85 ? 1 : 0; }
  class SignalBars extends HTMLElement {
    static get observedAttributes() { return ['rssi', 'hide-value']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      var rssi = Number(this.getAttribute('rssi'));
      var lvl = isNaN(rssi) ? 0 : rssiLevel(rssi);
      this.setAttribute('data-level', String(lvl));
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', (this.getAttribute('label') || 'WLAN-Signal') + ' ' + lvl + '/4' + (isNaN(rssi) ? '' : ', ' + rssi + ' dBm'));
      var bars = '';
      for (var i = 1; i <= 4; i++) bars += '<i class="' + (i <= lvl ? 'on' : '') + '"></i>';
      this.innerHTML = '<span class="k-signal__bars" aria-hidden="true">' + bars + '</span>' +
        (this.hasAttribute('hide-value') || isNaN(rssi) ? '' : '<span aria-hidden="true">' + rssi + ' dBm</span>');
    }
  }

  /* ---------- Copy ---------- */
  class Copy extends HTMLElement {
    connectedCallback() {
      if (this._done) return;
      this._done = true;
      var self = this;
      var text = this.textContent.trim();
      var value = this.getAttribute('value') || text;
      this.textContent = '';
      var span = document.createElement('span');
      span.className = 'k-copy__text';
      span.textContent = text || value;
      var btn = document.createElement('button');
      btn.type = 'button';
      var label = this.getAttribute('label') || 'Kopieren';
      btn.setAttribute('aria-label', label + ': ' + value);
      btn.title = label;
      btn.innerHTML = svgIcon(ICONS.copy);
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var v = self.getAttribute('value') || span.textContent;
        var done = function () {
          self.setAttribute('data-copied', '');
          btn.innerHTML = svgIcon(ICONS.check);
          clearTimeout(self._t);
          self._t = setTimeout(function () { self.removeAttribute('data-copied'); btn.innerHTML = svgIcon(ICONS.copy); }, 1200);
          self.dispatchEvent(new CustomEvent('kern-copy', { bubbles: true, detail: { value: v } }));
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () {});
      });
      this.appendChild(span);
      this.appendChild(btn);
    }
  }

  /* ---------- JsonTree ---------- */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function leaf(v) {
    if (v === null || typeof v === 'boolean') return '<span class="k-json__literal">' + String(v) + '</span>';
    if (typeof v === 'number') return '<span class="k-json__number">' + v + '</span>';
    return '<span class="k-json__string">"' + esc(v) + '"</span>';
  }
  function node(key, v, depth, openDepth) {
    var k = key === null ? '' : '<span class="k-json__key">' + esc(key) + '</span>: ';
    if (v === null || typeof v !== 'object') return '<div class="k-json__leaf">' + k + leaf(v) + '</div>';
    var isArr = Array.isArray(v);
    var keys = Object.keys(v);
    var open = depth < openDepth ? ' open' : '';
    var meta = isArr ? '[' + keys.length + ']' : '{' + keys.length + '}';
    var kids = keys.map(function (kk) { return node(isArr ? kk : kk, v[kk], depth + 1, openDepth); }).join('');
    return '<details' + open + '><summary>' + k + '<span class="k-json__meta">' + meta + '</span></summary><div class="k-json__children">' + kids + '</div></details>';
  }
  class JsonTree extends HTMLElement {
    static get observedAttributes() { return ['json', 'open-depth']; }
    connectedCallback() {
      if (this._data === undefined && !this.hasAttribute('json') && this.textContent.trim()) {
        try { this._data = JSON.parse(this.textContent); } catch (e) { this._data = this.textContent; }
      }
      this.render();
    }
    attributeChangedCallback(n, o, v) {
      if (n === 'json') { try { this._data = JSON.parse(v); } catch (e) { this._data = v; } }
      if (this.isConnected) this.render();
    }
    set data(v) { this._data = v; if (this.isConnected) this.render(); }
    get data() { return this._data; }
    render() {
      if (this._data === undefined) { this.innerHTML = ''; return; }
      var d = Number(this.getAttribute('open-depth') || 1);
      var data = this._data;
      if (data !== null && typeof data === 'object') {
        var isArr = Array.isArray(data);
        this.innerHTML = Object.keys(data).map(function (k) { return node(isArr ? k : k, data[k], 0, d); }).join('');
      } else {
        this.innerHTML = node(null, data, 0, d);
      }
    }
  }

  /* ---------- Tabs ---------- */
  class Tabs extends HTMLElement {
    connectedCallback() {
      if (this._wired) return;
      this._wired = true;
      var self = this;
      var tabs = this.tabs();
      tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { self.select(i); });
        tab.addEventListener('keydown', function (e) {
          var n = tabs.length, j = null;
          if (e.key === 'ArrowRight') j = (i + 1) % n;
          if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
          if (e.key === 'Home') j = 0;
          if (e.key === 'End') j = n - 1;
          if (j !== null) { e.preventDefault(); self.select(j); tabs[j].focus(); }
        });
      });
      var start = tabs.findIndex(function (t) { return t.getAttribute('aria-selected') === 'true'; });
      this.select(start < 0 ? 0 : start, true);
    }
    tabs() { return Array.prototype.slice.call(this.querySelectorAll(':scope > .k-tabs__list [role="tab"]')); }
    panels() { return Array.prototype.slice.call(this.querySelectorAll(':scope > [role="tabpanel"]')); }
    select(i, silent) {
      var tabs = this.tabs(), panels = this.panels();
      tabs.forEach(function (t, j) { t.setAttribute('aria-selected', String(i === j)); t.tabIndex = i === j ? 0 : -1; });
      panels.forEach(function (p, j) { p.hidden = i !== j; });
      if (!silent) this.dispatchEvent(new CustomEvent('kern-tabchange', { bubbles: true, detail: { index: i } }));
    }
  }

  /* ---------- confirm() ---------- */
  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var d = document.createElement('dialog');
      d.className = 'k-dialog';
      var expected = opts.typeToConfirm || '';
      d.innerHTML =
        '<form method="dialog">' +
        '<div class="k-dialog__header"><h2 class="k-dialog__title"></h2></div>' +
        '<div class="k-dialog__body"><p class="k-dialog__msg"></p>' +
        (expected ? '<label class="k-field"><span class="k-field__label"></span><input class="k-input k-input--mono" autocomplete="off" spellcheck="false"></label>' : '') +
        '</div><div class="k-dialog__footer"><button type="button" class="k-btn" value="cancel"></button>' +
        '<button class="k-btn ' + (opts.danger ? 'k-btn--danger' : 'k-btn--primary') + '" value="ok"></button></div></form>';
      d.querySelector('.k-dialog__title').textContent = opts.title || '';
      d.querySelector('.k-dialog__msg').textContent = opts.message || '';
      var btns = d.querySelectorAll('.k-dialog__footer button');
      btns[0].textContent = opts.cancelLabel || 'Abbrechen';
      btns[1].textContent = opts.confirmLabel || 'OK';
      var input = d.querySelector('input');
      if (input) {
        d.querySelector('.k-field__label').textContent = opts.typeToConfirmLabel || ('Zur Bestätigung «' + expected + '» eintippen');
        btns[1].disabled = true;
        input.addEventListener('input', function () { btns[1].disabled = input.value.trim().toUpperCase() !== expected.toUpperCase(); });
      }
      btns[0].addEventListener('click', function () { d.close('cancel'); });
      d.addEventListener('close', function () { resolve(d.returnValue === 'ok'); d.remove(); });
      document.body.appendChild(d);
      d.showModal();
      (input || btns[0]).focus();
    });
  }

  define('kern-theme-toggle', ThemeToggle);
  define('kern-sparkline', Sparkline);
  define('kern-meter', Meter);
  define('kern-signal', SignalBars);
  define('kern-copy', Copy);
  define('kern-json', JsonTree);
  define('kern-tabs', Tabs);

  function css(className, tag) { return { kind: 'css', className: className, tag: tag || null }; }

  window.Kern = {
    version: '0.1.0',
    themes: THEMES.slice(),
    getTheme: getTheme,
    setTheme: setTheme,
    initTheme: initTheme,
    confirm: confirmDialog,
    rssiLevel: rssiLevel,
    icons: ICONS,
    AppShell: css('k-shell'),
    ThemeToggle: ThemeToggle,
    Tabs: Tabs,
    Button: css('k-btn', 'button'),
    Field: css('k-field', 'label'),
    Switch: css('k-switch', 'label'),
    Segmented: css('k-segmented', 'div'),
    Badge: css('k-badge', 'span'),
    Status: css('k-status', 'span'),
    Alert: css('k-alert', 'div'),
    Progress: css('k-progress', 'progress'),
    Dialog: css('k-dialog', 'dialog'),
    Card: css('k-card', 'section'),
    Stat: css('k-stat', 'div'),
    Sparkline: Sparkline,
    Meter: Meter,
    SignalBars: SignalBars,
    DataTable: css('k-table', 'table'),
    KeyValue: css('k-kv', 'dl'),
    Copy: Copy,
    JsonTree: JsonTree
  };
})();
