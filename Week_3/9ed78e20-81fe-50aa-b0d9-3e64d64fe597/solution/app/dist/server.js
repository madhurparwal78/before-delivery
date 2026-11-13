import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all2) => {
  for (var name in all2)
    __defProp(target, name, { get: all2[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/busboy/lib/utils.js
var require_utils = __commonJS({
  "node_modules/busboy/lib/utils.js"(exports, module) {
    "use strict";
    function parseContentType(str2) {
      if (str2.length === 0)
        return;
      const params = /* @__PURE__ */ Object.create(null);
      let i = 0;
      for (; i < str2.length; ++i) {
        const code = str2.charCodeAt(i);
        if (TOKEN[code] !== 1) {
          if (code !== 47 || i === 0)
            return;
          break;
        }
      }
      if (i === str2.length)
        return;
      const type = str2.slice(0, i).toLowerCase();
      const subtypeStart = ++i;
      for (; i < str2.length; ++i) {
        const code = str2.charCodeAt(i);
        if (TOKEN[code] !== 1) {
          if (i === subtypeStart)
            return;
          if (parseContentTypeParams(str2, i, params) === void 0)
            return;
          break;
        }
      }
      if (i === subtypeStart)
        return;
      const subtype = str2.slice(subtypeStart, i).toLowerCase();
      return { type, subtype, params };
    }
    function parseContentTypeParams(str2, i, params) {
      while (i < str2.length) {
        for (; i < str2.length; ++i) {
          const code = str2.charCodeAt(i);
          if (code !== 32 && code !== 9)
            break;
        }
        if (i === str2.length)
          break;
        if (str2.charCodeAt(i++) !== 59)
          return;
        for (; i < str2.length; ++i) {
          const code = str2.charCodeAt(i);
          if (code !== 32 && code !== 9)
            break;
        }
        if (i === str2.length)
          return;
        let name;
        const nameStart = i;
        for (; i < str2.length; ++i) {
          const code = str2.charCodeAt(i);
          if (TOKEN[code] !== 1) {
            if (code !== 61)
              return;
            break;
          }
        }
        if (i === str2.length)
          return;
        name = str2.slice(nameStart, i);
        ++i;
        if (i === str2.length)
          return;
        let value = "";
        let valueStart;
        if (str2.charCodeAt(i) === 34) {
          valueStart = ++i;
          let escaping = false;
          for (; i < str2.length; ++i) {
            const code = str2.charCodeAt(i);
            if (code === 92) {
              if (escaping) {
                valueStart = i;
                escaping = false;
              } else {
                value += str2.slice(valueStart, i);
                escaping = true;
              }
              continue;
            }
            if (code === 34) {
              if (escaping) {
                valueStart = i;
                escaping = false;
                continue;
              }
              value += str2.slice(valueStart, i);
              break;
            }
            if (escaping) {
              valueStart = i - 1;
              escaping = false;
            }
            if (QDTEXT[code] !== 1)
              return;
          }
          if (i === str2.length)
            return;
          ++i;
        } else {
          valueStart = i;
          for (; i < str2.length; ++i) {
            const code = str2.charCodeAt(i);
            if (TOKEN[code] !== 1) {
              if (i === valueStart)
                return;
              break;
            }
          }
          value = str2.slice(valueStart, i);
        }
        name = name.toLowerCase();
        if (params[name] === void 0)
          params[name] = value;
      }
      return params;
    }
    function parseDisposition(str2, defDecoder) {
      if (str2.length === 0)
        return;
      const params = /* @__PURE__ */ Object.create(null);
      let i = 0;
      for (; i < str2.length; ++i) {
        const code = str2.charCodeAt(i);
        if (TOKEN[code] !== 1) {
          if (parseDispositionParams(str2, i, params, defDecoder) === void 0)
            return;
          break;
        }
      }
      const type = str2.slice(0, i).toLowerCase();
      return { type, params };
    }
    function parseDispositionParams(str2, i, params, defDecoder) {
      while (i < str2.length) {
        for (; i < str2.length; ++i) {
          const code = str2.charCodeAt(i);
          if (code !== 32 && code !== 9)
            break;
        }
        if (i === str2.length)
          break;
        if (str2.charCodeAt(i++) !== 59)
          return;
        for (; i < str2.length; ++i) {
          const code = str2.charCodeAt(i);
          if (code !== 32 && code !== 9)
            break;
        }
        if (i === str2.length)
          return;
        let name;
        const nameStart = i;
        for (; i < str2.length; ++i) {
          const code = str2.charCodeAt(i);
          if (TOKEN[code] !== 1) {
            if (code === 61)
              break;
            return;
          }
        }
        if (i === str2.length)
          return;
        let value = "";
        let valueStart;
        let charset;
        name = str2.slice(nameStart, i);
        if (name.charCodeAt(name.length - 1) === 42) {
          const charsetStart = ++i;
          for (; i < str2.length; ++i) {
            const code = str2.charCodeAt(i);
            if (CHARSET[code] !== 1) {
              if (code !== 39)
                return;
              break;
            }
          }
          if (i === str2.length)
            return;
          charset = str2.slice(charsetStart, i);
          ++i;
          for (; i < str2.length; ++i) {
            const code = str2.charCodeAt(i);
            if (code === 39)
              break;
          }
          if (i === str2.length)
            return;
          ++i;
          if (i === str2.length)
            return;
          valueStart = i;
          let encode = 0;
          for (; i < str2.length; ++i) {
            const code = str2.charCodeAt(i);
            if (EXTENDED_VALUE[code] !== 1) {
              if (code === 37) {
                let hexUpper;
                let hexLower;
                if (i + 2 < str2.length && (hexUpper = HEX_VALUES[str2.charCodeAt(i + 1)]) !== -1 && (hexLower = HEX_VALUES[str2.charCodeAt(i + 2)]) !== -1) {
                  const byteVal = (hexUpper << 4) + hexLower;
                  value += str2.slice(valueStart, i);
                  value += String.fromCharCode(byteVal);
                  i += 2;
                  valueStart = i + 1;
                  if (byteVal >= 128)
                    encode = 2;
                  else if (encode === 0)
                    encode = 1;
                  continue;
                }
                return;
              }
              break;
            }
          }
          value += str2.slice(valueStart, i);
          value = convertToUTF8(value, charset, encode);
          if (value === void 0)
            return;
        } else {
          ++i;
          if (i === str2.length)
            return;
          if (str2.charCodeAt(i) === 34) {
            valueStart = ++i;
            let escaping = false;
            for (; i < str2.length; ++i) {
              const code = str2.charCodeAt(i);
              if (code === 92) {
                if (escaping) {
                  valueStart = i;
                  escaping = false;
                } else {
                  value += str2.slice(valueStart, i);
                  escaping = true;
                }
                continue;
              }
              if (code === 34) {
                if (escaping) {
                  valueStart = i;
                  escaping = false;
                  continue;
                }
                value += str2.slice(valueStart, i);
                break;
              }
              if (escaping) {
                valueStart = i - 1;
                escaping = false;
              }
              if (QDTEXT[code] !== 1)
                return;
            }
            if (i === str2.length)
              return;
            ++i;
          } else {
            valueStart = i;
            for (; i < str2.length; ++i) {
              const code = str2.charCodeAt(i);
              if (TOKEN[code] !== 1) {
                if (i === valueStart)
                  return;
                break;
              }
            }
            value = str2.slice(valueStart, i);
          }
          value = defDecoder(value, 2);
          if (value === void 0)
            return;
        }
        name = name.toLowerCase();
        if (params[name] === void 0)
          params[name] = value;
      }
      return params;
    }
    function getDecoder(charset) {
      let lc;
      while (true) {
        switch (charset) {
          case "utf-8":
          case "utf8":
            return decoders.utf8;
          case "latin1":
          case "ascii":
          // TODO: Make these a separate, strict decoder?
          case "us-ascii":
          case "iso-8859-1":
          case "iso8859-1":
          case "iso88591":
          case "iso_8859-1":
          case "windows-1252":
          case "iso_8859-1:1987":
          case "cp1252":
          case "x-cp1252":
            return decoders.latin1;
          case "utf16le":
          case "utf-16le":
          case "ucs2":
          case "ucs-2":
            return decoders.utf16le;
          case "base64":
            return decoders.base64;
          default:
            if (lc === void 0) {
              lc = true;
              charset = charset.toLowerCase();
              continue;
            }
            return decoders.other.bind(charset);
        }
      }
    }
    var decoders = {
      utf8: (data, hint) => {
        if (data.length === 0)
          return "";
        if (typeof data === "string") {
          if (hint < 2)
            return data;
          data = Buffer.from(data, "latin1");
        }
        return data.utf8Slice(0, data.length);
      },
      latin1: (data, hint) => {
        if (data.length === 0)
          return "";
        if (typeof data === "string")
          return data;
        return data.latin1Slice(0, data.length);
      },
      utf16le: (data, hint) => {
        if (data.length === 0)
          return "";
        if (typeof data === "string")
          data = Buffer.from(data, "latin1");
        return data.ucs2Slice(0, data.length);
      },
      base64: (data, hint) => {
        if (data.length === 0)
          return "";
        if (typeof data === "string")
          data = Buffer.from(data, "latin1");
        return data.base64Slice(0, data.length);
      },
      other: (data, hint) => {
        if (data.length === 0)
          return "";
        if (typeof data === "string")
          data = Buffer.from(data, "latin1");
        try {
          const decoder = new TextDecoder(exports);
          return decoder.decode(data);
        } catch {
        }
      }
    };
    function convertToUTF8(data, charset, hint) {
      const decode = getDecoder(charset);
      if (decode)
        return decode(data, hint);
    }
    function basename(path) {
      if (typeof path !== "string")
        return "";
      for (let i = path.length - 1; i >= 0; --i) {
        switch (path.charCodeAt(i)) {
          case 47:
          // '/'
          case 92:
            path = path.slice(i + 1);
            return path === ".." || path === "." ? "" : path;
        }
      }
      return path === ".." || path === "." ? "" : path;
    }
    var TOKEN = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ];
    var QDTEXT = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1
    ];
    var CHARSET = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ];
    var EXTENDED_VALUE = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      1,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ];
    var HEX_VALUES = [
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      10,
      11,
      12,
      13,
      14,
      15,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      10,
      11,
      12,
      13,
      14,
      15,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ];
    module.exports = {
      basename,
      convertToUTF8,
      getDecoder,
      parseContentType,
      parseDisposition
    };
  }
});

// node_modules/streamsearch/lib/sbmh.js
var require_sbmh = __commonJS({
  "node_modules/streamsearch/lib/sbmh.js"(exports, module) {
    "use strict";
    function memcmp(buf1, pos1, buf2, pos2, num) {
      for (let i = 0; i < num; ++i) {
        if (buf1[pos1 + i] !== buf2[pos2 + i])
          return false;
      }
      return true;
    }
    var SBMH = class {
      constructor(needle, cb) {
        if (typeof cb !== "function")
          throw new Error("Missing match callback");
        if (typeof needle === "string")
          needle = Buffer.from(needle);
        else if (!Buffer.isBuffer(needle))
          throw new Error(`Expected Buffer for needle, got ${typeof needle}`);
        const needleLen = needle.length;
        this.maxMatches = Infinity;
        this.matches = 0;
        this._cb = cb;
        this._lookbehindSize = 0;
        this._needle = needle;
        this._bufPos = 0;
        this._lookbehind = Buffer.allocUnsafe(needleLen);
        this._occ = [
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen,
          needleLen
        ];
        if (needleLen > 1) {
          for (let i = 0; i < needleLen - 1; ++i)
            this._occ[needle[i]] = needleLen - 1 - i;
        }
      }
      reset() {
        this.matches = 0;
        this._lookbehindSize = 0;
        this._bufPos = 0;
      }
      push(chunk2, pos) {
        let result;
        if (!Buffer.isBuffer(chunk2))
          chunk2 = Buffer.from(chunk2, "latin1");
        const chunkLen = chunk2.length;
        this._bufPos = pos || 0;
        while (result !== chunkLen && this.matches < this.maxMatches)
          result = feed2(this, chunk2);
        return result;
      }
      destroy() {
        const lbSize = this._lookbehindSize;
        if (lbSize)
          this._cb(false, this._lookbehind, 0, lbSize, false);
        this.reset();
      }
    };
    function feed2(self, data) {
      const len = data.length;
      const needle = self._needle;
      const needleLen = needle.length;
      let pos = -self._lookbehindSize;
      const lastNeedleCharPos = needleLen - 1;
      const lastNeedleChar = needle[lastNeedleCharPos];
      const end = len - needleLen;
      const occ = self._occ;
      const lookbehind = self._lookbehind;
      if (pos < 0) {
        while (pos < 0 && pos <= end) {
          const nextPos = pos + lastNeedleCharPos;
          const ch = nextPos < 0 ? lookbehind[self._lookbehindSize + nextPos] : data[nextPos];
          if (ch === lastNeedleChar && matchNeedle(self, data, pos, lastNeedleCharPos)) {
            self._lookbehindSize = 0;
            ++self.matches;
            if (pos > -self._lookbehindSize)
              self._cb(true, lookbehind, 0, self._lookbehindSize + pos, false);
            else
              self._cb(true, void 0, 0, 0, true);
            return self._bufPos = pos + needleLen;
          }
          pos += occ[ch];
        }
        while (pos < 0 && !matchNeedle(self, data, pos, len - pos))
          ++pos;
        if (pos < 0) {
          const bytesToCutOff = self._lookbehindSize + pos;
          if (bytesToCutOff > 0) {
            self._cb(false, lookbehind, 0, bytesToCutOff, false);
          }
          self._lookbehindSize -= bytesToCutOff;
          lookbehind.copy(lookbehind, 0, bytesToCutOff, self._lookbehindSize);
          lookbehind.set(data, self._lookbehindSize);
          self._lookbehindSize += len;
          self._bufPos = len;
          return len;
        }
        self._cb(false, lookbehind, 0, self._lookbehindSize, false);
        self._lookbehindSize = 0;
      }
      pos += self._bufPos;
      const firstNeedleChar = needle[0];
      while (pos <= end) {
        const ch = data[pos + lastNeedleCharPos];
        if (ch === lastNeedleChar && data[pos] === firstNeedleChar && memcmp(needle, 0, data, pos, lastNeedleCharPos)) {
          ++self.matches;
          if (pos > 0)
            self._cb(true, data, self._bufPos, pos, true);
          else
            self._cb(true, void 0, 0, 0, true);
          return self._bufPos = pos + needleLen;
        }
        pos += occ[ch];
      }
      while (pos < len) {
        if (data[pos] !== firstNeedleChar || !memcmp(data, pos, needle, 0, len - pos)) {
          ++pos;
          continue;
        }
        data.copy(lookbehind, 0, pos, len);
        self._lookbehindSize = len - pos;
        break;
      }
      if (pos > 0)
        self._cb(false, data, self._bufPos, pos < len ? pos : len, true);
      self._bufPos = len;
      return len;
    }
    function matchNeedle(self, data, pos, len) {
      const lb = self._lookbehind;
      const lbSize = self._lookbehindSize;
      const needle = self._needle;
      for (let i = 0; i < len; ++i, ++pos) {
        const ch = pos < 0 ? lb[lbSize + pos] : data[pos];
        if (ch !== needle[i])
          return false;
      }
      return true;
    }
    module.exports = SBMH;
  }
});

// node_modules/busboy/lib/types/multipart.js
var require_multipart = __commonJS({
  "node_modules/busboy/lib/types/multipart.js"(exports, module) {
    "use strict";
    var { Readable, Writable } = __require("stream");
    var StreamSearch = require_sbmh();
    var {
      basename,
      convertToUTF8,
      getDecoder,
      parseContentType,
      parseDisposition
    } = require_utils();
    var BUF_CRLF = Buffer.from("\r\n");
    var BUF_CR = Buffer.from("\r");
    var BUF_DASH = Buffer.from("-");
    function noop() {
    }
    var MAX_HEADER_PAIRS = 2e3;
    var MAX_HEADER_SIZE = 16 * 1024;
    var HPARSER_NAME = 0;
    var HPARSER_PRE_OWS = 1;
    var HPARSER_VALUE = 2;
    var HeaderParser = class {
      constructor(cb) {
        this.header = /* @__PURE__ */ Object.create(null);
        this.pairCount = 0;
        this.byteCount = 0;
        this.state = HPARSER_NAME;
        this.name = "";
        this.value = "";
        this.crlf = 0;
        this.cb = cb;
      }
      reset() {
        this.header = /* @__PURE__ */ Object.create(null);
        this.pairCount = 0;
        this.byteCount = 0;
        this.state = HPARSER_NAME;
        this.name = "";
        this.value = "";
        this.crlf = 0;
      }
      push(chunk2, pos, end) {
        let start = pos;
        while (pos < end) {
          switch (this.state) {
            case HPARSER_NAME: {
              let done = false;
              for (; pos < end; ++pos) {
                if (this.byteCount === MAX_HEADER_SIZE)
                  return -1;
                ++this.byteCount;
                const code = chunk2[pos];
                if (TOKEN[code] !== 1) {
                  if (code !== 58)
                    return -1;
                  this.name += chunk2.latin1Slice(start, pos);
                  if (this.name.length === 0)
                    return -1;
                  ++pos;
                  done = true;
                  this.state = HPARSER_PRE_OWS;
                  break;
                }
              }
              if (!done) {
                this.name += chunk2.latin1Slice(start, pos);
                break;
              }
            }
            case HPARSER_PRE_OWS: {
              let done = false;
              for (; pos < end; ++pos) {
                if (this.byteCount === MAX_HEADER_SIZE)
                  return -1;
                ++this.byteCount;
                const code = chunk2[pos];
                if (code !== 32 && code !== 9) {
                  start = pos;
                  done = true;
                  this.state = HPARSER_VALUE;
                  break;
                }
              }
              if (!done)
                break;
            }
            case HPARSER_VALUE:
              switch (this.crlf) {
                case 0:
                  for (; pos < end; ++pos) {
                    if (this.byteCount === MAX_HEADER_SIZE)
                      return -1;
                    ++this.byteCount;
                    const code = chunk2[pos];
                    if (FIELD_VCHAR[code] !== 1) {
                      if (code !== 13)
                        return -1;
                      ++this.crlf;
                      break;
                    }
                  }
                  this.value += chunk2.latin1Slice(start, pos++);
                  break;
                case 1:
                  if (this.byteCount === MAX_HEADER_SIZE)
                    return -1;
                  ++this.byteCount;
                  if (chunk2[pos++] !== 10)
                    return -1;
                  ++this.crlf;
                  break;
                case 2: {
                  if (this.byteCount === MAX_HEADER_SIZE)
                    return -1;
                  ++this.byteCount;
                  const code = chunk2[pos];
                  if (code === 32 || code === 9) {
                    start = pos;
                    this.crlf = 0;
                  } else {
                    if (++this.pairCount < MAX_HEADER_PAIRS) {
                      this.name = this.name.toLowerCase();
                      if (this.header[this.name] === void 0)
                        this.header[this.name] = [this.value];
                      else
                        this.header[this.name].push(this.value);
                    }
                    if (code === 13) {
                      ++this.crlf;
                      ++pos;
                    } else {
                      start = pos;
                      this.crlf = 0;
                      this.state = HPARSER_NAME;
                      this.name = "";
                      this.value = "";
                    }
                  }
                  break;
                }
                case 3: {
                  if (this.byteCount === MAX_HEADER_SIZE)
                    return -1;
                  ++this.byteCount;
                  if (chunk2[pos++] !== 10)
                    return -1;
                  const header2 = this.header;
                  this.reset();
                  this.cb(header2);
                  return pos;
                }
              }
              break;
          }
        }
        return pos;
      }
    };
    var FileStream = class extends Readable {
      constructor(opts, owner) {
        super(opts);
        this.truncated = false;
        this._readcb = null;
        this.once("end", () => {
          this._read();
          if (--owner._fileEndsLeft === 0 && owner._finalcb) {
            const cb = owner._finalcb;
            owner._finalcb = null;
            process.nextTick(cb);
          }
        });
      }
      _read(n) {
        const cb = this._readcb;
        if (cb) {
          this._readcb = null;
          cb();
        }
      }
    };
    var ignoreData = {
      push: (chunk2, pos) => {
      },
      destroy: () => {
      }
    };
    function callAndUnsetCb(self, err) {
      const cb = self._writecb;
      self._writecb = null;
      if (err)
        self.destroy(err);
      else if (cb)
        cb();
    }
    function nullDecoder(val, hint) {
      return val;
    }
    var Multipart = class extends Writable {
      constructor(cfg) {
        const streamOpts = {
          autoDestroy: true,
          emitClose: true,
          highWaterMark: typeof cfg.highWaterMark === "number" ? cfg.highWaterMark : void 0
        };
        super(streamOpts);
        if (!cfg.conType.params || typeof cfg.conType.params.boundary !== "string")
          throw new Error("Multipart: Boundary not found");
        const boundary = cfg.conType.params.boundary;
        const paramDecoder = typeof cfg.defParamCharset === "string" && cfg.defParamCharset ? getDecoder(cfg.defParamCharset) : nullDecoder;
        const defCharset = cfg.defCharset || "utf8";
        const preservePath = cfg.preservePath;
        const fileOpts = {
          autoDestroy: true,
          emitClose: true,
          highWaterMark: typeof cfg.fileHwm === "number" ? cfg.fileHwm : void 0
        };
        const limits = cfg.limits;
        const fieldSizeLimit = limits && typeof limits.fieldSize === "number" ? limits.fieldSize : 1 * 1024 * 1024;
        const fileSizeLimit = limits && typeof limits.fileSize === "number" ? limits.fileSize : Infinity;
        const filesLimit = limits && typeof limits.files === "number" ? limits.files : Infinity;
        const fieldsLimit = limits && typeof limits.fields === "number" ? limits.fields : Infinity;
        const partsLimit = limits && typeof limits.parts === "number" ? limits.parts : Infinity;
        let parts = -1;
        let fields = 0;
        let files = 0;
        let skipPart = false;
        this._fileEndsLeft = 0;
        this._fileStream = void 0;
        this._complete = false;
        let fileSize = 0;
        let field;
        let fieldSize = 0;
        let partCharset;
        let partEncoding;
        let partType;
        let partName;
        let partTruncated = false;
        let hitFilesLimit = false;
        let hitFieldsLimit = false;
        this._hparser = null;
        const hparser = new HeaderParser((header2) => {
          this._hparser = null;
          skipPart = false;
          partType = "text/plain";
          partCharset = defCharset;
          partEncoding = "7bit";
          partName = void 0;
          partTruncated = false;
          let filename;
          if (!header2["content-disposition"]) {
            skipPart = true;
            return;
          }
          const disp = parseDisposition(
            header2["content-disposition"][0],
            paramDecoder
          );
          if (!disp || disp.type !== "form-data") {
            skipPart = true;
            return;
          }
          if (disp.params) {
            if (disp.params.name)
              partName = disp.params.name;
            if (disp.params["filename*"])
              filename = disp.params["filename*"];
            else if (disp.params.filename)
              filename = disp.params.filename;
            if (filename !== void 0 && !preservePath)
              filename = basename(filename);
          }
          if (header2["content-type"]) {
            const conType = parseContentType(header2["content-type"][0]);
            if (conType) {
              partType = `${conType.type}/${conType.subtype}`;
              if (conType.params && typeof conType.params.charset === "string")
                partCharset = conType.params.charset.toLowerCase();
            }
          }
          if (header2["content-transfer-encoding"])
            partEncoding = header2["content-transfer-encoding"][0].toLowerCase();
          if (partType === "application/octet-stream" || filename !== void 0) {
            if (files === filesLimit) {
              if (!hitFilesLimit) {
                hitFilesLimit = true;
                this.emit("filesLimit");
              }
              skipPart = true;
              return;
            }
            ++files;
            if (this.listenerCount("file") === 0) {
              skipPart = true;
              return;
            }
            fileSize = 0;
            this._fileStream = new FileStream(fileOpts, this);
            ++this._fileEndsLeft;
            this.emit(
              "file",
              partName,
              this._fileStream,
              {
                filename,
                encoding: partEncoding,
                mimeType: partType
              }
            );
          } else {
            if (fields === fieldsLimit) {
              if (!hitFieldsLimit) {
                hitFieldsLimit = true;
                this.emit("fieldsLimit");
              }
              skipPart = true;
              return;
            }
            ++fields;
            if (this.listenerCount("field") === 0) {
              skipPart = true;
              return;
            }
            field = [];
            fieldSize = 0;
          }
        });
        let matchPostBoundary = 0;
        const ssCb = (isMatch, data, start, end, isDataSafe) => {
          retrydata:
            while (data) {
              if (this._hparser !== null) {
                const ret = this._hparser.push(data, start, end);
                if (ret === -1) {
                  this._hparser = null;
                  hparser.reset();
                  this.emit("error", new Error("Malformed part header"));
                  break;
                }
                start = ret;
              }
              if (start === end)
                break;
              if (matchPostBoundary !== 0) {
                if (matchPostBoundary === 1) {
                  switch (data[start]) {
                    case 45:
                      matchPostBoundary = 2;
                      ++start;
                      break;
                    case 13:
                      matchPostBoundary = 3;
                      ++start;
                      break;
                    default:
                      matchPostBoundary = 0;
                  }
                  if (start === end)
                    return;
                }
                if (matchPostBoundary === 2) {
                  matchPostBoundary = 0;
                  if (data[start] === 45) {
                    this._complete = true;
                    this._bparser = ignoreData;
                    return;
                  }
                  const writecb = this._writecb;
                  this._writecb = noop;
                  ssCb(false, BUF_DASH, 0, 1, false);
                  this._writecb = writecb;
                } else if (matchPostBoundary === 3) {
                  matchPostBoundary = 0;
                  if (data[start] === 10) {
                    ++start;
                    if (parts >= partsLimit)
                      break;
                    this._hparser = hparser;
                    if (start === end)
                      break;
                    continue retrydata;
                  } else {
                    const writecb = this._writecb;
                    this._writecb = noop;
                    ssCb(false, BUF_CR, 0, 1, false);
                    this._writecb = writecb;
                  }
                }
              }
              if (!skipPart) {
                if (this._fileStream) {
                  let chunk2;
                  const actualLen = Math.min(end - start, fileSizeLimit - fileSize);
                  if (!isDataSafe) {
                    chunk2 = Buffer.allocUnsafe(actualLen);
                    data.copy(chunk2, 0, start, start + actualLen);
                  } else {
                    chunk2 = data.slice(start, start + actualLen);
                  }
                  fileSize += chunk2.length;
                  if (fileSize === fileSizeLimit) {
                    if (chunk2.length > 0)
                      this._fileStream.push(chunk2);
                    this._fileStream.emit("limit");
                    this._fileStream.truncated = true;
                    skipPart = true;
                  } else if (!this._fileStream.push(chunk2)) {
                    if (this._writecb)
                      this._fileStream._readcb = this._writecb;
                    this._writecb = null;
                  }
                } else if (field !== void 0) {
                  let chunk2;
                  const actualLen = Math.min(
                    end - start,
                    fieldSizeLimit - fieldSize
                  );
                  if (!isDataSafe) {
                    chunk2 = Buffer.allocUnsafe(actualLen);
                    data.copy(chunk2, 0, start, start + actualLen);
                  } else {
                    chunk2 = data.slice(start, start + actualLen);
                  }
                  fieldSize += actualLen;
                  field.push(chunk2);
                  if (fieldSize === fieldSizeLimit) {
                    skipPart = true;
                    partTruncated = true;
                  }
                }
              }
              break;
            }
          if (isMatch) {
            matchPostBoundary = 1;
            if (this._fileStream) {
              this._fileStream.push(null);
              this._fileStream = null;
            } else if (field !== void 0) {
              let data2;
              switch (field.length) {
                case 0:
                  data2 = "";
                  break;
                case 1:
                  data2 = convertToUTF8(field[0], partCharset, 0);
                  break;
                default:
                  data2 = convertToUTF8(
                    Buffer.concat(field, fieldSize),
                    partCharset,
                    0
                  );
              }
              field = void 0;
              fieldSize = 0;
              this.emit(
                "field",
                partName,
                data2,
                {
                  nameTruncated: false,
                  valueTruncated: partTruncated,
                  encoding: partEncoding,
                  mimeType: partType
                }
              );
            }
            if (++parts === partsLimit)
              this.emit("partsLimit");
          }
        };
        this._bparser = new StreamSearch(`\r
--${boundary}`, ssCb);
        this._writecb = null;
        this._finalcb = null;
        this.write(BUF_CRLF);
      }
      static detect(conType) {
        return conType.type === "multipart" && conType.subtype === "form-data";
      }
      _write(chunk2, enc, cb) {
        this._writecb = cb;
        this._bparser.push(chunk2, 0);
        if (this._writecb)
          callAndUnsetCb(this);
      }
      _destroy(err, cb) {
        this._hparser = null;
        this._bparser = ignoreData;
        if (!err)
          err = checkEndState(this);
        const fileStream = this._fileStream;
        if (fileStream) {
          this._fileStream = null;
          fileStream.destroy(err);
        }
        cb(err);
      }
      _final(cb) {
        this._bparser.destroy();
        if (!this._complete)
          return cb(new Error("Unexpected end of form"));
        if (this._fileEndsLeft)
          this._finalcb = finalcb.bind(null, this, cb);
        else
          finalcb(this, cb);
      }
    };
    function finalcb(self, cb, err) {
      if (err)
        return cb(err);
      err = checkEndState(self);
      cb(err);
    }
    function checkEndState(self) {
      if (self._hparser)
        return new Error("Malformed part header");
      const fileStream = self._fileStream;
      if (fileStream) {
        self._fileStream = null;
        fileStream.destroy(new Error("Unexpected end of file"));
      }
      if (!self._complete)
        return new Error("Unexpected end of form");
    }
    var TOKEN = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ];
    var FIELD_VCHAR = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1
    ];
    module.exports = Multipart;
  }
});

// node_modules/busboy/lib/types/urlencoded.js
var require_urlencoded = __commonJS({
  "node_modules/busboy/lib/types/urlencoded.js"(exports, module) {
    "use strict";
    var { Writable } = __require("stream");
    var { getDecoder } = require_utils();
    var URLEncoded = class extends Writable {
      constructor(cfg) {
        const streamOpts = {
          autoDestroy: true,
          emitClose: true,
          highWaterMark: typeof cfg.highWaterMark === "number" ? cfg.highWaterMark : void 0
        };
        super(streamOpts);
        let charset = cfg.defCharset || "utf8";
        if (cfg.conType.params && typeof cfg.conType.params.charset === "string")
          charset = cfg.conType.params.charset;
        this.charset = charset;
        const limits = cfg.limits;
        this.fieldSizeLimit = limits && typeof limits.fieldSize === "number" ? limits.fieldSize : 1 * 1024 * 1024;
        this.fieldsLimit = limits && typeof limits.fields === "number" ? limits.fields : Infinity;
        this.fieldNameSizeLimit = limits && typeof limits.fieldNameSize === "number" ? limits.fieldNameSize : 100;
        this._inKey = true;
        this._keyTrunc = false;
        this._valTrunc = false;
        this._bytesKey = 0;
        this._bytesVal = 0;
        this._fields = 0;
        this._key = "";
        this._val = "";
        this._byte = -2;
        this._lastPos = 0;
        this._encode = 0;
        this._decoder = getDecoder(charset);
      }
      static detect(conType) {
        return conType.type === "application" && conType.subtype === "x-www-form-urlencoded";
      }
      _write(chunk2, enc, cb) {
        if (this._fields >= this.fieldsLimit)
          return cb();
        let i = 0;
        const len = chunk2.length;
        this._lastPos = 0;
        if (this._byte !== -2) {
          i = readPctEnc(this, chunk2, i, len);
          if (i === -1)
            return cb(new Error("Malformed urlencoded form"));
          if (i >= len)
            return cb();
          if (this._inKey)
            ++this._bytesKey;
          else
            ++this._bytesVal;
        }
        main:
          while (i < len) {
            if (this._inKey) {
              i = skipKeyBytes(this, chunk2, i, len);
              while (i < len) {
                switch (chunk2[i]) {
                  case 61:
                    if (this._lastPos < i)
                      this._key += chunk2.latin1Slice(this._lastPos, i);
                    this._lastPos = ++i;
                    this._key = this._decoder(this._key, this._encode);
                    this._encode = 0;
                    this._inKey = false;
                    continue main;
                  case 38:
                    if (this._lastPos < i)
                      this._key += chunk2.latin1Slice(this._lastPos, i);
                    this._lastPos = ++i;
                    this._key = this._decoder(this._key, this._encode);
                    this._encode = 0;
                    if (this._bytesKey > 0) {
                      this.emit(
                        "field",
                        this._key,
                        "",
                        {
                          nameTruncated: this._keyTrunc,
                          valueTruncated: false,
                          encoding: this.charset,
                          mimeType: "text/plain"
                        }
                      );
                    }
                    this._key = "";
                    this._val = "";
                    this._keyTrunc = false;
                    this._valTrunc = false;
                    this._bytesKey = 0;
                    this._bytesVal = 0;
                    if (++this._fields >= this.fieldsLimit) {
                      this.emit("fieldsLimit");
                      return cb();
                    }
                    continue;
                  case 43:
                    if (this._lastPos < i)
                      this._key += chunk2.latin1Slice(this._lastPos, i);
                    this._key += " ";
                    this._lastPos = i + 1;
                    break;
                  case 37:
                    if (this._encode === 0)
                      this._encode = 1;
                    if (this._lastPos < i)
                      this._key += chunk2.latin1Slice(this._lastPos, i);
                    this._lastPos = i + 1;
                    this._byte = -1;
                    i = readPctEnc(this, chunk2, i + 1, len);
                    if (i === -1)
                      return cb(new Error("Malformed urlencoded form"));
                    if (i >= len)
                      return cb();
                    ++this._bytesKey;
                    i = skipKeyBytes(this, chunk2, i, len);
                    continue;
                }
                ++i;
                ++this._bytesKey;
                i = skipKeyBytes(this, chunk2, i, len);
              }
              if (this._lastPos < i)
                this._key += chunk2.latin1Slice(this._lastPos, i);
            } else {
              i = skipValBytes(this, chunk2, i, len);
              while (i < len) {
                switch (chunk2[i]) {
                  case 38:
                    if (this._lastPos < i)
                      this._val += chunk2.latin1Slice(this._lastPos, i);
                    this._lastPos = ++i;
                    this._inKey = true;
                    this._val = this._decoder(this._val, this._encode);
                    this._encode = 0;
                    if (this._bytesKey > 0 || this._bytesVal > 0) {
                      this.emit(
                        "field",
                        this._key,
                        this._val,
                        {
                          nameTruncated: this._keyTrunc,
                          valueTruncated: this._valTrunc,
                          encoding: this.charset,
                          mimeType: "text/plain"
                        }
                      );
                    }
                    this._key = "";
                    this._val = "";
                    this._keyTrunc = false;
                    this._valTrunc = false;
                    this._bytesKey = 0;
                    this._bytesVal = 0;
                    if (++this._fields >= this.fieldsLimit) {
                      this.emit("fieldsLimit");
                      return cb();
                    }
                    continue main;
                  case 43:
                    if (this._lastPos < i)
                      this._val += chunk2.latin1Slice(this._lastPos, i);
                    this._val += " ";
                    this._lastPos = i + 1;
                    break;
                  case 37:
                    if (this._encode === 0)
                      this._encode = 1;
                    if (this._lastPos < i)
                      this._val += chunk2.latin1Slice(this._lastPos, i);
                    this._lastPos = i + 1;
                    this._byte = -1;
                    i = readPctEnc(this, chunk2, i + 1, len);
                    if (i === -1)
                      return cb(new Error("Malformed urlencoded form"));
                    if (i >= len)
                      return cb();
                    ++this._bytesVal;
                    i = skipValBytes(this, chunk2, i, len);
                    continue;
                }
                ++i;
                ++this._bytesVal;
                i = skipValBytes(this, chunk2, i, len);
              }
              if (this._lastPos < i)
                this._val += chunk2.latin1Slice(this._lastPos, i);
            }
          }
        cb();
      }
      _final(cb) {
        if (this._byte !== -2)
          return cb(new Error("Malformed urlencoded form"));
        if (!this._inKey || this._bytesKey > 0 || this._bytesVal > 0) {
          if (this._inKey)
            this._key = this._decoder(this._key, this._encode);
          else
            this._val = this._decoder(this._val, this._encode);
          this.emit(
            "field",
            this._key,
            this._val,
            {
              nameTruncated: this._keyTrunc,
              valueTruncated: this._valTrunc,
              encoding: this.charset,
              mimeType: "text/plain"
            }
          );
        }
        cb();
      }
    };
    function readPctEnc(self, chunk2, pos, len) {
      if (pos >= len)
        return len;
      if (self._byte === -1) {
        const hexUpper = HEX_VALUES[chunk2[pos++]];
        if (hexUpper === -1)
          return -1;
        if (hexUpper >= 8)
          self._encode = 2;
        if (pos < len) {
          const hexLower = HEX_VALUES[chunk2[pos++]];
          if (hexLower === -1)
            return -1;
          if (self._inKey)
            self._key += String.fromCharCode((hexUpper << 4) + hexLower);
          else
            self._val += String.fromCharCode((hexUpper << 4) + hexLower);
          self._byte = -2;
          self._lastPos = pos;
        } else {
          self._byte = hexUpper;
        }
      } else {
        const hexLower = HEX_VALUES[chunk2[pos++]];
        if (hexLower === -1)
          return -1;
        if (self._inKey)
          self._key += String.fromCharCode((self._byte << 4) + hexLower);
        else
          self._val += String.fromCharCode((self._byte << 4) + hexLower);
        self._byte = -2;
        self._lastPos = pos;
      }
      return pos;
    }
    function skipKeyBytes(self, chunk2, pos, len) {
      if (self._bytesKey > self.fieldNameSizeLimit) {
        if (!self._keyTrunc) {
          if (self._lastPos < pos)
            self._key += chunk2.latin1Slice(self._lastPos, pos - 1);
        }
        self._keyTrunc = true;
        for (; pos < len; ++pos) {
          const code = chunk2[pos];
          if (code === 61 || code === 38)
            break;
          ++self._bytesKey;
        }
        self._lastPos = pos;
      }
      return pos;
    }
    function skipValBytes(self, chunk2, pos, len) {
      if (self._bytesVal > self.fieldSizeLimit) {
        if (!self._valTrunc) {
          if (self._lastPos < pos)
            self._val += chunk2.latin1Slice(self._lastPos, pos - 1);
        }
        self._valTrunc = true;
        for (; pos < len; ++pos) {
          if (chunk2[pos] === 38)
            break;
          ++self._bytesVal;
        }
        self._lastPos = pos;
      }
      return pos;
    }
    var HEX_VALUES = [
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      10,
      11,
      12,
      13,
      14,
      15,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      10,
      11,
      12,
      13,
      14,
      15,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ];
    module.exports = URLEncoded;
  }
});

// node_modules/busboy/lib/index.js
var require_lib = __commonJS({
  "node_modules/busboy/lib/index.js"(exports, module) {
    "use strict";
    var { parseContentType } = require_utils();
    function getInstance(cfg) {
      const headers = cfg.headers;
      const conType = parseContentType(headers["content-type"]);
      if (!conType)
        throw new Error("Malformed content type");
      for (const type of TYPES) {
        const matched = type.detect(conType);
        if (!matched)
          continue;
        const instanceCfg = {
          limits: cfg.limits,
          headers,
          conType,
          highWaterMark: void 0,
          fileHwm: void 0,
          defCharset: void 0,
          defParamCharset: void 0,
          preservePath: false
        };
        if (cfg.highWaterMark)
          instanceCfg.highWaterMark = cfg.highWaterMark;
        if (cfg.fileHwm)
          instanceCfg.fileHwm = cfg.fileHwm;
        instanceCfg.defCharset = cfg.defCharset;
        instanceCfg.defParamCharset = cfg.defParamCharset;
        instanceCfg.preservePath = cfg.preservePath;
        return new type(instanceCfg);
      }
      throw new Error(`Unsupported content type: ${headers["content-type"]}`);
    }
    var TYPES = [
      require_multipart(),
      require_urlencoded()
    ].filter(function(typemod) {
      return typeof typemod.detect === "function";
    });
    module.exports = (cfg) => {
      if (typeof cfg !== "object" || cfg === null)
        cfg = {};
      if (typeof cfg.headers !== "object" || cfg.headers === null || typeof cfg.headers["content-type"] !== "string") {
        throw new Error("Missing Content-Type");
      }
      return getInstance(cfg);
    };
  }
});

// src/config.ts
var env, seconds, port, config;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    env = process.env;
    seconds = (name, fallback) => Number(env[name] || fallback);
    port = Number(env.APP_PUBLIC_PORT || 4173);
    config = {
      databaseUrl: env.DATABASE_URL,
      port,
      publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(
        /\/$/,
        ""
      ),
      s3Endpoint: env.S3_ENDPOINT || "",
      s3Region: env.S3_REGION || "",
      s3Bucket: env.S3_BUCKET || "",
      s3PathStyle: env.S3_FORCE_PATH_STYLE === "true",
      s3AccessKey: env.S3_ACCESS_KEY_ID || "",
      s3SecretKey: env.S3_SECRET_ACCESS_KEY || "",
      smtpHost: env.SMTP_HOST || "",
      smtpPort: Number(env.SMTP_PORT),
      mailFrom: env.MAIL_FROM || "Aldermoor Open Record <record@aldermoor.example>",
      outboxRetry: seconds("OUTBOX_RETRY_SECONDS", 10),
      outboxRetryMax: seconds("OUTBOX_RETRY_MAX_SECONDS", 60),
      jobMaxAttempts: seconds("JOB_MAX_ATTEMPTS", 5),
      retention: seconds("APPLICATION_RETENTION_SECONDS", 15552e3),
      resendWindow: seconds("RESEND_WINDOW_SECONDS", 3600),
      sessionTtl: seconds("SESSION_TTL_SECONDS", 43200),
      signinLockout: seconds("SIGNIN_LOCKOUT_SECONDS", 30),
      idempotencyTtl: seconds("IDEMPOTENCY_TTL_SECONDS", 86400),
      rateLimits: {
        public: seconds("RATE_LIMIT_PUBLIC_PER_MINUTE", 600),
        candidate: seconds("RATE_LIMIT_CANDIDATE_PER_MINUTE", 60),
        signin: seconds("RATE_LIMIT_SIGNIN_PER_MINUTE", 20),
        console: seconds("RATE_LIMIT_CONSOLE_WRITES_PER_MINUTE", 120)
      },
      trustForwardedFor: env.TRUST_FORWARDED_FOR === "true"
    };
  }
});

// node_modules/postgres-array/index.js
var require_postgres_array = __commonJS({
  "node_modules/postgres-array/index.js"(exports) {
    "use strict";
    exports.parse = function(source, transform) {
      return new ArrayParser(source, transform).parse();
    };
    var ArrayParser = class _ArrayParser {
      constructor(source, transform) {
        this.source = source;
        this.transform = transform || identity;
        this.position = 0;
        this.entries = [];
        this.recorded = [];
        this.dimension = 0;
      }
      isEof() {
        return this.position >= this.source.length;
      }
      nextCharacter() {
        var character = this.source[this.position++];
        if (character === "\\") {
          return {
            value: this.source[this.position++],
            escaped: true
          };
        }
        return {
          value: character,
          escaped: false
        };
      }
      record(character) {
        this.recorded.push(character);
      }
      newEntry(includeEmpty) {
        var entry;
        if (this.recorded.length > 0 || includeEmpty) {
          entry = this.recorded.join("");
          if (entry === "NULL" && !includeEmpty) {
            entry = null;
          }
          if (entry !== null) entry = this.transform(entry);
          this.entries.push(entry);
          this.recorded = [];
        }
      }
      consumeDimensions() {
        if (this.source[0] === "[") {
          while (!this.isEof()) {
            var char = this.nextCharacter();
            if (char.value === "=") break;
          }
        }
      }
      parse(nested) {
        var character, parser, quote;
        this.consumeDimensions();
        while (!this.isEof()) {
          character = this.nextCharacter();
          if (character.value === "{" && !quote) {
            this.dimension++;
            if (this.dimension > 1) {
              parser = new _ArrayParser(this.source.substr(this.position - 1), this.transform);
              this.entries.push(parser.parse(true));
              this.position += parser.position - 2;
            }
          } else if (character.value === "}" && !quote) {
            this.dimension--;
            if (!this.dimension) {
              this.newEntry();
              if (nested) return this.entries;
            }
          } else if (character.value === '"' && !character.escaped) {
            if (quote) this.newEntry(true);
            quote = !quote;
          } else if (character.value === "," && !quote) {
            this.newEntry();
          } else {
            this.record(character.value);
          }
        }
        if (this.dimension !== 0) {
          throw new Error("array dimension not balanced");
        }
        return this.entries;
      }
    };
    function identity(value) {
      return value;
    }
  }
});

// node_modules/pg-types/lib/arrayParser.js
var require_arrayParser = __commonJS({
  "node_modules/pg-types/lib/arrayParser.js"(exports, module) {
    var array = require_postgres_array();
    module.exports = {
      create: function(source, transform) {
        return {
          parse: function() {
            return array.parse(source, transform);
          }
        };
      }
    };
  }
});

// node_modules/postgres-date/index.js
var require_postgres_date = __commonJS({
  "node_modules/postgres-date/index.js"(exports, module) {
    "use strict";
    var DATE_TIME = /(\d{1,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,})?.*?( BC)?$/;
    var DATE = /^(\d{1,})-(\d{2})-(\d{2})( BC)?$/;
    var TIME_ZONE = /([Z+-])(\d{2})?:?(\d{2})?:?(\d{2})?/;
    var INFINITY = /^-?infinity$/;
    module.exports = function parseDate(isoDate) {
      if (INFINITY.test(isoDate)) {
        return Number(isoDate.replace("i", "I"));
      }
      var matches = DATE_TIME.exec(isoDate);
      if (!matches) {
        return getDate(isoDate) || null;
      }
      var isBC = !!matches[8];
      var year = parseInt(matches[1], 10);
      if (isBC) {
        year = bcYearToNegativeYear(year);
      }
      var month = parseInt(matches[2], 10) - 1;
      var day = matches[3];
      var hour = parseInt(matches[4], 10);
      var minute = parseInt(matches[5], 10);
      var second = parseInt(matches[6], 10);
      var ms = matches[7];
      ms = ms ? 1e3 * parseFloat(ms) : 0;
      var date2;
      var offset = timeZoneOffset(isoDate);
      if (offset != null) {
        date2 = new Date(Date.UTC(year, month, day, hour, minute, second, ms));
        if (is0To99(year)) {
          date2.setUTCFullYear(year);
        }
        if (offset !== 0) {
          date2.setTime(date2.getTime() - offset);
        }
      } else {
        date2 = new Date(year, month, day, hour, minute, second, ms);
        if (is0To99(year)) {
          date2.setFullYear(year);
        }
      }
      return date2;
    };
    function getDate(isoDate) {
      var matches = DATE.exec(isoDate);
      if (!matches) {
        return;
      }
      var year = parseInt(matches[1], 10);
      var isBC = !!matches[4];
      if (isBC) {
        year = bcYearToNegativeYear(year);
      }
      var month = parseInt(matches[2], 10) - 1;
      var day = matches[3];
      var date2 = new Date(year, month, day);
      if (is0To99(year)) {
        date2.setFullYear(year);
      }
      return date2;
    }
    function timeZoneOffset(isoDate) {
      if (isoDate.endsWith("+00")) {
        return 0;
      }
      var zone = TIME_ZONE.exec(isoDate.split(" ")[1]);
      if (!zone) return;
      var type = zone[1];
      if (type === "Z") {
        return 0;
      }
      var sign = type === "-" ? -1 : 1;
      var offset = parseInt(zone[2], 10) * 3600 + parseInt(zone[3] || 0, 10) * 60 + parseInt(zone[4] || 0, 10);
      return offset * sign * 1e3;
    }
    function bcYearToNegativeYear(year) {
      return -(year - 1);
    }
    function is0To99(num) {
      return num >= 0 && num < 100;
    }
  }
});

// node_modules/xtend/mutable.js
var require_mutable = __commonJS({
  "node_modules/xtend/mutable.js"(exports, module) {
    module.exports = extend;
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    function extend(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        for (var key in source) {
          if (hasOwnProperty.call(source, key)) {
            target[key] = source[key];
          }
        }
      }
      return target;
    }
  }
});

// node_modules/postgres-interval/index.js
var require_postgres_interval = __commonJS({
  "node_modules/postgres-interval/index.js"(exports, module) {
    "use strict";
    var extend = require_mutable();
    module.exports = PostgresInterval;
    function PostgresInterval(raw) {
      if (!(this instanceof PostgresInterval)) {
        return new PostgresInterval(raw);
      }
      extend(this, parse(raw));
    }
    var properties = ["seconds", "minutes", "hours", "days", "months", "years"];
    PostgresInterval.prototype.toPostgres = function() {
      var filtered = properties.filter(this.hasOwnProperty, this);
      if (this.milliseconds && filtered.indexOf("seconds") < 0) {
        filtered.push("seconds");
      }
      if (filtered.length === 0) return "0";
      return filtered.map(function(property) {
        var value = this[property] || 0;
        if (property === "seconds" && this.milliseconds) {
          value = (value + this.milliseconds / 1e3).toFixed(6).replace(/\.?0+$/, "");
        }
        return value + " " + property;
      }, this).join(" ");
    };
    var propertiesISOEquivalent = {
      years: "Y",
      months: "M",
      days: "D",
      hours: "H",
      minutes: "M",
      seconds: "S"
    };
    var dateProperties = ["years", "months", "days"];
    var timeProperties = ["hours", "minutes", "seconds"];
    PostgresInterval.prototype.toISOString = PostgresInterval.prototype.toISO = function() {
      var datePart = dateProperties.map(buildProperty, this).join("");
      var timePart = timeProperties.map(buildProperty, this).join("");
      return "P" + datePart + "T" + timePart;
      function buildProperty(property) {
        var value = this[property] || 0;
        if (property === "seconds" && this.milliseconds) {
          value = (value + this.milliseconds / 1e3).toFixed(6).replace(/0+$/, "");
        }
        return value + propertiesISOEquivalent[property];
      }
    };
    var NUMBER = "([+-]?\\d+)";
    var YEAR = NUMBER + "\\s+years?";
    var MONTH = NUMBER + "\\s+mons?";
    var DAY = NUMBER + "\\s+days?";
    var TIME = "([+-])?([\\d]*):(\\d\\d):(\\d\\d)\\.?(\\d{1,6})?";
    var INTERVAL = new RegExp([YEAR, MONTH, DAY, TIME].map(function(regexString) {
      return "(" + regexString + ")?";
    }).join("\\s*"));
    var positions = {
      years: 2,
      months: 4,
      days: 6,
      hours: 9,
      minutes: 10,
      seconds: 11,
      milliseconds: 12
    };
    var negatives = ["hours", "minutes", "seconds", "milliseconds"];
    function parseMilliseconds(fraction) {
      var microseconds = fraction + "000000".slice(fraction.length);
      return parseInt(microseconds, 10) / 1e3;
    }
    function parse(interval) {
      if (!interval) return {};
      var matches = INTERVAL.exec(interval);
      var isNegative = matches[8] === "-";
      return Object.keys(positions).reduce(function(parsed, property) {
        var position = positions[property];
        var value = matches[position];
        if (!value) return parsed;
        value = property === "milliseconds" ? parseMilliseconds(value) : parseInt(value, 10);
        if (!value) return parsed;
        if (isNegative && ~negatives.indexOf(property)) {
          value *= -1;
        }
        parsed[property] = value;
        return parsed;
      }, {});
    }
  }
});

// node_modules/postgres-bytea/index.js
var require_postgres_bytea = __commonJS({
  "node_modules/postgres-bytea/index.js"(exports, module) {
    "use strict";
    var bufferFrom = Buffer.from || Buffer;
    module.exports = function parseBytea(input2) {
      if (/^\\x/.test(input2)) {
        return bufferFrom(input2.substr(2), "hex");
      }
      var output = "";
      var i = 0;
      while (i < input2.length) {
        if (input2[i] !== "\\") {
          output += input2[i];
          ++i;
        } else {
          if (/[0-7]{3}/.test(input2.substr(i + 1, 3))) {
            output += String.fromCharCode(parseInt(input2.substr(i + 1, 3), 8));
            i += 4;
          } else {
            var backslashes = 1;
            while (i + backslashes < input2.length && input2[i + backslashes] === "\\") {
              backslashes++;
            }
            for (var k = 0; k < Math.floor(backslashes / 2); ++k) {
              output += "\\";
            }
            i += Math.floor(backslashes / 2) * 2;
          }
        }
      }
      return bufferFrom(output, "binary");
    };
  }
});

// node_modules/pg-types/lib/textParsers.js
var require_textParsers = __commonJS({
  "node_modules/pg-types/lib/textParsers.js"(exports, module) {
    var array = require_postgres_array();
    var arrayParser = require_arrayParser();
    var parseDate = require_postgres_date();
    var parseInterval = require_postgres_interval();
    var parseByteA = require_postgres_bytea();
    function allowNull(fn) {
      return function nullAllowed(value) {
        if (value === null) return value;
        return fn(value);
      };
    }
    function parseBool(value) {
      if (value === null) return value;
      return value === "TRUE" || value === "t" || value === "true" || value === "y" || value === "yes" || value === "on" || value === "1";
    }
    function parseBoolArray(value) {
      if (!value) return null;
      return array.parse(value, parseBool);
    }
    function parseBaseTenInt(string) {
      return parseInt(string, 10);
    }
    function parseIntegerArray(value) {
      if (!value) return null;
      return array.parse(value, allowNull(parseBaseTenInt));
    }
    function parseBigIntegerArray(value) {
      if (!value) return null;
      return array.parse(value, allowNull(function(entry) {
        return parseBigInteger(entry).trim();
      }));
    }
    var parsePointArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parsePoint(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseFloatArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parseFloat(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseStringArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value);
      return p.parse();
    };
    var parseDateArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parseDate(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseIntervalArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parseInterval(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseByteAArray = function(value) {
      if (!value) {
        return null;
      }
      return array.parse(value, allowNull(parseByteA));
    };
    var parseInteger = function(value) {
      return parseInt(value, 10);
    };
    var parseBigInteger = function(value) {
      var valStr = String(value);
      if (/^\d+$/.test(valStr)) {
        return valStr;
      }
      return value;
    };
    var parseJsonArray = function(value) {
      if (!value) {
        return null;
      }
      return array.parse(value, allowNull(JSON.parse));
    };
    var parsePoint = function(value) {
      if (value[0] !== "(") {
        return null;
      }
      value = value.substring(1, value.length - 1).split(",");
      return {
        x: parseFloat(value[0]),
        y: parseFloat(value[1])
      };
    };
    var parseCircle = function(value) {
      if (value[0] !== "<" && value[1] !== "(") {
        return null;
      }
      var point = "(";
      var radius = "";
      var pointParsed = false;
      for (var i = 2; i < value.length - 1; i++) {
        if (!pointParsed) {
          point += value[i];
        }
        if (value[i] === ")") {
          pointParsed = true;
          continue;
        } else if (!pointParsed) {
          continue;
        }
        if (value[i] === ",") {
          continue;
        }
        radius += value[i];
      }
      var result = parsePoint(point);
      result.radius = parseFloat(radius);
      return result;
    };
    var init = function(register) {
      register(20, parseBigInteger);
      register(21, parseInteger);
      register(23, parseInteger);
      register(26, parseInteger);
      register(700, parseFloat);
      register(701, parseFloat);
      register(16, parseBool);
      register(1082, parseDate);
      register(1114, parseDate);
      register(1184, parseDate);
      register(600, parsePoint);
      register(651, parseStringArray);
      register(718, parseCircle);
      register(1e3, parseBoolArray);
      register(1001, parseByteAArray);
      register(1005, parseIntegerArray);
      register(1007, parseIntegerArray);
      register(1028, parseIntegerArray);
      register(1016, parseBigIntegerArray);
      register(1017, parsePointArray);
      register(1021, parseFloatArray);
      register(1022, parseFloatArray);
      register(1231, parseFloatArray);
      register(1014, parseStringArray);
      register(1015, parseStringArray);
      register(1008, parseStringArray);
      register(1009, parseStringArray);
      register(1040, parseStringArray);
      register(1041, parseStringArray);
      register(1115, parseDateArray);
      register(1182, parseDateArray);
      register(1185, parseDateArray);
      register(1186, parseInterval);
      register(1187, parseIntervalArray);
      register(17, parseByteA);
      register(114, JSON.parse.bind(JSON));
      register(3802, JSON.parse.bind(JSON));
      register(199, parseJsonArray);
      register(3807, parseJsonArray);
      register(3907, parseStringArray);
      register(2951, parseStringArray);
      register(791, parseStringArray);
      register(1183, parseStringArray);
      register(1270, parseStringArray);
    };
    module.exports = {
      init
    };
  }
});

// node_modules/pg-int8/index.js
var require_pg_int8 = __commonJS({
  "node_modules/pg-int8/index.js"(exports, module) {
    "use strict";
    var BASE = 1e6;
    function readInt8(buffer) {
      var high = buffer.readInt32BE(0);
      var low = buffer.readUInt32BE(4);
      var sign = "";
      if (high < 0) {
        high = ~high + (low === 0);
        low = ~low + 1 >>> 0;
        sign = "-";
      }
      var result = "";
      var carry;
      var t;
      var digits;
      var pad;
      var l;
      var i;
      {
        carry = high % BASE;
        high = high / BASE >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE >>> 0;
        digits = "" + (t - BASE * low);
        if (low === 0 && high === 0) {
          return sign + digits + result;
        }
        pad = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad += "0";
        }
        result = pad + digits + result;
      }
      {
        carry = high % BASE;
        high = high / BASE >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE >>> 0;
        digits = "" + (t - BASE * low);
        if (low === 0 && high === 0) {
          return sign + digits + result;
        }
        pad = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad += "0";
        }
        result = pad + digits + result;
      }
      {
        carry = high % BASE;
        high = high / BASE >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE >>> 0;
        digits = "" + (t - BASE * low);
        if (low === 0 && high === 0) {
          return sign + digits + result;
        }
        pad = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad += "0";
        }
        result = pad + digits + result;
      }
      {
        carry = high % BASE;
        t = 4294967296 * carry + low;
        digits = "" + t % BASE;
        return sign + digits + result;
      }
    }
    module.exports = readInt8;
  }
});

// node_modules/pg-types/lib/binaryParsers.js
var require_binaryParsers = __commonJS({
  "node_modules/pg-types/lib/binaryParsers.js"(exports, module) {
    var parseInt64 = require_pg_int8();
    var parseBits = function(data, bits, offset, invert, callback) {
      offset = offset || 0;
      invert = invert || false;
      callback = callback || function(lastValue, newValue, bits2) {
        return lastValue * Math.pow(2, bits2) + newValue;
      };
      var offsetBytes = offset >> 3;
      var inv = function(value) {
        if (invert) {
          return ~value & 255;
        }
        return value;
      };
      var mask = 255;
      var firstBits = 8 - offset % 8;
      if (bits < firstBits) {
        mask = 255 << 8 - bits & 255;
        firstBits = bits;
      }
      if (offset) {
        mask = mask >> offset % 8;
      }
      var result = 0;
      if (offset % 8 + bits >= 8) {
        result = callback(0, inv(data[offsetBytes]) & mask, firstBits);
      }
      var bytes = bits + offset >> 3;
      for (var i = offsetBytes + 1; i < bytes; i++) {
        result = callback(result, inv(data[i]), 8);
      }
      var lastBits = (bits + offset) % 8;
      if (lastBits > 0) {
        result = callback(result, inv(data[bytes]) >> 8 - lastBits, lastBits);
      }
      return result;
    };
    var parseFloatFromBits = function(data, precisionBits, exponentBits) {
      var bias = Math.pow(2, exponentBits - 1) - 1;
      var sign = parseBits(data, 1);
      var exponent = parseBits(data, exponentBits, 1);
      if (exponent === 0) {
        return 0;
      }
      var precisionBitsCounter = 1;
      var parsePrecisionBits = function(lastValue, newValue, bits) {
        if (lastValue === 0) {
          lastValue = 1;
        }
        for (var i = 1; i <= bits; i++) {
          precisionBitsCounter /= 2;
          if ((newValue & 1 << bits - i) > 0) {
            lastValue += precisionBitsCounter;
          }
        }
        return lastValue;
      };
      var mantissa = parseBits(data, precisionBits, exponentBits + 1, false, parsePrecisionBits);
      if (exponent == Math.pow(2, exponentBits + 1) - 1) {
        if (mantissa === 0) {
          return sign === 0 ? Infinity : -Infinity;
        }
        return NaN;
      }
      return (sign === 0 ? 1 : -1) * Math.pow(2, exponent - bias) * mantissa;
    };
    var parseInt16 = function(value) {
      if (parseBits(value, 1) == 1) {
        return -1 * (parseBits(value, 15, 1, true) + 1);
      }
      return parseBits(value, 15, 1);
    };
    var parseInt32 = function(value) {
      if (parseBits(value, 1) == 1) {
        return -1 * (parseBits(value, 31, 1, true) + 1);
      }
      return parseBits(value, 31, 1);
    };
    var parseFloat32 = function(value) {
      return parseFloatFromBits(value, 23, 8);
    };
    var parseFloat64 = function(value) {
      return parseFloatFromBits(value, 52, 11);
    };
    var parseNumeric = function(value) {
      var sign = parseBits(value, 16, 32);
      if (sign == 49152) {
        return NaN;
      }
      var weight = Math.pow(1e4, parseBits(value, 16, 16));
      var result = 0;
      var digits = [];
      var ndigits = parseBits(value, 16);
      for (var i = 0; i < ndigits; i++) {
        result += parseBits(value, 16, 64 + 16 * i) * weight;
        weight /= 1e4;
      }
      var scale = Math.pow(10, parseBits(value, 16, 48));
      return (sign === 0 ? 1 : -1) * Math.round(result * scale) / scale;
    };
    var parseDate = function(isUTC, value) {
      var sign = parseBits(value, 1);
      var rawValue = parseBits(value, 63, 1);
      var result = new Date((sign === 0 ? 1 : -1) * rawValue / 1e3 + 9466848e5);
      if (!isUTC) {
        result.setTime(result.getTime() + result.getTimezoneOffset() * 6e4);
      }
      result.usec = rawValue % 1e3;
      result.getMicroSeconds = function() {
        return this.usec;
      };
      result.setMicroSeconds = function(value2) {
        this.usec = value2;
      };
      result.getUTCMicroSeconds = function() {
        return this.usec;
      };
      return result;
    };
    var parseArray = function(value) {
      var dim = parseBits(value, 32);
      var flags = parseBits(value, 32, 32);
      var elementType = parseBits(value, 32, 64);
      var offset = 96;
      var dims = [];
      for (var i = 0; i < dim; i++) {
        dims[i] = parseBits(value, 32, offset);
        offset += 32;
        offset += 32;
      }
      var parseElement = function(elementType2) {
        var length = parseBits(value, 32, offset);
        offset += 32;
        if (length == 4294967295) {
          return null;
        }
        var result;
        if (elementType2 == 23 || elementType2 == 20) {
          result = parseBits(value, length * 8, offset);
          offset += length * 8;
          return result;
        } else if (elementType2 == 25) {
          result = value.toString(this.encoding, offset >> 3, (offset += length << 3) >> 3);
          return result;
        } else {
          console.log("ERROR: ElementType not implemented: " + elementType2);
        }
      };
      var parse = function(dimension, elementType2) {
        var array = [];
        var i2;
        if (dimension.length > 1) {
          var count = dimension.shift();
          for (i2 = 0; i2 < count; i2++) {
            array[i2] = parse(dimension, elementType2);
          }
          dimension.unshift(count);
        } else {
          for (i2 = 0; i2 < dimension[0]; i2++) {
            array[i2] = parseElement(elementType2);
          }
        }
        return array;
      };
      return parse(dims, elementType);
    };
    var parseText = function(value) {
      return value.toString("utf8");
    };
    var parseBool = function(value) {
      if (value === null) return null;
      return parseBits(value, 8) > 0;
    };
    var init = function(register) {
      register(20, parseInt64);
      register(21, parseInt16);
      register(23, parseInt32);
      register(26, parseInt32);
      register(1700, parseNumeric);
      register(700, parseFloat32);
      register(701, parseFloat64);
      register(16, parseBool);
      register(1114, parseDate.bind(null, false));
      register(1184, parseDate.bind(null, true));
      register(1e3, parseArray);
      register(1007, parseArray);
      register(1016, parseArray);
      register(1008, parseArray);
      register(1009, parseArray);
      register(25, parseText);
    };
    module.exports = {
      init
    };
  }
});

// node_modules/pg-types/lib/builtins.js
var require_builtins = __commonJS({
  "node_modules/pg-types/lib/builtins.js"(exports, module) {
    module.exports = {
      BOOL: 16,
      BYTEA: 17,
      CHAR: 18,
      INT8: 20,
      INT2: 21,
      INT4: 23,
      REGPROC: 24,
      TEXT: 25,
      OID: 26,
      TID: 27,
      XID: 28,
      CID: 29,
      JSON: 114,
      XML: 142,
      PG_NODE_TREE: 194,
      SMGR: 210,
      PATH: 602,
      POLYGON: 604,
      CIDR: 650,
      FLOAT4: 700,
      FLOAT8: 701,
      ABSTIME: 702,
      RELTIME: 703,
      TINTERVAL: 704,
      CIRCLE: 718,
      MACADDR8: 774,
      MONEY: 790,
      MACADDR: 829,
      INET: 869,
      ACLITEM: 1033,
      BPCHAR: 1042,
      VARCHAR: 1043,
      DATE: 1082,
      TIME: 1083,
      TIMESTAMP: 1114,
      TIMESTAMPTZ: 1184,
      INTERVAL: 1186,
      TIMETZ: 1266,
      BIT: 1560,
      VARBIT: 1562,
      NUMERIC: 1700,
      REFCURSOR: 1790,
      REGPROCEDURE: 2202,
      REGOPER: 2203,
      REGOPERATOR: 2204,
      REGCLASS: 2205,
      REGTYPE: 2206,
      UUID: 2950,
      TXID_SNAPSHOT: 2970,
      PG_LSN: 3220,
      PG_NDISTINCT: 3361,
      PG_DEPENDENCIES: 3402,
      TSVECTOR: 3614,
      TSQUERY: 3615,
      GTSVECTOR: 3642,
      REGCONFIG: 3734,
      REGDICTIONARY: 3769,
      JSONB: 3802,
      REGNAMESPACE: 4089,
      REGROLE: 4096
    };
  }
});

// node_modules/pg-types/index.js
var require_pg_types = __commonJS({
  "node_modules/pg-types/index.js"(exports) {
    var textParsers = require_textParsers();
    var binaryParsers = require_binaryParsers();
    var arrayParser = require_arrayParser();
    var builtinTypes = require_builtins();
    exports.getTypeParser = getTypeParser;
    exports.setTypeParser = setTypeParser;
    exports.arrayParser = arrayParser;
    exports.builtins = builtinTypes;
    var typeParsers = {
      text: {},
      binary: {}
    };
    function noParse(val) {
      return String(val);
    }
    function getTypeParser(oid, format) {
      format = format || "text";
      if (!typeParsers[format]) {
        return noParse;
      }
      return typeParsers[format][oid] || noParse;
    }
    function setTypeParser(oid, format, parseFn) {
      if (typeof format == "function") {
        parseFn = format;
        format = "text";
      }
      typeParsers[format][oid] = parseFn;
    }
    textParsers.init(function(oid, converter) {
      typeParsers.text[oid] = converter;
    });
    binaryParsers.init(function(oid, converter) {
      typeParsers.binary[oid] = converter;
    });
  }
});

// node_modules/pg/lib/defaults.js
var require_defaults = __commonJS({
  "node_modules/pg/lib/defaults.js"(exports, module) {
    "use strict";
    module.exports = {
      // database host. defaults to localhost
      host: "localhost",
      // database user's name
      user: process.platform === "win32" ? process.env.USERNAME : process.env.USER,
      // name of database to connect
      database: void 0,
      // database user's password
      password: null,
      // a Postgres connection string to be used instead of setting individual connection items
      // NOTE:  Setting this value will cause it to override any other value (such as database or user) defined
      // in the defaults object.
      connectionString: void 0,
      // database port
      port: 5432,
      // number of rows to return at a time from a prepared statement's
      // portal. 0 will return all rows at once
      rows: 0,
      // binary result mode
      binary: false,
      // Connection pool options - see https://github.com/brianc/node-pg-pool
      // number of connections to use in connection pool
      // 0 will disable connection pooling
      max: 10,
      // max milliseconds a client can go unused before it is removed
      // from the pool and destroyed
      idleTimeoutMillis: 3e4,
      client_encoding: "",
      ssl: false,
      application_name: void 0,
      fallback_application_name: void 0,
      options: void 0,
      parseInputDatesAsUTC: false,
      // max milliseconds any query using this connection will execute for before timing out in error.
      // false=unlimited
      statement_timeout: false,
      // Abort any statement that waits longer than the specified duration in milliseconds while attempting to acquire a lock.
      // false=unlimited
      lock_timeout: false,
      // Terminate any session with an open transaction that has been idle for longer than the specified duration in milliseconds
      // false=unlimited
      idle_in_transaction_session_timeout: false,
      // max milliseconds to wait for query to complete (client side)
      query_timeout: false,
      connect_timeout: 0,
      keepalives: 1,
      keepalives_idle: 0
    };
    var pgTypes = require_pg_types();
    var parseBigInteger = pgTypes.getTypeParser(20, "text");
    var parseBigIntegerArray = pgTypes.getTypeParser(1016, "text");
    module.exports.__defineSetter__("parseInt8", function(val) {
      pgTypes.setTypeParser(20, "text", val ? pgTypes.getTypeParser(23, "text") : parseBigInteger);
      pgTypes.setTypeParser(1016, "text", val ? pgTypes.getTypeParser(1007, "text") : parseBigIntegerArray);
    });
  }
});

// node_modules/pg/lib/utils.js
var require_utils2 = __commonJS({
  "node_modules/pg/lib/utils.js"(exports, module) {
    "use strict";
    var defaults2 = require_defaults();
    var util = __require("util");
    var { isDate } = util.types || util;
    function escapeElement(elementRepresentation) {
      const escaped = elementRepresentation.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return '"' + escaped + '"';
    }
    function arrayString(val) {
      let result = "{";
      for (let i = 0; i < val.length; i++) {
        if (i > 0) {
          result = result + ",";
        }
        if (val[i] === null || typeof val[i] === "undefined") {
          result = result + "NULL";
        } else if (Array.isArray(val[i])) {
          result = result + arrayString(val[i]);
        } else if (ArrayBuffer.isView(val[i])) {
          let item = val[i];
          if (!(item instanceof Buffer)) {
            const buf = Buffer.from(item.buffer, item.byteOffset, item.byteLength);
            if (buf.length === item.byteLength) {
              item = buf;
            } else {
              item = buf.slice(item.byteOffset, item.byteOffset + item.byteLength);
            }
          }
          result += "\\\\x" + item.toString("hex");
        } else {
          result += escapeElement(prepareValue(val[i]));
        }
      }
      result = result + "}";
      return result;
    }
    var prepareValue = function(val, seen) {
      if (val == null) {
        return null;
      }
      if (typeof val === "object") {
        if (val instanceof Buffer) {
          return val;
        }
        if (ArrayBuffer.isView(val)) {
          const buf = Buffer.from(val.buffer, val.byteOffset, val.byteLength);
          if (buf.length === val.byteLength) {
            return buf;
          }
          return buf.slice(val.byteOffset, val.byteOffset + val.byteLength);
        }
        if (isDate(val)) {
          if (defaults2.parseInputDatesAsUTC) {
            return dateToStringUTC(val);
          } else {
            return dateToString(val);
          }
        }
        if (Array.isArray(val)) {
          return arrayString(val);
        }
        return prepareObject(val, seen);
      }
      return val.toString();
    };
    function prepareObject(val, seen) {
      if (val && typeof val.toPostgres === "function") {
        seen = seen || [];
        if (seen.indexOf(val) !== -1) {
          throw new Error('circular reference detected while preparing "' + val + '" for query');
        }
        seen.push(val);
        return prepareValue(val.toPostgres(prepareValue), seen);
      }
      return JSON.stringify(val);
    }
    function dateToString(date2) {
      let offset = -date2.getTimezoneOffset();
      let year = date2.getFullYear();
      const isBCYear = year < 1;
      if (isBCYear) year = Math.abs(year) + 1;
      let ret = String(year).padStart(4, "0") + "-" + String(date2.getMonth() + 1).padStart(2, "0") + "-" + String(date2.getDate()).padStart(2, "0") + "T" + String(date2.getHours()).padStart(2, "0") + ":" + String(date2.getMinutes()).padStart(2, "0") + ":" + String(date2.getSeconds()).padStart(2, "0") + "." + String(date2.getMilliseconds()).padStart(3, "0");
      if (offset < 0) {
        ret += "-";
        offset *= -1;
      } else {
        ret += "+";
      }
      ret += String(Math.floor(offset / 60)).padStart(2, "0") + ":" + String(offset % 60).padStart(2, "0");
      if (isBCYear) ret += " BC";
      return ret;
    }
    function dateToStringUTC(date2) {
      let year = date2.getUTCFullYear();
      const isBCYear = year < 1;
      if (isBCYear) year = Math.abs(year) + 1;
      let ret = String(year).padStart(4, "0") + "-" + String(date2.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date2.getUTCDate()).padStart(2, "0") + "T" + String(date2.getUTCHours()).padStart(2, "0") + ":" + String(date2.getUTCMinutes()).padStart(2, "0") + ":" + String(date2.getUTCSeconds()).padStart(2, "0") + "." + String(date2.getUTCMilliseconds()).padStart(3, "0");
      ret += "+00:00";
      if (isBCYear) ret += " BC";
      return ret;
    }
    function normalizeQueryConfig(config2, values, callback) {
      config2 = typeof config2 === "string" ? { text: config2 } : config2;
      if (values) {
        if (typeof values === "function") {
          config2.callback = values;
        } else {
          config2.values = values;
        }
      }
      if (callback) {
        config2.callback = callback;
      }
      return config2;
    }
    var escapeIdentifier2 = function(str2) {
      return '"' + str2.replace(/"/g, '""') + '"';
    };
    var escapeLiteral2 = function(str2) {
      let hasBackslash = false;
      let escaped = "'";
      if (str2 == null) {
        return "''";
      }
      if (typeof str2 !== "string") {
        return "''";
      }
      for (let i = 0; i < str2.length; i++) {
        const c = str2[i];
        if (c === "'") {
          escaped += c + c;
        } else if (c === "\\") {
          escaped += c + c;
          hasBackslash = true;
        } else {
          escaped += c;
        }
      }
      escaped += "'";
      if (hasBackslash === true) {
        escaped = " E" + escaped;
      }
      return escaped;
    };
    module.exports = {
      prepareValue: function prepareValueWrapper(value) {
        return prepareValue(value);
      },
      normalizeQueryConfig,
      escapeIdentifier: escapeIdentifier2,
      escapeLiteral: escapeLiteral2
    };
  }
});

// node_modules/pg/lib/crypto/utils-legacy.js
var require_utils_legacy = __commonJS({
  "node_modules/pg/lib/crypto/utils-legacy.js"(exports, module) {
    "use strict";
    var nodeCrypto = __require("crypto");
    function md5(string) {
      return nodeCrypto.createHash("md5").update(string, "utf-8").digest("hex");
    }
    function postgresMd5PasswordHash(user, password, salt) {
      const inner = md5(password + user);
      const outer = md5(Buffer.concat([Buffer.from(inner), salt]));
      return "md5" + outer;
    }
    function sha256(text) {
      return nodeCrypto.createHash("sha256").update(text).digest();
    }
    function hashByName(hashName, text) {
      hashName = hashName.replace(/(\D)-/, "$1");
      return nodeCrypto.createHash(hashName).update(text).digest();
    }
    function hmacSha256(key, msg) {
      return nodeCrypto.createHmac("sha256", key).update(msg).digest();
    }
    async function deriveKey(password, salt, iterations) {
      return nodeCrypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
    }
    module.exports = {
      postgresMd5PasswordHash,
      randomBytes: nodeCrypto.randomBytes,
      deriveKey,
      sha256,
      hashByName,
      hmacSha256,
      md5
    };
  }
});

// node_modules/pg/lib/crypto/utils-webcrypto.js
var require_utils_webcrypto = __commonJS({
  "node_modules/pg/lib/crypto/utils-webcrypto.js"(exports, module) {
    var nodeCrypto = __require("crypto");
    module.exports = {
      postgresMd5PasswordHash,
      randomBytes: randomBytes3,
      deriveKey,
      sha256,
      hashByName,
      hmacSha256,
      md5
    };
    var webCrypto = nodeCrypto.webcrypto || globalThis.crypto;
    var subtleCrypto = webCrypto.subtle;
    var textEncoder = new TextEncoder();
    function randomBytes3(length) {
      return webCrypto.getRandomValues(Buffer.alloc(length));
    }
    async function md5(string) {
      try {
        return nodeCrypto.createHash("md5").update(string, "utf-8").digest("hex");
      } catch (e) {
        const data = typeof string === "string" ? textEncoder.encode(string) : string;
        const hash2 = await subtleCrypto.digest("MD5", data);
        return Array.from(new Uint8Array(hash2)).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    }
    async function postgresMd5PasswordHash(user, password, salt) {
      const inner = await md5(password + user);
      const outer = await md5(Buffer.concat([Buffer.from(inner), salt]));
      return "md5" + outer;
    }
    async function sha256(text) {
      return await subtleCrypto.digest("SHA-256", text);
    }
    async function hashByName(hashName, text) {
      return await subtleCrypto.digest(hashName, text);
    }
    async function hmacSha256(keyBuffer, msg) {
      const key = await subtleCrypto.importKey("raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return await subtleCrypto.sign("HMAC", key, textEncoder.encode(msg));
    }
    async function deriveKey(password, salt, iterations) {
      const key = await subtleCrypto.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
      const params = { name: "PBKDF2", hash: "SHA-256", salt, iterations };
      return await subtleCrypto.deriveBits(params, key, 32 * 8, ["deriveBits"]);
    }
  }
});

// node_modules/pg/lib/crypto/utils.js
var require_utils3 = __commonJS({
  "node_modules/pg/lib/crypto/utils.js"(exports, module) {
    "use strict";
    var useLegacyCrypto = parseInt(process.versions && process.versions.node && process.versions.node.split(".")[0]) < 15;
    if (useLegacyCrypto) {
      module.exports = require_utils_legacy();
    } else {
      module.exports = require_utils_webcrypto();
    }
  }
});

// node_modules/pg/lib/crypto/cert-signatures.js
var require_cert_signatures = __commonJS({
  "node_modules/pg/lib/crypto/cert-signatures.js"(exports, module) {
    function x509Error(msg, cert) {
      return new Error("SASL channel binding: " + msg + " when parsing public certificate " + cert.toString("base64"));
    }
    function readASN1Length(data, index2) {
      let length = data[index2++];
      if (length < 128) return { length, index: index2 };
      const lengthBytes = length & 127;
      if (lengthBytes > 4) throw x509Error("bad length", data);
      length = 0;
      for (let i = 0; i < lengthBytes; i++) {
        length = length << 8 | data[index2++];
      }
      return { length, index: index2 };
    }
    function readASN1OID(data, index2) {
      if (data[index2++] !== 6) throw x509Error("non-OID data", data);
      const { length: OIDLength, index: indexAfterOIDLength } = readASN1Length(data, index2);
      index2 = indexAfterOIDLength;
      const lastIndex = index2 + OIDLength;
      const byte1 = data[index2++];
      let oid = (byte1 / 40 >> 0) + "." + byte1 % 40;
      while (index2 < lastIndex) {
        let value = 0;
        while (index2 < lastIndex) {
          const nextByte = data[index2++];
          value = value << 7 | nextByte & 127;
          if (nextByte < 128) break;
        }
        oid += "." + value;
      }
      return { oid, index: index2 };
    }
    function expectASN1Seq(data, index2) {
      if (data[index2++] !== 48) throw x509Error("non-sequence data", data);
      return readASN1Length(data, index2);
    }
    function signatureAlgorithmHashFromCertificate(data, index2) {
      if (index2 === void 0) index2 = 0;
      index2 = expectASN1Seq(data, index2).index;
      const { length: certInfoLength, index: indexAfterCertInfoLength } = expectASN1Seq(data, index2);
      index2 = indexAfterCertInfoLength + certInfoLength;
      index2 = expectASN1Seq(data, index2).index;
      const { oid, index: indexAfterOID } = readASN1OID(data, index2);
      switch (oid) {
        // RSA
        case "1.2.840.113549.1.1.4":
          return "MD5";
        case "1.2.840.113549.1.1.5":
          return "SHA-1";
        case "1.2.840.113549.1.1.11":
          return "SHA-256";
        case "1.2.840.113549.1.1.12":
          return "SHA-384";
        case "1.2.840.113549.1.1.13":
          return "SHA-512";
        case "1.2.840.113549.1.1.14":
          return "SHA-224";
        case "1.2.840.113549.1.1.15":
          return "SHA512-224";
        case "1.2.840.113549.1.1.16":
          return "SHA512-256";
        // ECDSA
        case "1.2.840.10045.4.1":
          return "SHA-1";
        case "1.2.840.10045.4.3.1":
          return "SHA-224";
        case "1.2.840.10045.4.3.2":
          return "SHA-256";
        case "1.2.840.10045.4.3.3":
          return "SHA-384";
        case "1.2.840.10045.4.3.4":
          return "SHA-512";
        // RSASSA-PSS: hash is indicated separately
        case "1.2.840.113549.1.1.10": {
          index2 = indexAfterOID;
          index2 = expectASN1Seq(data, index2).index;
          if (data[index2++] !== 160) throw x509Error("non-tag data", data);
          index2 = readASN1Length(data, index2).index;
          index2 = expectASN1Seq(data, index2).index;
          const { oid: hashOID } = readASN1OID(data, index2);
          switch (hashOID) {
            // standalone hash OIDs
            case "1.2.840.113549.2.5":
              return "MD5";
            case "1.3.14.3.2.26":
              return "SHA-1";
            case "2.16.840.1.101.3.4.2.1":
              return "SHA-256";
            case "2.16.840.1.101.3.4.2.2":
              return "SHA-384";
            case "2.16.840.1.101.3.4.2.3":
              return "SHA-512";
          }
          throw x509Error("unknown hash OID " + hashOID, data);
        }
        // Ed25519 -- see https: return//github.com/openssl/openssl/issues/15477
        case "1.3.101.110":
        case "1.3.101.112":
          return "SHA-512";
        // Ed448 -- still not in pg 17.2 (if supported, digest would be SHAKE256 x 64 bytes)
        case "1.3.101.111":
        case "1.3.101.113":
          throw x509Error("Ed448 certificate channel binding is not currently supported by Postgres");
      }
      throw x509Error("unknown OID " + oid, data);
    }
    module.exports = { signatureAlgorithmHashFromCertificate };
  }
});

// node_modules/pg/lib/crypto/sasl.js
var require_sasl = __commonJS({
  "node_modules/pg/lib/crypto/sasl.js"(exports, module) {
    "use strict";
    var crypto = require_utils3();
    var { signatureAlgorithmHashFromCertificate } = require_cert_signatures();
    function startSession(mechanisms, stream) {
      const candidates = ["SCRAM-SHA-256"];
      if (stream) candidates.unshift("SCRAM-SHA-256-PLUS");
      const mechanism = candidates.find((candidate2) => mechanisms.includes(candidate2));
      if (!mechanism) {
        throw new Error("SASL: Only mechanism(s) " + candidates.join(" and ") + " are supported");
      }
      if (mechanism === "SCRAM-SHA-256-PLUS" && typeof stream.getPeerCertificate !== "function") {
        throw new Error("SASL: Mechanism SCRAM-SHA-256-PLUS requires a certificate");
      }
      const clientNonce = crypto.randomBytes(18).toString("base64");
      const gs2Header = mechanism === "SCRAM-SHA-256-PLUS" ? "p=tls-server-end-point" : stream ? "y" : "n";
      return {
        mechanism,
        clientNonce,
        response: gs2Header + ",,n=*,r=" + clientNonce,
        message: "SASLInitialResponse"
      };
    }
    async function continueSession(session, password, serverData, stream) {
      if (session.message !== "SASLInitialResponse") {
        throw new Error("SASL: Last message was not SASLInitialResponse");
      }
      if (typeof password !== "string") {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string");
      }
      if (password === "") {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a non-empty string");
      }
      if (typeof serverData !== "string") {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: serverData must be a string");
      }
      const sv = parseServerFirstMessage(serverData);
      if (!sv.nonce.startsWith(session.clientNonce)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce does not start with client nonce");
      } else if (sv.nonce.length === session.clientNonce.length) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce is too short");
      }
      const clientFirstMessageBare = "n=*,r=" + session.clientNonce;
      const serverFirstMessage = "r=" + sv.nonce + ",s=" + sv.salt + ",i=" + sv.iteration;
      let channelBinding = stream ? "eSws" : "biws";
      if (session.mechanism === "SCRAM-SHA-256-PLUS") {
        const peerCert = stream.getPeerCertificate().raw;
        let hashName = signatureAlgorithmHashFromCertificate(peerCert);
        if (hashName === "MD5" || hashName === "SHA-1") hashName = "SHA-256";
        const certHash = await crypto.hashByName(hashName, peerCert);
        const bindingData = Buffer.concat([Buffer.from("p=tls-server-end-point,,"), Buffer.from(certHash)]);
        channelBinding = bindingData.toString("base64");
      }
      const clientFinalMessageWithoutProof = "c=" + channelBinding + ",r=" + sv.nonce;
      const authMessage = clientFirstMessageBare + "," + serverFirstMessage + "," + clientFinalMessageWithoutProof;
      const saltBytes = Buffer.from(sv.salt, "base64");
      const saltedPassword = await crypto.deriveKey(password, saltBytes, sv.iteration);
      const clientKey = await crypto.hmacSha256(saltedPassword, "Client Key");
      const storedKey = await crypto.sha256(clientKey);
      const clientSignature = await crypto.hmacSha256(storedKey, authMessage);
      const clientProof = xorBuffers(Buffer.from(clientKey), Buffer.from(clientSignature)).toString("base64");
      const serverKey = await crypto.hmacSha256(saltedPassword, "Server Key");
      const serverSignatureBytes = await crypto.hmacSha256(serverKey, authMessage);
      session.message = "SASLResponse";
      session.serverSignature = Buffer.from(serverSignatureBytes).toString("base64");
      session.response = clientFinalMessageWithoutProof + ",p=" + clientProof;
    }
    function finalizeSession(session, serverData) {
      if (session.message !== "SASLResponse") {
        throw new Error("SASL: Last message was not SASLResponse");
      }
      if (typeof serverData !== "string") {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: serverData must be a string");
      }
      const { serverSignature } = parseServerFinalMessage(serverData);
      if (serverSignature !== session.serverSignature) {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature does not match");
      }
    }
    function isPrintableChars(text) {
      if (typeof text !== "string") {
        throw new TypeError("SASL: text must be a string");
      }
      return text.split("").map((_, i) => text.charCodeAt(i)).every((c) => c >= 33 && c <= 43 || c >= 45 && c <= 126);
    }
    function isBase64(text) {
      return /^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(text);
    }
    function parseAttributePairs(text) {
      if (typeof text !== "string") {
        throw new TypeError("SASL: attribute pairs text must be a string");
      }
      return new Map(
        text.split(",").map((attrValue) => {
          if (!/^.=/.test(attrValue)) {
            throw new Error("SASL: Invalid attribute pair entry");
          }
          const name = attrValue[0];
          const value = attrValue.substring(2);
          return [name, value];
        })
      );
    }
    function parseServerFirstMessage(data) {
      const attrPairs = parseAttributePairs(data);
      const nonce = attrPairs.get("r");
      if (!nonce) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce missing");
      } else if (!isPrintableChars(nonce)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce must only contain printable characters");
      }
      const salt = attrPairs.get("s");
      if (!salt) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt missing");
      } else if (!isBase64(salt)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt must be base64");
      }
      const iterationText = attrPairs.get("i");
      if (!iterationText) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: iteration missing");
      } else if (!/^[1-9][0-9]*$/.test(iterationText)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: invalid iteration count");
      }
      const iteration = parseInt(iterationText, 10);
      return {
        nonce,
        salt,
        iteration
      };
    }
    function parseServerFinalMessage(serverData) {
      const attrPairs = parseAttributePairs(serverData);
      const serverSignature = attrPairs.get("v");
      if (!serverSignature) {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing");
      } else if (!isBase64(serverSignature)) {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature must be base64");
      }
      return {
        serverSignature
      };
    }
    function xorBuffers(a, b) {
      if (!Buffer.isBuffer(a)) {
        throw new TypeError("first argument must be a Buffer");
      }
      if (!Buffer.isBuffer(b)) {
        throw new TypeError("second argument must be a Buffer");
      }
      if (a.length !== b.length) {
        throw new Error("Buffer lengths must match");
      }
      if (a.length === 0) {
        throw new Error("Buffers cannot be empty");
      }
      return Buffer.from(a.map((_, i) => a[i] ^ b[i]));
    }
    module.exports = {
      startSession,
      continueSession,
      finalizeSession
    };
  }
});

// node_modules/pg/lib/type-overrides.js
var require_type_overrides = __commonJS({
  "node_modules/pg/lib/type-overrides.js"(exports, module) {
    "use strict";
    var types2 = require_pg_types();
    function TypeOverrides2(userTypes) {
      this._types = userTypes || types2;
      this.text = {};
      this.binary = {};
    }
    TypeOverrides2.prototype.getOverrides = function(format) {
      switch (format) {
        case "text":
          return this.text;
        case "binary":
          return this.binary;
        default:
          return {};
      }
    };
    TypeOverrides2.prototype.setTypeParser = function(oid, format, parseFn) {
      if (typeof format === "function") {
        parseFn = format;
        format = "text";
      }
      this.getOverrides(format)[oid] = parseFn;
    };
    TypeOverrides2.prototype.getTypeParser = function(oid, format) {
      format = format || "text";
      return this.getOverrides(format)[oid] || this._types.getTypeParser(oid, format);
    };
    module.exports = TypeOverrides2;
  }
});

// node_modules/pg-connection-string/index.js
var require_pg_connection_string = __commonJS({
  "node_modules/pg-connection-string/index.js"(exports, module) {
    "use strict";
    function parse(str2, options = {}) {
      if (str2.charAt(0) === "/") {
        const config3 = str2.split(" ");
        return { host: config3[0], database: config3[1] };
      }
      const config2 = /* @__PURE__ */ Object.create(null);
      let result;
      let dummyHost = false;
      if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(str2)) {
        str2 = encodeURI(str2).replace(/%25(\d\d)/g, "%$1");
      }
      try {
        try {
          result = new URL(str2, "postgres://base");
        } catch (e) {
          result = new URL(str2.replace("@/", "@___DUMMY___/"), "postgres://base");
          dummyHost = true;
        }
      } catch (err) {
        err.input && (err.input = "*****REDACTED*****");
        throw err;
      }
      for (const entry of result.searchParams.entries()) {
        config2[entry[0]] = entry[1];
      }
      config2.user = config2.user || decodeURIComponent(result.username);
      config2.password = config2.password || decodeURIComponent(result.password);
      if (result.protocol == "socket:") {
        config2.host = decodeURI(result.pathname);
        config2.database = result.searchParams.get("db");
        config2.client_encoding = result.searchParams.get("encoding");
        return config2;
      }
      const hostname = (dummyHost ? "" : result.hostname).replace(/^\[(.+)\]$/, "$1");
      if (!config2.host) {
        config2.host = decodeURIComponent(hostname);
      } else if (hostname && /^%2f/i.test(hostname)) {
        result.pathname = hostname + result.pathname;
      }
      if (!config2.port) {
        config2.port = result.port;
      }
      const pathname = result.pathname.slice(1) || null;
      config2.database = pathname ? decodeURI(pathname) : null;
      if (config2.ssl === "true" || config2.ssl === "1") {
        config2.ssl = true;
      }
      if (config2.ssl === "0") {
        config2.ssl = false;
      }
      if (config2.sslcert || config2.sslkey || config2.sslrootcert || config2.sslmode) {
        config2.ssl = {};
      }
      if (config2.sslnegotiation === "direct" && config2.ssl === void 0) {
        config2.ssl = true;
      }
      const fs = config2.sslcert || config2.sslkey || config2.sslrootcert ? __require("fs") : null;
      if (config2.sslcert) {
        config2.ssl.cert = fs.readFileSync(config2.sslcert).toString();
      }
      if (config2.sslkey) {
        config2.ssl.key = fs.readFileSync(config2.sslkey).toString();
      }
      if (config2.sslrootcert) {
        config2.ssl.ca = fs.readFileSync(config2.sslrootcert).toString();
      }
      if (options.useLibpqCompat && config2.uselibpqcompat) {
        throw new Error("Both useLibpqCompat and uselibpqcompat are set. Please use only one of them.");
      }
      if (config2.uselibpqcompat === "true" || options.useLibpqCompat) {
        switch (config2.sslmode) {
          case "disable": {
            config2.ssl = false;
            break;
          }
          case "prefer": {
            config2.ssl.rejectUnauthorized = false;
            break;
          }
          case "require": {
            if (config2.sslrootcert) {
              config2.ssl.checkServerIdentity = function() {
              };
            } else {
              config2.ssl.rejectUnauthorized = false;
            }
            break;
          }
          case "verify-ca": {
            if (!config2.ssl.ca) {
              throw new Error(
                "SECURITY WARNING: Using sslmode=verify-ca requires specifying a CA with sslrootcert. If a public CA is used, verify-ca allows connections to a server that somebody else may have registered with the CA, making you vulnerable to Man-in-the-Middle attacks. Either specify a custom CA certificate with sslrootcert parameter or use sslmode=verify-full for proper security."
              );
            }
            config2.ssl.checkServerIdentity = function() {
            };
            break;
          }
          case "verify-full": {
            break;
          }
        }
      } else {
        switch (config2.sslmode) {
          case "disable": {
            config2.ssl = false;
            break;
          }
          case "prefer":
          case "require":
          case "verify-ca":
          case "verify-full": {
            if (config2.sslmode !== "verify-full") {
              deprecatedSslModeWarning(config2.sslmode);
            }
            break;
          }
          case "no-verify": {
            config2.ssl.rejectUnauthorized = false;
            break;
          }
        }
      }
      return config2;
    }
    function toConnectionOptions(sslConfig) {
      const connectionOptions = Object.entries(sslConfig).reduce((c, [key, value]) => {
        if (value !== void 0 && value !== null) {
          c[key] = value;
        }
        return c;
      }, /* @__PURE__ */ Object.create(null));
      return connectionOptions;
    }
    function toClientConfig(config2) {
      const poolConfig = Object.entries(config2).reduce((c, [key, value]) => {
        if (key === "ssl") {
          const sslConfig = value;
          if (typeof sslConfig === "boolean") {
            c[key] = sslConfig;
          }
          if (typeof sslConfig === "object") {
            c[key] = toConnectionOptions(sslConfig);
          }
        } else if (value !== void 0 && value !== null) {
          if (key === "port") {
            if (value !== "") {
              const v = parseInt(value, 10);
              if (isNaN(v)) {
                throw new Error(`Invalid ${key}: ${value}`);
              }
              c[key] = v;
            }
          } else {
            c[key] = value;
          }
        }
        return c;
      }, /* @__PURE__ */ Object.create(null));
      return poolConfig;
    }
    function parseIntoClientConfig(str2) {
      return toClientConfig(parse(str2));
    }
    function deprecatedSslModeWarning(sslmode) {
      if (!deprecatedSslModeWarning.warned && typeof process !== "undefined" && process.emitWarning) {
        deprecatedSslModeWarning.warned = true;
        process.emitWarning(`SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'.
In the next major version (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt standard libpq semantics, which have weaker security guarantees.

To prepare for this change:
- If you want the current behavior, explicitly use 'sslmode=verify-full'
- If you want libpq compatibility now, use 'uselibpqcompat=true&sslmode=${sslmode}'

See https://www.postgresql.org/docs/current/libpq-ssl.html for libpq SSL mode definitions.`);
      }
    }
    module.exports = parse;
    parse.parse = parse;
    parse.toClientConfig = toClientConfig;
    parse.parseIntoClientConfig = parseIntoClientConfig;
  }
});

// node_modules/pg/lib/connection-parameters.js
var require_connection_parameters = __commonJS({
  "node_modules/pg/lib/connection-parameters.js"(exports, module) {
    "use strict";
    var dns = __require("dns");
    var defaults2 = require_defaults();
    var parse = require_pg_connection_string().parse;
    var val = function(key, config2, envVar) {
      if (envVar === void 0) {
        envVar = process.env["PG" + key.toUpperCase()];
      } else if (envVar === false) {
      } else {
        envVar = process.env[envVar];
      }
      return config2[key] || envVar || defaults2[key];
    };
    var readSSLConfigFromEnvironment = function() {
      switch (process.env.PGSSLMODE) {
        case "disable":
          return false;
        case "prefer":
        case "require":
        case "verify-ca":
        case "verify-full":
          return true;
        case "no-verify":
          return { rejectUnauthorized: false };
      }
      return defaults2.ssl;
    };
    var quoteParamValue = function(value) {
      return "'" + ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    };
    var add = function(params, config2, paramName) {
      const value = config2[paramName];
      if (value !== void 0 && value !== null) {
        params.push(paramName + "=" + quoteParamValue(value));
      }
    };
    var ConnectionParameters = class {
      constructor(config2) {
        config2 = typeof config2 === "string" ? parse(config2) : config2 || {};
        if (config2.connectionString) {
          config2 = Object.assign({}, config2, parse(config2.connectionString));
        }
        this.user = val("user", config2);
        this.database = val("database", config2);
        if (this.database === void 0) {
          this.database = this.user;
        }
        this.port = parseInt(val("port", config2), 10);
        this.host = val("host", config2);
        Object.defineProperty(this, "password", {
          configurable: true,
          enumerable: false,
          writable: true,
          value: val("password", config2)
        });
        this.binary = val("binary", config2);
        this.options = val("options", config2);
        this.ssl = typeof config2.ssl === "undefined" ? readSSLConfigFromEnvironment() : config2.ssl;
        if (typeof this.ssl === "string") {
          if (this.ssl === "true") {
            this.ssl = true;
          }
        }
        if (this.ssl === "no-verify") {
          this.ssl = { rejectUnauthorized: false };
        }
        if (this.ssl && this.ssl.key) {
          Object.defineProperty(this.ssl, "key", {
            enumerable: false
          });
        }
        this.client_encoding = val("client_encoding", config2);
        this.replication = val("replication", config2);
        this.isDomainSocket = !(this.host || "").indexOf("/");
        this.application_name = val("application_name", config2, "PGAPPNAME");
        this.fallback_application_name = val("fallback_application_name", config2, false);
        this.statement_timeout = val("statement_timeout", config2, false);
        this.lock_timeout = val("lock_timeout", config2, false);
        this.idle_in_transaction_session_timeout = val("idle_in_transaction_session_timeout", config2, false);
        this.query_timeout = val("query_timeout", config2, false);
        if (config2.connectionTimeoutMillis === void 0) {
          this.connect_timeout = process.env.PGCONNECT_TIMEOUT || 0;
        } else {
          this.connect_timeout = Math.floor(config2.connectionTimeoutMillis / 1e3);
        }
        if (config2.keepAlive === false) {
          this.keepalives = 0;
        } else if (config2.keepAlive === true) {
          this.keepalives = 1;
        }
        if (typeof config2.keepAliveInitialDelayMillis === "number") {
          this.keepalives_idle = Math.floor(config2.keepAliveInitialDelayMillis / 1e3);
        }
      }
      getLibpqConnectionString(cb) {
        const params = [];
        add(params, this, "user");
        add(params, this, "password");
        add(params, this, "port");
        add(params, this, "application_name");
        add(params, this, "fallback_application_name");
        add(params, this, "connect_timeout");
        add(params, this, "options");
        const ssl = typeof this.ssl === "object" ? this.ssl : this.ssl ? { sslmode: this.ssl } : {};
        add(params, ssl, "sslmode");
        add(params, ssl, "sslca");
        add(params, ssl, "sslkey");
        add(params, ssl, "sslcert");
        add(params, ssl, "sslrootcert");
        if (this.database) {
          params.push("dbname=" + quoteParamValue(this.database));
        }
        if (this.replication) {
          params.push("replication=" + quoteParamValue(this.replication));
        }
        if (this.host) {
          params.push("host=" + quoteParamValue(this.host));
        }
        if (this.isDomainSocket) {
          return cb(null, params.join(" "));
        }
        if (this.client_encoding) {
          params.push("client_encoding=" + quoteParamValue(this.client_encoding));
        }
        dns.lookup(this.host, function(err, address) {
          if (err) return cb(err, null);
          params.push("hostaddr=" + quoteParamValue(address));
          return cb(null, params.join(" "));
        });
      }
    };
    module.exports = ConnectionParameters;
  }
});

// node_modules/pg/lib/result.js
var require_result = __commonJS({
  "node_modules/pg/lib/result.js"(exports, module) {
    "use strict";
    var types2 = require_pg_types();
    var matchRegexp = /^([A-Za-z]+)(?: (\d+))?(?: (\d+))?/;
    var Result2 = class {
      constructor(rowMode, types3) {
        this.command = null;
        this.rowCount = null;
        this.oid = null;
        this.rows = [];
        this.fields = [];
        this._parsers = void 0;
        this._types = types3;
        this.RowCtor = null;
        this.rowAsArray = rowMode === "array";
        if (this.rowAsArray) {
          this.parseRow = this._parseRowAsArray;
        }
        this._prebuiltEmptyResultObject = null;
      }
      // adds a command complete message
      addCommandComplete(msg) {
        let match;
        if (msg.text) {
          match = matchRegexp.exec(msg.text);
        } else {
          match = matchRegexp.exec(msg.command);
        }
        if (match) {
          this.command = match[1];
          if (match[3]) {
            this.oid = parseInt(match[2], 10);
            this.rowCount = parseInt(match[3], 10);
          } else if (match[2]) {
            this.rowCount = parseInt(match[2], 10);
          }
        }
      }
      _parseRowAsArray(rowData) {
        const row = new Array(rowData.length);
        for (let i = 0, len = rowData.length; i < len; i++) {
          const rawValue = rowData[i];
          if (rawValue !== null) {
            row[i] = this._parsers[i](rawValue);
          } else {
            row[i] = null;
          }
        }
        return row;
      }
      parseRow(rowData) {
        const row = { ...this._prebuiltEmptyResultObject };
        for (let i = 0, len = rowData.length; i < len; i++) {
          const rawValue = rowData[i];
          const field = this.fields[i].name;
          if (rawValue !== null) {
            const v = this.fields[i].format === "binary" ? Buffer.from(rawValue) : rawValue;
            row[field] = this._parsers[i](v);
          } else {
            row[field] = null;
          }
        }
        return row;
      }
      addRow(row) {
        this.rows.push(row);
      }
      addFields(fieldDescriptions) {
        this.fields = fieldDescriptions;
        if (this.fields.length) {
          this._parsers = new Array(fieldDescriptions.length);
        }
        const row = {};
        for (let i = 0; i < fieldDescriptions.length; i++) {
          const desc = fieldDescriptions[i];
          row[desc.name] = null;
          if (this._types) {
            this._parsers[i] = this._types.getTypeParser(desc.dataTypeID, desc.format || "text");
          } else {
            this._parsers[i] = types2.getTypeParser(desc.dataTypeID, desc.format || "text");
          }
        }
        this._prebuiltEmptyResultObject = { ...row };
      }
    };
    module.exports = Result2;
  }
});

// node_modules/pg/lib/query.js
var require_query = __commonJS({
  "node_modules/pg/lib/query.js"(exports, module) {
    "use strict";
    var { EventEmitter } = __require("events");
    var Result2 = require_result();
    var utils = require_utils2();
    var Query2 = class extends EventEmitter {
      constructor(config2, values, callback) {
        super();
        config2 = utils.normalizeQueryConfig(config2, values, callback);
        this.text = config2.text;
        this.values = config2.values;
        this.rows = config2.rows;
        this.types = config2.types;
        this.name = config2.name;
        this.queryMode = config2.queryMode;
        this.binary = config2.binary;
        this.portal = config2.portal || "";
        this.callback = config2.callback;
        this._rowMode = config2.rowMode;
        if (process.domain && config2.callback) {
          this.callback = process.domain.bind(config2.callback);
        }
        this._result = new Result2(this._rowMode, this.types);
        this._results = this._result;
        this._canceledDueToError = false;
      }
      requiresPreparation() {
        if (this.queryMode === "extended") {
          return true;
        }
        if (this.name) {
          return true;
        }
        if (this.rows) {
          return true;
        }
        if (!this.text) {
          return false;
        }
        if (!this.values) {
          return false;
        }
        return this.values.length > 0;
      }
      _checkForMultirow() {
        if (this._result.command) {
          if (!Array.isArray(this._results)) {
            this._results = [this._result];
          }
          this._result = new Result2(this._rowMode, this._result._types);
          this._results.push(this._result);
        }
      }
      // associates row metadata from the supplied
      // message with this query object
      // metadata used when parsing row results
      handleRowDescription(msg) {
        this._checkForMultirow();
        this._result.addFields(msg.fields);
        this._accumulateRows = this.callback || !this.listeners("row").length;
      }
      handleDataRow(msg) {
        let row;
        if (this._canceledDueToError) {
          return;
        }
        try {
          row = this._result.parseRow(msg.fields);
        } catch (err) {
          this._canceledDueToError = err;
          return;
        }
        this.emit("row", row, this._result);
        if (this._accumulateRows) {
          this._result.addRow(row);
        }
      }
      handleCommandComplete(msg, connection) {
        this._checkForMultirow();
        this._result.addCommandComplete(msg);
        if (this.rows) {
          connection.sync();
        }
      }
      // if a named prepared statement is created with empty query text
      // the backend will send an emptyQuery message but *not* a command complete message
      // since we pipeline sync immediately after execute we don't need to do anything here
      // unless we have rows specified, in which case we did not pipeline the initial sync call
      handleEmptyQuery(connection) {
        if (this.rows) {
          connection.sync();
        }
      }
      handleError(err, connection) {
        if (this._canceledDueToError) {
          err = this._canceledDueToError;
          this._canceledDueToError = false;
        }
        if (this.callback) {
          return this.callback(err);
        }
        this.emit("error", err);
      }
      handleReadyForQuery(con) {
        if (this._canceledDueToError) {
          return this.handleError(this._canceledDueToError, con);
        }
        if (this.callback) {
          try {
            this.callback(null, this._results);
          } catch (err) {
            process.nextTick(() => {
              throw err;
            });
          }
        }
        this.emit("end", this._results);
      }
      submit(connection) {
        if (typeof this.text !== "string" && typeof this.name !== "string") {
          return new Error("A query must have either text or a name. Supplying neither is unsupported.");
        }
        const previous = connection.parsedStatements[this.name];
        if (this.text && previous && this.text !== previous) {
          return new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`);
        }
        if (this.values && !Array.isArray(this.values)) {
          return new Error("Query values must be an array");
        }
        if (this.requiresPreparation()) {
          connection.stream.cork && connection.stream.cork();
          try {
            this.prepare(connection);
          } finally {
            connection.stream.uncork && connection.stream.uncork();
          }
        } else {
          connection.query(this.text);
        }
        return null;
      }
      hasBeenParsed(connection) {
        return this.name && connection.parsedStatements[this.name];
      }
      handlePortalSuspended(connection) {
        this._getRows(connection, this.rows);
      }
      _getRows(connection, rows) {
        connection.execute({
          portal: this.portal,
          rows
        });
        if (!rows) {
          connection.sync();
        } else {
          connection.flush();
        }
      }
      // http://developer.postgresql.org/pgdocs/postgres/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY
      prepare(connection) {
        if (!this.hasBeenParsed(connection)) {
          connection.parse({
            text: this.text,
            name: this.name,
            types: this.types
          });
        }
        try {
          connection.bind({
            portal: this.portal,
            statement: this.name,
            values: this.values,
            binary: this.binary,
            valueMapper: utils.prepareValue
          });
        } catch (err) {
          this.handleError(err, connection);
          return;
        }
        connection.describe({
          type: "P",
          name: this.portal || ""
        });
        this._getRows(connection, this.rows);
      }
      handleCopyInResponse(connection) {
        connection.sendCopyFail("No source stream defined");
      }
      handleCopyData(msg, connection) {
      }
    };
    module.exports = Query2;
  }
});

// node_modules/pg-protocol/dist/messages.js
var require_messages = __commonJS({
  "node_modules/pg-protocol/dist/messages.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NoticeMessage = exports.DataRowMessage = exports.CommandCompleteMessage = exports.ReadyForQueryMessage = exports.NotificationResponseMessage = exports.BackendKeyDataMessage = exports.AuthenticationMD5Password = exports.ParameterStatusMessage = exports.ParameterDescriptionMessage = exports.RowDescriptionMessage = exports.Field = exports.CopyResponse = exports.CopyDataMessage = exports.DatabaseError = exports.copyDone = exports.emptyQuery = exports.replicationStart = exports.portalSuspended = exports.noData = exports.closeComplete = exports.bindComplete = exports.parseComplete = void 0;
    exports.parseComplete = {
      name: "parseComplete",
      length: 5
    };
    exports.bindComplete = {
      name: "bindComplete",
      length: 5
    };
    exports.closeComplete = {
      name: "closeComplete",
      length: 5
    };
    exports.noData = {
      name: "noData",
      length: 5
    };
    exports.portalSuspended = {
      name: "portalSuspended",
      length: 5
    };
    exports.replicationStart = {
      name: "replicationStart",
      length: 4
    };
    exports.emptyQuery = {
      name: "emptyQuery",
      length: 4
    };
    exports.copyDone = {
      name: "copyDone",
      length: 4
    };
    var DatabaseError2 = class extends Error {
      constructor(message, length, name) {
        super(message);
        this.length = length;
        this.name = name;
      }
    };
    exports.DatabaseError = DatabaseError2;
    var CopyDataMessage = class {
      constructor(length, chunk2) {
        this.length = length;
        this.chunk = chunk2;
        this.name = "copyData";
      }
    };
    exports.CopyDataMessage = CopyDataMessage;
    var CopyResponse = class {
      constructor(length, name, binary, columnCount) {
        this.length = length;
        this.name = name;
        this.binary = binary;
        this.columnTypes = new Array(columnCount);
      }
    };
    exports.CopyResponse = CopyResponse;
    var Field = class {
      constructor(name, tableID, columnID, dataTypeID, dataTypeSize, dataTypeModifier, format) {
        this.name = name;
        this.tableID = tableID;
        this.columnID = columnID;
        this.dataTypeID = dataTypeID;
        this.dataTypeSize = dataTypeSize;
        this.dataTypeModifier = dataTypeModifier;
        this.format = format;
      }
    };
    exports.Field = Field;
    var RowDescriptionMessage = class {
      constructor(length, fieldCount) {
        this.length = length;
        this.fieldCount = fieldCount;
        this.name = "rowDescription";
        this.fields = new Array(this.fieldCount);
      }
    };
    exports.RowDescriptionMessage = RowDescriptionMessage;
    var ParameterDescriptionMessage = class {
      constructor(length, parameterCount) {
        this.length = length;
        this.parameterCount = parameterCount;
        this.name = "parameterDescription";
        this.dataTypeIDs = new Array(this.parameterCount);
      }
    };
    exports.ParameterDescriptionMessage = ParameterDescriptionMessage;
    var ParameterStatusMessage = class {
      constructor(length, parameterName, parameterValue) {
        this.length = length;
        this.parameterName = parameterName;
        this.parameterValue = parameterValue;
        this.name = "parameterStatus";
      }
    };
    exports.ParameterStatusMessage = ParameterStatusMessage;
    var AuthenticationMD5Password = class {
      constructor(length, salt) {
        this.length = length;
        this.salt = salt;
        this.name = "authenticationMD5Password";
      }
    };
    exports.AuthenticationMD5Password = AuthenticationMD5Password;
    var BackendKeyDataMessage = class {
      constructor(length, processID, secretKey) {
        this.length = length;
        this.processID = processID;
        this.secretKey = secretKey;
        this.name = "backendKeyData";
      }
    };
    exports.BackendKeyDataMessage = BackendKeyDataMessage;
    var NotificationResponseMessage = class {
      constructor(length, processId, channel, payload) {
        this.length = length;
        this.processId = processId;
        this.channel = channel;
        this.payload = payload;
        this.name = "notification";
      }
    };
    exports.NotificationResponseMessage = NotificationResponseMessage;
    var ReadyForQueryMessage = class {
      constructor(length, status2) {
        this.length = length;
        this.status = status2;
        this.name = "readyForQuery";
      }
    };
    exports.ReadyForQueryMessage = ReadyForQueryMessage;
    var CommandCompleteMessage = class {
      constructor(length, text) {
        this.length = length;
        this.text = text;
        this.name = "commandComplete";
      }
    };
    exports.CommandCompleteMessage = CommandCompleteMessage;
    var DataRowMessage = class {
      constructor(length, fields) {
        this.length = length;
        this.fields = fields;
        this.name = "dataRow";
        this.fieldCount = fields.length;
      }
    };
    exports.DataRowMessage = DataRowMessage;
    var NoticeMessage = class {
      constructor(length, message) {
        this.length = length;
        this.message = message;
        this.name = "notice";
      }
    };
    exports.NoticeMessage = NoticeMessage;
  }
});

// node_modules/pg-protocol/dist/buffer-writer.js
var require_buffer_writer = __commonJS({
  "node_modules/pg-protocol/dist/buffer-writer.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Writer = void 0;
    var Writer = class {
      constructor(size = 256) {
        this.size = size;
        this.offset = 5;
        this.headerPosition = 0;
        this.buffer = Buffer.allocUnsafe(size);
      }
      ensure(size) {
        const remaining = this.buffer.length - this.offset;
        if (remaining < size) {
          const oldBuffer = this.buffer;
          const newSize = oldBuffer.length + (oldBuffer.length >> 1) + size;
          this.buffer = Buffer.allocUnsafe(newSize);
          oldBuffer.copy(this.buffer, 0, 0, this.offset);
        }
      }
      addInt32(num) {
        this.ensure(4);
        this.buffer[this.offset++] = num >>> 24 & 255;
        this.buffer[this.offset++] = num >>> 16 & 255;
        this.buffer[this.offset++] = num >>> 8 & 255;
        this.buffer[this.offset++] = num >>> 0 & 255;
        return this;
      }
      addInt16(num) {
        this.ensure(2);
        this.buffer[this.offset++] = num >>> 8 & 255;
        this.buffer[this.offset++] = num >>> 0 & 255;
        return this;
      }
      addCString(string) {
        if (!string) {
          this.ensure(1);
        } else {
          const len = Buffer.byteLength(string);
          this.ensure(len + 1);
          this.buffer.write(string, this.offset, "utf-8");
          this.offset += len;
        }
        this.buffer[this.offset++] = 0;
        return this;
      }
      addString(string = "") {
        const len = Buffer.byteLength(string);
        this.ensure(len);
        this.buffer.write(string, this.offset);
        this.offset += len;
        return this;
      }
      // Write an Int32 byte-length prefix immediately followed by the string's UTF-8
      // bytes. Postgres' Bind wire format prefixes every parameter with its length,
      // and doing it in one method computes Buffer.byteLength ONCE — the previous
      // `addInt32(Buffer.byteLength(s)).addString(s)` pairing scanned the string
      // three times (byteLength for the prefix, byteLength again inside addString,
      // then the encode), which is costly for large text parameters.
      addInt32PrefixedString(string) {
        const len = Buffer.byteLength(string);
        this.ensure(4 + len);
        const buffer = this.buffer;
        let offset = this.offset;
        buffer[offset++] = len >>> 24 & 255;
        buffer[offset++] = len >>> 16 & 255;
        buffer[offset++] = len >>> 8 & 255;
        buffer[offset++] = len >>> 0 & 255;
        buffer.write(string, offset, "utf-8");
        this.offset = offset + len;
        return this;
      }
      add(otherBuffer) {
        this.ensure(otherBuffer.length);
        otherBuffer.copy(this.buffer, this.offset);
        this.offset += otherBuffer.length;
        return this;
      }
      /**
       * Appends an uninitialized block of {@link size} bytes to the buffer and returns its offset.
       */
      reserveUnsafe(size) {
        const offset = this.offset;
        this.ensure(size);
        this.offset += size;
        return offset;
      }
      join(code) {
        if (code) {
          this.buffer[this.headerPosition] = code;
          const length = this.offset - (this.headerPosition + 1);
          this.buffer.writeInt32BE(length, this.headerPosition + 1);
        }
        return this.buffer.slice(code ? 0 : 5, this.offset);
      }
      flush(code) {
        const result = this.join(code);
        this.offset = 5;
        this.headerPosition = 0;
        this.buffer = Buffer.allocUnsafe(this.size);
        return result;
      }
      clear() {
        this.offset = 5;
        this.headerPosition = 0;
      }
    };
    exports.Writer = Writer;
  }
});

// node_modules/pg-protocol/dist/serializer.js
var require_serializer = __commonJS({
  "node_modules/pg-protocol/dist/serializer.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.serialize = void 0;
    var buffer_writer_1 = require_buffer_writer();
    var writer = new buffer_writer_1.Writer();
    var startup = (opts) => {
      writer.addInt16(3).addInt16(0);
      for (const key of Object.keys(opts)) {
        writer.addCString(key).addCString(opts[key]);
      }
      writer.addCString("client_encoding").addCString("UTF8");
      const bodyBuffer = writer.addCString("").flush();
      const length = bodyBuffer.length + 4;
      return new buffer_writer_1.Writer().addInt32(length).add(bodyBuffer).flush();
    };
    var requestSsl = () => {
      const response = Buffer.allocUnsafe(8);
      response.writeInt32BE(8, 0);
      response.writeInt32BE(80877103, 4);
      return response;
    };
    var password = (password2) => {
      return writer.addCString(password2).flush(
        112
        /* code.startup */
      );
    };
    var sendSASLInitialResponseMessage = function(mechanism, initialResponse) {
      writer.addCString(mechanism).addInt32PrefixedString(initialResponse);
      return writer.flush(
        112
        /* code.startup */
      );
    };
    var sendSCRAMClientFinalMessage = function(additionalData) {
      return writer.addString(additionalData).flush(
        112
        /* code.startup */
      );
    };
    var query = (text) => {
      return writer.addCString(text).flush(
        81
        /* code.query */
      );
    };
    var emptyArray = [];
    var parse = (query2) => {
      const name = query2.name || "";
      if (name.length > 63) {
        console.error("Warning! Postgres only supports 63 characters for query names.");
        console.error("You supplied %s (%s)", name, name.length);
        console.error("This can cause conflicts and silent errors executing queries");
      }
      const types2 = query2.types || emptyArray;
      const len = types2.length;
      const buffer = writer.addCString(name).addCString(query2.text).addInt16(len);
      for (let i = 0; i < len; i++) {
        buffer.addInt32(types2[i]);
      }
      return writer.flush(
        80
        /* code.parse */
      );
    };
    var writeValues = function(values, valueMapper, formatsOffset) {
      const len = values.length;
      for (let i = 0; i < len; i++) {
        const mappedVal = valueMapper ? valueMapper(values[i], i) : values[i];
        let formatByte = 0;
        if (mappedVal == null) {
          writer.addInt32(-1);
        } else if (mappedVal instanceof Buffer) {
          formatByte = 1;
          writer.addInt32(mappedVal.length);
          writer.add(mappedVal);
        } else {
          writer.addInt32PrefixedString(mappedVal);
        }
        const buf = writer.buffer;
        buf[formatsOffset++] = 0;
        buf[formatsOffset++] = formatByte;
      }
    };
    var bind = (config2 = {}) => {
      const portal = config2.portal || "";
      const statement = config2.statement || "";
      const binary = config2.binary || false;
      const values = config2.values || emptyArray;
      const len = values.length;
      writer.addCString(portal).addCString(statement);
      writer.addInt16(len);
      const formatsOffset = writer.reserveUnsafe(len * 2);
      writer.addInt16(len);
      try {
        writeValues(values, config2.valueMapper, formatsOffset);
      } catch (err) {
        writer.clear();
        throw err;
      }
      writer.addInt16(1);
      writer.addInt16(
        binary ? 1 : 0
        /* ParamType.STRING */
      );
      return writer.flush(
        66
        /* code.bind */
      );
    };
    var emptyExecute = Buffer.from([69, 0, 0, 0, 9, 0, 0, 0, 0, 0]);
    var execute = (config2) => {
      if (!config2 || !config2.portal && !config2.rows) {
        return emptyExecute;
      }
      const portal = config2.portal || "";
      const rows = config2.rows || 0;
      const portalLength = Buffer.byteLength(portal);
      const len = 4 + portalLength + 1 + 4;
      const buff = Buffer.allocUnsafe(1 + len);
      buff[0] = 69;
      buff.writeInt32BE(len, 1);
      buff.write(portal, 5, "utf-8");
      buff[portalLength + 5] = 0;
      buff.writeUInt32BE(rows, buff.length - 4);
      return buff;
    };
    var cancel = (processID, secretKey) => {
      const buffer = Buffer.allocUnsafe(16);
      buffer.writeInt32BE(16, 0);
      buffer.writeInt16BE(1234, 4);
      buffer.writeInt16BE(5678, 6);
      buffer.writeInt32BE(processID, 8);
      buffer.writeInt32BE(secretKey, 12);
      return buffer;
    };
    var cstringMessage = (code, string) => {
      const stringLen = Buffer.byteLength(string);
      const len = 4 + stringLen + 1;
      const buffer = Buffer.allocUnsafe(1 + len);
      buffer[0] = code;
      buffer.writeInt32BE(len, 1);
      buffer.write(string, 5, "utf-8");
      buffer[len] = 0;
      return buffer;
    };
    var emptyDescribePortal = writer.addCString("P").flush(
      68
      /* code.describe */
    );
    var emptyDescribeStatement = writer.addCString("S").flush(
      68
      /* code.describe */
    );
    var describe = (msg) => {
      return msg.name ? cstringMessage(68, `${msg.type}${msg.name || ""}`) : msg.type === "P" ? emptyDescribePortal : emptyDescribeStatement;
    };
    var close = (msg) => {
      const text = `${msg.type}${msg.name || ""}`;
      return cstringMessage(67, text);
    };
    var copyData = (chunk2) => {
      return writer.add(chunk2).flush(
        100
        /* code.copyFromChunk */
      );
    };
    var copyFail = (message) => {
      return cstringMessage(102, message);
    };
    var codeOnlyBuffer = (code) => Buffer.from([code, 0, 0, 0, 4]);
    var flushBuffer = codeOnlyBuffer(
      72
      /* code.flush */
    );
    var syncBuffer = codeOnlyBuffer(
      83
      /* code.sync */
    );
    var endBuffer = codeOnlyBuffer(
      88
      /* code.end */
    );
    var copyDoneBuffer = codeOnlyBuffer(
      99
      /* code.copyDone */
    );
    var serialize = {
      startup,
      password,
      requestSsl,
      sendSASLInitialResponseMessage,
      sendSCRAMClientFinalMessage,
      query,
      parse,
      bind,
      execute,
      describe,
      close,
      flush: () => flushBuffer,
      sync: () => syncBuffer,
      end: () => endBuffer,
      copyData,
      copyDone: () => copyDoneBuffer,
      copyFail,
      cancel
    };
    exports.serialize = serialize;
  }
});

// node_modules/pg-protocol/dist/buffer-reader.js
var require_buffer_reader = __commonJS({
  "node_modules/pg-protocol/dist/buffer-reader.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BufferReader = void 0;
    var BufferReader = class {
      constructor(offset = 0) {
        this.offset = offset;
        this.buffer = Buffer.allocUnsafe(0);
        this.encoding = "utf-8";
      }
      setBuffer(offset, buffer) {
        this.offset = offset;
        this.buffer = buffer;
      }
      int16() {
        const result = this.buffer.readInt16BE(this.offset);
        this.offset += 2;
        return result;
      }
      byte() {
        const result = this.buffer[this.offset];
        this.offset++;
        return result;
      }
      int32() {
        const result = this.buffer.readInt32BE(this.offset);
        this.offset += 4;
        return result;
      }
      uint32() {
        const result = this.buffer.readUInt32BE(this.offset);
        this.offset += 4;
        return result;
      }
      string(length) {
        const result = this.buffer.toString(this.encoding, this.offset, this.offset + length);
        this.offset += length;
        return result;
      }
      cstring() {
        const start = this.offset;
        let end = start;
        while (this.buffer[end++]) {
        }
        this.offset = end;
        return this.buffer.toString(this.encoding, start, end - 1);
      }
      bytes(length) {
        const result = this.buffer.slice(this.offset, this.offset + length);
        this.offset += length;
        return result;
      }
    };
    exports.BufferReader = BufferReader;
  }
});

// node_modules/pg-protocol/dist/parser.js
var require_parser = __commonJS({
  "node_modules/pg-protocol/dist/parser.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Parser = void 0;
    var messages_1 = require_messages();
    var buffer_reader_1 = require_buffer_reader();
    var CODE_LENGTH = 1;
    var LEN_LENGTH = 4;
    var HEADER_LENGTH = CODE_LENGTH + LEN_LENGTH;
    var LATEINIT_LENGTH = -1;
    var emptyBuffer = Buffer.allocUnsafe(0);
    var Parser = class {
      constructor(opts) {
        this.buffer = emptyBuffer;
        this.bufferLength = 0;
        this.bufferOffset = 0;
        this.reader = new buffer_reader_1.BufferReader();
        if ((opts === null || opts === void 0 ? void 0 : opts.mode) === "binary") {
          throw new Error("Binary mode not supported yet");
        }
        this.mode = (opts === null || opts === void 0 ? void 0 : opts.mode) || "text";
      }
      parse(buffer, callback) {
        this.mergeBuffer(buffer);
        const bufferFullLength = this.bufferOffset + this.bufferLength;
        let offset = this.bufferOffset;
        while (offset + HEADER_LENGTH <= bufferFullLength) {
          const code = this.buffer[offset];
          const length = this.buffer.readUInt32BE(offset + CODE_LENGTH);
          const fullMessageLength = CODE_LENGTH + length;
          if (fullMessageLength + offset <= bufferFullLength) {
            const message = this.handlePacket(offset + HEADER_LENGTH, code, length, this.buffer);
            callback(message);
            offset += fullMessageLength;
          } else {
            break;
          }
        }
        if (offset === bufferFullLength) {
          this.buffer = emptyBuffer;
          this.bufferLength = 0;
          this.bufferOffset = 0;
        } else {
          this.bufferLength = bufferFullLength - offset;
          this.bufferOffset = offset;
        }
      }
      mergeBuffer(buffer) {
        if (this.bufferLength > 0) {
          const newLength = this.bufferLength + buffer.byteLength;
          const newFullLength = newLength + this.bufferOffset;
          if (newFullLength > this.buffer.byteLength) {
            let newBuffer;
            if (newLength <= this.buffer.byteLength && this.bufferOffset >= this.bufferLength) {
              newBuffer = this.buffer;
            } else {
              let newBufferLength = this.buffer.byteLength * 2;
              while (newLength >= newBufferLength) {
                newBufferLength *= 2;
              }
              newBuffer = Buffer.allocUnsafe(newBufferLength);
            }
            this.buffer.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset + this.bufferLength);
            this.buffer = newBuffer;
            this.bufferOffset = 0;
          }
          buffer.copy(this.buffer, this.bufferOffset + this.bufferLength);
          this.bufferLength = newLength;
        } else {
          this.buffer = buffer;
          this.bufferOffset = 0;
          this.bufferLength = buffer.byteLength;
        }
      }
      handlePacket(offset, code, length, bytes) {
        const { reader } = this;
        reader.setBuffer(offset, bytes);
        let message;
        switch (code) {
          case 50:
            message = messages_1.bindComplete;
            break;
          case 49:
            message = messages_1.parseComplete;
            break;
          case 51:
            message = messages_1.closeComplete;
            break;
          case 110:
            message = messages_1.noData;
            break;
          case 115:
            message = messages_1.portalSuspended;
            break;
          case 99:
            message = messages_1.copyDone;
            break;
          case 87:
            message = messages_1.replicationStart;
            break;
          case 73:
            message = messages_1.emptyQuery;
            break;
          case 68:
            message = parseDataRowMessage(reader);
            break;
          case 67:
            message = parseCommandCompleteMessage(reader);
            break;
          case 90:
            message = parseReadyForQueryMessage(reader);
            break;
          case 65:
            message = parseNotificationMessage(reader);
            break;
          case 82:
            message = parseAuthenticationResponse(reader, length);
            break;
          case 83:
            message = parseParameterStatusMessage(reader);
            break;
          case 75:
            message = parseBackendKeyData(reader);
            break;
          case 69:
            message = parseErrorMessage(reader, "error");
            break;
          case 78:
            message = parseErrorMessage(reader, "notice");
            break;
          case 84:
            message = parseRowDescriptionMessage(reader);
            break;
          case 116:
            message = parseParameterDescriptionMessage(reader);
            break;
          case 71:
            message = parseCopyInMessage(reader);
            break;
          case 72:
            message = parseCopyOutMessage(reader);
            break;
          case 100:
            message = parseCopyData(reader, length);
            break;
          default:
            return new messages_1.DatabaseError("received invalid response: " + code.toString(16), length, "error");
        }
        reader.setBuffer(0, emptyBuffer);
        message.length = length;
        return message;
      }
    };
    exports.Parser = Parser;
    var parseReadyForQueryMessage = (reader) => {
      const status2 = reader.string(1);
      return new messages_1.ReadyForQueryMessage(LATEINIT_LENGTH, status2);
    };
    var parseCommandCompleteMessage = (reader) => {
      const text = reader.cstring();
      return new messages_1.CommandCompleteMessage(LATEINIT_LENGTH, text);
    };
    var parseCopyData = (reader, length) => {
      const chunk2 = reader.bytes(length - 4);
      return new messages_1.CopyDataMessage(LATEINIT_LENGTH, chunk2);
    };
    var parseCopyInMessage = (reader) => parseCopyMessage(reader, "copyInResponse");
    var parseCopyOutMessage = (reader) => parseCopyMessage(reader, "copyOutResponse");
    var parseCopyMessage = (reader, messageName) => {
      const isBinary = reader.byte() !== 0;
      const columnCount = reader.int16();
      const message = new messages_1.CopyResponse(LATEINIT_LENGTH, messageName, isBinary, columnCount);
      for (let i = 0; i < columnCount; i++) {
        message.columnTypes[i] = reader.int16();
      }
      return message;
    };
    var parseNotificationMessage = (reader) => {
      const processId = reader.int32();
      const channel = reader.cstring();
      const payload = reader.cstring();
      return new messages_1.NotificationResponseMessage(LATEINIT_LENGTH, processId, channel, payload);
    };
    var parseRowDescriptionMessage = (reader) => {
      const fieldCount = reader.int16();
      const message = new messages_1.RowDescriptionMessage(LATEINIT_LENGTH, fieldCount);
      for (let i = 0; i < fieldCount; i++) {
        message.fields[i] = parseField(reader);
      }
      return message;
    };
    var parseField = (reader) => {
      const name = reader.cstring();
      const tableID = reader.uint32();
      const columnID = reader.int16();
      const dataTypeID = reader.uint32();
      const dataTypeSize = reader.int16();
      const dataTypeModifier = reader.int32();
      const mode = reader.int16() === 0 ? "text" : "binary";
      return new messages_1.Field(name, tableID, columnID, dataTypeID, dataTypeSize, dataTypeModifier, mode);
    };
    var parseParameterDescriptionMessage = (reader) => {
      const parameterCount = reader.int16();
      const message = new messages_1.ParameterDescriptionMessage(LATEINIT_LENGTH, parameterCount);
      for (let i = 0; i < parameterCount; i++) {
        message.dataTypeIDs[i] = reader.uint32();
      }
      return message;
    };
    var parseDataRowMessage = (reader) => {
      const fieldCount = reader.int16();
      const fields = new Array(fieldCount);
      for (let i = 0; i < fieldCount; i++) {
        const len = reader.int32();
        fields[i] = len === -1 ? null : reader.string(len);
      }
      return new messages_1.DataRowMessage(LATEINIT_LENGTH, fields);
    };
    var parseParameterStatusMessage = (reader) => {
      const name = reader.cstring();
      const value = reader.cstring();
      return new messages_1.ParameterStatusMessage(LATEINIT_LENGTH, name, value);
    };
    var parseBackendKeyData = (reader) => {
      const processID = reader.int32();
      const secretKey = reader.int32();
      return new messages_1.BackendKeyDataMessage(LATEINIT_LENGTH, processID, secretKey);
    };
    var parseAuthenticationResponse = (reader, length) => {
      const code = reader.int32();
      const message = {
        name: "authenticationOk",
        length
      };
      switch (code) {
        case 0:
          break;
        case 3:
          if (message.length === 8) {
            message.name = "authenticationCleartextPassword";
          }
          break;
        case 5:
          if (message.length === 12) {
            message.name = "authenticationMD5Password";
            const salt = reader.bytes(4);
            return new messages_1.AuthenticationMD5Password(LATEINIT_LENGTH, salt);
          }
          break;
        case 10:
          {
            message.name = "authenticationSASL";
            message.mechanisms = [];
            let mechanism;
            do {
              mechanism = reader.cstring();
              if (mechanism) {
                message.mechanisms.push(mechanism);
              }
            } while (mechanism);
          }
          break;
        case 11:
          message.name = "authenticationSASLContinue";
          message.data = reader.string(length - 8);
          break;
        case 12:
          message.name = "authenticationSASLFinal";
          message.data = reader.string(length - 8);
          break;
        default:
          throw new Error("Unknown authenticationOk message type " + code);
      }
      return message;
    };
    var parseErrorMessage = (reader, name) => {
      const fields = {};
      let fieldType = reader.string(1);
      while (fieldType !== "\0") {
        fields[fieldType] = reader.cstring();
        fieldType = reader.string(1);
      }
      const messageValue = fields.M;
      const message = name === "notice" ? new messages_1.NoticeMessage(LATEINIT_LENGTH, messageValue) : new messages_1.DatabaseError(messageValue, LATEINIT_LENGTH, name);
      message.severity = fields.S;
      message.code = fields.C;
      message.detail = fields.D;
      message.hint = fields.H;
      message.position = fields.P;
      message.internalPosition = fields.p;
      message.internalQuery = fields.q;
      message.where = fields.W;
      message.schema = fields.s;
      message.table = fields.t;
      message.column = fields.c;
      message.dataType = fields.d;
      message.constraint = fields.n;
      message.file = fields.F;
      message.line = fields.L;
      message.routine = fields.R;
      return message;
    };
  }
});

// node_modules/pg-protocol/dist/index.js
var require_dist = __commonJS({
  "node_modules/pg-protocol/dist/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DatabaseError = exports.serialize = void 0;
    exports.parse = parse;
    var messages_1 = require_messages();
    Object.defineProperty(exports, "DatabaseError", { enumerable: true, get: function() {
      return messages_1.DatabaseError;
    } });
    var serializer_1 = require_serializer();
    Object.defineProperty(exports, "serialize", { enumerable: true, get: function() {
      return serializer_1.serialize;
    } });
    var parser_1 = require_parser();
    function parse(stream, callback) {
      const parser = new parser_1.Parser();
      stream.on("data", (buffer) => parser.parse(buffer, callback));
      return new Promise((resolve2) => stream.on("end", () => resolve2()));
    }
  }
});

// node_modules/pg-cloudflare/dist/empty.js
var require_empty = __commonJS({
  "node_modules/pg-cloudflare/dist/empty.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = {};
  }
});

// node_modules/pg/lib/stream.js
var require_stream = __commonJS({
  "node_modules/pg/lib/stream.js"(exports, module) {
    var { getStream, getSecureStream } = getStreamFuncs();
    module.exports = {
      /**
       * Get a socket stream compatible with the current runtime environment.
       * @returns {Duplex}
       */
      getStream,
      /**
       * Get a TLS secured socket, compatible with the current environment,
       * using the socket and other settings given in `options`.
       * @returns {Duplex}
       */
      getSecureStream
    };
    function getNodejsStreamFuncs() {
      function getStream2(ssl) {
        const net = __require("net");
        return new net.Socket();
      }
      function getSecureStream2(options) {
        const tls = __require("tls");
        return tls.connect(options);
      }
      return {
        getStream: getStream2,
        getSecureStream: getSecureStream2
      };
    }
    function getCloudflareStreamFuncs() {
      function getStream2(ssl) {
        const { CloudflareSocket } = require_empty();
        return new CloudflareSocket(ssl);
      }
      function getSecureStream2(options) {
        options.socket.startTls(options);
        return options.socket;
      }
      return {
        getStream: getStream2,
        getSecureStream: getSecureStream2
      };
    }
    function isCloudflareRuntime() {
      if (typeof navigator === "object" && navigator !== null && typeof navigator.userAgent === "string") {
        return navigator.userAgent === "Cloudflare-Workers";
      }
      if (typeof Response === "function") {
        const resp = new Response(null, { cf: { thing: true } });
        if (typeof resp.cf === "object" && resp.cf !== null && resp.cf.thing) {
          return true;
        }
      }
      return false;
    }
    function getStreamFuncs() {
      if (isCloudflareRuntime()) {
        return getCloudflareStreamFuncs();
      }
      return getNodejsStreamFuncs();
    }
  }
});

// node_modules/pg/lib/connection.js
var require_connection = __commonJS({
  "node_modules/pg/lib/connection.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var { parse, serialize } = require_dist();
    var { getStream, getSecureStream } = require_stream();
    var flushBuffer = serialize.flush();
    var syncBuffer = serialize.sync();
    var endBuffer = serialize.end();
    var Connection2 = class extends EventEmitter {
      constructor(config2) {
        super();
        config2 = config2 || {};
        this.stream = config2.stream || getStream(config2.ssl);
        if (typeof this.stream === "function") {
          this.stream = this.stream(config2);
        }
        this._keepAlive = config2.keepAlive;
        this._keepAliveInitialDelayMillis = config2.keepAliveInitialDelayMillis;
        this.lastBuffer = false;
        this.parsedStatements = {};
        this.ssl = config2.ssl || false;
        this._ending = false;
        this._emitMessage = false;
        const self = this;
        this.on("newListener", function(eventName) {
          if (eventName === "message") {
            self._emitMessage = true;
          }
        });
      }
      connect(port2, host) {
        const self = this;
        this._connecting = true;
        this.stream.setNoDelay(true);
        this.stream.connect(port2, host);
        this.stream.once("connect", function() {
          if (self._keepAlive) {
            self.stream.setKeepAlive(true, self._keepAliveInitialDelayMillis);
          }
          self.emit("connect");
        });
        const reportStreamError = function(error) {
          if (self._ending && (error.code === "ECONNRESET" || error.code === "EPIPE")) {
            return;
          }
          self.emit("error", error);
        };
        this.stream.on("error", reportStreamError);
        this.stream.on("close", function() {
          self.emit("end");
        });
        if (!this.ssl) {
          return this.attachListeners(this.stream);
        }
        this.stream.once("data", function(buffer) {
          const responseCode = buffer.toString("utf8");
          switch (responseCode) {
            case "S":
              break;
            case "N":
              self.stream.end();
              return self.emit("error", new Error("The server does not support SSL connections"));
            default:
              self.stream.end();
              return self.emit("error", new Error("There was an error establishing an SSL connection"));
          }
          const options = {
            socket: self.stream
          };
          if (self.ssl !== true) {
            Object.assign(options, self.ssl);
            if ("key" in self.ssl) {
              options.key = self.ssl.key;
            }
          }
          const net = __require("net");
          if (net.isIP && net.isIP(host) === 0) {
            options.servername = host;
          }
          try {
            self.stream = getSecureStream(options);
          } catch (err) {
            return self.emit("error", err);
          }
          self.attachListeners(self.stream);
          self.stream.on("error", reportStreamError);
          self.emit("sslconnect");
        });
      }
      attachListeners(stream) {
        parse(stream, (msg) => {
          const eventName = msg.name === "error" ? "errorMessage" : msg.name;
          if (this._emitMessage) {
            this.emit("message", msg);
          }
          this.emit(eventName, msg);
        });
      }
      requestSsl() {
        this.stream.write(serialize.requestSsl());
      }
      startup(config2) {
        this.stream.write(serialize.startup(config2));
      }
      cancel(processID, secretKey) {
        this._send(serialize.cancel(processID, secretKey));
      }
      password(password) {
        this._send(serialize.password(password));
      }
      sendSASLInitialResponseMessage(mechanism, initialResponse) {
        this._send(serialize.sendSASLInitialResponseMessage(mechanism, initialResponse));
      }
      sendSCRAMClientFinalMessage(additionalData) {
        this._send(serialize.sendSCRAMClientFinalMessage(additionalData));
      }
      _send(buffer) {
        if (!this.stream.writable) {
          return false;
        }
        return this.stream.write(buffer);
      }
      query(text) {
        this._send(serialize.query(text));
      }
      // send parse message
      parse(query) {
        this._send(serialize.parse(query));
      }
      // send bind message
      bind(config2) {
        this._send(serialize.bind(config2));
      }
      // send execute message
      execute(config2) {
        this._send(serialize.execute(config2));
      }
      flush() {
        if (this.stream.writable) {
          this.stream.write(flushBuffer);
        }
      }
      sync() {
        this._ending = true;
        this._send(syncBuffer);
      }
      ref() {
        this.stream.ref();
      }
      unref() {
        this.stream.unref();
      }
      end() {
        this._ending = true;
        if (!this._connecting || !this.stream.writable) {
          this.stream.end();
          return;
        }
        return this.stream.write(endBuffer, () => {
          this.stream.end();
        });
      }
      close(msg) {
        this._send(serialize.close(msg));
      }
      describe(msg) {
        this._send(serialize.describe(msg));
      }
      sendCopyFromChunk(chunk2) {
        this._send(serialize.copyData(chunk2));
      }
      endCopyFrom() {
        this._send(serialize.copyDone());
      }
      sendCopyFail(msg) {
        this._send(serialize.copyFail(msg));
      }
    };
    module.exports = Connection2;
  }
});

// node_modules/split2/index.js
var require_split2 = __commonJS({
  "node_modules/split2/index.js"(exports, module) {
    "use strict";
    var { Transform } = __require("stream");
    var { StringDecoder } = __require("string_decoder");
    var kLast = Symbol("last");
    var kDecoder = Symbol("decoder");
    function transform(chunk2, enc, cb) {
      let list2;
      if (this.overflow) {
        const buf = this[kDecoder].write(chunk2);
        list2 = buf.split(this.matcher);
        if (list2.length === 1) return cb();
        list2.shift();
        this.overflow = false;
      } else {
        this[kLast] += this[kDecoder].write(chunk2);
        list2 = this[kLast].split(this.matcher);
      }
      this[kLast] = list2.pop();
      for (let i = 0; i < list2.length; i++) {
        try {
          push(this, this.mapper(list2[i]));
        } catch (error) {
          return cb(error);
        }
      }
      this.overflow = this[kLast].length > this.maxLength;
      if (this.overflow && !this.skipOverflow) {
        cb(new Error("maximum buffer reached"));
        return;
      }
      cb();
    }
    function flush(cb) {
      this[kLast] += this[kDecoder].end();
      if (this[kLast]) {
        try {
          push(this, this.mapper(this[kLast]));
        } catch (error) {
          return cb(error);
        }
      }
      cb();
    }
    function push(self, val) {
      if (val !== void 0) {
        self.push(val);
      }
    }
    function noop(incoming) {
      return incoming;
    }
    function split(matcher, mapper, options) {
      matcher = matcher || /\r?\n/;
      mapper = mapper || noop;
      options = options || {};
      switch (arguments.length) {
        case 1:
          if (typeof matcher === "function") {
            mapper = matcher;
            matcher = /\r?\n/;
          } else if (typeof matcher === "object" && !(matcher instanceof RegExp) && !matcher[Symbol.split]) {
            options = matcher;
            matcher = /\r?\n/;
          }
          break;
        case 2:
          if (typeof matcher === "function") {
            options = mapper;
            mapper = matcher;
            matcher = /\r?\n/;
          } else if (typeof mapper === "object") {
            options = mapper;
            mapper = noop;
          }
      }
      options = Object.assign({}, options);
      options.autoDestroy = true;
      options.transform = transform;
      options.flush = flush;
      options.readableObjectMode = true;
      const stream = new Transform(options);
      stream[kLast] = "";
      stream[kDecoder] = new StringDecoder("utf8");
      stream.matcher = matcher;
      stream.mapper = mapper;
      stream.maxLength = options.maxLength;
      stream.skipOverflow = options.skipOverflow || false;
      stream.overflow = false;
      stream._destroy = function(err, cb) {
        this._writableState.errorEmitted = false;
        cb(err);
      };
      return stream;
    }
    module.exports = split;
  }
});

// node_modules/pgpass/lib/helper.js
var require_helper = __commonJS({
  "node_modules/pgpass/lib/helper.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var Stream = __require("stream").Stream;
    var split = require_split2();
    var util = __require("util");
    var defaultPort = 5432;
    var isWin = process.platform === "win32";
    var warnStream = process.stderr;
    var S_IRWXG = 56;
    var S_IRWXO = 7;
    var S_IFMT = 61440;
    var S_IFREG = 32768;
    function isRegFile(mode) {
      return (mode & S_IFMT) == S_IFREG;
    }
    var fieldNames = ["host", "port", "database", "user", "password"];
    var nrOfFields = fieldNames.length;
    var passKey = fieldNames[nrOfFields - 1];
    function warn() {
      var isWritable = warnStream instanceof Stream && true === warnStream.writable;
      if (isWritable) {
        var args = Array.prototype.slice.call(arguments).concat("\n");
        warnStream.write(util.format.apply(util, args));
      }
    }
    Object.defineProperty(module.exports, "isWin", {
      get: function() {
        return isWin;
      },
      set: function(val) {
        isWin = val;
      }
    });
    module.exports.warnTo = function(stream) {
      var old = warnStream;
      warnStream = stream;
      return old;
    };
    module.exports.getFileName = function(rawEnv) {
      var env2 = rawEnv || process.env;
      var file = env2.PGPASSFILE || (isWin ? path.join(env2.APPDATA || "./", "postgresql", "pgpass.conf") : path.join(env2.HOME || "./", ".pgpass"));
      return file;
    };
    module.exports.usePgPass = function(stats, fname) {
      if (Object.prototype.hasOwnProperty.call(process.env, "PGPASSWORD")) {
        return false;
      }
      if (isWin) {
        return true;
      }
      fname = fname || "<unkn>";
      if (!isRegFile(stats.mode)) {
        warn('WARNING: password file "%s" is not a plain file', fname);
        return false;
      }
      if (stats.mode & (S_IRWXG | S_IRWXO)) {
        warn('WARNING: password file "%s" has group or world access; permissions should be u=rw (0600) or less', fname);
        return false;
      }
      return true;
    };
    var matcher = module.exports.match = function(connInfo, entry) {
      return fieldNames.slice(0, -1).reduce(function(prev, field, idx) {
        if (idx == 1) {
          if (Number(connInfo[field] || defaultPort) === Number(entry[field])) {
            return prev && true;
          }
        }
        return prev && (entry[field] === "*" || entry[field] === connInfo[field]);
      }, true);
    };
    module.exports.getPassword = function(connInfo, stream, cb) {
      var pass;
      var lineStream = stream.pipe(split());
      function onLine(line) {
        var entry = parseLine(line);
        if (entry && isValidEntry(entry) && matcher(connInfo, entry)) {
          pass = entry[passKey];
          lineStream.end();
        }
      }
      var onEnd = function() {
        stream.destroy();
        cb(pass);
      };
      var onErr = function(err) {
        stream.destroy();
        warn("WARNING: error on reading file: %s", err);
        cb(void 0);
      };
      stream.on("error", onErr);
      lineStream.on("data", onLine).on("end", onEnd).on("error", onErr);
    };
    var parseLine = module.exports.parseLine = function(line) {
      if (line.length < 11 || line.match(/^\s+#/)) {
        return null;
      }
      var curChar = "";
      var prevChar = "";
      var fieldIdx = 0;
      var startIdx = 0;
      var endIdx = 0;
      var obj = {};
      var isLastField = false;
      var addToObj = function(idx, i0, i1) {
        var field = line.substring(i0, i1);
        if (!Object.hasOwnProperty.call(process.env, "PGPASS_NO_DEESCAPE")) {
          field = field.replace(/\\([:\\])/g, "$1");
        }
        obj[fieldNames[idx]] = field;
      };
      for (var i = 0; i < line.length - 1; i += 1) {
        curChar = line.charAt(i + 1);
        prevChar = line.charAt(i);
        isLastField = fieldIdx == nrOfFields - 1;
        if (isLastField) {
          addToObj(fieldIdx, startIdx);
          break;
        }
        if (i >= 0 && curChar == ":" && prevChar !== "\\") {
          addToObj(fieldIdx, startIdx, i + 1);
          startIdx = i + 2;
          fieldIdx += 1;
        }
      }
      obj = Object.keys(obj).length === nrOfFields ? obj : null;
      return obj;
    };
    var isValidEntry = module.exports.isValidEntry = function(entry) {
      var rules = {
        // host
        0: function(x) {
          return x.length > 0;
        },
        // port
        1: function(x) {
          if (x === "*") {
            return true;
          }
          x = Number(x);
          return isFinite(x) && x > 0 && x < 9007199254740992 && Math.floor(x) === x;
        },
        // database
        2: function(x) {
          return x.length > 0;
        },
        // username
        3: function(x) {
          return x.length > 0;
        },
        // password
        4: function(x) {
          return x.length > 0;
        }
      };
      for (var idx = 0; idx < fieldNames.length; idx += 1) {
        var rule = rules[idx];
        var value = entry[fieldNames[idx]] || "";
        var res = rule(value);
        if (!res) {
          return false;
        }
      }
      return true;
    };
  }
});

// node_modules/pgpass/lib/index.js
var require_lib2 = __commonJS({
  "node_modules/pgpass/lib/index.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var fs = __require("fs");
    var helper = require_helper();
    module.exports = function(connInfo, cb) {
      var file = helper.getFileName();
      fs.stat(file, function(err, stat) {
        if (err || !helper.usePgPass(stat, file)) {
          return cb(void 0);
        }
        var st = fs.createReadStream(file);
        helper.getPassword(connInfo, st, cb);
      });
    };
    module.exports.warnTo = helper.warnTo;
  }
});

// node_modules/pg/lib/client.js
var require_client = __commonJS({
  "node_modules/pg/lib/client.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var utils = require_utils2();
    var sasl = require_sasl();
    var TypeOverrides2 = require_type_overrides();
    var ConnectionParameters = require_connection_parameters();
    var Query2 = require_query();
    var defaults2 = require_defaults();
    var Connection2 = require_connection();
    var crypto = require_utils3();
    var Client2 = class extends EventEmitter {
      constructor(config2) {
        super();
        this.connectionParameters = new ConnectionParameters(config2);
        this.user = this.connectionParameters.user;
        this.database = this.connectionParameters.database;
        this.port = this.connectionParameters.port;
        this.host = this.connectionParameters.host;
        Object.defineProperty(this, "password", {
          configurable: true,
          enumerable: false,
          writable: true,
          value: this.connectionParameters.password
        });
        this.replication = this.connectionParameters.replication;
        const c = config2 || {};
        this._Promise = c.Promise || global.Promise;
        this._types = new TypeOverrides2(c.types);
        this._ending = false;
        this._ended = false;
        this._connecting = false;
        this._connected = false;
        this._connectionError = false;
        this._queryable = true;
        this.enableChannelBinding = Boolean(c.enableChannelBinding);
        this.connection = c.connection || new Connection2({
          stream: c.stream,
          ssl: this.connectionParameters.ssl,
          keepAlive: c.keepAlive || false,
          keepAliveInitialDelayMillis: c.keepAliveInitialDelayMillis || 0,
          encoding: this.connectionParameters.client_encoding || "utf8"
        });
        this.queryQueue = [];
        this.binary = c.binary || defaults2.binary;
        this.processID = null;
        this.secretKey = null;
        this.ssl = this.connectionParameters.ssl || false;
        if (this.ssl && this.ssl.key) {
          Object.defineProperty(this.ssl, "key", {
            enumerable: false
          });
        }
        this._connectionTimeoutMillis = c.connectionTimeoutMillis || 0;
      }
      _errorAllQueries(err) {
        const enqueueError = (query) => {
          process.nextTick(() => {
            query.handleError(err, this.connection);
          });
        };
        if (this.activeQuery) {
          enqueueError(this.activeQuery);
          this.activeQuery = null;
        }
        this.queryQueue.forEach(enqueueError);
        this.queryQueue.length = 0;
      }
      _connect(callback) {
        const self = this;
        const con = this.connection;
        this._connectionCallback = callback;
        if (this._connecting || this._connected) {
          const err = new Error("Client has already been connected. You cannot reuse a client.");
          process.nextTick(() => {
            callback(err);
          });
          return;
        }
        this._connecting = true;
        if (this._connectionTimeoutMillis > 0) {
          this.connectionTimeoutHandle = setTimeout(() => {
            con._ending = true;
            con.stream.destroy(new Error("timeout expired"));
          }, this._connectionTimeoutMillis);
          if (this.connectionTimeoutHandle.unref) {
            this.connectionTimeoutHandle.unref();
          }
        }
        if (this.host && this.host.indexOf("/") === 0) {
          con.connect(this.host + "/.s.PGSQL." + this.port);
        } else {
          con.connect(this.port, this.host);
        }
        con.on("connect", function() {
          if (self.ssl) {
            con.requestSsl();
          } else {
            con.startup(self.getStartupConf());
          }
        });
        con.on("sslconnect", function() {
          con.startup(self.getStartupConf());
        });
        this._attachListeners(con);
        con.once("end", () => {
          const error = this._ending ? new Error("Connection terminated") : new Error("Connection terminated unexpectedly");
          clearTimeout(this.connectionTimeoutHandle);
          this._errorAllQueries(error);
          this._ended = true;
          if (!this._ending) {
            if (this._connecting && !this._connectionError) {
              if (this._connectionCallback) {
                this._connectionCallback(error);
              } else {
                this._handleErrorEvent(error);
              }
            } else if (!this._connectionError) {
              this._handleErrorEvent(error);
            }
          }
          process.nextTick(() => {
            this.emit("end");
          });
        });
      }
      connect(callback) {
        if (callback) {
          this._connect(callback);
          return;
        }
        return new this._Promise((resolve2, reject) => {
          this._connect((error) => {
            if (error) {
              reject(error);
            } else {
              resolve2();
            }
          });
        });
      }
      _attachListeners(con) {
        con.on("authenticationCleartextPassword", this._handleAuthCleartextPassword.bind(this));
        con.on("authenticationMD5Password", this._handleAuthMD5Password.bind(this));
        con.on("authenticationSASL", this._handleAuthSASL.bind(this));
        con.on("authenticationSASLContinue", this._handleAuthSASLContinue.bind(this));
        con.on("authenticationSASLFinal", this._handleAuthSASLFinal.bind(this));
        con.on("backendKeyData", this._handleBackendKeyData.bind(this));
        con.on("error", this._handleErrorEvent.bind(this));
        con.on("errorMessage", this._handleErrorMessage.bind(this));
        con.on("readyForQuery", this._handleReadyForQuery.bind(this));
        con.on("notice", this._handleNotice.bind(this));
        con.on("rowDescription", this._handleRowDescription.bind(this));
        con.on("dataRow", this._handleDataRow.bind(this));
        con.on("portalSuspended", this._handlePortalSuspended.bind(this));
        con.on("emptyQuery", this._handleEmptyQuery.bind(this));
        con.on("commandComplete", this._handleCommandComplete.bind(this));
        con.on("parseComplete", this._handleParseComplete.bind(this));
        con.on("copyInResponse", this._handleCopyInResponse.bind(this));
        con.on("copyData", this._handleCopyData.bind(this));
        con.on("notification", this._handleNotification.bind(this));
      }
      // TODO(bmc): deprecate pgpass "built in" integration since this.password can be a function
      // it can be supplied by the user if required - this is a breaking change!
      _checkPgPass(cb) {
        const con = this.connection;
        if (typeof this.password === "function") {
          this._Promise.resolve().then(() => this.password()).then((pass) => {
            if (pass !== void 0) {
              if (typeof pass !== "string") {
                con.emit("error", new TypeError("Password must be a string"));
                return;
              }
              this.connectionParameters.password = this.password = pass;
            } else {
              this.connectionParameters.password = this.password = null;
            }
            cb();
          }).catch((err) => {
            con.emit("error", err);
          });
        } else if (this.password !== null) {
          cb();
        } else {
          try {
            const pgPass = require_lib2();
            pgPass(this.connectionParameters, (pass) => {
              if (void 0 !== pass) {
                this.connectionParameters.password = this.password = pass;
              }
              cb();
            });
          } catch (e) {
            this.emit("error", e);
          }
        }
      }
      _handleAuthCleartextPassword(msg) {
        this._checkPgPass(() => {
          this.connection.password(this.password);
        });
      }
      _handleAuthMD5Password(msg) {
        this._checkPgPass(async () => {
          try {
            const hashedPassword = await crypto.postgresMd5PasswordHash(this.user, this.password, msg.salt);
            this.connection.password(hashedPassword);
          } catch (e) {
            this.emit("error", e);
          }
        });
      }
      _handleAuthSASL(msg) {
        this._checkPgPass(() => {
          try {
            this.saslSession = sasl.startSession(msg.mechanisms, this.enableChannelBinding && this.connection.stream);
            this.connection.sendSASLInitialResponseMessage(this.saslSession.mechanism, this.saslSession.response);
          } catch (err) {
            this.connection.emit("error", err);
          }
        });
      }
      async _handleAuthSASLContinue(msg) {
        try {
          await sasl.continueSession(
            this.saslSession,
            this.password,
            msg.data,
            this.enableChannelBinding && this.connection.stream
          );
          this.connection.sendSCRAMClientFinalMessage(this.saslSession.response);
        } catch (err) {
          this.connection.emit("error", err);
        }
      }
      _handleAuthSASLFinal(msg) {
        try {
          sasl.finalizeSession(this.saslSession, msg.data);
          this.saslSession = null;
        } catch (err) {
          this.connection.emit("error", err);
        }
      }
      _handleBackendKeyData(msg) {
        this.processID = msg.processID;
        this.secretKey = msg.secretKey;
      }
      _handleReadyForQuery(msg) {
        if (this._connecting) {
          this._connecting = false;
          this._connected = true;
          clearTimeout(this.connectionTimeoutHandle);
          if (this._connectionCallback) {
            this._connectionCallback(null, this);
            this._connectionCallback = null;
          }
          this.emit("connect");
        }
        const { activeQuery } = this;
        this.activeQuery = null;
        this.readyForQuery = true;
        if (activeQuery) {
          activeQuery.handleReadyForQuery(this.connection);
        }
        this._pulseQueryQueue();
      }
      // if we receive an error event or error message
      // during the connection process we handle it here
      _handleErrorWhileConnecting(err) {
        if (this._connectionError) {
          return;
        }
        this._connectionError = true;
        clearTimeout(this.connectionTimeoutHandle);
        if (this._connectionCallback) {
          return this._connectionCallback(err);
        }
        this.emit("error", err);
      }
      // if we're connected and we receive an error event from the connection
      // this means the socket is dead - do a hard abort of all queries and emit
      // the socket error on the client as well
      _handleErrorEvent(err) {
        if (this._connecting) {
          return this._handleErrorWhileConnecting(err);
        }
        this._queryable = false;
        this._errorAllQueries(err);
        this.emit("error", err);
      }
      // handle error messages from the postgres backend
      _handleErrorMessage(msg) {
        if (this._connecting) {
          return this._handleErrorWhileConnecting(msg);
        }
        const activeQuery = this.activeQuery;
        if (!activeQuery) {
          this._handleErrorEvent(msg);
          return;
        }
        this.activeQuery = null;
        activeQuery.handleError(msg, this.connection);
      }
      _handleRowDescription(msg) {
        this.activeQuery.handleRowDescription(msg);
      }
      _handleDataRow(msg) {
        this.activeQuery.handleDataRow(msg);
      }
      _handlePortalSuspended(msg) {
        this.activeQuery.handlePortalSuspended(this.connection);
      }
      _handleEmptyQuery(msg) {
        this.activeQuery.handleEmptyQuery(this.connection);
      }
      _handleCommandComplete(msg) {
        if (this.activeQuery == null) {
          const error = new Error("Received unexpected commandComplete message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        this.activeQuery.handleCommandComplete(msg, this.connection);
      }
      _handleParseComplete() {
        if (this.activeQuery == null) {
          const error = new Error("Received unexpected parseComplete message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        if (this.activeQuery.name) {
          this.connection.parsedStatements[this.activeQuery.name] = this.activeQuery.text;
        }
      }
      _handleCopyInResponse(msg) {
        this.activeQuery.handleCopyInResponse(this.connection);
      }
      _handleCopyData(msg) {
        this.activeQuery.handleCopyData(msg, this.connection);
      }
      _handleNotification(msg) {
        this.emit("notification", msg);
      }
      _handleNotice(msg) {
        this.emit("notice", msg);
      }
      getStartupConf() {
        const params = this.connectionParameters;
        const data = {
          user: params.user,
          database: params.database
        };
        const appName = params.application_name || params.fallback_application_name;
        if (appName) {
          data.application_name = appName;
        }
        if (params.replication) {
          data.replication = "" + params.replication;
        }
        if (params.statement_timeout) {
          data.statement_timeout = String(parseInt(params.statement_timeout, 10));
        }
        if (params.lock_timeout) {
          data.lock_timeout = String(parseInt(params.lock_timeout, 10));
        }
        if (params.idle_in_transaction_session_timeout) {
          data.idle_in_transaction_session_timeout = String(parseInt(params.idle_in_transaction_session_timeout, 10));
        }
        if (params.options) {
          data.options = params.options;
        }
        return data;
      }
      cancel(client2, query) {
        if (client2.activeQuery === query) {
          const con = this.connection;
          if (this.host && this.host.indexOf("/") === 0) {
            con.connect(this.host + "/.s.PGSQL." + this.port);
          } else {
            con.connect(this.port, this.host);
          }
          con.on("connect", function() {
            con.cancel(client2.processID, client2.secretKey);
          });
        } else if (client2.queryQueue.indexOf(query) !== -1) {
          client2.queryQueue.splice(client2.queryQueue.indexOf(query), 1);
        }
      }
      setTypeParser(oid, format, parseFn) {
        return this._types.setTypeParser(oid, format, parseFn);
      }
      getTypeParser(oid, format) {
        return this._types.getTypeParser(oid, format);
      }
      // escapeIdentifier and escapeLiteral moved to utility functions & exported
      // on PG
      // re-exported here for backwards compatibility
      escapeIdentifier(str2) {
        return utils.escapeIdentifier(str2);
      }
      escapeLiteral(str2) {
        return utils.escapeLiteral(str2);
      }
      _pulseQueryQueue() {
        if (this.readyForQuery === true) {
          this.activeQuery = this.queryQueue.shift();
          if (this.activeQuery) {
            this.readyForQuery = false;
            this.hasExecuted = true;
            const queryError = this.activeQuery.submit(this.connection);
            if (queryError) {
              process.nextTick(() => {
                this.activeQuery.handleError(queryError, this.connection);
                this.readyForQuery = true;
                this._pulseQueryQueue();
              });
            }
          } else if (this.hasExecuted) {
            this.activeQuery = null;
            this.emit("drain");
          }
        }
      }
      query(config2, values, callback) {
        let query;
        let result;
        let readTimeout;
        let readTimeoutTimer;
        let queryCallback;
        if (config2 === null || config2 === void 0) {
          throw new TypeError("Client was passed a null or undefined query");
        } else if (typeof config2.submit === "function") {
          readTimeout = config2.query_timeout || this.connectionParameters.query_timeout;
          result = query = config2;
          if (typeof values === "function") {
            query.callback = query.callback || values;
          }
        } else {
          readTimeout = config2.query_timeout || this.connectionParameters.query_timeout;
          query = new Query2(config2, values, callback);
          if (!query.callback) {
            result = new this._Promise((resolve2, reject) => {
              query.callback = (err, res) => err ? reject(err) : resolve2(res);
            }).catch((err) => {
              Error.captureStackTrace(err);
              throw err;
            });
          }
        }
        if (readTimeout) {
          queryCallback = query.callback;
          readTimeoutTimer = setTimeout(() => {
            const error = new Error("Query read timeout");
            process.nextTick(() => {
              query.handleError(error, this.connection);
            });
            queryCallback(error);
            query.callback = () => {
            };
            const index2 = this.queryQueue.indexOf(query);
            if (index2 > -1) {
              this.queryQueue.splice(index2, 1);
            }
            this._pulseQueryQueue();
          }, readTimeout);
          query.callback = (err, res) => {
            clearTimeout(readTimeoutTimer);
            queryCallback(err, res);
          };
        }
        if (this.binary && !query.binary) {
          query.binary = true;
        }
        if (query._result && !query._result._types) {
          query._result._types = this._types;
        }
        if (!this._queryable) {
          process.nextTick(() => {
            query.handleError(new Error("Client has encountered a connection error and is not queryable"), this.connection);
          });
          return result;
        }
        if (this._ending) {
          process.nextTick(() => {
            query.handleError(new Error("Client was closed and is not queryable"), this.connection);
          });
          return result;
        }
        this.queryQueue.push(query);
        this._pulseQueryQueue();
        return result;
      }
      ref() {
        this.connection.ref();
      }
      unref() {
        this.connection.unref();
      }
      end(cb) {
        this._ending = true;
        if (!this.connection._connecting || this._ended) {
          if (cb) {
            cb();
          } else {
            return this._Promise.resolve();
          }
        }
        if (this.activeQuery || !this._queryable) {
          this.connection.stream.destroy();
        } else {
          this.connection.end();
        }
        if (cb) {
          this.connection.once("end", cb);
        } else {
          return new this._Promise((resolve2) => {
            this.connection.once("end", resolve2);
          });
        }
      }
    };
    Client2.Query = Query2;
    module.exports = Client2;
  }
});

// node_modules/pg-pool/index.js
var require_pg_pool = __commonJS({
  "node_modules/pg-pool/index.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var NOOP = function() {
    };
    var removeWhere = (list2, predicate) => {
      const i = list2.findIndex(predicate);
      return i === -1 ? void 0 : list2.splice(i, 1)[0];
    };
    var IdleItem = class {
      constructor(client2, idleListener, timeoutId) {
        this.client = client2;
        this.idleListener = idleListener;
        this.timeoutId = timeoutId;
      }
    };
    var PendingItem = class {
      constructor(callback) {
        this.callback = callback;
      }
    };
    function throwOnDoubleRelease() {
      throw new Error("Release called on client which has already been released to the pool.");
    }
    function promisify(Promise2, callback) {
      if (callback) {
        return { callback, result: void 0 };
      }
      let rej;
      let res;
      const cb = function(err, client2) {
        err ? rej(err) : res(client2);
      };
      const result = new Promise2(function(resolve2, reject) {
        res = resolve2;
        rej = reject;
      }).catch((err) => {
        Error.captureStackTrace(err);
        throw err;
      });
      return { callback: cb, result };
    }
    function makeIdleListener(pool2, client2) {
      return function idleListener(err) {
        err.client = client2;
        client2.removeListener("error", idleListener);
        client2.on("error", () => {
          pool2.log("additional client error after disconnection due to error", err);
        });
        pool2._remove(client2);
        pool2.emit("error", err, client2);
      };
    }
    var Pool2 = class extends EventEmitter {
      constructor(options, Client2) {
        super();
        this.options = Object.assign({}, options);
        if (options != null && "password" in options) {
          Object.defineProperty(this.options, "password", {
            configurable: true,
            enumerable: false,
            writable: true,
            value: options.password
          });
        }
        if (options != null && options.ssl && options.ssl.key) {
          Object.defineProperty(this.options.ssl, "key", {
            enumerable: false
          });
        }
        this.options.max = this.options.max || this.options.poolSize || 10;
        this.options.min = this.options.min || 0;
        this.options.maxUses = this.options.maxUses || Infinity;
        this.options.allowExitOnIdle = this.options.allowExitOnIdle || false;
        this.options.maxLifetimeSeconds = this.options.maxLifetimeSeconds || 0;
        this.log = this.options.log || function() {
        };
        this.Client = this.options.Client || Client2 || require_lib3().Client;
        this.Promise = this.options.Promise || global.Promise;
        if (typeof this.options.idleTimeoutMillis === "undefined") {
          this.options.idleTimeoutMillis = 1e4;
        }
        this._clients = [];
        this._idle = [];
        this._expired = /* @__PURE__ */ new WeakSet();
        this._pendingQueue = [];
        this._endCallback = void 0;
        this.ending = false;
        this.ended = false;
      }
      _promiseTry(f) {
        const Promise2 = this.Promise;
        if (typeof Promise2.try === "function") {
          return Promise2.try(f);
        }
        return new Promise2((resolve2) => resolve2(f()));
      }
      _isFull() {
        return this._clients.length >= this.options.max;
      }
      _isAboveMin() {
        return this._clients.length > this.options.min;
      }
      _pulseQueue() {
        this.log("pulse queue");
        if (this.ended) {
          this.log("pulse queue ended");
          return;
        }
        if (this.ending) {
          this.log("pulse queue on ending");
          if (this._idle.length) {
            this._idle.slice().map((item) => {
              this._remove(item.client);
            });
          }
          if (!this._clients.length) {
            this.ended = true;
            this._endCallback();
          }
          return;
        }
        if (!this._pendingQueue.length) {
          this.log("no queued requests");
          return;
        }
        if (!this._idle.length && this._isFull()) {
          return;
        }
        const pendingItem = this._pendingQueue.shift();
        if (this._idle.length) {
          const idleItem = this._idle.pop();
          clearTimeout(idleItem.timeoutId);
          const client2 = idleItem.client;
          client2.ref && client2.ref();
          const idleListener = idleItem.idleListener;
          return this._acquireClient(client2, pendingItem, idleListener, false);
        }
        if (!this._isFull()) {
          return this.newClient(pendingItem);
        }
        throw new Error("unexpected condition");
      }
      _remove(client2, callback) {
        const removed = removeWhere(this._idle, (item) => item.client === client2);
        if (removed !== void 0) {
          clearTimeout(removed.timeoutId);
        }
        this._clients = this._clients.filter((c) => c !== client2);
        const context = this;
        client2.end(() => {
          context.emit("remove", client2);
          if (typeof callback === "function") {
            callback();
          }
        });
      }
      connect(cb) {
        if (this.ending) {
          const err = new Error("Cannot use a pool after calling end on the pool");
          return cb ? cb(err) : this.Promise.reject(err);
        }
        const response = promisify(this.Promise, cb);
        const result = response.result;
        if (this._isFull() || this._idle.length) {
          if (this._idle.length) {
            process.nextTick(() => this._pulseQueue());
          }
          if (!this.options.connectionTimeoutMillis) {
            this._pendingQueue.push(new PendingItem(response.callback));
            return result;
          }
          const queueCallback = (err, res, done) => {
            clearTimeout(tid);
            response.callback(err, res, done);
          };
          const pendingItem = new PendingItem(queueCallback);
          const tid = setTimeout(() => {
            removeWhere(this._pendingQueue, (i) => i.callback === queueCallback);
            pendingItem.timedOut = true;
            response.callback(new Error("timeout exceeded when trying to connect"));
          }, this.options.connectionTimeoutMillis);
          if (tid.unref) {
            tid.unref();
          }
          this._pendingQueue.push(pendingItem);
          return result;
        }
        this.newClient(new PendingItem(response.callback));
        return result;
      }
      newClient(pendingItem) {
        const client2 = new this.Client(this.options);
        this._clients.push(client2);
        const idleListener = makeIdleListener(this, client2);
        this.log("checking client timeout");
        let tid;
        let timeoutHit = false;
        if (this.options.connectionTimeoutMillis) {
          tid = setTimeout(() => {
            if (client2.connection) {
              this.log("ending client due to timeout");
              timeoutHit = true;
              client2.connection.stream.destroy();
            } else if (!client2.isConnected()) {
              this.log("ending client due to timeout");
              timeoutHit = true;
              client2.end();
            }
          }, this.options.connectionTimeoutMillis);
        }
        this.log("connecting new client");
        client2.connect((err) => {
          if (tid) {
            clearTimeout(tid);
          }
          client2.on("error", idleListener);
          if (err) {
            this.log("client failed to connect", err);
            this._clients = this._clients.filter((c) => c !== client2);
            if (timeoutHit) {
              err = new Error("Connection terminated due to connection timeout", { cause: err });
            }
            this._pulseQueue();
            if (!pendingItem.timedOut) {
              pendingItem.callback(err, void 0, NOOP);
            }
          } else {
            this.log("new client connected");
            if (this.options.onConnect) {
              this._promiseTry(() => this.options.onConnect(client2)).then(
                () => {
                  this._afterConnect(client2, pendingItem, idleListener);
                },
                (hookErr) => {
                  this._clients = this._clients.filter((c) => c !== client2);
                  client2.end(() => {
                    this._pulseQueue();
                    if (!pendingItem.timedOut) {
                      pendingItem.callback(hookErr, void 0, NOOP);
                    }
                  });
                }
              );
              return;
            }
            return this._afterConnect(client2, pendingItem, idleListener);
          }
        });
      }
      _afterConnect(client2, pendingItem, idleListener) {
        if (this.options.maxLifetimeSeconds !== 0) {
          const maxLifetimeTimeout = setTimeout(() => {
            this.log("ending client due to expired lifetime");
            this._expired.add(client2);
            const idleIndex = this._idle.findIndex((idleItem) => idleItem.client === client2);
            if (idleIndex !== -1) {
              this._acquireClient(
                client2,
                new PendingItem((err, client3, clientRelease) => clientRelease()),
                idleListener,
                false
              );
            }
          }, this.options.maxLifetimeSeconds * 1e3);
          maxLifetimeTimeout.unref();
          client2.once("end", () => clearTimeout(maxLifetimeTimeout));
        }
        return this._acquireClient(client2, pendingItem, idleListener, true);
      }
      // acquire a client for a pending work item
      _acquireClient(client2, pendingItem, idleListener, isNew) {
        if (isNew) {
          this.emit("connect", client2);
        }
        this.emit("acquire", client2);
        client2.release = this._releaseOnce(client2, idleListener);
        client2.removeListener("error", idleListener);
        if (!pendingItem.timedOut) {
          if (isNew && this.options.verify) {
            this.options.verify(client2, (err) => {
              if (err) {
                client2.release(err);
                return pendingItem.callback(err, void 0, NOOP);
              }
              pendingItem.callback(void 0, client2, client2.release);
            });
          } else {
            pendingItem.callback(void 0, client2, client2.release);
          }
        } else {
          if (isNew && this.options.verify) {
            this.options.verify(client2, client2.release);
          } else {
            client2.release();
          }
        }
      }
      // returns a function that wraps _release and throws if called more than once
      _releaseOnce(client2, idleListener) {
        let released = false;
        return (err) => {
          if (released) {
            throwOnDoubleRelease();
          }
          released = true;
          this._release(client2, idleListener, err);
        };
      }
      // release a client back to the poll, include an error
      // to remove it from the pool
      _release(client2, idleListener, err) {
        client2.on("error", idleListener);
        client2._poolUseCount = (client2._poolUseCount || 0) + 1;
        this.emit("release", err, client2);
        if (err || this.ending || !client2._queryable || client2._ending || client2._poolUseCount >= this.options.maxUses) {
          if (client2._poolUseCount >= this.options.maxUses) {
            this.log("remove expended client");
          }
          return this._remove(client2, this._pulseQueue.bind(this));
        }
        const isExpired = this._expired.has(client2);
        if (isExpired) {
          this.log("remove expired client");
          this._expired.delete(client2);
          return this._remove(client2, this._pulseQueue.bind(this));
        }
        let tid;
        if (this.options.idleTimeoutMillis && this._isAboveMin()) {
          tid = setTimeout(() => {
            if (this._isAboveMin()) {
              this.log("remove idle client");
              this._remove(client2, this._pulseQueue.bind(this));
            }
          }, this.options.idleTimeoutMillis);
          if (this.options.allowExitOnIdle) {
            tid.unref();
          }
        }
        if (this.options.allowExitOnIdle) {
          client2.unref();
        }
        this._idle.push(new IdleItem(client2, idleListener, tid));
        this._pulseQueue();
      }
      query(text, values, cb) {
        if (typeof text === "function") {
          const response2 = promisify(this.Promise, text);
          setImmediate(function() {
            return response2.callback(new Error("Passing a function as the first parameter to pool.query is not supported"));
          });
          return response2.result;
        }
        if (typeof values === "function") {
          cb = values;
          values = void 0;
        }
        const response = promisify(this.Promise, cb);
        cb = response.callback;
        this.connect((err, client2) => {
          if (err) {
            return cb(err);
          }
          let clientReleased = false;
          const onError = (err2) => {
            if (clientReleased) {
              return;
            }
            clientReleased = true;
            client2.release(err2);
            cb(err2);
          };
          client2.once("error", onError);
          this.log("dispatching query");
          try {
            client2.query(text, values, (err2, res) => {
              this.log("query dispatched");
              client2.removeListener("error", onError);
              if (clientReleased) {
                return;
              }
              clientReleased = true;
              client2.release(err2);
              if (err2) {
                return cb(err2);
              }
              return cb(void 0, res);
            });
          } catch (err2) {
            client2.release(err2);
            return cb(err2);
          }
        });
        return response.result;
      }
      end(cb) {
        this.log("ending");
        if (this.ending) {
          const err = new Error("Called end on pool more than once");
          return cb ? cb(err) : this.Promise.reject(err);
        }
        this.ending = true;
        const promised = promisify(this.Promise, cb);
        this._endCallback = promised.callback;
        this._pulseQueue();
        return promised.result;
      }
      get waitingCount() {
        return this._pendingQueue.length;
      }
      get idleCount() {
        return this._idle.length;
      }
      get expiredCount() {
        return this._clients.reduce((acc, client2) => acc + (this._expired.has(client2) ? 1 : 0), 0);
      }
      get totalCount() {
        return this._clients.length;
      }
    };
    module.exports = Pool2;
  }
});

// node_modules/pg/lib/native/query.js
var require_query2 = __commonJS({
  "node_modules/pg/lib/native/query.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var util = __require("util");
    var utils = require_utils2();
    var NativeQuery = module.exports = function(config2, values, callback) {
      EventEmitter.call(this);
      config2 = utils.normalizeQueryConfig(config2, values, callback);
      this.text = config2.text;
      this.values = config2.values;
      this.name = config2.name;
      this.queryMode = config2.queryMode;
      this.callback = config2.callback;
      this.state = "new";
      this._arrayMode = config2.rowMode === "array";
      this._emitRowEvents = false;
      this.on(
        "newListener",
        function(event) {
          if (event === "row") this._emitRowEvents = true;
        }.bind(this)
      );
    };
    util.inherits(NativeQuery, EventEmitter);
    var errorFieldMap = {
      sqlState: "code",
      statementPosition: "position",
      messagePrimary: "message",
      context: "where",
      schemaName: "schema",
      tableName: "table",
      columnName: "column",
      dataTypeName: "dataType",
      constraintName: "constraint",
      sourceFile: "file",
      sourceLine: "line",
      sourceFunction: "routine"
    };
    NativeQuery.prototype.handleError = function(err) {
      const fields = this.native.pq.resultErrorFields();
      if (fields) {
        for (const key in fields) {
          const normalizedFieldName = errorFieldMap[key] || key;
          err[normalizedFieldName] = fields[key];
        }
      }
      if (this.callback) {
        this.callback(err);
      } else {
        this.emit("error", err);
      }
      this.state = "error";
    };
    NativeQuery.prototype.then = function(onSuccess, onFailure) {
      return this._getPromise().then(onSuccess, onFailure);
    };
    NativeQuery.prototype.catch = function(callback) {
      return this._getPromise().catch(callback);
    };
    NativeQuery.prototype._getPromise = function() {
      if (this._promise) return this._promise;
      this._promise = new Promise(
        function(resolve2, reject) {
          this._once("end", resolve2);
          this._once("error", reject);
        }.bind(this)
      );
      return this._promise;
    };
    NativeQuery.prototype.submit = function(client2) {
      this.state = "running";
      const self = this;
      this.native = client2.native;
      client2.native.arrayMode = this._arrayMode;
      let after = function(err, rows, results) {
        client2.native.arrayMode = false;
        setImmediate(function() {
          self.emit("_done");
        });
        if (err) {
          return self.handleError(err);
        }
        if (self._emitRowEvents) {
          if (results.length > 1) {
            rows.forEach((rowOfRows, i) => {
              rowOfRows.forEach((row) => {
                self.emit("row", row, results[i]);
              });
            });
          } else {
            rows.forEach(function(row) {
              self.emit("row", row, results);
            });
          }
        }
        self.state = "end";
        self.emit("end", results);
        if (self.callback) {
          self.callback(null, results);
        }
      };
      if (process.domain) {
        after = process.domain.bind(after);
      }
      if (this.name) {
        if (this.name.length > 63) {
          console.error("Warning! Postgres only supports 63 characters for query names.");
          console.error("You supplied %s (%s)", this.name, this.name.length);
          console.error("This can cause conflicts and silent errors executing queries");
        }
        const values = (this.values || []).map(utils.prepareValue);
        if (client2.namedQueries[this.name]) {
          if (this.text && client2.namedQueries[this.name] !== this.text) {
            const err = new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`);
            return after(err);
          }
          return client2.native.execute(this.name, values, after);
        }
        return client2.native.prepare(this.name, this.text, values.length, function(err) {
          if (err) return after(err);
          client2.namedQueries[self.name] = self.text;
          return self.native.execute(self.name, values, after);
        });
      } else if (this.values) {
        if (!Array.isArray(this.values)) {
          const err = new Error("Query values must be an array");
          return after(err);
        }
        const vals = this.values.map(utils.prepareValue);
        client2.native.query(this.text, vals, after);
      } else if (this.queryMode === "extended") {
        client2.native.query(this.text, [], after);
      } else {
        client2.native.query(this.text, after);
      }
    };
  }
});

// node_modules/pg/lib/native/client.js
var require_client2 = __commonJS({
  "node_modules/pg/lib/native/client.js"(exports, module) {
    "use strict";
    var Native;
    try {
      Native = __require("pg-native");
    } catch (e) {
      throw e;
    }
    var TypeOverrides2 = require_type_overrides();
    var EventEmitter = __require("events").EventEmitter;
    var util = __require("util");
    var ConnectionParameters = require_connection_parameters();
    var NativeQuery = require_query2();
    var Client2 = module.exports = function(config2) {
      EventEmitter.call(this);
      config2 = config2 || {};
      this._Promise = config2.Promise || global.Promise;
      this._types = new TypeOverrides2(config2.types);
      this.native = new Native({
        types: this._types
      });
      this._queryQueue = [];
      this._ending = false;
      this._connecting = false;
      this._connected = false;
      this._queryable = true;
      const cp = this.connectionParameters = new ConnectionParameters(config2);
      if (config2.nativeConnectionString) cp.nativeConnectionString = config2.nativeConnectionString;
      this.user = cp.user;
      Object.defineProperty(this, "password", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: cp.password
      });
      this.database = cp.database;
      this.host = cp.host;
      this.port = cp.port;
      this.namedQueries = {};
    };
    Client2.Query = NativeQuery;
    util.inherits(Client2, EventEmitter);
    Client2.prototype._errorAllQueries = function(err) {
      const enqueueError = (query) => {
        process.nextTick(() => {
          query.native = this.native;
          query.handleError(err);
        });
      };
      if (this._hasActiveQuery()) {
        enqueueError(this._activeQuery);
        this._activeQuery = null;
      }
      this._queryQueue.forEach(enqueueError);
      this._queryQueue.length = 0;
    };
    Client2.prototype._connect = function(cb) {
      const self = this;
      if (this._connecting) {
        process.nextTick(() => cb(new Error("Client has already been connected. You cannot reuse a client.")));
        return;
      }
      this._connecting = true;
      this.connectionParameters.getLibpqConnectionString(function(err, conString) {
        if (self.connectionParameters.nativeConnectionString) conString = self.connectionParameters.nativeConnectionString;
        if (err) return cb(err);
        self.native.connect(conString, function(err2) {
          if (err2) {
            self.native.end();
            return cb(err2);
          }
          self._connected = true;
          self.native.on("error", function(err3) {
            self._queryable = false;
            self._errorAllQueries(err3);
            self.emit("error", err3);
          });
          self.native.on("notification", function(msg) {
            self.emit("notification", {
              channel: msg.relname,
              payload: msg.extra
            });
          });
          self.emit("connect");
          self._pulseQueryQueue(true);
          cb();
        });
      });
    };
    Client2.prototype.connect = function(callback) {
      if (callback) {
        this._connect(callback);
        return;
      }
      return new this._Promise((resolve2, reject) => {
        this._connect((error) => {
          if (error) {
            reject(error);
          } else {
            resolve2();
          }
        });
      });
    };
    Client2.prototype.query = function(config2, values, callback) {
      let query;
      let result;
      let readTimeout;
      let readTimeoutTimer;
      let queryCallback;
      if (config2 === null || config2 === void 0) {
        throw new TypeError("Client was passed a null or undefined query");
      } else if (typeof config2.submit === "function") {
        readTimeout = config2.query_timeout || this.connectionParameters.query_timeout;
        result = query = config2;
        if (typeof values === "function") {
          config2.callback = values;
        }
      } else {
        readTimeout = config2.query_timeout || this.connectionParameters.query_timeout;
        query = new NativeQuery(config2, values, callback);
        if (!query.callback) {
          let resolveOut, rejectOut;
          result = new this._Promise((resolve2, reject) => {
            resolveOut = resolve2;
            rejectOut = reject;
          }).catch((err) => {
            Error.captureStackTrace(err);
            throw err;
          });
          query.callback = (err, res) => err ? rejectOut(err) : resolveOut(res);
        }
      }
      if (readTimeout) {
        queryCallback = query.callback;
        readTimeoutTimer = setTimeout(() => {
          const error = new Error("Query read timeout");
          process.nextTick(() => {
            query.handleError(error, this.connection);
          });
          queryCallback(error);
          query.callback = () => {
          };
          const index2 = this._queryQueue.indexOf(query);
          if (index2 > -1) {
            this._queryQueue.splice(index2, 1);
          }
          this._pulseQueryQueue();
        }, readTimeout);
        query.callback = (err, res) => {
          clearTimeout(readTimeoutTimer);
          queryCallback(err, res);
        };
      }
      if (!this._queryable) {
        query.native = this.native;
        process.nextTick(() => {
          query.handleError(new Error("Client has encountered a connection error and is not queryable"));
        });
        return result;
      }
      if (this._ending) {
        query.native = this.native;
        process.nextTick(() => {
          query.handleError(new Error("Client was closed and is not queryable"));
        });
        return result;
      }
      this._queryQueue.push(query);
      this._pulseQueryQueue();
      return result;
    };
    Client2.prototype.end = function(cb) {
      const self = this;
      this._ending = true;
      if (!this._connected) {
        this.once("connect", this.end.bind(this, cb));
      }
      let result;
      if (!cb) {
        result = new this._Promise(function(resolve2, reject) {
          cb = (err) => err ? reject(err) : resolve2();
        });
      }
      this.native.end(function() {
        self._errorAllQueries(new Error("Connection terminated"));
        process.nextTick(() => {
          self.emit("end");
          if (cb) cb();
        });
      });
      return result;
    };
    Client2.prototype._hasActiveQuery = function() {
      return this._activeQuery && this._activeQuery.state !== "error" && this._activeQuery.state !== "end";
    };
    Client2.prototype._pulseQueryQueue = function(initialConnection) {
      if (!this._connected) {
        return;
      }
      if (this._hasActiveQuery()) {
        return;
      }
      const query = this._queryQueue.shift();
      if (!query) {
        if (!initialConnection) {
          this.emit("drain");
        }
        return;
      }
      this._activeQuery = query;
      query.submit(this);
      const self = this;
      query.once("_done", function() {
        self._pulseQueryQueue();
      });
    };
    Client2.prototype.cancel = function(query) {
      if (this._activeQuery === query) {
        this.native.cancel(function() {
        });
      } else if (this._queryQueue.indexOf(query) !== -1) {
        this._queryQueue.splice(this._queryQueue.indexOf(query), 1);
      }
    };
    Client2.prototype.ref = function() {
    };
    Client2.prototype.unref = function() {
    };
    Client2.prototype.setTypeParser = function(oid, format, parseFn) {
      return this._types.setTypeParser(oid, format, parseFn);
    };
    Client2.prototype.getTypeParser = function(oid, format) {
      return this._types.getTypeParser(oid, format);
    };
  }
});

// node_modules/pg/lib/native/index.js
var require_native = __commonJS({
  "node_modules/pg/lib/native/index.js"(exports, module) {
    "use strict";
    module.exports = require_client2();
  }
});

// node_modules/pg/lib/index.js
var require_lib3 = __commonJS({
  "node_modules/pg/lib/index.js"(exports, module) {
    "use strict";
    var Client2 = require_client();
    var defaults2 = require_defaults();
    var Connection2 = require_connection();
    var Result2 = require_result();
    var utils = require_utils2();
    var Pool2 = require_pg_pool();
    var TypeOverrides2 = require_type_overrides();
    var { DatabaseError: DatabaseError2 } = require_dist();
    var { escapeIdentifier: escapeIdentifier2, escapeLiteral: escapeLiteral2 } = require_utils2();
    var poolFactory = (Client3) => {
      return class BoundPool extends Pool2 {
        constructor(options) {
          super(options, Client3);
        }
      };
    };
    var PG = function(clientConstructor) {
      this.defaults = defaults2;
      this.Client = clientConstructor;
      this.Query = this.Client.Query;
      this.Pool = poolFactory(this.Client);
      this._pools = [];
      this.Connection = Connection2;
      this.types = require_pg_types();
      this.DatabaseError = DatabaseError2;
      this.TypeOverrides = TypeOverrides2;
      this.escapeIdentifier = escapeIdentifier2;
      this.escapeLiteral = escapeLiteral2;
      this.Result = Result2;
      this.utils = utils;
    };
    if (typeof process.env.NODE_PG_FORCE_NATIVE !== "undefined") {
      module.exports = new PG(require_native());
    } else {
      module.exports = new PG(Client2);
      Object.defineProperty(module.exports, "native", {
        configurable: true,
        enumerable: false,
        get() {
          let native = null;
          try {
            native = new PG(require_native());
          } catch (err) {
            if (err.code !== "MODULE_NOT_FOUND") {
              throw err;
            }
          }
          Object.defineProperty(module.exports, "native", {
            value: native
          });
          return native;
        }
      });
    }
  }
});

// node_modules/pg/esm/index.mjs
var import_lib, Client, Pool, Connection, types, Query, DatabaseError, escapeIdentifier, escapeLiteral, Result, TypeOverrides, defaults, esm_default;
var init_esm = __esm({
  "node_modules/pg/esm/index.mjs"() {
    import_lib = __toESM(require_lib3(), 1);
    Client = import_lib.default.Client;
    Pool = import_lib.default.Pool;
    Connection = import_lib.default.Connection;
    types = import_lib.default.types;
    Query = import_lib.default.Query;
    DatabaseError = import_lib.default.DatabaseError;
    escapeIdentifier = import_lib.default.escapeIdentifier;
    escapeLiteral = import_lib.default.escapeLiteral;
    Result = import_lib.default.Result;
    TypeOverrides = import_lib.default.TypeOverrides;
    defaults = import_lib.default.defaults;
    esm_default = import_lib.default;
  }
});

// src/errors.ts
function fail(status2, error, message, fields, headers) {
  throw new ApiError(status2, error, message, fields, headers);
}
function notFound() {
  return fail(404, "not_found", "No such item.");
}
function publicNotFound() {
  return fail(404, "not_found", "Nothing is published at this address.");
}
function forbidden() {
  return fail(403, "forbidden", "Your current roles do not allow this.");
}
function authorDenied() {
  return fail(
    403,
    "author_cannot_approve",
    "Authors cannot approve, sign off, clear, schedule or release their own work."
  );
}
function validation(fields) {
  return fail(
    422,
    "validation_failed",
    "Please fix the highlighted fields.",
    fields
  );
}
function acceptOnly(body, accepted) {
  const offending = Object.keys(body).filter((key) => !accepted.includes(key));
  if (offending.length)
    fail(
      422,
      "read_only_fields",
      "Some fields are set by the server.",
      Object.fromEntries(
        offending.map((key) => [key, "This field is set by the server."])
      )
    );
}
function illegal(from, to) {
  return fail(
    409,
    "illegal_transition",
    `This item cannot move from ${from} to ${to}.`
  );
}
function stale() {
  return fail(
    412,
    "stale_version",
    "Someone else changed this item. Reload to see the latest version."
  );
}
function requireVersion(header2) {
  if (!header2)
    fail(
      428,
      "version_required",
      "Send the version you are changing in If-Match."
    );
  const match = /^"(\d+)"$/.exec(header2.trim());
  return match ? Number(match[1]) : -1;
}
function checkVersion(expected, version) {
  if (expected !== version) stale();
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
var ApiError, str, list;
var init_errors = __esm({
  "src/errors.ts"() {
    "use strict";
    ApiError = class extends Error {
      constructor(status2, error, message, fields, headers) {
        super(message);
        this.status = status2;
        this.error = error;
        this.fields = fields;
        this.headers = headers;
      }
      toJSON() {
        return {
          error: this.error,
          message: this.message,
          ...this.fields ? { fields: this.fields } : {}
        };
      }
    };
    str = (value) => typeof value === "string" ? value : "";
    list = (value) => Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
  }
});

// src/db.ts
import { randomUUID, createHash } from "node:crypto";
async function transaction(fn) {
  const db = await pool.connect();
  pendingAudit.set(db, []);
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await appendAudit(db, pendingAudit.get(db));
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    pendingAudit.delete(db);
    db.release();
  }
}
async function advisory(db, key) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
}
async function all(db, table2) {
  const r = await db.query(`SELECT data FROM ${table2}`);
  return r.rows.map((x) => x.data);
}
async function one(db, table2, key, lock = false) {
  return (await db.query(
    `SELECT data FROM ${table2} WHERE id::text=$1${lock ? " FOR UPDATE" : ""}`,
    [key]
  )).rows[0]?.data;
}
async function conditional(db, table2, sets, values, key, expected) {
  const written = await db.query(
    `UPDATE ${table2} SET ${sets} WHERE id=$${values.length + 1} AND version=$${values.length + 2}`,
    [...values, key, expected]
  );
  if (!written.rowCount) stale();
}
async function saveContent(db, c, expected) {
  if (expected === void 0)
    await db.query(
      "INSERT INTO content(id,slug,kind,status,version,data) VALUES($1,$2,$3,$4,$5,$6)",
      [c.id, c.slug, c.kind, c.status, c.version, c]
    );
  else
    await conditional(
      db,
      "content",
      "slug=$1,status=$2,version=$3,data=$4",
      [c.slug, c.status, c.version, c],
      c.id,
      expected
    );
  await db.query(
    "INSERT INTO content_revisions(content_id,version,data) VALUES($1,$2,$3) ON CONFLICT(content_id,version) DO NOTHING",
    [c.id, c.version, c]
  );
}
async function saveRecord(db, key, r) {
  await db.query(
    "INSERT INTO release_records(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2",
    [key, r]
  );
}
async function saveRequisition(db, r, expected) {
  if (expected === void 0)
    await db.query(
      "INSERT INTO requisitions(id,slug,status,version,data) VALUES($1,$2,$3,$4,$5)",
      [r.id, r.slug, r.status, r.version, r]
    );
  else
    await conditional(
      db,
      "requisitions",
      "status=$1,version=$2,data=$3",
      [r.status, r.version, r],
      r.id,
      expected
    );
}
async function saveApplication(db, a, expected) {
  if (expected === void 0)
    await db.query(
      "INSERT INTO applications(id,requisition_id,email,token_digest,version,data) VALUES($1,$2,$3,$4,$5,$6)",
      [a.id, a.requisition_id, a.email, a.token_digest, a.version, a]
    );
  else
    await conditional(
      db,
      "applications",
      "email=$1,token_digest=$2,version=$3,data=$4",
      [a.email, a.token_digest, a.version, a],
      a.id,
      expected
    );
}
async function saveGrant(db, g, expected) {
  if (expected === void 0)
    await db.query(
      "INSERT INTO grants(id,staff_email,version,data) VALUES($1,$2,$3,$4)",
      [g.id, g.staff_email, g.version, g]
    );
  else
    await conditional(
      db,
      "grants",
      "version=$1,data=$2",
      [g.version, g],
      g.id,
      expected
    );
}
async function saveBenefits(db, entry) {
  await db.query(
    "INSERT INTO benefits(id,region,effective_from,data) VALUES($1,$2,$3,$4)",
    [entry.id, entry.region, entry.effective_from, entry]
  );
}
async function saveRow(db, row) {
  await db.query(
    "INSERT INTO benchmark_rows(id,subject,benchmark,eval_date,data) VALUES($1,$2,$3,$4,$5)",
    [row.id, row.subject, row.benchmark, row.eval_date, row]
  );
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`
    ).join(",")}}`;
  return JSON.stringify(value);
}
function auditHash(prev, entry) {
  const { seq, at, actor, action, target_type, target_id, detail } = entry;
  return createHash("sha256").update(
    `${prev}
${canonical({ seq, at, actor, action, target_type, target_id, detail })}`,
    "utf8"
  ).digest("hex");
}
async function audit(db, actor, action, target_type, target_id, detail = {}) {
  pendingAudit.get(db).push({
    id: id(),
    at: now(),
    actor,
    action,
    target_type,
    target_id,
    detail
  });
}
async function appendAudit(db, entries) {
  if (!entries.length) return;
  await advisory(db, "audit-chain");
  const head = (await db.query(
    "SELECT seq,hash FROM audit_entries ORDER BY seq DESC LIMIT 1"
  )).rows[0];
  let seq = head ? Number(head.seq) : 0, prev = head?.hash || ZERO_HASH;
  for (const entry of entries) {
    seq++;
    const hash2 = auditHash(prev, { ...entry, seq });
    await db.query(
      "INSERT INTO audit_entries(seq,id,at,actor,action,target_type,target_id,detail,prev_hash,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        seq,
        entry.id,
        entry.at,
        entry.actor,
        entry.action,
        entry.target_type,
        entry.target_id,
        entry.detail,
        prev,
        hash2
      ]
    );
    prev = hash2;
  }
}
async function enqueueJob(db, kind, payload) {
  await db.query("INSERT INTO jobs(kind,payload) VALUES($1,$2)", [
    kind,
    payload
  ]);
}
async function enqueueMail(db, to, subject, body) {
  const message = {
    to_name: to.name,
    to_email: to.email,
    subject,
    body
  };
  await enqueueJob(db, "mail", { ...message });
}
async function staffName(db, email2) {
  return (await db.query("SELECT name FROM staff WHERE email=$1", [
    email2
  ])).rows[0].name;
}
async function schema() {
  await transaction(async (db) => {
    await advisory(db, "schema");
    await db.query(`
CREATE TABLE IF NOT EXISTS staff(email text PRIMARY KEY,name text NOT NULL,password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS grants(id text PRIMARY KEY,staff_email text NOT NULL REFERENCES staff(email),version integer NOT NULL,data jsonb NOT NULL,expiry_notified boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS sessions(digest text PRIMARY KEY,email text NOT NULL REFERENCES staff(email),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS signin_failures(email text PRIMARY KEY,failures integer NOT NULL DEFAULT 0,lock_seconds integer NOT NULL DEFAULT 0,locked_until timestamptz);
CREATE TABLE IF NOT EXISTS content(id text PRIMARY KEY,slug text UNIQUE NOT NULL,kind text NOT NULL,status text NOT NULL,version integer NOT NULL,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS content_revisions(content_id text NOT NULL REFERENCES content(id),version integer NOT NULL,data jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(content_id,version));
CREATE TABLE IF NOT EXISTS embargo_schedules(content_id text PRIMARY KEY REFERENCES content(id),release_at timestamptz NOT NULL,scheduled_by text NOT NULL);
CREATE TABLE IF NOT EXISTS publication_history(content_id text PRIMARY KEY REFERENCES content(id),published_at timestamptz NOT NULL,withdrawn_at timestamptz);
CREATE TABLE IF NOT EXISTS release_records(id text PRIMARY KEY REFERENCES content(id),data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS benchmark_rows(id text PRIMARY KEY,subject text NOT NULL,benchmark text NOT NULL,eval_date text NOT NULL,data jsonb NOT NULL,UNIQUE(subject,benchmark,eval_date));
CREATE TABLE IF NOT EXISTS search_documents(kind text NOT NULL,slug text NOT NULL,title text NOT NULL,summary text NOT NULL,body text NOT NULL,published_at timestamptz NOT NULL,document tsvector NOT NULL,PRIMARY KEY(kind,slug));
CREATE INDEX IF NOT EXISTS search_documents_document ON search_documents USING gin(document);
CREATE TABLE IF NOT EXISTS requisitions(id text PRIMARY KEY,slug text UNIQUE NOT NULL,status text NOT NULL,version integer NOT NULL,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS benefits(id text PRIMARY KEY,region text NOT NULL,effective_from text NOT NULL,data jsonb NOT NULL,UNIQUE(region,effective_from));
CREATE TABLE IF NOT EXISTS applications(id text PRIMARY KEY,requisition_id text NOT NULL REFERENCES requisitions(id),email text NOT NULL,token_digest text UNIQUE,version integer NOT NULL,data jsonb NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS application_email_unique ON applications(requisition_id,email) WHERE email<>'';
CREATE TABLE IF NOT EXISTS resend_requests(email text NOT NULL,at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS resend_requests_email ON resend_requests(email,at);
CREATE TABLE IF NOT EXISTS rate_limits(bucket text NOT NULL,key text NOT NULL,window_start timestamptz NOT NULL,count integer NOT NULL,PRIMARY KEY(bucket,key));
CREATE TABLE IF NOT EXISTS idempotency_keys(scope text NOT NULL,key text NOT NULL,fingerprint text NOT NULL,status integer,body text,headers jsonb,expires_at timestamptz NOT NULL,PRIMARY KEY(scope,key));
CREATE TABLE IF NOT EXISTS jobs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,kind text NOT NULL,state text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,refusals integer NOT NULL DEFAULT 0,last_error text,next_attempt_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,lease_until timestamptz,payload jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,next_attempt_at);
CREATE TABLE IF NOT EXISTS audit_entries(seq bigint PRIMARY KEY,id text UNIQUE NOT NULL,at text NOT NULL,actor text NOT NULL,action text NOT NULL,target_type text NOT NULL,target_id text NOT NULL,detail jsonb NOT NULL,prev_hash text NOT NULL,hash text NOT NULL);
CREATE INDEX IF NOT EXISTS audit_entries_target ON audit_entries(target_id);
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit entries cannot be changed or removed.'; END $$;
DROP TRIGGER IF EXISTS immutable_audit ON audit_entries;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_entries FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
`);
  });
}
var pool, id, now, pendingAudit, ZERO_HASH;
var init_db = __esm({
  "src/db.ts"() {
    "use strict";
    init_esm();
    init_config();
    init_errors();
    pool = new esm_default.Pool({
      connectionString: config.databaseUrl,
      max: 16
    });
    pool.on(
      "error",
      (error) => console.error("Database connection lost", error.message)
    );
    id = () => randomUUID();
    now = () => (/* @__PURE__ */ new Date()).toISOString();
    pendingAudit = /* @__PURE__ */ new WeakMap();
    ZERO_HASH = "0".repeat(64);
  }
});

// src/media.ts
import { createHash as createHash2, createHmac } from "node:crypto";
import { deflateSync } from "node:zlib";
async function storage(method, key, body, type) {
  const base = new URL(config.s3Endpoint);
  const path = "/" + [...config.s3PathStyle ? [config.s3Bucket] : [], ...key.split("/")].map(encodeURIComponent).join("/");
  if (!config.s3PathStyle)
    base.hostname = `${config.s3Bucket}.${base.hostname}`;
  const date2 = (/* @__PURE__ */ new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = date2.slice(0, 8);
  const payload = hash(body || Buffer.alloc(0));
  const headers = {
    host: base.host,
    "x-amz-content-sha256": payload,
    "x-amz-date": date2
  };
  if (type) headers["content-type"] = type;
  const names = Object.keys(headers).sort();
  const signed = names.join(";");
  const canonical2 = [
    method,
    path,
    "",
    names.map((k) => `${k}:${headers[k]}
`).join(""),
    signed,
    payload
  ].join("\n");
  const scope = `${day}/${config.s3Region}/s3/aws4_request`;
  const keySig = hmac(
    hmac(hmac(hmac("AWS4" + config.s3SecretKey, day), config.s3Region), "s3"),
    "aws4_request"
  );
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKey}/${scope}, SignedHeaders=${signed}, Signature=${hmac(keySig, ["AWS4-HMAC-SHA256", date2, scope, hash(canonical2)].join("\n")).toString("hex")}`;
  const url = new URL(path, base);
  return fetch(url, {
    method,
    headers,
    body: body ? new Uint8Array(body) : void 0,
    signal: AbortSignal.timeout(3e3)
  });
}
async function putObject(key, body, type) {
  const response = await storage("PUT", key, body, type);
  if (!response.ok) throw new StorageRefused();
}
async function deleteObject(key) {
  const response = await storage("DELETE", key);
  if (!response.ok && response.status !== 404) throw new StorageRefused();
}
function sampleUrl(id2, file) {
  return `/media/samples/${sampleRoute}/${id2}/${file}`;
}
function wav(rhythm = false) {
  const rate = 22050, seconds2 = 3, count = rate * seconds2;
  const b = Buffer.alloc(44 + count * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(count * 2, 40);
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    phase += 2 * Math.PI * (rhythm ? 220 : 220 + 160 * Math.sin(t * 0.9)) / rate;
    const envelope = Math.sin(Math.PI * t / seconds2) ** 2 * (rhythm ? Math.exp(-(t * 4 % 1) * 8) : 1);
    b.writeInt16LE(Math.round(Math.sin(phase) * envelope * 11e3), 44 + i * 2);
  }
  return b;
}
function crc32(data) {
  let crc = 4294967295;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
  }
  return (crc ^ 4294967295) >>> 0;
}
function chunk(name, data) {
  const n = Buffer.from(name);
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length);
  n.copy(b, 4);
  data.copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([n, data])), 8 + data.length);
  return b;
}
function png(frame) {
  const width = 640, height = 360;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3;
      const radial = Math.exp(
        -(((x - 320) / 180) ** 2 + ((y - 180) / 105) ** 2)
      );
      const wave = Math.sin(x * 0.035 + Math.sin(y * 0.03) * 2) * Math.cos(y * 0.035);
      const noise = ((Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0) % 255;
      const amount = 0.15 + 0.85 * (frame - 1) / 11;
      const v = Math.round(
        noise * (1 - amount) + (225 - radial * (90 + 70 * wave)) * amount
      );
      raw[i] = Math.min(245, v + 8);
      raw[i + 1] = Math.min(242, v + 5);
      raw[i + 2] = Math.min(233, v);
    }
  const header2 = Buffer.alloc(13);
  header2.writeUInt32BE(width);
  header2.writeUInt32BE(height, 4);
  header2[8] = 8;
  header2[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header2),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
function generatedSamples() {
  return sampleDefinitions.flatMap(
    (s) => s.urls.map((url, i) => ({
      key: url.replace("/media/", ""),
      body: s.kind === "audio" ? wav(s.id === "rhythm-continuation") : png(i + 1),
      type: s.kind === "audio" ? "audio/wav" : "image/png"
    }))
  );
}
var hash, hmac, StorageRefused, sampleRoute, sampleDefinitions;
var init_media = __esm({
  "src/media.ts"() {
    "use strict";
    init_config();
    hash = (data) => createHash2("sha256").update(data).digest("hex");
    hmac = (key, data) => createHmac("sha256", key).update(data).digest();
    StorageRefused = class extends Error {
    };
    sampleRoute = "kestrel-2";
    sampleDefinitions = [
      {
        id: "pitch-contour",
        kind: "audio",
        title: "Pitch contour study",
        urls: [sampleUrl("pitch-contour", "clip.wav")]
      },
      {
        id: "rhythm-continuation",
        kind: "audio",
        title: "Rhythm continuation study",
        urls: [sampleUrl("rhythm-continuation", "clip.wav")]
      },
      {
        id: "denoise-sequence",
        kind: "image_sequence",
        title: "Denoising sequence",
        urls: Array.from(
          { length: 12 },
          (_, i) => sampleUrl(
            "denoise-sequence",
            `frame-${String(i + 1).padStart(2, "0")}.png`
          )
        )
      }
    ];
  }
});

// src/probes.ts
import { createConnection } from "node:net";
async function probeStorage() {
  try {
    await storage("HEAD", "");
    return true;
  } catch {
    return false;
  }
}
function probeMail() {
  return new Promise((resolve2) => {
    const socket = createConnection({
      host: config.smtpHost,
      port: config.smtpPort
    });
    socket.setTimeout(3e3);
    const settle2 = (up) => {
      socket.destroy();
      resolve2(up);
    };
    socket.once("data", (greeting) => {
      socket.write("QUIT\r\n");
      settle2(greeting.toString().startsWith("220"));
    });
    socket.once("error", () => settle2(false));
    socket.once("timeout", () => settle2(false));
  });
}
async function probe() {
  const [storageUp, mailUp] = await Promise.all([probeStorage(), probeMail()]);
  state.storage = storageUp;
  state.mail = mailUp;
}
async function readiness() {
  const storage2 = state.storage ? "up" : "down", mail = state.mail ? "up" : "down";
  try {
    await pool.query("SELECT 1");
  } catch {
    return {
      status: 503,
      body: {
        status: "unavailable",
        dependencies: { database: "down", storage: storage2, mail },
        degraded_features: ["everything"]
      }
    };
  }
  const degraded = [
    ...state.storage ? [] : ["applications", "resume_downloads", "samples"],
    ...state.mail ? [] : ["mail_delivery"]
  ].sort();
  return {
    status: 200,
    body: {
      status: degraded.length ? "degraded" : "ready",
      dependencies: { database: "up", storage: storage2, mail },
      degraded_features: degraded
    }
  };
}
var state, serviceState;
var init_probes = __esm({
  "src/probes.ts"() {
    "use strict";
    init_config();
    init_db();
    init_media();
    state = { storage: false, mail: false };
    serviceState = () => ({
      ...state
    });
  }
});

// src/domain.ts
function contentMove(status2, verb) {
  const rule = contentMoves[verb];
  if (!rule || !rule.from.includes(status2)) illegal(status2, rule?.to || verb);
  return rule.to;
}
function stageMove(from, to) {
  const path = {
    submitted: "screening",
    screening: "interview",
    interview: "final_review",
    final_review: "offer"
  };
  if (path[from] === to) return;
  if (activeStage(from) && ["declined", "withdrawn"].includes(to)) return;
  illegal(from, to);
}
function activeStage(stage) {
  return ["submitted", "screening", "interview", "final_review"].includes(
    stage
  );
}
function benefitsInForce(entries, region) {
  return entries.filter((e) => e.region === region && e.effective_from <= londonDate()).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] || null;
}
function londonInstant(local, future = true) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(local))
    validation({ release_at_local: "Use the form YYYY-MM-DDTHH:mm." });
  const complete = local.length === 16 ? local + ":00" : local;
  const naive = Date.parse(complete + "Z");
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 19) !== complete)
    validation({ release_at_local: "Use the form YYYY-MM-DDTHH:mm." });
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const candidates = [naive - 36e5, naive].filter(
    (t) => Number.isFinite(t) && fmt.format(new Date(t)).replace(" ", "T") === complete
  );
  if (!candidates.length)
    validation({
      release_at_local: "That time does not exist in London because the clocks go forward."
    });
  const instant = Math.min(...candidates);
  if (future && instant <= Date.now())
    validation({ release_at_local: "Choose a time in the future." });
  return new Date(instant).toISOString().replace(".000Z", "Z");
}
function readableBody(c) {
  return c.body.replace(
    /\[claim:(c\d+)\]/g,
    (_, id2) => c.claims?.find((x) => x.id === id2)?.text || ""
  ).replace(/^## /gm, "");
}
function readTime(c) {
  return Math.max(
    1,
    Math.ceil(readableBody(c).trim().split(/\s+/).filter(Boolean).length / 225)
  );
}
function claimNumbers(text, names) {
  let masked = text;
  for (const name of names.filter(Boolean))
    masked = masked.split(name).join(" ".repeat(name.length));
  masked = masked.replace(
    /\d{4}-\d{2}-\d{2}/g,
    (date2) => " ".repeat(date2.length)
  );
  return [...masked.matchAll(/\d+(?:\.\d+)?/g)].filter((m) => {
    const before = masked[m.index - 1] || "";
    const after = masked[m.index + m[0].length] || "";
    return !new RegExp("\\p{L}", "u").test(before) && !new RegExp("\\p{L}", "u").test(after);
  }).map((m) => ({ value: m[0], index: m.index }));
}
function difference(model, comparator) {
  const decimals = Math.max(
    model.split(".")[1]?.length || 0,
    comparator.split(".")[1]?.length || 0
  );
  const power = 10 ** decimals;
  const value = (Math.round(Number(model) * power) - Math.round(Number(comparator) * power)) / power;
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}`;
}
function sections(body) {
  return [...body.matchAll(/^## (.+)$/gm)].map((m, i) => ({
    id: `section-${i + 1}`,
    heading: m[1]
  }));
}
function claimOrder(c) {
  const ids = [...c.body.matchAll(/\[claim:(c\d+)\]/g)].map((m) => m[1]);
  return [...new Set(ids)].map((id2) => c.claims?.find((x) => x.id === id2)).filter((v) => !!v);
}
function validateClaims(c, rows) {
  const fields = {};
  const results = [];
  for (const marker of c.body.matchAll(/\[claim:(c\d+)\]/g))
    if (!c.claims?.some((x) => x.id === marker[1]))
      fields.body = `The body marks claim ${marker[1]}, which is not defined.`;
  for (const claim of c.claims || []) {
    let reason = "";
    const model = rows.find(
      (r) => r.subject === c.slug && r.benchmark === claim.benchmark && r.eval_date === claim.eval_date
    );
    const comparator = rows.find(
      (r) => r.subject === claim.comparator && r.benchmark === claim.benchmark && r.eval_date === claim.eval_date
    );
    if (!c.body.includes(`[claim:${claim.id}]`))
      reason = `Claim ${claim.id} is not marked in the body.`;
    else if (!model || !comparator)
      reason = `No recorded row for ${!model ? c.slug : claim.comparator} on ${claim.benchmark} at ${claim.eval_date}.`;
    else {
      const delta = difference(model.score, comparator.score);
      if (Number(claim.stated_delta) !== Number(delta))
        reason = `Stated difference ${claim.stated_delta} does not match the recorded difference ${delta}.`;
      else {
        const allowed = [
          Number(model.score),
          Number(comparator.score),
          Math.abs(Number(delta))
        ];
        const stray = claimNumbers(claim.text, [
          c.title,
          ...Object.values(comparators).map((x) => x.name),
          claim.benchmark
        ]).find((n) => !allowed.includes(Number(n.value)));
        if (stray)
          reason = `The number ${stray.value} in the claim text does not match the cited rows.`;
      }
    }
    if (reason) fields[claim.id] = reason;
    results.push({ claim: claim.id, ok: !reason, reason });
  }
  return { fields, results };
}
function validName(value) {
  return withinLength(value, 120) && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(value);
}
function validEmail(value) {
  const email2 = value.trim();
  const [local, domain, ...rest] = email2.split("@");
  return email2.length <= 254 && !rest.length && domain !== void 0 && local.length > 0 && domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".") && !/[\r\n,; "<>\u0000-\u001f\u007f]/.test(email2);
}
function validSlug(slug) {
  return slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
function requisitionMove(from, to) {
  if (!(from === "draft" && to === "open" || from === "open" && to === "closed"))
    illegal(from, to);
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}
function validScore(score) {
  return /^\d+(?:\.\d{1,2})?$/.test(score) && Number(score) >= 0 && Number(score) <= 100;
}
var subjects, offices, regions, comparators, stageLabels, contentMoves, grantActive, londonDate, signedStatus, emptyReleaseRecord, codePoints, withinLength, normalizeEmail;
var init_domain = __esm({
  "src/domain.ts"() {
    "use strict";
    init_errors();
    subjects = {
      research: "Research",
      safety: "Safety",
      policy: "Policy",
      company: "Company"
    };
    offices = {
      london: { label: "London", region: "uk" },
      edinburgh: { label: "Edinburgh", region: "uk" },
      zurich: { label: "Zurich", region: "europe" },
      toronto: { label: "Toronto", region: "north-america" }
    };
    regions = {
      uk: "United Kingdom",
      europe: "Europe",
      "north-america": "North America"
    };
    comparators = {
      "halvard-3": { name: "Halvard 3", organisation: "Brightline AI" },
      "morrow-l": { name: "Morrow L", organisation: "Teague Systems" }
    };
    stageLabels = {
      submitted: "Submitted",
      screening: "Screening",
      interview: "Interview",
      final_review: "Final review",
      offer: "Offer",
      declined: "Not progressing",
      withdrawn: "Withdrawn"
    };
    contentMoves = {
      submit: { from: ["draft", "returned"], to: "in_review" },
      return: { from: ["in_review"], to: "returned" },
      approve: { from: ["in_review"], to: "approved" },
      schedule: { from: ["approved"], to: "scheduled" },
      release: { from: ["scheduled"], to: "published" },
      withdraw: { from: ["scheduled", "published"], to: "withdrawn" }
    };
    grantActive = (g) => !g.revoked_at && Date.parse(g.granted_at) <= Date.now() && Date.parse(g.expires_at) > Date.now();
    londonDate = () => new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(/* @__PURE__ */ new Date());
    signedStatus = (r) => r.safety && r.legal ? "signed" : r.safety ? "safety_signed" : r.legal ? "legal_signed" : "open";
    emptyReleaseRecord = () => ({
      status: "open",
      safety: null,
      legal: null,
      claims_validated_at: null,
      cleared_by: null,
      cleared_at: null,
      last_validation: null
    });
    codePoints = (value) => [...value.trim()].length;
    withinLength = (value, max) => codePoints(value) >= 1 && codePoints(value) <= max;
    normalizeEmail = (value) => value.trim().toLowerCase();
  }
});

// src/public.ts
async function published(asOf) {
  return (await pool.query(
    "SELECT c.data FROM content c JOIN publication_history h ON h.content_id=c.id WHERE c.status='published' AND h.withdrawn_at IS NULL AND ($1::timestamptz IS NULL OR h.published_at<=$1::timestamptz) ORDER BY h.published_at DESC,c.slug",
    [asOf ?? null]
  )).rows.map((r) => r.data);
}
function parseAsOf(value) {
  if (value === null) return null;
  const valid = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) + "Z" === value && Date.parse(value) <= Date.now();
  if (!valid)
    validation({
      as_of: "Choose a past instant in the form YYYY-MM-DDTHH:mm:ssZ."
    });
  return value;
}
async function publicContent(kind, slug, asOf) {
  const item = (await pool.query(
    "SELECT c.data, h.content_id IS NOT NULL AS ever FROM content c LEFT JOIN publication_history h ON h.content_id=c.id WHERE c.kind=$1 AND c.slug=$2",
    [kind, slug]
  )).rows[0];
  if (item?.data.status === "withdrawn" && item.ever)
    fail(410, "gone", "This item has been withdrawn.");
  if (!item || item.data.status !== "published" || asOf && Date.parse(item.data.published_at) > Date.parse(asOf))
    publicNotFound();
  return item.data;
}
async function homeData() {
  const items = await published();
  return {
    theses,
    rail: items.sort(
      (a, b) => b.published_at.localeCompare(a.published_at) || (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "model" ? -1 : 1)
    ).slice(0, 5).map((c) => ({
      kind: c.kind,
      slug: c.slug,
      title: c.title,
      published_at: c.published_at,
      url: `/${c.kind === "model" ? "models" : "news"}/${c.slug}`
    }))
  };
}
async function modelsData(asOf) {
  return {
    ...asOfKey(asOf),
    items: (await published(asOf)).filter((c) => c.kind === "model").map((c) => ({
      slug: c.slug,
      title: c.title,
      summary: c.summary,
      published_at: c.published_at
    }))
  };
}
async function modelData(slug, asOf) {
  const c = await publicContent("model", slug, asOf);
  const allRows = (await all(pool, "benchmark_rows")).map(
    (r) => ({
      id: r.id,
      subject: r.subject,
      subject_name: r.subject === slug ? c.title : comparators[r.subject]?.name || r.subject,
      organisation: r.subject === slug ? "Aldermoor Labs" : comparators[r.subject]?.organisation || "",
      benchmark: r.benchmark,
      eval_date: r.eval_date,
      score: r.score
    })
  );
  const own = allRows.filter((r) => r.subject === slug);
  const rows = own.sort(
    (a, b) => a.benchmark.localeCompare(b.benchmark) || a.eval_date.localeCompare(b.eval_date)
  ).flatMap((r) => [
    r,
    ...allRows.filter(
      (other) => comparators[other.subject] && other.benchmark === r.benchmark && other.eval_date === r.eval_date
    ).sort((a, b) => a.subject_name.localeCompare(b.subject_name))
  ]);
  const claims = claimOrder(c).map((claim, i) => {
    const model = rows.find(
      (r) => r.subject === slug && r.benchmark === claim.benchmark && r.eval_date === claim.eval_date
    );
    const comparator = rows.find(
      (r) => r.subject === claim.comparator && r.benchmark === claim.benchmark && r.eval_date === claim.eval_date
    );
    return {
      id: claim.id,
      number: i + 1,
      text: claim.text,
      benchmark: claim.benchmark,
      eval_date: claim.eval_date,
      model_row_id: model.id,
      comparator_row_id: comparator.id,
      delta: difference(model.score, comparator.score)
    };
  });
  const hasSamples = slug === sampleRoute;
  const available = !hasSamples || serviceState().storage;
  const linked = (await published(asOf)).find(
    (n) => n.kind === "news" && n.slug === c.linked_news_slug
  );
  return {
    slug,
    title: c.title,
    summary: c.summary,
    published_at: c.published_at,
    read_time_minutes: c.read_time_minutes,
    organisation: "Aldermoor Labs",
    sections: sections(c.body),
    body: c.body,
    claims,
    rows,
    samples: hasSamples && available ? sampleDefinitions : [],
    ...!available ? { samples_available: false } : {},
    linked_news: linked ? { slug: linked.slug, title: linked.title } : null,
    ...asOfKey(asOf)
  };
}
async function newsData(slug, asOf) {
  const c = await publicContent("news", slug, asOf);
  const linked = (await published(asOf)).find(
    (m) => m.kind === "model" && m.linked_news_slug === slug
  );
  return {
    slug: c.slug,
    title: c.title,
    summary: c.summary,
    subject: c.subject,
    tags: c.tags,
    published_at: c.published_at,
    read_time_minutes: c.read_time_minutes,
    body: c.body,
    linked_model: linked ? { slug: linked.slug, title: linked.title } : null,
    ...asOfKey(asOf)
  };
}
async function newsroomData(query) {
  const asOf = parseAsOf(query.get("as_of"));
  const posts = (await published(asOf)).filter((c) => c.kind === "news");
  const subject = query.get("subject"), tag = query.get("tag");
  const tagged = posts.filter((c) => !tag || c.tags?.includes(tag));
  const subjected = posts.filter((c) => !subject || c.subject === subject);
  const match = posts.filter(
    (c) => (!subject || c.subject === subject) && (!tag || c.tags?.includes(tag))
  );
  const p = query.get("page") || "";
  const page = /^[1-9]\d*$/.test(p) ? Number(p) : 1;
  return {
    items: match.slice((page - 1) * 10, page * 10).map((c) => ({
      slug: c.slug,
      title: c.title,
      summary: c.summary,
      subject: c.subject,
      tags: c.tags,
      published_at: c.published_at,
      read_time_minutes: c.read_time_minutes
    })),
    facets: {
      subjects: Object.entries(subjects).map(([value, label]) => ({
        value,
        label,
        count: tagged.filter((c) => c.subject === value).length
      })),
      tags: [...new Set(posts.flatMap((c) => c.tags || []))].sort().map((value) => ({
        value,
        count: subjected.filter((c) => c.tags?.includes(value)).length
      }))
    },
    page,
    pages: Math.max(1, Math.ceil(match.length / 10)),
    total: match.length,
    ...asOfKey(asOf)
  };
}
function publicRole(r) {
  const office = offices[r.office];
  return {
    slug: r.slug,
    title: r.title,
    discipline: r.discipline,
    office: r.office,
    office_label: office.label,
    region: office.region,
    region_label: regions[office.region],
    opened_at: r.opened_at
  };
}
async function rolesData(query) {
  return {
    items: (await all(pool, "requisitions")).filter((r) => r.status === "open").map(publicRole).filter(
      (r) => ["discipline", "office", "region"].every(
        (key) => !query.get(key) || r[key] === query.get(key)
      )
    ).sort(
      (a, b) => b.opened_at.localeCompare(a.opened_at) || a.title.localeCompare(b.title)
    )
  };
}
async function roleData(slug) {
  const r = (await pool.query(
    "SELECT data FROM requisitions WHERE slug=$1",
    [slug]
  )).rows[0]?.data;
  if (!r || r.status === "draft") publicNotFound();
  if (r.status === "closed") fail(410, "gone", "This role has closed.");
  const role = publicRole(r);
  return {
    ...role,
    description: r.description,
    benefits: benefitsShape(
      benefitsInForce(await all(pool, "benefits"), role.region)
    )
  };
}
async function benefitsData() {
  const entries = await all(pool, "benefits");
  return {
    regions: Object.entries(regions).map(([region, label]) => ({
      region,
      label,
      entry: benefitsShape(benefitsInForce(entries, region))
    }))
  };
}
async function feed() {
  const origin = config.publicBaseUrl;
  const posts = (await published()).filter((c) => c.kind === "news");
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${xmlEscape(origin)}/feed.xml</id><title>Aldermoor Labs Open Record</title><updated>${posts[0]?.published_at || "2026-01-01T00:00:00Z"}</updated>${posts.map((c) => `<entry><id>${xmlEscape(origin)}/news/${c.slug}</id><title>${xmlEscape(c.title)}</title><link href="${xmlEscape(origin)}/news/${c.slug}"/><updated>${c.published_at}</updated><summary>${xmlEscape(c.summary)}</summary></entry>`).join("")}</feed>`;
}
async function sitemap() {
  const origin = config.publicBaseUrl;
  const paths = [
    "/",
    "/models",
    "/news",
    "/search",
    "/careers",
    ...(await published()).map(
      (c) => `/${c.kind === "model" ? "models" : "news"}/${c.slug}`
    ),
    ...(await rolesData(new URLSearchParams())).items.map(
      (r) => `/careers/${r.slug}`
    )
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${xmlEscape(origin + path)}</loc></url>`).join("")}</urlset>`;
}
var asOfKey, benefitsShape, xmlEscape;
var init_public = __esm({
  "src/public.ts"() {
    "use strict";
    init_db();
    init_errors();
    init_config();
    init_probes();
    init_domain();
    init_media();
    init_seed();
    asOfKey = (asOf) => asOf ? { as_of: asOf } : {};
    benefitsShape = (e) => e && { id: e.id, effective_from: e.effective_from, summary: e.summary };
    xmlEscape = (v) => v.replace(
      /[<>&"']/g,
      (c) => ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;"
      })[c]
    );
  }
});

// src/html.ts
function formatTime(value, zone = "Europe/London") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));
  return parts.replace(" at", ",").replace(/,\s*,/, ",");
}
function input(label, name, value = "", options = {}) {
  const key = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return `<label class="field" for="${key}"><span>${esc(label)}</span>${options.textarea ? `<textarea aria-label="${esc(label)}" id="${key}" name="${esc(name)}" rows="${name === "body" ? 12 : 4}">${esc(value)}</textarea>` : `<input aria-label="${esc(label)}" id="${key}" name="${esc(name)}" type="${options.type || "text"}" value="${esc(value)}"${options.required ? " required" : ""}>`}${options.hint ? `<small>${esc(options.hint)}</small>` : ""}<span class="field-error" id="error-${key}" data-error="${esc(name)}">${esc(options.error || "")}</span></label>`;
}
function select(label, name, options, value = "", emptyLabel) {
  return `<label class="field" for="field-${name}"><span>${esc(label)}</span><select id="field-${name}" name="${esc(name)}">${emptyLabel !== void 0 ? `<option value="">${esc(emptyLabel)}</option>` : ""}${options.map(([v, t]) => `<option value="${esc(v)}"${value === v ? " selected" : ""}>${esc(t)}</option>`).join("")}</select><span class="field-error" data-error="${esc(name)}"></span></label>`;
}
function dialog(id2, title, body, safe = "Cancel", safeAction) {
  return `<dialog id="${id2}" aria-labelledby="${id2}-title"><h2 id="${id2}-title">${esc(title)}</h2>${body}${safeAction ? `<form method="get" action="${esc(safeAction)}"><button type="submit" data-close-dialog autofocus>${esc(safe)}</button></form>` : `<button type="button" data-close-dialog${safe === "Keep my application" ? " autofocus" : ""}>${esc(safe)}</button>`}</dialog>`;
}
function sectionNav(items) {
  const links = items.map(
    (s, i) => `<a href="#${esc(s.id)}"${i ? "" : ' aria-current="location"'}>${esc(s.heading)}</a>`
  ).join("");
  return `<aside class="section-rail"><details open><summary>Sections</summary><nav aria-label="Sections">${links}</nav></details></aside>`;
}
async function layout(title, main, options = {}) {
  const models = (await modelsData()).items;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} \xB7 Aldermoor Labs</title><link rel="stylesheet" href="/style.css"><link rel="preload" href="/fonts/newsreader-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin><script src="/browser.js" type="module"></script></head><body${options.console ? ' class="console-page"' : ""}><a class="skip" href="#content">Skip to content</a><header class="site-header sheet"><div class="wordmark">Aldermoor<span>Labs / Open Record</span></div><button class="mobile-menu" type="button" aria-expanded="false" data-menu>Menu</button><nav class="primary" aria-label="Primary"><a href="/"${options.active === "thesis" ? ' aria-current="page"' : ""}>Thesis</a><div class="models-disclosure"><button type="button" data-models aria-expanded="false">Models ${icon("chevron")}</button><div class="models-menu" hidden></div><template data-models-list>${models.map((m) => `<a href="/models/${esc(m.slug)}">${esc(m.title)}</a>`).join("")}<a href="/models">All model routes</a></template><noscript><div>${models.map((m) => `<a href="/models/${esc(m.slug)}">${esc(m.title)}</a>`).join("")}</div></noscript></div><a href="/news"${options.active === "news" ? ' aria-current="page"' : ""}>Newsroom</a><a href="/search"${options.active === "search" ? ' aria-current="page"' : ""}>Search</a><a href="/careers"${options.active === "careers" ? ' aria-current="page"' : ""}>Careers</a></nav></header>${options.console ? `<div class="console-bar sheet"><nav aria-label="Console"><a href="/console">Work queue</a>${options.staff?.roles.some((r) => ["editor", "approver"].includes(r.role)) ? '<a href="/console/rows">Benchmark rows</a>' : ""}${options.staff?.roles.some((r) => r.role === "recruiter") ? '<a href="/console/requisitions">Requisitions</a><a href="/console/benefits">Benefits</a>' : ""}${options.staff?.roles.some((r) => r.role === "administrator") ? '<a href="/console/grants">Grants</a><a href="/console/audit">Audit record</a><a href="/console/jobs">Jobs</a>' : ""}</nav><div class="identity">${esc(options.staff?.name)}<button type="button" data-signout>Sign out</button></div></div><div class="sheet service-status">${status("Service status", serviceNotice(serviceState()))}</div>` : ""}<main id="content" class="sheet" tabindex="-1">${main}</main><footer class="site-footer sheet"><span>Aldermoor Labs <span class="footer-note">A Corvane Group research lab</span></span><div><a href="/feed.xml">Feed</a><a href="/console/sign-in">Staff sign-in</a></div></footer></body></html>`;
}
var esc, publication, date, status, icon, emptyDrawing, serviceNotice, asOfBanner;
var init_html = __esm({
  "src/html.ts"() {
    "use strict";
    init_public();
    init_probes();
    esc = (v) => String(v ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
    publication = (value) => `<time class="publication" datetime="${esc(value)}" data-publication="${esc(value)}">Published ${formatTime(value)} London</time>`;
    date = (value) => new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/London"
    }).format(new Date(value));
    status = (name, text = "") => `<div role="status" aria-live="polite" aria-label="${esc(name)}" class="status">${esc(text)}</div>`;
    icon = (name) => `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${name === "chevron" ? '<path d="m6 9 6 6 6-6"/>' : name === "play" ? '<path d="m6 3 14 9-14 9V3Z"/>' : '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'}</svg>`;
    emptyDrawing = () => '<svg class="empty-ledger" aria-hidden="true" width="80" height="40" viewBox="0 0 80 40"><path d="M0 1h80M0 20h80M0 39h80M18 1v38" fill="none" stroke="currentColor" stroke-width="1"/><path d="M29 20h25" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    serviceNotice = (state2) => [
      state2.mail ? "" : "Mail delivery is delayed. Messages are queued and will be sent when mail returns.",
      state2.storage ? "" : "File storage is unreachable. Applications, r\xE9sum\xE9 downloads and samples are paused."
    ].filter(Boolean).join(" ");
    asOfBanner = (asOf, path) => asOf ? `<section class="as-of" aria-label="Record as of"><p>You are reading the record as it stood at ${formatTime(asOf)} London.</p><a href="${esc(path)}">Read the current record</a></section>` : "";
  }
});

// src/search.ts
async function index(db, kind, slug, fields, publishedAt) {
  await db.query(
    `INSERT INTO search_documents(kind,slug,title,summary,body,published_at,document)
     VALUES($1,$2,$3,$4,$5,$6,setweight(to_tsvector('english',$3),'A')||setweight(to_tsvector('english',$4),'B')||setweight(to_tsvector('english',$5),'C'))
     ON CONFLICT(kind,slug) DO UPDATE SET title=$3,summary=$4,body=$5,published_at=$6,document=EXCLUDED.document`,
    [kind, slug, fields.title, fields.summary, fields.body, publishedAt]
  );
}
async function unindex(db, kind, slug) {
  await db.query("DELETE FROM search_documents WHERE kind=$1 AND slug=$2", [
    kind,
    slug
  ]);
}
function decodeCursor(value) {
  try {
    const c = JSON.parse(Buffer.from(value, "base64url").toString());
    return [c.q, c.r, c.p, c.s, c.t].every((v) => typeof v === "string") ? c : null;
  } catch {
    return null;
  }
}
async function highlights(rows, q) {
  const query = (await pool.query(
    "SELECT querytree(websearch_to_tsquery('english',$1)) AS tree",
    [q]
  )).rows[0].tree;
  const wanted = new Set(
    [...query.matchAll(/(!?)'((?:[^']|'')+)'/g)].filter((m) => !m[1]).map((m) => m[2].replaceAll("''", "'"))
  );
  const split = (text) => text.split(/\s+/).filter(Boolean);
  const words = [
    ...new Set(rows.flatMap((r) => [...split(r.summary), ...split(r.body)]))
  ];
  const stems = /* @__PURE__ */ new Map();
  if (words.length) {
    const lexed = await pool.query(
      "SELECT word, tsvector_to_array(to_tsvector('english',word)) AS lexemes FROM unnest($1::text[]) AS word",
      [words]
    );
    for (const row of lexed.rows) stems.set(row.word, row.lexemes);
  }
  const matched = (word) => (stems.get(word) || []).some((l) => wanted.has(l));
  return rows.map((row) => {
    const fields = [split(row.summary), split(row.body)];
    const scored = fields.map((f) => f.filter(matched).length);
    const best = scored[1] > scored[0] ? 1 : 0;
    if (!scored[best])
      return (fields[0].length ? fields[0] : fields[1]).slice(0, 30).map(esc).join(" ");
    const field = fields[best];
    let start = 0, most = -1;
    for (let i = 0; i < Math.max(1, field.length - 29); i++) {
      const count = field.slice(i, i + 30).filter(matched).length;
      if (count > most) {
        most = count;
        start = i;
      }
    }
    return field.slice(start, start + 30).map((w) => matched(w) ? `<mark>${esc(w)}</mark>` : esc(w)).join(" ");
  });
}
async function searchData(query) {
  const q = (query.get("q") || "").trim();
  const kind = query.get("kind") || null;
  const limitText = query.get("limit");
  const fields = {};
  if (!q || codePoints(q) > 200)
    fields.q = "Enter between 1 and 200 characters.";
  const limit = limitText === null ? 10 : Number(limitText);
  if (!/^\d+$/.test(limitText ?? "10") || limit < 1 || limit > 50)
    fields.limit = "Choose a limit from 1 to 50.";
  const cursorText = query.get("cursor");
  const cursor = cursorText ? decodeCursor(cursorText) : null;
  if (cursorText && (!cursor || cursor.q !== q || cursor.k !== kind))
    fields.cursor = "This cursor does not belong to this search.";
  if (Object.keys(fields).length) validation(fields);
  if (kind !== null && !Object.hasOwn(kinds, kind))
    return { query: q, kind, items: [], next_cursor: null };
  const rows = (await pool.query(
    `WITH matches AS (
         SELECT kind,slug,title,summary,body,published_at,ts_rank(document,websearch_to_tsquery('english',$8))::real AS rank
         FROM search_documents
         WHERE document @@ websearch_to_tsquery('english',$1) AND ($2::text IS NULL OR kind=$2))
       SELECT kind,slug,title,summary,body,published_at,rank::text AS rank FROM matches
       WHERE $3::real IS NULL OR rank<$3::real OR (rank=$3::real AND (published_at<$4::timestamptz
         OR (published_at=$4::timestamptz AND (slug>$5 OR (slug=$5 AND kind>$6)))))
       ORDER BY rank DESC,published_at DESC,slug,kind LIMIT $7`,
    [
      q,
      kind,
      cursor?.r ?? null,
      cursor?.p ?? null,
      cursor?.s ?? null,
      cursor?.t ?? null,
      limit + 1,
      rankedTerms(q)
    ]
  )).rows;
  const page = rows.slice(0, limit);
  const marked = await highlights(page, q);
  const items = page.map((r, i) => ({
    kind: r.kind,
    slug: r.slug,
    title: r.title,
    url: kinds[r.kind] + r.slug,
    published_at: r.published_at.toISOString(),
    rank: Number(r.rank),
    highlight: marked[i]
  }));
  const last = page[page.length - 1];
  return {
    query: q,
    kind,
    items,
    next_cursor: rows.length > limit ? encodeCursor({
      q,
      k: kind,
      r: last.rank,
      p: last.published_at.toISOString(),
      s: last.slug,
      t: last.kind
    }) : null
  };
}
var kinds, indexContent, indexRole, encodeCursor, rankedTerms;
var init_search = __esm({
  "src/search.ts"() {
    "use strict";
    init_db();
    init_errors();
    init_html();
    init_domain();
    kinds = { model: "/models/", news: "/news/", role: "/careers/" };
    indexContent = (db, c) => index(
      db,
      c.kind,
      c.slug,
      { title: c.title, summary: c.summary, body: readableBody(c) },
      c.published_at
    );
    indexRole = (db, r) => index(
      db,
      "role",
      r.slug,
      { title: r.title, summary: "", body: r.description.replace(/^## /gm, "") },
      r.opened_at
    );
    encodeCursor = (c) => Buffer.from(JSON.stringify(c)).toString("base64url");
    rankedTerms = (q) => q.replace(/(^|\s)-("[^"]*"|\S+)/g, " ").trim() || q;
  }
});

// src/seed.ts
async function seed() {
  await transaction(async (db) => {
    await advisory(db, "seed");
    if ((await db.query("SELECT 1 FROM staff LIMIT 1")).rowCount) return;
    const publish = async (c) => {
      if (c.status === "scheduled")
        await db.query(
          "INSERT INTO embargo_schedules(content_id,release_at,scheduled_by) VALUES($1,$2,$3)",
          [c.id, c.release_at, eleni]
        );
      if (c.status !== "published") return;
      await db.query(
        "INSERT INTO publication_history(content_id,published_at) VALUES($1,$2)",
        [c.id, c.published_at]
      );
      await indexContent(db, c);
    };
    const people = [
      ["Ines Halloran", ines, ["editor"]],
      ["Tomas Reyes", tomas, ["editor", "approver"]],
      ["Eleni Marsh", eleni, ["approver"]],
      ["Kofi Brennan", kofi, ["approver"]],
      ["Sana Qadir", sana, ["recruiter"]],
      ["Jules Okonkwo", jules, ["recruiter"]],
      ["Ada Penrose", ada, ["administrator"]],
      ["Noor Vance", email("noor.vance"), []]
    ];
    for (const [name, mail, roles] of people) {
      await db.query(
        "INSERT INTO staff(email,name,password_hash) VALUES($1,$2,$3)",
        [mail, name, seedPasswordDigest]
      );
      for (const role of roles) {
        const g = {
          id: id(),
          staff_email: mail,
          role,
          granted_by: ada,
          granted_at: "2026-01-01T00:00:00Z",
          expires_at: "2027-12-31T23:59:59Z",
          revoked_at: null,
          revoked_by: null,
          version: 1
        };
        await saveGrant(db, g);
      }
    }
    const models = [
      {
        id: id(),
        kind: "model",
        slug: "kestrel-2",
        title: "Kestrel 2",
        summary: "Our second general research model, built for long, careful reading.",
        body: "## What Kestrel 2 is\nKestrel 2 is our second general research model, trained for long, careful reading and multi-step reasoning. [claim:c1]\n\n## How we evaluated it\nEvery score on this page comes from a recorded evaluation row with its date. We ran each comparator ourselves on the same harness on the same day. [claim:c2]\n\n## Where it falls short\nOn CodeTrace, Kestrel 2 trails Morrow L. We publish that row beside the others.",
        subject: null,
        tags: null,
        claims: [
          {
            id: "c1",
            text: "On ReasonBench-Hard, Kestrel 2 scores 71.4, 3.2 points above Halvard 3.",
            benchmark: "ReasonBench-Hard",
            eval_date: "2026-09-14",
            comparator: "halvard-3",
            stated_delta: "3.2"
          },
          {
            id: "c2",
            text: "On LongDoc-QA, Kestrel 2 scores 84.9, 4.3 points above Halvard 3.",
            benchmark: "LongDoc-QA",
            eval_date: "2026-09-14",
            comparator: "halvard-3",
            stated_delta: "4.3"
          }
        ],
        linked_news_slug: "introducing-kestrel-2",
        status: "published",
        version: 1,
        author: tomas,
        comments: [],
        release_at: "2026-09-30T08:00:00Z",
        release_at_local: "2026-09-30T09:00",
        published_at: "2026-09-30T08:00:00Z",
        read_time_minutes: 1
      },
      {
        id: id(),
        kind: "model",
        slug: "kestrel-1",
        title: "Kestrel 1",
        summary: "Our first research model and the baseline for everything since.",
        body: "## What Kestrel 1 was\nKestrel 1 was our first general research model. Its recorded row remains here as the baseline for the work that followed.",
        subject: null,
        tags: null,
        claims: [],
        linked_news_slug: null,
        status: "published",
        version: 1,
        author: tomas,
        comments: [],
        release_at: null,
        release_at_local: null,
        published_at: "2026-03-12T10:00:00Z",
        read_time_minutes: 1
      },
      {
        id: id(),
        kind: "model",
        slug: "wren-1",
        title: "Wren 1",
        summary: "A research model for careful investigation.",
        body: "## What Wren 1 is\nWren 1 brings our ongoing research into a new model route. Its evidence and release decision will be published together.",
        subject: null,
        tags: null,
        claims: [],
        linked_news_slug: "introducing-wren-1",
        status: "scheduled",
        version: 1,
        author: ines,
        comments: [],
        release_at: londonInstant("2030-01-15T09:00", false),
        release_at_local: "2030-01-15T09:00",
        published_at: null,
        read_time_minutes: null
      },
      {
        id: id(),
        kind: "model",
        slug: "kestrel-3",
        title: "Kestrel 3",
        summary: "The next Kestrel research model, under review.",
        body: "## What Kestrel 3 is\n[claim:c1]",
        subject: null,
        tags: null,
        claims: [
          {
            id: "c1",
            text: "On ReasonBench-Hard, Kestrel 3 scores 76.0, 6.9 points above Halvard 3.",
            benchmark: "ReasonBench-Hard",
            eval_date: "2026-10-20",
            comparator: "halvard-3",
            stated_delta: "6.9"
          }
        ],
        linked_news_slug: null,
        status: "draft",
        version: 1,
        author: ines,
        comments: [],
        release_at: null,
        release_at_local: null,
        published_at: null,
        read_time_minutes: null
      }
    ];
    for (const c of models) {
      if (c.status === "published") c.read_time_minutes = readTime(c);
      const signoffDay = c.slug === "kestrel-1" ? "2026-03-10" : "2026-09-25";
      await saveContent(db, c);
      await publish(c);
      const record = emptyReleaseRecord();
      if (["published", "scheduled"].includes(c.status)) {
        record.status = "cleared";
        record.safety = {
          by: eleni,
          at: `${signoffDay}T10:00:00Z`,
          note: "Safety review recorded."
        };
        record.legal = {
          by: kofi,
          at: `${signoffDay}T11:00:00Z`,
          note: "Legal review recorded."
        };
        record.claims_validated_at = `${signoffDay}T12:30:00Z`;
        record.cleared_by = eleni;
        record.cleared_at = `${signoffDay}T13:00:00Z`;
      }
      await saveRecord(db, c.id, record);
    }
    const posts = [
      [
        "introducing-kestrel-2",
        "Introducing Kestrel 2",
        "research",
        ["evaluations", "release-notes"],
        "2026-09-30T09:00",
        "Kestrel 2 brings long, careful reading to our second general research model. Its model route records the evaluations, comparisons and limitations behind this release."
      ],
      [
        "how-we-sign-off-a-release",
        "How we sign off a release",
        "safety",
        ["evaluations", "governance"],
        "2026-08-20T11:00",
        "A release requires separate safety and legal sign-offs. Here is how those decisions become part of the public record."
      ],
      [
        "interpretability-notes-autumn",
        "Interpretability notes, autumn",
        "research",
        ["interpretability"],
        "2026-10-08T14:00",
        "Notes from our continuing work to understand how our models reach an answer, and what remains difficult to explain."
      ],
      [
        "why-every-score-links-to-a-row",
        "Why every score links to a row",
        "policy",
        ["evaluations", "governance"],
        "2026-07-02T10:00",
        "A comparison is useful when its source can be examined. Our recorded rows preserve the model, benchmark and date behind every score."
      ],
      [
        "an-update-on-corvane-group",
        "An update on our work with Corvane Group",
        "company",
        ["partnerships"],
        "2026-06-15T09:30",
        "Aldermoor Labs is the frontier AI research arm of Corvane Group. This record explains the work and the responsibilities we share."
      ],
      [
        "we-are-hiring-research-engineers",
        "We are hiring research engineers",
        "company",
        ["hiring"],
        "2026-10-14T09:00",
        "Help build the measurements that make research claims worth reading. Our open roles bring research, engineering and careful judgement together."
      ],
      [
        "introducing-kestrel-1",
        "Introducing Kestrel 1",
        "research",
        ["release-notes"],
        "2026-03-12T10:00",
        "Our first research model establishes a baseline. We are publishing its recorded result as the starting point for the work that follows."
      ],
      [
        "introducing-wren-1",
        "Introducing Wren 1",
        "research",
        ["release-notes"],
        null,
        "Introducing the next route in our research record."
      ],
      [
        "red-team-findings-q3",
        "Red-team findings, third quarter",
        "safety",
        ["evaluations"],
        null,
        "Our red-team work examines the limits of our models and documents the questions that remain."
      ]
    ];
    for (const [slug, title, subject, tags, local, summary] of posts) {
      const status2 = slug === "introducing-wren-1" ? "scheduled" : local ? "published" : "draft";
      const c = {
        id: id(),
        kind: "news",
        slug,
        title,
        summary,
        body: newsBodies[slug],
        subject,
        tags,
        claims: null,
        linked_news_slug: null,
        status: status2,
        version: 1,
        author: slug === "red-team-findings-q3" ? ines : tomas,
        comments: [],
        release_at: status2 === "scheduled" ? londonInstant("2030-01-15T09:00", false) : local ? londonInstant(local, false) : null,
        release_at_local: status2 === "scheduled" ? "2030-01-15T09:00" : local,
        published_at: local ? londonInstant(local, false) : null,
        read_time_minutes: null
      };
      if (local) c.read_time_minutes = readTime(c);
      await saveContent(db, c);
      await publish(c);
    }
    const data = [
      ["kestrel-2", "ReasonBench-Hard", "2026-09-14", "71.4"],
      ["halvard-3", "ReasonBench-Hard", "2026-09-14", "68.2"],
      ["morrow-l", "ReasonBench-Hard", "2026-09-14", "70.9"],
      ["kestrel-2", "LongDoc-QA", "2026-09-14", "84.9"],
      ["halvard-3", "LongDoc-QA", "2026-09-14", "80.6"],
      ["morrow-l", "LongDoc-QA", "2026-09-14", "85.3"],
      ["kestrel-2", "CodeTrace", "2026-09-14", "58.0"],
      ["morrow-l", "CodeTrace", "2026-09-14", "61.5"],
      ["kestrel-1", "ReasonBench-Hard", "2026-03-01", "62.7"],
      ["kestrel-3", "ReasonBench-Hard", "2026-10-20", "76.0"],
      ["halvard-3", "ReasonBench-Hard", "2026-10-20", "69.1"]
    ];
    for (const [subject, benchmark, eval_date, score] of data) {
      const row = {
        id: id(),
        subject,
        subject_name: comparators[subject]?.name || models.find((c) => c.slug === subject).title,
        organisation: comparators[subject]?.organisation || "Aldermoor Labs",
        benchmark,
        eval_date,
        score,
        source_note: "Recorded laboratory evaluation."
      };
      await saveRow(db, row);
    }
    const requisitions = [
      [
        "research-engineer-evaluations",
        "Research Engineer, Evaluations",
        "research",
        "london",
        "open",
        "2026-10-01",
        [sana]
      ],
      [
        "research-scientist-interpretability",
        "Research Scientist, Interpretability",
        "research",
        "edinburgh",
        "open",
        "2026-09-20",
        [sana]
      ],
      [
        "policy-lead-europe",
        "Policy Lead, Europe",
        "policy",
        "zurich",
        "open",
        "2026-10-10",
        [jules]
      ],
      [
        "infrastructure-engineer-toronto",
        "Infrastructure Engineer",
        "engineering",
        "toronto",
        "open",
        "2026-08-30",
        [jules]
      ],
      [
        "operations-coordinator-london",
        "Operations Coordinator",
        "operations",
        "london",
        "closed",
        "2026-06-01",
        [jules]
      ],
      [
        "research-scientist-alignment",
        "Research Scientist, Alignment",
        "research",
        "london",
        "draft",
        null,
        [sana]
      ]
    ];
    const requisitionDescriptions = {
      "research-engineer-evaluations": "## The work\nYou will design and run the evaluations behind every score we publish. That means building the harness that runs Kestrel and each comparator on the same day, recording every result as a dated row, and writing the evaluation notes a sceptical reader needs to check our claims.\n\n## What you will bring\nSeveral years of research engineering in Python or TypeScript, care with statistics, and the habit of asking what a benchmark actually measures. Experience maintaining a shared evaluation suite is welcome; so is having found a flaw in one.\n\n## Working with us\nThe team sits in London beside the safety and release groups, so a row you record today may be cited in a sign-off this week.",
      "research-scientist-interpretability": "## The work\nYou will study what our models represent internally and publish what you find, including the results that complicate our own story. Expect to move between small, controlled experiments and the full Kestrel models, and to write notes that readers outside the lab can follow.\n\n## What you will bring\nA research record in interpretability, neuroscience or a neighbouring field, fluency with modern training tooling, and patience with results that take several attempts to pin down.\n\n## Working with us\nThe group works from Edinburgh with a weekly reading session shared with London.",
      "policy-lead-europe": "## The work\nYou will represent Aldermoor Labs to regulators, standards bodies and civil society across Europe, and bring what you hear back into how we release models. You will draft our consultation responses and explain our release record in plain terms.\n\n## What you will bring\nExperience in technology policy or regulation, ideally on the European AI Act or comparable rules, and the ability to translate a technical decision into a public commitment without overstating it. Fluency in English and one further European language.\n\n## Working with us\nThe role is based in Zurich and travels to Brussels and London a few times each quarter.",
      "infrastructure-engineer-toronto": "## The work\nYou will run the systems that keep the open record honest: the databases, storage and job queues behind every publication, and the training clusters our researchers depend on. Reliability here is a public commitment, because an embargo that fires late or twice is visible to everyone.\n\n## What you will bring\nProduction experience with PostgreSQL, object storage and container orchestration, a calm approach to incidents, and clear written postmortems.\n\n## Working with us\nThe team works from Toronto and shares an on-call rotation with London during overlapping hours.",
      "operations-coordinator-london": "## The work\nYou kept the London office running: visitors, equipment, supplier contracts and the logistics of our quarterly research reviews. You were the first person a new colleague met.\n\n## What you will bring\nExperience coordinating a busy office, good judgement about what can wait, and a friendly, precise way of writing.\n\n## Working with us\nThis London role has been filled and is no longer taking applications.",
      "research-scientist-alignment": "## The work\nYou will develop and test methods that keep model behaviour within what we intend and can describe, from training objectives to red-team studies, and you will help decide what a release must show before it ships.\n\n## What you will bring\nA research record in alignment, reinforcement learning or a related area, rigorous experimental habits and a willingness to argue for a delay when the record is not ready.\n\n## Working with us\nThe role is based in London alongside the safety sign-off group."
    };
    for (const [
      slug,
      title,
      discipline,
      office,
      status2,
      opened,
      recruiters
    ] of requisitions) {
      const requisition = {
        id: id(),
        slug,
        title,
        discipline,
        office,
        status: status2,
        opened_at: opened ? `${opened}T08:00:00Z` : null,
        closed_at: status2 === "closed" ? "2026-09-01T08:00:00Z" : null,
        erase_after: status2 === "closed" ? new Date(
          Date.parse("2026-09-01T08:00:00Z") + config.retention * 1e3
        ).toISOString() : null,
        recruiters,
        version: 1,
        description: requisitionDescriptions[slug]
      };
      await saveRequisition(db, requisition);
      if (status2 === "open") await indexRole(db, requisition);
    }
    const entries = [
      [
        "uk",
        "2026-01-01",
        "Private medical cover, 30 days' leave plus bank holidays, 10% pension contribution."
      ],
      [
        "uk",
        "2027-01-01",
        "Private medical cover, 30 days' leave plus bank holidays, 12% pension contribution."
      ],
      [
        "europe",
        "2026-04-01",
        "Supplementary health insurance, 28 days' leave, pension under the local plan."
      ],
      [
        "north-america",
        "2026-07-01",
        "Health, dental and vision cover, 25 days' leave, retirement matching to 6%."
      ]
    ];
    for (const [region, effective_from, summary] of entries) {
      const entry = { id: id(), region, effective_from, summary };
      await saveBenefits(db, entry);
    }
  });
}
var seedPasswordDigest, email, ines, tomas, eleni, kofi, sana, jules, ada, theses, newsBodies;
var init_seed = __esm({
  "src/seed.ts"() {
    "use strict";
    init_db();
    init_config();
    init_search();
    init_domain();
    seedPasswordDigest = "56963d84594c23b4b941295f8c561118:d09006c42159af5efd5c217bc8821ccd0acb97bbc4f8a00499230f3e11c8f093";
    email = (name) => `${name}@aldermoor.example`;
    ines = email("ines.halloran");
    tomas = email("tomas.reyes");
    eleni = email("eleni.marsh");
    kofi = email("kofi.brennan");
    sana = email("sana.qadir");
    jules = email("jules.okonkwo");
    ada = email("ada.penrose");
    theses = [
      {
        number: 1,
        heading: "A claim is only as good as the row beneath it.",
        body: "Progress begins with something another person can examine. We publish the measurement, its date and the comparison behind each claim. Follow a number through this record and you should arrive at the evidence that supports it, including the results that give us pause."
      },
      {
        number: 2,
        heading: "Release is a decision with names on it.",
        body: "A model does not become ready simply because training has ended. Safety and legal review carry separate responsibilities. The people who sign a release put their names to that decision, and the record preserves the distinction between making a model and judging it ready."
      },
      {
        number: 3,
        heading: "Every surface tells the same story at the same moment.",
        body: "An announcement, a model route and its benchmark rows belong to the same public record. An embargo is a promise about when that record can be read. When the time comes, the whole record opens together."
      },
      {
        number: 4,
        heading: "Withdrawal should be as thorough as publication.",
        body: "Sometimes evidence changes what we can stand behind. When we withdraw an item, it leaves the lists, the feed and the index together. Its address carries a clear notice, rather than allowing an old claim to linger without explanation."
      },
      {
        number: 5,
        heading: "Candidates deserve to know where they stand.",
        body: "The care we ask of research also belongs in the way we work with people. Applicants receive a private link to their current stage. Decisions have reasons and an accountable recruiter, while personal details stay out of the public record."
      }
    ];
    newsBodies = {
      "introducing-kestrel-2": "## A model for long reading\nKestrel 2 is our second general research model. It reads long documents carefully and holds a line of reasoning across many steps.\n\n## What the record shows\nEach evaluation behind this release is recorded on the model route, beside the comparators we ran on the same day. The route also records where Kestrel 2 falls short.",
      "how-we-sign-off-a-release": "## Two signatures\nA model route reaches the public only after one safety sign-off and one legal sign-off, each from a different approver who did not write it.\n\n## What the signers read\nThe signers read the route, its claims and every evaluation row the claims cite. The claims are then checked against those rows before anyone can clear the release.",
      "interpretability-notes-autumn": "## Looking inside\nThis autumn we traced how our models carry a question through a long document, and where that thread is lost.\n\n## What remains open\nSome behaviour still resists a clean explanation. We publish these notes so that others can question the methods as well as the findings.",
      "why-every-score-links-to-a-row": "## A number needs a source\nA score without its source asks the reader for trust. On our model routes every score links to the evaluation row it came from.\n\n## What a row holds\nEach row names the model, the benchmark, the date and the score exactly as recorded. Rows are never edited, so a link today leads to the same evidence tomorrow.",
      "an-update-on-corvane-group": "## Our place in Corvane Group\nAldermoor Labs is the frontier research arm of Corvane Group. Our record, our release decisions and our hiring remain our own.\n\n## Shared responsibilities\nCorvane Group supports the lab's infrastructure and operations, and it receives our public record at the same moment as everyone else.",
      "we-are-hiring-research-engineers": "## Join the record team\nWe are looking for research engineers who enjoy careful work and clear writing.\n\n## How to apply\nOpen roles are listed on our careers page. Each application goes to the recruiters for that role, and every applicant receives a private link to follow their progress.",
      "introducing-kestrel-1": "## Our first model\nKestrel 1 is the first general research model from Aldermoor Labs.\n\n## A baseline\nIts recorded result marks where our work began, and later routes are read against it.",
      "introducing-wren-1": "## A new route\nWren 1 joins our record as a new research model.\n\n## Released together\nIts model route and this announcement become public at the same moment.",
      "red-team-findings-q3": "## What we tested\nOur red team spent the third quarter probing the limits of our models.\n\n## What we found\nThis evaluation records the questions that remain open and the changes we made in response."
    };
  }
});

// src/auth.ts
import {
  randomBytes,
  createHash as createHash3,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  hkdfSync
} from "node:crypto";
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}
function passwordMatches(password, stored) {
  const [salt, hex] = stored.split(":");
  const hash2 = scryptSync(password, salt, 32);
  return timingSafeEqual(hash2, Buffer.from(hex, "hex"));
}
async function staffRoles(db, email2) {
  return (await db.query(
    "SELECT data FROM grants WHERE staff_email=$1",
    [email2]
  )).rows.map((r) => r.data).filter(grantActive).map((g) => ({ role: g.role, expires_at: g.expires_at }));
}
async function sessionStaff(req) {
  const cookie = sessionToken(req);
  if (!cookie) return null;
  const r = await pool.query(
    "SELECT s.email,staff.name FROM sessions s JOIN staff ON staff.email=s.email WHERE digest=$1 AND s.expires_at>now()",
    [digest(cookie)]
  );
  const row = r.rows[0];
  return row ? { ...row, roles: await staffRoles(pool, row.email) } : null;
}
async function requireStaff(req) {
  const staff = await sessionStaff(req);
  if (!staff) fail(401, "unauthenticated", "Sign in to continue.");
  return staff;
}
function requireNonAuthor(author, actor) {
  if (author === actor) authorDenied();
}
function requireRole(staff, ...roles) {
  if (!staff.roles.some((x) => roles.includes(x.role))) forbidden();
}
async function signIn(body) {
  const email2 = normalizeEmail(str(body.email));
  const outcome = await transaction(async (db) => {
    await db.query(
      "INSERT INTO signin_failures(email) VALUES($1) ON CONFLICT(email) DO NOTHING",
      [email2]
    );
    const lock = (await db.query(
      "SELECT failures,lock_seconds,CEIL(EXTRACT(EPOCH FROM locked_until-now()))::int AS remaining FROM signin_failures WHERE email=$1 FOR UPDATE",
      [email2]
    )).rows[0];
    if (lock.remaining !== null && lock.remaining > 0)
      return { locked: Math.max(1, lock.remaining) };
    const row = (await db.query(
      "SELECT name,password_hash FROM staff WHERE email=$1",
      [email2]
    )).rows[0];
    const matches = passwordMatches(
      str(body.password),
      row?.password_hash || unknownHash
    );
    if (row && matches) {
      await db.query("DELETE FROM signin_failures WHERE email=$1", [email2]);
      const token = capability();
      await db.query(
        "INSERT INTO sessions(digest,email,expires_at) VALUES($1,$2,now()+make_interval(secs=>$3))",
        [digest(token), email2, config.sessionTtl]
      );
      return {
        staff: { email: email2, name: row.name, roles: await staffRoles(db, email2) },
        token
      };
    }
    const failures = lock.failures + 1;
    const seconds2 = lock.lock_seconds ? Math.min(lock.lock_seconds * 2, config.signinLockout * 8) : failures >= 5 ? config.signinLockout : 0;
    await db.query(
      "UPDATE signin_failures SET failures=$2,lock_seconds=$3,locked_until=CASE WHEN $3::int>0 THEN now()+make_interval(secs=>$3) END WHERE email=$1",
      [email2, failures, seconds2]
    );
    return null;
  });
  if (!outcome)
    fail(
      401,
      "invalid_credentials",
      "That email and password do not match a staff account."
    );
  if ("locked" in outcome) return lockedError(outcome.locked);
  return outcome;
}
async function signOut(req) {
  const cookie = sessionToken(req);
  if (cookie)
    await pool.query("DELETE FROM sessions WHERE digest=$1", [digest(cookie)]);
}
function encryptToken(token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", linkKey, iv);
  const bytes = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
}
function decryptToken(encrypted) {
  const b = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", linkKey, b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([
    decipher.update(b.subarray(28)),
    decipher.final()
  ]).toString("utf8");
}
var digest, capability, sessionToken, sessionCookie, unknownHash, lockedError, linkKey;
var init_auth = __esm({
  "src/auth.ts"() {
    "use strict";
    init_config();
    init_db();
    init_domain();
    init_errors();
    init_domain();
    digest = (token) => createHash3("sha256").update(token).digest("hex");
    capability = () => randomBytes(32).toString("base64url");
    sessionToken = (req) => req.headers.cookie?.split(";").map((x) => x.trim()).find((x) => x.startsWith("aldermoor_session="))?.split("=")[1];
    sessionCookie = (token, age) => `aldermoor_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
    unknownHash = hashPassword(randomBytes(16).toString("hex"));
    lockedError = (seconds2) => fail(
      429,
      "signin_locked",
      `Too many failed sign-ins for this email. Try again in ${seconds2} seconds.`,
      void 0,
      { "Retry-After": String(seconds2) }
    );
    linkKey = Buffer.from(
      hkdfSync("sha256", config.s3SecretKey, "", "aldermoor tracking links", 32)
    );
  }
});

// src/content.ts
function contentFields(input2, current) {
  const kind = current?.kind || input2.kind;
  const sent = (key) => Object.hasOwn(input2, key);
  const text = (key) => str(sent(key) ? input2[key] : current?.[key]).trim();
  const listOf = (key) => !sent(key) ? void 0 : Array.isArray(input2[key]) ? input2[key] : [null];
  return {
    id: current?.id || id(),
    kind: kind === "model" ? "model" : "news",
    slug: text("slug"),
    title: text("title"),
    summary: text("summary"),
    body: text("body"),
    subject: kind === "news" ? str(sent("subject") ? input2.subject : current?.subject) : null,
    tags: kind === "news" ? (listOf("tags") ?? current?.tags ?? []).map(
      (t) => typeof t === "string" ? t.trim() : ""
    ) : null,
    claims: kind === "model" ? (listOf("claims") ?? current?.claims ?? []).map((v) => {
      const x = object(v);
      return {
        id: str(x.id),
        text: str(x.text).trim(),
        benchmark: str(x.benchmark).trim(),
        eval_date: str(x.eval_date),
        comparator: str(x.comparator),
        stated_delta: str(x.stated_delta)
      };
    }) : null,
    linked_news_slug: kind === "model" ? str(
      sent("linked_news_slug") ? input2.linked_news_slug : current?.linked_news_slug
    ).trim() || null : null,
    status: current?.status || "draft",
    version: current?.version || 1,
    author: current?.author || "",
    comments: current?.comments || [],
    release_at: current?.release_at || null,
    release_at_local: current?.release_at_local || null,
    published_at: current?.published_at || null,
    read_time_minutes: current?.read_time_minutes || null
  };
}
async function validateContent(db, c, kind) {
  const fields = {};
  if (kind !== "model" && kind !== "news")
    fields.kind = "Choose model or news.";
  if (!validSlug(c.slug))
    fields.slug = "Use lowercase letters, numbers and single hyphens, up to 80 characters.";
  else if ((await db.query("SELECT 1 FROM content WHERE slug=$1 AND id<>$2", [
    c.slug,
    c.id
  ])).rowCount)
    fields.slug = "That slug is already in use.";
  if (!c.title) fields.title = "Enter a title.";
  if (c.kind === "news" && !Object.hasOwn(subjects, c.subject || ""))
    fields.subject = "Choose research, safety, policy or company.";
  if (c.kind === "news" && (c.tags || []).some((t) => !validSlug(t)))
    fields.tags = "Use lowercase tags of letters, numbers and single hyphens.";
  if (c.kind === "news" && /\[claim:/.test(c.body))
    fields.body = "Claim markers belong on model routes.";
  if (c.kind === "model" && (c.claims || []).some(
    (x) => !/^c\d+$/.test(x.id) || !x.text || !x.benchmark || !validDate(x.eval_date) || !comparators[x.comparator] || !/^[-+]?\d+(?:\.\d{1,2})?$/.test(x.stated_delta)
  ))
    fields.claims = "Each claim needs an id, text, benchmark, evaluation date, comparator and stated difference.";
  if (c.linked_news_slug && !(await db.query("SELECT 1 FROM content WHERE kind='news' AND slug=$1", [
    c.linked_news_slug
  ])).rowCount)
    fields.linked_news_slug = "No news post has that slug.";
  if (Object.keys(fields).length) validation(fields);
}
async function contentBySlug(db, kind, slug, lock = false) {
  return (await db.query(
    `SELECT data FROM content WHERE kind=$1 AND slug=$2${lock ? " FOR UPDATE" : ""}`,
    [kind, slug]
  )).rows[0]?.data;
}
async function publishContent(db, c, actor, instant) {
  const expected = c.version;
  c.status = contentMove(c.status, "release");
  c.published_at = instant;
  c.read_time_minutes = readTime(c);
  c.version++;
  await saveContent(db, c, expected);
  await db.query(
    "INSERT INTO publication_history(content_id,published_at) VALUES($1,$2)",
    [c.id, instant]
  );
  await indexContent(db, c);
  const schedule = (await db.query(
    "DELETE FROM embargo_schedules WHERE content_id=$1 RETURNING scheduled_by",
    [c.id]
  )).rows[0];
  await audit(db, actor, "content.release", "content", c.id, {
    scheduled_by: schedule.scheduled_by
  });
  if (c.kind === "model" && c.linked_news_slug) {
    const post = await contentBySlug(db, "news", c.linked_news_slug, true);
    await publishContent(db, post, actor, instant);
  }
}
async function embargo(db, c, approver) {
  await db.query(
    "INSERT INTO embargo_schedules(content_id,release_at,scheduled_by) VALUES($1,$2,$3)",
    [c.id, c.release_at, approver]
  );
}
async function withdrawContent(db, c, actor, detail = {}) {
  const expected = c.version;
  const wasPublished = c.status === "published";
  c.status = contentMove(c.status, "withdraw");
  c.version++;
  await saveContent(db, c, expected);
  if (wasPublished) {
    await db.query(
      "UPDATE publication_history SET withdrawn_at=now() WHERE content_id=$1",
      [c.id]
    );
    await unindex(db, c.kind, c.slug);
  } else
    await db.query("DELETE FROM embargo_schedules WHERE content_id=$1", [c.id]);
  await audit(db, actor, "content.withdraw", "content", c.id, detail);
}
async function lapsed(db, record) {
  for (const kind of ["safety", "legal"]) {
    const signer = record[kind]?.by;
    if (signer && !await hasApprover(db, signer)) return true;
  }
  return false;
}
async function voidLapsedSignoffs(db, actor, signer) {
  const records = await db.query(
    "SELECT r.id,r.data FROM release_records r JOIN content c ON c.id=r.id WHERE r.data->>'status'<>'cleared' AND (r.data->'safety'<>'null'::jsonb OR r.data->'legal'<>'null'::jsonb) ORDER BY r.id FOR UPDATE OF c,r"
  );
  for (const { id: key, data: record } of records.rows) {
    let changed = false;
    for (const kind of ["safety", "legal"]) {
      const by = record[kind]?.by;
      if (!by || signer && by !== signer || await hasApprover(db, by))
        continue;
      record[kind] = null;
      changed = true;
      await audit(db, actor, "release_record.void", "content", key, {
        reason: "signoff_lapsed",
        kind,
        signer: by
      });
    }
    if (!changed) continue;
    record.claims_validated_at = null;
    record.last_validation = null;
    record.status = signedStatus(record);
    await saveRecord(db, key, record);
  }
}
async function rowsApi(ctx) {
  const { method, body, staff } = ctx;
  if (method === "PATCH" || method === "DELETE")
    fail(405, "rows_immutable", "Recorded rows cannot be changed.");
  requireRole(staff, "editor", "approver");
  if (method === "GET")
    return ok({ rows: await all(pool, "benchmark_rows") });
  return transaction(async (db) => {
    await advisory(db, "benchmark-rows");
    const subject = str(body.subject), benchmark = str(body.benchmark).trim(), eval_date = str(body.eval_date), score = str(body.score).trim();
    const model = await contentBySlug(db, "model", subject);
    const fields = {};
    if (!model && !comparators[subject])
      fields.subject = "Choose a model route or a recorded comparator.";
    if (!validScore(score))
      fields.score = "Enter a score from 0 to 100 with at most two decimals.";
    if (!withinLength(benchmark, 120)) fields.benchmark = "Enter a benchmark.";
    if (!validDate(eval_date)) fields.eval_date = "Enter an evaluation date.";
    if (Object.keys(fields).length) validation(fields);
    if ((await db.query(
      "SELECT 1 FROM benchmark_rows WHERE subject=$1 AND benchmark=$2 AND eval_date=$3",
      [subject, benchmark, eval_date]
    )).rowCount)
      fail(
        409,
        "row_exists",
        "A row for this model, benchmark and date is already recorded."
      );
    const row = {
      id: id(),
      subject,
      benchmark,
      eval_date,
      score,
      source_note: str(body.source_note).trim(),
      subject_name: model?.title || comparators[subject].name,
      organisation: model ? "Aldermoor Labs" : comparators[subject].organisation
    };
    await saveRow(db, row);
    await audit(db, staff.email, "row.create", "row", row.id, {
      subject,
      benchmark,
      eval_date,
      score
    });
    return ok({ row }, 201);
  });
}
async function createContent(ctx) {
  const { body, staff } = ctx;
  requireRole(staff, "editor");
  const kind = body.kind;
  acceptOnly(body, [
    "kind",
    ...kind === "model" ? editableKeys.model : kind === "news" ? editableKeys.news : [.../* @__PURE__ */ new Set([...editableKeys.news, ...editableKeys.model])]
  ]);
  return transaction(async (db) => {
    await advisory(db, "content-slugs");
    const c = contentFields(body);
    c.author = staff.email;
    await validateContent(db, c, kind);
    await saveContent(db, c);
    if (c.kind === "model") await saveRecord(db, c.id, emptyReleaseRecord());
    await audit(db, staff.email, "content.create", "content", c.id, {
      kind: c.kind,
      slug: c.slug
    });
    return ok({ content: c }, 201, c.version);
  });
}
async function recordAction(db, c, record, verb, body, staff) {
  if (verb === "signoffs") {
    if (!["in_review", "approved"].includes(c.status))
      fail(
        409,
        "not_in_review",
        "Sign-offs are recorded while a route is in review or approved."
      );
    const kind = body.kind;
    const other = kind === "safety" ? "legal" : "safety";
    if (record[kind])
      fail(409, "already_signed", "This sign-off is already recorded.");
    if (record[other]?.by === staff.email)
      fail(
        409,
        "distinct_approver_required",
        "Safety and legal sign-off must come from different approvers."
      );
    record[kind] = {
      by: staff.email,
      at: now(),
      note: str(body.note).trim()
    };
    record.status = signedStatus(record);
    await saveRecord(db, c.id, record);
    await audit(db, staff.email, `signoff.${kind}`, "content", c.id, {
      kind
    });
    return ok({ record }, 201);
  }
  if (verb === "validate-claims") {
    if (!record.safety || !record.legal)
      fail(
        409,
        "signoffs_incomplete",
        "Record both sign-offs before validating claims."
      );
    if (record.status === "cleared") illegal("cleared", "claims_validated");
    if (await lapsed(db, record))
      fail(
        409,
        "signoff_lapsed",
        "A sign-off holder no longer holds the approver role. Record that sign-off again."
      );
    const result = validateClaims(
      c,
      await all(db, "benchmark_rows")
    );
    const invalid = Object.keys(result.fields).length > 0;
    record.last_validation = result.results;
    record.status = invalid ? "signed" : "claims_validated";
    record.claims_validated_at = invalid ? null : now();
    await saveRecord(db, c.id, record);
    await audit(db, staff.email, "claims.validate", "content", c.id, {
      ok: !invalid,
      results: result.results
    });
    if (invalid)
      return ok(
        new ApiError(
          422,
          "claims_invalid",
          "Some claims do not match the recorded rows.",
          result.fields
        ).toJSON(),
        422
      );
    return ok({ record });
  }
  if (record.status !== "claims_validated")
    fail(
      409,
      "claims_not_validated",
      "Validate the claims before clearing this record."
    );
  if (await lapsed(db, record))
    fail(
      409,
      "signoff_lapsed",
      "A sign-off holder no longer holds the approver role. Record that sign-off again."
    );
  record.status = "cleared";
  record.cleared_by = staff.email;
  record.cleared_at = now();
  await saveRecord(db, c.id, record);
  await audit(db, staff.email, "release_record.clear", "content", c.id);
  return ok({ record });
}
async function contentApi(ctx) {
  const { method, path, body, version, staff, query } = ctx;
  if (/^\/api\/console\/benchmark-rows(\/[^/]+)?$/.test(path))
    return rowsApi(ctx);
  if (path === "/api/console/content") {
    if (method === "POST") return createContent(ctx);
    requireRole(staff, "editor", "approver");
    const status2 = query.get("status");
    return ok({
      items: (await all(pool, "content")).filter(
        (c) => !status2 || c.status === status2
      )
    });
  }
  const match = path.match(/^\/api\/console\/content\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  const [, cid, verb = ""] = match;
  return transaction(async (db) => {
    const c = await one(db, "content", cid, method !== "GET");
    if (!c) notFound();
    const record = await one(db, "release_records", cid);
    if (verb.startsWith("release-record") && !record) notFound();
    if (method === "GET") {
      requireRole(staff, "editor", "approver");
      return verb === "release-record" ? ok({ record }) : ok({ content: c }, 200, c.version);
    }
    let linkedPost;
    if (c.kind === "model" && c.linked_news_slug && ["schedule", "release"].includes(verb))
      linkedPost = await contentBySlug(db, "news", c.linked_news_slug, true);
    if (nonAuthor.includes(verb)) {
      requireNonAuthor(c.author, staff.email);
      if (linkedPost) requireNonAuthor(linkedPost.author, staff.email);
      requireRole(staff, "approver");
    } else if (verb === "" || verb === "submit") {
      requireRole(staff, "editor");
      if (c.author !== staff.email) forbidden();
    } else if (verb === "withdraw") requireRole(staff, "approver");
    else requireRole(staff, "editor", "approver");
    const expected = versioned.includes(verb) ? requireVersion(version) : c.version;
    acceptOnly(body, verb === "" ? editableKeys[c.kind] : verbKeys[verb] || []);
    let updated;
    let localInstant;
    if (verb === "") {
      if (!Object.keys(body).length) validation({});
      await advisory(db, "content-slugs");
      updated = contentFields(body, c);
      await validateContent(db, updated, c.kind);
    }
    if (verb === "return" && !withinLength(str(body.reason), 2e3))
      validation({ reason: "Say what needs to change." });
    if (verb === "comments" && !withinLength(str(body.body), 4e3))
      validation({ body: "Enter a comment of at most 4,000 characters." });
    if (verb === "schedule")
      localInstant = londonInstant(str(body.release_at_local));
    if (verb === "release-record/signoffs") {
      const fields = {};
      if (!["safety", "legal"].includes(str(body.kind)))
        fields.kind = "Choose safety or legal.";
      if (codePoints(str(body.note)) > 2e3)
        fields.note = "Enter a note of at most 2,000 characters.";
      if (Object.keys(fields).length) validation(fields);
    }
    checkVersion(expected, c.version);
    if (verb.startsWith("release-record/"))
      return recordAction(
        db,
        c,
        record,
        verb.slice("release-record/".length),
        body,
        staff
      );
    if (verb === "comments") {
      if (!["draft", "in_review", "returned", "approved"].includes(c.status))
        fail(
          409,
          "comments_closed",
          "Comments are closed once an item is scheduled."
        );
      const comment = {
        id: id(),
        author: staff.email,
        body: str(body.body).trim(),
        created_at: now()
      };
      c.comments.push(comment);
      await saveContent(db, c, c.version);
      await audit(db, staff.email, "content.comment", "content", cid, {
        comment: comment.id
      });
      return ok({ comment }, 201);
    }
    if (verb === "") {
      if (!["draft", "returned"].includes(c.status))
        fail(
          409,
          "not_editable",
          "Only drafts and returned items can be edited."
        );
      Object.assign(c, updated);
      c.version++;
      await saveContent(db, c, expected);
      await audit(db, staff.email, "content.update", "content", cid, {
        fields: Object.keys(body).sort()
      });
      if (record && (record.status !== "open" || record.last_validation !== null)) {
        await saveRecord(db, cid, emptyReleaseRecord());
        await audit(db, staff.email, "release_record.void", "content", cid, {
          reason: "route_edited"
        });
      }
      return ok({ content: c }, 200, c.version);
    }
    if (c.kind === "news" && ["schedule", "release", "withdraw"].includes(verb) && await scheduledModelFor(db, c))
      fail(409, "linked_to_model", "This post releases with its model route.");
    const to = contentMove(c.status, verb);
    if (verb === "release") {
      await publishContent(db, c, staff.email, now());
      return ok({ content: c }, 200, c.version);
    }
    if (verb === "withdraw") {
      const post = c.kind === "model" && c.linked_news_slug ? await contentBySlug(db, "news", c.linked_news_slug, true) : void 0;
      await withdrawContent(db, c, staff.email);
      if (post && ["published", "scheduled"].includes(post.status))
        await withdrawContent(db, post, staff.email, { linked_model: cid });
      return ok({ content: c }, 200, c.version);
    }
    if (verb === "schedule") {
      if (c.kind === "model" && record?.status !== "cleared")
        fail(
          409,
          "release_record_not_cleared",
          "This model route's release record is not cleared."
        );
      if (c.linked_news_slug) {
        if (!linkedPost || linkedPost.status !== "approved")
          fail(
            409,
            "linked_post_not_ready",
            "The linked announcement must be approved before scheduling."
          );
        const postExpected = linkedPost.version;
        linkedPost.status = contentMove(linkedPost.status, "schedule");
        linkedPost.release_at = localInstant;
        linkedPost.release_at_local = str(body.release_at_local);
        linkedPost.version++;
        await saveContent(db, linkedPost, postExpected);
        await embargo(db, linkedPost, staff.email);
        await audit(
          db,
          staff.email,
          "content.schedule",
          "content",
          linkedPost.id,
          { release_at: localInstant, linked_model: cid }
        );
      }
      c.release_at = localInstant;
      c.release_at_local = str(body.release_at_local);
      await embargo(db, c, staff.email);
    }
    c.status = to;
    c.version++;
    if (verb === "return")
      c.comments.push({
        id: id(),
        author: staff.email,
        body: str(body.reason).trim(),
        created_at: now()
      });
    await saveContent(db, c, expected);
    await audit(
      db,
      staff.email,
      `content.${verb}`,
      "content",
      cid,
      verb === "schedule" ? { release_at: localInstant } : verb === "return" ? { reason: str(body.reason).trim() } : {}
    );
    if (verb === "submit" && c.kind === "model") {
      const approvers = new Set(
        (await all(db, "grants")).filter(
          (g) => g.role === "approver" && g.staff_email !== c.author && grantActive(g)
        ).map((g) => g.staff_email)
      );
      for (const email2 of approvers)
        await enqueueMail(
          db,
          { name: await staffName(db, email2), email: email2 },
          `Release record awaiting sign-off: ${c.title}`,
          `${c.title}
${config.publicBaseUrl}/console/content/${c.id}`
        );
    }
    return ok(
      verb === "schedule" ? { content: c, zone: "Europe/London" } : { content: c },
      200,
      c.version
    );
  });
}
var ok, editableKeys, verbKeys, versioned, nonAuthor, scheduledModelFor, hasApprover;
var init_content = __esm({
  "src/content.ts"() {
    "use strict";
    init_db();
    init_errors();
    init_auth();
    init_domain();
    init_search();
    init_config();
    ok = (data, status2 = 200, version) => ({
      status: status2,
      data,
      version
    });
    editableKeys = {
      news: ["slug", "title", "summary", "body", "subject", "tags"],
      model: ["slug", "title", "summary", "body", "claims", "linked_news_slug"]
    };
    verbKeys = {
      submit: [],
      approve: [],
      release: [],
      withdraw: [],
      return: ["reason"],
      schedule: ["release_at_local"],
      comments: ["body"],
      "release-record/signoffs": ["kind", "note"],
      "release-record/validate-claims": [],
      "release-record/clear": []
    };
    versioned = [
      "",
      "submit",
      "approve",
      "return",
      "schedule",
      "release",
      "withdraw"
    ];
    nonAuthor = [
      "approve",
      "return",
      "schedule",
      "release",
      "release-record/signoffs",
      "release-record/clear"
    ];
    scheduledModelFor = async (db, post) => (await db.query(
      "SELECT data FROM content WHERE kind='model' AND status='scheduled' AND data->>'linked_news_slug'=$1",
      [post.slug]
    )).rows[0]?.data;
    hasApprover = async (db, email2) => (await staffRoles(db, email2)).some((r) => r.role === "approver");
  }
});

// src/careers.ts
import { randomBytes as randomBytes2 } from "node:crypto";
function applicationShape(a) {
  return {
    id: a.id,
    reference: a.reference,
    name: a.name,
    email: a.email,
    stage: a.stage,
    version: a.version,
    submitted_at: a.submitted_at,
    decisions: a.decisions,
    notes: a.notes
  };
}
function rotate(a) {
  const token = capability();
  a.token_digest = digest(token);
  a.token_ciphertext = encryptToken(token);
  return `${config.publicBaseUrl}/track/${token}`;
}
async function moveApplication(db, a, r, to, rationale, actor) {
  stageMove(a.stage, to);
  const expected = a.version;
  const from = a.stage;
  a.stage = to;
  a.stage_changed_at = now();
  a.version++;
  a.decisions.push({ from, to, rationale, by: actor, at: a.stage_changed_at });
  await saveApplication(db, a, expected);
  await audit(db, actor, "application.stage", "application", a.id, {
    reference: a.reference,
    requisition: r.id,
    from,
    to
  });
  if (actor !== "candidate")
    await enqueueMail(
      db,
      candidate(a),
      "Update on your Aldermoor application",
      `${r.title}
Your application is now at: ${stageLabels[to]}.
${trackingLink(a)}`
    );
}
async function submitApplication(slug, form2) {
  const { fields, resume } = form2;
  const name = (fields.name || "").trim(), email2 = normalizeEmail(fields.email || "");
  const role = await requisitionBySlug(pool, slug);
  if (!role || role.status === "draft") publicNotFound();
  const errors = {};
  if (!validName(name)) errors.name = "Enter your full name.";
  if (!validEmail(fields.email || ""))
    errors.email = "Enter a valid email address.";
  if (fields.consent !== "yes")
    errors.consent = "Please confirm your consent to apply.";
  if (!resume || resume.length < 1 || resume.length > 5e6 || resume.subarray(0, 5).toString("latin1") !== "%PDF-")
    errors.resume = "Attach a PDF r\xE9sum\xE9 of at most 5,000,000 bytes.";
  if (Object.keys(errors).length) validation(errors);
  let uploadedKey;
  try {
    return await transaction(async (db) => {
      await advisory(db, `application:${role.id}:${email2}`);
      const duplicate = (await db.query(
        "SELECT data FROM applications WHERE requisition_id=$1 AND email=$2",
        [role.id, email2]
      )).rows[0]?.data;
      if (duplicate) return { status: 200, data: duplicate.receipt };
      const r = (await db.query(
        "SELECT data FROM requisitions WHERE id=$1 FOR SHARE",
        [role.id]
      )).rows[0].data;
      if (r.status !== "open")
        fail(
          409,
          "requisition_closed",
          "This role is no longer accepting applications."
        );
      const reference = "AR-" + Array.from(
        randomBytes2(8),
        (n) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[n % 32]
      ).join("");
      const submitted_at = now();
      const receipt = {
        application: {
          reference,
          role: { slug: r.slug, title: r.title },
          stage: "submitted",
          submitted_at
        }
      };
      const key = `resumes/${r.id}/${randomBytes2(16).toString("hex")}.pdf`;
      try {
        await putObject(key, resume, "application/pdf");
        uploadedKey = key;
      } catch {
        fail(
          503,
          "storage_unavailable",
          "We couldn't store your r\xE9sum\xE9 just now. Nothing was submitted; please try again in a few minutes."
        );
      }
      const a = {
        id: id(),
        requisition_id: r.id,
        reference,
        name,
        email: email2,
        stage: "submitted",
        version: 1,
        submitted_at,
        stage_changed_at: submitted_at,
        decisions: [],
        notes: [],
        resume_key: key,
        token_digest: null,
        token_ciphertext: null,
        receipt,
        erased: false
      };
      const link = rotate(a);
      await saveApplication(db, a);
      await enqueueMail(
        db,
        candidate(a),
        `Application received: ${r.title}`,
        `${name}
${r.title}
Reference: ${reference}
Follow your application: ${link}`
      );
      return { status: 201, data: receipt };
    });
  } catch (error) {
    if (uploadedKey) await deleteObject(uploadedKey).catch(() => void 0);
    throw error;
  }
}
async function tracking(token, withdraw = false) {
  return transaction(async (db) => {
    const a = (await db.query(
      `SELECT data FROM applications WHERE token_digest=$1${withdraw ? " FOR UPDATE" : ""}`,
      [digest(token)]
    )).rows[0]?.data;
    if (!a) invalidLink();
    const r = await one(db, "requisitions", a.requisition_id);
    if (!trackingLive(r)) invalidLink();
    if (withdraw)
      await moveApplication(
        db,
        a,
        r,
        "withdrawn",
        "Withdrawn by candidate",
        "candidate"
      );
    return trackedShape(a, r);
  });
}
async function resendLinks(emailValue) {
  if (!validEmail(emailValue))
    validation({ email: "Enter a valid email address." });
  const email2 = normalizeEmail(emailValue);
  await transaction(async (db) => {
    await advisory(db, `resend:${email2}`);
    const recent = await db.query(
      "SELECT 1 FROM resend_requests WHERE email=$1 AND at > now() - make_interval(secs=>$2)",
      [email2, config.resendWindow]
    );
    if (recent.rowCount >= 3) return;
    await db.query("INSERT INTO resend_requests(email) VALUES($1)", [email2]);
    const selected = await db.query(
      "SELECT data FROM applications WHERE email=$1 FOR UPDATE",
      [email2]
    );
    const lines = [];
    let recipient;
    for (const { data: a } of selected.rows) {
      const r = await one(db, "requisitions", a.requisition_id);
      if (!trackingLive(r)) continue;
      lines.push(`${r.title}: ${rotate(a)}`);
      await saveApplication(db, a, a.version);
      recipient = candidate(a);
    }
    if (recipient)
      await enqueueMail(
        db,
        recipient,
        "Your Aldermoor application links",
        lines.join("\n")
      );
  });
  return {
    status: 202,
    data: {
      message: "If that address has applied for a role with us, we've sent its tracking links to it."
    }
  };
}
async function benefitsApi(ctx) {
  const { body, staff } = ctx;
  requireRole(staff, "recruiter");
  const region = str(body.region), effective_from = str(body.effective_from), summary = str(body.summary).trim();
  const fields = {};
  if (!regions[region]) fields.region = "Choose a listed region.";
  if (!validDate(effective_from))
    fields.effective_from = "Use a real date in the form YYYY-MM-DD.";
  if (!withinLength(summary, 500))
    fields.summary = "Enter a summary of at most 500 characters.";
  if (Object.keys(fields).length) validation(fields);
  return transaction(async (db) => {
    await advisory(db, `benefits:${region}`);
    if ((await db.query(
      "SELECT 1 FROM benefits WHERE region=$1 AND effective_from=$2",
      [region, effective_from]
    )).rowCount)
      fail(
        409,
        "entry_exists",
        "That region already has an entry from this date."
      );
    const entry = { id: id(), region, effective_from, summary };
    await saveBenefits(db, entry);
    await audit(db, staff.email, "benefits.create", "benefits", entry.id, {
      region,
      effective_from
    });
    return { status: 201, data: { entry } };
  });
}
async function createRequisition(ctx) {
  const { body, staff } = ctx;
  const slug = str(body.slug).trim(), title = str(body.title).trim(), description = str(body.description).trim(), office = str(body.office), discipline = str(body.discipline);
  const recruiters = [
    .../* @__PURE__ */ new Set([...list(body.recruiters).map(normalizeEmail), staff.email])
  ];
  return transaction(async (db) => {
    await advisory(db, "requisition-slugs");
    const fields = {};
    if (!validSlug(slug))
      fields.slug = "Use lowercase letters, numbers and single hyphens, up to 80 characters.";
    else if (await requisitionBySlug(db, slug))
      fields.slug = "That slug is already in use.";
    if (!withinLength(title, 120))
      fields.title = "Enter a title of at most 120 characters.";
    if (!["research", "engineering", "policy", "operations"].includes(discipline))
      fields.discipline = "Choose research, engineering, policy or operations.";
    if (!offices[office]) fields.office = "Choose a listed office.";
    if (!withinLength(description, 8e3))
      fields.description = "Enter a description of at most 8,000 characters.";
    for (const email2 of recruiters)
      if (!(await staffRoles(db, email2)).some((g) => g.role === "recruiter"))
        fields.recruiters = "Each recruiter must hold the recruiter role.";
    if (Object.keys(fields).length) validation(fields);
    const requisition = {
      id: id(),
      slug,
      title,
      discipline,
      office,
      description,
      recruiters,
      status: "draft",
      opened_at: null,
      closed_at: null,
      erase_after: null,
      version: 1
    };
    await saveRequisition(db, requisition);
    await audit(
      db,
      staff.email,
      "requisition.create",
      "requisition",
      requisition.id,
      { slug }
    );
    return { status: 201, data: { requisition }, version: 1 };
  });
}
async function requisitionAction(ctx, rid, verb) {
  const { method, body, staff, version } = ctx;
  return transaction(async (db) => {
    const r = await one(db, "requisitions", rid, method !== "GET");
    if (!r || !r.recruiters.includes(staff.email)) notFound();
    requireRole(staff, "recruiter");
    if (method === "GET") {
      if (verb === "applications")
        return {
          status: 200,
          data: {
            applications: (await db.query(
              "SELECT data FROM applications WHERE requisition_id=$1 ORDER BY data->>'submitted_at'",
              [r.id]
            )).rows.map(({ data: a }) => ({
              id: a.id,
              reference: a.reference,
              name: a.name,
              email: a.email,
              stage: a.stage,
              submitted_at: a.submitted_at,
              version: a.version
            }))
          }
        };
      return { status: 200, data: { requisition: r }, version: r.version };
    }
    const expected = requireVersion(version);
    const reason = str(body.reason).trim();
    if (verb === "close" && !withinLength(reason, 2e3))
      validation({ reason: "Say why this requisition is closing." });
    checkVersion(expected, r.version);
    const to = verb === "open" ? "open" : "closed";
    requisitionMove(r.status, to);
    r.status = to;
    r.version++;
    if (to === "open") {
      r.opened_at = now();
      await indexRole(db, r);
    } else {
      r.closed_at = now();
      r.erase_after = new Date(
        Date.parse(r.closed_at) + config.retention * 1e3
      ).toISOString();
      await unindex(db, "role", r.slug);
      const apps = await db.query(
        "SELECT data FROM applications WHERE requisition_id=$1 ORDER BY id FOR UPDATE",
        [r.id]
      );
      for (const { data: a } of apps.rows)
        if (activeStage(a.stage))
          await moveApplication(
            db,
            a,
            r,
            "declined",
            `Requisition closed: ${reason}`,
            staff.email
          );
    }
    await saveRequisition(db, r, expected);
    await audit(
      db,
      staff.email,
      `requisition.${verb}`,
      "requisition",
      r.id,
      verb === "close" ? { reason } : {}
    );
    return { status: 200, data: { requisition: r }, version: r.version };
  });
}
async function applicationAction(ctx, aid, verb) {
  const { method, body, staff, version } = ctx;
  return transaction(async (db) => {
    const a = await one(db, "applications", aid, method !== "GET");
    const r = a && await one(db, "requisitions", a.requisition_id);
    if (!a || !r || !r.recruiters.includes(staff.email)) notFound();
    requireRole(staff, "recruiter");
    if (method === "GET") {
      if (verb !== "resume")
        return {
          status: 200,
          data: { application: applicationShape(a) },
          version: a.version
        };
      if (a.erased) notFound();
      let response;
      try {
        response = await storage("GET", a.resume_key);
      } catch {
        fail(503, "storage_unavailable", "R\xE9sum\xE9s are unavailable right now.");
      }
      if (!response.ok)
        fail(503, "storage_unavailable", "R\xE9sum\xE9s are unavailable right now.");
      return {
        status: 200,
        data: Buffer.from(await response.arrayBuffer()),
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="resume-${a.reference}.pdf"`
        }
      };
    }
    if (verb === "stage") {
      const expected = requireVersion(version);
      const fields = {};
      if (!withinLength(str(body.rationale), 2e3))
        fields.rationale = "Record the reason for this decision.";
      if (!Object.hasOwn(stageLabels, str(body.to)))
        fields.to = "Choose a stage.";
      if (Object.keys(fields).length) validation(fields);
      checkVersion(expected, a.version);
      await moveApplication(
        db,
        a,
        r,
        body.to,
        str(body.rationale).trim(),
        staff.email
      );
      return {
        status: 200,
        data: { application: applicationShape(a) },
        version: a.version
      };
    }
    if (verb === "notes") {
      if (!withinLength(str(body.body), 4e3))
        validation({
          body: "Enter an interview note of at most 4,000 characters."
        });
      const note = {
        id: id(),
        body: str(body.body).trim(),
        by: staff.email,
        at: now()
      };
      a.notes.push(note);
      await saveApplication(db, a, a.version);
      await audit(db, staff.email, "application.note", "application", a.id, {
        reference: a.reference
      });
      return { status: 201, data: { note } };
    }
    if (!trackingLive(r))
      fail(
        409,
        "link_retired",
        "This application's retention period has ended."
      );
    const link = rotate(a);
    await saveApplication(db, a, a.version);
    await enqueueMail(
      db,
      candidate(a),
      `Your new tracking link: ${r.title}`,
      `${r.title}
Your new tracking link: ${link}`
    );
    await audit(db, staff.email, "tracking_link.reissue", "application", a.id, {
      reference: a.reference
    });
    return { status: 200, data: { reissued_at: now() } };
  });
}
async function careersApi(ctx) {
  const { path, method, staff } = ctx;
  if (path === "/api/console/benefits") return benefitsApi(ctx);
  if (path === "/api/console/requisitions") {
    requireRole(staff, "recruiter");
    if (method === "POST") return createRequisition(ctx);
    const apps = await all(pool, "applications");
    return {
      status: 200,
      data: {
        requisitions: (await all(pool, "requisitions")).filter((r) => r.recruiters.includes(staff.email)).map((r) => counted(r, apps))
      }
    };
  }
  const requisition = path.match(
    /^\/api\/console\/requisitions\/([^/]+)(?:\/(open|close|applications))?$/
  );
  if (requisition)
    return requisitionAction(ctx, requisition[1], requisition[2] || "");
  const application = path.match(
    /^\/api\/console\/applications\/([^/]+)(?:\/(stage|notes|resume|tracking-link\/reissue))?$/
  );
  if (application)
    return applicationAction(ctx, application[1], application[2] || "");
  return null;
}
var trackedShape, trackingLive, candidate, trackingLink, requisitionBySlug, invalidLink, counted;
var init_careers = __esm({
  "src/careers.ts"() {
    "use strict";
    init_db();
    init_errors();
    init_auth();
    init_config();
    init_domain();
    init_media();
    init_search();
    trackedShape = (a, r) => ({
      role: { title: r.title, office: offices[r.office].label },
      stage: a.stage,
      stage_label: stageLabels[a.stage],
      submitted_at: a.submitted_at,
      stage_changed_at: a.stage_changed_at
    });
    trackingLive = (r) => r.status !== "closed" || Date.now() < Date.parse(r.erase_after);
    candidate = (a) => ({
      name: a.name,
      email: a.email
    });
    trackingLink = (a) => `${config.publicBaseUrl}/track/${decryptToken(a.token_ciphertext)}`;
    requisitionBySlug = async (db, slug) => (await db.query(
      "SELECT data FROM requisitions WHERE slug=$1",
      [slug]
    )).rows[0]?.data;
    invalidLink = () => fail(404, "not_found", "This tracking link is not valid.");
    counted = (r, apps) => ({
      ...r,
      counts: Object.fromEntries(
        Object.keys(stageLabels).map((s) => [
          s,
          apps.filter((a) => a.requisition_id === r.id && a.stage === s).length
        ])
      )
    });
  }
});

// src/governance.ts
async function queueGrantExpiry(db, g) {
  if (!grantActive(g) || Date.parse(g.expires_at) - Date.now() > 6048e5)
    return;
  const claimed = await db.query(
    "UPDATE grants SET expiry_notified=true WHERE id=$1 AND expiry_notified=false RETURNING id",
    [g.id]
  );
  if (!claimed.rowCount) return;
  const role = g.role[0].toUpperCase() + g.role.slice(1);
  await enqueueMail(
    db,
    { name: await staffName(db, g.staff_email), email: g.staff_email },
    `Your ${role} access ends soon`,
    `Your ${role} access ends ${london(g.expires_at)} London.`
  );
}
async function listJobs(query) {
  return (await pool.query(
    `SELECT ${jobColumns} FROM jobs WHERE ($1::text IS NULL OR state=$1) AND ($2::text IS NULL OR kind=$2) ORDER BY created_at DESC,id DESC LIMIT 200`,
    [query.get("state") || null, query.get("kind") || null]
  )).rows;
}
async function listAudit(query) {
  const limitText = query.get("limit") ?? "100";
  const before = query.get("before_seq");
  const limit = Number(limitText);
  const fields = {};
  if (!/^\d+$/.test(limitText) || limit < 1 || limit > 500)
    fields.limit = "Choose a limit from 1 to 500.";
  if (before !== null && !/^\d+$/.test(before))
    fields.before_seq = "Choose a whole-number sequence.";
  if (Object.keys(fields).length) validation(fields);
  return (await pool.query(
    `SELECT ${auditColumns} FROM audit_entries WHERE ($1::text IS NULL OR action=$1) AND ($2::text IS NULL OR target_id=$2) AND ($3::bigint IS NULL OR seq<$3::bigint) ORDER BY seq DESC LIMIT $4`,
    [query.get("action"), query.get("target_id"), before, limit]
  )).rows;
}
async function verifyChain() {
  const entries = (await pool.query(
    `SELECT ${auditColumns} FROM audit_entries ORDER BY seq`
  )).rows;
  let prev = ZERO_HASH;
  for (const [index2, entry] of entries.entries()) {
    if (entry.seq !== index2 + 1 || entry.prev_hash !== prev || entry.hash !== auditHash(prev, entry))
      return {
        valid: false,
        entries: entries.length,
        first_invalid_seq: entry.seq
      };
    prev = entry.hash;
  }
  return { valid: true, entries: entries.length, head: prev };
}
async function retryJob(key, staff) {
  return transaction(async (db) => {
    const job = (await db.query(
      "SELECT state FROM jobs WHERE id::text=$1 FOR UPDATE",
      [key]
    )).rows[0];
    if (!job) notFound();
    requireRole(staff, "administrator");
    if (job.state !== "dead")
      fail(409, "job_not_dead", "Only dead jobs can be retried.");
    const retried = await db.query(
      `UPDATE jobs SET state='pending',attempts=0,refusals=0,last_error=NULL,finished_at=NULL,next_attempt_at=now() WHERE id::text=$1 RETURNING ${jobColumns}`,
      [key]
    );
    const retriedJob = retried.rows[0];
    await audit(db, staff.email, "job.retry", "job", String(retriedJob.id), {
      kind: retriedJob.kind
    });
    return { status: 200, data: { job: retriedJob } };
  });
}
async function createGrant(body, actor) {
  return transaction(async (db) => {
    await advisory(db, "grants");
    const staff_email = normalizeEmail(str(body.staff_email)), role = str(body.role), expires_at = str(body.expires_at);
    const fields = {};
    if (!(await db.query("SELECT 1 FROM staff WHERE email=$1", [staff_email])).rowCount)
      fields.staff_email = "No staff account has that email.";
    if (!["editor", "approver", "recruiter", "administrator"].includes(role))
      fields.role = "Choose editor, approver, recruiter or administrator.";
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/.test(expires_at) || !(Date.parse(expires_at) > Date.now()))
      fields.expires_at = "Choose an expiry in the future.";
    if (Object.keys(fields).length) validation(fields);
    if ((await all(db, "grants")).some(
      (g) => g.staff_email === staff_email && g.role === role && grantActive(g)
    ))
      fail(409, "grant_exists", "That person already holds this role.");
    const grant = {
      id: id(),
      staff_email,
      role,
      expires_at: new Date(expires_at).toISOString(),
      granted_at: now(),
      granted_by: actor,
      revoked_at: null,
      revoked_by: null,
      version: 1
    };
    await saveGrant(db, grant);
    await queueGrantExpiry(db, grant);
    await audit(db, actor, "grant.create", "grant", grant.id, {
      staff_email,
      role,
      expires_at: grant.expires_at
    });
    return { status: 201, data: { grant: grantShape(grant) }, version: 1 };
  });
}
async function revokeGrant(key, version, staff) {
  const actor = staff.email;
  return transaction(async (db) => {
    await advisory(db, "grants");
    const g = await one(db, "grants", key, true);
    if (!g) notFound();
    requireRole(staff, "administrator");
    const expected = requireVersion(version);
    checkVersion(expected, g.version);
    if (!grantActive(g))
      fail(409, "grant_inactive", "This grant has already ended.");
    if (g.role === "administrator" && (await all(db, "grants")).filter(
      (x) => x.role === "administrator" && grantActive(x)
    ).length === 1)
      fail(
        409,
        "last_administrator",
        "You cannot revoke the last active administrator grant."
      );
    g.revoked_at = now();
    g.revoked_by = actor;
    g.version++;
    await saveGrant(db, g, expected);
    await audit(db, actor, "grant.revoke", "grant", g.id, {
      staff_email: g.staff_email,
      role: g.role
    });
    if (g.role === "approver")
      await voidLapsedSignoffs(db, actor, g.staff_email);
    return { status: 200, data: { grant: grantShape(g) }, version: g.version };
  });
}
async function governanceApi(ctx) {
  const { path, method, body, staff, query, version } = ctx;
  if (/^\/api\/console\/audit\/[^/]+$/.test(path) && method !== "GET")
    fail(405, "audit_immutable", "Audit entries cannot be changed or removed.");
  if (path === "/api/console/audit") {
    requireRole(staff, "administrator");
    return { status: 200, data: { entries: await listAudit(query) } };
  }
  if (path === "/api/console/audit/verify") {
    requireRole(staff, "administrator");
    return { status: 200, data: await verifyChain() };
  }
  if (path === "/api/console/jobs") {
    requireRole(staff, "administrator");
    return { status: 200, data: { jobs: await listJobs(query) } };
  }
  const retry = path.match(/^\/api\/console\/jobs\/([^/]+)\/retry$/);
  if (retry) return retryJob(retry[1], staff);
  if (path === "/api/console/grants") {
    requireRole(staff, "administrator");
    if (method === "POST") return createGrant(body, staff.email);
    return {
      status: 200,
      data: { grants: (await all(pool, "grants")).map(grantShape) }
    };
  }
  const revoke = path.match(/^\/api\/console\/grants\/([^/]+)\/revoke$/);
  if (!revoke) return null;
  return revokeGrant(revoke[1], version, staff);
}
var grantShape, london, jobColumns, auditColumns;
var init_governance = __esm({
  "src/governance.ts"() {
    "use strict";
    init_db();
    init_errors();
    init_auth();
    init_content();
    init_domain();
    grantShape = (g) => ({
      ...g,
      status: g.revoked_at ? "revoked" : grantActive(g) ? "active" : "expired"
    });
    london = (instant) => new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date(instant)).replace(" at", ",");
    jobColumns = `id::int AS id,kind,state,attempts,refusals,last_error,CASE WHEN state IN ('done','dead') THEN NULL ELSE to_char(next_attempt_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS next_attempt_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,to_char(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS finished_at`;
    auditColumns = "seq::int AS seq,id,at,actor,action,target_type,target_id,detail,prev_hash,hash";
  }
});

// src/pages.ts
var pages_exports = {};
__export(pages_exports, {
  errorPage: () => errorPage,
  htmlRoute: () => htmlRoute
});
async function html(title, main, options = {}, code = 200) {
  return {
    status: code,
    data: await layout(title, main, options),
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp
    }
  };
}
function renderBody(body, claims = [], rows = []) {
  const renderClaim = (claim) => {
    const comparator = rows.find((row) => row.id === claim.comparator_row_id);
    let linked = "", cursor = 0;
    for (const { value, index: index2 } of claimNumbers(claim.text, [
      claim.benchmark,
      ...rows.map((row) => row.subject_name)
    ])) {
      const rowId = comparator && Number(value) === Number(comparator.score) ? claim.comparator_row_id : claim.model_row_id;
      const after = /^[,.;:]?/.exec(claim.text.slice(index2 + value.length))[0];
      linked += `${esc(claim.text.slice(cursor, index2))}<span class="nowrap"><a class="claim-number" href="#row-${esc(rowId)}">${esc(value)}</a>${after}</span>`;
      cursor = index2 + value.length + after.length;
    }
    linked += esc(claim.text.slice(cursor));
    return `<span class="claim-text">${linked}</span><button type="button" class="claim-marker" aria-label="Claim ${claim.number}" aria-pressed="false" data-claim="${esc(claim.id)}">${claim.number}</button>`;
  };
  const renderParagraph = (text) => {
    let rendered = "", cursor = 0;
    for (const marker of text.matchAll(/\[claim:(c\d+)\]/g)) {
      rendered += esc(text.slice(cursor, marker.index));
      const claim = claims.find((item) => item.id === marker[1]);
      rendered += claim ? renderClaim(claim) : esc(marker[0]);
      cursor = marker.index + marker[0].length;
    }
    return `<p>${rendered + esc(text.slice(cursor))}</p>`;
  };
  const blocks = [];
  let current = { heading: null, paragraphs: [] };
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) {
      current.paragraphs.push(paragraph.join("\n"));
      paragraph = [];
    }
  };
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) {
      flush();
      if (current.heading || current.paragraphs.length) blocks.push(current);
      current = { heading: line.slice(3), paragraphs: [] };
    } else if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  if (current.heading || current.paragraphs.length) blocks.push(current);
  let number = 0;
  return blocks.map(
    (block) => `<section class="prose-section" data-reveal="pending">${block.heading ? `<h2 id="section-${++number}">${esc(block.heading)}</h2>` : ""}${block.paragraphs.map(renderParagraph).join("")}</section>`
  ).join("");
}
function chart(m) {
  let previous = "";
  return `<section class="breakout evidence" id="benchmarks"><div class="breakout-heading"><div><p class="quiet">Evaluation record</p><h2>Evidence, in context.</h2></div><p>Same harness. Same day.<br>Every score links to its recorded row.</p></div><figure aria-label="Benchmark results" class="benchmark-chart" data-entered="false"><div class="chart-axis"><span>Recorded score</span><div class="chart-ticks"><span>0</span><span>50</span><span>100</span></div><span aria-hidden="true"></span></div>${m.rows.map((r) => {
    const group = r.benchmark + " " + r.eval_date;
    const heading = previous !== group ? `<div class="chart-group-heading"><h3>${esc(r.benchmark)}</h3><a href="#row-${esc(r.id)}">${esc(r.eval_date)}</a></div>` : "";
    previous = group;
    return `${heading}<div class="bar-row" data-subject-model="${r.subject === m.slug}" data-row-id="${esc(r.id)}" data-cited="true"><a class="bar-name" href="#row-${esc(r.id)}">${esc(r.subject_name)}<small>${esc(r.organisation)}</small></a><div class="bar-track"><div class="bar" style="--score:${Number(r.score)}%"></div></div><a class="bar-score" href="#row-${esc(r.id)}">${esc(r.score)}</a></div>`;
  }).join(
    ""
  )}<div class="delta-line"><a data-tether-delta></a></div><div class="tether-bracket" hidden aria-hidden="true"></div></figure><svg class="tether-svg" aria-hidden="true"><path hidden data-tether-line="" d="M 0 0 L 1 1"/></svg></section><section class="breakout evaluation-table" id="recorded-rows"><h2>Recorded evaluation rows</h2><div class="table-frame" tabindex="0"><table aria-label="Recorded evaluation rows"><thead><tr><th scope="col">Model</th><th scope="col">Organisation</th><th scope="col">Benchmark</th><th scope="col">Evaluation date</th><th scope="col">Score</th></tr></thead><tbody>${m.rows.map((r) => `<tr id="row-${esc(r.id)}"><td data-label="Model">${esc(r.subject_name)}</td><td data-label="Organisation">${esc(r.organisation)}</td><td data-label="Benchmark">${esc(r.benchmark)}</td><td data-label="Evaluation date"><a href="#row-${esc(r.id)}">${esc(r.eval_date)}</a></td><td data-label="Score"><a href="#row-${esc(r.id)}">${esc(r.score)}</a></td></tr>`).join("")}</tbody></table></div></section>`;
}
function gallery(m) {
  return `<section class="breakout samples" id="samples" aria-label="Samples"><div class="breakout-heading"><div><p class="quiet">Generated studies</p><h2>Samples from the model.</h2></div><p>Listen closely. Look frame by frame.</p></div>${m.samples_available === false ? '<p class="notice">Samples are unavailable right now. The recorded benchmarks above are unaffected.</p>' : !m.samples.length ? "<p>No samples recorded for this model.</p>" : `<div class="sample-grid">${m.samples.map(
    (s) => s.kind === "audio" ? `<article class="audio-sample"><h3>${esc(s.title)}</h3><svg class="waveform" aria-hidden="true" viewBox="0 0 400 60">${Array.from(
      { length: 65 },
      (_, i) => {
        const h = 4 + Math.abs(
          Math.sin(i * 0.39 + s.id.length) * Math.sin(i * (0.11 + s.id.length / 200))
        ) * 48;
        return `<path d="M${i * 6 + 5} ${30 - h / 2}v${h}"/>`;
      }
    ).join(
      ""
    )}</svg><audio preload="none" src="${esc(s.urls[0])}" data-audio="${s.id}"></audio><div class="sample-controls"><button type="button" data-play="${s.id}">${icon("play")} Play ${esc(s.title)}</button><button type="button" data-pause="${s.id}">${icon("pause")} Pause ${esc(s.title)}</button></div></article>` : `<article class="image-sample" data-sequence="${esc(JSON.stringify(s.urls))}"><div><h3>${esc(s.title)}</h3><p>A gradual recovery of structure.</p></div><div class="frame-view" tabindex="0" aria-label="${esc(s.title)}"><img src="${esc(s.urls[0])}" width="640" height="360" alt="${esc(s.title)}, frame 1"></div><div class="sample-controls"><button type="button" data-frame="previous">Previous frame</button><span role="status" aria-label="Frame position">Frame 1 of ${s.urls.length}</span><button type="button" data-frame="next">Next frame</button></div></article>`
  ).join("")}</div>`}</section>`;
}
async function homePage() {
  const data = await homeData();
  return html(
    "The open record of Aldermoor Labs",
    `<div class="home-sheet"><div class="home-intro"><p class="intro-note">Research that can be read, questioned and traced.</p><h1>The open record of Aldermoor Labs</h1><p class="standfirst">What we build. How we know.<br>And the decisions we put our names to.</p></div><ol class="theses" aria-label="Theses" data-thesis-progress="0.00">${data.theses.map((t, i) => `<li class="thesis" data-reveal="pending"${i === 0 ? ' data-current="true"' : ""}><span class="thesis-number" aria-hidden="true">${String(t.number).padStart(2, "0")}</span><div><h2><span class="sr-only">Thesis ${t.number}. </span>${esc(t.heading)}</h2><p>${esc(t.body)}</p></div></li>`).join("")}</ol><aside class="latest" aria-label="Latest from the record"><h2>Latest from <br>the record</h2><ol>${data.rail.map((r) => `<li><span class="kind">${r.kind === "model" ? "Model" : "News"}</span><a href="${r.url}">${esc(r.title)}</a>${publication(r.published_at)}</li>`).join("")}</ol></aside></div>`,
    { active: "thesis" }
  );
}
async function modelsPage(asOf) {
  const data = await modelsData(asOf);
  return html(
    "Model routes",
    `${asOfBanner(asOf, "/models")}<div class="page-heading"><h1>Model routes</h1><p class="standfirst">A model is more than its best result.<br>Read the evidence, the limits and the release record.</p></div><div class="catalogue">${data.items.map((m) => `<article><p class="quiet">Aldermoor Labs</p><h2><a href="${esc(withAsOf(`/models/${m.slug}`, asOf))}" style="view-transition-name: t-model-${esc(m.slug)}">${esc(m.title)}</a></h2><p>${esc(m.summary)}</p>${publication(m.published_at)}<a class="text-link" href="${esc(withAsOf(`/models/${m.slug}`, asOf))}">Read the model route</a></article>`).join("")}</div>`
  );
}
async function modelPage(slug, asOf) {
  const m = await modelData(slug, asOf);
  const nav = [
    ...m.sections,
    { id: "benchmarks", heading: "Benchmark results" },
    { id: "recorded-rows", heading: "Recorded evaluation rows" },
    { id: "samples", heading: "Samples" }
  ];
  return html(
    m.title,
    `${asOfBanner(asOf, `/models/${slug}`)}<article class="longform model-route" data-model="${esc(JSON.stringify(m))}"><header class="article-heading"><p class="quiet">Model route / Aldermoor Labs</p><h1 style="view-transition-name: t-model-${esc(m.slug)}">${esc(m.title)}</h1><p class="standfirst">${esc(m.summary)}</p><div class="metadata"><span>${m.read_time_minutes} min read</span>${publication(m.published_at)}</div></header><div class="longform-body">${sectionNav(nav)}<div class="article-prose">${renderBody(m.body, m.claims, m.rows)}<div class="sr-only">${status("Claim tether")}</div></div></div>${chart(m)}${gallery(m)}${m.linked_news ? `<div class="article-prose linked-record"><p>From the newsroom</p><a href="${esc(withAsOf(`/news/${m.linked_news.slug}`, asOf))}">${esc(m.linked_news.title)}</a></div>` : ""}</article>`
  );
}
function facetUrl(query, key, value) {
  const q = new URLSearchParams(query);
  q.delete("page");
  if (value) q.set(key, value);
  else q.delete(key);
  return "/news" + (q.size ? "?" + q.toString() : "");
}
async function newsroomPage(query) {
  const data = await newsroomData(query);
  const asOf = parseAsOf(query.get("as_of"));
  return html(
    "Newsroom",
    `${asOfBanner(asOf, "/news")}<div class="page-heading newsroom-heading"><h1>Newsroom</h1><p class="standfirst">Research, decisions and work in progress.<br>The published record of Aldermoor Labs.</p></div><div class="news-layout"><aside class="facets"><nav aria-label="Subjects"><h2>Subjects</h2><a href="${esc(facetUrl(query, "subject", ""))}"${!query.get("subject") ? ' aria-current="true"' : ""}>All subjects</a>${data.facets.subjects.map((s) => `<a href="${esc(facetUrl(query, "subject", s.value))}"${query.get("subject") === s.value ? ' aria-current="true"' : ""}>${s.label} (${s.count})</a>`).join("")}</nav><nav aria-label="Tags"><h2>Tags</h2><a href="${esc(facetUrl(query, "tag", ""))}"${!query.get("tag") ? ' aria-current="true"' : ""}>All tags</a>${data.facets.tags.map((t) => `<a href="${esc(facetUrl(query, "tag", t.value))}"${query.get("tag") === t.value ? ' aria-current="true"' : ""}>${esc(t.value)} (${t.count})</a>`).join("")}</nav>${query.get("subject") || query.get("tag") ? `<a href="${esc(withAsOf("/news", asOf))}">Clear filters</a>` : ""}</aside><div class="news-list">${data.items.length ? data.items.map((p) => `<article><div class="news-meta"><span>${esc(subjects[p.subject] || p.subject)}</span><span>${p.read_time_minutes} min read</span></div><h2><a href="${esc(withAsOf(`/news/${p.slug}`, asOf))}" style="view-transition-name: t-news-${esc(p.slug)}">${esc(p.title)}</a></h2><p>${esc(p.summary)}</p>${publication(p.published_at)}</article>`).join("") : `<div class="empty">${emptyDrawing()}<p>No posts match these filters.</p><a href="${esc(withAsOf("/news", asOf))}">Clear filters</a></div>`}${data.pages > 1 ? `<nav aria-label="Pages">${data.page > 1 ? `<a href="${esc("/news?" + new URLSearchParams({ ...Object.fromEntries(query), page: String(data.page - 1) }))}">Previous page</a>` : ""}<span>Page ${data.page} of ${data.pages}</span>${data.page < data.pages ? `<a href="${esc("/news?" + new URLSearchParams({ ...Object.fromEntries(query), page: String(data.page + 1) }))}">Next page</a>` : ""}</nav>` : ""}</div></div>`,
    { active: "news" }
  );
}
async function newsPage(slug, asOf) {
  const p = await newsData(slug, asOf);
  return html(
    p.title,
    `${asOfBanner(asOf, `/news/${slug}`)}<article class="longform"><header class="article-heading"><p class="quiet">${esc(subjects[p.subject])}</p><h1 style="view-transition-name: t-news-${esc(p.slug)}">${esc(p.title)}</h1><p class="standfirst">${esc(p.summary)}</p><div class="metadata"><span>${p.read_time_minutes} min read</span>${publication(p.published_at)}</div><div class="tags">${p.tags.map((t) => `<a href="/news?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div></header><div class="longform-body">${sectionNav(sections(p.body))}<div class="article-prose">${renderBody(p.body)}${p.linked_model ? `<div class="linked-record"><p>The evidence behind this announcement</p><a href="${esc(withAsOf(`/models/${p.linked_model.slug}`, asOf))}">${esc(p.linked_model.title)}</a></div>` : ""}</div></div></article>`,
    { active: "news" }
  );
}
function searchUrl(q, kind) {
  const params = new URLSearchParams({ q });
  if (kind) params.set("kind", kind);
  return "/search?" + params.toString();
}
function passage(highlight) {
  const text = highlight.replace(/<\/?mark>/g, "");
  const lead = /^[\p{Ll}\d,;:)]/u.test(text) ? "\u2026" : "";
  const trail = /[.!?”’"')]$/u.test(text) ? "" : "\u2026";
  return lead + highlight + trail;
}
async function searchPage(query) {
  const q = query.get("q"), kind = query.get("kind") || "";
  let results = "", message = "";
  if (q !== null) {
    const request = new URLSearchParams(query);
    request.set("limit", "3");
    try {
      const page = await searchData(request);
      message = `Showing ${page.items.length} results.`;
      results = page.items.length ? `<ol class="search-results" aria-label="Search results">${page.items.map((item) => `<li><span class="kind">${kindLabels[item.kind]}</span><h2><a href="${esc(item.url)}">${esc(item.title)}</a></h2>${publication(item.published_at)}<p class="highlight">${passage(item.highlight)}</p></li>`).join("")}</ol>${page.next_cursor ? `<a class="more-results" href="${esc(searchUrl(q, kind) + "&cursor=" + encodeURIComponent(page.next_cursor))}">More results</a>` : ""}` : `<ol class="search-results" aria-label="Search results"></ol><div class="empty">${emptyDrawing()}<p>Nothing in the published record matches \u201C${esc(q)}\u201D.</p></div>`;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 422) throw error;
      message = Object.values(error.fields || {})[0] || error.message;
    }
  }
  const kindLink = (value, label) => `<a href="${esc(q === null ? value ? `/search?kind=${value}` : "/search" : searchUrl(q, value))}"${kind === value ? ' aria-current="true"' : ""}>${label}</a>`;
  return html(
    "Search the record",
    `<div class="search-sheet"><div class="search-heading"><h1>Search the record</h1><form role="search" aria-label="Search the record" method="get" action="/search" data-search><label class="field" for="field-search-terms"><span>Search terms</span><input type="search" id="field-search-terms" name="q" aria-label="Search terms" value="${esc(q || "")}"></label>${kind ? `<input type="hidden" name="kind" value="${esc(kind)}">` : ""}<button type="submit">Search</button></form></div><nav class="search-kinds" aria-label="Kinds"><p class="rail-label">Kinds</p>${kindLink("", "All kinds")}${kindLink("model", "Models")}${kindLink("news", "News")}${kindLink("role", "Roles")}</nav><div class="search-body">${status("Search status", message)}${results}</div></div>`,
    { active: "search" }
  );
}
async function careersPage(query, notice = "", error = "") {
  const roles = await rolesData(query), benefits = await benefitsData();
  return html(
    "Careers",
    `<div class="page-heading"><h1>Work worth standing behind.</h1><p class="standfirst">Bring careful thinking to the frontier.<br>Open roles at Aldermoor Labs.</p></div><form aria-label="Filter roles" method="get" action="/careers" class="filters" data-role-filters>${select(
      "Discipline",
      "discipline",
      ["research", "engineering", "policy", "operations"].map((v) => [
        v,
        v[0].toUpperCase() + v.slice(1)
      ]),
      query.get("discipline") || "",
      "Any"
    )}${select(
      "Office",
      "office",
      Object.entries(offices).map(([v, o]) => [v, o.label]),
      query.get("office") || "",
      "Any"
    )}${select("Region", "region", Object.entries(regions), query.get("region") || "", "Any")}<button type="submit">Show roles</button></form><section class="roles"><h2>Open roles</h2>${roles.items.length ? roles.items.map((r) => `<article class="role-row"><h3><a href="/careers/${r.slug}">${esc(r.title)}</a></h3><p>${esc(disciplineLabel(r.discipline))}<span>${esc(r.office_label)}</span><span>${esc(r.region_label)}</span></p></article>`).join("") : `<div class="empty">${emptyDrawing()}<p>No open roles match these filters.</p></div>`}</section><section class="benefits" aria-label="Benefits by region"><h2>Benefits by region</h2><div class="benefits-grid">${benefits.regions.map((r) => `<article><h3>${esc(r.label)}</h3><p>${r.entry ? esc(r.entry.summary) : "No benefits entry in force yet."}</p>${r.entry ? `<small>In force from <span class="number">${esc(r.entry.effective_from)}</span></small>` : ""}</article>`).join("")}</div></section>${resendForm(notice, error)}`,
    { active: "careers" }
  );
}
async function rolePage(slug, notice = "", errors = {}, values = {}) {
  const r = await roleData(slug);
  return html(
    r.title,
    `<article class="longform"><header class="article-heading"><p class="quiet">${esc(disciplineLabel(r.discipline))} / ${esc(r.office_label)}</p><h1>${esc(r.title)}</h1><p class="standfirst">${esc(r.office_label)}, ${esc(r.region_label)}</p></header><div class="longform-body">${sectionNav([...sections(r.description), { id: "role-benefits", heading: "Regional benefits" }, { id: "apply", heading: "Apply for this role" }])}<div class="article-prose">${renderBody(r.description)}<section id="role-benefits" class="prose-section" data-reveal="pending"><h2>Regional benefits</h2><p>${esc(r.benefits?.summary || "No benefits entry in force yet.")}</p></section><section id="apply" class="application-form prose-section" data-reveal="pending"><h2>Apply for this role</h2><p>Your application goes directly to the recruiters for this role. We will email a receipt and a private link to follow your progress.</p><form aria-label="Apply for ${esc(r.title)}" method="post" action="/careers/${slug}" enctype="multipart/form-data" data-mode="application" data-endpoint="/api/careers/roles/${slug}/applications" novalidate>${input("Full name", "name", values.name || "", { error: errors.name })}${input("Email", "email", values.email || "", { type: "email", error: errors.email })}<label class="field" for="field-resume"><span>R\xE9sum\xE9 (PDF)</span><input aria-label="R\xE9sum\xE9 (PDF)" type="file" id="field-resume" name="resume" accept="application/pdf"><small>PDF, up to 5,000,000 bytes.</small><span class="field-error" data-error="resume">${esc(errors.resume || "")}</span></label><label class="consent"><input type="checkbox" name="consent" value="yes"><span>I consent to Aldermoor Labs processing my application</span></label><span class="field-error" data-error="consent">${esc(errors.consent || "")}</span><button type="submit">Submit application</button>${status("Application status", notice)}</form></section></div></div></article>`,
    { active: "careers" }
  );
}
async function trackingPage(token, notice = "", showDialog = false) {
  const t = await tracking(token);
  return html(
    t.role.title,
    `<div class="tracking-page"><p class="quiet">Your Aldermoor application</p><h1>${esc(t.role.title)}</h1><p class="standfirst">${esc(t.role.office)}</p><div class="tracking-current"><span>Current stage</span><h2>${esc(t.stage_label)}</h2></div><ol class="stage-progress" aria-label="Stage progress">${[
      "submitted",
      "screening",
      "interview",
      "final_review",
      "offer"
    ].concat(
      t.stage === "declined" || t.stage === "withdrawn" ? [t.stage] : []
    ).map(
      (s, i) => `<li${s === t.stage ? ' aria-current="step"' : ""}><span class="step-number">${i + 1}</span><span>${stageLabels[s]}${s === "submitted" ? `<small>${date(t.submitted_at)}</small>` : s === t.stage ? `<small>${date(t.stage_changed_at)}</small>` : ""}</span></li>`
    ).join(
      ""
    )}</ol><dl class="dates"><div><dt>Submitted</dt><dd>${date(t.submitted_at)}</dd></div><div><dt>Last changed</dt><dd>${date(t.stage_changed_at)}</dd></div></dl>${activeStage(t.stage) ? `<button class="script-control" type="button" data-open-dialog="withdraw-application">Withdraw application</button><noscript><form method="post"><input type="hidden" name="_intent" value="withdraw-question"><button type="submit">Withdraw application</button></form></noscript>${dialog("withdraw-application", "Withdraw application?", `<p>This ends your application for this role.</p>${form("Withdraw application", `/api/track/${esc(token)}/withdraw`, '<input type="hidden" name="_intent" value="withdraw-confirm"><button type="submit">Withdraw</button>', { success: "Your application has been withdrawn.", mode: "withdraw-application" })}`, "Keep my application", `/track/${token}`).replace('<dialog id="withdraw-application"', showDialog ? '<dialog open id="withdraw-application"' : '<dialog id="withdraw-application"')}` : ""}${status("Application status", notice)}</div>`
  );
}
function consoleStatus(query) {
  return status("Console status", query.get("notice") || "");
}
async function consoleHome(staff, query) {
  const content = hasRole(staff, "editor") || hasRole(staff, "approver") ? await all(pool, "content") : [];
  const reqs = hasRole(staff, "recruiter") ? (await all(pool, "requisitions")).filter(
    (r) => r.recruiters.includes(staff.email)
  ) : [];
  const items = content.filter(
    (c) => hasRole(staff, "approver") || c.author === staff.email
  );
  return html(
    "Work queue",
    `<div class="console-heading"><div><p class="quiet">Governed console</p><h1>Work queue</h1></div>${hasRole(staff, "editor") ? '<div class="actions"><a class="button" href="/console/content/new?kind=news">Draft news post</a><a class="button" href="/console/content/new?kind=model">Draft model route</a></div>' : ""}</div>${consoleStatus(query)}<div class="console-grid"><aside class="console-list" tabindex="0"><h2>Your access</h2>${staff.roles.map((r) => `<p>${esc(r.role)}<small>Until ${date(r.expires_at)}</small></p>`).join("") || "<p>Your current roles do not allow this.</p>"}${hasRole(staff, "administrator") ? '<a href="/console/grants">Manage role grants</a><a href="/console/audit">Read the audit record</a>' : ""}${hasRole(staff, "recruiter") ? '<a href="/console/requisitions">Manage requisitions</a><a href="/console/benefits">Record regional benefits</a>' : ""}</aside><div>${[
      "draft",
      "in_review",
      "returned",
      "approved",
      "scheduled",
      "published",
      "withdrawn"
    ].filter((s) => items.some((c) => c.status === s)).map(
      (s) => `<section class="queue-group"><h2>${s.replace("_", " ")} <span class="number">(${items.filter((c) => c.status === s).length})</span></h2>${items.filter((c) => c.status === s).map(
        (c) => `<div class="queue-row">${contentLink(c)}<span>${c.kind === "model" ? "Model route" : "News post"}</span></div>`
      ).join("")}</section>`
    ).join(
      ""
    )}${reqs.map((r) => `<div class="queue-row"><a href="/console/requisitions/${r.id}">${esc(r.title)}</a><span>${r.status}</span></div>`).join("")}</div></div>`,
    { staff, console: true }
  );
}
async function contentPage(staff, c, kind, query) {
  requireRole(staff, "editor", "approver");
  if (!c && !hasRole(staff, "editor")) forbidden();
  const endpoint = c ? `/api/console/content/${c.id}` : "/api/console/content";
  const editable = !c || c.author === staff.email && ["draft", "returned"].includes(c.status);
  const record = c && kind === "model" ? await one(pool, "release_records", c.id) : null;
  const sameAuthor = c?.author === staff.email;
  const prefix = c ? `/api/console/content/${c.id}/` : "";
  const content = await all(pool, "content");
  const editorForm = `<form aria-label="Content editor" data-endpoint="${endpoint}" data-method="${c ? "PATCH" : "POST"}" data-mode="content" data-success="Draft saved." method="post"><input type="hidden" name="kind" value="${kind}"><fieldset${!editable ? " disabled" : ""}>${input("Title", "title", c?.title || "")}${input("Slug", "slug", c?.slug || "")}${input("Summary", "summary", c?.summary || "", { textarea: true })}${input("Body", "body", c?.body || "", { textarea: true, hint: kind === "model" ? "Use ## for section headings and [claim:c1] for a claim marker." : "Use ## for section headings and blank lines for paragraphs." })}${kind === "news" ? select("Subject", "subject", Object.entries(subjects), c?.subject || "research") + input("Tags", "tags", c?.tags?.join(", ") || "", { hint: "Separate tags with commas." }) : input("Claims", "claims", JSON.stringify(c?.claims || [], null, 2), { textarea: true, hint: "Each claim records id, text, benchmark, eval_date, comparator and stated_delta." }) + input("Linked announcement slug", "linked_news_slug", c?.linked_news_slug || "")}${editable ? '<button type="submit">Save draft</button>' : ""}</fieldset></form>`;
  const actions = c ? `<section class="editor-actions"><h2>Review and release</h2><div class="actions">${sameAuthor && hasRole(staff, "editor") && ["draft", "returned"].includes(c.status) ? button("Submit for review", prefix + "submit", ' data-success="Submitted for review."') : ""}${!sameAuthor && hasRole(staff, "approver") && c.status === "in_review" ? button("Approve", prefix + "approve", ' data-success="Approved."') + '<button type="button" data-open-dialog="return-item">Return to author</button>' : ""}${!sameAuthor && hasRole(staff, "approver") && c.status === "approved" ? '<button type="button" data-open-dialog="schedule-item">Schedule release</button>' : ""}${!sameAuthor && hasRole(staff, "approver") && c.status === "scheduled" ? button("Release now", prefix + "release", ' data-success="Released."') : ""}${hasRole(staff, "approver") && ["published", "scheduled"].includes(c.status) ? '<button type="button" data-open-dialog="withdraw-item">Withdraw</button>' : ""}</div></section>${dialog("return-item", "Return to author", form("Return to author", prefix + "return", input("Reason", "reason") + '<button type="submit">Return</button>', { success: "Returned to author." }))}${dialog("schedule-item", "Schedule release", form("Schedule release", prefix + "schedule", input("Release time (London)", "release_at_local", "", { hint: "YYYY-MM-DDTHH:mm, Europe/London" }) + '<p class="quiet" data-schedule-preview></p><button type="submit">Confirm schedule</button>', { mode: "schedule" }))}${dialog("withdraw-item", "Withdraw this item?", `<p>This item will leave every public list.</p>${form("Withdraw this item", prefix + "withdraw", '<button type="submit">Confirm withdrawal</button>', { success: "Withdrawn." })}`)}` : "";
  const release = record ? `<section class="release-record" aria-label="Release record"><div class="panel-heading"><h2>Release record</h2><span class="state">${esc(record.status.replaceAll("_", " "))}</span></div><dl><div><dt>Safety</dt><dd>${record.safety ? esc(record.safety.by) : "Awaiting sign-off"}</dd></div><div><dt>Legal</dt><dd>${record.legal ? esc(record.legal.by) : "Awaiting sign-off"}</dd></div></dl><div class="actions">${!sameAuthor && hasRole(staff, "approver") ? button("Record safety sign-off", prefix + "release-record/signoffs", ' data-body="' + esc(JSON.stringify({ kind: "safety", note: "" })) + '" data-success="Safety sign-off recorded."') + button("Record legal sign-off", prefix + "release-record/signoffs", ' data-body="' + esc(JSON.stringify({ kind: "legal", note: "" })) + '" data-success="Legal sign-off recorded."') : ""}${button("Validate claims", prefix + "release-record/validate-claims", ' data-success="Claims validated."')}${!sameAuthor && hasRole(staff, "approver") ? button("Clear release record", prefix + "release-record/clear", ' data-success="Release record cleared."') : ""}</div>${(record.last_validation || []).map((v) => `<p>${esc(v.claim)}: ${v.ok ? "Validated" : esc(v.reason)}</p>`).join("")}</section>` : "";
  const comments = c ? `<section class="comments"><h2>Comments</h2>${c.comments.map((v) => `<article><p>${esc(v.body)}</p><small>${esc(v.author)} / ${date(v.created_at)}</small></article>`).join("")}${["draft", "in_review", "returned", "approved"].includes(c.status) ? form("Add comment", prefix + "comments", input("Comment", "body", "", { textarea: true }) + '<button type="submit">Add comment</button>', { success: "Comment added." }) : "<p>Comments are closed.</p>"}</section>` : "";
  return html(
    c?.title || `New ${kind === "model" ? "model route" : "news post"}`,
    `<div class="console-heading"><div><p class="quiet">${kind === "model" ? "Model route" : "News post"}</p><h1>${c ? "Content record" : `New ${kind === "model" ? "model route" : "news post"}`}</h1></div>${c ? `<span class="state">${esc(c.status.replaceAll("_", " "))} / Version ${c.version}</span>` : ""}</div>${consoleStatus(query)}<div class="console-grid" data-record-version="${c?.version || ""}"><aside class="console-list" tabindex="0"><h2>Content</h2>${content.map((v) => `<div class="list-item">${contentLink(v)}<small>${v.status.replaceAll("_", " ")}</small></div>`).join("")}</aside><div class="console-detail">${editorForm}${actions}${release}${comments}</div></div>`,
    { staff, console: true }
  );
}
async function rowsPage(staff, query) {
  requireRole(staff, "editor", "approver");
  const rows = await all(pool, "benchmark_rows");
  return html(
    "Benchmark rows",
    `<div class="console-heading"><h1>Benchmark rows</h1><p>Recorded once. Preserved as evidence.</p></div>${consoleStatus(query)}${table(
      "Benchmark rows",
      ["Model", "Organisation", "Benchmark", "Evaluation date", "Score"],
      rows.map((r) => [
        esc(r.subject_name),
        esc(r.organisation),
        esc(r.benchmark),
        esc(r.eval_date),
        esc(r.score)
      ])
    )}<section class="compact-form"><h2>Record a benchmark row</h2>${form("Record a benchmark row", "/api/console/benchmark-rows", input("Subject", "subject") + input("Benchmark", "benchmark") + input("Evaluation date", "eval_date", "", { type: "date" }) + input("Score", "score") + input("Source note", "source_note", "", { textarea: true }) + '<button type="submit">Record row</button>', { success: "Row recorded." })}</section>`,
    { staff, console: true }
  );
}
async function requisitionsPage(staff, query) {
  requireRole(staff, "recruiter");
  const reqs = (await all(pool, "requisitions")).filter(
    (r) => r.recruiters.includes(staff.email)
  );
  return html(
    "Requisitions",
    `<div class="console-heading"><h1>Requisitions</h1><p>Roles, people and accountable decisions.</p></div>${consoleStatus(query)}<div class="console-grid"><aside class="console-list" tabindex="0"><h2>Your requisitions</h2>${reqs.map((r) => `<div class="list-item"><a href="/console/requisitions/${r.id}">${esc(r.title)}</a><small>${r.status}</small></div>`).join("")}</aside><section><h2>Create a requisition</h2>${form(
      "Create a requisition",
      "/api/console/requisitions",
      input("Title", "title") + input("Slug", "slug") + select(
        "Discipline",
        "discipline",
        ["research", "engineering", "policy", "operations"].map((x) => [
          x,
          x
        ])
      ) + select(
        "Office",
        "office",
        Object.entries(offices).map(([v, o]) => [v, o.label])
      ) + input("Description", "description", "", { textarea: true }) + input("Recruiters", "recruiters", staff.email, {
        hint: "Separate staff email addresses with commas."
      }) + '<button type="submit">Create requisition</button>',
      { mode: "requisition", success: "Draft saved." }
    )}</section></div>`,
    { staff, console: true }
  );
}
async function requisitionPage(staff, rid, query) {
  const r = await one(pool, "requisitions", rid);
  if (!r || !r.recruiters.includes(staff.email)) notFound();
  requireRole(staff, "recruiter");
  const apps = (await all(pool, "applications")).filter(
    (a) => a.requisition_id === r.id
  );
  return html(
    r.title,
    `<div class="console-heading"><div><p class="quiet">Requisition / ${esc(r.status)}</p><h1>${esc(r.title)}</h1></div><div class="actions">${r.status === "draft" ? button("Open requisition", `/api/console/requisitions/${r.id}/open`, ' data-success="Requisition opened."') : r.status === "open" ? '<button type="button" data-open-dialog="close-requisition">Close requisition</button>' : ""}</div></div>${consoleStatus(query)}<div class="console-grid" data-record-version="${r.version}"><aside class="console-list" tabindex="0"><h2>Role record</h2><p>${esc(r.discipline)}</p><p>${esc(offices[r.office].label)}</p><p>${esc(regions[offices[r.office].region])}</p><small>${r.recruiters.map(esc).join("<br>")}</small>${r.status === "open" ? `<a href="/careers/${r.slug}">View public role</a>` : ""}</aside><div>${Object.entries(
      stageLabels
    ).map(
      ([s, label]) => `<section class="queue-group"><h2>${label} <span class="number">(${apps.filter((a) => a.stage === s).length})</span></h2>${apps.filter((a) => a.stage === s).map(
        (a) => `<div class="queue-row"><a href="/console/applications/${a.id}">${esc(a.name)}</a><span>${esc(a.reference)}</span></div>`
      ).join("")}</section>`
    ).join(
      ""
    )}</div></div>${dialog("close-requisition", "Close requisition", `<p>Active applications will move to Not progressing with this reason.</p>${form("Close requisition", `/api/console/requisitions/${r.id}/close`, input("Reason", "reason") + '<button type="submit">Close requisition</button>', { success: "Requisition closed." })}`)}`,
    { staff, console: true }
  );
}
async function applicationPage(staff, aid, query) {
  const a = await one(pool, "applications", aid);
  if (!a) notFound();
  const r = await one(pool, "requisitions", a.requisition_id);
  if (!r.recruiters.includes(staff.email)) notFound();
  requireRole(staff, "recruiter");
  const endpoint = `/api/console/applications/${a.id}/`;
  return html(
    a.name,
    `<div class="console-heading"><div><p class="quiet">Application ${esc(a.reference)}</p><h1>${esc(a.name)}</h1></div><span class="state">${stageLabels[a.stage]}</span></div>${consoleStatus(query)}<div class="console-grid" data-record-version="${a.version}"><aside class="console-list" tabindex="0"><h2>${esc(r.title)}</h2><p>${esc(a.email)}</p><p>Submitted ${date(a.submitted_at)}</p><a href="${endpoint}resume">Download r\xE9sum\xE9</a>${button("Reissue tracking link", endpoint + "tracking-link/reissue", ' data-success="A new tracking link is on its way to the candidate."')}<a href="/console/requisitions/${r.id}">Back to requisition</a></aside><div><section><h2>Record a decision</h2>${form("Move application", endpoint + "stage", select("Move to stage", "to", Object.entries(stageLabels)) + input("Decision rationale", "rationale", "", { textarea: true }) + '<button type="submit">Record decision</button>', { success: "Decision recorded. The candidate will be told the new stage by email." })}</section><section class="comments"><h2>Interview notes</h2>${a.notes.map((n) => `<article><p>${esc(n.body)}</p><small>${esc(n.by)} / ${date(n.at)}</small></article>`).join("")}${form("Add interview note", endpoint + "notes", input("Interview note", "body", "", { textarea: true }) + '<button type="submit">Add note</button>', { success: "Note added." })}</section><section class="comments"><h2>Stage decisions</h2>${a.decisions.map((d) => `<article><h3>${stageLabels[d.from]} to ${stageLabels[d.to]}</h3><p>${esc(d.rationale)}</p><small>${esc(d.by)} / ${date(d.at)}</small></article>`).join("") || "<p>No stage decisions recorded yet.</p>"}</section></div></div>`,
    { staff, console: true }
  );
}
async function benefitsPage(staff, query) {
  requireRole(staff, "recruiter");
  const entries = await all(pool, "benefits");
  return html(
    "Benefits register",
    `<div class="console-heading"><h1>Benefits register</h1><p>Regional entries, in force by their effective date.</p></div>${consoleStatus(query)}<div class="console-grid"><aside class="console-list" tabindex="0"><h2>Recorded entries</h2>${entries.sort((a, b) => b.effective_from.localeCompare(a.effective_from)).map(
      (e) => `<article class="list-item"><h3>${esc(regions[e.region])}</h3><p>${esc(e.summary)}</p><small>${esc(e.effective_from)}</small></article>`
    ).join(
      ""
    )}</aside><section><h2>Record a benefits entry</h2>${form("Record a benefits entry", "/api/console/benefits", select("Region", "region", Object.entries(regions)) + input("Effective from", "effective_from", "", { type: "date" }) + input("Summary", "summary", "", { textarea: true }) + '<button type="submit">Record benefits entry</button>', { success: "Benefits entry recorded." })}</section></div>`,
    { staff, console: true }
  );
}
async function grantsPage(staff, query) {
  requireRole(staff, "administrator");
  const grants = (await all(pool, "grants")).map(grantShape);
  return html(
    "Role grants",
    `<div class="console-heading"><h1>Role grants</h1><p>Access belongs to a person, a purpose and an end date.</p></div>${consoleStatus(query)}<div class="grants-form"><h2>Grant a role</h2>${form(
      "Grant a role",
      "/api/console/grants",
      input("Staff email", "staff_email", "", { type: "email" }) + select(
        "Role",
        "role",
        ["editor", "approver", "recruiter", "administrator"].map((v) => [
          v,
          v[0].toUpperCase() + v.slice(1)
        ])
      ) + input("Expires (London)", "expires_at", "", {
        hint: "YYYY-MM-DDTHH:mm"
      }) + '<button type="submit">Grant role</button>',
      { success: "Role granted.", mode: "grant" }
    )}</div>${table(
      "Grants",
      ["Staff", "Role", "Expires", "Status", "Action"],
      grants.map((g) => [
        esc(g.staff_email),
        esc(g.role),
        date(g.expires_at),
        esc(g.status),
        g.status === "active" ? button(
          `Revoke ${g.role} for ${g.staff_email}`,
          `/api/console/grants/${g.id}/revoke`,
          ` data-success="Role revoked." data-version="${g.version}"`
        ) : "\u2014"
      ])
    )}`,
    { staff, console: true }
  );
}
async function auditPage(staff, query) {
  requireRole(staff, "administrator");
  const entries = await listAudit(query);
  const oldest = entries[entries.length - 1];
  return html(
    "Audit record",
    `<div class="console-heading"><h1>Audit record</h1><p>Every change, attributed and preserved.</p></div>${consoleStatus(query)}<div class="actions"><button type="button" data-verify-chain>Verify chain</button></div>${table(
      "Audit record",
      ["Seq", "When", "Actor", "Action", "Target", "Detail"],
      entries.map((e) => [
        `<span class="number">${e.seq}</span>`,
        esc(formatTime(e.at)),
        esc(e.actor),
        esc(e.action),
        `${esc(e.target_type)}<small>${esc(e.target_id)}</small>`,
        esc(JSON.stringify(e.detail))
      ])
    )}${oldest && oldest.seq > 1 ? `<a class="text-link" href="/console/audit?before_seq=${oldest.seq}">Older entries</a>` : ""}`,
    { staff, console: true }
  );
}
async function jobsPage(staff, query) {
  requireRole(staff, "administrator");
  const state2 = ["pending", "dead", "done"].includes(query.get("state") || "") ? query.get("state") : "pending";
  const filter = new URLSearchParams(query);
  filter.set("state", state2);
  const jobs = await listJobs(filter);
  return html(
    "Jobs",
    `<div class="console-heading"><h1>Jobs</h1><p>Mail, erasure and sample uploads, with their attempts.</p></div>${consoleStatus(query)}<nav class="job-states" aria-label="Job states">${[
      ["pending", "Pending"],
      ["dead", "Dead"],
      ["done", "Done"]
    ].map(
      ([value, label]) => `<a href="/console/jobs?state=${value}"${state2 === value ? ' aria-current="true"' : ""}>${label}</a>`
    ).join("")}</nav>${jobs.length ? table(
      "Jobs",
      [
        "Kind",
        "State",
        "Attempts",
        "Last error",
        "Next attempt",
        "Action"
      ],
      jobs.map((j) => [
        esc(j.kind),
        esc(j.state),
        `<span class="number">${j.attempts}</span>`,
        esc(j.last_error || "\u2014"),
        j.next_attempt_at && j.state !== "done" ? esc(formatTime(j.next_attempt_at)) : "\u2014",
        j.state === "dead" ? button(
          `Retry job ${j.id}`,
          `/api/console/jobs/${j.id}/retry`,
          ' data-success="Job queued for retry." data-inline'
        ) : "\u2014"
      ])
    ) : `<div class="empty">${emptyDrawing()}<p>No jobs in this state.</p></div>`}`,
    { staff, console: true }
  );
}
async function signInPage(message = "") {
  return html(
    "Staff sign-in",
    `<div class="signin"><p class="quiet">Aldermoor staff</p><h1>Sign in to the console.</h1><p>The governed record starts with an accountable person.</p><form aria-label="Staff sign-in" method="post" action="/console/sign-in" data-endpoint="/api/console/session" data-mode="signin" novalidate>${input("Email", "email", "", { type: "email" })}${input("Password", "password", "", { type: "password" })}<button type="submit">Sign in</button>${status("Sign-in status", message)}</form></div>`
  );
}
async function errorPage(path, error) {
  if (path.startsWith("/track/"))
    return html(
      "This tracking link is not valid.",
      `<div class="status-page"><h1>This tracking link is not valid.</h1>${resendForm()}</div>`,
      {},
      404
    );
  if (error.status === 410) {
    const heading = path.startsWith("/news/") ? "This post has been withdrawn." : path.startsWith("/models/") ? "This model route has been withdrawn." : "This role has closed.";
    return html(
      heading,
      `<div class="status-page"><h1>${heading}</h1><a href="/">Return to the open record</a></div>`,
      {},
      410
    );
  }
  if (error.status === 404)
    return html(
      "Nothing is published here",
      '<div class="status-page"><h1>Nothing is published here</h1><p>The public record is available from the home page.</p><a href="/">Return to the open record</a></div>',
      {},
      404
    );
  const detail = Object.values(error.fields || {})[0];
  return html(
    "Request could not be completed",
    `<div class="status-page"><h1>${esc(detail || error.message)}</h1><a href="/">Return to the open record</a></div>`,
    {},
    error.status
  );
}
async function htmlRoute(req, url, body, multipart) {
  const path = url.pathname, q = url.searchParams;
  const method = req.method || "GET";
  if (path === "/console/sign-in") {
    if (method === "POST") {
      try {
        const signed = await signIn(body);
        return {
          status: 303,
          data: "",
          headers: {
            Location: "/console",
            "Set-Cookie": sessionCookie(signed.token, config.sessionTtl)
          }
        };
      } catch (error) {
        return signInPage(error instanceof Error ? error.message : "");
      }
    }
    return signInPage();
  }
  if (path.startsWith("/console")) {
    const staff = await sessionStaff(req);
    if (!staff)
      return {
        status: 303,
        data: "",
        headers: { Location: "/console/sign-in" }
      };
    if (path === "/console") return consoleHome(staff, q);
    if (path === "/console/content/new")
      return contentPage(
        staff,
        null,
        q.get("kind") === "model" ? "model" : "news",
        q
      );
    if (path.startsWith("/console/content/")) {
      const c = await one(
        pool,
        "content",
        path.slice("/console/content/".length)
      );
      if (!c) notFound();
      return contentPage(staff, c, c.kind, q);
    }
    if (path === "/console/rows") return rowsPage(staff, q);
    if (path === "/console/requisitions") return requisitionsPage(staff, q);
    if (path.startsWith("/console/requisitions/"))
      return requisitionPage(
        staff,
        path.slice("/console/requisitions/".length),
        q
      );
    if (path.startsWith("/console/applications/"))
      return applicationPage(
        staff,
        path.slice("/console/applications/".length),
        q
      );
    if (path === "/console/benefits") return benefitsPage(staff, q);
    if (path === "/console/grants") return grantsPage(staff, q);
    if (path === "/console/audit") return auditPage(staff, q);
    if (path === "/console/jobs") return jobsPage(staff, q);
    publicNotFound();
  }
  if (method === "POST" && str(body._intent) === "resend" && (path === "/careers" || path.startsWith("/track/"))) {
    let message = "", error = "";
    try {
      const result = await resendLinks(str(body.email));
      message = str(result.data.message);
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      message = caught.fields?.email || caught.message;
      error = caught.fields?.email || "";
    }
    if (path === "/careers") return careersPage(q, message, error);
    return html(
      "This tracking link is not valid.",
      `<div class="status-page"><h1>This tracking link is not valid.</h1>${resendForm(message, error)}</div>`
    );
  }
  if (method === "POST" && path.startsWith("/track/")) {
    const token = path.slice(7);
    if (str(body._intent) === "withdraw-question")
      return trackingPage(token, "", true);
    if (str(body._intent) === "withdraw-confirm") {
      await tracking(token, true);
      return trackingPage(token, "Your application has been withdrawn.");
    }
  }
  if (path === "/") return homePage();
  if (path === "/models") return modelsPage(parseAsOf(q.get("as_of")));
  if (path.startsWith("/models/"))
    return modelPage(
      decodeURIComponent(path.slice(8)),
      parseAsOf(q.get("as_of"))
    );
  if (path === "/news") return newsroomPage(q);
  if (path.startsWith("/news/"))
    return newsPage(
      decodeURIComponent(path.slice(6)),
      parseAsOf(q.get("as_of"))
    );
  if (path === "/search") return searchPage(q);
  if (path === "/careers") return careersPage(q);
  const application = path.match(/^\/careers\/([^/]+)$/);
  if (application && method === "POST") {
    const slug = application[1];
    try {
      await submitApplication(slug, multipart);
      return rolePage(
        slug,
        `Application received. Your receipt and tracking link are on their way to ${multipart.fields.email}.`
      );
    } catch (error) {
      if (error instanceof ApiError)
        return rolePage(slug, error.message, error.fields, multipart.fields);
      throw error;
    }
  }
  if (path.startsWith("/careers/"))
    return rolePage(decodeURIComponent(path.slice(9)));
  if (path.startsWith("/track/"))
    return trackingPage(path.slice(7), q.get("notice") || "");
  publicNotFound();
}
var csp, button, form, resendForm, disciplineLabel, withAsOf, kindLabels, hasRole, table, contentLink;
var init_pages = __esm({
  "src/pages.ts"() {
    "use strict";
    init_html();
    init_public();
    init_search();
    init_governance();
    init_config();
    init_domain();
    init_auth();
    init_db();
    init_errors();
    init_careers();
    init_governance();
    csp = "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; font-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    button = (label, action, extra = "") => `<button type="button" data-action="${esc(action)}"${extra}>${esc(label)}</button>`;
    form = (name, endpoint, body, options = {}) => `<form aria-label="${esc(name)}" data-endpoint="${esc(endpoint)}" data-method="${options.method || "POST"}"${options.success ? ` data-success="${esc(options.success)}"` : ""}${options.mode ? ` data-mode="${options.mode}"` : ""} method="post" novalidate>${body}</form>`;
    resendForm = (message = "", error = "") => `<section class="resend"><h2>Resend my tracking links</h2><p>Enter the email address you used to apply.</p>${form("Resend my tracking links", "/api/careers/tracking-links", input("Email", "email", "", { type: "email", error }) + '<input type="hidden" name="_intent" value="resend"><button type="submit">Resend links</button>' + status("Resend status", message), { mode: "resend" })}</section>`;
    disciplineLabel = (value) => value[0].toUpperCase() + value.slice(1);
    withAsOf = (path, asOf) => asOf ? `${path}?as_of=${encodeURIComponent(asOf)}` : path;
    kindLabels = {
      model: "Model",
      news: "News",
      role: "Role"
    };
    hasRole = (staff, role) => staff.roles.some((g) => g.role === role);
    table = (label, headers, rows) => `<div class="table-frame" tabindex="0"><table aria-label="${esc(label)}"><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, i) => `<td data-label="${esc(headers[i])}">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    contentLink = (c) => `<a href="/console/content/${esc(c.id)}">${esc(c.title)}</a>`;
  }
});

// src/server.ts
var import_busboy = __toESM(require_lib(), 1);
init_config();
init_db();
init_seed();
init_errors();
init_auth();
init_public();
init_search();
init_content();
init_careers();
init_governance();
init_media();
import {
  createServer
} from "node:http";
import { createHash as createHash5 } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// src/jobs.ts
init_db();
init_content();
init_governance();
init_config();
init_media();

// src/mail.ts
init_config();
import { createConnection as createConnection2 } from "node:net";
var MailRefused = class extends Error {
};
function encodeWords(text) {
  const words = [];
  let chunk2 = "";
  for (const char of text) {
    if (Buffer.byteLength(chunk2 + char) > 45) {
      words.push(chunk2);
      chunk2 = "";
    }
    chunk2 += char;
  }
  words.push(chunk2);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join(" ");
}
var plain = (text) => /^[\x20-\x7e]*$/.test(text);
var headerText = (text) => plain(text) ? text : encodeWords(text);
function mailbox(name, email2) {
  if (!plain(name)) return `${encodeWords(name)} <${email2}>`;
  if (/^[A-Za-z0-9 ]+$/.test(name)) return `${name} <${email2}>`;
  return `"${name.replace(/(["\\])/g, "\\$1")}" <${email2}>`;
}
var senderAddress = () => /<([^>]+)>/.exec(config.mailFrom)?.[1] || config.mailFrom.trim();
async function smtp(jobId, message) {
  const socket = createConnection2({
    host: config.smtpHost,
    port: config.smtpPort
  });
  socket.setTimeout(3e3);
  let buffer = "";
  const replies = [];
  let waiting = null;
  let failed = null;
  let rejectWait = null;
  socket.on("data", (part) => {
    buffer += part.toString();
    let end;
    while ((end = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3} /.test(line)) {
        if (waiting) {
          const callback = waiting;
          waiting = null;
          callback(line);
        } else replies.push(line);
      }
    }
  });
  socket.on("error", (error) => {
    failed = error;
    rejectWait?.(error);
  });
  socket.on("close", () => {
    if (waiting) {
      failed = new Error("SMTP connection closed");
      rejectWait?.(failed);
    }
  });
  socket.on("timeout", () => socket.destroy(new Error("SMTP timeout")));
  const receive = () => {
    if (failed) return Promise.reject(failed);
    const ready = replies.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve2, reject) => {
      waiting = resolve2;
      rejectWait = reject;
    });
  };
  const command = async (line, expected) => {
    socket.write(line + "\r\n");
    const answer = await receive();
    const code = Number(answer.slice(0, 3));
    if (code >= 500) throw new MailRefused(answer);
    if (code !== expected) throw new Error(answer);
  };
  try {
    const greeting = await receive();
    if (!greeting.startsWith("220")) throw new Error(greeting);
    await command("EHLO aldermoor.example", 250);
    await command(`MAIL FROM:<${senderAddress()}>`, 250);
    await command(`RCPT TO:<${message.to_email}>`, 250);
    await command("DATA", 354);
    const data = [
      `From: ${config.mailFrom}`,
      `To: ${mailbox(message.to_name, message.to_email)}`,
      `Subject: ${headerText(message.subject)}`,
      `Message-ID: <outbox-${jobId}@aldermoor.example>`,
      `Date: ${(/* @__PURE__ */ new Date()).toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(message.body).toString("base64").match(/.{1,76}/g)?.join("\r\n") || ""
    ].join("\r\n");
    await command(data + "\r\n.", 250);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
    socket.destroy();
  }
}

// src/jobs.ts
init_probes();
async function exclusively(lock, fn) {
  await transaction(async (db) => {
    const acquired = await db.query(
      "SELECT pg_try_advisory_xact_lock($1) AS locked",
      [lock]
    );
    if (acquired.rows[0].locked) await fn(db);
  });
}
async function releaseDue() {
  await exclusively(81734921, async (db) => {
    const due = await db.query(
      `SELECT data FROM content c WHERE status='scheduled' AND (data->>'release_at')::timestamptz <= now()
       AND NOT EXISTS (SELECT 1 FROM content m WHERE m.kind='model' AND m.status='scheduled' AND m.data->>'linked_news_slug'=c.slug)
       ORDER BY id FOR UPDATE`
    );
    for (const { data: item } of due.rows)
      await publishContent(db, item, "system:scheduler", item.release_at);
  });
}
async function grantNotices() {
  await transaction(async (db) => {
    const due = await db.query(
      "SELECT data FROM grants WHERE expiry_notified=false FOR UPDATE SKIP LOCKED"
    );
    for (const { data: g } of due.rows) await queueGrantExpiry(db, g);
  });
}
async function lapseSignoffs() {
  await exclusively(81734923, (db) => voidLapsedSignoffs(db, "system:grants"));
}
async function eraseRetained() {
  await exclusively(81734922, async (db) => {
    const due = await db.query(
      "SELECT a.data FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE (a.data->>'erased')::boolean=false AND r.status='closed' AND (r.data->>'erase_after')::timestamptz <= now() FOR UPDATE OF a"
    );
    for (const { data: a } of due.rows) {
      const expected = a.version;
      await enqueueJob(db, "resume_erase", { key: a.resume_key });
      a.name = "Erased applicant";
      a.email = "";
      a.resume_key = "";
      a.token_digest = null;
      a.token_ciphertext = null;
      a.erased = true;
      a.version++;
      await saveApplication(db, a, expected);
      await audit(
        db,
        "system:retention",
        "application.erase",
        "application",
        a.id,
        {
          reference: a.reference
        }
      );
    }
  });
}
var samplesQueued = false;
async function queueMissingSamples() {
  if (samplesQueued || !serviceState().storage) return;
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('samples'))");
    for (const sample2 of generatedSamples()) {
      const queued = await db.query(
        "SELECT 1 FROM jobs WHERE kind='sample_upload' AND payload->>'key'=$1 AND state<>'done'",
        [sample2.key]
      );
      if (queued.rowCount) continue;
      if ((await storage("HEAD", sample2.key)).ok) continue;
      await enqueueJob(db, "sample_upload", { key: sample2.key });
    }
  });
  samplesQueued = true;
}
async function attempt(id2, kind, payload) {
  const service = kind === "mail" ? "mail" : "storage";
  try {
    if (kind === "mail") await smtp(id2, mailMessage(payload));
    else if (kind === "resume_erase") await deleteObject(String(payload.key));
    else {
      const sample2 = generatedSamples().find((s) => s.key === payload.key);
      await putObject(sample2.key, sample2.body, sample2.type);
    }
    return { kind: "done" };
  } catch (error) {
    return error instanceof MailRefused || error instanceof StorageRefused ? { kind: "refused", error: `${service}_refused` } : { kind: "unreachable", error: `${service}_unreachable` };
  }
}
var mailMessage = (payload) => ({
  to_name: String(payload.to_name),
  to_email: String(payload.to_email),
  subject: String(payload.subject),
  body: String(payload.body)
});
async function settle(id2, lease, outcome) {
  if (outcome.kind === "done")
    await pool.query(
      "UPDATE jobs SET state='done',finished_at=now(),lease_until=NULL WHERE id=$1 AND lease_until=$2",
      [id2, lease]
    );
  else if (outcome.kind === "unreachable")
    await pool.query(
      "UPDATE jobs SET state='pending',last_error=$2,lease_until=NULL,next_attempt_at=now()+make_interval(secs=>$3) WHERE id=$1 AND lease_until=$4",
      [id2, outcome.error, config.outboxRetry, lease]
    );
  else
    await pool.query(
      `UPDATE jobs SET refusals=refusals+1,last_error=$2,lease_until=NULL,
        state=CASE WHEN refusals+1>=$3 THEN 'dead' ELSE 'pending' END,
        finished_at=CASE WHEN refusals+1>=$3 THEN now() END,
        next_attempt_at=now()+make_interval(secs=>LEAST($4*power(2,refusals),$5))
       WHERE id=$1 AND lease_until=$6`,
      [
        id2,
        outcome.error,
        config.jobMaxAttempts,
        config.outboxRetry,
        config.outboxRetryMax,
        lease
      ]
    );
}
async function runJobs() {
  const { mail, storage: store } = serviceState();
  const kinds2 = [
    ...mail ? ["mail"] : [],
    ...store ? ["resume_erase", "sample_upload"] : []
  ];
  if (!kinds2.length) return;
  for (let n = 0; n < 50; n++) {
    const claimed = await pool.query(
      `UPDATE jobs SET state='running',attempts=attempts+1,lease_until=now()+interval '60 seconds'
       WHERE id=(SELECT id FROM jobs WHERE kind=ANY($1) AND ((state='pending' AND next_attempt_at<=now()) OR (state='running' AND lease_until<now()))
                 ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING id::int AS id,kind,payload,lease_until::text AS lease`,
      [kinds2]
    );
    const job = claimed.rows[0];
    if (!job) return;
    await settle(
      job.id,
      job.lease,
      await attempt(job.id, job.kind, job.payload)
    );
  }
}
async function startJobs() {
  await probe();
  const tasks = [
    { fn: probe, ms: 5e3 },
    { fn: queueMissingSamples, ms: 5e3 },
    { fn: releaseDue, ms: 800 },
    { fn: grantNotices, ms: 5e3 },
    { fn: lapseSignoffs, ms: 5e3 },
    { fn: eraseRetained, ms: 5e3 },
    // Frequent short claims; OUTBOX_RETRY_SECONDS is the upper bound.
    { fn: runJobs, ms: Math.min(config.outboxRetry * 1e3, 250) }
  ];
  let stopped = false;
  const timers = /* @__PURE__ */ new Set();
  for (const { fn, ms } of tasks) {
    const run = async () => {
      try {
        await fn();
      } catch (error) {
        console.error(
          "Background task failed",
          error instanceof Error ? error.message : "Unknown error"
        );
      }
      if (stopped) return;
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          void run();
        },
        ms * (0.5 + Math.random() * 0.5)
      );
      timers.add(timer);
    };
    void run();
  }
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}

// src/server.ts
init_probes();

// src/limits.ts
init_db();
init_config();
init_errors();
import { createHash as createHash4 } from "node:crypto";
async function countRequest(bucket, key) {
  const limit = config.rateLimits[bucket];
  const counted2 = (await pool.query(
    `INSERT INTO rate_limits(bucket,key,window_start,count) VALUES($1,$2,now(),1)
       ON CONFLICT(bucket,key) DO UPDATE SET
         window_start=CASE WHEN rate_limits.window_start<=now()-interval '60 seconds' THEN now() ELSE rate_limits.window_start END,
         count=CASE WHEN rate_limits.window_start<=now()-interval '60 seconds' THEN 1
                    WHEN rate_limits.count>$3 THEN rate_limits.count ELSE rate_limits.count+1 END
       RETURNING count,GREATEST(1,CEIL(EXTRACT(EPOCH FROM rate_limits.window_start+interval '60 seconds'-now())))::int AS reset`,
    [bucket, key, limit]
  )).rows[0];
  const headers = {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(Math.max(0, limit - counted2.count)),
    "RateLimit-Reset": String(counted2.reset)
  };
  if (counted2.count > limit)
    fail(
      429,
      "rate_limited",
      `Too many requests. Try again in ${counted2.reset} seconds.`,
      void 0,
      { ...headers, "Retry-After": String(counted2.reset) }
    );
  return headers;
}
var fingerprint = (method, path, body) => createHash4("sha256").update(`${method}
${path}
${canonical(body)}`).digest("hex");
function asResult(error) {
  if (!(error instanceof ApiError)) throw error;
  return {
    status: error.status,
    data: error.toJSON(),
    headers: error.headers
  };
}
async function idempotent(scope, key, print, run) {
  if (key === void 0) return run();
  if (!/^[\x21-\x7e]{1,255}$/.test(key))
    fail(
      422,
      "invalid_idempotency_key",
      "Idempotency-Key must be 1 to 255 visible ASCII characters."
    );
  for (; ; ) {
    const claimed = await pool.query(
      "INSERT INTO idempotency_keys(scope,key,fingerprint,expires_at) VALUES($1,$2,$3,now()+make_interval(secs=>$4)) ON CONFLICT(scope,key) DO NOTHING",
      [scope, key, print, config.idempotencyTtl]
    );
    if (claimed.rowCount) break;
    const stored = (await pool.query(
      "SELECT fingerprint,status,body,headers,expires_at<now() AS expired FROM idempotency_keys WHERE scope=$1 AND key=$2",
      [scope, key]
    )).rows[0];
    if (!stored) continue;
    if (stored.expired) {
      await pool.query(
        "DELETE FROM idempotency_keys WHERE scope=$1 AND key=$2 AND expires_at<now()",
        [scope, key]
      );
      continue;
    }
    if (stored.fingerprint !== print)
      fail(
        409,
        "idempotency_key_reused",
        "This Idempotency-Key was already used for a different request."
      );
    if (stored.status === null)
      fail(
        409,
        "idempotency_in_progress",
        "A request with this Idempotency-Key is still being processed."
      );
    return {
      status: stored.status,
      data: JSON.parse(stored.body),
      headers: { ...stored.headers, "Idempotency-Replayed": "true" }
    };
  }
  let result;
  try {
    result = await run().catch(asResult);
  } catch (error) {
    await pool.query("DELETE FROM idempotency_keys WHERE scope=$1 AND key=$2", [
      scope,
      key
    ]);
    throw error;
  }
  const kept = result.status >= 200 && result.status < 500 && ![401, 429].includes(result.status);
  if (kept)
    await pool.query(
      "UPDATE idempotency_keys SET status=$3,body=$4,headers=$5 WHERE scope=$1 AND key=$2",
      [
        scope,
        key,
        result.status,
        JSON.stringify(result.data),
        {
          ...result.headers,
          ...result.version !== void 0 ? { ETag: `"${result.version}"` } : {}
        }
      ]
    );
  else
    await pool.query("DELETE FROM idempotency_keys WHERE scope=$1 AND key=$2", [
      scope,
      key
    ]);
  return result;
}

// src/server.ts
var root = resolve(".");
var consoleRoutes = [
  [/^\/api\/console\/session$/, ["POST", "DELETE"]],
  [/^\/api\/console\/me$/, ["GET"]],
  [/^\/api\/console\/grants$/, ["GET", "POST"]],
  [/^\/api\/console\/grants\/[^/]+\/revoke$/, ["POST"]],
  [/^\/api\/console\/audit$/, ["GET"]],
  [/^\/api\/console\/audit\/verify$/, ["GET"]],
  [/^\/api\/console\/audit\/[^/]+$/, ["PUT", "PATCH", "DELETE"]],
  [/^\/api\/console\/jobs$/, ["GET"]],
  [/^\/api\/console\/jobs\/[^/]+\/retry$/, ["POST"]],
  [/^\/api\/console\/content$/, ["GET", "POST"]],
  [/^\/api\/console\/content\/[^/]+$/, ["GET", "PATCH"]],
  [
    /^\/api\/console\/content\/[^/]+\/(submit|comments|approve|return|schedule|release|withdraw)$/,
    ["POST"]
  ],
  [/^\/api\/console\/content\/[^/]+\/release-record$/, ["GET"]],
  [
    /^\/api\/console\/content\/[^/]+\/release-record\/(signoffs|validate-claims|clear)$/,
    ["POST"]
  ],
  [/^\/api\/console\/benchmark-rows$/, ["GET", "POST"]],
  [/^\/api\/console\/benchmark-rows\/[^/]+$/, ["PATCH", "DELETE"]],
  [/^\/api\/console\/requisitions$/, ["GET", "POST"]],
  [/^\/api\/console\/requisitions\/[^/]+$/, ["GET"]],
  [/^\/api\/console\/requisitions\/[^/]+\/(open|close)$/, ["POST"]],
  [/^\/api\/console\/requisitions\/[^/]+\/applications$/, ["GET"]],
  [/^\/api\/console\/applications\/[^/]+$/, ["GET"]],
  [/^\/api\/console\/applications\/[^/]+\/resume$/, ["GET"]],
  [
    /^\/api\/console\/applications\/[^/]+\/(stage|notes|tracking-link\/reissue)$/,
    ["POST"]
  ],
  [/^\/api\/console\/benefits$/, ["POST"]]
];
function consoleMethod(path, method) {
  const route = consoleRoutes.find(([pattern]) => pattern.test(path));
  if (!route) notFound();
  if (!route[1].includes(method))
    fail(405, "method_not_allowed", "This method is not allowed.");
}
var applicationPath = /^\/api\/careers\/roles\/([^/]+)\/applications$/;
var writes = ["POST", "PATCH", "PUT", "DELETE"];
async function bodyBytes(req, limit) {
  if (Number(req.headers["content-length"] || 0) > limit)
    fail(413, "payload_too_large", "That request is too large.");
  const chunks = [];
  let size = 0;
  for await (const chunk2 of req) {
    const bytes = Buffer.isBuffer(chunk2) ? chunk2 : Buffer.from(chunk2);
    size += bytes.length;
    if (size > limit)
      fail(413, "payload_too_large", "That request is too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
async function parseMultipart(req, buffer) {
  return new Promise((resolve2, reject) => {
    const fields = {};
    let resume;
    const unreadable = () => reject(
      new ApiError(400, "invalid_request", "The form could not be read.")
    );
    try {
      const parser = (0, import_busboy.default)({
        headers: req.headers,
        limits: { files: 1, fields: 10 }
      });
      parser.on("field", (key, value) => {
        fields[key] = value;
      });
      parser.on("file", (key, stream) => {
        const chunks = [];
        stream.on("data", (chunk2) => chunks.push(chunk2));
        stream.on("end", () => {
          if (key === "resume") resume = Buffer.concat(chunks);
        });
      });
      parser.on("error", unreadable);
      parser.on("close", () => resolve2({ fields, resume }));
      parser.end(buffer);
    } catch {
      unreadable();
    }
  });
}
function send(res, result) {
  res.statusCode = result.status;
  if (result.version !== void 0)
    res.setHeader("ETag", `"${result.version}"`);
  for (const [key, value] of Object.entries(result.headers || {}))
    res.setHeader(key, value);
  if (result.status === 204) {
    res.end();
    return;
  }
  if (Buffer.isBuffer(result.data)) {
    res.end(result.data);
    return;
  }
  if (typeof result.data === "string" && res.hasHeader("Content-Type")) {
    res.end(result.data);
    return;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(result.data));
}
var header = (req, name) => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};
function client(req) {
  const forwarded = header(req, "x-forwarded-for");
  if (config.trustForwardedFor && forwarded)
    return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}
function bucketFor(path, method) {
  if (path === "/api/health" || path === "/api/ready") return null;
  if (path === "/style.css" || path === "/browser.js" || path.startsWith("/fonts/"))
    return null;
  if (method === "POST" && (path === "/api/console/session" || path === "/console/sign-in"))
    return "signin";
  if (path.startsWith("/api/console/"))
    return writes.includes(method) ? "console" : null;
  if (path.startsWith("/console")) return null;
  if (path.startsWith("/api/track/") || path === "/api/careers/tracking-links" || applicationPath.test(path) || method === "POST" && (path.startsWith("/careers") || path.startsWith("/track/")))
    return "candidate";
  return "public";
}
async function publicApi(path, query) {
  const asOf = () => parseAsOf(query.get("as_of"));
  const slug = (prefix) => decodeURIComponent(path.slice(prefix.length));
  if (path === "/api/public/home") return homeData();
  if (path === "/api/public/models") return modelsData(asOf());
  if (path.startsWith("/api/public/models/"))
    return modelData(slug("/api/public/models/"), asOf());
  if (path === "/api/public/news") return newsroomData(query);
  if (path.startsWith("/api/public/news/"))
    return newsData(slug("/api/public/news/"), asOf());
  if (path === "/api/public/search") return searchData(query);
  if (path === "/api/public/roles") return rolesData(query);
  if (path.startsWith("/api/public/roles/"))
    return roleData(slug("/api/public/roles/"));
  if (path === "/api/public/benefits") return benefitsData();
  return publicNotFound();
}
async function consoleApi(req, url, body, staff) {
  const path = url.pathname, method = req.method || "GET";
  consoleMethod(path, method);
  if (path === "/api/console/me") return { status: 200, data: staff };
  if (path === "/api/console/session") {
    await signOut(req);
    return {
      status: 204,
      data: null,
      headers: { "Set-Cookie": sessionCookie("", 0) }
    };
  }
  if (!staff.roles.length) forbidden();
  const ctx = {
    method,
    path,
    query: url.searchParams,
    body,
    staff,
    version: header(req, "if-match")
  };
  const result = await contentApi(ctx) || await careersApi(ctx) || await governanceApi(ctx);
  return result || notFound();
}
async function api(req, url, body, multipart, staff) {
  const path = url.pathname, method = req.method || "GET";
  if (path === "/api/health" && method === "GET")
    return { status: 200, data: { status: "ok" } };
  if (path === "/api/ready" && method === "GET") {
    const ready = await readiness();
    return { status: ready.status, data: ready.body };
  }
  if (path.startsWith("/api/public/") && method === "GET")
    return { status: 200, data: await publicApi(path, url.searchParams) };
  const track = path.match(/^\/api\/track\/([^/]+)(\/withdraw)?$/);
  if (track && method === (track[2] ? "POST" : "GET"))
    return { status: 200, data: await tracking(track[1], !!track[2]) };
  const application = path.match(applicationPath);
  if (application && method === "POST") {
    const slug = decodeURIComponent(application[1]);
    const form2 = multipart;
    const resumeDigest = form2.resume ? createHash5("sha256").update(form2.resume).digest("hex") : null;
    return idempotent(
      `role:${slug}`,
      header(req, "idempotency-key"),
      fingerprint(method, path, { fields: form2.fields, resume: resumeDigest }),
      () => submitApplication(slug, form2)
    );
  }
  if (path === "/api/careers/tracking-links" && method === "POST")
    return resendLinks(str(body.email));
  if (path === "/api/console/session" && method === "POST") {
    const signed = await signIn(body);
    return {
      status: 200,
      data: { staff: signed.staff },
      headers: { "Set-Cookie": sessionCookie(signed.token, config.sessionTtl) }
    };
  }
  if (path.startsWith("/api/console/")) {
    const signed = staff || await requireStaff(req);
    if (writes.includes(method) && path !== "/api/console/session")
      return idempotent(
        `staff:${signed.email}`,
        header(req, "idempotency-key"),
        fingerprint(method, path, body),
        () => consoleApi(req, url, body, signed)
      );
    return consoleApi(req, url, body, signed);
  }
  return publicNotFound();
}
async function sample(path) {
  if (!sampleDefinitions.some((s) => s.urls.includes(path))) publicNotFound();
  await publicContent("model", sampleRoute);
  let response;
  try {
    response = await storage("GET", path.replace("/media/", ""));
  } catch {
    fail(503, "storage_unavailable", "Samples are unavailable right now.");
  }
  if (response.status === 404) publicNotFound();
  if (!response.ok)
    fail(503, "storage_unavailable", "Samples are unavailable right now.");
  return {
    status: 200,
    data: Buffer.from(await response.arrayBuffer()),
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "public, max-age=3600"
    }
  };
}
async function asset(path) {
  let bytes;
  try {
    bytes = await readFile(
      resolve(
        root,
        "public",
        path === "/browser.js" ? "dist/browser.js" : "." + path
      )
    );
  } catch {
    publicNotFound();
  }
  return {
    status: 200,
    data: bytes,
    headers: {
      "Content-Type": path.endsWith(".css") ? "text/css; charset=utf-8" : path.endsWith(".js") ? "text/javascript; charset=utf-8" : "font/woff2",
      "Cache-Control": "public, max-age=86400"
    }
  };
}
async function readBody(req, path, isApi) {
  const mediaType = (header(req, "content-type") || "").split(";")[0].trim().toLowerCase();
  const multipartPath = applicationPath.test(path) || /^\/careers\/[^/]+$/.test(path);
  const bytes = await bodyBytes(
    req,
    mediaType === "multipart/form-data" ? 6e6 : 1e5
  );
  if (multipartPath && (isApi || mediaType === "multipart/form-data")) {
    if (mediaType !== "multipart/form-data")
      fail(
        415,
        "unsupported_media_type",
        "Send this request as a multipart form."
      );
    return { body: {}, multipart: await parseMultipart(req, bytes) };
  }
  if (!isApi && mediaType === "application/x-www-form-urlencoded")
    return { body: Object.fromEntries(new URLSearchParams(bytes.toString())) };
  if (!bytes.length) return { body: {} };
  if (mediaType !== "application/json")
    fail(415, "unsupported_media_type", "Send this request as JSON.");
  try {
    return { body: object(JSON.parse(bytes.toString())) };
  } catch {
    return fail(400, "invalid_request", "The JSON could not be read.");
  }
}
var neverServed = /^\/(?:src|node_modules|\.env|\.git|package|run\.json|assets\.json|tsconfig|THIRD_PARTY|USER_README|dist|public)/i;
async function handle(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-cache");
  const raw = req.url || "/";
  const method = req.method || "GET";
  let url;
  try {
    url = new URL(raw, `http://${req.headers.host || "localhost"}`);
  } catch {
    send(res, {
      status: 400,
      data: new ApiError(
        400,
        "invalid_request",
        "The request address could not be read."
      ).toJSON()
    });
    return;
  }
  const path = url.pathname;
  const isApi = path.startsWith("/api/");
  if (path.startsWith("/track/") || path.startsWith("/api/track/")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
  }
  try {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(raw.split("?")[0]);
    } catch {
      fail(400, "invalid_request", "The request address could not be read.");
    }
    if (decodedPath.includes("..") || decodedPath.includes("\0") || neverServed.test(decodedPath))
      path.startsWith("/api/track/") ? fail(404, "not_found", "This tracking link is not valid.") : publicNotFound();
    for (const [name, value] of [...url.searchParams])
      if (value.includes("\0"))
        url.searchParams.set(name, value.replaceAll("\0", ""));
    let body = {}, multipart;
    if (!["GET", "HEAD"].includes(method)) {
      ({ body, multipart } = await readBody(req, path, isApi));
      const origin = header(req, "origin");
      if ((path.startsWith("/api/console/") || path.startsWith("/console")) && origin && origin !== url.origin)
        fail(403, "cross_origin", "Requests must come from this site.");
    }
    const bucket = bucketFor(path, method);
    let staff = null;
    if (bucket === "console") staff = await requireStaff(req);
    if (bucket)
      for (const [key, value] of Object.entries(
        await countRequest(bucket, staff ? staff.email : client(req))
      ))
        res.setHeader(key, value);
    if (isApi) {
      send(res, await api(req, url, body, multipart, staff));
      return;
    }
    if (path === "/feed.xml" || path === "/sitemap.xml") {
      send(res, {
        status: 200,
        data: path === "/feed.xml" ? await feed() : await sitemap(),
        headers: {
          "Content-Type": path === "/feed.xml" ? "application/atom+xml; charset=utf-8" : "application/xml; charset=utf-8"
        }
      });
      return;
    }
    if (path.startsWith("/media/samples/")) {
      send(res, await sample(path));
      return;
    }
    if (path === "/style.css" || path === "/browser.js" || /^\/fonts\/[a-z0-9-]+\.woff2$/.test(path)) {
      send(res, await asset(path));
      return;
    }
    const { htmlRoute: htmlRoute2 } = await Promise.resolve().then(() => (init_pages(), pages_exports));
    send(res, await htmlRoute2(req, url, body, multipart));
  } catch (error) {
    const e = error instanceof ApiError ? error : new ApiError(
      500,
      "server_error",
      "We could not complete that request."
    );
    if (!(error instanceof ApiError)) console.error(error);
    for (const [key, value] of Object.entries(e.headers || {}))
      res.setHeader(key, value);
    if (isApi || path.startsWith("/media/") || path.endsWith(".xml"))
      send(res, { status: e.status, data: e.toJSON() });
    else {
      const { errorPage: errorPage2 } = await Promise.resolve().then(() => (init_pages(), pages_exports));
      send(res, await errorPage2(path, e));
    }
  }
}
async function prepareDatabase() {
  for (; ; ) {
    try {
      await schema();
      await seed();
      return;
    } catch (error) {
      console.error(
        "Database not ready; retrying in 2 seconds",
        error instanceof Error ? error.message : ""
      );
      await new Promise((done) => setTimeout(done, 2e3));
    }
  }
}
await prepareDatabase();
var stopJobs = await startJobs();
var server = createServer((req, res) => void handle(req, res));
server.listen(
  config.port,
  "0.0.0.0",
  () => console.log(`Open Record listening on ${config.port}`)
);
process.on("SIGTERM", () => {
  stopJobs();
  server.close(() => process.exit(0));
});
