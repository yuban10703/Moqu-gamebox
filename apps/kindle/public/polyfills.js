/**
 * ES5 环境补丁（Kindle 老 WebKit 兼容）。
 * 仅填补核心缺口：Promise、Symbol、Set/Map、Array/Object/String 方法、classList。
 * 体积极小、无副作用、可在无控制台环境安全执行。
 */
(function (global) {
  'use strict';

  // ---------- Symbol ----------
  /*
   * 注意这里**不能写 `var Symbol = ...`**：那会在本 IIFE 作用域里遮蔽掉全局的 Symbol，
   * 而赋值只在 `if` 分支里发生 —— 于是在**原生就有 Symbol** 的引擎上，
   * 后面的代码看到的 `Symbol` 是 undefined，`Array.prototype[Symbol.iterator] = ...`
   * 直接抛 "Cannot read properties of undefined"。（这个 bug 被产物启动测试逮住过。）
   * 所以：一律通过 global.Symbol 取，最后再用一个局部的 Sym 引用它。
   */
  if (typeof global.Symbol === 'undefined') {
    global.Symbol = (function () {
      var Sym = function (desc) {
        var id = '__sym_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
        return { toString: function () { return 'Symbol(' + (desc || '') + ')'; }, valueOf: function () { return id; } };
      };
      Sym.iterator = Sym('Symbol.iterator');
      Sym.hasInstance = Sym('Symbol.hasInstance');
      Sym.toStringTag = Sym('Symbol.toStringTag');
      return Sym;
    })();
  }
  // 后面一律用这个别名：它要么是原生的，要么是上面补的，且**不遮蔽**任何东西
  var Sym = global.Symbol;

  // ---------- Object.assign ----------
  if (typeof Object.assign !== 'function') {
    Object.assign = function (target) {
      if (target === null || target === undefined) { throw new TypeError('Cannot convert undefined or null to object'); }
      var to = Object(target);
      for (var i = 1; i < arguments.length; i++) {
        var src = arguments[i];
        if (src !== null && src !== undefined) {
          for (var key in src) { if (Object.prototype.hasOwnProperty.call(src, key)) { to[key] = src[key]; } }
        }
      }
      return to;
    };
  }

  // ---------- Array.from ----------
  if (typeof Array.from !== 'function') {
    Array.from = function (arrayLike, mapFn, thisArg) {
      if (arrayLike === null || arrayLike === undefined) { throw new TypeError('Array.from requires an array-like object'); }
      var list = Object(arrayLike);
      var len = list.length >>> 0;
      var result = new Array(len);
      var fn = typeof mapFn === 'function' ? mapFn : function (v) { return v; };
      for (var i = 0; i < len; i++) { if (i in list) { result[i] = fn.call(thisArg, list[i], i, list); } }
      return result;
    };
  }

  // ---------- Array.prototype.find / findIndex ----------
  if (!Array.prototype.find) {
    Array.prototype.find = function (predicate, thisArg) {
      if (this === null || this === undefined) { throw new TypeError('Array.prototype.find called on null or undefined'); }
      if (typeof predicate !== 'function') { throw new TypeError('predicate must be a function'); }
      var list = Object(this);
      var len = list.length >>> 0;
      for (var i = 0; i < len; i++) { if (i in list) { var val = list[i]; if (predicate.call(thisArg, val, i, list)) { return val; } } }
      return undefined;
    };
  }
  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function (predicate, thisArg) {
      if (this === null || this === undefined) { throw new TypeError('Array.prototype.findIndex called on null or undefined'); }
      if (typeof predicate !== 'function') { throw new TypeError('predicate must be a function'); }
      var list = Object(this);
      var len = list.length >>> 0;
      for (var i = 0; i < len; i++) { if (i in list) { var val = list[i]; if (predicate.call(thisArg, val, i, list)) { return i; } } }
      return -1;
    };
  }

  // ---------- String.prototype.startsWith / endsWith / includes ----------
  if (!String.prototype.startsWith) {
    String.prototype.startsWith = function (search, pos) {
      var s = String(this);
      var searchStr = String(search);
      var position = pos === undefined ? 0 : Math.min(Math.max(pos, 0), s.length);
      return s.slice(position, position + searchStr.length) === searchStr;
    };
  }
  if (!String.prototype.endsWith) {
    String.prototype.endsWith = function (search, pos) {
      var s = String(this);
      var searchStr = String(search);
      var len = pos === undefined ? s.length : Math.min(Math.max(pos, 0), s.length);
      return s.slice(len - searchStr.length, len) === searchStr;
    };
  }
  if (!String.prototype.includes) {
    String.prototype.includes = function (search, pos) {
      return String(this).indexOf(String(search), pos) !== -1;
    };
  }
  if (!String.prototype.trim) {
    String.prototype.trim = function () { return String(this).replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, ''); };
  }

  // ---------- classList polyfill (for old WebKit) ----------
  // 仅在不支持时注入，使用 DOMTokenList 兼容实现
  if (typeof document !== 'undefined' && document.documentElement && !('classList' in document.documentElement)) {
    (function () {
      function ClassList(element) { this._el = element; this._classes = (element.className || '').split(/\s+/); }
      ClassList.prototype = {
        add: function (c) { if (!this.contains(c)) { this._classes.push(c); this._update(); } },
        remove: function (c) { var idx = this._classes.indexOf(c); if (idx !== -1) { this._classes.splice(idx, 1); this._update(); } },
        contains: function (c) { return this._classes.indexOf(c) !== -1; },
        toggle: function (c, force) { if (force === undefined) { force = !this.contains(c); } if (force) { this.add(c); } else { this.remove(c); } return force; },
        _update: function () { this._el.className = this._classes.join(' '); }
      };
      Object.defineProperty(Element.prototype, 'classList', { get: function () { return new ClassList(this); }, configurable: true });
    })();
  }

  // ---------- Promise (minimal, ES5-compatible) ----------
  if (typeof global.Promise === 'undefined') {
    var PENDING = 0, FULFILLED = 1, REJECTED = 2;

    function Promise(executor) {
      if (typeof executor !== 'function') { throw new TypeError('Promise resolver must be a function'); }
      var self = this;
      self._state = PENDING;
      self._value = undefined;
      self._handlers = [];
      function resolve(value) { finalize(FULFILLED, value); }
      function reject(reason) { finalize(REJECTED, reason); }
      function finalize(state, value) {
        if (self._state !== PENDING) { return; }
        self._state = state;
        self._value = value;
        var handlers = self._handlers;
        self._handlers = null;
        for (var i = 0; i < handlers.length; i++) { handlers[i](state, value); }
      }
      try { executor(resolve, reject); } catch (e) { reject(e); }
    }

    Promise.prototype.then = function (onFulfilled, onRejected) {
      var self = this;
      return new Promise(function (resolve, reject) {
        function handle(state, value) {
          var fn = state === FULFILLED ? onFulfilled : onRejected;
          if (typeof fn !== 'function') { (state === FULFILLED ? resolve : reject)(value); return; }
          try { resolve(fn(value)); } catch (e) { reject(e); }
        }
        if (self._state === PENDING) { self._handlers.push(handle); }
        else { handle(self._state, self._value); }
      });
    };

    Promise.prototype.catch = function (onRejected) { return this.then(undefined, onRejected); };

    Promise.resolve = function (value) { return new Promise(function (resolve) { resolve(value); }); };
    Promise.reject = function (reason) { return new Promise(function (resolve, reject) { reject(reason); }); };

    global.Promise = Promise;
  }

  // ---------- Set / Map (with iterator protocol for downlevelIteration) ----------
  // 仅在原生缺失时提供极简实现，满足 tsc --downlevelIteration 产物的迭代需求
  if (typeof global.Set === 'undefined') {
    global.Set = function (iterable) {
      this._values = [];
      this.size = 0;
      if (iterable && typeof iterable[Sym.iterator] === 'function') {
        var it = iterable[Sym.iterator]();
        for (var r = it.next(); !r.done; r = it.next()) { this.add(r.value); }
      }
    };
    global.Set.prototype = {
      add: function (v) { if (this._values.indexOf(v) === -1) { this._values.push(v); this.size++; } return this; },
      has: function (v) { return this._values.indexOf(v) !== -1; },
      delete: function (v) { var i = this._values.indexOf(v); if (i !== -1) { this._values.splice(i, 1); this.size--; return true; } return false; },
      clear: function () { this._values = []; this.size = 0; },
      forEach: function (fn, ctx) { for (var i = 0; i < this._values.length; i++) { fn.call(ctx, this._values[i], this._values[i], this); } },
      keys: function () { return this.values(); },
      values: function () {
        var arr = this._values, idx = 0;
        return { next: function () { return idx < arr.length ? { value: arr[idx++], done: false } : { done: true }; } };
      },
      entries: function () { return this.values(); }
    };
    // 计算属性名（[Symbol.iterator]: ...）是 ES2015 语法，不能写在字面量里：
    // 本文件必须通篇 ES5，否则在老引擎上整段脚本不执行。
    global.Set.prototype[Sym.iterator] = function () { return this.values(); };
  }

  if (typeof global.Map === 'undefined') {
    global.Map = function (iterable) {
      this._keys = []; this._vals = []; this.size = 0;
      if (iterable && typeof iterable[Sym.iterator] === 'function') {
        var it = iterable[Sym.iterator]();
        for (var r = it.next(); !r.done; r = it.next()) { if (r.value && r.value.length === 2) { this.set(r.value[0], r.value[1]); } }
      }
    };
    global.Map.prototype = {
      set: function (k, v) { var i = this._keys.indexOf(k); if (i === -1) { this._keys.push(k); this._vals.push(v); this.size++; } else { this._vals[i] = v; } return this; },
      get: function (k) { var i = this._keys.indexOf(k); return i !== -1 ? this._vals[i] : undefined; },
      has: function (k) { return this._keys.indexOf(k) !== -1; },
      delete: function (k) { var i = this._keys.indexOf(k); if (i !== -1) { this._keys.splice(i, 1); this._vals.splice(i, 1); this.size--; return true; } return false; },
      clear: function () { this._keys = []; this._vals = []; this.size = 0; },
      forEach: function (fn, ctx) { for (var i = 0; i < this._keys.length; i++) { fn.call(ctx, this._vals[i], this._keys[i], this); } },
      keys: function () { var arr = this._keys, idx = 0; return { next: function () { return idx < arr.length ? { value: arr[idx++], done: false } : { done: true }; } }; },
      values: function () { var arr = this._vals, idx = 0; return { next: function () { return idx < arr.length ? { value: arr[idx++], done: false } : { done: true }; } }; },
      entries: function () { var k = this._keys, v = this._vals, idx = 0; return { next: function () { return idx < k.length ? { value: [k[idx], v[idx++]], done: false } : { done: true }; } }; }
    };
    global.Map.prototype[Sym.iterator] = function () { return this.entries(); };
  }

  /*
   * ---------- post-ES5 方法补齐 ----------
   *
   * 这一段的清单不是猜的：是把 packages/core、packages/games/*、packages/library 与
   * apps/kindle/src 全量扫过一遍、统计实际用到的 ES2015+ **运行时方法**之后列出来的
   * （见 tools/scripts/check-es5-apis.mjs 的守卫测试，漏一个就会在真机上炸）。
   * 只补用到的方法，不搬运一整个 core-js。
   */

  // Array.prototype.includes（ES2016）—— 共用代码里用得最多（100+ 处）
  if (!Array.prototype.includes) {
    Array.prototype.includes = function (search, fromIndex) {
      var list = Object(this);
      var len = list.length >>> 0;
      if (len === 0) { return false; }
      var start = fromIndex === undefined ? 0 : fromIndex >> 0;
      if (start < 0) { start = Math.max(len + start, 0); }
      for (var i = start; i < len; i++) {
        var value = list[i];
        // SameValueZero：NaN 视为等于 NaN
        if (value === search || (value !== value && search !== search)) { return true; }
      }
      return false;
    };
  }

  // Array.prototype.flat / flatMap（ES2019）
  if (!Array.prototype.flat) {
    Array.prototype.flat = function (depth) {
      var levels = depth === undefined ? 1 : depth >> 0;
      var out = [];
      function flatten(list, remaining) {
        for (var i = 0; i < list.length; i++) {
          var value = list[i];
          if (remaining > 0 && Object.prototype.toString.call(value) === '[object Array]') {
            flatten(value, remaining - 1);
          } else if (value !== undefined) {
            out.push(value);
          }
        }
      }
      flatten(Object(this), levels);
      return out;
    };
  }
  if (!Array.prototype.flatMap) {
    Array.prototype.flatMap = function (fn, thisArg) {
      var mapped = [];
      var list = Object(this);
      for (var i = 0; i < list.length; i++) {
        if (i in list) { mapped.push(fn.call(thisArg, list[i], i, list)); }
      }
      return mapped.length === 0 ? [] : (Array.prototype.flat ? mapped.flat() : mapped);
    };
  }

  // Array.prototype.at（ES2022）—— 只有少量调用点，但缺了会直接抛错
  if (!Array.prototype.at) {
    Array.prototype.at = function (index) {
      var list = Object(this);
      var len = list.length >>> 0;
      var i = index >> 0;
      if (i < 0) { i += len; }
      return i < 0 || i >= len ? undefined : list[i];
    };
  }

  // Object.entries / values / fromEntries（ES2017 / ES2019）
  if (typeof Object.entries !== 'function') {
    Object.entries = function (obj) {
      var out = [];
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) { out.push([key, obj[key]]); }
      }
      return out;
    };
  }
  if (typeof Object.values !== 'function') {
    Object.values = function (obj) {
      var out = [];
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) { out.push(obj[key]); }
      }
      return out;
    };
  }
  if (typeof Object.fromEntries !== 'function') {
    Object.fromEntries = function (entries) {
      var out = {};
      for (var i = 0; i < entries.length; i++) {
        var pair = entries[i];
        if (pair && pair.length === 2) { out[pair[0]] = pair[1]; }
      }
      return out;
    };
  }

  // String.prototype.repeat / padStart / padEnd / codePointAt（ES2015 / ES2017）
  if (!String.prototype.repeat) {
    String.prototype.repeat = function (count) {
      var text = String(this);
      var times = count >> 0;
      if (times < 0 || times === Infinity) { throw new RangeError('Invalid count value'); }
      var out = '';
      for (var i = 0; i < times; i++) { out += text; }
      return out;
    };
  }
  if (!String.prototype.padStart) {
    String.prototype.padStart = function (targetLength, padString) {
      var text = String(this);
      var target = targetLength >> 0;
      var pad = padString === undefined ? ' ' : String(padString);
      if (text.length >= target || pad === '') { return text; }
      var needed = target - text.length;
      var fill = '';
      while (fill.length < needed) { fill += pad; }
      return fill.slice(0, needed) + text;
    };
  }
  if (!String.prototype.padEnd) {
    String.prototype.padEnd = function (targetLength, padString) {
      var text = String(this);
      var target = targetLength >> 0;
      var pad = padString === undefined ? ' ' : String(padString);
      if (text.length >= target || pad === '') { return text; }
      var needed = target - text.length;
      var fill = '';
      while (fill.length < needed) { fill += pad; }
      return text + fill.slice(0, needed);
    };
  }
  if (!String.prototype.codePointAt) {
    String.prototype.codePointAt = function (position) {
      var text = String(this);
      var index = position >> 0;
      if (index < 0 || index >= text.length) { return undefined; }
      var first = text.charCodeAt(index);
      if (first >= 0xd800 && first <= 0xdbff && index + 1 < text.length) {
        var second = text.charCodeAt(index + 1);
        if (second >= 0xdc00 && second <= 0xdfff) {
          return (first - 0xd800) * 0x400 + second - 0xdc00 + 0x10000;
        }
      }
      return first;
    };
  }

  // Number.parseInt / parseFloat（ES2015）
  if (!Number.parseInt) { Number.parseInt = parseInt; }
  if (!Number.parseFloat) { Number.parseFloat = parseFloat; }

  /*
   * Array.prototype[Symbol.iterator]：
   * tsc 的 --downlevelIteration 产物（__values / __read / __spreadArray）会读 `o[Symbol.iterator]`。
   * 老引擎的数组没有这个键，而 Symbol 又是本文件补的假 Symbol（对象当键时会被字符串化），
   * 所以这里必须按**同一个键**把迭代器补上，否则 for...of 数组会在真机上直接抛错。
   */
  if (typeof Array.prototype[Sym.iterator] !== 'function') {
    Array.prototype[Sym.iterator] = function () {
      var list = this;
      var index = 0;
      return {
        next: function () {
          return index < list.length ? { value: list[index++], done: false } : { value: undefined, done: true };
        }
      };
    };
  }

  // ---------- Number.isNaN / isFinite / isInteger ----------
  if (!Number.isNaN) { Number.isNaN = function (v) { return typeof v === 'number' && v !== v; }; }
  if (!Number.isFinite) { Number.isFinite = function (v) { return typeof v === 'number' && isFinite(v); }; }
  if (!Number.isInteger) { Number.isInteger = function (v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }; }

  // ---------- Math.trunc / sign (用于某些 polyfill 内部) ----------
  if (!Math.trunc) { Math.trunc = function (v) { return v < 0 ? Math.ceil(v) : Math.floor(v); }; }
  if (!Math.sign) { Math.sign = function (v) { if (v === 0 || isNaN(v)) { return v; } return v > 0 ? 1 : -1; }; }

  // ---------- Object.keys / create / defineProperty (老 WebKit 可能不完整) ----------
  // 基本可用，这里不再重写

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);