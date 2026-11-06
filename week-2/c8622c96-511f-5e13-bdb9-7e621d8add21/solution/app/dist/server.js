import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);
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
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target2) => (target2 = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target2, "default", { value: mod, enumerable: true }) : target2,
  mod
));

// node_modules/pg/node_modules/postgres-array/index.js
var require_postgres_array = __commonJS({
  "node_modules/pg/node_modules/postgres-array/index.js"(exports) {
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

// node_modules/pg/node_modules/pg-types/lib/arrayParser.js
var require_arrayParser = __commonJS({
  "node_modules/pg/node_modules/pg-types/lib/arrayParser.js"(exports, module) {
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

// node_modules/pg/node_modules/postgres-date/index.js
var require_postgres_date = __commonJS({
  "node_modules/pg/node_modules/postgres-date/index.js"(exports, module) {
    "use strict";
    var DATE_TIME = /(\d{1,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,})?.*?( BC)?$/;
    var DATE = /^(\d{1,})-(\d{2})-(\d{2})( BC)?$/;
    var TIME_ZONE = /([Z+-])(\d{2})?:?(\d{2})?:?(\d{2})?/;
    var INFINITY = /^-?infinity$/;
    module.exports = function parseDate(isoDate) {
      if (INFINITY.test(isoDate)) {
        return Number(isoDate.replace("i", "I"));
      }
      var matches2 = DATE_TIME.exec(isoDate);
      if (!matches2) {
        return getDate(isoDate) || null;
      }
      var isBC = !!matches2[8];
      var year = parseInt(matches2[1], 10);
      if (isBC) {
        year = bcYearToNegativeYear(year);
      }
      var month = parseInt(matches2[2], 10) - 1;
      var day = matches2[3];
      var hour = parseInt(matches2[4], 10);
      var minute = parseInt(matches2[5], 10);
      var second = parseInt(matches2[6], 10);
      var ms = matches2[7];
      ms = ms ? 1e3 * parseFloat(ms) : 0;
      var date;
      var offset = timeZoneOffset(isoDate);
      if (offset != null) {
        date = new Date(Date.UTC(year, month, day, hour, minute, second, ms));
        if (is0To99(year)) {
          date.setUTCFullYear(year);
        }
        if (offset !== 0) {
          date.setTime(date.getTime() - offset);
        }
      } else {
        date = new Date(year, month, day, hour, minute, second, ms);
        if (is0To99(year)) {
          date.setFullYear(year);
        }
      }
      return date;
    };
    function getDate(isoDate) {
      var matches2 = DATE.exec(isoDate);
      if (!matches2) {
        return;
      }
      var year = parseInt(matches2[1], 10);
      var isBC = !!matches2[4];
      if (isBC) {
        year = bcYearToNegativeYear(year);
      }
      var month = parseInt(matches2[2], 10) - 1;
      var day = matches2[3];
      var date = new Date(year, month, day);
      if (is0To99(year)) {
        date.setFullYear(year);
      }
      return date;
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
    function extend(target2) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        for (var key in source) {
          if (hasOwnProperty.call(source, key)) {
            target2[key] = source[key];
          }
        }
      }
      return target2;
    }
  }
});

// node_modules/pg/node_modules/postgres-interval/index.js
var require_postgres_interval = __commonJS({
  "node_modules/pg/node_modules/postgres-interval/index.js"(exports, module) {
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
    var DAY2 = NUMBER + "\\s+days?";
    var TIME = "([+-])?([\\d]*):(\\d\\d):(\\d\\d)\\.?(\\d{1,6})?";
    var INTERVAL = new RegExp([YEAR, MONTH, DAY2, TIME].map(function(regexString) {
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
      var matches2 = INTERVAL.exec(interval);
      var isNegative = matches2[8] === "-";
      return Object.keys(positions).reduce(function(parsed, property) {
        var position = positions[property];
        var value = matches2[position];
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

// node_modules/pg/node_modules/postgres-bytea/index.js
var require_postgres_bytea = __commonJS({
  "node_modules/pg/node_modules/postgres-bytea/index.js"(exports, module) {
    "use strict";
    var bufferFrom = Buffer.from || Buffer;
    module.exports = function parseBytea(input) {
      if (/^\\x/.test(input)) {
        return bufferFrom(input.substr(2), "hex");
      }
      var output = "";
      var i = 0;
      while (i < input.length) {
        if (input[i] !== "\\") {
          output += input[i];
          ++i;
        } else {
          if (/[0-7]{3}/.test(input.substr(i + 1, 3))) {
            output += String.fromCharCode(parseInt(input.substr(i + 1, 3), 8));
            i += 4;
          } else {
            var backslashes = 1;
            while (i + backslashes < input.length && input[i + backslashes] === "\\") {
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

// node_modules/pg/node_modules/pg-types/lib/textParsers.js
var require_textParsers = __commonJS({
  "node_modules/pg/node_modules/pg-types/lib/textParsers.js"(exports, module) {
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
      var pad2;
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
        pad2 = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad2 += "0";
        }
        result = pad2 + digits + result;
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
        pad2 = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad2 += "0";
        }
        result = pad2 + digits + result;
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
        pad2 = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad2 += "0";
        }
        result = pad2 + digits + result;
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

// node_modules/pg/node_modules/pg-types/lib/binaryParsers.js
var require_binaryParsers = __commonJS({
  "node_modules/pg/node_modules/pg-types/lib/binaryParsers.js"(exports, module) {
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
        var length2 = parseBits(value, 32, offset);
        offset += 32;
        if (length2 == 4294967295) {
          return null;
        }
        var result;
        if (elementType2 == 23 || elementType2 == 20) {
          result = parseBits(value, length2 * 8, offset);
          offset += length2 * 8;
          return result;
        } else if (elementType2 == 25) {
          result = value.toString(this.encoding, offset >> 3, (offset += length2 << 3) >> 3);
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

// node_modules/pg/node_modules/pg-types/lib/builtins.js
var require_builtins = __commonJS({
  "node_modules/pg/node_modules/pg-types/lib/builtins.js"(exports, module) {
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

// node_modules/pg/node_modules/pg-types/index.js
var require_pg_types = __commonJS({
  "node_modules/pg/node_modules/pg-types/index.js"(exports) {
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
var require_utils = __commonJS({
  "node_modules/pg/lib/utils.js"(exports, module) {
    "use strict";
    var crypto = __require("crypto");
    var defaults = require_defaults();
    function escapeElement(elementRepresentation) {
      var escaped = elementRepresentation.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return '"' + escaped + '"';
    }
    function arrayString(val) {
      var result = "{";
      for (var i = 0; i < val.length; i++) {
        if (i > 0) {
          result = result + ",";
        }
        if (val[i] === null || typeof val[i] === "undefined") {
          result = result + "NULL";
        } else if (Array.isArray(val[i])) {
          result = result + arrayString(val[i]);
        } else if (val[i] instanceof Buffer) {
          result += "\\\\x" + val[i].toString("hex");
        } else {
          result += escapeElement(prepareValue(val[i]));
        }
      }
      result = result + "}";
      return result;
    }
    var prepareValue = function(val, seen) {
      if (val instanceof Buffer) {
        return val;
      }
      if (ArrayBuffer.isView(val)) {
        var buf = Buffer.from(val.buffer, val.byteOffset, val.byteLength);
        if (buf.length === val.byteLength) {
          return buf;
        }
        return buf.slice(val.byteOffset, val.byteOffset + val.byteLength);
      }
      if (val instanceof Date) {
        if (defaults.parseInputDatesAsUTC) {
          return dateToStringUTC(val);
        } else {
          return dateToString(val);
        }
      }
      if (Array.isArray(val)) {
        return arrayString(val);
      }
      if (val === null || typeof val === "undefined") {
        return null;
      }
      if (typeof val === "object") {
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
    function pad2(number, digits) {
      number = "" + number;
      while (number.length < digits) {
        number = "0" + number;
      }
      return number;
    }
    function dateToString(date) {
      var offset = -date.getTimezoneOffset();
      var year = date.getFullYear();
      var isBCYear = year < 1;
      if (isBCYear) year = Math.abs(year) + 1;
      var ret = pad2(year, 4) + "-" + pad2(date.getMonth() + 1, 2) + "-" + pad2(date.getDate(), 2) + "T" + pad2(date.getHours(), 2) + ":" + pad2(date.getMinutes(), 2) + ":" + pad2(date.getSeconds(), 2) + "." + pad2(date.getMilliseconds(), 3);
      if (offset < 0) {
        ret += "-";
        offset *= -1;
      } else {
        ret += "+";
      }
      ret += pad2(Math.floor(offset / 60), 2) + ":" + pad2(offset % 60, 2);
      if (isBCYear) ret += " BC";
      return ret;
    }
    function dateToStringUTC(date) {
      var year = date.getUTCFullYear();
      var isBCYear = year < 1;
      if (isBCYear) year = Math.abs(year) + 1;
      var ret = pad2(year, 4) + "-" + pad2(date.getUTCMonth() + 1, 2) + "-" + pad2(date.getUTCDate(), 2) + "T" + pad2(date.getUTCHours(), 2) + ":" + pad2(date.getUTCMinutes(), 2) + ":" + pad2(date.getUTCSeconds(), 2) + "." + pad2(date.getUTCMilliseconds(), 3);
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
    var md5 = function(string) {
      return crypto.createHash("md5").update(string, "utf-8").digest("hex");
    };
    var postgresMd5PasswordHash = function(user, password, salt) {
      var inner = md5(password + user);
      var outer = md5(Buffer.concat([Buffer.from(inner), salt]));
      return "md5" + outer;
    };
    module.exports = {
      prepareValue: function prepareValueWrapper(value) {
        return prepareValue(value);
      },
      normalizeQueryConfig,
      postgresMd5PasswordHash,
      md5
    };
  }
});

// node_modules/pg/lib/sasl.js
var require_sasl = __commonJS({
  "node_modules/pg/lib/sasl.js"(exports, module) {
    "use strict";
    var crypto = __require("crypto");
    function startSession(mechanisms) {
      if (mechanisms.indexOf("SCRAM-SHA-256") === -1) {
        throw new Error("SASL: Only mechanism SCRAM-SHA-256 is currently supported");
      }
      const clientNonce = crypto.randomBytes(18).toString("base64");
      return {
        mechanism: "SCRAM-SHA-256",
        clientNonce,
        response: "n,,n=*,r=" + clientNonce,
        message: "SASLInitialResponse"
      };
    }
    function continueSession(session, password, serverData) {
      if (session.message !== "SASLInitialResponse") {
        throw new Error("SASL: Last message was not SASLInitialResponse");
      }
      const sv = extractVariablesFromFirstServerMessage(serverData);
      if (!sv.nonce.startsWith(session.clientNonce)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce does not start with client nonce");
      }
      var saltBytes = Buffer.from(sv.salt, "base64");
      var saltedPassword = Hi(password, saltBytes, sv.iteration);
      var clientKey = createHMAC(saltedPassword, "Client Key");
      var storedKey = crypto.createHash("sha256").update(clientKey).digest();
      var clientFirstMessageBare = "n=*,r=" + session.clientNonce;
      var serverFirstMessage = "r=" + sv.nonce + ",s=" + sv.salt + ",i=" + sv.iteration;
      var clientFinalMessageWithoutProof = "c=biws,r=" + sv.nonce;
      var authMessage = clientFirstMessageBare + "," + serverFirstMessage + "," + clientFinalMessageWithoutProof;
      var clientSignature = createHMAC(storedKey, authMessage);
      var clientProofBytes = xorBuffers(clientKey, clientSignature);
      var clientProof = clientProofBytes.toString("base64");
      var serverKey = createHMAC(saltedPassword, "Server Key");
      var serverSignatureBytes = createHMAC(serverKey, authMessage);
      session.message = "SASLResponse";
      session.serverSignature = serverSignatureBytes.toString("base64");
      session.response = clientFinalMessageWithoutProof + ",p=" + clientProof;
    }
    function finalizeSession(session, serverData) {
      if (session.message !== "SASLResponse") {
        throw new Error("SASL: Last message was not SASLResponse");
      }
      var serverSignature;
      String(serverData).split(",").forEach(function(part) {
        switch (part[0]) {
          case "v":
            serverSignature = part.substr(2);
            break;
        }
      });
      if (serverSignature !== session.serverSignature) {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature does not match");
      }
    }
    function extractVariablesFromFirstServerMessage(data) {
      var nonce, salt, iteration;
      String(data).split(",").forEach(function(part) {
        switch (part[0]) {
          case "r":
            nonce = part.substr(2);
            break;
          case "s":
            salt = part.substr(2);
            break;
          case "i":
            iteration = parseInt(part.substr(2), 10);
            break;
        }
      });
      if (!nonce) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce missing");
      }
      if (!salt) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt missing");
      }
      if (!iteration) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: iteration missing");
      }
      return {
        nonce,
        salt,
        iteration
      };
    }
    function xorBuffers(a, b) {
      if (!Buffer.isBuffer(a)) a = Buffer.from(a);
      if (!Buffer.isBuffer(b)) b = Buffer.from(b);
      var res = [];
      if (a.length > b.length) {
        for (var i = 0; i < b.length; i++) {
          res.push(a[i] ^ b[i]);
        }
      } else {
        for (var j = 0; j < a.length; j++) {
          res.push(a[j] ^ b[j]);
        }
      }
      return Buffer.from(res);
    }
    function createHMAC(key, msg) {
      return crypto.createHmac("sha256", key).update(msg).digest();
    }
    function Hi(password, saltBytes, iterations) {
      var ui1 = createHMAC(password, Buffer.concat([saltBytes, Buffer.from([0, 0, 0, 1])]));
      var ui = ui1;
      for (var i = 0; i < iterations - 1; i++) {
        ui1 = createHMAC(password, ui1);
        ui = xorBuffers(ui, ui1);
      }
      return ui;
    }
    module.exports = {
      startSession,
      continueSession,
      finalizeSession
    };
  }
});

// node_modules/pgpass/lib/helper.js
var require_helper = __commonJS({
  "node_modules/pgpass/lib/helper.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var Stream = __require("stream").Stream;
    var createInterface = __require("readline").createInterface;
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
      var isDone = false;
      var lineStream = createInterface({
        input: stream,
        crlfDelay: Infinity
      });
      function finish(result) {
        isDone = true;
        stream.destroy();
        cb(result);
      }
      function onLine(line) {
        var entry = parseLine(line);
        if (entry && isValidEntry(entry) && matcher(connInfo, entry)) {
          pass = entry[passKey];
          lineStream.close();
        }
      }
      var onEnd = function() {
        if (!isDone) {
          finish(pass);
        }
      };
      var onErr = function(err) {
        if (isDone) {
          return;
        }
        warn("WARNING: error on reading file: %s", err);
        finish(void 0);
      };
      stream.on("error", onErr);
      lineStream.on("line", onLine).on("close", onEnd).on("error", onErr);
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
var require_lib = __commonJS({
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

// node_modules/pg/lib/type-overrides.js
var require_type_overrides = __commonJS({
  "node_modules/pg/lib/type-overrides.js"(exports, module) {
    "use strict";
    var types = require_pg_types();
    function TypeOverrides(userTypes) {
      this._types = userTypes || types;
      this.text = {};
      this.binary = {};
    }
    TypeOverrides.prototype.getOverrides = function(format) {
      switch (format) {
        case "text":
          return this.text;
        case "binary":
          return this.binary;
        default:
          return {};
      }
    };
    TypeOverrides.prototype.setTypeParser = function(oid, format, parseFn) {
      if (typeof format === "function") {
        parseFn = format;
        format = "text";
      }
      this.getOverrides(format)[oid] = parseFn;
    };
    TypeOverrides.prototype.getTypeParser = function(oid, format) {
      format = format || "text";
      return this.getOverrides(format)[oid] || this._types.getTypeParser(oid, format);
    };
    module.exports = TypeOverrides;
  }
});

// node_modules/pg-connection-string/index.js
var require_pg_connection_string = __commonJS({
  "node_modules/pg-connection-string/index.js"(exports, module) {
    "use strict";
    function parse(str, options = {}) {
      if (str.charAt(0) === "/") {
        const config3 = str.split(" ");
        return { host: config3[0], database: config3[1] };
      }
      const config2 = /* @__PURE__ */ Object.create(null);
      let result;
      let dummyHost = false;
      if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(str)) {
        str = encodeURI(str).replace(/%25(\d\d)/g, "%$1");
      }
      try {
        try {
          result = new URL(str, "postgres://base");
        } catch (e) {
          result = new URL(str.replace("@/", "@___DUMMY___/"), "postgres://base");
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
    function parseIntoClientConfig(str) {
      return toClientConfig(parse(str));
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
    var defaults = require_defaults();
    var parse = require_pg_connection_string().parse;
    var val = function(key, config2, envVar) {
      if (envVar === void 0) {
        envVar = process.env["PG" + key.toUpperCase()];
      } else if (envVar === false) {
      } else {
        envVar = process.env[envVar];
      }
      return config2[key] || envVar || defaults[key];
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
      return defaults.ssl;
    };
    var quoteParamValue = function(value) {
      return "'" + ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    };
    var add = function(params, config2, paramName) {
      var value = config2[paramName];
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
        if (this.ssl === "no-verify") {
          this.ssl = { rejectUnauthorized: false };
        }
        this.client_encoding = val("client_encoding", config2);
        this.replication = val("replication", config2);
        this.isDomainSocket = !(this.host || "").indexOf("/");
        this.application_name = val("application_name", config2, "PGAPPNAME");
        this.fallback_application_name = val("fallback_application_name", config2, false);
        this.statement_timeout = val("statement_timeout", config2, false);
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
        var params = [];
        add(params, this, "user");
        add(params, this, "password");
        add(params, this, "port");
        add(params, this, "application_name");
        add(params, this, "fallback_application_name");
        add(params, this, "connect_timeout");
        add(params, this, "options");
        var ssl = typeof this.ssl === "object" ? this.ssl : this.ssl ? { sslmode: this.ssl } : {};
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
    var types = require_pg_types();
    var matchRegexp = /^([A-Za-z]+)(?: (\d+))?(?: (\d+))?/;
    var Result = class {
      constructor(rowMode, types2) {
        this.command = null;
        this.rowCount = null;
        this.oid = null;
        this.rows = [];
        this.fields = [];
        this._parsers = void 0;
        this._types = types2;
        this.RowCtor = null;
        this.rowAsArray = rowMode === "array";
        if (this.rowAsArray) {
          this.parseRow = this._parseRowAsArray;
        }
      }
      // adds a command complete message
      addCommandComplete(msg) {
        var match2;
        if (msg.text) {
          match2 = matchRegexp.exec(msg.text);
        } else {
          match2 = matchRegexp.exec(msg.command);
        }
        if (match2) {
          this.command = match2[1];
          if (match2[3]) {
            this.oid = parseInt(match2[2], 10);
            this.rowCount = parseInt(match2[3], 10);
          } else if (match2[2]) {
            this.rowCount = parseInt(match2[2], 10);
          }
        }
      }
      _parseRowAsArray(rowData) {
        var row = new Array(rowData.length);
        for (var i = 0, len = rowData.length; i < len; i++) {
          var rawValue = rowData[i];
          if (rawValue !== null) {
            row[i] = this._parsers[i](rawValue);
          } else {
            row[i] = null;
          }
        }
        return row;
      }
      parseRow(rowData) {
        var row = {};
        for (var i = 0, len = rowData.length; i < len; i++) {
          var rawValue = rowData[i];
          var field = this.fields[i].name;
          if (rawValue !== null) {
            row[field] = this._parsers[i](rawValue);
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
        for (var i = 0; i < fieldDescriptions.length; i++) {
          var desc = fieldDescriptions[i];
          if (this._types) {
            this._parsers[i] = this._types.getTypeParser(desc.dataTypeID, desc.format || "text");
          } else {
            this._parsers[i] = types.getTypeParser(desc.dataTypeID, desc.format || "text");
          }
        }
      }
    };
    module.exports = Result;
  }
});

// node_modules/pg/lib/query.js
var require_query = __commonJS({
  "node_modules/pg/lib/query.js"(exports, module) {
    "use strict";
    var { EventEmitter } = __require("events");
    var Result = require_result();
    var utils = require_utils();
    var Query = class extends EventEmitter {
      constructor(config2, values, callback) {
        super();
        config2 = utils.normalizeQueryConfig(config2, values, callback);
        this.text = config2.text;
        this.values = config2.values;
        this.rows = config2.rows;
        this.types = config2.types;
        this.name = config2.name;
        this.binary = config2.binary;
        this.portal = config2.portal || "";
        this.callback = config2.callback;
        this._rowMode = config2.rowMode;
        if (process.domain && config2.callback) {
          this.callback = process.domain.bind(config2.callback);
        }
        this._result = new Result(this._rowMode, this.types);
        this._results = this._result;
        this.isPreparedStatement = false;
        this._canceledDueToError = false;
        this._promise = null;
      }
      requiresPreparation() {
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
          this._result = new Result(this._rowMode, this.types);
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
      handleCommandComplete(msg, con) {
        this._checkForMultirow();
        this._result.addCommandComplete(msg);
        if (this.isPreparedStatement) {
          con.sync();
        }
      }
      // if a named prepared statement is created with empty query text
      // the backend will send an emptyQuery message but *not* a command complete message
      // execution on the connection will hang until the backend receives a sync message
      handleEmptyQuery(con) {
        if (this.isPreparedStatement) {
          con.sync();
        }
      }
      handleReadyForQuery(con) {
        if (this._canceledDueToError) {
          return this.handleError(this._canceledDueToError, con);
        }
        if (this.callback) {
          this.callback(null, this._results);
        }
        this.emit("end", this._results);
      }
      handleError(err, connection) {
        if (this.isPreparedStatement) {
          connection.sync();
        }
        if (this._canceledDueToError) {
          err = this._canceledDueToError;
          this._canceledDueToError = false;
        }
        if (this.callback) {
          return this.callback(err);
        }
        this.emit("error", err);
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
          this.prepare(connection);
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
        connection.flush();
      }
      // http://developer.postgresql.org/pgdocs/postgres/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY
      prepare(connection) {
        this.isPreparedStatement = true;
        if (!this.hasBeenParsed(connection)) {
          connection.parse({
            text: this.text,
            name: this.name,
            types: this.types
          });
        }
        if (this.values) {
          try {
            this.values = this.values.map(utils.prepareValue);
          } catch (err) {
            this.handleError(err, connection);
            return;
          }
        }
        connection.bind({
          portal: this.portal,
          statement: this.name,
          values: this.values,
          binary: this.binary
        });
        connection.describe({
          type: "P",
          name: this.portal || ""
        });
        this._getRows(connection, this.rows);
      }
      handleCopyInResponse(connection) {
        connection.sendCopyFail("No source stream defined");
      }
      // eslint-disable-next-line no-unused-vars
      handleCopyData(msg, connection) {
      }
    };
    module.exports = Query;
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
    var DatabaseError = class extends Error {
      constructor(message2, length2, name) {
        super(message2);
        this.length = length2;
        this.name = name;
      }
    };
    exports.DatabaseError = DatabaseError;
    var CopyDataMessage = class {
      constructor(length2, chunk) {
        this.length = length2;
        this.chunk = chunk;
        this.name = "copyData";
      }
    };
    exports.CopyDataMessage = CopyDataMessage;
    var CopyResponse = class {
      constructor(length2, name, binary, columnCount) {
        this.length = length2;
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
      constructor(length2, fieldCount) {
        this.length = length2;
        this.fieldCount = fieldCount;
        this.name = "rowDescription";
        this.fields = new Array(this.fieldCount);
      }
    };
    exports.RowDescriptionMessage = RowDescriptionMessage;
    var ParameterDescriptionMessage = class {
      constructor(length2, parameterCount) {
        this.length = length2;
        this.parameterCount = parameterCount;
        this.name = "parameterDescription";
        this.dataTypeIDs = new Array(this.parameterCount);
      }
    };
    exports.ParameterDescriptionMessage = ParameterDescriptionMessage;
    var ParameterStatusMessage = class {
      constructor(length2, parameterName, parameterValue) {
        this.length = length2;
        this.parameterName = parameterName;
        this.parameterValue = parameterValue;
        this.name = "parameterStatus";
      }
    };
    exports.ParameterStatusMessage = ParameterStatusMessage;
    var AuthenticationMD5Password = class {
      constructor(length2, salt) {
        this.length = length2;
        this.salt = salt;
        this.name = "authenticationMD5Password";
      }
    };
    exports.AuthenticationMD5Password = AuthenticationMD5Password;
    var BackendKeyDataMessage = class {
      constructor(length2, processID, secretKey) {
        this.length = length2;
        this.processID = processID;
        this.secretKey = secretKey;
        this.name = "backendKeyData";
      }
    };
    exports.BackendKeyDataMessage = BackendKeyDataMessage;
    var NotificationResponseMessage = class {
      constructor(length2, processId, channel, payload) {
        this.length = length2;
        this.processId = processId;
        this.channel = channel;
        this.payload = payload;
        this.name = "notification";
      }
    };
    exports.NotificationResponseMessage = NotificationResponseMessage;
    var ReadyForQueryMessage = class {
      constructor(length2, status) {
        this.length = length2;
        this.status = status;
        this.name = "readyForQuery";
      }
    };
    exports.ReadyForQueryMessage = ReadyForQueryMessage;
    var CommandCompleteMessage = class {
      constructor(length2, text) {
        this.length = length2;
        this.text = text;
        this.name = "commandComplete";
      }
    };
    exports.CommandCompleteMessage = CommandCompleteMessage;
    var DataRowMessage = class {
      constructor(length2, fields) {
        this.length = length2;
        this.fields = fields;
        this.name = "dataRow";
        this.fieldCount = fields.length;
      }
    };
    exports.DataRowMessage = DataRowMessage;
    var NoticeMessage = class {
      constructor(length2, message2) {
        this.length = length2;
        this.message = message2;
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
          const length2 = this.offset - (this.headerPosition + 1);
          this.buffer.writeInt32BE(length2, this.headerPosition + 1);
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
      const length2 = bodyBuffer.length + 4;
      return new buffer_writer_1.Writer().addInt32(length2).add(bodyBuffer).flush();
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
    var query2 = (text) => {
      return writer.addCString(text).flush(
        81
        /* code.query */
      );
    };
    var emptyArray = [];
    var parse = (query3) => {
      const name = query3.name || "";
      if (name.length > 63) {
        console.error("Warning! Postgres only supports 63 characters for query names.");
        console.error("You supplied %s (%s)", name, name.length);
        console.error("This can cause conflicts and silent errors executing queries");
      }
      const types = query3.types || emptyArray;
      const len = types.length;
      const buffer = writer.addCString(name).addCString(query3.text).addInt16(len);
      for (let i = 0; i < len; i++) {
        buffer.addInt32(types[i]);
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
    var copyData = (chunk) => {
      return writer.add(chunk).flush(
        100
        /* code.copyFromChunk */
      );
    };
    var copyFail = (message2) => {
      return cstringMessage(102, message2);
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
      query: query2,
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
      string(length2) {
        const result = this.buffer.toString(this.encoding, this.offset, this.offset + length2);
        this.offset += length2;
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
      bytes(length2) {
        const result = this.buffer.slice(this.offset, this.offset + length2);
        this.offset += length2;
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
          const length2 = this.buffer.readUInt32BE(offset + CODE_LENGTH);
          const fullMessageLength = CODE_LENGTH + length2;
          if (fullMessageLength + offset <= bufferFullLength) {
            const message2 = this.handlePacket(offset + HEADER_LENGTH, code, length2, this.buffer);
            callback(message2);
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
      handlePacket(offset, code, length2, bytes) {
        const { reader } = this;
        reader.setBuffer(offset, bytes);
        let message2;
        switch (code) {
          case 50:
            message2 = messages_1.bindComplete;
            break;
          case 49:
            message2 = messages_1.parseComplete;
            break;
          case 51:
            message2 = messages_1.closeComplete;
            break;
          case 110:
            message2 = messages_1.noData;
            break;
          case 115:
            message2 = messages_1.portalSuspended;
            break;
          case 99:
            message2 = messages_1.copyDone;
            break;
          case 87:
            message2 = messages_1.replicationStart;
            break;
          case 73:
            message2 = messages_1.emptyQuery;
            break;
          case 68:
            message2 = parseDataRowMessage(reader);
            break;
          case 67:
            message2 = parseCommandCompleteMessage(reader);
            break;
          case 90:
            message2 = parseReadyForQueryMessage(reader);
            break;
          case 65:
            message2 = parseNotificationMessage(reader);
            break;
          case 82:
            message2 = parseAuthenticationResponse(reader, length2);
            break;
          case 83:
            message2 = parseParameterStatusMessage(reader);
            break;
          case 75:
            message2 = parseBackendKeyData(reader);
            break;
          case 69:
            message2 = parseErrorMessage(reader, "error");
            break;
          case 78:
            message2 = parseErrorMessage(reader, "notice");
            break;
          case 84:
            message2 = parseRowDescriptionMessage(reader);
            break;
          case 116:
            message2 = parseParameterDescriptionMessage(reader);
            break;
          case 71:
            message2 = parseCopyInMessage(reader);
            break;
          case 72:
            message2 = parseCopyOutMessage(reader);
            break;
          case 100:
            message2 = parseCopyData(reader, length2);
            break;
          default:
            return new messages_1.DatabaseError("received invalid response: " + code.toString(16), length2, "error");
        }
        reader.setBuffer(0, emptyBuffer);
        message2.length = length2;
        return message2;
      }
    };
    exports.Parser = Parser;
    var parseReadyForQueryMessage = (reader) => {
      const status = reader.string(1);
      return new messages_1.ReadyForQueryMessage(LATEINIT_LENGTH, status);
    };
    var parseCommandCompleteMessage = (reader) => {
      const text = reader.cstring();
      return new messages_1.CommandCompleteMessage(LATEINIT_LENGTH, text);
    };
    var parseCopyData = (reader, length2) => {
      const chunk = reader.bytes(length2 - 4);
      return new messages_1.CopyDataMessage(LATEINIT_LENGTH, chunk);
    };
    var parseCopyInMessage = (reader) => parseCopyMessage(reader, "copyInResponse");
    var parseCopyOutMessage = (reader) => parseCopyMessage(reader, "copyOutResponse");
    var parseCopyMessage = (reader, messageName) => {
      const isBinary = reader.byte() !== 0;
      const columnCount = reader.int16();
      const message2 = new messages_1.CopyResponse(LATEINIT_LENGTH, messageName, isBinary, columnCount);
      for (let i = 0; i < columnCount; i++) {
        message2.columnTypes[i] = reader.int16();
      }
      return message2;
    };
    var parseNotificationMessage = (reader) => {
      const processId = reader.int32();
      const channel = reader.cstring();
      const payload = reader.cstring();
      return new messages_1.NotificationResponseMessage(LATEINIT_LENGTH, processId, channel, payload);
    };
    var parseRowDescriptionMessage = (reader) => {
      const fieldCount = reader.int16();
      const message2 = new messages_1.RowDescriptionMessage(LATEINIT_LENGTH, fieldCount);
      for (let i = 0; i < fieldCount; i++) {
        message2.fields[i] = parseField(reader);
      }
      return message2;
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
      const message2 = new messages_1.ParameterDescriptionMessage(LATEINIT_LENGTH, parameterCount);
      for (let i = 0; i < parameterCount; i++) {
        message2.dataTypeIDs[i] = reader.uint32();
      }
      return message2;
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
    var parseAuthenticationResponse = (reader, length2) => {
      const code = reader.int32();
      const message2 = {
        name: "authenticationOk",
        length: length2
      };
      switch (code) {
        case 0:
          break;
        case 3:
          if (message2.length === 8) {
            message2.name = "authenticationCleartextPassword";
          }
          break;
        case 5:
          if (message2.length === 12) {
            message2.name = "authenticationMD5Password";
            const salt = reader.bytes(4);
            return new messages_1.AuthenticationMD5Password(LATEINIT_LENGTH, salt);
          }
          break;
        case 10:
          {
            message2.name = "authenticationSASL";
            message2.mechanisms = [];
            let mechanism;
            do {
              mechanism = reader.cstring();
              if (mechanism) {
                message2.mechanisms.push(mechanism);
              }
            } while (mechanism);
          }
          break;
        case 11:
          message2.name = "authenticationSASLContinue";
          message2.data = reader.string(length2 - 8);
          break;
        case 12:
          message2.name = "authenticationSASLFinal";
          message2.data = reader.string(length2 - 8);
          break;
        default:
          throw new Error("Unknown authenticationOk message type " + code);
      }
      return message2;
    };
    var parseErrorMessage = (reader, name) => {
      const fields = {};
      let fieldType = reader.string(1);
      while (fieldType !== "\0") {
        fields[fieldType] = reader.cstring();
        fieldType = reader.string(1);
      }
      const messageValue = fields.M;
      const message2 = name === "notice" ? new messages_1.NoticeMessage(LATEINIT_LENGTH, messageValue) : new messages_1.DatabaseError(messageValue, LATEINIT_LENGTH, name);
      message2.severity = fields.S;
      message2.code = fields.C;
      message2.detail = fields.D;
      message2.hint = fields.H;
      message2.position = fields.P;
      message2.internalPosition = fields.p;
      message2.internalQuery = fields.q;
      message2.where = fields.W;
      message2.schema = fields.s;
      message2.table = fields.t;
      message2.column = fields.c;
      message2.dataType = fields.d;
      message2.constraint = fields.n;
      message2.file = fields.F;
      message2.line = fields.L;
      message2.routine = fields.R;
      return message2;
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
      return new Promise((resolve) => stream.on("end", () => resolve()));
    }
  }
});

// node_modules/pg/lib/connection.js
var require_connection = __commonJS({
  "node_modules/pg/lib/connection.js"(exports, module) {
    "use strict";
    var net = __require("net");
    var EventEmitter = __require("events").EventEmitter;
    var util = __require("util");
    var { parse, serialize } = require_dist();
    var flushBuffer = serialize.flush();
    var syncBuffer = serialize.sync();
    var endBuffer = serialize.end();
    var Connection = class extends EventEmitter {
      constructor(config2) {
        super();
        config2 = config2 || {};
        this.stream = config2.stream || new net.Socket();
        this._keepAlive = config2.keepAlive;
        this._keepAliveInitialDelayMillis = config2.keepAliveInitialDelayMillis;
        this.lastBuffer = false;
        this.parsedStatements = {};
        this.ssl = config2.ssl || false;
        this._ending = false;
        this._emitMessage = false;
        var self = this;
        this.on("newListener", function(eventName) {
          if (eventName === "message") {
            self._emitMessage = true;
          }
        });
      }
      connect(port, host) {
        var self = this;
        this._connecting = true;
        this.stream.setNoDelay(true);
        this.stream.connect(port, host);
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
          var responseCode = buffer.toString("utf8");
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
          var tls = __require("tls");
          const options = Object.assign(
            {
              socket: self.stream
            },
            self.ssl
          );
          if (net.isIP(host) === 0) {
            options.servername = host;
          }
          try {
            self.stream = tls.connect(options);
          } catch (err) {
            return self.emit("error", err);
          }
          self.attachListeners(self.stream);
          self.stream.on("error", reportStreamError);
          self.emit("sslconnect");
        });
      }
      attachListeners(stream) {
        stream.on("end", () => {
          this.emit("end");
        });
        parse(stream, (msg) => {
          var eventName = msg.name === "error" ? "errorMessage" : msg.name;
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
      parse(query2) {
        this._send(serialize.parse(query2));
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
        this._send(flushBuffer);
        this._send(syncBuffer);
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
      sendCopyFromChunk(chunk) {
        this._send(serialize.copyData(chunk));
      }
      endCopyFrom() {
        this._send(serialize.copyDone());
      }
      sendCopyFail(msg) {
        this._send(serialize.copyFail(msg));
      }
    };
    module.exports = Connection;
  }
});

// node_modules/pg/lib/client.js
var require_client = __commonJS({
  "node_modules/pg/lib/client.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var util = __require("util");
    var utils = require_utils();
    var sasl = require_sasl();
    var pgPass = require_lib();
    var TypeOverrides = require_type_overrides();
    var ConnectionParameters = require_connection_parameters();
    var Query = require_query();
    var defaults = require_defaults();
    var Connection = require_connection();
    var Client = class extends EventEmitter {
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
        var c = config2 || {};
        this._Promise = c.Promise || global.Promise;
        this._types = new TypeOverrides(c.types);
        this._ending = false;
        this._connecting = false;
        this._connected = false;
        this._connectionError = false;
        this._queryable = true;
        this.connection = c.connection || new Connection({
          stream: c.stream,
          ssl: this.connectionParameters.ssl,
          keepAlive: c.keepAlive || false,
          keepAliveInitialDelayMillis: c.keepAliveInitialDelayMillis || 0,
          encoding: this.connectionParameters.client_encoding || "utf8"
        });
        this.queryQueue = [];
        this.binary = c.binary || defaults.binary;
        this.processID = null;
        this.secretKey = null;
        this.ssl = this.connectionParameters.ssl || false;
        this._connectionTimeoutMillis = c.connectionTimeoutMillis || 0;
      }
      _errorAllQueries(err) {
        const enqueueError = (query2) => {
          process.nextTick(() => {
            query2.handleError(err, this.connection);
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
        var self = this;
        var con = this.connection;
        this._connectionCallback = callback;
        if (this._connecting || this._connected) {
          const err = new Error("Client has already been connected. You cannot reuse a client.");
          process.nextTick(() => {
            callback(err);
          });
          return;
        }
        this._connecting = true;
        this.connectionTimeoutHandle;
        if (this._connectionTimeoutMillis > 0) {
          this.connectionTimeoutHandle = setTimeout(() => {
            con._ending = true;
            con.stream.destroy(new Error("timeout expired"));
          }, this._connectionTimeoutMillis);
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
        return new this._Promise((resolve, reject) => {
          this._connect((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
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
          pgPass(this.connectionParameters, (pass) => {
            if (void 0 !== pass) {
              this.connectionParameters.password = this.password = pass;
            }
            cb();
          });
        }
      }
      _handleAuthCleartextPassword(msg) {
        this._checkPgPass(() => {
          this.connection.password(this.password);
        });
      }
      _handleAuthMD5Password(msg) {
        this._checkPgPass(() => {
          const hashedPassword = utils.postgresMd5PasswordHash(this.user, this.password, msg.salt);
          this.connection.password(hashedPassword);
        });
      }
      _handleAuthSASL(msg) {
        this._checkPgPass(() => {
          this.saslSession = sasl.startSession(msg.mechanisms);
          this.connection.sendSASLInitialResponseMessage(this.saslSession.mechanism, this.saslSession.response);
        });
      }
      _handleAuthSASLContinue(msg) {
        sasl.continueSession(this.saslSession, this.password, msg.data);
        this.connection.sendSCRAMClientFinalMessage(this.saslSession.response);
      }
      _handleAuthSASLFinal(msg) {
        sasl.finalizeSession(this.saslSession, msg.data);
        this.saslSession = null;
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
      // if we receieve an error event or error message
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
        this.activeQuery.handleCommandComplete(msg, this.connection);
      }
      _handleParseComplete(msg) {
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
        var params = this.connectionParameters;
        var data = {
          user: params.user,
          database: params.database
        };
        var appName = params.application_name || params.fallback_application_name;
        if (appName) {
          data.application_name = appName;
        }
        if (params.replication) {
          data.replication = "" + params.replication;
        }
        if (params.statement_timeout) {
          data.statement_timeout = String(parseInt(params.statement_timeout, 10));
        }
        if (params.idle_in_transaction_session_timeout) {
          data.idle_in_transaction_session_timeout = String(parseInt(params.idle_in_transaction_session_timeout, 10));
        }
        if (params.options) {
          data.options = params.options;
        }
        return data;
      }
      cancel(client, query2) {
        if (client.activeQuery === query2) {
          var con = this.connection;
          if (this.host && this.host.indexOf("/") === 0) {
            con.connect(this.host + "/.s.PGSQL." + this.port);
          } else {
            con.connect(this.port, this.host);
          }
          con.on("connect", function() {
            con.cancel(client.processID, client.secretKey);
          });
        } else if (client.queryQueue.indexOf(query2) !== -1) {
          client.queryQueue.splice(client.queryQueue.indexOf(query2), 1);
        }
      }
      setTypeParser(oid, format, parseFn) {
        return this._types.setTypeParser(oid, format, parseFn);
      }
      getTypeParser(oid, format) {
        return this._types.getTypeParser(oid, format);
      }
      // Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
      escapeIdentifier(str) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      // Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
      escapeLiteral(str) {
        var hasBackslash = false;
        var escaped = "'";
        for (var i = 0; i < str.length; i++) {
          var c = str[i];
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
        var query2;
        var result;
        var readTimeout;
        var readTimeoutTimer;
        var queryCallback;
        if (config2 === null || config2 === void 0) {
          throw new TypeError("Client was passed a null or undefined query");
        } else if (typeof config2.submit === "function") {
          readTimeout = config2.query_timeout || this.connectionParameters.query_timeout;
          result = query2 = config2;
          if (typeof values === "function") {
            query2.callback = query2.callback || values;
          }
        } else {
          readTimeout = this.connectionParameters.query_timeout;
          query2 = new Query(config2, values, callback);
          if (!query2.callback) {
            result = new this._Promise((resolve, reject) => {
              query2.callback = (err, res) => err ? reject(err) : resolve(res);
            });
          }
        }
        if (readTimeout) {
          queryCallback = query2.callback;
          readTimeoutTimer = setTimeout(() => {
            var error = new Error("Query read timeout");
            process.nextTick(() => {
              query2.handleError(error, this.connection);
            });
            queryCallback(error);
            query2.callback = () => {
            };
            var index = this.queryQueue.indexOf(query2);
            if (index > -1) {
              this.queryQueue.splice(index, 1);
            }
            this._pulseQueryQueue();
          }, readTimeout);
          query2.callback = (err, res) => {
            clearTimeout(readTimeoutTimer);
            queryCallback(err, res);
          };
        }
        if (this.binary && !query2.binary) {
          query2.binary = true;
        }
        if (query2._result && !query2._result._types) {
          query2._result._types = this._types;
        }
        if (!this._queryable) {
          process.nextTick(() => {
            query2.handleError(new Error("Client has encountered a connection error and is not queryable"), this.connection);
          });
          return result;
        }
        if (this._ending) {
          process.nextTick(() => {
            query2.handleError(new Error("Client was closed and is not queryable"), this.connection);
          });
          return result;
        }
        this.queryQueue.push(query2);
        this._pulseQueryQueue();
        return result;
      }
      end(cb) {
        this._ending = true;
        if (!this.connection._connecting) {
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
          return new this._Promise((resolve) => {
            this.connection.once("end", resolve);
          });
        }
      }
    };
    Client.Query = Query;
    module.exports = Client;
  }
});

// node_modules/pg-pool/index.js
var require_pg_pool = __commonJS({
  "node_modules/pg-pool/index.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var NOOP = function() {
    };
    var removeWhere = (list, predicate) => {
      const i = list.findIndex(predicate);
      return i === -1 ? void 0 : list.splice(i, 1)[0];
    };
    var IdleItem = class {
      constructor(client, idleListener, timeoutId) {
        this.client = client;
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
      const cb = function(err, client) {
        err ? rej(err) : res(client);
      };
      const result = new Promise2(function(resolve, reject) {
        res = resolve;
        rej = reject;
      }).catch((err) => {
        Error.captureStackTrace(err);
        throw err;
      });
      return { callback: cb, result };
    }
    function makeIdleListener(pool2, client) {
      return function idleListener(err) {
        err.client = client;
        client.removeListener("error", idleListener);
        client.on("error", () => {
          pool2.log("additional client error after disconnection due to error", err);
        });
        pool2._remove(client);
        pool2.emit("error", err, client);
      };
    }
    var Pool = class extends EventEmitter {
      constructor(options, Client) {
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
        this.Client = this.options.Client || Client || require_lib2().Client;
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
        return new Promise2((resolve) => resolve(f()));
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
          const client = idleItem.client;
          client.ref && client.ref();
          const idleListener = idleItem.idleListener;
          return this._acquireClient(client, pendingItem, idleListener, false);
        }
        if (!this._isFull()) {
          return this.newClient(pendingItem);
        }
        throw new Error("unexpected condition");
      }
      _remove(client, callback) {
        const removed = removeWhere(this._idle, (item) => item.client === client);
        if (removed !== void 0) {
          clearTimeout(removed.timeoutId);
        }
        this._clients = this._clients.filter((c) => c !== client);
        const context = this;
        client.end(() => {
          context.emit("remove", client);
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
        const client = new this.Client(this.options);
        this._clients.push(client);
        const idleListener = makeIdleListener(this, client);
        this.log("checking client timeout");
        let tid;
        let timeoutHit = false;
        if (this.options.connectionTimeoutMillis) {
          tid = setTimeout(() => {
            if (client.connection) {
              this.log("ending client due to timeout");
              timeoutHit = true;
              client.connection.stream.destroy();
            } else if (!client.isConnected()) {
              this.log("ending client due to timeout");
              timeoutHit = true;
              client.end();
            }
          }, this.options.connectionTimeoutMillis);
        }
        this.log("connecting new client");
        client.connect((err) => {
          if (tid) {
            clearTimeout(tid);
          }
          client.on("error", idleListener);
          if (err) {
            this.log("client failed to connect", err);
            this._clients = this._clients.filter((c) => c !== client);
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
              this._promiseTry(() => this.options.onConnect(client)).then(
                () => {
                  this._afterConnect(client, pendingItem, idleListener);
                },
                (hookErr) => {
                  this._clients = this._clients.filter((c) => c !== client);
                  client.end(() => {
                    this._pulseQueue();
                    if (!pendingItem.timedOut) {
                      pendingItem.callback(hookErr, void 0, NOOP);
                    }
                  });
                }
              );
              return;
            }
            return this._afterConnect(client, pendingItem, idleListener);
          }
        });
      }
      _afterConnect(client, pendingItem, idleListener) {
        if (this.options.maxLifetimeSeconds !== 0) {
          const maxLifetimeTimeout = setTimeout(() => {
            this.log("ending client due to expired lifetime");
            this._expired.add(client);
            const idleIndex = this._idle.findIndex((idleItem) => idleItem.client === client);
            if (idleIndex !== -1) {
              this._acquireClient(
                client,
                new PendingItem((err, client2, clientRelease) => clientRelease()),
                idleListener,
                false
              );
            }
          }, this.options.maxLifetimeSeconds * 1e3);
          maxLifetimeTimeout.unref();
          client.once("end", () => clearTimeout(maxLifetimeTimeout));
        }
        return this._acquireClient(client, pendingItem, idleListener, true);
      }
      // acquire a client for a pending work item
      _acquireClient(client, pendingItem, idleListener, isNew) {
        if (isNew) {
          this.emit("connect", client);
        }
        this.emit("acquire", client);
        client.release = this._releaseOnce(client, idleListener);
        client.removeListener("error", idleListener);
        if (!pendingItem.timedOut) {
          if (isNew && this.options.verify) {
            this.options.verify(client, (err) => {
              if (err) {
                client.release(err);
                return pendingItem.callback(err, void 0, NOOP);
              }
              pendingItem.callback(void 0, client, client.release);
            });
          } else {
            pendingItem.callback(void 0, client, client.release);
          }
        } else {
          if (isNew && this.options.verify) {
            this.options.verify(client, client.release);
          } else {
            client.release();
          }
        }
      }
      // returns a function that wraps _release and throws if called more than once
      _releaseOnce(client, idleListener) {
        let released = false;
        return (err) => {
          if (released) {
            throwOnDoubleRelease();
          }
          released = true;
          this._release(client, idleListener, err);
        };
      }
      // release a client back to the poll, include an error
      // to remove it from the pool
      _release(client, idleListener, err) {
        client.on("error", idleListener);
        client._poolUseCount = (client._poolUseCount || 0) + 1;
        this.emit("release", err, client);
        if (err || this.ending || !client._queryable || client._ending || client._poolUseCount >= this.options.maxUses) {
          if (client._poolUseCount >= this.options.maxUses) {
            this.log("remove expended client");
          }
          return this._remove(client, this._pulseQueue.bind(this));
        }
        const isExpired = this._expired.has(client);
        if (isExpired) {
          this.log("remove expired client");
          this._expired.delete(client);
          return this._remove(client, this._pulseQueue.bind(this));
        }
        let tid;
        if (this.options.idleTimeoutMillis && this._isAboveMin()) {
          tid = setTimeout(() => {
            if (this._isAboveMin()) {
              this.log("remove idle client");
              this._remove(client, this._pulseQueue.bind(this));
            }
          }, this.options.idleTimeoutMillis);
          if (this.options.allowExitOnIdle) {
            tid.unref();
          }
        }
        if (this.options.allowExitOnIdle) {
          client.unref();
        }
        this._idle.push(new IdleItem(client, idleListener, tid));
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
        this.connect((err, client) => {
          if (err) {
            return cb(err);
          }
          let clientReleased = false;
          const onError = (err2) => {
            if (clientReleased) {
              return;
            }
            clientReleased = true;
            client.release(err2);
            cb(err2);
          };
          client.once("error", onError);
          this.log("dispatching query");
          try {
            client.query(text, values, (err2, res) => {
              this.log("query dispatched");
              client.removeListener("error", onError);
              if (clientReleased) {
                return;
              }
              clientReleased = true;
              client.release(err2);
              if (err2) {
                return cb(err2);
              }
              return cb(void 0, res);
            });
          } catch (err2) {
            client.release(err2);
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
        return this._clients.reduce((acc, client) => acc + (this._expired.has(client) ? 1 : 0), 0);
      }
      get totalCount() {
        return this._clients.length;
      }
    };
    module.exports = Pool;
  }
});

// node_modules/semver/internal/constants.js
var require_constants = __commonJS({
  "node_modules/semver/internal/constants.js"(exports, module) {
    var SEMVER_SPEC_VERSION = "2.0.0";
    var MAX_LENGTH = 256;
    var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
    9007199254740991;
    var MAX_SAFE_COMPONENT_LENGTH = 16;
    var MAX_SAFE_BUILD_LENGTH = MAX_LENGTH - 6;
    var RELEASE_TYPES = [
      "major",
      "premajor",
      "minor",
      "preminor",
      "patch",
      "prepatch",
      "prerelease"
    ];
    module.exports = {
      MAX_LENGTH,
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_SAFE_INTEGER,
      RELEASE_TYPES,
      SEMVER_SPEC_VERSION,
      FLAG_INCLUDE_PRERELEASE: 1,
      FLAG_LOOSE: 2
    };
  }
});

// node_modules/semver/internal/debug.js
var require_debug = __commonJS({
  "node_modules/semver/internal/debug.js"(exports, module) {
    var debug = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
    };
    module.exports = debug;
  }
});

// node_modules/semver/internal/re.js
var require_re = __commonJS({
  "node_modules/semver/internal/re.js"(exports, module) {
    var {
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_LENGTH
    } = require_constants();
    var debug = require_debug();
    exports = module.exports = {};
    var re = exports.re = [];
    var safeRe = exports.safeRe = [];
    var src = exports.src = [];
    var t = exports.t = {};
    var R = 0;
    var LETTERDASHNUMBER = "[a-zA-Z0-9-]";
    var safeRegexReplacements = [
      ["\\s", 1],
      ["\\d", MAX_LENGTH],
      [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH]
    ];
    var makeSafeRegex = (value) => {
      for (const [token, max] of safeRegexReplacements) {
        value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
      }
      return value;
    };
    var createToken = (name, value, isGlobal) => {
      const safe = makeSafeRegex(value);
      const index = R++;
      debug(name, index, value);
      t[name] = index;
      src[index] = value;
      re[index] = new RegExp(value, isGlobal ? "g" : void 0);
      safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
    };
    createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
    createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
    createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
    createToken("MAINVERSION", `(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})`);
    createToken("MAINVERSIONLOOSE", `(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASEIDENTIFIER", `(?:${src[t.NUMERICIDENTIFIER]}|${src[t.NONNUMERICIDENTIFIER]})`);
    createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t.NUMERICIDENTIFIERLOOSE]}|${src[t.NONNUMERICIDENTIFIER]})`);
    createToken("PRERELEASE", `(?:-(${src[t.PRERELEASEIDENTIFIER]}(?:\\.${src[t.PRERELEASEIDENTIFIER]})*))`);
    createToken("PRERELEASELOOSE", `(?:-?(${src[t.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t.PRERELEASEIDENTIFIERLOOSE]})*))`);
    createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
    createToken("BUILD", `(?:\\+(${src[t.BUILDIDENTIFIER]}(?:\\.${src[t.BUILDIDENTIFIER]})*))`);
    createToken("FULLPLAIN", `v?${src[t.MAINVERSION]}${src[t.PRERELEASE]}?${src[t.BUILD]}?`);
    createToken("FULL", `^${src[t.FULLPLAIN]}$`);
    createToken("LOOSEPLAIN", `[v=\\s]*${src[t.MAINVERSIONLOOSE]}${src[t.PRERELEASELOOSE]}?${src[t.BUILD]}?`);
    createToken("LOOSE", `^${src[t.LOOSEPLAIN]}$`);
    createToken("GTLT", "((?:<|>)?=?)");
    createToken("XRANGEIDENTIFIERLOOSE", `${src[t.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
    createToken("XRANGEIDENTIFIER", `${src[t.NUMERICIDENTIFIER]}|x|X|\\*`);
    createToken("XRANGEPLAIN", `[v=\\s]*(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:${src[t.PRERELEASE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:${src[t.PRERELEASELOOSE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAIN]}$`);
    createToken("XRANGELOOSE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COERCEPLAIN", `${"(^|[^\\d])(\\d{1,"}${MAX_SAFE_COMPONENT_LENGTH}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?`);
    createToken("COERCE", `${src[t.COERCEPLAIN]}(?:$|[^\\d])`);
    createToken("COERCEFULL", src[t.COERCEPLAIN] + `(?:${src[t.PRERELEASE]})?(?:${src[t.BUILD]})?(?:$|[^\\d])`);
    createToken("COERCERTL", src[t.COERCE], true);
    createToken("COERCERTLFULL", src[t.COERCEFULL], true);
    createToken("LONETILDE", "(?:~>?)");
    createToken("TILDETRIM", `(\\s*)${src[t.LONETILDE]}\\s+`, true);
    exports.tildeTrimReplace = "$1~";
    createToken("TILDE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAIN]}$`);
    createToken("TILDELOOSE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("LONECARET", "(?:\\^)");
    createToken("CARETTRIM", `(\\s*)${src[t.LONECARET]}\\s+`, true);
    exports.caretTrimReplace = "$1^";
    createToken("CARET", `^${src[t.LONECARET]}${src[t.XRANGEPLAIN]}$`);
    createToken("CARETLOOSE", `^${src[t.LONECARET]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COMPARATORLOOSE", `^${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]})$|^$`);
    createToken("COMPARATOR", `^${src[t.GTLT]}\\s*(${src[t.FULLPLAIN]})$|^$`);
    createToken("COMPARATORTRIM", `(\\s*)${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]}|${src[t.XRANGEPLAIN]})`, true);
    exports.comparatorTrimReplace = "$1$2$3";
    createToken("HYPHENRANGE", `^\\s*(${src[t.XRANGEPLAIN]})\\s+-\\s+(${src[t.XRANGEPLAIN]})\\s*$`);
    createToken("HYPHENRANGELOOSE", `^\\s*(${src[t.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t.XRANGEPLAINLOOSE]})\\s*$`);
    createToken("STAR", "(<|>)?=?\\s*\\*");
    createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
    createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
  }
});

// node_modules/semver/internal/parse-options.js
var require_parse_options = __commonJS({
  "node_modules/semver/internal/parse-options.js"(exports, module) {
    var looseOption = Object.freeze({ loose: true });
    var emptyOpts = Object.freeze({});
    var parseOptions = (options) => {
      if (!options) {
        return emptyOpts;
      }
      if (typeof options !== "object") {
        return looseOption;
      }
      return options;
    };
    module.exports = parseOptions;
  }
});

// node_modules/semver/internal/identifiers.js
var require_identifiers = __commonJS({
  "node_modules/semver/internal/identifiers.js"(exports, module) {
    var numeric = /^[0-9]+$/;
    var compareIdentifiers = (a, b) => {
      const anum = numeric.test(a);
      const bnum = numeric.test(b);
      if (anum && bnum) {
        a = +a;
        b = +b;
      }
      return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
    };
    var rcompareIdentifiers = (a, b) => compareIdentifiers(b, a);
    module.exports = {
      compareIdentifiers,
      rcompareIdentifiers
    };
  }
});

// node_modules/semver/classes/semver.js
var require_semver = __commonJS({
  "node_modules/semver/classes/semver.js"(exports, module) {
    var debug = require_debug();
    var { MAX_LENGTH, MAX_SAFE_INTEGER } = require_constants();
    var { safeRe: re, t } = require_re();
    var parseOptions = require_parse_options();
    var { compareIdentifiers } = require_identifiers();
    var SemVer = class _SemVer {
      constructor(version, options) {
        options = parseOptions(options);
        if (version instanceof _SemVer) {
          if (version.loose === !!options.loose && version.includePrerelease === !!options.includePrerelease) {
            return version;
          } else {
            version = version.version;
          }
        } else if (typeof version !== "string") {
          throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
        }
        if (version.length > MAX_LENGTH) {
          throw new TypeError(
            `version is longer than ${MAX_LENGTH} characters`
          );
        }
        debug("SemVer", version, options);
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        const m = version.trim().match(options.loose ? re[t.LOOSE] : re[t.FULL]);
        if (!m) {
          throw new TypeError(`Invalid Version: ${version}`);
        }
        this.raw = version;
        this.major = +m[1];
        this.minor = +m[2];
        this.patch = +m[3];
        if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
          throw new TypeError("Invalid major version");
        }
        if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
          throw new TypeError("Invalid minor version");
        }
        if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
          throw new TypeError("Invalid patch version");
        }
        if (!m[4]) {
          this.prerelease = [];
        } else {
          this.prerelease = m[4].split(".").map((id) => {
            if (/^[0-9]+$/.test(id)) {
              const num = +id;
              if (num >= 0 && num < MAX_SAFE_INTEGER) {
                return num;
              }
            }
            return id;
          });
        }
        this.build = m[5] ? m[5].split(".") : [];
        this.format();
      }
      format() {
        this.version = `${this.major}.${this.minor}.${this.patch}`;
        if (this.prerelease.length) {
          this.version += `-${this.prerelease.join(".")}`;
        }
        return this.version;
      }
      toString() {
        return this.version;
      }
      compare(other) {
        debug("SemVer.compare", this.version, this.options, other);
        if (!(other instanceof _SemVer)) {
          if (typeof other === "string" && other === this.version) {
            return 0;
          }
          other = new _SemVer(other, this.options);
        }
        if (other.version === this.version) {
          return 0;
        }
        return this.compareMain(other) || this.comparePre(other);
      }
      compareMain(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        return compareIdentifiers(this.major, other.major) || compareIdentifiers(this.minor, other.minor) || compareIdentifiers(this.patch, other.patch);
      }
      comparePre(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.prerelease.length && !other.prerelease.length) {
          return -1;
        } else if (!this.prerelease.length && other.prerelease.length) {
          return 1;
        } else if (!this.prerelease.length && !other.prerelease.length) {
          return 0;
        }
        let i = 0;
        do {
          const a = this.prerelease[i];
          const b = other.prerelease[i];
          debug("prerelease compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      compareBuild(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        let i = 0;
        do {
          const a = this.build[i];
          const b = other.build[i];
          debug("build compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      // preminor will bump the version up to the next minor release, and immediately
      // down to pre-release. premajor and prepatch work the same way.
      inc(release, identifier, identifierBase) {
        switch (release) {
          case "premajor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor = 0;
            this.major++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "preminor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "prepatch":
            this.prerelease.length = 0;
            this.inc("patch", identifier, identifierBase);
            this.inc("pre", identifier, identifierBase);
            break;
          // If the input is a non-prerelease version, this acts the same as
          // prepatch.
          case "prerelease":
            if (this.prerelease.length === 0) {
              this.inc("patch", identifier, identifierBase);
            }
            this.inc("pre", identifier, identifierBase);
            break;
          case "major":
            if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) {
              this.major++;
            }
            this.minor = 0;
            this.patch = 0;
            this.prerelease = [];
            break;
          case "minor":
            if (this.patch !== 0 || this.prerelease.length === 0) {
              this.minor++;
            }
            this.patch = 0;
            this.prerelease = [];
            break;
          case "patch":
            if (this.prerelease.length === 0) {
              this.patch++;
            }
            this.prerelease = [];
            break;
          // This probably shouldn't be used publicly.
          // 1.0.0 'pre' would become 1.0.0-0 which is the wrong direction.
          case "pre": {
            const base = Number(identifierBase) ? 1 : 0;
            if (!identifier && identifierBase === false) {
              throw new Error("invalid increment argument: identifier is empty");
            }
            if (this.prerelease.length === 0) {
              this.prerelease = [base];
            } else {
              let i = this.prerelease.length;
              while (--i >= 0) {
                if (typeof this.prerelease[i] === "number") {
                  this.prerelease[i]++;
                  i = -2;
                }
              }
              if (i === -1) {
                if (identifier === this.prerelease.join(".") && identifierBase === false) {
                  throw new Error("invalid increment argument: identifier already exists");
                }
                this.prerelease.push(base);
              }
            }
            if (identifier) {
              let prerelease = [identifier, base];
              if (identifierBase === false) {
                prerelease = [identifier];
              }
              if (compareIdentifiers(this.prerelease[0], identifier) === 0) {
                if (isNaN(this.prerelease[1])) {
                  this.prerelease = prerelease;
                }
              } else {
                this.prerelease = prerelease;
              }
            }
            break;
          }
          default:
            throw new Error(`invalid increment argument: ${release}`);
        }
        this.raw = this.format();
        if (this.build.length) {
          this.raw += `+${this.build.join(".")}`;
        }
        return this;
      }
    };
    module.exports = SemVer;
  }
});

// node_modules/semver/functions/parse.js
var require_parse = __commonJS({
  "node_modules/semver/functions/parse.js"(exports, module) {
    var SemVer = require_semver();
    var parse = (version, options, throwErrors = false) => {
      if (version instanceof SemVer) {
        return version;
      }
      try {
        return new SemVer(version, options);
      } catch (er) {
        if (!throwErrors) {
          return null;
        }
        throw er;
      }
    };
    module.exports = parse;
  }
});

// node_modules/semver/functions/valid.js
var require_valid = __commonJS({
  "node_modules/semver/functions/valid.js"(exports, module) {
    var parse = require_parse();
    var valid = (version, options) => {
      const v = parse(version, options);
      return v ? v.version : null;
    };
    module.exports = valid;
  }
});

// node_modules/semver/functions/clean.js
var require_clean = __commonJS({
  "node_modules/semver/functions/clean.js"(exports, module) {
    var parse = require_parse();
    var clean = (version, options) => {
      const s = parse(version.trim().replace(/^[=v]+/, ""), options);
      return s ? s.version : null;
    };
    module.exports = clean;
  }
});

// node_modules/semver/functions/inc.js
var require_inc = __commonJS({
  "node_modules/semver/functions/inc.js"(exports, module) {
    var SemVer = require_semver();
    var inc = (version, release, options, identifier, identifierBase) => {
      if (typeof options === "string") {
        identifierBase = identifier;
        identifier = options;
        options = void 0;
      }
      try {
        return new SemVer(
          version instanceof SemVer ? version.version : version,
          options
        ).inc(release, identifier, identifierBase).version;
      } catch (er) {
        return null;
      }
    };
    module.exports = inc;
  }
});

// node_modules/semver/functions/diff.js
var require_diff = __commonJS({
  "node_modules/semver/functions/diff.js"(exports, module) {
    var parse = require_parse();
    var diff = (version1, version2) => {
      const v1 = parse(version1, null, true);
      const v2 = parse(version2, null, true);
      const comparison = v1.compare(v2);
      if (comparison === 0) {
        return null;
      }
      const v1Higher = comparison > 0;
      const highVersion = v1Higher ? v1 : v2;
      const lowVersion = v1Higher ? v2 : v1;
      const highHasPre = !!highVersion.prerelease.length;
      const lowHasPre = !!lowVersion.prerelease.length;
      if (lowHasPre && !highHasPre) {
        if (!lowVersion.patch && !lowVersion.minor) {
          return "major";
        }
        if (highVersion.patch) {
          return "patch";
        }
        if (highVersion.minor) {
          return "minor";
        }
        return "major";
      }
      const prefix = highHasPre ? "pre" : "";
      if (v1.major !== v2.major) {
        return prefix + "major";
      }
      if (v1.minor !== v2.minor) {
        return prefix + "minor";
      }
      if (v1.patch !== v2.patch) {
        return prefix + "patch";
      }
      return "prerelease";
    };
    module.exports = diff;
  }
});

// node_modules/semver/functions/major.js
var require_major = __commonJS({
  "node_modules/semver/functions/major.js"(exports, module) {
    var SemVer = require_semver();
    var major = (a, loose) => new SemVer(a, loose).major;
    module.exports = major;
  }
});

// node_modules/semver/functions/minor.js
var require_minor = __commonJS({
  "node_modules/semver/functions/minor.js"(exports, module) {
    var SemVer = require_semver();
    var minor = (a, loose) => new SemVer(a, loose).minor;
    module.exports = minor;
  }
});

// node_modules/semver/functions/patch.js
var require_patch = __commonJS({
  "node_modules/semver/functions/patch.js"(exports, module) {
    var SemVer = require_semver();
    var patch = (a, loose) => new SemVer(a, loose).patch;
    module.exports = patch;
  }
});

// node_modules/semver/functions/prerelease.js
var require_prerelease = __commonJS({
  "node_modules/semver/functions/prerelease.js"(exports, module) {
    var parse = require_parse();
    var prerelease = (version, options) => {
      const parsed = parse(version, options);
      return parsed && parsed.prerelease.length ? parsed.prerelease : null;
    };
    module.exports = prerelease;
  }
});

// node_modules/semver/functions/compare.js
var require_compare = __commonJS({
  "node_modules/semver/functions/compare.js"(exports, module) {
    var SemVer = require_semver();
    var compare = (a, b, loose) => new SemVer(a, loose).compare(new SemVer(b, loose));
    module.exports = compare;
  }
});

// node_modules/semver/functions/rcompare.js
var require_rcompare = __commonJS({
  "node_modules/semver/functions/rcompare.js"(exports, module) {
    var compare = require_compare();
    var rcompare = (a, b, loose) => compare(b, a, loose);
    module.exports = rcompare;
  }
});

// node_modules/semver/functions/compare-loose.js
var require_compare_loose = __commonJS({
  "node_modules/semver/functions/compare-loose.js"(exports, module) {
    var compare = require_compare();
    var compareLoose = (a, b) => compare(a, b, true);
    module.exports = compareLoose;
  }
});

// node_modules/semver/functions/compare-build.js
var require_compare_build = __commonJS({
  "node_modules/semver/functions/compare-build.js"(exports, module) {
    var SemVer = require_semver();
    var compareBuild = (a, b, loose) => {
      const versionA = new SemVer(a, loose);
      const versionB = new SemVer(b, loose);
      return versionA.compare(versionB) || versionA.compareBuild(versionB);
    };
    module.exports = compareBuild;
  }
});

// node_modules/semver/functions/sort.js
var require_sort = __commonJS({
  "node_modules/semver/functions/sort.js"(exports, module) {
    var compareBuild = require_compare_build();
    var sort = (list, loose) => list.sort((a, b) => compareBuild(a, b, loose));
    module.exports = sort;
  }
});

// node_modules/semver/functions/rsort.js
var require_rsort = __commonJS({
  "node_modules/semver/functions/rsort.js"(exports, module) {
    var compareBuild = require_compare_build();
    var rsort = (list, loose) => list.sort((a, b) => compareBuild(b, a, loose));
    module.exports = rsort;
  }
});

// node_modules/semver/functions/gt.js
var require_gt = __commonJS({
  "node_modules/semver/functions/gt.js"(exports, module) {
    var compare = require_compare();
    var gt = (a, b, loose) => compare(a, b, loose) > 0;
    module.exports = gt;
  }
});

// node_modules/semver/functions/lt.js
var require_lt = __commonJS({
  "node_modules/semver/functions/lt.js"(exports, module) {
    var compare = require_compare();
    var lt = (a, b, loose) => compare(a, b, loose) < 0;
    module.exports = lt;
  }
});

// node_modules/semver/functions/eq.js
var require_eq = __commonJS({
  "node_modules/semver/functions/eq.js"(exports, module) {
    var compare = require_compare();
    var eq = (a, b, loose) => compare(a, b, loose) === 0;
    module.exports = eq;
  }
});

// node_modules/semver/functions/neq.js
var require_neq = __commonJS({
  "node_modules/semver/functions/neq.js"(exports, module) {
    var compare = require_compare();
    var neq = (a, b, loose) => compare(a, b, loose) !== 0;
    module.exports = neq;
  }
});

// node_modules/semver/functions/gte.js
var require_gte = __commonJS({
  "node_modules/semver/functions/gte.js"(exports, module) {
    var compare = require_compare();
    var gte = (a, b, loose) => compare(a, b, loose) >= 0;
    module.exports = gte;
  }
});

// node_modules/semver/functions/lte.js
var require_lte = __commonJS({
  "node_modules/semver/functions/lte.js"(exports, module) {
    var compare = require_compare();
    var lte = (a, b, loose) => compare(a, b, loose) <= 0;
    module.exports = lte;
  }
});

// node_modules/semver/functions/cmp.js
var require_cmp = __commonJS({
  "node_modules/semver/functions/cmp.js"(exports, module) {
    var eq = require_eq();
    var neq = require_neq();
    var gt = require_gt();
    var gte = require_gte();
    var lt = require_lt();
    var lte = require_lte();
    var cmp = (a, op, b, loose) => {
      switch (op) {
        case "===":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a === b;
        case "!==":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a !== b;
        case "":
        case "=":
        case "==":
          return eq(a, b, loose);
        case "!=":
          return neq(a, b, loose);
        case ">":
          return gt(a, b, loose);
        case ">=":
          return gte(a, b, loose);
        case "<":
          return lt(a, b, loose);
        case "<=":
          return lte(a, b, loose);
        default:
          throw new TypeError(`Invalid operator: ${op}`);
      }
    };
    module.exports = cmp;
  }
});

// node_modules/semver/functions/coerce.js
var require_coerce = __commonJS({
  "node_modules/semver/functions/coerce.js"(exports, module) {
    var SemVer = require_semver();
    var parse = require_parse();
    var { safeRe: re, t } = require_re();
    var coerce = (version, options) => {
      if (version instanceof SemVer) {
        return version;
      }
      if (typeof version === "number") {
        version = String(version);
      }
      if (typeof version !== "string") {
        return null;
      }
      options = options || {};
      let match2 = null;
      if (!options.rtl) {
        match2 = version.match(options.includePrerelease ? re[t.COERCEFULL] : re[t.COERCE]);
      } else {
        const coerceRtlRegex = options.includePrerelease ? re[t.COERCERTLFULL] : re[t.COERCERTL];
        let next;
        while ((next = coerceRtlRegex.exec(version)) && (!match2 || match2.index + match2[0].length !== version.length)) {
          if (!match2 || next.index + next[0].length !== match2.index + match2[0].length) {
            match2 = next;
          }
          coerceRtlRegex.lastIndex = next.index + next[1].length + next[2].length;
        }
        coerceRtlRegex.lastIndex = -1;
      }
      if (match2 === null) {
        return null;
      }
      const major = match2[2];
      const minor = match2[3] || "0";
      const patch = match2[4] || "0";
      const prerelease = options.includePrerelease && match2[5] ? `-${match2[5]}` : "";
      const build = options.includePrerelease && match2[6] ? `+${match2[6]}` : "";
      return parse(`${major}.${minor}.${patch}${prerelease}${build}`, options);
    };
    module.exports = coerce;
  }
});

// node_modules/semver/internal/lrucache.js
var require_lrucache = __commonJS({
  "node_modules/semver/internal/lrucache.js"(exports, module) {
    var LRUCache = class {
      constructor() {
        this.max = 1e3;
        this.map = /* @__PURE__ */ new Map();
      }
      get(key) {
        const value = this.map.get(key);
        if (value === void 0) {
          return void 0;
        } else {
          this.map.delete(key);
          this.map.set(key, value);
          return value;
        }
      }
      delete(key) {
        return this.map.delete(key);
      }
      set(key, value) {
        const deleted = this.delete(key);
        if (!deleted && value !== void 0) {
          if (this.map.size >= this.max) {
            const firstKey = this.map.keys().next().value;
            this.delete(firstKey);
          }
          this.map.set(key, value);
        }
        return this;
      }
    };
    module.exports = LRUCache;
  }
});

// node_modules/semver/classes/range.js
var require_range = __commonJS({
  "node_modules/semver/classes/range.js"(exports, module) {
    var SPACE_CHARACTERS = /\s+/g;
    var Range = class _Range {
      constructor(range, options) {
        options = parseOptions(options);
        if (range instanceof _Range) {
          if (range.loose === !!options.loose && range.includePrerelease === !!options.includePrerelease) {
            return range;
          } else {
            return new _Range(range.raw, options);
          }
        }
        if (range instanceof Comparator) {
          this.raw = range.value;
          this.set = [[range]];
          this.formatted = void 0;
          return this;
        }
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        this.raw = range.trim().replace(SPACE_CHARACTERS, " ");
        this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length);
        if (!this.set.length) {
          throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
        }
        if (this.set.length > 1) {
          const first = this.set[0];
          this.set = this.set.filter((c) => !isNullSet(c[0]));
          if (this.set.length === 0) {
            this.set = [first];
          } else if (this.set.length > 1) {
            for (const c of this.set) {
              if (c.length === 1 && isAny(c[0])) {
                this.set = [c];
                break;
              }
            }
          }
        }
        this.formatted = void 0;
      }
      get range() {
        if (this.formatted === void 0) {
          this.formatted = "";
          for (let i = 0; i < this.set.length; i++) {
            if (i > 0) {
              this.formatted += "||";
            }
            const comps = this.set[i];
            for (let k = 0; k < comps.length; k++) {
              if (k > 0) {
                this.formatted += " ";
              }
              this.formatted += comps[k].toString().trim();
            }
          }
        }
        return this.formatted;
      }
      format() {
        return this.range;
      }
      toString() {
        return this.range;
      }
      parseRange(range) {
        const memoOpts = (this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE);
        const memoKey = memoOpts + ":" + range;
        const cached = cache.get(memoKey);
        if (cached) {
          return cached;
        }
        const loose = this.options.loose;
        const hr = loose ? re[t.HYPHENRANGELOOSE] : re[t.HYPHENRANGE];
        range = range.replace(hr, hyphenReplace(this.options.includePrerelease));
        debug("hyphen replace", range);
        range = range.replace(re[t.COMPARATORTRIM], comparatorTrimReplace);
        debug("comparator trim", range);
        range = range.replace(re[t.TILDETRIM], tildeTrimReplace);
        debug("tilde trim", range);
        range = range.replace(re[t.CARETTRIM], caretTrimReplace);
        debug("caret trim", range);
        let rangeList = range.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
        if (loose) {
          rangeList = rangeList.filter((comp) => {
            debug("loose invalid filter", comp, this.options);
            return !!comp.match(re[t.COMPARATORLOOSE]);
          });
        }
        debug("range list", rangeList);
        const rangeMap = /* @__PURE__ */ new Map();
        const comparators = rangeList.map((comp) => new Comparator(comp, this.options));
        for (const comp of comparators) {
          if (isNullSet(comp)) {
            return [comp];
          }
          rangeMap.set(comp.value, comp);
        }
        if (rangeMap.size > 1 && rangeMap.has("")) {
          rangeMap.delete("");
        }
        const result = [...rangeMap.values()];
        cache.set(memoKey, result);
        return result;
      }
      intersects(range, options) {
        if (!(range instanceof _Range)) {
          throw new TypeError("a Range is required");
        }
        return this.set.some((thisComparators) => {
          return isSatisfiable(thisComparators, options) && range.set.some((rangeComparators) => {
            return isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => {
              return rangeComparators.every((rangeComparator) => {
                return thisComparator.intersects(rangeComparator, options);
              });
            });
          });
        });
      }
      // if ANY of the sets match ALL of its comparators, then pass
      test(version) {
        if (!version) {
          return false;
        }
        if (typeof version === "string") {
          try {
            version = new SemVer(version, this.options);
          } catch (er) {
            return false;
          }
        }
        for (let i = 0; i < this.set.length; i++) {
          if (testSet(this.set[i], version, this.options)) {
            return true;
          }
        }
        return false;
      }
    };
    module.exports = Range;
    var LRU = require_lrucache();
    var cache = new LRU();
    var parseOptions = require_parse_options();
    var Comparator = require_comparator();
    var debug = require_debug();
    var SemVer = require_semver();
    var {
      safeRe: re,
      t,
      comparatorTrimReplace,
      tildeTrimReplace,
      caretTrimReplace
    } = require_re();
    var { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = require_constants();
    var isNullSet = (c) => c.value === "<0.0.0-0";
    var isAny = (c) => c.value === "";
    var isSatisfiable = (comparators, options) => {
      let result = true;
      const remainingComparators = comparators.slice();
      let testComparator = remainingComparators.pop();
      while (result && remainingComparators.length) {
        result = remainingComparators.every((otherComparator) => {
          return testComparator.intersects(otherComparator, options);
        });
        testComparator = remainingComparators.pop();
      }
      return result;
    };
    var parseComparator = (comp, options) => {
      debug("comp", comp, options);
      comp = replaceCarets(comp, options);
      debug("caret", comp);
      comp = replaceTildes(comp, options);
      debug("tildes", comp);
      comp = replaceXRanges(comp, options);
      debug("xrange", comp);
      comp = replaceStars(comp, options);
      debug("stars", comp);
      return comp;
    };
    var isX = (id) => !id || id.toLowerCase() === "x" || id === "*";
    var replaceTildes = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" ");
    };
    var replaceTilde = (comp, options) => {
      const r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE];
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("tilde", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0 <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          ret = `>=${M}.${m}.0 <${M}.${+m + 1}.0-0`;
        } else if (pr) {
          debug("replaceTilde pr", pr);
          ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
        } else {
          ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
        }
        debug("tilde return", ret);
        return ret;
      });
    };
    var replaceCarets = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" ");
    };
    var replaceCaret = (comp, options) => {
      debug("caret", comp, options);
      const r = options.loose ? re[t.CARETLOOSE] : re[t.CARET];
      const z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("caret", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          if (M === "0") {
            ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
          } else {
            ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
          }
        } else if (pr) {
          debug("replaceCaret pr", pr);
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
          }
        } else {
          debug("no pr");
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p}${z} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p}${z} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
          }
        }
        debug("caret return", ret);
        return ret;
      });
    };
    var replaceXRanges = (comp, options) => {
      debug("replaceXRanges", comp, options);
      return comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ");
    };
    var replaceXRange = (comp, options) => {
      comp = comp.trim();
      const r = options.loose ? re[t.XRANGELOOSE] : re[t.XRANGE];
      return comp.replace(r, (ret, gtlt, M, m, p, pr) => {
        debug("xRange", comp, ret, gtlt, M, m, p, pr);
        const xM = isX(M);
        const xm = xM || isX(m);
        const xp = xm || isX(p);
        const anyX = xp;
        if (gtlt === "=" && anyX) {
          gtlt = "";
        }
        pr = options.includePrerelease ? "-0" : "";
        if (xM) {
          if (gtlt === ">" || gtlt === "<") {
            ret = "<0.0.0-0";
          } else {
            ret = "*";
          }
        } else if (gtlt && anyX) {
          if (xm) {
            m = 0;
          }
          p = 0;
          if (gtlt === ">") {
            gtlt = ">=";
            if (xm) {
              M = +M + 1;
              m = 0;
              p = 0;
            } else {
              m = +m + 1;
              p = 0;
            }
          } else if (gtlt === "<=") {
            gtlt = "<";
            if (xm) {
              M = +M + 1;
            } else {
              m = +m + 1;
            }
          }
          if (gtlt === "<") {
            pr = "-0";
          }
          ret = `${gtlt + M}.${m}.${p}${pr}`;
        } else if (xm) {
          ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
        } else if (xp) {
          ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
        }
        debug("xRange return", ret);
        return ret;
      });
    };
    var replaceStars = (comp, options) => {
      debug("replaceStars", comp, options);
      return comp.trim().replace(re[t.STAR], "");
    };
    var replaceGTE0 = (comp, options) => {
      debug("replaceGTE0", comp, options);
      return comp.trim().replace(re[options.includePrerelease ? t.GTE0PRE : t.GTE0], "");
    };
    var hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => {
      if (isX(fM)) {
        from = "";
      } else if (isX(fm)) {
        from = `>=${fM}.0.0${incPr ? "-0" : ""}`;
      } else if (isX(fp)) {
        from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}`;
      } else if (fpr) {
        from = `>=${from}`;
      } else {
        from = `>=${from}${incPr ? "-0" : ""}`;
      }
      if (isX(tM)) {
        to = "";
      } else if (isX(tm)) {
        to = `<${+tM + 1}.0.0-0`;
      } else if (isX(tp)) {
        to = `<${tM}.${+tm + 1}.0-0`;
      } else if (tpr) {
        to = `<=${tM}.${tm}.${tp}-${tpr}`;
      } else if (incPr) {
        to = `<${tM}.${tm}.${+tp + 1}-0`;
      } else {
        to = `<=${to}`;
      }
      return `${from} ${to}`.trim();
    };
    var testSet = (set, version, options) => {
      for (let i = 0; i < set.length; i++) {
        if (!set[i].test(version)) {
          return false;
        }
      }
      if (version.prerelease.length && !options.includePrerelease) {
        for (let i = 0; i < set.length; i++) {
          debug(set[i].semver);
          if (set[i].semver === Comparator.ANY) {
            continue;
          }
          if (set[i].semver.prerelease.length > 0) {
            const allowed = set[i].semver;
            if (allowed.major === version.major && allowed.minor === version.minor && allowed.patch === version.patch) {
              return true;
            }
          }
        }
        return false;
      }
      return true;
    };
  }
});

// node_modules/semver/classes/comparator.js
var require_comparator = __commonJS({
  "node_modules/semver/classes/comparator.js"(exports, module) {
    var ANY = Symbol("SemVer ANY");
    var Comparator = class _Comparator {
      static get ANY() {
        return ANY;
      }
      constructor(comp, options) {
        options = parseOptions(options);
        if (comp instanceof _Comparator) {
          if (comp.loose === !!options.loose) {
            return comp;
          } else {
            comp = comp.value;
          }
        }
        comp = comp.trim().split(/\s+/).join(" ");
        debug("comparator", comp, options);
        this.options = options;
        this.loose = !!options.loose;
        this.parse(comp);
        if (this.semver === ANY) {
          this.value = "";
        } else {
          this.value = this.operator + this.semver.version;
        }
        debug("comp", this);
      }
      parse(comp) {
        const r = this.options.loose ? re[t.COMPARATORLOOSE] : re[t.COMPARATOR];
        const m = comp.match(r);
        if (!m) {
          throw new TypeError(`Invalid comparator: ${comp}`);
        }
        this.operator = m[1] !== void 0 ? m[1] : "";
        if (this.operator === "=") {
          this.operator = "";
        }
        if (!m[2]) {
          this.semver = ANY;
        } else {
          this.semver = new SemVer(m[2], this.options.loose);
        }
      }
      toString() {
        return this.value;
      }
      test(version) {
        debug("Comparator.test", version, this.options.loose);
        if (this.semver === ANY || version === ANY) {
          return true;
        }
        if (typeof version === "string") {
          try {
            version = new SemVer(version, this.options);
          } catch (er) {
            return false;
          }
        }
        return cmp(version, this.operator, this.semver, this.options);
      }
      intersects(comp, options) {
        if (!(comp instanceof _Comparator)) {
          throw new TypeError("a Comparator is required");
        }
        if (this.operator === "") {
          if (this.value === "") {
            return true;
          }
          return new Range(comp.value, options).test(this.value);
        } else if (comp.operator === "") {
          if (comp.value === "") {
            return true;
          }
          return new Range(this.value, options).test(comp.semver);
        }
        options = parseOptions(options);
        if (options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0")) {
          return false;
        }
        if (!options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0"))) {
          return false;
        }
        if (this.operator.startsWith(">") && comp.operator.startsWith(">")) {
          return true;
        }
        if (this.operator.startsWith("<") && comp.operator.startsWith("<")) {
          return true;
        }
        if (this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=")) {
          return true;
        }
        if (cmp(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<")) {
          return true;
        }
        if (cmp(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")) {
          return true;
        }
        return false;
      }
    };
    module.exports = Comparator;
    var parseOptions = require_parse_options();
    var { safeRe: re, t } = require_re();
    var cmp = require_cmp();
    var debug = require_debug();
    var SemVer = require_semver();
    var Range = require_range();
  }
});

// node_modules/semver/functions/satisfies.js
var require_satisfies = __commonJS({
  "node_modules/semver/functions/satisfies.js"(exports, module) {
    var Range = require_range();
    var satisfies = (version, range, options) => {
      try {
        range = new Range(range, options);
      } catch (er) {
        return false;
      }
      return range.test(version);
    };
    module.exports = satisfies;
  }
});

// node_modules/semver/ranges/to-comparators.js
var require_to_comparators = __commonJS({
  "node_modules/semver/ranges/to-comparators.js"(exports, module) {
    var Range = require_range();
    var toComparators = (range, options) => new Range(range, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
    module.exports = toComparators;
  }
});

// node_modules/semver/ranges/max-satisfying.js
var require_max_satisfying = __commonJS({
  "node_modules/semver/ranges/max-satisfying.js"(exports, module) {
    var SemVer = require_semver();
    var Range = require_range();
    var maxSatisfying = (versions, range, options) => {
      let max = null;
      let maxSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!max || maxSV.compare(v) === -1) {
            max = v;
            maxSV = new SemVer(max, options);
          }
        }
      });
      return max;
    };
    module.exports = maxSatisfying;
  }
});

// node_modules/semver/ranges/min-satisfying.js
var require_min_satisfying = __commonJS({
  "node_modules/semver/ranges/min-satisfying.js"(exports, module) {
    var SemVer = require_semver();
    var Range = require_range();
    var minSatisfying = (versions, range, options) => {
      let min = null;
      let minSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!min || minSV.compare(v) === 1) {
            min = v;
            minSV = new SemVer(min, options);
          }
        }
      });
      return min;
    };
    module.exports = minSatisfying;
  }
});

// node_modules/semver/ranges/min-version.js
var require_min_version = __commonJS({
  "node_modules/semver/ranges/min-version.js"(exports, module) {
    var SemVer = require_semver();
    var Range = require_range();
    var gt = require_gt();
    var minVersion = (range, loose) => {
      range = new Range(range, loose);
      let minver = new SemVer("0.0.0");
      if (range.test(minver)) {
        return minver;
      }
      minver = new SemVer("0.0.0-0");
      if (range.test(minver)) {
        return minver;
      }
      minver = null;
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let setMin = null;
        comparators.forEach((comparator) => {
          const compver = new SemVer(comparator.semver.version);
          switch (comparator.operator) {
            case ">":
              if (compver.prerelease.length === 0) {
                compver.patch++;
              } else {
                compver.prerelease.push(0);
              }
              compver.raw = compver.format();
            /* fallthrough */
            case "":
            case ">=":
              if (!setMin || gt(compver, setMin)) {
                setMin = compver;
              }
              break;
            case "<":
            case "<=":
              break;
            /* istanbul ignore next */
            default:
              throw new Error(`Unexpected operation: ${comparator.operator}`);
          }
        });
        if (setMin && (!minver || gt(minver, setMin))) {
          minver = setMin;
        }
      }
      if (minver && range.test(minver)) {
        return minver;
      }
      return null;
    };
    module.exports = minVersion;
  }
});

// node_modules/semver/ranges/valid.js
var require_valid2 = __commonJS({
  "node_modules/semver/ranges/valid.js"(exports, module) {
    var Range = require_range();
    var validRange = (range, options) => {
      try {
        return new Range(range, options).range || "*";
      } catch (er) {
        return null;
      }
    };
    module.exports = validRange;
  }
});

// node_modules/semver/ranges/outside.js
var require_outside = __commonJS({
  "node_modules/semver/ranges/outside.js"(exports, module) {
    var SemVer = require_semver();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var Range = require_range();
    var satisfies = require_satisfies();
    var gt = require_gt();
    var lt = require_lt();
    var lte = require_lte();
    var gte = require_gte();
    var outside = (version, range, hilo, options) => {
      version = new SemVer(version, options);
      range = new Range(range, options);
      let gtfn, ltefn, ltfn, comp, ecomp;
      switch (hilo) {
        case ">":
          gtfn = gt;
          ltefn = lte;
          ltfn = lt;
          comp = ">";
          ecomp = ">=";
          break;
        case "<":
          gtfn = lt;
          ltefn = gte;
          ltfn = gt;
          comp = "<";
          ecomp = "<=";
          break;
        default:
          throw new TypeError('Must provide a hilo val of "<" or ">"');
      }
      if (satisfies(version, range, options)) {
        return false;
      }
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let high = null;
        let low = null;
        comparators.forEach((comparator) => {
          if (comparator.semver === ANY) {
            comparator = new Comparator(">=0.0.0");
          }
          high = high || comparator;
          low = low || comparator;
          if (gtfn(comparator.semver, high.semver, options)) {
            high = comparator;
          } else if (ltfn(comparator.semver, low.semver, options)) {
            low = comparator;
          }
        });
        if (high.operator === comp || high.operator === ecomp) {
          return false;
        }
        if ((!low.operator || low.operator === comp) && ltefn(version, low.semver)) {
          return false;
        } else if (low.operator === ecomp && ltfn(version, low.semver)) {
          return false;
        }
      }
      return true;
    };
    module.exports = outside;
  }
});

// node_modules/semver/ranges/gtr.js
var require_gtr = __commonJS({
  "node_modules/semver/ranges/gtr.js"(exports, module) {
    var outside = require_outside();
    var gtr = (version, range, options) => outside(version, range, ">", options);
    module.exports = gtr;
  }
});

// node_modules/semver/ranges/ltr.js
var require_ltr = __commonJS({
  "node_modules/semver/ranges/ltr.js"(exports, module) {
    var outside = require_outside();
    var ltr = (version, range, options) => outside(version, range, "<", options);
    module.exports = ltr;
  }
});

// node_modules/semver/ranges/intersects.js
var require_intersects = __commonJS({
  "node_modules/semver/ranges/intersects.js"(exports, module) {
    var Range = require_range();
    var intersects = (r1, r2, options) => {
      r1 = new Range(r1, options);
      r2 = new Range(r2, options);
      return r1.intersects(r2, options);
    };
    module.exports = intersects;
  }
});

// node_modules/semver/ranges/simplify.js
var require_simplify = __commonJS({
  "node_modules/semver/ranges/simplify.js"(exports, module) {
    var satisfies = require_satisfies();
    var compare = require_compare();
    module.exports = (versions, range, options) => {
      const set = [];
      let first = null;
      let prev = null;
      const v = versions.sort((a, b) => compare(a, b, options));
      for (const version of v) {
        const included = satisfies(version, range, options);
        if (included) {
          prev = version;
          if (!first) {
            first = version;
          }
        } else {
          if (prev) {
            set.push([first, prev]);
          }
          prev = null;
          first = null;
        }
      }
      if (first) {
        set.push([first, null]);
      }
      const ranges = [];
      for (const [min, max] of set) {
        if (min === max) {
          ranges.push(min);
        } else if (!max && min === v[0]) {
          ranges.push("*");
        } else if (!max) {
          ranges.push(`>=${min}`);
        } else if (min === v[0]) {
          ranges.push(`<=${max}`);
        } else {
          ranges.push(`${min} - ${max}`);
        }
      }
      const simplified = ranges.join(" || ");
      const original = typeof range.raw === "string" ? range.raw : String(range);
      return simplified.length < original.length ? simplified : range;
    };
  }
});

// node_modules/semver/ranges/subset.js
var require_subset = __commonJS({
  "node_modules/semver/ranges/subset.js"(exports, module) {
    var Range = require_range();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var satisfies = require_satisfies();
    var compare = require_compare();
    var subset = (sub, dom, options = {}) => {
      if (sub === dom) {
        return true;
      }
      sub = new Range(sub, options);
      dom = new Range(dom, options);
      let sawNonNull = false;
      OUTER: for (const simpleSub of sub.set) {
        for (const simpleDom of dom.set) {
          const isSub = simpleSubset(simpleSub, simpleDom, options);
          sawNonNull = sawNonNull || isSub !== null;
          if (isSub) {
            continue OUTER;
          }
        }
        if (sawNonNull) {
          return false;
        }
      }
      return true;
    };
    var minimumVersionWithPreRelease = [new Comparator(">=0.0.0-0")];
    var minimumVersion = [new Comparator(">=0.0.0")];
    var simpleSubset = (sub, dom, options) => {
      if (sub === dom) {
        return true;
      }
      if (sub.length === 1 && sub[0].semver === ANY) {
        if (dom.length === 1 && dom[0].semver === ANY) {
          return true;
        } else if (options.includePrerelease) {
          sub = minimumVersionWithPreRelease;
        } else {
          sub = minimumVersion;
        }
      }
      if (dom.length === 1 && dom[0].semver === ANY) {
        if (options.includePrerelease) {
          return true;
        } else {
          dom = minimumVersion;
        }
      }
      const eqSet = /* @__PURE__ */ new Set();
      let gt, lt;
      for (const c of sub) {
        if (c.operator === ">" || c.operator === ">=") {
          gt = higherGT(gt, c, options);
        } else if (c.operator === "<" || c.operator === "<=") {
          lt = lowerLT(lt, c, options);
        } else {
          eqSet.add(c.semver);
        }
      }
      if (eqSet.size > 1) {
        return null;
      }
      let gtltComp;
      if (gt && lt) {
        gtltComp = compare(gt.semver, lt.semver, options);
        if (gtltComp > 0) {
          return null;
        } else if (gtltComp === 0 && (gt.operator !== ">=" || lt.operator !== "<=")) {
          return null;
        }
      }
      for (const eq of eqSet) {
        if (gt && !satisfies(eq, String(gt), options)) {
          return null;
        }
        if (lt && !satisfies(eq, String(lt), options)) {
          return null;
        }
        for (const c of dom) {
          if (!satisfies(eq, String(c), options)) {
            return false;
          }
        }
        return true;
      }
      let higher, lower;
      let hasDomLT, hasDomGT;
      let needDomLTPre = lt && !options.includePrerelease && lt.semver.prerelease.length ? lt.semver : false;
      let needDomGTPre = gt && !options.includePrerelease && gt.semver.prerelease.length ? gt.semver : false;
      if (needDomLTPre && needDomLTPre.prerelease.length === 1 && lt.operator === "<" && needDomLTPre.prerelease[0] === 0) {
        needDomLTPre = false;
      }
      for (const c of dom) {
        hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=";
        hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=";
        if (gt) {
          if (needDomGTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch) {
              needDomGTPre = false;
            }
          }
          if (c.operator === ">" || c.operator === ">=") {
            higher = higherGT(gt, c, options);
            if (higher === c && higher !== gt) {
              return false;
            }
          } else if (gt.operator === ">=" && !satisfies(gt.semver, String(c), options)) {
            return false;
          }
        }
        if (lt) {
          if (needDomLTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch) {
              needDomLTPre = false;
            }
          }
          if (c.operator === "<" || c.operator === "<=") {
            lower = lowerLT(lt, c, options);
            if (lower === c && lower !== lt) {
              return false;
            }
          } else if (lt.operator === "<=" && !satisfies(lt.semver, String(c), options)) {
            return false;
          }
        }
        if (!c.operator && (lt || gt) && gtltComp !== 0) {
          return false;
        }
      }
      if (gt && hasDomLT && !lt && gtltComp !== 0) {
        return false;
      }
      if (lt && hasDomGT && !gt && gtltComp !== 0) {
        return false;
      }
      if (needDomGTPre || needDomLTPre) {
        return false;
      }
      return true;
    };
    var higherGT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare(a.semver, b.semver, options);
      return comp > 0 ? a : comp < 0 ? b : b.operator === ">" && a.operator === ">=" ? b : a;
    };
    var lowerLT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare(a.semver, b.semver, options);
      return comp < 0 ? a : comp > 0 ? b : b.operator === "<" && a.operator === "<=" ? b : a;
    };
    module.exports = subset;
  }
});

// node_modules/semver/index.js
var require_semver2 = __commonJS({
  "node_modules/semver/index.js"(exports, module) {
    var internalRe = require_re();
    var constants = require_constants();
    var SemVer = require_semver();
    var identifiers = require_identifiers();
    var parse = require_parse();
    var valid = require_valid();
    var clean = require_clean();
    var inc = require_inc();
    var diff = require_diff();
    var major = require_major();
    var minor = require_minor();
    var patch = require_patch();
    var prerelease = require_prerelease();
    var compare = require_compare();
    var rcompare = require_rcompare();
    var compareLoose = require_compare_loose();
    var compareBuild = require_compare_build();
    var sort = require_sort();
    var rsort = require_rsort();
    var gt = require_gt();
    var lt = require_lt();
    var eq = require_eq();
    var neq = require_neq();
    var gte = require_gte();
    var lte = require_lte();
    var cmp = require_cmp();
    var coerce = require_coerce();
    var Comparator = require_comparator();
    var Range = require_range();
    var satisfies = require_satisfies();
    var toComparators = require_to_comparators();
    var maxSatisfying = require_max_satisfying();
    var minSatisfying = require_min_satisfying();
    var minVersion = require_min_version();
    var validRange = require_valid2();
    var outside = require_outside();
    var gtr = require_gtr();
    var ltr = require_ltr();
    var intersects = require_intersects();
    var simplifyRange = require_simplify();
    var subset = require_subset();
    module.exports = {
      parse,
      valid,
      clean,
      inc,
      diff,
      major,
      minor,
      patch,
      prerelease,
      compare,
      rcompare,
      compareLoose,
      compareBuild,
      sort,
      rsort,
      gt,
      lt,
      eq,
      neq,
      gte,
      lte,
      cmp,
      coerce,
      Comparator,
      Range,
      satisfies,
      toComparators,
      maxSatisfying,
      minSatisfying,
      minVersion,
      validRange,
      outside,
      gtr,
      ltr,
      intersects,
      simplifyRange,
      subset,
      SemVer,
      re: internalRe.re,
      src: internalRe.src,
      tokens: internalRe.t,
      SEMVER_SPEC_VERSION: constants.SEMVER_SPEC_VERSION,
      RELEASE_TYPES: constants.RELEASE_TYPES,
      compareIdentifiers: identifiers.compareIdentifiers,
      rcompareIdentifiers: identifiers.rcompareIdentifiers
    };
  }
});

// node_modules/pg/package.json
var require_package = __commonJS({
  "node_modules/pg/package.json"(exports, module) {
    module.exports = {
      name: "pg",
      version: "8.3.3",
      description: "PostgreSQL client - pure javascript & libpq with the same API",
      keywords: [
        "database",
        "libpq",
        "pg",
        "postgre",
        "postgres",
        "postgresql",
        "rdbms"
      ],
      homepage: "https://github.com/brianc/node-postgres",
      repository: {
        type: "git",
        url: "git://github.com/brianc/node-postgres.git"
      },
      author: "Brian Carlson <brian.m.carlson@gmail.com>",
      main: "./lib",
      dependencies: {
        "buffer-writer": "2.0.0",
        "packet-reader": "1.0.0",
        "pg-connection-string": "^2.3.0",
        "pg-pool": "^3.2.1",
        "pg-protocol": "^1.2.5",
        "pg-types": "^2.1.0",
        pgpass: "1.x",
        semver: "4.3.2"
      },
      devDependencies: {
        async: "0.9.0",
        bluebird: "3.5.2",
        co: "4.6.0",
        "pg-copy-streams": "0.3.0"
      },
      minNativeVersion: "2.0.0",
      scripts: {
        test: "make test-all"
      },
      files: [
        "lib",
        "SPONSORS.md"
      ],
      license: "MIT",
      engines: {
        node: ">= 8.0.0"
      },
      gitHead: "95b5daadaade40ea343c0d3ad09ab230fa2ade4c"
    };
  }
});

// node_modules/pg/lib/native/query.js
var require_query2 = __commonJS({
  "node_modules/pg/lib/native/query.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var util = __require("util");
    var utils = require_utils();
    var NativeQuery = module.exports = function(config2, values, callback) {
      EventEmitter.call(this);
      config2 = utils.normalizeQueryConfig(config2, values, callback);
      this.text = config2.text;
      this.values = config2.values;
      this.name = config2.name;
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
      /* eslint-disable quote-props */
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
      var fields = this.native.pq.resultErrorFields();
      if (fields) {
        for (var key in fields) {
          var normalizedFieldName = errorFieldMap[key] || key;
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
        function(resolve, reject) {
          this._once("end", resolve);
          this._once("error", reject);
        }.bind(this)
      );
      return this._promise;
    };
    NativeQuery.prototype.submit = function(client) {
      this.state = "running";
      var self = this;
      this.native = client.native;
      client.native.arrayMode = this._arrayMode;
      var after = function(err, rows, results) {
        client.native.arrayMode = false;
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
        var values = (this.values || []).map(utils.prepareValue);
        if (client.namedQueries[this.name]) {
          if (this.text && client.namedQueries[this.name] !== this.text) {
            const err = new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`);
            return after(err);
          }
          return client.native.execute(this.name, values, after);
        }
        return client.native.prepare(this.name, this.text, values.length, function(err) {
          if (err) return after(err);
          client.namedQueries[self.name] = self.text;
          return self.native.execute(self.name, values, after);
        });
      } else if (this.values) {
        if (!Array.isArray(this.values)) {
          const err = new Error("Query values must be an array");
          return after(err);
        }
        var vals = this.values.map(utils.prepareValue);
        client.native.query(this.text, vals, after);
      } else {
        client.native.query(this.text, after);
      }
    };
  }
});

// node_modules/pg/lib/native/client.js
var require_client2 = __commonJS({
  "node_modules/pg/lib/native/client.js"(exports, module) {
    "use strict";
    var Native = __require("pg-native");
    var TypeOverrides = require_type_overrides();
    var semver = require_semver2();
    var pkg = require_package();
    var assert = __require("assert");
    var EventEmitter = __require("events").EventEmitter;
    var util = __require("util");
    var ConnectionParameters = require_connection_parameters();
    var msg = "Version >= " + pkg.minNativeVersion + " of pg-native required.";
    assert(semver.gte(Native.version, pkg.minNativeVersion), msg);
    var NativeQuery = require_query2();
    var Client = module.exports = function(config2) {
      EventEmitter.call(this);
      config2 = config2 || {};
      this._Promise = config2.Promise || global.Promise;
      this._types = new TypeOverrides(config2.types);
      this.native = new Native({
        types: this._types
      });
      this._queryQueue = [];
      this._ending = false;
      this._connecting = false;
      this._connected = false;
      this._queryable = true;
      var cp = this.connectionParameters = new ConnectionParameters(config2);
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
    Client.Query = NativeQuery;
    util.inherits(Client, EventEmitter);
    Client.prototype._errorAllQueries = function(err) {
      const enqueueError = (query2) => {
        process.nextTick(() => {
          query2.native = this.native;
          query2.handleError(err);
        });
      };
      if (this._hasActiveQuery()) {
        enqueueError(this._activeQuery);
        this._activeQuery = null;
      }
      this._queryQueue.forEach(enqueueError);
      this._queryQueue.length = 0;
    };
    Client.prototype._connect = function(cb) {
      var self = this;
      if (this._connecting) {
        process.nextTick(() => cb(new Error("Client has already been connected. You cannot reuse a client.")));
        return;
      }
      this._connecting = true;
      this.connectionParameters.getLibpqConnectionString(function(err, conString) {
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
          self.native.on("notification", function(msg2) {
            self.emit("notification", {
              channel: msg2.relname,
              payload: msg2.extra
            });
          });
          self.emit("connect");
          self._pulseQueryQueue(true);
          cb();
        });
      });
    };
    Client.prototype.connect = function(callback) {
      if (callback) {
        this._connect(callback);
        return;
      }
      return new this._Promise((resolve, reject) => {
        this._connect((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    };
    Client.prototype.query = function(config2, values, callback) {
      var query2;
      var result;
      var readTimeout;
      var readTimeoutTimer;
      var queryCallback;
      if (config2 === null || config2 === void 0) {
        throw new TypeError("Client was passed a null or undefined query");
      } else if (typeof config2.submit === "function") {
        readTimeout = config2.query_timeout || this.connectionParameters.query_timeout;
        result = query2 = config2;
        if (typeof values === "function") {
          config2.callback = values;
        }
      } else {
        readTimeout = this.connectionParameters.query_timeout;
        query2 = new NativeQuery(config2, values, callback);
        if (!query2.callback) {
          let resolveOut, rejectOut;
          result = new this._Promise((resolve, reject) => {
            resolveOut = resolve;
            rejectOut = reject;
          });
          query2.callback = (err, res) => err ? rejectOut(err) : resolveOut(res);
        }
      }
      if (readTimeout) {
        queryCallback = query2.callback;
        readTimeoutTimer = setTimeout(() => {
          var error = new Error("Query read timeout");
          process.nextTick(() => {
            query2.handleError(error, this.connection);
          });
          queryCallback(error);
          query2.callback = () => {
          };
          var index = this._queryQueue.indexOf(query2);
          if (index > -1) {
            this._queryQueue.splice(index, 1);
          }
          this._pulseQueryQueue();
        }, readTimeout);
        query2.callback = (err, res) => {
          clearTimeout(readTimeoutTimer);
          queryCallback(err, res);
        };
      }
      if (!this._queryable) {
        query2.native = this.native;
        process.nextTick(() => {
          query2.handleError(new Error("Client has encountered a connection error and is not queryable"));
        });
        return result;
      }
      if (this._ending) {
        query2.native = this.native;
        process.nextTick(() => {
          query2.handleError(new Error("Client was closed and is not queryable"));
        });
        return result;
      }
      this._queryQueue.push(query2);
      this._pulseQueryQueue();
      return result;
    };
    Client.prototype.end = function(cb) {
      var self = this;
      this._ending = true;
      if (!this._connected) {
        this.once("connect", this.end.bind(this, cb));
      }
      var result;
      if (!cb) {
        result = new this._Promise(function(resolve, reject) {
          cb = (err) => err ? reject(err) : resolve();
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
    Client.prototype._hasActiveQuery = function() {
      return this._activeQuery && this._activeQuery.state !== "error" && this._activeQuery.state !== "end";
    };
    Client.prototype._pulseQueryQueue = function(initialConnection) {
      if (!this._connected) {
        return;
      }
      if (this._hasActiveQuery()) {
        return;
      }
      var query2 = this._queryQueue.shift();
      if (!query2) {
        if (!initialConnection) {
          this.emit("drain");
        }
        return;
      }
      this._activeQuery = query2;
      query2.submit(this);
      var self = this;
      query2.once("_done", function() {
        self._pulseQueryQueue();
      });
    };
    Client.prototype.cancel = function(query2) {
      if (this._activeQuery === query2) {
        this.native.cancel(function() {
        });
      } else if (this._queryQueue.indexOf(query2) !== -1) {
        this._queryQueue.splice(this._queryQueue.indexOf(query2), 1);
      }
    };
    Client.prototype.setTypeParser = function(oid, format, parseFn) {
      return this._types.setTypeParser(oid, format, parseFn);
    };
    Client.prototype.getTypeParser = function(oid, format) {
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
var require_lib2 = __commonJS({
  "node_modules/pg/lib/index.js"(exports, module) {
    "use strict";
    var Client = require_client();
    var defaults = require_defaults();
    var Connection = require_connection();
    var Pool = require_pg_pool();
    var poolFactory = (Client2) => {
      return class BoundPool extends Pool {
        constructor(options) {
          super(options, Client2);
        }
      };
    };
    var PG = function(clientConstructor) {
      this.defaults = defaults;
      this.Client = clientConstructor;
      this.Query = this.Client.Query;
      this.Pool = poolFactory(this.Client);
      this._pools = [];
      this.Connection = Connection;
      this.types = require_pg_types();
    };
    if (typeof process.env.NODE_PG_FORCE_NATIVE !== "undefined") {
      module.exports = new PG(require_native());
    } else {
      module.exports = new PG(Client);
      Object.defineProperty(module.exports, "native", {
        configurable: true,
        enumerable: false,
        get() {
          var native = null;
          try {
            native = new PG(require_native());
          } catch (err) {
            if (err.code !== "MODULE_NOT_FOUND") {
              throw err;
            }
            console.error(err.message);
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

// src/server/main.ts
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// src/server/auth.ts
import { randomBytes as randomBytes2 } from "node:crypto";

// src/server/http.ts
var JSON_LIMIT = 65536;
var UPLOAD_LIMIT = 25e6;
var MULTIPART_OVERHEAD = 1048576;
var ApiError = class extends Error {
  constructor(status, code, message2, extra = {}) {
    super(message2);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
};
var notFound = () => new ApiError(404, "not_found", "Nothing was found at that address.");
var forbidden = () => new ApiError(403, "forbidden", "Your role can't do that.");
var takenDown = () => new ApiError(410, "taken_down", "This essay was removed after a legal takedown.");
var databaseUnavailable = () => new ApiError(
  503,
  "database_unavailable",
  "Saltprint Desk can't reach its records right now. Nothing was saved; try again shortly."
);
function validationFailed(fields) {
  return new ApiError(422, "validation_failed", "Some fields need attention.", { fields });
}
function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(payload);
}
var errorBody = (error) => ({ error: { code: error.code, message: error.message, ...error.extra } });
function sendError(res, error) {
  sendJson(res, error.status, errorBody(error));
}
function sendNoContent(res, headers = {}) {
  res.writeHead(204, { "Cache-Control": "no-store", ...headers });
  res.end();
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overLimit = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        overLimit = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ bytes: overLimit ? Buffer.alloc(0) : Buffer.concat(chunks), overLimit }));
    req.on("error", reject);
  });
}
var multipartLimit = UPLOAD_LIMIT + MULTIPART_OVERHEAD;
var UNPARSEABLE = Symbol("unparseable");
function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return UNPARSEABLE;
  }
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}
function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = m?.[1] ?? m?.[2];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const parts2 = [];
  let at = body.indexOf(delimiter);
  if (at < 0) return null;
  while (true) {
    at += delimiter.length;
    if (body.subarray(at, at + 2).toString() === "--") break;
    at += 2;
    const headerEnd = body.indexOf("\r\n\r\n", at);
    if (headerEnd < 0) return null;
    const headers = body.subarray(at, headerEnd).toString("utf8");
    const next = body.indexOf(Buffer.from(`\r
--${boundary}`), headerEnd + 4);
    if (next < 0) return null;
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1] ?? "";
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    parts2.push({ name, filename, data: body.subarray(headerEnd + 4, next) });
    at = next + 2;
  }
  return parts2;
}

// src/server/db.ts
var import_pg = __toESM(require_lib2(), 1);

// src/server/config.ts
function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}
var config = {
  port: Number(env("APP_PUBLIC_PORT", "4173")) || 4173,
  clockControl: env("APP_CLOCK_CONTROL") === "on",
  databaseUrl: env("DATABASE_URL"),
  s3: {
    endpoint: env("S3_ENDPOINT").replace(/\/+$/, ""),
    region: env("S3_REGION"),
    bucket: env("S3_BUCKET"),
    forcePathStyle: env("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: env("S3_ACCESS_KEY_ID"),
    secretAccessKey: env("S3_SECRET_ACCESS_KEY")
  },
  killbill: {
    url: env("KILLBILL_URL").replace(/\/+$/, ""),
    username: env("KILLBILL_USERNAME"),
    password: env("KILLBILL_PASSWORD"),
    apiKey: env("KILLBILL_API_KEY"),
    apiSecret: env("KILLBILL_API_SECRET")
  },
  smtp: {
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT")),
    from: env("MAIL_FROM")
  }
};

// src/shared/coop-time.ts
var COOP_ZONE = "America/Chicago";
var MINUTE = 6e4;
var DAY = 864e5;
var parts = new Intl.DateTimeFormat("en-US", {
  timeZone: COOP_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  timeZoneName: "short"
});
var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function wallOf(at) {
  const found = {};
  for (const p of parts.formatToParts(at)) found[p.type] = p.value;
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour),
    minute: Number(found.minute),
    weekday: found.weekday ?? "",
    zone: found.timeZoneName ?? ""
  };
}
var pad = (n, width = 2) => String(n).padStart(width, "0");
function isoInstant(at) {
  return `${at.toISOString().slice(0, 19)}Z`;
}
function coopTime(at) {
  const w = wallOf(typeof at === "string" ? new Date(at) : at);
  return `${w.weekday} ${w.day} ${MONTHS_SHORT[w.month - 1]} ${w.year} \xB7 ${pad(w.hour)}:${pad(w.minute)} ${w.zone}`;
}
function coopCsvTime(at) {
  const w = wallOf(typeof at === "string" ? new Date(at) : at);
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)} ${w.zone}`;
}
function coopDateOf(at) {
  const w = wallOf(at);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}
function addDays(day, days) {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}
function isCalendarDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}
function isCalendarMonth(text) {
  const m = /^(\d{4})-(\d{2})$/.exec(text);
  return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}
var sameWall = (w, y, mo, d, h, mi) => w.year === y && w.month === mo && w.day === d && w.hour === h && w.minute === mi;
function resolveWall(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!m || !isCalendarDate(`${m[1]}-${m[2]}-${m[3]}`)) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const candidates = [5, 6].map((hours) => new Date(naive + hours * 36e5)).filter((at) => sameWall(wallOf(at), y, mo, d, h, mi));
  if (candidates.length === 2) return { at: candidates[0], resolution: "first_occurrence" };
  if (candidates.length === 1) return { at: candidates[0], resolution: "exact" };
  let low = naive + 5 * 36e5;
  let high = naive + 6 * 36e5;
  const past = (t) => {
    const w = wallOf(new Date(t));
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) > naive;
  };
  while (high - low > MINUTE) {
    const mid = low + Math.floor((high - low) / 2 / MINUTE) * MINUTE;
    if (past(mid)) high = mid;
    else low = mid;
  }
  return { at: new Date(high), resolution: "shifted_after_gap" };
}
function coopMidnight(day) {
  const resolved = resolveWall(`${day}T00:00`);
  if (!resolved) throw new RangeError(`not a calendar date: ${day}`);
  return resolved.at;
}
function monthBounds(month) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  return { start: coopMidnight(`${month}-01`), end: coopMidnight(`${next}-01`) };
}
function windowEnd(confirmedAt, liftAt, days) {
  const from = confirmedAt > liftAt ? confirmedAt : liftAt;
  return coopMidnight(addDays(coopDateOf(from), days));
}
var HOLD_MS = 30 * MINUTE;
function holdDeadline(confirmedAt, end) {
  const hold = new Date(confirmedAt.getTime() + HOLD_MS);
  return hold < end ? hold : end;
}

// src/server/passwords.ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => error ? reject(error) : resolve(key));
  });
}
async function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}
async function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await derive(password, Buffer.from(salt, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// src/server/schema.ts
var DDL = `
CREATE TABLE IF NOT EXISTS newsrooms (
  slug text PRIMARY KEY, name text NOT NULL, home_zone text NOT NULL);
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('contributor','picture_editor','licensing_manager','desk_editor','treasurer')),
  newsroom text REFERENCES newsrooms(slug), handle text UNIQUE, payout_account text, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_clock (id int PRIMARY KEY CHECK (id = 1), offset_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS essays (
  id text PRIMARY KEY, version int NOT NULL, title text NOT NULL, caption text NOT NULL,
  lift_local text NOT NULL, lift_at timestamptz NOT NULL, lift_resolution text NOT NULL,
  exclusive_days int NOT NULL, standard_days int NOT NULL,
  exclusive_price_minor int NOT NULL, standard_price_minor int NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','in_review','embargoed','live','withdrawn','taken_down')),
  withdrawal_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL, submitted_at timestamptz, takedown_reference text,
  frame_seq int NOT NULL DEFAULT 0, storage_purge_pending boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS credits (
  essay_id text NOT NULL REFERENCES essays(id), position int NOT NULL, handle text NOT NULL REFERENCES people(handle),
  split_bp int NOT NULL CHECK (split_bp BETWEEN 1 AND 10000), PRIMARY KEY (essay_id, position), UNIQUE (essay_id, handle));
CREATE TABLE IF NOT EXISTS frames (
  id text PRIMARY KEY, essay_id text NOT NULL REFERENCES essays(id), position int NOT NULL, caption text NOT NULL,
  filename text NOT NULL, bytes int NOT NULL, type text NOT NULL, width int NOT NULL, height int NOT NULL,
  UNIQUE (essay_id, position) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE IF NOT EXISTS desk_notes (
  id bigserial PRIMARY KEY, essay_id text NOT NULL REFERENCES essays(id), note text NOT NULL, at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS follows (
  id text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id), essay_id text REFERENCES essays(id),
  contributor text REFERENCES people(handle), created_at timestamptz NOT NULL,
  CHECK ((essay_id IS NULL) <> (contributor IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS follows_one_essay ON follows(person_id, essay_id) WHERE essay_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS follows_one_contributor ON follows(person_id, contributor) WHERE contributor IS NOT NULL;
CREATE TABLE IF NOT EXISTS shortlist_items (
  id text PRIMARY KEY, newsroom text NOT NULL REFERENCES newsrooms(slug), frame_id text NOT NULL REFERENCES frames(id),
  added_by text NOT NULL REFERENCES people(id), added_at timestamptz NOT NULL, UNIQUE (newsroom, frame_id));
CREATE TABLE IF NOT EXISTS commission_rates (effective_from date PRIMARY KEY, rate_bp int NOT NULL);
CREATE TABLE IF NOT EXISTS licences (
  id text PRIMARY KEY, essay_id text NOT NULL REFERENCES essays(id), newsroom text NOT NULL REFERENCES newsrooms(slug),
  licensed_by text NOT NULL REFERENCES people(id), kind text NOT NULL CHECK (kind IN ('exclusive','standard')),
  status text NOT NULL CHECK (status IN ('pending','active','expired','removed','revoked')),
  confirmed_at timestamptz NOT NULL, window_end timestamptz NOT NULL, hold_until timestamptz NOT NULL,
  amount_minor int NOT NULL, rate_bp int NOT NULL, invoice_raised boolean NOT NULL DEFAULT false,
  attempts int NOT NULL DEFAULT 0, attempt_started_at timestamptz, warning_queued boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX IF NOT EXISTS licences_one_exclusive_per_essay
  ON licences(essay_id) WHERE kind = 'exclusive' AND status IN ('pending','active');
CREATE UNIQUE INDEX IF NOT EXISTS licences_one_per_newsroom_per_essay
  ON licences(essay_id, newsroom) WHERE status IN ('pending','active');
CREATE TABLE IF NOT EXISTS idempotency_keys (
  person_id text NOT NULL REFERENCES people(id), key text NOT NULL, essay_id text NOT NULL, kind text NOT NULL,
  status int, body jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (person_id, key));
CREATE TABLE IF NOT EXISTS statements (month text PRIMARY KEY, body jsonb NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS payouts (
  month text NOT NULL REFERENCES statements(month), handle text NOT NULL, amount_minor int NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','recorded')), PRIMARY KEY (month, handle));
CREATE TABLE IF NOT EXISTS mail_queue (
  id bigserial PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('alert','receipt','warning','takedown')),
  essay_id text, licence_id text, recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sent','cancelled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), sent_at timestamptz);
CREATE INDEX IF NOT EXISTS mail_queue_queued ON mail_queue(id) WHERE state = 'queued';
`;
var SEED_PASSWORD = "darkroom-proof-26";
var START_CLOCK = Date.parse("2026-10-28T12:00:00Z");
var NEWSROOMS = [
  ["harbor-light", "Harbor Light Herald", "America/New_York"],
  ["mesa-sentinel", "Mesa Daily Sentinel", "America/Phoenix"],
  ["thames-post", "Thames Evening Post", "Europe/London"]
];
var PEOPLE = [
  ["ines", "Ines Okafor-Lund", "ines@saltprint.example", "desk_editor", null, null, null],
  ["bram", "Bram Kettleworth", "bram@saltprint.example", "treasurer", null, null, null],
  [
    "ada",
    "Ada Reyes",
    "ada@contributors.saltprint.example",
    "contributor",
    null,
    "ada-reyes",
    "Ozark Teachers Credit Union \u2022\u20224417"
  ],
  [
    "tomas",
    "Tomas Whitcombe",
    "tomas@contributors.saltprint.example",
    "contributor",
    null,
    "tomas-whitcombe",
    "Prairie Mutual Savings \u2022\u20220932"
  ],
  [
    "noor",
    "Noor Haddad",
    "noor@contributors.saltprint.example",
    "contributor",
    null,
    "noor-haddad",
    "Gulfside Community Bank \u2022\u20222268"
  ],
  ["priya", "Priya Lowell", "priya@harbor-light.example", "picture_editor", "harbor-light", null, null],
  ["dev", "Dev Marsh", "dev@harbor-light.example", "picture_editor", "harbor-light", null, null],
  ["june", "June Castellanos", "june@harbor-light.example", "licensing_manager", "harbor-light", null, null],
  ["wes", "Wes Tallbridge", "wes@mesa-sentinel.example", "picture_editor", "mesa-sentinel", null, null],
  ["carmen", "Carmen Oduya", "carmen@mesa-sentinel.example", "licensing_manager", "mesa-sentinel", null, null],
  ["hollis", "Hollis Brandt", "hollis@thames-post.example", "picture_editor", "thames-post", null, null],
  ["margot", "Margot Fenwick", "margot@thames-post.example", "licensing_manager", "thames-post", null, null]
];
var SEED_ESSAYS = [
  {
    id: "floodplain-ledger",
    title: "Floodplain Ledger",
    caption: "Six months on the levee road after the spring crest.",
    credits: [["ada-reyes", 6e3], ["noor-haddad", 4e3]],
    state: "live",
    liftLocal: "2026-10-20T09:00",
    exclusive: [3, 45e3],
    standard: [7, 12e3],
    frames: 6
  },
  {
    id: "night-shift-grain",
    title: "Night Shift at the Grain Elevator",
    caption: "Harvest crews working the overnight load-out.",
    credits: [["tomas-whitcombe", 1e4]],
    state: "embargoed",
    liftLocal: "2026-11-01T01:30",
    exclusive: [2, 3e4],
    standard: [5, 9e3],
    frames: 4
  },
  {
    id: "salt-marsh-census",
    title: "Salt Marsh Census",
    caption: "Volunteers counting nesting rails at dawn.",
    credits: [["ada-reyes", 5e3], ["tomas-whitcombe", 3333], ["noor-haddad", 1667]],
    state: "live",
    liftLocal: "2026-10-12T07:00",
    exclusive: [1, 25e3],
    standard: [3, 8e3],
    frames: 5
  },
  {
    id: "border-choir",
    title: "Border Choir",
    caption: "A church choir that rehearses on both banks.",
    credits: [["noor-haddad", 1e4]],
    state: "in_review",
    liftLocal: "2026-11-05T07:00",
    exclusive: [2, 2e4],
    standard: [7, 6e3],
    frames: 3
  },
  {
    id: "river-series-draft",
    title: "Untitled river series",
    caption: "",
    credits: [["ada-reyes", 1e4]],
    state: "draft",
    liftLocal: "2026-11-20T08:00",
    exclusive: [3, 15e3],
    standard: [7, 5e3],
    frames: 2
  }
];
var SEED_FRAME_SIZE = { width: 1600, height: 1200 };
async function applySchema(client) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(417301)");
    await client.query(DDL);
    const seeded = await client.query("SELECT 1 FROM people LIMIT 1");
    if (seeded.rowCount === 0) await seed(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    throw error;
  }
}
async function seed(client) {
  await client.query(
    "INSERT INTO app_clock (id, offset_ms) VALUES (1, $1::bigint - (extract(epoch FROM clock_timestamp()) * 1000)::bigint)",
    [START_CLOCK]
  );
  for (const [slug, name, zone] of NEWSROOMS) {
    await client.query("INSERT INTO newsrooms (slug, name, home_zone) VALUES ($1, $2, $3)", [slug, name, zone]);
  }
  for (const [id, name, email, role, newsroom, handle, payout] of PEOPLE) {
    await client.query(
      `INSERT INTO people (id, name, email, role, newsroom, handle, payout_account, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, email, role, newsroom, handle, payout, await hashPassword(SEED_PASSWORD)]
    );
  }
  await client.query("INSERT INTO commission_rates (effective_from, rate_bp) VALUES ('2026-01-01', 3000)");
  const created = /* @__PURE__ */ new Date("2026-10-01T15:00:00Z");
  for (const essay of SEED_ESSAYS) {
    const lift = resolveWall(essay.liftLocal);
    if (!lift) throw new Error(`seed lift ${essay.liftLocal} does not resolve`);
    await client.query(
      `INSERT INTO essays (id, version, title, caption, lift_local, lift_at, lift_resolution, exclusive_days,
         standard_days, exclusive_price_minor, standard_price_minor, state, created_at, submitted_at, frame_seq)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        essay.id,
        essay.title,
        essay.caption,
        essay.liftLocal,
        lift.at,
        lift.resolution,
        essay.exclusive[0],
        essay.standard[0],
        essay.exclusive[1],
        essay.standard[1],
        essay.state,
        created,
        essay.state === "draft" ? null : created,
        essay.frames
      ]
    );
    for (const [index, [handle, split]] of essay.credits.entries()) {
      await client.query(
        "INSERT INTO credits (essay_id, position, handle, split_bp) VALUES ($1, $2, $3, $4)",
        [essay.id, index + 1, handle, split]
      );
    }
    for (let n = 1; n <= essay.frames; n += 1) {
      await client.query(
        `INSERT INTO frames (id, essay_id, position, caption, filename, bytes, type, width, height)
         VALUES ($1, $2, $3, $4, $5, 0, 'image/jpeg', $6, $7)`,
        [
          `${essay.id}-f${n}`,
          essay.id,
          n,
          `${essay.title}, frame ${n}`,
          `${essay.id}-f${n}.jpg`,
          SEED_FRAME_SIZE.width,
          SEED_FRAME_SIZE.height
        ]
      );
    }
  }
  await client.query(
    "INSERT INTO desk_notes (essay_id, note, at) VALUES ('floodplain-ledger', $1, $2)",
    ["Family on frame 4 gave consent by phone; keep this off newsroom copy.", /* @__PURE__ */ new Date("2026-10-19T16:20:00Z")]
  );
}

// src/server/db.ts
import_pg.default.types.setTypeParser(20, (value) => Number(value));
var pool = new import_pg.default.Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 3e3,
  idleTimeoutMillis: 1e4,
  max: 24
});
pool.on("error", () => void 0);
pool.on("connect", (client) => client.on("error", () => void 0));
function isUnreachable(error) {
  const code = error.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code.startsWith("08") || code.startsWith("57P");
  return true;
}
function translate(error) {
  if (error instanceof ApiError) return error;
  return isUnreachable(error) ? databaseUnavailable() : error;
}
var schemaApplied = false;
var applying = null;
async function ensureSchema() {
  if (schemaApplied) return;
  applying ??= (async () => {
    const client = await pool.connect();
    try {
      await applySchema(client);
      schemaApplied = true;
    } catch (error) {
      client.release(true);
      throw error;
    }
    client.release();
  })().finally(() => {
    applying = null;
  });
  try {
    await applying;
  } catch (error) {
    throw translate(error);
  }
}
async function query(sql, params = [], runner = pool) {
  await ensureSchema();
  try {
    const result = await runner.query(sql, params);
    return result.rows;
  } catch (error) {
    throw translate(error);
  }
}
async function one(sql, params = [], runner = pool) {
  return (await query(sql, params, runner))[0];
}
async function transaction(work) {
  await ensureSchema();
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw translate(error);
  }
  let broken = false;
  try {
    await query("BEGIN", [], client);
    const result = await work(client);
    await query("COMMIT", [], client);
    return result;
  } catch (error) {
    broken = error instanceof ApiError && error.code === "database_unavailable";
    await client.query("ROLLBACK").catch(() => void 0);
    throw error;
  } finally {
    client.release(broken);
  }
}
var isUniqueViolation = (error) => error.code === "23505";

// src/server/auth.ts
var SESSION_COOKIE = "saltprint_session";
var PERSON_SQL = `SELECT p.id, p.name, p.email, p.role, p.handle, p.password_hash,
  n.slug, n.name AS newsroom_name, n.home_zone
  FROM people p LEFT JOIN newsrooms n ON n.slug = p.newsroom`;
function toPerson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    handle: row.handle,
    newsroom: row.slug ? { slug: row.slug, name: row.newsroom_name ?? "", home_zone: row.home_zone ?? "" } : null
  };
}
function userBody(person) {
  return {
    user: {
      id: person.id,
      name: person.name,
      email: person.email,
      role: person.role,
      newsroom: person.newsroom,
      contributor_handle: person.handle
    }
  };
}
async function signIn(email, password) {
  const row = await one(`${PERSON_SQL} WHERE lower(p.email) = lower($1)`, [email]);
  if (!row || !await passwordMatches(password, row.password_hash)) {
    throw new ApiError(401, "invalid_credentials", "That email and password don't match a Saltprint account.");
  }
  const token = randomBytes2(32).toString("base64url");
  await query("INSERT INTO sessions (token, person_id) VALUES ($1, $2)", [token, row.id]);
  return { person: toPerson(row), token };
}
async function signOut(req) {
  const token = cookies(req)[SESSION_COOKIE];
  if (token) await query("DELETE FROM sessions WHERE token = $1", [token]);
}
async function personFromRequest(req) {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = await one(`${PERSON_SQL} JOIN sessions s ON s.person_id = p.id WHERE s.token = $1`, [token]);
  return row ? toPerson(row) : null;
}
function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}
var clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
function requireRole(person, ...roles) {
  if (!roles.includes(person.role)) throw forbidden();
}
var isNewsroomRole = (person) => person.role === "picture_editor" || person.role === "licensing_manager";
function newsroomOf(person) {
  if (!person.newsroom) throw forbidden();
  return person.newsroom;
}

// src/server/clock.ts
var NOW_SQL = "SELECT ((extract(epoch FROM clock_timestamp()) * 1000)::bigint + offset_ms) AS now FROM app_clock WHERE id = 1";
async function serverNow(client) {
  const row = await one(NOW_SQL, [], client);
  const ms = row?.now ?? Date.now();
  return new Date(Math.floor(ms / 1e3) * 1e3);
}
async function setServerNow(target2) {
  await query(
    "UPDATE app_clock SET offset_ms = $1::bigint - (extract(epoch FROM clock_timestamp()) * 1000)::bigint WHERE id = 1",
    [target2.getTime()]
  );
}
function clockBody(now) {
  return { now: isoInstant(now), now_display: coopTime(now), zone: COOP_ZONE };
}

// src/server/router.ts
var routes = [];
var patternOf = (path) => new RegExp(`^${path.replace(/:[a-z_]+/g, "([^/]+)")}$`);
function on(method, path, body, handle) {
  routes.push({ method, pattern: patternOf(path), body, auth: true, handle });
}
function onPublic(method, path, body, handle) {
  routes.push({ method, pattern: patternOf(path), body, auth: false, handle });
}
function match(method, path) {
  let pathMatched = false;
  for (const route of routes) {
    const m = route.pattern.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (route.method === method) return { route, params: m.slice(1).map((p) => decodeURIComponent(p)) };
  }
  return pathMatched ? "method" : null;
}

// src/server/strict-body.ts
var WRONG_TYPE = "This field is missing or has the wrong type";
var matches = (kind, value) => {
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "value":
      return true;
  }
};
var FieldErrors = class {
  fields = {};
  add(field, message2) {
    if (!(field in this.fields)) this.fields[field] = message2;
  }
  has(field) {
    return field in this.fields;
  }
  fail() {
    if (Object.keys(this.fields).length) throw validationFailed(this.fields);
  }
};
function strictBody(body, rules, partial = false) {
  if (body === UNPARSEABLE || typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validationFailed({ body: "Send a JSON object" });
  }
  const errors = new FieldErrors();
  const values = {};
  const given = body;
  for (const key of Object.keys(given)) {
    if (!(key in rules)) errors.add(key, "Unknown field");
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (!(key in given)) {
      if (!partial && !rule.optional) errors.add(key, rule.message);
      continue;
    }
    const value = given[key];
    if (value === null || !matches(rule.kind, value)) errors.add(key, rule.message);
    else values[key] = value;
  }
  return { values, errors };
}
function emptyBody(body) {
  strictBody(body, {}).errors.fail();
}

// src/server/licence-state.ts
var ATTEMPT_WINDOW_MS = 1e4;
var attemptInFlight = (row) => row.attempt_started_at !== null && Date.now() - row.attempt_started_at.getTime() < ATTEMPT_WINDOW_MS;
function licenceState(row, now) {
  switch (row.status) {
    case "revoked":
      return "revoked";
    case "removed":
      return null;
    case "pending":
      return now < row.hold_until || attemptInFlight(row) ? "pending_invoice" : null;
    case "active":
    case "expired":
      return now < row.window_end ? "active" : "expired";
  }
}
var effectiveEnd = (row) => row.status === "pending" ? row.hold_until : row.window_end;
var holdsWindow = (state) => state === "pending_invoice" || state === "active";
var isStanding = (row, now) => holdsWindow(licenceState(row, now));

// src/server/lifecycle.ts
var ALLOWED_FROM = {
  edit: ["draft"],
  submit: ["draft"],
  publish: ["in_review"],
  hold: ["in_review"],
  lift: ["embargoed"],
  request_withdrawal: ["embargoed", "live"],
  withdraw: ["embargoed", "live"],
  takedown: ["embargoed", "live", "withdrawn"]
};
function assertTransition(state, action) {
  if (!ALLOWED_FROM[action].includes(state)) {
    throw new ApiError(
      409,
      "illegal_transition",
      `An essay that is ${state.replace("_", " ")} can't take that action.`,
      { from: state, action }
    );
  }
}
var publishedState = (liftAt, now) => liftAt > now ? "embargoed" : "live";
var ON_SHEET = ["embargoed", "live"];
var isOnSheet = (state) => ON_SHEET.includes(state);

// src/server/essay-model.ts
async function loadEssay(id, client, lock = false) {
  return one(`SELECT * FROM essays WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id], client);
}
async function creditsOf(ids, client) {
  if (!ids.length) return [];
  return query(
    `SELECT c.essay_id, c.position, c.handle, p.name, c.split_bp FROM credits c JOIN people p ON p.handle = c.handle
     WHERE c.essay_id = ANY($1) ORDER BY c.essay_id, c.position`,
    [ids],
    client
  );
}
async function framesOf(ids, client) {
  if (!ids.length) return [];
  return query("SELECT * FROM frames WHERE essay_id = ANY($1) ORDER BY essay_id, position", [ids], client);
}
async function licencesOnEssays(ids, client) {
  if (!ids.length) return [];
  return query("SELECT * FROM licences WHERE essay_id = ANY($1) AND status <> 'removed'", [ids], client);
}
function creditLine(names) {
  const joined = names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Photographs by ${joined}`;
}
var isCredited = (person, credits) => person.handle !== null && credits.some((c) => c.handle === person.handle);
async function newsroomLicensed(newsroom, essayId2, client) {
  return await one(
    `SELECT 1 FROM licences WHERE essay_id = $1 AND newsroom = $2 AND status <> 'removed'`,
    [essayId2, newsroom],
    client
  ) !== void 0;
}
async function visibleEssay(person, id, client, lock = false) {
  const essay = await loadEssay(id, client, lock);
  if (!essay) throw notFound();
  if (person.role === "desk_editor") return essay;
  if (essay.state === "taken_down") throw takenDown();
  if (isOnSheet(essay.state)) return essay;
  if (person.role === "contributor") {
    if (isCredited(person, await creditsOf([essay.id], client))) return essay;
  } else if (essay.state === "withdrawn" && person.newsroom && await newsroomLicensed(person.newsroom.slug, essay.id, client)) {
    return essay;
  }
  throw notFound();
}
function windowBody(person, licences, now) {
  const standing = licences.filter((l) => isStanding(l, now));
  const exclusive = standing.find((l) => l.kind === "exclusive");
  const ownRoom = person.newsroom?.slug ?? null;
  const rivalsStandard = standing.filter((l) => l.kind === "standard" && l.newsroom !== ownRoom);
  const latest = rivalsStandard.map(effectiveEnd).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const heldUntil = exclusive ? effectiveEnd(exclusive) : null;
  return {
    state: exclusive ? "claimed" : "open",
    held_by: !exclusive ? null : exclusive.licensed_by === person.id ? "you" : exclusive.newsroom === ownRoom ? "your_newsroom" : "another_newsroom",
    held_until: heldUntil ? isoInstant(heldUntil) : null,
    held_until_display: heldUntil ? coopTime(heldUntil) : null,
    standard_running_until: latest ? isoInstant(latest) : null,
    standard_running_until_display: latest ? coopTime(latest) : null
  };
}
var mediaUrl = (frameId, variant) => `/media/frames/${encodeURIComponent(frameId)}/${variant}`;
async function essayBodies(person, essays, now, client) {
  const ids = essays.map((e) => e.id);
  const [credits, frames, licences] = await Promise.all([
    creditsOf(ids, client),
    framesOf(ids, client),
    licencesOnEssays(ids, client)
  ]);
  const notes = person.role === "contributor" || person.role === "desk_editor" || person.role === "treasurer" ? await query(
    "SELECT essay_id, note, at FROM desk_notes WHERE essay_id = ANY($1) ORDER BY at, id",
    [ids],
    client
  ) : [];
  return essays.map((essay) => {
    const own = credits.filter((c) => c.essay_id === essay.id);
    const full = !isNewsroomRole(person);
    const imagery = essay.state !== "taken_down";
    const body = {
      id: essay.id,
      version: essay.version,
      title: essay.title,
      caption: essay.caption,
      credit_line: creditLine(own.map((c) => c.name)),
      credits: own.map((c) => full ? { handle: c.handle, name: c.name, position: c.position, split_bp: c.split_bp } : { handle: c.handle, name: c.name, position: c.position }),
      state: essay.state,
      lift_local: essay.lift_local,
      lift_at: isoInstant(essay.lift_at),
      lift_display: coopTime(essay.lift_at),
      lift_resolution: essay.lift_resolution,
      exclusive_days: essay.exclusive_days,
      standard_days: essay.standard_days,
      exclusive_price_minor: essay.exclusive_price_minor,
      standard_price_minor: essay.standard_price_minor,
      frames: frames.filter((f) => f.essay_id === essay.id).map((f) => {
        const frame = {
          id: f.id,
          position: f.position,
          caption: f.caption,
          grid_url: imagery ? mediaUrl(f.id, "grid") : null
        };
        if (full) frame.story_url = imagery ? mediaUrl(f.id, "story") : null;
        frame.preview_url = imagery ? mediaUrl(f.id, "preview") : null;
        return frame;
      }),
      window: windowBody(person, licences.filter((l) => l.essay_id === essay.id), now)
    };
    if (full) {
      body.desk_notes = notes.filter((n) => n.essay_id === essay.id).map((n) => ({ note: n.note, at: isoInstant(n.at), at_display: coopTime(n.at) }));
      body.withdrawal_requested = essay.withdrawal_requested;
    }
    return body;
  });
}
async function essayBody(person, essay, now, client) {
  return (await essayBodies(person, [essay], now, client))[0];
}

// src/shared/money.ts
function centsToDecimal(cents) {
  const whole = Math.trunc(cents / 100);
  const rest = cents % 100;
  return `${whole}.${String(rest).padStart(2, "0")}`;
}
function dollars(cents) {
  return `$${centsToDecimal(cents).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

// src/server/killbill.ts
var { killbill } = config;
var TIMEOUT_MS = 5e3;
var BillingUnreachable = class extends Error {
};
var BillingRefused = class extends Error {
};
async function call(method, path, body) {
  let response;
  try {
    response = await fetch(`${killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${killbill.username}:${killbill.password}`).toString("base64")}`,
        "X-Killbill-ApiKey": killbill.apiKey,
        "X-Killbill-ApiSecret": killbill.apiSecret,
        "X-Killbill-CreatedBy": "saltprint-desk",
        Accept: "application/json",
        ...body !== void 0 ? { "Content-Type": "application/json" } : {}
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new BillingUnreachable("billing unreachable");
  }
  const text = await response.text().catch(() => "");
  if (response.status >= 500) throw new BillingUnreachable(`billing answered ${response.status}`);
  return { status: response.status, text, location: response.headers.get("location") };
}
function refuse(answer) {
  throw new BillingRefused(`billing refused with ${answer.status}`);
}
var json = (answer) => JSON.parse(answer.text);
async function accountByKey(externalKey) {
  const answer = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (answer.status === 404) return null;
  if (answer.status !== 200) refuse(answer);
  return json(answer);
}
async function ensureAccount(externalKey, name) {
  const found = await accountByKey(externalKey);
  if (found) return found;
  const created = await call("POST", "/accounts", JSON.stringify({ name, externalKey, currency: "USD" }));
  if (created.status !== 201 && created.status !== 409) refuse(created);
  const account = await accountByKey(externalKey);
  if (!account) throw new BillingUnreachable("account not visible yet");
  return account;
}
var newsroomAccount = (slug, name) => ensureAccount(`newsroom-${slug}`, name);
async function raiseCharge(account, description, amountCents, retry) {
  if (retry) {
    const invoices = await call("GET", `/accounts/${account.accountId}/invoices?includeInvoiceComponents=true`);
    if (invoices.status !== 200) refuse(invoices);
    const exists = json(invoices).some((inv) => (inv.items ?? []).some((i) => i.description === description));
    if (exists) return;
  }
  const body = `[{"accountId":${JSON.stringify(account.accountId)},"description":${JSON.stringify(description)},"amount":${centsToDecimal(amountCents)},"currency":"USD","itemType":"EXTERNAL_CHARGE"}]`;
  const charged = await call("POST", `/invoices/charges/${account.accountId}?autoCommit=true`, body);
  if (charged.status !== 201 && charged.status !== 200) refuse(charged);
}
async function recordPayout(handle, name, month, amountCents) {
  const key = `payout-${month}-${handle}`;
  const existing = await call("GET", `/payments?externalKey=${encodeURIComponent(key)}`);
  if (existing.status === 200) return;
  if (existing.status !== 404) refuse(existing);
  const account = await ensureAccount(`contributor-${handle}`, name);
  if (!account.paymentMethodId) {
    const method = await call(
      "POST",
      `/accounts/${account.accountId}/paymentMethods?isDefault=true`,
      JSON.stringify({ accountId: account.accountId, pluginName: "__EXTERNAL_PAYMENT__" })
    );
    if (method.status !== 201) refuse(method);
  }
  const body = `{"transactionType":"CREDIT","amount":${centsToDecimal(amountCents)},"currency":"USD","paymentExternalKey":${JSON.stringify(key)},"transactionExternalKey":${JSON.stringify(key)}}`;
  const paid = await call("POST", `/accounts/${account.accountId}/payments`, body);
  if (paid.status !== 201 && paid.status !== 200) refuse(paid);
}

// src/server/mail.ts
var SIGN_OFF = "\nSaltprint Desk\nSaltprint Picture Co-operative\n";
async function queue(client, draft) {
  for (const to of new Set(draft.to.map((t) => t.toLowerCase()))) {
    await query(
      `INSERT INTO mail_queue (kind, essay_id, licence_id, recipient, subject, body) VALUES ($1, $2, $3, $4, $5, $6)`,
      [draft.kind, draft.essayId, draft.licenceId, to, draft.subject, draft.body],
      client
    );
  }
}
async function licenceRecipients(client, licence) {
  const rows = await query(
    `SELECT email FROM people WHERE id = $1
     UNION SELECT email FROM people WHERE newsroom = $2 AND role = 'licensing_manager'`,
    [licence.licensed_by, licence.newsroom],
    client
  );
  return rows.map((r) => r.email);
}
async function queueReceipt(client, essay, licence) {
  await queue(client, {
    kind: "receipt",
    essayId: essay.id,
    licenceId: licence.id,
    to: await licenceRecipients(client, licence),
    subject: `Licence receipt: ${essay.title}`,
    body: [
      "Your newsroom's licence is active and invoiced.",
      "",
      `Essay: ${essay.title}`,
      `Credit: ${essay.creditLine}`,
      `Kind: ${licence.kind}`,
      `Window starts: ${coopTime(licence.confirmed_at)}`,
      `Window ends: ${coopTime(licence.window_end)}`,
      `Amount: ${dollars(licence.amount_minor)} USD`,
      `Licence: ${licence.id}`,
      "",
      "Originals can be downloaded from the Licences screen while the licence runs.",
      SIGN_OFF
    ].join("\n")
  });
}
async function queueExpiryWarning(client, essay, licence) {
  await queue(client, {
    kind: "warning",
    essayId: essay.id,
    licenceId: licence.id,
    to: await licenceRecipients(client, licence),
    subject: `Licence ending in 24 hours: ${essay.title}`,
    body: [
      `Your newsroom's ${licence.kind} licence ends in 24 hours.`,
      "",
      `Essay: ${essay.title}`,
      `Kind: ${licence.kind}`,
      `Ends: ${coopTime(licence.window_end)}`,
      `Licence: ${licence.id}`,
      "",
      "After the end, originals can no longer be downloaded.",
      SIGN_OFF
    ].join("\n")
  });
}
async function queueLiftAlert(client, essay, liftAt, to) {
  await queue(client, {
    kind: "alert",
    essayId: essay.id,
    licenceId: null,
    to,
    subject: `Embargo lifted: ${essay.title}`,
    body: [
      "An essay you follow is now live on the Saltprint contact sheet.",
      "",
      `Essay: ${essay.title}`,
      `Credit: ${essay.creditLine}`,
      `Lifted: ${coopTime(liftAt)}`,
      SIGN_OFF
    ].join("\n")
  });
}
async function queueTakedownNotice(client, essay, to, licenceIds) {
  await queue(client, {
    kind: "takedown",
    essayId: essay.id,
    licenceId: null,
    to: [to],
    subject: `Takedown notice: ${essay.title}`,
    body: [
      "Saltprint has taken this essay down after a legal request.",
      "",
      `Essay: ${essay.title}`,
      `Revoked licences: ${licenceIds.join(", ")}`,
      "",
      "Stop all use of this essay and delete stored copies.",
      SIGN_OFF
    ].join("\n")
  });
}
async function cancelEssayMail(client, essayId2, kinds) {
  await query(
    `UPDATE mail_queue SET state = 'cancelled' WHERE essay_id = $1 AND state = 'queued'${kinds ? " AND kind = ANY($2)" : ""}`,
    kinds ? [essayId2, kinds] : [essayId2],
    client
  );
}
function receiptState(states) {
  if (!states.length) return null;
  if (states.includes("queued")) return "queued";
  if (states.includes("cancelled")) return "cancelled";
  return "sent";
}

// src/server/s3.ts
import { createHash, createHmac } from "node:crypto";
var { s3 } = config;
var TIMEOUT_MS2 = 1e4;
var storageUnavailable = () => new ApiError(503, "storage_unavailable", "Image storage is unreachable. Try again shortly.");
var sha256 = (data) => createHash("sha256").update(data).digest("hex");
var hmac = (key, data) => createHmac("sha256", key).update(data).digest();
var encode = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
var encodePath = (key) => key.split("/").map(encode).join("/");
function target(key) {
  const url = new URL(s3.endpoint);
  if (s3.forcePathStyle) {
    return { host: url.host, origin: url.origin, path: `/${encode(s3.bucket)}/${encodePath(key)}` };
  }
  return { host: `${s3.bucket}.${url.host}`, origin: `${url.protocol}//${s3.bucket}.${url.host}`, path: `/${encodePath(key)}` };
}
function signingKey(day) {
  let key = hmac(`AWS4${s3.secretAccessKey}`, day);
  for (const part of [s3.region, "s3", "aws4_request"]) key = hmac(key, part);
  return key;
}
var amzDate = (at) => at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function canonicalQuery(params) {
  return Object.keys(params).sort().map((k) => `${encode(k)}=${encode(params[k] ?? "")}`).join("&");
}
async function request(method, key, body = Buffer.alloc(0), extra = {}) {
  const { host, path, origin } = target(key);
  const now = /* @__PURE__ */ new Date();
  const stamp = amzDate(now);
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp, ...extra };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v.trim();
  const canonical = [method, path, "", names.map((h) => `${h}:${lower[h]}
`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signature = hmac(signingKey(day), toSign).toString("hex");
  const sent = { ...headers };
  delete sent.host;
  sent.Authorization = `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: sent,
      body: method === "PUT" ? body : void 0,
      signal: AbortSignal.timeout(TIMEOUT_MS2)
    });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  } catch {
    throw storageUnavailable();
  }
}
function ensureOk(response, allowed = []) {
  if (response.status >= 500) throw storageUnavailable();
  if (response.status >= 300 && !allowed.includes(response.status)) {
    throw new Error(`storage answered ${response.status}`);
  }
}
async function putObject(key, body, contentType) {
  ensureOk(await request("PUT", key, body, { "content-type": contentType }));
}
async function getObject(key) {
  const response = await request("GET", key);
  ensureOk(response, [404]);
  return response.status === 404 ? null : response.body;
}
async function objectExists(key) {
  const response = await request("HEAD", key);
  ensureOk(response, [404]);
  return response.status !== 404;
}
async function deleteObject(key) {
  ensureOk(await request("DELETE", key), [404]);
}
async function moveObject(from, to) {
  const response = await request("PUT", to, Buffer.alloc(0), {
    "x-amz-copy-source": `/${encode(s3.bucket)}/${encodePath(from)}`
  });
  ensureOk(response, [404]);
  if (response.status !== 404) await deleteObject(from);
}
function presignGet(key, seconds, overrides) {
  const { host, path, origin } = target(key);
  const stamp = amzDate(/* @__PURE__ */ new Date());
  const day = stamp.slice(0, 8);
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${s3.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(seconds),
    "X-Amz-SignedHeaders": "host",
    ...overrides
  };
  const queryString = canonicalQuery(params);
  const canonical = ["GET", path, queryString, `host:${host}
`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signature = hmac(signingKey(day), toSign).toString("hex");
  return `${origin}${path}?${queryString}&X-Amz-Signature=${signature}`;
}
var keys = {
  original: (essayId2, frameId) => `originals/${essayId2}/${frameId}`,
  derivative: (essayId2, frameId, variant) => `derivatives/${essayId2}/${frameId}/${variant}.jpg`,
  grant: (licenceId2) => `grants/${licenceId2}.json`,
  legalHold: (essayId2, frameId) => `legal-hold/${essayId2}/${frameId}`
};
var VARIANTS = ["grid", "story", "preview"];

// src/server/activation.ts
async function attemptActivation(client, licence) {
  const room = await one("SELECT name FROM newsrooms WHERE slug = $1", [licence.newsroom], client);
  try {
    const account = await newsroomAccount(licence.newsroom, room?.name ?? licence.newsroom);
    await raiseCharge(
      account,
      `Saltprint licence ${licence.id} \xB7 ${licence.kind}`,
      licence.amount_minor,
      licence.attempts > 1
    );
  } catch (error) {
    if (error instanceof BillingRefused) return "refused";
    if (error instanceof BillingUnreachable) return "pending";
    throw error;
  }
  const frames = await query(
    "SELECT id FROM frames WHERE essay_id = $1 ORDER BY position",
    [licence.essay_id],
    client
  );
  try {
    await putObject(keys.grant(licence.id), Buffer.from(JSON.stringify({
      licence_id: licence.id,
      newsroom: licence.newsroom,
      essay_id: licence.essay_id,
      frame_ids: frames.map((f) => f.id),
      window_end: isoInstant(licence.window_end)
    })), "application/json");
  } catch (error) {
    if (error instanceof ApiError) return "pending";
    throw error;
  }
  await query(
    "UPDATE licences SET status = 'active', invoice_raised = true, attempt_started_at = NULL WHERE id = $1",
    [licence.id],
    client
  );
  const essay = await one("SELECT title FROM essays WHERE id = $1", [licence.essay_id], client);
  const names = (await creditsOf([licence.essay_id], client)).map((c) => c.name);
  await queueReceipt(
    client,
    { id: licence.essay_id, title: essay?.title ?? "", creditLine: creditLine(names) },
    { ...licence, status: "active" }
  );
  return "active";
}
var RELEASE_CLAIM = "UPDATE licences SET attempt_started_at = NULL WHERE id = $1";
async function retryActivation(licenceId2) {
  const now = await serverNow();
  const claimed = await one(
    `UPDATE licences SET attempt_started_at = clock_timestamp(), attempts = attempts + 1
     WHERE id = $1 AND status = 'pending' AND hold_until > $2
       AND (attempt_started_at IS NULL OR attempt_started_at < clock_timestamp() - make_interval(secs => $3))
     RETURNING id`,
    [licenceId2, now, ATTEMPT_WINDOW_MS / 1e3]
  );
  if (!claimed) return true;
  let settled = false;
  try {
    settled = await transaction(async (client) => {
      const licence = await one("SELECT * FROM licences WHERE id = $1 FOR UPDATE", [licenceId2], client);
      if (!licence || licence.status !== "pending") return true;
      const attempt = await attemptActivation(client, licence);
      if (attempt === "refused") {
        await query("UPDATE licences SET status = 'removed', attempt_started_at = NULL WHERE id = $1", [licenceId2], client);
      }
      return attempt !== "pending";
    });
  } finally {
    if (!settled) await query(RELEASE_CLAIM, [licenceId2]).catch(() => void 0);
  }
  return settled;
}
async function retryActivations() {
  const now = await serverNow();
  await query(
    `UPDATE licences SET status = 'removed'
    WHERE status = 'pending' AND hold_until <= $1
      AND (attempt_started_at IS NULL OR attempt_started_at < clock_timestamp() - make_interval(secs => $2))`,
    [now, ATTEMPT_WINDOW_MS / 1e3]
  );
  const due = await query(
    `SELECT id FROM licences WHERE status = 'pending' AND hold_until > $1
       AND (attempt_started_at IS NULL OR attempt_started_at < clock_timestamp() - make_interval(secs => $2))
     ORDER BY confirmed_at LIMIT 20`,
    [now, ATTEMPT_WINDOW_MS / 1e3]
  );
  for (const { id } of due) {
    if (!await retryActivation(id)) return "provider_down";
  }
  return "done";
}

// src/server/essays.ts
import { randomBytes as randomBytes3 } from "node:crypto";

// src/server/essay-fields.ts
var TITLE_LENGTH = "Title must be 1 to 120 characters";
var TITLE_CONTROL = "Title can't contain line breaks or control characters";
var CAPTION = "Caption must be at most 2000 characters";
var LIFT = "Enter the lift as a co-op date and time";
var EXCLUSIVE = "Exclusive window must be 1 to 14 days";
var STANDARD = "Standard licence must be 1 to 30 days";
var PRICE = "Price must be $1.00 to $100,000.00";
var CREDITS_COUNT = "Credits must list 1 to 6 contributors";
var CREDIT_ENTRY = "Each credit needs a contributor handle and an integer split_bp from 1 to 10000";
var CREDIT_KEYS = "Credits accept only contributor and split_bp";
var CREDIT_TWICE = "Each contributor may be credited once";
var CREDIT_SELF = "You must credit yourself";
var FRAME_CAPTION = "Caption must be at most 500 characters";
var RULES = {
  title: { kind: "string", message: TITLE_LENGTH },
  caption: { kind: "string", message: CAPTION },
  lift_local: { kind: "string", message: LIFT },
  exclusive_days: { kind: "integer", message: EXCLUSIVE },
  standard_days: { kind: "integer", message: STANDARD },
  exclusive_price_minor: { kind: "integer", message: PRICE },
  standard_price_minor: { kind: "integer", message: PRICE },
  credits: { kind: "value", message: CREDITS_COUNT }
};
var CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
var codePoints = (text) => [...text].length;
function checkTitle(raw) {
  if (CONTROL.test(raw)) return { error: TITLE_CONTROL };
  const title = raw.replace(/^ +| +$/g, "");
  const length2 = codePoints(title);
  return length2 >= 1 && length2 <= 120 ? { title } : { error: TITLE_LENGTH };
}
var inRange = (value, low, high) => value >= low && value <= high;
async function checkCredits(value, person) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return CREDITS_COUNT;
  const entries = value;
  const wellFormed = entries.every((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const { contributor, split_bp: split } = entry;
    return typeof contributor === "string" && typeof split === "number" && Number.isInteger(split) && inRange(split, 1, 1e4);
  });
  if (!wellFormed) return CREDIT_ENTRY;
  if (entries.some((entry) => Object.keys(entry).some((k) => k !== "contributor" && k !== "split_bp"))) {
    return CREDIT_KEYS;
  }
  const credits = entries.map((entry) => {
    const { contributor, split_bp: split } = entry;
    return { handle: contributor, split_bp: split };
  });
  const known = new Set((await query(
    "SELECT handle FROM people WHERE role = 'contributor' AND handle = ANY($1)",
    [credits.map((c) => c.handle)]
  )).map((r) => r.handle));
  const unknown = credits.find((c) => !known.has(c.handle));
  if (unknown) return `Unknown contributor ${unknown.handle}`;
  if (new Set(credits.map((c) => c.handle)).size !== credits.length) return CREDIT_TWICE;
  if (!credits.some((c) => c.handle === person.handle)) return CREDIT_SELF;
  const sum = credits.reduce((total, c) => total + c.split_bp, 0);
  if (sum !== 1e4) return `Shares must total 10000 basis points (now ${sum})`;
  return credits;
}
async function readEssayFields(body, person, partial) {
  const { values, errors } = strictBody(body, RULES, partial);
  const fields = {};
  if (typeof values.title === "string") {
    const checked = checkTitle(values.title);
    if ("error" in checked) errors.add("title", checked.error);
    else fields.title = checked.title;
  }
  if (typeof values.caption === "string") {
    if (codePoints(values.caption) <= 2e3) fields.caption = values.caption;
    else errors.add("caption", CAPTION);
  }
  if (typeof values.lift_local === "string") {
    const lift = resolveWall(values.lift_local);
    if (lift) {
      fields.lift_local = values.lift_local;
      fields.lift = lift;
    } else errors.add("lift_local", LIFT);
  }
  const ranged = [
    ["exclusive_days", 1, 14, EXCLUSIVE],
    ["standard_days", 1, 30, STANDARD],
    ["exclusive_price_minor", 100, 1e7, PRICE],
    ["standard_price_minor", 100, 1e7, PRICE]
  ];
  for (const [key, low, high, message2] of ranged) {
    const value = values[key];
    if (typeof value !== "number") continue;
    if (inRange(value, low, high)) fields[key] = value;
    else errors.add(key, message2);
  }
  if ("credits" in values) {
    const credits = await checkCredits(values.credits, person);
    if (typeof credits === "string") errors.add("credits", credits);
    else fields.credits = credits;
  }
  errors.fail();
  return fields;
}

// src/server/essays.ts
function newId(prefix) {
  return `${prefix}${randomBytes3(6).toString("hex")}`;
}
function essayId(title) {
  const slug = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `${slug || "essay"}-${randomBytes3(3).toString("hex")}`;
}
var etagOf = (version) => `"${version}"`;
async function creditedEssay(person, id, client) {
  const essay = await visibleEssay(person, id, client, true);
  if (person.role !== "contributor" || !isCredited(person, await creditsOf([essay.id], client))) throw forbidden();
  return essay;
}
async function bumpVersion(client, id, sets = "", params = []) {
  const rows = await query(
    `UPDATE essays SET version = version + 1${sets ? `, ${sets}` : ""} WHERE id = $1 RETURNING version`,
    [id, ...params],
    client
  );
  return rows[0]?.version ?? 0;
}
async function writeCredits(client, id, credits) {
  await query("DELETE FROM credits WHERE essay_id = $1", [id], client);
  for (const [index, credit] of credits.entries()) {
    await query(
      "INSERT INTO credits (essay_id, position, handle, split_bp) VALUES ($1, $2, $3, $4)",
      [id, index + 1, credit.handle, credit.split_bp],
      client
    );
  }
}
on("POST", "/api/essays", "json", async (ctx) => {
  requireRole(ctx.person, "contributor");
  const fields = await readEssayFields(ctx.body, ctx.person, false);
  const body = await transaction(async (client) => {
    const now = await serverNow(client);
    const id = essayId(fields.title);
    await query(
      `INSERT INTO essays (id, version, title, caption, lift_local, lift_at, lift_resolution, exclusive_days,
         standard_days, exclusive_price_minor, standard_price_minor, state, created_at)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11)`,
      [
        id,
        fields.title,
        fields.caption,
        fields.lift_local,
        fields.lift.at,
        fields.lift.resolution,
        fields.exclusive_days,
        fields.standard_days,
        fields.exclusive_price_minor,
        fields.standard_price_minor,
        now
      ],
      client
    );
    await writeCredits(client, id, fields.credits);
    const essay = await loadEssay(id, client);
    return essayBody(ctx.person, essay, now, client);
  });
  sendJson(ctx.res, 201, body, { ETag: etagOf(1) });
});
function ifMatch(ctx) {
  const header = ctx.req.headers["if-match"];
  if (header === void 0) {
    throw new ApiError(428, "precondition_required", "Send If-Match with the essay version you last read.");
  }
  const m = /^"(\d+)"$/.exec(header.trim());
  return m ? Number(m[1]) : null;
}
on("PATCH", "/api/essays/:id", "json", async (ctx) => {
  const body = await transaction(async (client) => {
    const essay = await creditedEssay(ctx.person, ctx.params[0] ?? "", client);
    const expected = ifMatch(ctx);
    if (expected !== essay.version) {
      throw new ApiError(412, "version_conflict", "This essay was changed elsewhere.", { current_version: essay.version });
    }
    assertTransition(essay.state, "edit");
    const fields = await readEssayFields(ctx.body, ctx.person, true);
    const sets = [];
    const params = [];
    const put = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length + 1}`);
    };
    if (fields.title !== void 0) put("title", fields.title);
    if (fields.caption !== void 0) put("caption", fields.caption);
    if (fields.lift) {
      put("lift_local", fields.lift_local);
      put("lift_at", fields.lift.at);
      put("lift_resolution", fields.lift.resolution);
    }
    for (const key of ["exclusive_days", "standard_days", "exclusive_price_minor", "standard_price_minor"]) {
      if (fields[key] !== void 0) put(key, fields[key]);
    }
    await bumpVersion(client, essay.id, sets.join(", "), params);
    if (fields.credits) await writeCredits(client, essay.id, fields.credits);
    return essayBody(ctx.person, await loadEssay(essay.id, client), await serverNow(client), client);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version) });
});
on("GET", "/api/essays/:id", "none", async (ctx) => {
  const essay = await visibleEssay(ctx.person, ctx.params[0] ?? "");
  sendJson(ctx.res, 200, await essayBody(ctx.person, essay, await serverNow()), { ETag: etagOf(essay.version) });
});
on("POST", "/api/essays/:id/submit", "json", async (ctx) => {
  const body = await transaction(async (client) => {
    const essay = await creditedEssay(ctx.person, ctx.params[0] ?? "", client);
    assertTransition(essay.state, "submit");
    emptyBody(ctx.body);
    const frames = await query("SELECT 1 FROM frames WHERE essay_id = $1 LIMIT 1", [essay.id], client);
    if (!frames.length) throw validationFailed({ frames: "Add at least one frame before submitting" });
    const now = await serverNow(client);
    await bumpVersion(client, essay.id, "state = 'in_review', submitted_at = $2", [now]);
    return essayBody(ctx.person, await loadEssay(essay.id, client), now, client);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version) });
});
on("POST", "/api/essays/:id/withdrawal-request", "json", async (ctx) => {
  const body = await transaction(async (client) => {
    const essay = await creditedEssay(ctx.person, ctx.params[0] ?? "", client);
    assertTransition(essay.state, "request_withdrawal");
    emptyBody(ctx.body);
    if (!essay.withdrawal_requested) await bumpVersion(client, essay.id, "withdrawal_requested = true");
    return essayBody(ctx.person, await loadEssay(essay.id, client), await serverNow(client), client);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version) });
});
on("GET", "/api/studio/essays", "none", async (ctx) => {
  requireRole(ctx.person, "contributor");
  const now = await serverNow();
  const essays = await query(
    `SELECT e.* FROM essays e JOIN credits c ON c.essay_id = e.id WHERE c.handle = $1 ORDER BY e.created_at DESC, e.id`,
    [ctx.person.handle]
  );
  const bodies = await essayBodies(ctx.person, essays, now);
  const licences = await query(
    `SELECT l.*, n.name AS newsroom_name FROM licences l JOIN newsrooms n ON n.slug = l.newsroom
     WHERE l.essay_id = ANY($1) AND l.status <> 'removed' ORDER BY l.confirmed_at DESC`,
    [essays.map((e) => e.id)]
  );
  for (const body of bodies) {
    body.licences = licences.filter((l) => l.essay_id === body.id).flatMap((l) => {
      const state = licenceState(l, now);
      return state ? [{
        newsroom: { slug: l.newsroom, name: l.newsroom_name },
        kind: l.kind,
        state,
        window_end: isoInstant(l.window_end),
        window_end_display: coopTime(l.window_end),
        amount_minor: l.amount_minor
      }] : [];
    });
  }
  const contributors = await query(
    "SELECT handle, name FROM people WHERE role = 'contributor' ORDER BY name"
  );
  sendJson(ctx.res, 200, { essays: bodies, contributors });
});
on("GET", "/api/studio/royalties", "none", async (ctx) => {
  requireRole(ctx.person, "contributor");
  const lines = await query(
    `SELECT s.month, line->>'licence_id' AS licence_id, line->>'essay_title' AS essay_title,
       (share->>'position')::int AS position, (share->>'split_bp')::int AS split_bp,
       (share->>'amount_minor')::int AS amount_minor
     FROM statements s, jsonb_array_elements(s.body->'lines') line, jsonb_array_elements(line->'shares') share
     WHERE share->>'handle' = $1
     ORDER BY s.month DESC, line->>'confirmed_at', line->>'licence_id'`,
    [ctx.person.handle]
  );
  sendJson(ctx.res, 200, { lines });
});

// src/server/desk.ts
var NOTE_MESSAGE = "Desk note must be 1 to 1000 characters";
var REFERENCE_MESSAGE = "Legal reference must be 1 to 200 characters";
var length = (text) => [...text].length;
on("GET", "/api/desk/queue", "none", async (ctx) => {
  requireRole(ctx.person, "desk_editor");
  const now = await serverNow();
  const review = await query("SELECT * FROM essays WHERE state = 'in_review' ORDER BY submitted_at, id");
  const withdrawals = await query(
    "SELECT * FROM essays WHERE withdrawal_requested AND state = ANY($1) ORDER BY id",
    [ON_SHEET]
  );
  sendJson(ctx.res, 200, {
    essays: await essayBodies(ctx.person, review, now),
    withdrawal_requests: await essayBodies(ctx.person, withdrawals, now)
  });
});
on("GET", "/api/desk/essays", "none", async (ctx) => {
  requireRole(ctx.person, "desk_editor");
  const essays = await query("SELECT * FROM essays ORDER BY created_at DESC, id");
  sendJson(ctx.res, 200, { essays: await essayBodies(ctx.person, essays, await serverNow()) });
});
async function deskEssay(ctx, client) {
  const essay = await visibleEssay(ctx.person, ctx.params[0] ?? "", client, true);
  requireRole(ctx.person, "desk_editor");
  return essay;
}
async function respond(ctx, client, id) {
  return essayBody(ctx.person, await loadEssay(id, client), await serverNow(client), client);
}
on("POST", "/api/essays/:id/publish", "json", async (ctx) => {
  const body = await transaction(async (client) => {
    const essay = await deskEssay(ctx, client);
    assertTransition(essay.state, "publish");
    emptyBody(ctx.body);
    await bumpVersion(client, essay.id, "state = $2", [publishedState(essay.lift_at, await serverNow(client))]);
    return respond(ctx, client, essay.id);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version) });
});
on("POST", "/api/essays/:id/hold", "json", async (ctx) => {
  const body = await transaction(async (client) => {
    const essay = await deskEssay(ctx, client);
    assertTransition(essay.state, "hold");
    const { values, errors } = strictBody(ctx.body, { note: { kind: "string", message: NOTE_MESSAGE } });
    if (typeof values.note === "string" && (length(values.note) < 1 || length(values.note) > 1e3)) {
      errors.add("note", NOTE_MESSAGE);
    }
    errors.fail();
    await query(
      "INSERT INTO desk_notes (essay_id, note, at) VALUES ($1, $2, $3)",
      [essay.id, values.note, await serverNow(client)],
      client
    );
    await bumpVersion(client, essay.id, "state = 'draft'");
    return respond(ctx, client, essay.id);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version) });
});
async function clearShortlists(client, essayId2) {
  await query("DELETE FROM shortlist_items WHERE frame_id IN (SELECT id FROM frames WHERE essay_id = $1)", [essayId2], client);
}
on("POST", "/api/essays/:id/withdraw", "json", async (ctx) => {
  const body = await transaction(async (client) => {
    const essay = await deskEssay(ctx, client);
    assertTransition(essay.state, "withdraw");
    if (!essay.withdrawal_requested) {
      throw new ApiError(409, "no_withdrawal_request", "No credited contributor has asked to withdraw this essay.");
    }
    emptyBody(ctx.body);
    await bumpVersion(client, essay.id, "state = 'withdrawn', withdrawal_requested = false");
    await clearShortlists(client, essay.id);
    await cancelEssayMail(client, essay.id, ["alert"]);
    return respond(ctx, client, essay.id);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version) });
});
async function purgeTakenDown(essayId2) {
  const frames = await query("SELECT id FROM frames WHERE essay_id = $1", [essayId2]);
  const licences = await query("SELECT id FROM licences WHERE essay_id = $1", [essayId2]);
  for (const frame of frames) {
    for (const variant of VARIANTS) await deleteObject(keys.derivative(essayId2, frame.id, variant));
    await moveObject(keys.original(essayId2, frame.id), keys.legalHold(essayId2, frame.id));
  }
  for (const licence of licences) await deleteObject(keys.grant(licence.id));
  await query("UPDATE essays SET storage_purge_pending = false WHERE id = $1", [essayId2]);
}
on("POST", "/api/essays/:id/takedown", "json", async (ctx) => {
  const result = await transaction(async (client) => {
    const essay = await deskEssay(ctx, client);
    assertTransition(essay.state, "takedown");
    const { values, errors } = strictBody(ctx.body, { reference: { kind: "string", message: REFERENCE_MESSAGE } });
    if (typeof values.reference === "string" && (length(values.reference) < 1 || length(values.reference) > 200)) {
      errors.add("reference", REFERENCE_MESSAGE);
    }
    errors.fail();
    const now = await serverNow(client);
    const licences = await query("SELECT * FROM licences WHERE essay_id = $1 FOR UPDATE", [essay.id], client);
    const revoked = licences.filter((l) => {
      const state = licenceState(l, now);
      return state === "pending_invoice" || state === "active" || state === "expired";
    });
    await query(
      "UPDATE licences SET status = 'revoked', attempt_started_at = NULL WHERE id = ANY($1)",
      [revoked.map((l) => l.id)],
      client
    );
    await query("UPDATE licences SET status = 'removed' WHERE essay_id = $1 AND status = 'pending'", [essay.id], client);
    await clearShortlists(client, essay.id);
    await cancelEssayMail(client, essay.id);
    const names = (await creditsOf([essay.id], client)).map((c) => c.name);
    const line = { id: essay.id, title: essay.title, creditLine: creditLine(names) };
    for (const room of new Set(revoked.map((l) => l.newsroom))) {
      const roomLicences = revoked.filter((l) => l.newsroom === room);
      const people = await query(
        `SELECT email FROM people WHERE id = ANY($1) OR (newsroom = $2 AND role = 'licensing_manager') ORDER BY email`,
        [roomLicences.map((l) => l.licensed_by), room],
        client
      );
      for (const person of people) await queueTakedownNotice(client, line, person.email, roomLicences.map((l) => l.id));
    }
    await bumpVersion(
      client,
      essay.id,
      "state = 'taken_down', takedown_reference = $2, storage_purge_pending = true",
      [values.reference]
    );
    return { id: essay.id, state: "taken_down", revoked_licences: revoked.length };
  });
  await purgeTakenDown(result.id).catch(() => void 0);
  sendJson(ctx.res, 200, result);
});

// src/server/smtp.ts
import { connect } from "node:net";
import { randomBytes as randomBytes4 } from "node:crypto";
var TIMEOUT_MS3 = 5e3;
function encodeSubject(subject) {
  if (/^[\x20-\x7e]*$/.test(subject) && !subject.includes("=?")) return subject;
  const words = [];
  let chunk = "";
  for (const ch of subject) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}
function addressOf(from) {
  const m = /<([^>]+)>/.exec(from);
  return (m?.[1] ?? from).trim();
}
var base64Lines = (text) => (Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
function message(mail) {
  const domain = addressOf(config.smtp.from).split("@")[1] ?? "localhost";
  return [
    `From: ${config.smtp.from}`,
    `To: <${mail.to}>`,
    `Subject: ${encodeSubject(mail.subject)}`,
    `Date: ${(/* @__PURE__ */ new Date()).toUTCString()}`,
    `Message-ID: <${randomBytes4(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(mail.body)
  ].join("\r\n");
}
var Conversation = class {
  constructor(socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (data) => {
      this.buffer += data;
      this.flush();
    });
    const fail = (error) => {
      this.failure = error;
      this.waiter?.("");
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("SMTP connection closed")));
    socket.setTimeout(TIMEOUT_MS3, () => socket.destroy(new Error("SMTP timeout")));
  }
  buffer = "";
  waiter = null;
  failure = null;
  flush() {
    if (!this.waiter) return;
    const lines = this.buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/^\d{3} /.test(lines[i] ?? "")) {
        const reply = lines.slice(0, i + 1).join("\r\n");
        this.buffer = lines.slice(i + 1).join("\r\n");
        const waiter = this.waiter;
        this.waiter = null;
        waiter?.(reply);
        return;
      }
    }
  }
  async reply(expect) {
    if (this.failure) throw this.failure;
    const line = await new Promise((resolve) => {
      this.waiter = resolve;
      this.flush();
    });
    if (this.failure) throw this.failure;
    if (!line.startsWith(expect)) throw new Error(`SMTP answered ${line.slice(0, 80)}`);
  }
  async send(command, expect) {
    this.socket.write(`${command}\r
`);
    await this.reply(expect);
  }
};
async function deliver(mail) {
  const socket = connect({ host: config.smtp.host, port: config.smtp.port });
  const talk = new Conversation(socket);
  try {
    await talk.reply("220");
    await talk.send("EHLO saltprint-desk", "250");
    await talk.send(`MAIL FROM:<${addressOf(config.smtp.from)}>`, "250");
    await talk.send(`RCPT TO:<${mail.to}>`, "250");
    await talk.send("DATA", "354");
    await talk.send(`${message(mail)}\r
.`, "250");
    socket.end("QUIT\r\n");
  } finally {
    socket.destroy();
  }
}

// src/server/statements.ts
var MONTH_MESSAGE = "Use YYYY-MM";
var OPEN_MESSAGE = "That month hasn't closed in co-op time";
function royaltySplit(amount, rateBp, splits) {
  const commission = Math.floor(amount * rateBp / 1e4);
  const pool2 = amount - commission;
  const shares = splits.map((s) => Math.floor(pool2 * s / 1e4));
  const remainders = splits.map((s, i) => ({ i, rest: pool2 * s % 1e4 }));
  remainders.sort((a, b) => b.rest - a.rest || a.i - b.i);
  let left = pool2 - shares.reduce((a, b) => a + b, 0);
  for (const { i } of remainders) {
    if (left === 0) break;
    shares[i] = (shares[i] ?? 0) + 1;
    left -= 1;
  }
  return { commission, shares };
}
async function withPayouts(body) {
  const payouts = await query(
    "SELECT handle, amount_minor, state FROM payouts WHERE month = $1 ORDER BY handle",
    [body.month]
  );
  return { ...body, payouts };
}
async function storedStatement(month) {
  return (await one("SELECT body FROM statements WHERE month = $1", [month]))?.body;
}
async function buildStatement(month, start, end) {
  const licences = await query(
    `SELECT l.*, e.title, n.name AS newsroom_name FROM licences l JOIN essays e ON e.id = l.essay_id
     JOIN newsrooms n ON n.slug = l.newsroom
     WHERE l.confirmed_at >= $1 AND l.confirmed_at < $2 AND l.invoice_raised ORDER BY l.confirmed_at, l.id`,
    [start, end]
  );
  const credits = await query(
    `SELECT c.essay_id, c.handle, p.name, c.position, c.split_bp FROM credits c JOIN people p ON p.handle = c.handle
     WHERE c.essay_id = ANY($1) ORDER BY c.position`,
    [licences.map((l) => l.essay_id)]
  );
  const totals = /* @__PURE__ */ new Map();
  const lines = licences.map((l) => {
    const own = credits.filter((c) => c.essay_id === l.essay_id);
    const { commission, shares } = royaltySplit(l.amount_minor, l.rate_bp, own.map((c) => c.split_bp));
    own.forEach((c, i) => {
      const total = totals.get(c.handle) ?? { handle: c.handle, name: c.name, amount_minor: 0 };
      total.amount_minor += shares[i] ?? 0;
      totals.set(c.handle, total);
    });
    return {
      licence_id: l.id,
      essay_title: l.title,
      newsroom: { slug: l.newsroom, name: l.newsroom_name },
      confirmed_at: isoInstant(l.confirmed_at),
      confirmed_display: coopTime(l.confirmed_at),
      amount_minor: l.amount_minor,
      rate_bp: l.rate_bp,
      commission_minor: commission,
      shares: own.map((c, i) => ({
        handle: c.handle,
        name: c.name,
        position: c.position,
        split_bp: c.split_bp,
        amount_minor: shares[i] ?? 0
      }))
    };
  });
  return {
    month,
    lines,
    totals: {
      invoiced_minor: lines.reduce((a, l) => a + l.amount_minor, 0),
      commission_minor: lines.reduce((a, l) => a + l.commission_minor, 0),
      contributors: [...totals.values()].sort((a, b) => a.handle.localeCompare(b.handle))
    }
  };
}
on("POST", "/api/royalty-statements", "json", async (ctx) => {
  requireRole(ctx.person, "treasurer");
  const { values, errors } = strictBody(ctx.body, { month: { kind: "string", message: MONTH_MESSAGE } });
  if (typeof values.month === "string" && !isCalendarMonth(values.month)) errors.add("month", MONTH_MESSAGE);
  errors.fail();
  const month = values.month;
  const existing = await storedStatement(month);
  if (existing) {
    sendJson(ctx.res, 200, await withPayouts(existing));
    return;
  }
  const { start, end } = monthBounds(month);
  const now = await serverNow();
  const pending = await query(
    "SELECT * FROM licences WHERE status = 'pending' AND confirmed_at >= $1 AND confirmed_at < $2",
    [start, end]
  );
  if (pending.some((l) => licenceState(l, now) === "pending_invoice")) {
    throw new ApiError(409, "invoices_pending", "Some licences confirmed that month are still waiting for their invoice.");
  }
  if (now < end) throw validationFailed({ month: OPEN_MESSAGE });
  const body = await buildStatement(month, start, end);
  const inserted = await query(
    "INSERT INTO statements (month, body, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING month",
    [month, JSON.stringify(body), now]
  );
  const stored = inserted.length ? body : await storedStatement(month);
  sendJson(ctx.res, inserted.length ? 201 : 200, await withPayouts(stored));
});
on("GET", "/api/royalty-statements/:month", "none", async (ctx) => {
  requireRole(ctx.person, "treasurer");
  const stored = await storedStatement(ctx.params[0] ?? "");
  if (!stored) throw notFound();
  sendJson(ctx.res, 200, await withPayouts(stored));
});
on("POST", "/api/royalty-statements/:month/payouts", "json", async (ctx) => {
  requireRole(ctx.person, "treasurer");
  const month = ctx.params[0] ?? "";
  const stored = await storedStatement(month);
  if (!stored) throw notFound();
  emptyBody(ctx.body);
  const created = await transaction(async (client) => {
    await query("SELECT month FROM statements WHERE month = $1 FOR UPDATE", [month], client);
    if (await one("SELECT 1 FROM payouts WHERE month = $1", [month], client)) return false;
    for (const person of stored.totals.contributors.filter((c) => c.amount_minor > 0)) {
      await query(
        "INSERT INTO payouts (month, handle, amount_minor, state) VALUES ($1, $2, $3, 'queued')",
        [month, person.handle, person.amount_minor],
        client
      );
    }
    return true;
  });
  if (created) await recordDuePayouts(month);
  sendJson(ctx.res, created ? 202 : 200, await withPayouts(stored));
});
async function recordDuePayouts(month) {
  for (; ; ) {
    const outcome = await transaction(async (client) => {
      const payout = await one(
        `SELECT p.month, p.handle, p.amount_minor, p.state, pe.name FROM payouts p JOIN people pe ON pe.handle = p.handle
         WHERE p.state = 'queued'${month ? " AND p.month = $1" : ""}
         ORDER BY p.month, p.handle LIMIT 1 FOR UPDATE OF p SKIP LOCKED`,
        month ? [month] : [],
        client
      );
      if (!payout) return "done";
      try {
        await recordPayout(payout.handle, payout.name, payout.month, payout.amount_minor);
      } catch (error) {
        if (error instanceof BillingUnreachable || error instanceof BillingRefused) return "provider_down";
        throw error;
      }
      await query(
        "UPDATE payouts SET state = 'recorded' WHERE month = $1 AND handle = $2",
        [payout.month, payout.handle],
        client
      );
      return "recorded";
    });
    if (outcome !== "recorded") return outcome;
  }
}

// src/server/images.ts
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
var POOL_SIZE = Math.min(4, Math.max(2, availableParallelism() - 1));
var workers = [];
var waiting = /* @__PURE__ */ new Map();
var nextId = 1;
var turn = 0;
function worker() {
  if (workers.length < POOL_SIZE) {
    const w = new Worker(new URL("./image-worker.js", import.meta.url));
    w.on("message", (result) => {
      waiting.get(result.id)?.resolve(result);
      waiting.delete(result.id);
    });
    w.unref();
    workers.push(w);
    return w;
  }
  turn = (turn + 1) % workers.length;
  return workers[turn];
}
function run(job2) {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, { resolve });
    worker().postMessage({ ...job2, id });
  });
}
async function deriveFrame(bytes, type) {
  const result = await run({ kind: "derive", bytes: new Uint8Array(bytes), type });
  return result.ok ? result.derivatives : null;
}
async function drawSeedFrame(essayId2, position, width, height) {
  const result = await run({ kind: "seed", essayId: essayId2, position, width, height });
  return result.ok && result.original ? { original: result.original, derivatives: result.derivatives } : null;
}
function sniff(bytes) {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}

// src/server/seed-media.ts
function seedFrameOf(frame) {
  const seed2 = SEED_ESSAYS.find((e) => e.id === frame.essay_id);
  const n = Number(/-f(\d+)$/.exec(frame.id)?.[1]);
  return seed2 && frame.id === `${seed2.id}-f${n}` && n >= 1 && n <= seed2.frames ? { ...frame, n } : null;
}
var drawing = /* @__PURE__ */ new Map();
function drawSeededFrame(frame) {
  const known = drawing.get(frame.id);
  if (known) return known;
  const draw = (async () => {
    const drawn = await drawSeedFrame(frame.essay_id, frame.n, SEED_FRAME_SIZE.width, SEED_FRAME_SIZE.height);
    if (!drawn) return;
    await putObject(keys.original(frame.essay_id, frame.id), Buffer.from(drawn.original), "image/jpeg");
    for (const variant of VARIANTS) {
      await putObject(keys.derivative(frame.essay_id, frame.id, variant), Buffer.from(drawn.derivatives[variant]), "image/jpeg");
    }
    await query("UPDATE frames SET bytes = $2 WHERE id = $1", [frame.id, drawn.original.length]);
  })();
  drawing.set(frame.id, draw);
  draw.catch(() => drawing.delete(frame.id));
  return draw;
}
var complete = false;
async function seedMedia() {
  if (complete) return;
  const frames = await query(
    `SELECT f.id, f.essay_id, f.position FROM frames f JOIN essays e ON e.id = f.essay_id
     WHERE f.essay_id = ANY($1) AND e.state <> 'taken_down'
     ORDER BY e.state = ANY($2) DESC, f.position, f.essay_id`,
    [SEED_ESSAYS.map((e) => e.id), ON_SHEET]
  );
  const missing = [];
  for (const frame of frames) {
    const seeded = seedFrameOf(frame);
    if (seeded && !await objectExists(keys.derivative(frame.essay_id, frame.id, "preview"))) missing.push(seeded);
  }
  await Promise.all(missing.map(drawSeededFrame));
  complete = true;
}

// src/server/workers.ts
var WARNING_LEAD = "24 hours";
async function liftEmbargoes() {
  for (; ; ) {
    const lifted = await transaction(async (client) => {
      const now = await serverNow(client);
      const essay = await one(
        `SELECT * FROM essays WHERE state = 'embargoed' AND lift_at <= $1 ORDER BY lift_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [now],
        client
      );
      if (!essay) return false;
      const credits = await creditsOf([essay.id], client);
      const followers = await query(
        `SELECT DISTINCT p.email FROM follows f JOIN people p ON p.id = f.person_id
         WHERE f.essay_id = $1 OR f.contributor = ANY($2)`,
        [essay.id, credits.map((c) => c.handle)],
        client
      );
      assertTransition(essay.state, "lift");
      await bumpVersion(client, essay.id, "state = 'live'");
      await queueLiftAlert(
        client,
        { id: essay.id, title: essay.title, creditLine: creditLine(credits.map((c) => c.name)) },
        essay.lift_at,
        followers.map((f) => f.email)
      );
      return true;
    });
    if (!lifted) return;
  }
}
async function queueWarnings() {
  for (; ; ) {
    const queued = await transaction(async (client) => {
      const now = await serverNow(client);
      const licence = await one(
        `SELECT * FROM licences WHERE status = 'active' AND NOT warning_queued AND window_end > $1
           AND window_end - interval '${WARNING_LEAD}' <= $1 AND confirmed_at < window_end - interval '${WARNING_LEAD}'
         ORDER BY window_end LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [now],
        client
      );
      if (!licence) return false;
      const essay = await one("SELECT title FROM essays WHERE id = $1", [licence.essay_id], client);
      const credits = await creditsOf([licence.essay_id], client);
      await queueExpiryWarning(client, {
        id: licence.essay_id,
        title: essay?.title ?? "",
        creditLine: creditLine(credits.map((c) => c.name))
      }, licence);
      await query("UPDATE licences SET warning_queued = true WHERE id = $1", [licence.id], client);
      return true;
    });
    if (!queued) return;
  }
}
async function sendMail() {
  for (; ; ) {
    const result = await transaction(async (client) => {
      const mail = await one(
        `SELECT id, recipient, subject, body FROM mail_queue WHERE state = 'queued'
         ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [],
        client
      );
      if (!mail) return "done";
      try {
        await deliver({ to: mail.recipient, subject: mail.subject, body: mail.body });
      } catch {
        return "provider_down";
      }
      await query("UPDATE mail_queue SET state = 'sent', sent_at = clock_timestamp() WHERE id = $1", [mail.id], client);
      return "sent";
    });
    if (result !== "sent") return result;
  }
}
async function retryPurges() {
  const essays = await query("SELECT id FROM essays WHERE storage_purge_pending");
  for (const essay of essays) await purgeTakenDown(essay.id);
}
var PROVIDER_RETRY_MS = 5e3;
var job = (every, run2) => ({ every, run: run2, busy: false, next: 0 });
var jobs = [
  job(400, liftEmbargoes),
  job(500, queueWarnings),
  job(500, sendMail),
  job(1e3, retryActivations),
  job(1e3, () => recordDuePayouts()),
  job(5e3, retryPurges),
  job(5e3, seedMedia)
];
function startWorkers() {
  setInterval(() => {
    const now = Date.now();
    for (const due of jobs) {
      if (due.busy || now < due.next) continue;
      due.busy = true;
      due.next = now + due.every;
      due.run().then((outcome) => {
        if (outcome === "provider_down") due.next = Date.now() + PROVIDER_RETRY_MS;
      }).catch(() => void 0).finally(() => {
        due.busy = false;
      });
    }
  }, 100).unref();
}

// src/server/frames.ts
var MAX_FRAMES = 24;
var UNREADABLE = "This file can't be read as an image";
var frameBody = (frame, version) => ({
  id: frame.id,
  position: frame.position,
  caption: frame.caption,
  filename: frame.filename,
  bytes: frame.bytes,
  type: frame.type,
  width: frame.width,
  height: frame.height,
  essay_version: version
});
async function editableDraft(ctx, essayId2, work) {
  return transaction(async (client) => {
    const essay = await creditedEssay(ctx.person, essayId2, client);
    assertTransition(essay.state, "edit");
    return work(essay, client);
  });
}
async function frameCountBelowLimit(essayId2, client) {
  const count = await one("SELECT count(*)::int AS n FROM frames WHERE essay_id = $1", [essayId2], client);
  const n = count?.n ?? 0;
  if (n >= MAX_FRAMES) throw validationFailed({ file: `An essay holds at most ${MAX_FRAMES} frames` });
  return n;
}
on("POST", "/api/essays/:id/frames", "multipart", async (ctx) => {
  const essayId2 = ctx.params[0] ?? "";
  await editableDraft(ctx, essayId2, async () => void 0);
  if (ctx.multipart.overLimit) throw new ApiError(413, "file_too_large", "Each frame may be at most 25,000,000 bytes.");
  const parts2 = parseMultipart(ctx.multipart.bytes, ctx.req.headers["content-type"] ?? "");
  const file = parts2?.find((p) => p.name === "file" && p.filename !== null);
  if (!file) throw validationFailed({ file: UNREADABLE });
  if (file.data.length > UPLOAD_LIMIT) throw new ApiError(413, "file_too_large", "Each frame may be at most 25,000,000 bytes.");
  const type = sniff(file.data);
  if (!type) throw new ApiError(415, "unsupported_type", "Upload a JPEG or PNG image.");
  const caption = parts2?.find((p) => p.name === "caption" && p.filename === null)?.data.toString("utf8") ?? "";
  if ([...caption].length > 500) throw validationFailed({ caption: FRAME_CAPTION });
  await frameCountBelowLimit(essayId2);
  const derivatives = await deriveFrame(file.data, type);
  if (!derivatives) throw validationFailed({ file: UNREADABLE });
  const seq = await one(
    "UPDATE essays SET frame_seq = frame_seq + 1 WHERE id = $1 RETURNING frame_seq",
    [essayId2]
  );
  const frameId = `${essayId2}-f${seq?.frame_seq ?? 0}`;
  await putObject(keys.original(essayId2, frameId), file.data, type);
  for (const variant of VARIANTS) {
    await putObject(keys.derivative(essayId2, frameId, variant), Buffer.from(derivatives[variant]), "image/jpeg");
  }
  const filename = (file.filename ?? "").split(/[\\/]/).pop() ?? "";
  const result = await editableDraft(ctx, essayId2, async (essay, client) => {
    const taken = await frameCountBelowLimit(essay.id, client);
    const [frame] = await query(
      `INSERT INTO frames (id, essay_id, position, caption, filename, bytes, type, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        frameId,
        essay.id,
        taken + 1,
        caption,
        filename,
        file.data.length,
        type,
        derivatives.width,
        derivatives.height
      ],
      client
    );
    return { frame, version: await bumpVersion(client, essay.id) };
  });
  sendJson(ctx.res, 201, frameBody(result.frame, result.version), { ETag: etagOf(result.version) });
});
async function frameEssay(frameId) {
  const frame = await one("SELECT * FROM frames WHERE id = $1", [frameId]);
  if (!frame) throw notFound();
  return frame;
}
on("PATCH", "/api/frames/:id", "json", async (ctx) => {
  const found = await frameEssay(ctx.params[0] ?? "");
  const result = await editableDraft(ctx, found.essay_id, async (essay, client) => {
    const { values, errors } = strictBody(ctx.body, { caption: { kind: "string", message: FRAME_CAPTION } });
    if (typeof values.caption === "string" && [...values.caption].length > 500) errors.add("caption", FRAME_CAPTION);
    errors.fail();
    const [frame] = await query(
      "UPDATE frames SET caption = $2 WHERE id = $1 RETURNING *",
      [found.id, values.caption],
      client
    );
    return { frame, version: await bumpVersion(client, essay.id) };
  });
  sendJson(ctx.res, 200, frameBody(result.frame, result.version), { ETag: etagOf(result.version) });
});
on("DELETE", "/api/frames/:id", "none", async (ctx) => {
  const found = await frameEssay(ctx.params[0] ?? "");
  const version = await editableDraft(ctx, found.essay_id, async (essay, client) => {
    await query("DELETE FROM frames WHERE id = $1", [found.id], client);
    await query(`UPDATE frames f SET position = r.n FROM (
        SELECT id, row_number() OVER (ORDER BY position) AS n FROM frames WHERE essay_id = $1) r
      WHERE f.id = r.id`, [essay.id], client);
    return bumpVersion(client, essay.id);
  });
  await Promise.all([
    keys.original(found.essay_id, found.id),
    ...VARIANTS.map((v) => keys.derivative(found.essay_id, found.id, v))
  ].map((key) => deleteObject(key).catch(() => void 0)));
  sendNoContent(ctx.res, { ETag: etagOf(version) });
});

// src/server/feed.ts
on("GET", "/api/feed", "none", async (ctx) => {
  const q = (ctx.url.searchParams.get("q") ?? "").toLowerCase();
  const essays = await query(
    `SELECT e.*, (SELECT count(*)::int FROM frames f WHERE f.essay_id = e.id) AS frame_count,
       (SELECT f.id FROM frames f WHERE f.essay_id = e.id ORDER BY f.position LIMIT 1) AS cover
     FROM essays e
     WHERE e.state = ANY($2) AND ($1 = '' OR strpos(lower(e.title), $1) > 0
       OR strpos(lower(e.caption), $1) > 0
       OR EXISTS (SELECT 1 FROM frames f WHERE f.essay_id = e.id AND strpos(lower(f.caption), $1) > 0)
       OR EXISTS (SELECT 1 FROM credits c JOIN people p ON p.handle = c.handle
                  WHERE c.essay_id = e.id AND strpos(lower(p.name), $1) > 0))
     ORDER BY e.lift_at DESC, e.id`,
    [q, ON_SHEET]
  );
  const ids = essays.map((e) => e.id);
  const [credits, licences, now] = await Promise.all([creditsOf(ids), licencesOnEssays(ids), serverNow()]);
  sendJson(ctx.res, 200, { essays: essays.map((e) => ({
    id: e.id,
    title: e.title,
    credit_line: creditLine(credits.filter((c) => c.essay_id === e.id).map((c) => c.name)),
    state: e.state,
    lift_at: isoInstant(e.lift_at),
    lift_display: coopTime(e.lift_at),
    frame_count: e.frame_count,
    cover_url: e.cover ? mediaUrl(e.cover, "grid") : null,
    window: windowBody(ctx.person, licences.filter((l) => l.essay_id === e.id), now)
  })) });
});
on("GET", "/media/frames/:frame/:variant", "none", async (ctx) => {
  const [frameId = "", variant = ""] = ctx.params;
  const frame = await one("SELECT id, essay_id FROM frames WHERE id = $1", [frameId]);
  if (!frame || !VARIANTS.includes(variant)) throw notFound();
  const essay = await visibleEssay(ctx.person, frame.essay_id);
  if (essay.state === "taken_down") throw notFound();
  const mayStory = ctx.person.role === "desk_editor" || ctx.person.role === "contributor" && isCredited(ctx.person, await creditsOf([essay.id]));
  if (variant === "story" && !mayStory) throw notFound();
  const key = keys.derivative(essay.id, frame.id, variant);
  let bytes = await getObject(key);
  const seeded = bytes ? null : seedFrameOf(frame);
  if (seeded) {
    await drawSeededFrame(seeded);
    bytes = await getObject(key);
  }
  if (!bytes) throw notFound();
  ctx.res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Content-Length": String(bytes.length),
    "Cache-Control": "private, max-age=300"
  });
  ctx.res.end(bytes);
});

// src/server/follows.ts
var TARGET_MESSAGE = "Follow one essay or one contributor";
var followBody = (f) => ({ id: f.id, essay_id: f.essay_id, contributor: f.contributor });
on("POST", "/api/follows", "json", async (ctx) => {
  requireRole(ctx.person, "picture_editor");
  const { values, errors } = strictBody(ctx.body, {
    essay_id: { kind: "string", message: WRONG_TYPE, optional: true },
    contributor: { kind: "string", message: WRONG_TYPE, optional: true }
  });
  errors.fail();
  const given = ctx.body;
  if ("essay_id" in given === "contributor" in given) throw validationFailed({ target: TARGET_MESSAGE });
  const essayId2 = typeof values.essay_id === "string" ? values.essay_id : null;
  const handle = typeof values.contributor === "string" ? values.contributor : null;
  if (essayId2) await visibleEssay(ctx.person, essayId2);
  if (handle && !await one("SELECT 1 FROM people WHERE handle = $1 AND role = 'contributor'", [handle])) {
    throw validationFailed({ contributor: `Unknown contributor ${handle}` });
  }
  const created = await query(
    `INSERT INTO follows (id, person_id, essay_id, contributor, created_at) VALUES ($1, $2, $3, $4, clock_timestamp())
     ON CONFLICT DO NOTHING RETURNING id, essay_id, contributor`,
    [newId("fol-"), ctx.person.id, essayId2, handle]
  );
  if (created[0]) {
    sendJson(ctx.res, 201, followBody(created[0]));
    return;
  }
  const existing = await one(
    `SELECT id, essay_id, contributor FROM follows WHERE person_id = $1
     AND essay_id IS NOT DISTINCT FROM $2 AND contributor IS NOT DISTINCT FROM $3`,
    [ctx.person.id, essayId2, handle]
  );
  if (!existing) throw new ApiError(409, "follow_conflict", "That follow changed while saving; try again.");
  sendJson(ctx.res, 200, followBody(existing));
});
on("GET", "/api/follows", "none", async (ctx) => {
  requireRole(ctx.person, "picture_editor");
  const follows = await query(
    `SELECT f.id, f.essay_id, f.contributor, e.title AS essay_title, p.name AS contributor_name
     FROM follows f LEFT JOIN essays e ON e.id = f.essay_id LEFT JOIN people p ON p.handle = f.contributor
     WHERE f.person_id = $1 AND (e.id IS NULL OR e.state IN ('embargoed', 'live', 'withdrawn'))
     ORDER BY f.created_at DESC, f.id`,
    [ctx.person.id]
  );
  sendJson(ctx.res, 200, { follows });
});
on("DELETE", "/api/follows/:id", "none", async (ctx) => {
  requireRole(ctx.person, "picture_editor");
  const gone = await query("DELETE FROM follows WHERE id = $1 AND person_id = $2 RETURNING id", [ctx.params[0], ctx.person.id]);
  if (!gone.length) throw notFound();
  sendNoContent(ctx.res);
});
var SHORTLIST_SQL = `SELECT s.id, f.essay_id, e.title AS essay_title, s.frame_id, f.position, p.name AS added_by, s.added_at
  FROM shortlist_items s JOIN frames f ON f.id = s.frame_id JOIN essays e ON e.id = f.essay_id
  JOIN people p ON p.id = s.added_by`;
var itemBody = (row) => ({
  ...row,
  added_at: isoInstant(row.added_at),
  added_display: coopTime(row.added_at)
});
async function shortlistOf(newsroom) {
  return query(`${SHORTLIST_SQL} WHERE s.newsroom = $1 AND e.state = ANY($2)
    ORDER BY s.added_at DESC, s.id`, [newsroom, ON_SHEET]);
}
on("GET", "/api/shortlist", "none", async (ctx) => {
  requireRole(ctx.person, "picture_editor", "licensing_manager");
  const items = await shortlistOf(newsroomOf(ctx.person).slug);
  sendJson(ctx.res, 200, { items: items.map(itemBody), count: items.length });
});
on("POST", "/api/shortlist", "json", async (ctx) => {
  requireRole(ctx.person, "picture_editor");
  const { values, errors } = strictBody(ctx.body, { frame_id: { kind: "string", message: WRONG_TYPE } });
  errors.fail();
  const frame = await one("SELECT id, essay_id FROM frames WHERE id = $1", [values.frame_id]);
  if (!frame) throw notFound();
  const essay = await visibleEssay(ctx.person, frame.essay_id);
  if (!isOnSheet(essay.state)) throw new ApiError(409, "not_licensable", "Only embargoed and live essays can be shortlisted.");
  const room = newsroomOf(ctx.person).slug;
  const created = await query(
    `INSERT INTO shortlist_items (id, newsroom, frame_id, added_by, added_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (newsroom, frame_id) DO NOTHING RETURNING id`,
    [newId("sl-"), room, frame.id, ctx.person.id, await serverNow()]
  );
  const row = await one(`${SHORTLIST_SQL} WHERE s.newsroom = $1 AND s.frame_id = $2`, [room, frame.id]);
  sendJson(ctx.res, created.length ? 201 : 200, itemBody(row));
});
on("DELETE", "/api/shortlist/:id", "none", async (ctx) => {
  requireRole(ctx.person, "picture_editor");
  const gone = await query(
    "DELETE FROM shortlist_items WHERE id = $1 AND newsroom = $2 RETURNING id",
    [ctx.params[0], newsroomOf(ctx.person).slug]
  );
  if (!gone.length) throw notFound();
  sendNoContent(ctx.res);
});

// src/server/licences.ts
import { randomBytes as randomBytes5 } from "node:crypto";

// src/server/rates.ts
var DATE_MESSAGE = "Use YYYY-MM-DD";
var FUTURE_MESSAGE = "Effective date must be after today in co-op time";
var RATE_MESSAGE = "Rate must be 0 to 10000 basis points";
async function rateAt(client, at) {
  const row = await one(
    "SELECT rate_bp FROM commission_rates WHERE effective_from <= $1::date ORDER BY effective_from DESC LIMIT 1",
    [coopDateOf(at)],
    client
  );
  return row?.rate_bp ?? 0;
}
on("GET", "/api/commission-rates", "none", async (ctx) => {
  requireRole(ctx.person, "treasurer");
  const today = coopDateOf(await serverNow());
  const rates = await query(
    "SELECT effective_from::text AS effective_from, rate_bp FROM commission_rates ORDER BY effective_from"
  );
  const started = rates.filter((r) => r.effective_from <= today);
  const current = started[started.length - 1] ?? null;
  sendJson(ctx.res, 200, {
    current,
    rates: rates.map((r) => ({
      ...r,
      status: r.effective_from > today ? "scheduled" : r === current ? "current" : "past"
    }))
  });
});
on("POST", "/api/commission-rates", "json", async (ctx) => {
  requireRole(ctx.person, "treasurer");
  const { values, errors } = strictBody(ctx.body, {
    effective_from: { kind: "string", message: DATE_MESSAGE },
    rate_bp: { kind: "integer", message: RATE_MESSAGE }
  });
  const day = typeof values.effective_from === "string" && isCalendarDate(values.effective_from) ? values.effective_from : null;
  if (day && await one("SELECT 1 FROM commission_rates WHERE effective_from = $1::date", [day])) {
    throw new ApiError(409, "rate_date_taken", "A rate is already scheduled from that date.");
  }
  if (typeof values.effective_from === "string") {
    if (!day) errors.add("effective_from", DATE_MESSAGE);
    else if (day <= coopDateOf(await serverNow())) errors.add("effective_from", FUTURE_MESSAGE);
  }
  if (typeof values.rate_bp === "number" && (values.rate_bp < 0 || values.rate_bp > 1e4)) {
    errors.add("rate_bp", RATE_MESSAGE);
  }
  errors.fail();
  const inserted = await query(
    `INSERT INTO commission_rates (effective_from, rate_bp) VALUES ($1::date, $2) ON CONFLICT DO NOTHING
     RETURNING effective_from::text AS effective_from, rate_bp`,
    [day, values.rate_bp]
  );
  const rate = inserted[0];
  if (!rate) throw new ApiError(409, "rate_date_taken", "A rate is already scheduled from that date.");
  sendJson(ctx.res, 201, { effective_from: rate.effective_from, rate_bp: rate.rate_bp, status: "scheduled" });
});

// src/server/licences.ts
var KEY_MESSAGE = "Send an Idempotency-Key header of 1 to 100 visible characters";
var KIND_MESSAGE = "Kind must be exclusive or standard";
var PLACEHOLDER_TITLE = "Removed essay (legal takedown)";
var GRANT_MAX_SECONDS = 300;
var ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function licenceId() {
  return `lic-${[...randomBytes5(14)].map((b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}
async function newsroomLicences(newsroom, now, client) {
  const rows = await query(
    "SELECT * FROM licences WHERE newsroom = $1 AND status <> 'removed' ORDER BY confirmed_at DESC, id",
    [newsroom],
    client
  );
  return rows.flatMap((row) => {
    const state = licenceState(row, now);
    return state ? [{ row, state }] : [];
  });
}
async function contextFor(listed, client) {
  const essayIds = [...new Set(listed.map((l) => l.row.essay_id))];
  const licenceIds = listed.map((l) => l.row.id);
  const [essays, credits, frames, people, rooms, mails] = await Promise.all([
    query("SELECT * FROM essays WHERE id = ANY($1)", [essayIds], client),
    query(
      "SELECT c.essay_id, p.name FROM credits c JOIN people p ON p.handle = c.handle WHERE c.essay_id = ANY($1) ORDER BY c.position",
      [essayIds],
      client
    ),
    query(
      "SELECT id, essay_id, position FROM frames WHERE essay_id = ANY($1) ORDER BY position",
      [essayIds],
      client
    ),
    query(
      "SELECT id, name FROM people WHERE id = ANY($1)",
      [[...new Set(listed.map((l) => l.row.licensed_by))]],
      client
    ),
    query("SELECT slug, name FROM newsrooms", [], client),
    query(
      "SELECT licence_id, state FROM mail_queue WHERE kind = 'receipt' AND licence_id = ANY($1)",
      [licenceIds],
      client
    )
  ]);
  const context = {
    essays: /* @__PURE__ */ new Map(),
    frames: /* @__PURE__ */ new Map(),
    people: new Map(people.map((p) => [p.id, p.name])),
    rooms: new Map(rooms.map((r) => [r.slug, r.name])),
    receipts: /* @__PURE__ */ new Map()
  };
  for (const essay of essays) {
    context.essays.set(essay.id, {
      ...essay,
      credit_line: creditLine(credits.filter((c) => c.essay_id === essay.id).map((c) => c.name))
    });
    context.frames.set(essay.id, frames.filter((f) => f.essay_id === essay.id).map((f) => ({ id: f.id, position: f.position })));
  }
  for (const mail of mails) context.receipts.set(mail.licence_id, [...context.receipts.get(mail.licence_id) ?? [], mail.state]);
  return context;
}
function licenceBody(item, context) {
  const { row, state } = item;
  const essay = context.essays.get(row.essay_id);
  const revoked = state === "revoked";
  const pending = state === "pending_invoice";
  return {
    id: row.id,
    essay_id: row.essay_id,
    essay_title: revoked ? PLACEHOLDER_TITLE : essay?.title ?? "",
    credit_line: revoked ? null : essay?.credit_line ?? null,
    kind: row.kind,
    state,
    newsroom: { slug: row.newsroom, name: context.rooms.get(row.newsroom) ?? row.newsroom },
    licensed_by: { name: context.people.get(row.licensed_by) ?? "" },
    confirmed_at: isoInstant(row.confirmed_at),
    confirmed_display: coopTime(row.confirmed_at),
    window_start: isoInstant(row.confirmed_at),
    window_end: isoInstant(row.window_end),
    window_end_display: coopTime(row.window_end),
    hold_until: pending ? isoInstant(row.hold_until) : null,
    hold_until_display: pending ? coopTime(row.hold_until) : null,
    amount_minor: row.amount_minor,
    currency: "USD",
    invoice_state: row.invoice_raised ? "raised" : "pending",
    receipt_state: receiptState(context.receipts.get(row.id) ?? []),
    frames: revoked ? [] : context.frames.get(row.essay_id) ?? []
  };
}
async function licenceBodies(listed, client) {
  const context = await contextFor(listed, client);
  return listed.map((item) => licenceBody(item, context));
}
async function essayCaptions(listed) {
  const rows = await query(
    "SELECT id, caption FROM essays WHERE id = ANY($1)",
    [[...new Set(listed.map((l) => l.row.essay_id))]]
  );
  return new Map(rows.map((e) => [e.id, e.caption]));
}
async function ownLicence(person, id, now) {
  requireRole(person, "picture_editor", "licensing_manager");
  const row = await one("SELECT * FROM licences WHERE id = $1", [id]);
  const state = row ? licenceState(row, now) : null;
  if (!row || !state || row.newsroom !== newsroomOf(person).slug) throw notFound();
  return { row, state };
}
on("GET", "/api/licences", "none", async (ctx) => {
  requireRole(ctx.person, "picture_editor", "licensing_manager");
  const now = await serverNow();
  const listed = await newsroomLicences(newsroomOf(ctx.person).slug, now);
  sendJson(ctx.res, 200, { licences: await licenceBodies(listed) });
});
on("GET", "/api/licences/:id", "none", async (ctx) => {
  const now = await serverNow();
  const found = await ownLicence(ctx.person, ctx.params[0] ?? "", now);
  sendJson(ctx.res, 200, (await licenceBodies([found]))[0]);
});
async function confirmLicence(client, person, essayId2, kind) {
  const essay = await loadEssay(essayId2, client, true);
  if (!essay) throw notFound();
  if (essay.state === "taken_down") throw takenDown();
  if (!isOnSheet(essay.state)) throw new ApiError(409, "not_licensable", "This essay can't be licensed right now.");
  const now = await serverNow(client);
  const room = newsroomOf(person).slug;
  const rows = await query(
    "SELECT * FROM licences WHERE essay_id = $1 AND status IN ('pending', 'active')",
    [essayId2],
    client
  );
  for (const row2 of rows.filter((r) => !isStanding(r, now))) {
    await query("UPDATE licences SET status = $2 WHERE id = $1", [row2.id, row2.status === "active" ? "expired" : "removed"], client);
  }
  const window = windowBody(person, rows, now);
  if (kind === "exclusive") {
    if (window.state === "claimed") {
      throw new ApiError(
        409,
        "window_held",
        "The exclusive window is already held.",
        { held_by: window.held_by, held_until: window.held_until }
      );
    }
    if (window.standard_running_until) {
      throw new ApiError(
        409,
        "standard_licences_active",
        "Standard licences are running on this essay.",
        { blocked_until: window.standard_running_until }
      );
    }
  } else if (window.held_by === "another_newsroom") {
    throw new ApiError(
      409,
      "exclusive_held",
      "Another newsroom holds the exclusive window.",
      { held_by: window.held_by, held_until: window.held_until }
    );
  }
  if (rows.some((r) => r.newsroom === room && isStanding(r, now))) {
    throw new ApiError(409, "already_licensed", "Your newsroom already licenses this essay.");
  }
  const end = windowEnd(now, essay.lift_at, kind === "exclusive" ? essay.exclusive_days : essay.standard_days);
  const [row] = await query(
    `INSERT INTO licences (id, essay_id, newsroom, licensed_by, kind, status, confirmed_at, window_end, hold_until,
       amount_minor, rate_bp, attempts)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, 1) RETURNING *`,
    [
      licenceId(),
      essayId2,
      room,
      person.id,
      kind,
      now,
      end,
      holdDeadline(now, end),
      kind === "exclusive" ? essay.exclusive_price_minor : essay.standard_price_minor,
      await rateAt(client, now)
    ],
    client
  );
  return row;
}
async function requestLicence(person, essayId2, kind) {
  let row;
  try {
    row = await transaction(async (client) => {
      const confirmed = await confirmLicence(client, person, essayId2, kind);
      const attempt = await attemptActivation(client, confirmed);
      if (attempt === "refused") {
        throw new ApiError(502, "billing_rejected", "Billing refused the invoice; nothing was licensed.");
      }
      return await one("SELECT * FROM licences WHERE id = $1", [confirmed.id], client);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw new ApiError(409, "already_licensed", "Your newsroom already licenses this essay.");
  }
  const state = row.status === "active" ? "active" : "pending_invoice";
  const [body] = await licenceBodies([{ row, state }]);
  return { status: state === "active" ? 201 : 202, body };
}
async function claimKey(person, key, essayId2, kind) {
  const inserted = await query(
    `INSERT INTO idempotency_keys (person_id, key, essay_id, kind) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING key`,
    [person.id, key, essayId2, kind]
  );
  if (inserted.length) return { fresh: true };
  const deadline = Date.now() + 6e4;
  while (Date.now() < deadline) {
    const stored = await one(
      "SELECT essay_id, kind, status, body FROM idempotency_keys WHERE person_id = $1 AND key = $2",
      [person.id, key]
    );
    if (!stored) return claimKey(person, key, essayId2, kind);
    if (stored.essay_id !== essayId2 || stored.kind !== kind) {
      throw new ApiError(409, "idempotency_key_reused", "That Idempotency-Key was already used for a different request.");
    }
    if (stored.status !== null) return { fresh: false, status: stored.status, body: stored.body };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new ApiError(409, "idempotency_key_reused", "That Idempotency-Key is still in use by another request.");
}
on("POST", "/api/essays/:id/licences", "json", async (ctx) => {
  const essayId2 = ctx.params[0] ?? "";
  await visibleEssay(ctx.person, essayId2);
  requireRole(ctx.person, "picture_editor");
  const header = ctx.req.headers["idempotency-key"];
  const key = typeof header === "string" ? header : "";
  const { values, errors } = strictBody(ctx.body, { kind: { kind: "string", message: KIND_MESSAGE } });
  if (!/^[\x21-\x7e]{1,100}$/.test(key)) errors.add("idempotency_key", KEY_MESSAGE);
  if (typeof values.kind === "string" && values.kind !== "exclusive" && values.kind !== "standard") {
    errors.add("kind", KIND_MESSAGE);
  }
  errors.fail();
  const kind = values.kind;
  const slot = await claimKey(ctx.person, key, essayId2, kind);
  if (!slot.fresh) {
    sendJson(ctx.res, slot.status, slot.body);
    return;
  }
  let status;
  let body;
  try {
    ({ status, body } = await requestLicence(ctx.person, essayId2, kind));
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 503) {
      await query("DELETE FROM idempotency_keys WHERE person_id = $1 AND key = $2", [ctx.person.id, key]).catch(() => void 0);
      throw error;
    }
    status = error.status;
    body = errorBody(error);
    await query(
      "UPDATE idempotency_keys SET status = $3, body = $4 WHERE person_id = $1 AND key = $2",
      [ctx.person.id, key, status, JSON.stringify(body)]
    );
    sendError(ctx.res, error);
    return;
  }
  await query(
    "UPDATE idempotency_keys SET status = $3, body = $4 WHERE person_id = $1 AND key = $2",
    [ctx.person.id, key, status, JSON.stringify(body)]
  );
  sendJson(ctx.res, status, body);
});
on("POST", "/api/licences/:id/grants", "json", async (ctx) => {
  const now = await serverNow();
  const { row, state } = await ownLicence(ctx.person, ctx.params[0] ?? "", now);
  requireRole(ctx.person, "picture_editor");
  const { values, errors } = strictBody(ctx.body, { frame_id: { kind: "string", message: WRONG_TYPE } });
  errors.fail();
  const frame = await one(
    "SELECT id, position, type FROM frames WHERE id = $1 AND essay_id = $2",
    [values.frame_id, row.essay_id]
  );
  if (!frame) throw notFound();
  if (state === "pending_invoice") {
    throw new ApiError(409, "licence_pending", "The invoice is still pending; originals unlock when it is raised.");
  }
  if (state === "revoked") {
    throw new ApiError(410, "licence_revoked", "Licence revoked after a legal takedown. Originals are no longer available.");
  }
  const seconds = Math.min(GRANT_MAX_SECONDS, Math.floor((row.window_end.getTime() - now.getTime()) / 1e3));
  if (state === "expired" || seconds <= 0) {
    throw new ApiError(
      410,
      "licence_ended",
      `This licence ended at ${coopTime(row.window_end)}. Originals are no longer available.`
    );
  }
  const key = keys.original(row.essay_id, frame.id);
  if (!await objectExists(key)) throw notFound();
  const ext = frame.type === "image/png" ? "png" : "jpg";
  const url = presignGet(key, seconds, {
    "response-content-disposition": `attachment; filename="${row.essay_id}-frame-${frame.position}.${ext}"`,
    "response-content-type": frame.type
  });
  sendJson(ctx.res, 201, { url, expires_at: isoInstant(new Date(now.getTime() + seconds * 1e3)) });
});

// src/server/usage.ts
function expiryOrder(listed) {
  return listed.filter((l) => l.state === "active").sort((a, b) => a.row.window_end.getTime() - b.row.window_end.getTime() || a.row.confirmed_at.getTime() - b.row.confirmed_at.getTime() || (a.row.id < b.row.id ? -1 : 1));
}
on("GET", "/api/usage", "none", async (ctx) => {
  requireRole(ctx.person, "licensing_manager");
  const room = newsroomOf(ctx.person);
  const now = await serverNow();
  const [listed, shortlist] = await Promise.all([newsroomLicences(room.slug, now), shortlistOf(room.slug)]);
  const count = (test) => listed.filter(test).length;
  const expiries = expiryOrder(listed);
  const next = expiries[0];
  sendJson(ctx.res, 200, {
    newsroom: { slug: room.slug, name: room.name },
    active: count((l) => l.state === "active"),
    pending_invoice: count((l) => l.state === "pending_invoice"),
    expired: count((l) => l.state === "expired"),
    revoked: count((l) => l.state === "revoked"),
    exclusive: count((l) => l.row.kind === "exclusive" && holdsWindow(l.state)),
    standard: count((l) => l.row.kind === "standard" && holdsWindow(l.state)),
    invoiced_minor: listed.filter((l) => l.row.invoice_raised).reduce((sum, l) => sum + l.row.amount_minor, 0),
    shortlist_count: shortlist.length,
    next_expiry: next ? {
      licence_id: next.row.id,
      window_end: isoInstant(next.row.window_end),
      window_end_display: coopTime(next.row.window_end)
    } : null,
    expiries: await licenceBodies(expiries)
  });
});
var FORMULA_START = /^[=+\-@\t\r]/;
function csvCell(value) {
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
var COLUMNS = [
  "licence_id",
  "essay_title",
  "caption",
  "credit_line",
  "kind",
  "state",
  "confirmed_at",
  "window_start",
  "window_end",
  "amount",
  "currency"
];
on("GET", "/api/usage.csv", "none", async (ctx) => {
  requireRole(ctx.person, "licensing_manager");
  const room = newsroomOf(ctx.person);
  const now = await serverNow();
  const listed = await newsroomLicences(room.slug, now);
  const [bodies, captions] = await Promise.all([licenceBodies(listed), essayCaptions(listed)]);
  const rows = listed.map((item, i) => {
    const body = bodies[i];
    return [
      item.row.id,
      body.essay_title,
      item.state === "revoked" ? "" : captions.get(item.row.essay_id) ?? "",
      body.credit_line ?? "",
      item.row.kind,
      item.state,
      coopCsvTime(item.row.confirmed_at),
      coopCsvTime(item.row.confirmed_at),
      coopCsvTime(item.row.window_end),
      centsToDecimal(item.row.amount_minor),
      "USD"
    ];
  });
  const text = [COLUMNS, ...rows].map((r) => `${r.map(csvCell).join(",")}\r
`).join("");
  const payload = Buffer.from(text, "utf8");
  ctx.res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="saltprint-usage-${room.slug}-${coopDateOf(now)}.csv"`,
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store"
  });
  ctx.res.end(payload);
});

// src/server/main.ts
var PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
var APP_PATHS = /* @__PURE__ */ new Set([
  "/",
  "/sheet",
  "/studio",
  "/royalties",
  "/shortlist",
  "/licences",
  "/following",
  "/usage",
  "/review",
  "/essays",
  "/rates",
  "/statements"
]);
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml"
};
var MUTATING = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
onPublic("GET", "/api/health", "none", async (ctx) => sendJson(ctx.res, 200, { status: "ok" }));
onPublic("POST", "/api/session", "json", async (ctx) => {
  const { values, errors } = strictBody(ctx.body, {
    email: { kind: "string", message: WRONG_TYPE },
    password: { kind: "string", message: WRONG_TYPE }
  });
  errors.fail();
  const { person, token } = await signIn(values.email, values.password);
  sendJson(ctx.res, 200, userBody(person), { "Set-Cookie": sessionCookie(token) });
});
onPublic("DELETE", "/api/session", "none", async (ctx) => {
  await signOut(ctx.req);
  sendNoContent(ctx.res, { "Set-Cookie": clearedSessionCookie });
});
on("GET", "/api/me", "none", async (ctx) => sendJson(ctx.res, 200, userBody(ctx.person)));
onPublic("GET", "/api/clock", "none", async (ctx) => sendJson(ctx.res, 200, clockBody(await serverNow())));
onPublic("PUT", "/api/clock", "json", async (ctx) => {
  if (!config.clockControl) throw notFound();
  const { values, errors } = strictBody(ctx.body, { now: { kind: "string", message: WRONG_TYPE } });
  const target2 = typeof values.now === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(values.now) ? new Date(values.now) : null;
  if (typeof values.now === "string" && (!target2 || Number.isNaN(target2.getTime()))) errors.add("now", WRONG_TYPE);
  errors.fail();
  await setServerNow(target2);
  sendJson(ctx.res, 200, clockBody(await serverNow()));
});
function sameOrigin(req) {
  const origin = req.headers.origin;
  return origin === void 0 || origin === `http://${req.headers.host ?? ""}` || origin === `https://${req.headers.host ?? ""}`;
}
async function api(req, res, url) {
  const method = req.method ?? "GET";
  if (MUTATING.has(method) && !sameOrigin(req)) {
    throw new ApiError(403, "cross_origin", "Requests must come from Saltprint Desk itself.");
  }
  const found = match(method, url.pathname);
  if (found === null) throw notFound();
  if (found === "method") throw new ApiError(405, "method_not_allowed", "That method isn't allowed here.");
  const { route, params } = found;
  const request2 = { req, res, url, params, body: {}, multipart: { bytes: Buffer.alloc(0), overLimit: false } };
  const type = (req.headers["content-type"] ?? "").toLowerCase();
  if (route.body === "json") {
    const raw = await readBody(req, JSON_LIMIT);
    if (raw.overLimit) throw new ApiError(413, "payload_too_large", "Request bodies may be at most 65,536 bytes.");
    if (MUTATING.has(method) && !/^application\/json\s*(;|$)/.test(type)) {
      throw new ApiError(415, "unsupported_media_type", "Send JSON with Content-Type application/json.");
    }
    request2.body = parseJson(raw.bytes);
  } else if (route.body === "multipart") {
    if (!type.startsWith("multipart/form-data")) {
      throw new ApiError(415, "unsupported_media_type", "Upload frames as multipart/form-data.");
    }
    request2.multipart = await readBody(req, multipartLimit);
  }
  if (!route.auth) {
    await route.handle(request2);
    return;
  }
  const person = await personFromRequest(req);
  if (!person) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  await route.handle({ ...request2, person });
}
async function serveStatic(res, path) {
  const file = APP_PATHS.has(path) ? "index.html" : normalize(path).replace(/^[/\\]+/, "");
  const allowed = file === "index.html" || /^(assets|fonts)\/[\w.-]+$/.test(file);
  if (!allowed || file.includes("..")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  try {
    const bytes = await readFile(join(PUBLIC_DIR, file));
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Cache-Control": file === "index.html" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY"
    });
    res.end(bytes);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}
var server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://saltprint.invalid");
  const path = url.pathname;
  const work = path.startsWith("/api/") || path.startsWith("/media/") ? api(req, res, url) : req.method === "GET" || req.method === "HEAD" ? serveStatic(res, path) : Promise.reject(notFound());
  work.catch((error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    console.error(
      "request failed:",
      error instanceof Error ? error.name : "unknown error",
      error.code ?? ""
    );
    sendError(res, new ApiError(500, "internal_error", "Something went wrong on Saltprint Desk."));
  });
});
server.requestTimeout = 12e4;
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Saltprint Desk listening on port ${config.port}`);
});
function prepare() {
  ensureSchema().catch(() => setTimeout(prepare, 2e3));
}
prepare();
startWorkers();
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
