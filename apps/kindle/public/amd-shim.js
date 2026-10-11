/**
 * 极简 AMD 加载器（ES5，无依赖）。
 *
 * 为什么需要它：tsc 的 `--module AMD --outFile` 是**唯一**能把这套 TypeScript
 * （含 async/await、class、迭代）完整降到 ES5 的工具链 —— Vite 8 用的 rolldown
 * 明确不支持 ES2015 以下（"Rolldown only supports ES2015 (ES6) and later"）。
 * AMD 产物需要有人执行 `define()`，这就是那 60 行。
 *
 * 语法约束：本文件在**老 WebKit 上先于一切执行**，因此通篇 ES5
 * （无 let/const、无箭头函数、无模板字符串），由 tools/scripts/check-es5.mjs 守卫。
 */
(function (global) {
  'use strict';

  var registry = {};   // 模块名 -> 导出对象
  var pending = [];    // 依赖尚未就绪的 define
  var defined = {};    // 模块名 -> 已执行过 factory

  function has(name) {
    return Object.prototype.hasOwnProperty.call(registry, name);
  }

  function isArray(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  }

  /** 模块内 `require('./x')` 用的本地 require（本项目源码里没有动态 require，留作兜底） */
  function localRequire(name) {
    if (has(name)) { return registry[name]; }
    throw new Error('module not loaded: ' + name);
  }

  /**
   * 尝试执行一个 define；依赖没齐就放回 pending，等后续 define 触发 flush。
   */
  function tryDefine(record) {
    var deps = record.deps;
    var args = [];
    var exportsObject = null;
    for (var i = 0; i < deps.length; i++) {
      var dep = deps[i];
      if (dep === 'require') {
        args.push(localRequire);
      } else if (dep === 'exports') {
        exportsObject = {};
        args.push(exportsObject);
      } else if (dep === 'module') {
        args.push({ id: record.name, exports: exportsObject || {} });
      } else if (has(dep)) {
        args.push(registry[dep]);
      } else {
        return false; // 依赖未就绪
      }
    }
    defined[record.name] = true;
    var returned = record.factory.apply(null, args);
    // 三选一：factory 显式 return、exports 对象、或空对象
    if (returned !== undefined) {
      registry[record.name] = returned;
    } else if (exportsObject !== null) {
      registry[record.name] = exportsObject;
    } else if (!has(record.name)) {
      registry[record.name] = {};
    }
    return true;
  }

  function flush() {
    var progress = true;
    while (progress) {
      progress = false;
      var remaining = [];
      for (var i = 0; i < pending.length; i++) {
        if (tryDefine(pending[i])) { progress = true; }
        else { remaining.push(pending[i]); }
      }
      pending = remaining;
    }
  }

  global.define = function (name, deps, factory) {
    // 允许省略模块名（匿名 define）：tsc 的 outFile 产物总是给名字，这里只做兜底
    if (typeof name !== 'string') {
      factory = deps;
      deps = name;
      name = '_anon_' + String(pending.length) + '_' + String(Object.keys ? Object.keys(registry).length : 0);
    }
    if (!isArray(deps)) {
      factory = deps;
      deps = [];
    }
    if (typeof factory !== 'function') {
      // define('x', {}) 这种直接给值的写法：本项目没有，但留个口子
      registry[name] = factory;
      flush();
      return;
    }
    if (defined[name]) { return; } // 重复 define：第一次为准，不重复执行
    var record = { name: name, deps: deps, factory: factory };
    if (!tryDefine(record)) { pending.push(record); }
    flush();
  };
  global.define.amd = {};

  global.require = localRequire;

  /** 排障用：能看到到底加载了多少个模块（诊断页会读它） */
  global.__MOQU_AMD__ = {
    count: function () { return Object.keys ? Object.keys(registry).length : 0; },
    pending: function () { return pending.length; },
    has: has
  };
})(typeof window !== 'undefined' ? window : this);
