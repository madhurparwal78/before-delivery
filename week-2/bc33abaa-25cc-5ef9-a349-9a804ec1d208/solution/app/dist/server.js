import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
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
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
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
        var character, parser, quote2;
        this.consumeDimensions();
        while (!this.isEof()) {
          character = this.nextCharacter();
          if (character.value === "{" && !quote2) {
            this.dimension++;
            if (this.dimension > 1) {
              parser = new _ArrayParser(this.source.substr(this.position - 1), this.transform);
              this.entries.push(parser.parse(true));
              this.position += parser.position - 2;
            }
          } else if (character.value === "}" && !quote2) {
            this.dimension--;
            if (!this.dimension) {
              this.newEntry();
              if (nested) return this.entries;
            }
          } else if (character.value === '"' && !character.escaped) {
            if (quote2) this.newEntry(true);
            quote2 = !quote2;
          } else if (character.value === "," && !quote2) {
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
    function is0To99(num2) {
      return num2 >= 0 && num2 < 100;
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
    var BASE2 = 1e6;
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
        carry = high % BASE2;
        high = high / BASE2 >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE2 >>> 0;
        digits = "" + (t - BASE2 * low);
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
        carry = high % BASE2;
        high = high / BASE2 >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE2 >>> 0;
        digits = "" + (t - BASE2 * low);
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
        carry = high % BASE2;
        high = high / BASE2 >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE2 >>> 0;
        digits = "" + (t - BASE2 * low);
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
        carry = high % BASE2;
        t = 4294967296 * carry + low;
        digits = "" + t % BASE2;
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
      var bytes2 = bits + offset >> 3;
      for (var i = offsetBytes + 1; i < bytes2; i++) {
        result = callback(result, inv(data[i]), 8);
      }
      var lastBits = (bits + offset) % 8;
      if (lastBits > 0) {
        result = callback(result, inv(data[bytes2]) >> 8 - lastBits, lastBits);
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
    var user;
    try {
      user = process.platform === "win32" ? process.env.USERNAME : process.env.USER;
    } catch {
    }
    module.exports = {
      // database host. defaults to localhost
      host: "localhost",
      // database user's name
      user,
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
      // SSL negotiation style: 'postgres' (traditional SSLRequest) or 'direct'
      sslnegotiation: void 0,
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
var require_utils = __commonJS({
  "node_modules/pg/lib/utils.js"(exports, module) {
    "use strict";
    var defaults2 = require_defaults();
    var nodeUtils = __require("util");
    var { isDate } = __require("util/types");
    var invalidDateDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Sending an invalid date to Postgres is deprecated and will throw an error in the next major version of pg. Ensure any Date object passed as a query parameter is valid.",
      "PG_INVALID_DATE"
    );
    function escapeElement(elementRepresentation) {
      const escaped = elementRepresentation.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return '"' + escaped + '"';
    }
    function arrayString(val) {
      let result = "{";
      for (let i = 0; i < val.length; i++) {
        if (i > 0) {
          result += ",";
        }
        let item = val[i];
        if (item == null) {
          result += "NULL";
        } else if (Array.isArray(item)) {
          result += arrayString(item);
        } else if (ArrayBuffer.isView(item)) {
          if (!(item instanceof Buffer)) {
            item = Buffer.from(item.buffer, item.byteOffset, item.byteLength);
          }
          result += "\\\\x" + item.toString("hex");
        } else {
          result += escapeElement(prepareValue(item));
        }
      }
      result += "}";
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
          return Buffer.from(val.buffer, val.byteOffset, val.byteLength);
        }
        if (isDate(val)) {
          if (isNaN(val.getTime())) {
            invalidDateDeprecationNotice();
          }
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
    function dateToString(date) {
      let offset = -date.getTimezoneOffset();
      let year = date.getFullYear();
      const isBCYear = year < 1;
      if (isBCYear) year = Math.abs(year) + 1;
      let ret = String(year).padStart(4, "0") + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") + "T" + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0") + "." + String(date.getMilliseconds()).padStart(3, "0");
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
    function dateToStringUTC(date) {
      let year = date.getUTCFullYear();
      const isBCYear = year < 1;
      if (isBCYear) year = Math.abs(year) + 1;
      let ret = String(year).padStart(4, "0") + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0") + "T" + String(date.getUTCHours()).padStart(2, "0") + ":" + String(date.getUTCMinutes()).padStart(2, "0") + ":" + String(date.getUTCSeconds()).padStart(2, "0") + "." + String(date.getUTCMilliseconds()).padStart(3, "0");
      ret += "+00:00";
      if (isBCYear) ret += " BC";
      return ret;
    }
    function normalizeQueryConfig(config2, values, callback) {
      config2 = typeof config2 === "string" ? { text: config2 } : cloneQueryConfig(config2);
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
    function cloneQueryConfig(config2) {
      if (config2 == null) {
        return config2;
      }
      return Object.defineProperties(Object.create(Object.getPrototypeOf(config2)), Object.getOwnPropertyDescriptors(config2));
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

// node_modules/pg/lib/crypto/utils.js
var require_utils2 = __commonJS({
  "node_modules/pg/lib/crypto/utils.js"(exports, module) {
    var nodeCrypto = __require("crypto");
    module.exports = {
      postgresMd5PasswordHash,
      randomBytes: randomBytes5,
      deriveKey,
      sha256: sha2562,
      hashByName,
      hmacSha256,
      md5
    };
    var webCrypto = nodeCrypto.webcrypto || globalThis.crypto;
    var subtleCrypto = webCrypto.subtle;
    var textEncoder = new TextEncoder();
    function randomBytes5(length) {
      return webCrypto.getRandomValues(Buffer.alloc(length));
    }
    async function md5(string) {
      try {
        return nodeCrypto.createHash("md5").update(string, "utf-8").digest("hex");
      } catch (e) {
        const data = typeof string === "string" ? textEncoder.encode(string) : string;
        const hash = await subtleCrypto.digest("MD5", data);
        return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    }
    async function postgresMd5PasswordHash(user, password, salt) {
      const inner = await md5(password + user);
      const outer = await md5(Buffer.concat([Buffer.from(inner), salt]));
      return "md5" + outer;
    }
    async function sha2562(text) {
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

// node_modules/pg/lib/crypto/cert-signatures.js
var require_cert_signatures = __commonJS({
  "node_modules/pg/lib/crypto/cert-signatures.js"(exports, module) {
    function x509Error(msg, cert) {
      return new Error("SASL channel binding: " + msg + " when parsing public certificate " + cert.toString("base64"));
    }
    function readASN1Length(data, index) {
      let length = data[index++];
      if (length < 128) return { length, index };
      const lengthBytes = length & 127;
      if (lengthBytes > 4) throw x509Error("bad length", data);
      length = 0;
      for (let i = 0; i < lengthBytes; i++) {
        length = length << 8 | data[index++];
      }
      return { length, index };
    }
    function readASN1OID(data, index) {
      if (data[index++] !== 6) throw x509Error("non-OID data", data);
      const { length: OIDLength, index: indexAfterOIDLength } = readASN1Length(data, index);
      index = indexAfterOIDLength;
      const lastIndex = index + OIDLength;
      const byte1 = data[index++];
      let oid = (byte1 / 40 >> 0) + "." + byte1 % 40;
      while (index < lastIndex) {
        let value = 0;
        while (index < lastIndex) {
          const nextByte = data[index++];
          value = value << 7 | nextByte & 127;
          if (nextByte < 128) break;
        }
        oid += "." + value;
      }
      return { oid, index };
    }
    function expectASN1Seq(data, index) {
      if (data[index++] !== 48) throw x509Error("non-sequence data", data);
      return readASN1Length(data, index);
    }
    function signatureAlgorithmHashFromCertificate(data, index) {
      if (index === void 0) index = 0;
      index = expectASN1Seq(data, index).index;
      const { length: certInfoLength, index: indexAfterCertInfoLength } = expectASN1Seq(data, index);
      index = indexAfterCertInfoLength + certInfoLength;
      index = expectASN1Seq(data, index).index;
      const { oid, index: indexAfterOID } = readASN1OID(data, index);
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
          index = indexAfterOID;
          index = expectASN1Seq(data, index).index;
          if (data[index++] !== 160) throw x509Error("non-tag data", data);
          index = readASN1Length(data, index).index;
          index = expectASN1Seq(data, index).index;
          const { oid: hashOID } = readASN1OID(data, index);
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
        // Ed25519 -- see https://github.com/openssl/openssl/issues/15477
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
    var crypto = require_utils2();
    var { signatureAlgorithmHashFromCertificate } = require_cert_signatures();
    function saslprep(password) {
      const nonAsciiSpace = /[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g;
      const mappedToNothing = /[\u00AD\u034F\u1806\u180B\u180C\u180D\u200C\u200D\u2060\uFE00-\uFE0F\uFEFF]/g;
      return password.replace(nonAsciiSpace, " ").replace(mappedToNothing, "").normalize("NFKC");
    }
    var DEFAULT_MAX_SCRAM_ITERATIONS = 1e5;
    function startSession2(mechanisms, stream, scramMaxIterations = DEFAULT_MAX_SCRAM_ITERATIONS) {
      const candidates = ["SCRAM-SHA-256"];
      if (stream) candidates.unshift("SCRAM-SHA-256-PLUS");
      const mechanism = candidates.find((candidate) => mechanisms.includes(candidate));
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
        message: "SASLInitialResponse",
        scramMaxIterations
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
      const scramMaxIterations = typeof session.scramMaxIterations === "number" ? session.scramMaxIterations : DEFAULT_MAX_SCRAM_ITERATIONS;
      if (scramMaxIterations !== 0 && sv.iteration > scramMaxIterations) {
        throw new Error(
          "SASL: SCRAM-SERVER-FIRST-MESSAGE: iteration count " + sv.iteration + " exceeds scramMaxIterations of " + scramMaxIterations
        );
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
      const saltedPassword = await crypto.deriveKey(saslprep(password), saltBytes, sv.iteration);
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
      const error = attrPairs.get("e");
      const serverSignature = attrPairs.get("v");
      if (error) {
        throw new Error(`SASL: SCRAM-SERVER-FINAL-MESSAGE: server returned error: "${error}"`);
      }
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
      startSession: startSession2,
      continueSession,
      finalizeSession,
      DEFAULT_MAX_SCRAM_ITERATIONS
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
      if (config2[key]) {
        return config2[key];
      }
      if (envVar === void 0) {
        envVar = process.env["PG" + key.toUpperCase()];
      } else if (envVar === false) {
      } else {
        envVar = process.env[envVar];
      }
      return envVar || defaults2[key];
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
        this.sslnegotiation = val("sslnegotiation", config2, "PGSSLNEGOTIATION");
        if (this.sslnegotiation !== void 0 && this.sslnegotiation !== "postgres" && this.sslnegotiation !== "direct") {
          throw new Error(
            `Invalid sslnegotiation value: "${this.sslnegotiation}". Valid values are "postgres" and "direct".`
          );
        }
        if (this.sslnegotiation === "direct" && !this.ssl) {
          throw new Error("sslnegotiation=direct requires SSL to be enabled");
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
        add(params, this, "sslnegotiation");
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
        let match2;
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
        const row = /* @__PURE__ */ Object.create(null);
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
    var utils = require_utils();
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
        const previous = connection.parsedStatements[this.name] || connection.submittedNamedStatements[this.name];
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
        return this.name && (connection.parsedStatements[this.name] !== void 0 || connection.submittedNamedStatements[this.name] !== void 0);
      }
      handlePortalSuspended(connection) {
        this._getRows(connection, this.rows);
      }
      _getRows(connection, rows2) {
        connection.execute({
          portal: this.portal,
          rows: rows2
        });
        if (!rows2) {
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
          if (this.name) {
            connection.submittedNamedStatements[this.name] = this.text;
          }
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
          connection.close({ type: "S", name: this.name });
          connection.sync();
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
      constructor(message2, length, name) {
        super(message2);
        this.length = length;
        this.name = name;
      }
    };
    exports.DatabaseError = DatabaseError2;
    var CopyDataMessage = class {
      constructor(length, chunk) {
        this.length = length;
        this.chunk = chunk;
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
      constructor(length, message2) {
        this.length = length;
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
      addInt32(num2) {
        this.ensure(4);
        this.buffer[this.offset++] = num2 >>> 24 & 255;
        this.buffer[this.offset++] = num2 >>> 16 & 255;
        this.buffer[this.offset++] = num2 >>> 8 & 255;
        this.buffer[this.offset++] = num2 >>> 0 & 255;
        return this;
      }
      addInt16(num2) {
        this.ensure(2);
        this.buffer[this.offset++] = num2 >>> 8 & 255;
        this.buffer[this.offset++] = num2 >>> 0 & 255;
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
      const rows2 = config2.rows || 0;
      const portalLength = Buffer.byteLength(portal);
      const len = 4 + portalLength + 1 + 4;
      const buff = Buffer.allocUnsafe(1 + len);
      buff[0] = 69;
      buff.writeInt32BE(len, 1);
      buff.write(portal, 5, "utf-8");
      buff[portalLength + 5] = 0;
      buff.writeUInt32BE(rows2, buff.length - 4);
      return buff;
    };
    var cancel2 = (processID, secretKey) => {
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
      cancel: cancel2
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
            const message2 = this.handlePacket(offset + HEADER_LENGTH, code, length, this.buffer);
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
      handlePacket(offset, code, length, bytes2) {
        const { reader } = this;
        reader.setBuffer(offset, bytes2);
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
            message2 = parseAuthenticationResponse(reader, length);
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
            message2 = parseCopyData(reader, length);
            break;
          default:
            return new messages_1.DatabaseError("received invalid response: " + code.toString(16), length, "error");
        }
        reader.setBuffer(0, emptyBuffer);
        message2.length = length;
        return message2;
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
      const chunk = reader.bytes(length - 4);
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
    var parseAuthenticationResponse = (reader, length) => {
      const code = reader.int32();
      const message2 = {
        name: "authenticationOk",
        length
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
          message2.data = reader.string(length - 8);
          break;
        case 12:
          message2.name = "authenticationSASLFinal";
          message2.data = reader.string(length - 8);
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
    var stream = require_stream();
    var { getStream } = stream;
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
        this.parsedStatements = {};
        this.submittedNamedStatements = {};
        this.ssl = config2.ssl || false;
        this.sslNegotiation = config2.sslNegotiation || "postgres";
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
        if (this.sslNegotiation === "direct") {
          return this.stream.once("connect", function() {
            self.upgradeToSSL(host, reportStreamError);
          });
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
          self.upgradeToSSL(host, reportStreamError);
        });
      }
      upgradeToSSL(host, reportStreamError) {
        const self = this;
        const options = {
          socket: self.stream,
          // tls.connect checks the server identity against `servername`, falling
          // back to `host` and then to 'localhost'. `servername` must stay unset
          // for IP addresses (see below), so `host` is needed to keep certificate
          // validation working when connecting to an IP address.
          host
        };
        if (self.ssl !== true) {
          Object.assign(options, self.ssl);
          if ("key" in self.ssl) {
            options.key = self.ssl.key;
          }
        }
        if (self.sslNegotiation === "direct") {
          options.ALPNProtocols = ["postgresql"];
        }
        const net = __require("net");
        if (net.isIP && net.isIP(host) === 0) {
          options.servername = host;
        }
        try {
          self.stream = stream.getSecureStream(options);
        } catch (err) {
          return self.emit("error", err);
        }
        self.attachListeners(self.stream);
        self.stream.on("error", reportStreamError);
        self.emit("sslconnect");
      }
      attachListeners(stream2) {
        parse(stream2, (msg) => {
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
    module.exports = Connection2;
  }
});

// node_modules/split2/index.js
var require_split2 = __commonJS({
  "node_modules/split2/index.js"(exports, module) {
    "use strict";
    var { Transform } = __require("stream");
    var { StringDecoder } = __require("string_decoder");
    var kLast = /* @__PURE__ */ Symbol("last");
    var kDecoder = /* @__PURE__ */ Symbol("decoder");
    function transform(chunk, enc, cb) {
      let list2;
      if (this.overflow) {
        const buf = this[kDecoder].write(chunk);
        list2 = buf.split(this.matcher);
        if (list2.length === 1) return cb();
        list2.shift();
        this.overflow = false;
      } else {
        this[kLast] += this[kDecoder].write(chunk);
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
      var env = rawEnv || process.env;
      var file = env.PGPASSFILE || (isWin ? path.join(env.APPDATA || "./", "postgresql", "pgpass.conf") : path.join(env.HOME || "./", ".pgpass"));
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
      var pass2;
      var lineStream = stream.pipe(split());
      function onLine(line) {
        var entry = parseLine(line);
        if (entry && isValidEntry(entry) && matcher(connInfo, entry)) {
          pass2 = entry[passKey];
          lineStream.end();
        }
      }
      var onEnd = function() {
        stream.destroy();
        cb(pass2);
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

// node_modules/pg/lib/client.js
var require_client = __commonJS({
  "node_modules/pg/lib/client.js"(exports, module) {
    var EventEmitter = __require("events").EventEmitter;
    var utils = require_utils();
    var nodeUtils = __require("util");
    var sasl = require_sasl();
    var TypeOverrides2 = require_type_overrides();
    var ConnectionParameters = require_connection_parameters();
    var Query2 = require_query();
    var defaults2 = require_defaults();
    var Connection2 = require_connection();
    var crypto = require_utils2();
    var activeQueryDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Client.activeQuery is deprecated and will be removed in pg@9.0"
    );
    var queryQueueDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Client.queryQueue is deprecated and will be removed in pg@9.0."
    );
    var pgPassDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "pgpass support is deprecated and will be removed in pg@9.0. You can provide an async function as the password property to the Client/Pool constructor that returns a password instead. Within this function you can call the pgpass module in your own code."
    );
    var byoPromiseDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Passing a custom Promise implementation to the Client/Pool constructor is deprecated and will be removed in pg@9.0."
    );
    var queryQueueLengthDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead."
    );
    function coerceNumberOrDefault(value, defaultValue) {
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : defaultValue;
      }
      if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        return Number.isFinite(n) ? n : defaultValue;
      }
      return defaultValue;
    }
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
        if (c.Promise) {
          byoPromiseDeprecationNotice();
        }
        this._Promise = c.Promise || global.Promise;
        this._types = new TypeOverrides2(c.types);
        this._ending = false;
        this._ended = false;
        this._connecting = false;
        this._connected = false;
        this._connectionError = false;
        this._queryable = true;
        this._activeQuery = null;
        this._txStatus = null;
        this.enableChannelBinding = Boolean(c.enableChannelBinding);
        this.scramMaxIterations = coerceNumberOrDefault(c.scramMaxIterations, sasl.DEFAULT_MAX_SCRAM_ITERATIONS);
        this.connection = c.connection || new Connection2({
          stream: c.stream,
          ssl: this.connectionParameters.ssl,
          sslNegotiation: this.connectionParameters.sslnegotiation,
          keepAlive: c.keepAlive || false,
          keepAliveInitialDelayMillis: c.keepAliveInitialDelayMillis || 0,
          encoding: this.connectionParameters.client_encoding || "utf8"
        });
        this._queryQueue = [];
        this._sentQueryQueue = [];
        this.pipeline = Boolean(c.pipeline);
        this.binary = c.binary || defaults2.binary;
        this.processID = null;
        this.secretKey = null;
        this.ssl = this.connectionParameters.ssl || false;
        this.sslNegotiation = this.connectionParameters.sslnegotiation || "postgres";
        if (this.ssl && this.ssl.key) {
          Object.defineProperty(this.ssl, "key", {
            enumerable: false
          });
        }
        this._connectionTimeoutMillis = c.connectionTimeoutMillis || 0;
      }
      get activeQuery() {
        activeQueryDeprecationNotice();
        return this._activeQuery;
      }
      set activeQuery(val) {
        activeQueryDeprecationNotice();
        this._activeQuery = val;
      }
      _getActiveQuery() {
        return this._activeQuery;
      }
      _errorAllQueries(err) {
        const enqueueError = (query) => {
          process.nextTick(() => {
            query.handleError(err, this.connection);
          });
        };
        const activeQuery = this._getActiveQuery();
        if (activeQuery) {
          enqueueError(activeQuery);
          this._activeQuery = null;
        }
        this._sentQueryQueue.forEach(enqueueError);
        this._sentQueryQueue.length = 0;
        this._queryQueue.forEach(enqueueError);
        this._queryQueue.length = 0;
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
            if (self.sslNegotiation !== "direct") {
              con.requestSsl();
            }
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
        return new this._Promise((resolve, reject) => {
          this._connect((error) => {
            if (error) {
              reject(error);
            } else {
              resolve(this);
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
      _getPassword(cb) {
        const con = this.connection;
        if (typeof this.password === "function") {
          this._Promise.resolve().then(() => this.password(this.connectionParameters)).then((pass2) => {
            if (pass2 !== void 0) {
              if (typeof pass2 !== "string") {
                con.emit("error", new TypeError("Password must be a string"));
                return;
              }
              this.connectionParameters.password = this.password = pass2;
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
            const pgPass = require_lib();
            pgPass(this.connectionParameters, (pass2) => {
              if (void 0 !== pass2) {
                pgPassDeprecationNotice();
                this.connectionParameters.password = this.password = pass2;
              }
              cb();
            });
          } catch (e) {
            this.emit("error", e);
          }
        }
      }
      _handleAuthCleartextPassword(msg) {
        this._getPassword(() => {
          this.connection.password(this.password);
        });
      }
      _handleAuthMD5Password(msg) {
        this._getPassword(async () => {
          try {
            const hashedPassword = await crypto.postgresMd5PasswordHash(this.user, this.password, msg.salt);
            this.connection.password(hashedPassword);
          } catch (e) {
            this.emit("error", e);
          }
        });
      }
      _handleAuthSASL(msg) {
        this._getPassword(() => {
          try {
            this.saslSession = sasl.startSession(
              msg.mechanisms,
              this.enableChannelBinding && this.connection.stream,
              this.scramMaxIterations
            );
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
        const activeQuery = this._getActiveQuery();
        this._activeQuery = null;
        this._txStatus = msg?.status ?? null;
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
        const activeQuery = this._getActiveQuery();
        if (!activeQuery) {
          this._handleErrorEvent(msg);
          return;
        }
        this._activeQuery = null;
        if (activeQuery.name) {
          delete this.connection.submittedNamedStatements[activeQuery.name];
        }
        activeQuery.handleError(msg, this.connection);
      }
      _handleRowDescription(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected rowDescription message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleRowDescription(msg);
      }
      _handleDataRow(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected dataRow message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleDataRow(msg);
      }
      _handlePortalSuspended(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected portalSuspended message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handlePortalSuspended(this.connection);
      }
      _handleEmptyQuery(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected emptyQuery message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleEmptyQuery(this.connection);
      }
      _handleCommandComplete(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected commandComplete message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleCommandComplete(msg, this.connection);
      }
      _handleParseComplete() {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected parseComplete message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        if (activeQuery.name) {
          this.connection.parsedStatements[activeQuery.name] = activeQuery.text;
          delete this.connection.submittedNamedStatements[activeQuery.name];
        }
      }
      _handleCopyInResponse(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected copyInResponse message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleCopyInResponse(this.connection);
      }
      _handleCopyData(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected copyData message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleCopyData(msg, this.connection);
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
      cancel(client, query) {
        if (client.activeQuery === query) {
          const con = this.connection;
          if (this.host && this.host.indexOf("/") === 0) {
            con.connect(this.host + "/.s.PGSQL." + this.port);
          } else {
            con.connect(this.port, this.host);
          }
          con.on("connect", function() {
            con.cancel(client.processID, client.secretKey);
          });
        } else if (client._queryQueue.indexOf(query) !== -1) {
          client._queryQueue.splice(client._queryQueue.indexOf(query), 1);
        } else if (client._sentQueryQueue.indexOf(query) !== -1) {
          query.callback = () => {
          };
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
        if (this.pipeline) {
          this._pulsePipelinedQueryQueue();
          return;
        }
        if (this.readyForQuery === true) {
          this._activeQuery = this._queryQueue.shift();
          const activeQuery = this._getActiveQuery();
          if (activeQuery) {
            this.readyForQuery = false;
            this.hasExecuted = true;
            const queryError = activeQuery.submit(this.connection);
            if (queryError) {
              process.nextTick(() => {
                activeQuery.handleError(queryError, this.connection);
                this.readyForQuery = true;
                this._pulseQueryQueue();
              });
            }
          } else if (this.hasExecuted) {
            this._activeQuery = null;
            this.emit("drain");
          }
        }
      }
      _pulsePipelinedQueryQueue() {
        if (!this._connected || !this._queryable) {
          return;
        }
        while (this._queryQueue.length > 0) {
          const query = this._queryQueue.shift();
          this.hasExecuted = true;
          const queryError = query.submit(this.connection);
          if (queryError) {
            process.nextTick(() => {
              query.handleError(queryError, this.connection);
            });
            continue;
          }
          this._sentQueryQueue.push(query);
        }
        if (this.readyForQuery && !this._activeQuery && this._sentQueryQueue.length > 0) {
          this._activeQuery = this._sentQueryQueue.shift();
          this.readyForQuery = false;
        }
        if (!this._activeQuery && this._sentQueryQueue.length === 0 && this._queryQueue.length === 0 && this.hasExecuted) {
          this.emit("drain");
        }
      }
      query(config2, values, callback) {
        let query;
        let result;
        if (config2 == null) {
          throw new TypeError("Client was passed a null or undefined query");
        }
        if (typeof config2.submit === "function") {
          result = query = config2;
          if (!query.callback) {
            if (typeof values === "function") {
              query.callback = values;
            } else if (callback) {
              query.callback = callback;
            }
          }
        } else {
          query = new Query2(config2, values, callback);
          if (!query.callback) {
            result = new this._Promise((resolve, reject) => {
              query.callback = (err, res) => err ? reject(err) : resolve(res);
            }).catch((err) => {
              Error.captureStackTrace(err);
              throw err;
            });
          } else if (typeof query.callback !== "function") {
            throw new TypeError("callback is not a function");
          }
        }
        const readTimeout = config2.query_timeout || this.connectionParameters.query_timeout;
        if (readTimeout) {
          const queryCallback = query.callback || (() => {
          });
          const readTimeoutTimer = setTimeout(() => {
            const error = new Error("Query read timeout");
            process.nextTick(() => {
              query.handleError(error, this.connection);
            });
            queryCallback(error);
            query.callback = () => {
            };
            const index = this._queryQueue.indexOf(query);
            if (index > -1) {
              this._queryQueue.splice(index, 1);
            } else if (this.pipeline) {
              this.connection.stream.destroy();
              return;
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
        if (this.pipeline) {
          const portalQuery = typeof config2.submit === "function" && !(query instanceof Query2) ? "Custom query classes such as pg-cursor and pg-query-stream are" : query.rows ? "The `rows` option is" : null;
          if (portalQuery) {
            process.nextTick(() => {
              query.handleError(new Error(`${portalQuery} not supported in pipeline mode`), this.connection);
            });
            return result;
          }
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
        if (this._queryQueue.length > 0 && !this.pipeline) {
          queryQueueLengthDeprecationNotice();
        }
        this._queryQueue.push(query);
        this._pulseQueryQueue();
        return result;
      }
      ref() {
        this.connection.ref();
      }
      unref() {
        this.connection.unref();
      }
      getTransactionStatus() {
        return this._txStatus;
      }
      end(cb) {
        this._ending = true;
        if (!this.connection._connecting || this._ended) {
          if (cb) {
            cb();
            return;
          } else {
            return this._Promise.resolve();
          }
        }
        if (!this._queryable) {
          this.connection.stream.destroy();
        } else if (this.pipeline && (this._getActiveQuery() || this._sentQueryQueue.length > 0 || this._queryQueue.length > 0)) {
          this.once("drain", () => this.connection.end());
        } else if (this._getActiveQuery()) {
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
      get queryQueue() {
        queryQueueDeprecationNotice();
        return this._queryQueue;
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
        this.Client = this.options.Client || Client2 || require_lib2().Client;
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
    module.exports = Pool2;
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
      messageDetail: "detail",
      messageHint: "hint",
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
      const fields = this.native && this.native.pq.resultErrorFields();
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
        function(resolve, reject) {
          this._once("end", resolve);
          this._once("error", reject);
        }.bind(this)
      );
      return this._promise;
    };
    NativeQuery.prototype.submit = function(client) {
      this.state = "running";
      const self = this;
      this.native = client.native;
      client.native.arrayMode = this._arrayMode;
      let after = function(err, rows2, results) {
        client.native.arrayMode = false;
        setImmediate(function() {
          self.emit("_done");
        });
        if (err) {
          return self.handleError(err);
        }
        if (self._emitRowEvents) {
          if (results.length > 1) {
            rows2.forEach((rowOfRows, i) => {
              rowOfRows.forEach((row) => {
                self.emit("row", row, results[i]);
              });
            });
          } else {
            rows2.forEach(function(row) {
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
        if (client.namedQueries[this.name] !== void 0) {
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
        const vals = this.values.map(utils.prepareValue);
        client.native.query(this.text, vals, after);
      } else if (this.queryMode === "extended") {
        client.native.query(this.text, [], after);
      } else {
        client.native.query(this.text, after);
      }
    };
  }
});

// node_modules/pg/lib/native/client.js
var require_client2 = __commonJS({
  "node_modules/pg/lib/native/client.js"(exports, module) {
    var nodeUtils = __require("util");
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
    var queryQueueLengthDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead."
    );
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
      this.pipeline = Boolean(config2.pipeline);
      this._pipelineInFlight = false;
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
          cb(null, this);
        });
      });
    };
    Client2.prototype.connect = function(callback) {
      if (callback) {
        this._connect(callback);
        return;
      }
      return new this._Promise((resolve, reject) => {
        this._connect((error) => {
          if (error) {
            reject(error);
          } else {
            resolve(this);
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
          result = new this._Promise((resolve, reject) => {
            resolveOut = resolve;
            rejectOut = reject;
          }).catch((err) => {
            Error.captureStackTrace(err);
            throw err;
          });
          query.callback = (err, res) => err ? rejectOut(err) : resolveOut(res);
        }
      }
      if (readTimeout) {
        queryCallback = query.callback || (() => {
        });
        readTimeoutTimer = setTimeout(() => {
          const error = new Error("Query read timeout");
          process.nextTick(() => {
            query.handleError(error, this.connection);
          });
          queryCallback(error);
          query.callback = () => {
          };
          const index = this._queryQueue.indexOf(query);
          if (index > -1) {
            this._queryQueue.splice(index, 1);
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
      if (this._queryQueue.length > 0 && !this.pipeline) {
        queryQueueLengthDeprecationNotice();
      }
      this._queryQueue.push(query);
      this._pulseQueryQueue();
      return result;
    };
    Client2.prototype.end = function(cb) {
      const self = this;
      this._ending = true;
      if (this._connecting && !this._connected) {
        this.once("connect", () => {
          this.end(() => {
          });
        });
      }
      let result;
      if (!cb) {
        result = new this._Promise(function(resolve, reject) {
          cb = (err) => err ? reject(err) : resolve();
        });
      }
      const doEnd = function() {
        self.native.end(function() {
          self._connected = false;
          self._errorAllQueries(new Error("Connection terminated"));
          process.nextTick(() => {
            self.emit("end");
            if (cb) cb();
          });
        });
      };
      if (this.pipeline && (this._pipelineInFlight || this._queryQueue.length > 0)) {
        this.once("drain", doEnd);
      } else {
        doEnd();
      }
      return result;
    };
    Client2.prototype._hasActiveQuery = function() {
      return this._activeQuery && this._activeQuery.state !== "error" && this._activeQuery.state !== "end";
    };
    Client2.prototype._pulseQueryQueue = function(initialConnection) {
      if (!this._connected) {
        return;
      }
      if (this.pipeline && !initialConnection) {
        return this._pulsePipelinedQueryQueue();
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
    Client2.prototype._pulsePipelinedQueryQueue = function() {
      if (!this._connected || this._pipelineInFlight) {
        return;
      }
      if (this._queryQueue.length === 0) {
        if (this.hasExecuted) {
          this.emit("drain");
        }
        return;
      }
      this._pipelineInFlight = true;
      const self = this;
      const queries = [];
      const nativeQueries = [];
      const utils = require_utils();
      while (this._queryQueue.length > 0) {
        const query = this._queryQueue.shift();
        this.hasExecuted = true;
        nativeQueries.push(query);
        const values = query.values ? query.values.map(utils.prepareValue) : null;
        const pipelineEntry = { text: query.text, name: query.name, arrayMode: query._arrayMode };
        if (values) {
          pipelineEntry.values = values;
        }
        if (query.name && this.namedQueries[query.name]) {
          pipelineEntry._alreadyPrepared = true;
        }
        queries.push(pipelineEntry);
      }
      this.native.pipeline(queries, function(err, results) {
        self._pipelineInFlight = false;
        if (err) {
          self._connected = false;
          self._queryable = false;
          for (let i = 0; i < nativeQueries.length; i++) {
            const q = nativeQueries[i];
            q.native = self.native;
            q.handleError(err);
          }
          self._errorAllQueries(err);
          self.emit("error", err);
          self.emit("end");
          return;
        }
        for (let i = 0; i < nativeQueries.length; i++) {
          const q = nativeQueries[i];
          const r = results[i];
          q.native = self.native;
          if (r.err) {
            q.handleError(r.err);
          } else {
            if (q.name) {
              self.namedQueries[q.name] = q.text;
            }
            q.state = "end";
            q.emit("end", r.result);
            if (q.callback) {
              q.callback(null, r.result);
            }
          }
          setImmediate(function() {
            q.emit("_done");
          });
        }
        self._pulsePipelinedQueryQueue();
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
    Client2.prototype.isConnected = function() {
      return this._connected;
    };
    Client2.prototype.getTransactionStatus = function() {
      return this.native.getTransactionStatus();
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
    var Client2 = require_client();
    var defaults2 = require_defaults();
    var Connection2 = require_connection();
    var Result2 = require_result();
    var utils = require_utils();
    var Pool2 = require_pg_pool();
    var TypeOverrides2 = require_type_overrides();
    var { DatabaseError: DatabaseError2 } = require_dist();
    var { escapeIdentifier: escapeIdentifier2, escapeLiteral: escapeLiteral2 } = require_utils();
    var poolFactory = (Client3) => {
      return class BoundPool extends Pool2 {
        constructor(options) {
          super(options, Client3);
        }
      };
    };
    var PG = function(clientConstructor2) {
      this.defaults = defaults2;
      this.Client = clientConstructor2;
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
    var clientConstructor = Client2;
    var forceNative = false;
    try {
      forceNative = !!process.env.NODE_PG_FORCE_NATIVE;
    } catch {
    }
    if (forceNative) {
      clientConstructor = require_native();
    }
    module.exports = new PG(clientConstructor);
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
});

// server/main.ts
import { createServer } from "node:http";

// server/config.ts
function required(name) {
  const value = process.env[name];
  if (value === void 0 || value.trim() === "") throw new Error(`Environment variable ${name} is required`);
  return value;
}
function seconds(name, fallback2) {
  const raw = process.env[name];
  if (raw === void 0 || raw.trim() === "") return fallback2;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Environment variable ${name} must be a positive number of seconds`);
  return value;
}
var port = Number(process.env.APP_PUBLIC_PORT ?? "4173");
var config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  pocketbase: {
    url: required("POCKETBASE_URL").replace(/\/+$/, ""),
    email: required("POCKETBASE_ADMIN_EMAIL"),
    password: required("POCKETBASE_ADMIN_PASSWORD")
  },
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY")
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET")
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")) },
  mailFrom: process.env.MAIL_FROM ?? "Orrery Studio <studio@orrery-labs.test>",
  trialLengthSeconds: seconds("TRIAL_LENGTH_SECONDS", 1209600),
  dunningDaySeconds: seconds("DUNNING_DAY_SECONDS", 86400),
  tokenWarningLeadSeconds: seconds("TOKEN_WARNING_LEAD_SECONDS", 86400)
};

// node_modules/pg/esm/index.mjs
var import_lib = __toESM(require_lib2(), 1);
var Client = import_lib.default.Client;
var Pool = import_lib.default.Pool;
var Connection = import_lib.default.Connection;
var types = import_lib.default.types;
var Query = import_lib.default.Query;
var DatabaseError = import_lib.default.DatabaseError;
var escapeIdentifier = import_lib.default.escapeIdentifier;
var escapeLiteral = import_lib.default.escapeLiteral;
var Result = import_lib.default.Result;
var TypeOverrides = import_lib.default.TypeOverrides;
var defaults = import_lib.default.defaults;
var esm_default = import_lib.default;

// server/db.ts
esm_default.types.setTypeParser(esm_default.types.builtins.INT8, Number);
var pool = new esm_default.Pool({ connectionString: config.databaseUrl, max: 24, connectionTimeoutMillis: 1e4 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));
async function rows(db, sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function one(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function withAdvisoryLock(name, work) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [name]);
    try {
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [name]);
    }
  } finally {
    client.release();
  }
}
var SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY, name text NOT NULL, time_zone text NOT NULL,
  review_links_enabled boolean NOT NULL DEFAULT true, signing_secret text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL, email text NOT NULL,
  password_hash text NOT NULL, role text NOT NULL, joined_at timestamptz NOT NULL, removed_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS members_active_email ON members (lower(email)) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS members_workspace ON members (workspace_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, member_id text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL, ended_at timestamptz);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), email text NOT NULL, role text NOT NULL,
  token_hash text NOT NULL UNIQUE, invited_by_kind text NOT NULL, invited_by_id text NOT NULL, invited_by_name text NOT NULL,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS agent_tokens (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL, scope text NOT NULL,
  secret_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  issued_by_id text NOT NULL, issued_by_name text NOT NULL, created_at timestamptz NOT NULL,
  warn_at timestamptz NOT NULL, warned_at timestamptz);
CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id), state text NOT NULL, plan text NOT NULL, period text NOT NULL,
  extra_seats integer NOT NULL DEFAULT 0, trial_ends_at timestamptz, suspended_by text,
  failed_at timestamptz, dunning_day3_at timestamptz, dunning_day3_sent boolean NOT NULL DEFAULT false, grace_ends_at timestamptz,
  pending_change jsonb, kb_account_id text, card_last4 text);
CREATE TABLE IF NOT EXISTS scenes (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL,
  base_graph jsonb NOT NULL, graph jsonb NOT NULL, latest_seq integer NOT NULL DEFAULT 0, embed_id text UNIQUE,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS scenes_workspace ON scenes (workspace_id);
CREATE TABLE IF NOT EXISTS ops (
  scene_id text NOT NULL REFERENCES scenes(id), seq integer NOT NULL, batch_id text NOT NULL, type text NOT NULL,
  payload jsonb NOT NULL, inverse jsonb NOT NULL, author_kind text NOT NULL, author_id text NOT NULL, author_name text NOT NULL,
  created_at timestamptz NOT NULL, undo_of text, redo_of text, restore_to integer, PRIMARY KEY (scene_id, seq));
CREATE INDEX IF NOT EXISTS ops_author ON ops (scene_id, author_kind, author_id, seq);
CREATE INDEX IF NOT EXISTS ops_batch ON ops (batch_id);
CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY, scene_id text NOT NULL REFERENCES scenes(id), workspace_id text NOT NULL, number integer NOT NULL,
  label text NOT NULL, state text NOT NULL, seq integer NOT NULL, created_by_kind text NOT NULL, created_by_id text NOT NULL,
  created_by_name text NOT NULL, publish_at timestamptz, published_at timestamptz, scheduled_by text,
  has_thumbnail boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL, UNIQUE (scene_id, number));
CREATE TABLE IF NOT EXISTS approvals (
  version_id text NOT NULL REFERENCES versions(id), member_id text NOT NULL, member_name text NOT NULL,
  at timestamptz NOT NULL, PRIMARY KEY (version_id, member_id));
CREATE TABLE IF NOT EXISTS review_links (
  id text PRIMARY KEY, workspace_id text NOT NULL, version_id text NOT NULL REFERENCES versions(id),
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_by_kind text NOT NULL, created_by_id text NOT NULL, created_by_name text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), kind text NOT NULL, name text NOT NULL,
  bytes bigint NOT NULL, content_type text NOT NULL, uploaded_by_kind text NOT NULL, uploaded_by_id text NOT NULL,
  uploaded_by_name text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY, workspace_id text NOT NULL, version_id text NOT NULL REFERENCES versions(id),
  bytes bigint NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS audit_entries (
  id bigserial PRIMARY KEY, workspace_id text NOT NULL, at timestamptz NOT NULL, actor_kind text NOT NULL,
  actor_id text NOT NULL, actor_name text NOT NULL, action text NOT NULL, target_type text NOT NULL, target_id text NOT NULL);
CREATE INDEX IF NOT EXISTS audit_workspace ON audit_entries (workspace_id, at DESC, id DESC);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, status integer, body text,
  created_at timestamptz NOT NULL, PRIMARY KEY (workspace_id, key));
CREATE TABLE IF NOT EXISTS webhook_events (
  workspace_id text NOT NULL, event_id text NOT NULL, body_hash text NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, event_id));
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY, workspace_id text NOT NULL, invoice_id text NOT NULL, invoice_number text NOT NULL, amount_cents bigint NOT NULL,
  refunded_cents bigint NOT NULL DEFAULT 0, charged_back boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS invoice_documents (
  invoice_id text PRIMARY KEY, workspace_id text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY, recipients jsonb NOT NULL, from_name text NOT NULL, subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL, sent_at timestamptz);
CREATE INDEX IF NOT EXISTS mail_outbox_unsent ON mail_outbox (id) WHERE sent_at IS NULL;
`;
async function applySchema() {
  await withAdvisoryLock("orrery:schema", async () => {
    await pool.query(SCHEMA);
  });
}

// shared/format.ts
var formats = /* @__PURE__ */ new Map();
function parts(instant, timeZone) {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    formats.set(timeZone, format);
  }
  return Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
}
function localTime(iso, timeZone) {
  return `${wallClock(iso, timeZone)} (${timeZone})`;
}
function wallClock(iso, timeZone) {
  const p = parts(new Date(iso), timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
function dollars(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}
function isoSecond(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// shared/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const bitLength = data.length * 8;
  const padded = new Uint8Array(data.length + 9 + 63 >> 6 << 6);
  padded.set(data);
  padded[data.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 4294967296));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const h = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a2 = w[i - 15], b2 = w[i - 2];
      const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
      const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const t1 = hh + s1 + (e & f ^ ~e & g) + K[i] + w[i] >>> 0;
      const s0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const t2 = s0 + (a & b ^ a & c ^ b & c) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

// shared/graph.ts
var NODE_KINDS = ["group", "mesh", "camera", "light"];
var PRIMITIVES = ["box", "sphere", "cylinder", "plane"];
var LAYER_TYPES = ["base", "clearcoat", "sheen", "emission"];
var OVERRIDE_FIELDS = ["position", "rotation", "scale", "visible"];
var TRIGGERS = ["hover", "click", "scroll"];
var OPERATION_TYPES = [
  "node.add",
  "node.remove",
  "node.rename",
  "node.reparent",
  "transform.set",
  "material.layer.add",
  "material.layer.set",
  "material.layer.remove",
  "state.add",
  "state.remove",
  "state.override.set",
  "transition.set",
  "camera.view.set"
];
var REST_STATE = "rest";
var MAX_LAYERS = 8;
var MAX_BATCH = 200;
var DURATION_MAX_MS = 2e3;
var FOV_RANGE = [10, 120];
var TRANSFORM_RANGES = {
  position: [-1e3, 1e3],
  rotation: [-360, 360],
  scale: [1e-3, 1e3]
};
var ID_PATTERN = /^[a-z0-9_-]{1,40}$/;
var ID_MESSAGE = "Use 1 to 40 lowercase letters, digits, _ or -";
var NAME_MESSAGE = "Use 1 to 80 characters";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}
function isName(value, max = 80) {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= max;
}
function oneOf(choices, value) {
  return typeof value === "string" && choices.includes(value);
}
function rangeMessage(label, [min, max]) {
  return `${label} must be between ${min} and ${max}`;
}
var TRANSFORM_LABELS = { position: "Position", rotation: "Rotation", scale: "Scale" };
var Reader = class {
  constructor(errors) {
    this.errors = errors;
  }
  errors;
  fail(path, message2) {
    if (!(path in this.errors)) this.errors[path] = message2;
    return void 0;
  }
  record(value, path) {
    return isRecord(value) ? value : this.fail(path, "Must be an object");
  }
  id(value, path) {
    return isId(value) ? value : this.fail(path, ID_MESSAGE);
  }
  name(value, path) {
    return isName(value) ? value : this.fail(path, NAME_MESSAGE);
  }
  choice(choices, value, path) {
    return oneOf(choices, value) ? value : this.fail(path, `Use one of: ${choices.join(", ")}`);
  }
  number(value, path, range, label) {
    return isFiniteNumber(value) && value >= range[0] && value <= range[1] ? value : this.fail(path, rangeMessage(label, range));
  }
  vec3(value, path, range, label) {
    if (Array.isArray(value) && value.length === 3 && value.every((n) => isFiniteNumber(n) && n >= range[0] && n <= range[1])) {
      return [value[0], value[1], value[2]];
    }
    return this.fail(path, rangeMessage(label, range));
  }
  boolean(value, path) {
    return typeof value === "boolean" ? value : this.fail(path, "Must be true or false");
  }
  overrideValue(field, value, path) {
    return field === "visible" ? this.boolean(value, path) : this.vec3(value, path, TRANSFORM_RANGES[field], TRANSFORM_LABELS[field]);
  }
  layer(value, path) {
    const raw = this.record(value, path);
    if (!raw) return void 0;
    const id = this.id(raw.id, `${path}.id`);
    const type = this.choice(LAYER_TYPES, raw.type, `${path}.type`);
    const color = this.vec3(raw.color, `${path}.color`, [0, 1], "Colour");
    const roughness = this.number(raw.roughness, `${path}.roughness`, [0, 1], "Roughness");
    const metalness = this.number(raw.metalness, `${path}.metalness`, [0, 1], "Metalness");
    if (id === void 0 || type === void 0 || color === void 0 || roughness === void 0 || metalness === void 0) return void 0;
    return { id, type, color, roughness, metalness };
  }
  node(value, path) {
    const raw = this.record(value, path);
    if (!raw) return void 0;
    const id = this.id(raw.id, `${path}.id`);
    const name = this.name(raw.name, `${path}.name`);
    const kind = this.choice(NODE_KINDS, raw.kind, `${path}.kind`);
    const parentId = this.id(raw.parentId, `${path}.parentId`);
    const primitive = raw.primitive === null || raw.primitive === void 0 ? null : this.choice(PRIMITIVES, raw.primitive, `${path}.primitive`);
    const assetId = raw.assetId === null || raw.assetId === void 0 ? null : typeof raw.assetId === "string" && raw.assetId.length > 0 ? raw.assetId : this.fail(`${path}.assetId`, "Must be an asset ID");
    const position = this.vec3(raw.position, `${path}.position`, TRANSFORM_RANGES.position, "Position");
    const rotation = this.vec3(raw.rotation, `${path}.rotation`, TRANSFORM_RANGES.rotation, "Rotation");
    const scale = this.vec3(raw.scale, `${path}.scale`, TRANSFORM_RANGES.scale, "Scale");
    const visible = raw.visible === void 0 ? true : this.boolean(raw.visible, `${path}.visible`);
    let materialLayers = [];
    if (raw.materialLayers !== void 0) {
      if (!Array.isArray(raw.materialLayers) || raw.materialLayers.length > MAX_LAYERS) {
        materialLayers = this.fail(`${path}.materialLayers`, `Use at most ${MAX_LAYERS} layers`);
      } else {
        const layers = raw.materialLayers.map((entry, i) => this.layer(entry, `${path}.materialLayers[${i}]`));
        materialLayers = layers.every((l) => l !== void 0) ? layers : void 0;
        if (materialLayers && new Set(materialLayers.map((l) => l.id)).size !== materialLayers.length) {
          materialLayers = this.fail(`${path}.materialLayers`, "Layer IDs must be unique");
        }
      }
    }
    if (id === void 0 || name === void 0 || kind === void 0 || parentId === void 0 || primitive === void 0 || assetId === void 0 || position === void 0 || rotation === void 0 || scale === void 0 || visible === void 0 || materialLayers === void 0) return void 0;
    return { id, name, kind, parentId, primitive, assetId, position, rotation, scale, materialLayers, visible };
  }
};
function parseOperation(value, path, errors) {
  const read = new Reader(errors);
  const raw = read.record(value, path);
  if (!raw) return void 0;
  if (!oneOf(OPERATION_TYPES, raw.type)) {
    return read.fail(`${path}.type`, "Unknown operation");
  }
  const at = `${path}.payload`;
  const p = read.record(raw.payload, at);
  if (!p) return void 0;
  const before = Object.keys(errors).length;
  const done = (op) => Object.keys(errors).length === before ? op : void 0;
  switch (raw.type) {
    case "node.add": {
      const node = read.node(p.node, `${at}.node`);
      let overrides;
      if (p.overrides !== void 0) {
        if (!Array.isArray(p.overrides)) return read.fail(`${at}.overrides`, "Must be a list");
        overrides = [];
        p.overrides.forEach((entry, i) => {
          const o = read.record(entry, `${at}.overrides[${i}]`);
          if (!o) return;
          const stateId = read.id(o.stateId, `${at}.overrides[${i}].stateId`);
          const field = read.choice(OVERRIDE_FIELDS, o.field, `${at}.overrides[${i}].field`);
          const v = field ? read.overrideValue(field, o.value, `${at}.overrides[${i}].value`) : void 0;
          if (stateId !== void 0 && field !== void 0 && v !== void 0) overrides?.push({ stateId, field, value: v });
        });
      }
      if (!node) return void 0;
      return done({ type: "node.add", payload: overrides === void 0 ? { node } : { node, overrides } });
    }
    case "node.remove": {
      const id = read.id(p.id, `${at}.id`);
      return id === void 0 ? void 0 : { type: "node.remove", payload: { id } };
    }
    case "node.rename": {
      const id = read.id(p.id, `${at}.id`);
      const name = read.name(p.name, `${at}.name`);
      return id === void 0 || name === void 0 ? void 0 : { type: "node.rename", payload: { id, name } };
    }
    case "node.reparent": {
      const id = read.id(p.id, `${at}.id`);
      const parentId = read.id(p.parentId, `${at}.parentId`);
      return id === void 0 || parentId === void 0 ? void 0 : { type: "node.reparent", payload: { id, parentId } };
    }
    case "transform.set": {
      const id = read.id(p.id, `${at}.id`);
      const payload = { id: id ?? "" };
      for (const field of ["position", "rotation", "scale"]) {
        if (p[field] === void 0) continue;
        const v = read.vec3(p[field], `${at}.${field}`, TRANSFORM_RANGES[field], TRANSFORM_LABELS[field]);
        if (v) payload[field] = v;
      }
      if (p.position === void 0 && p.rotation === void 0 && p.scale === void 0) {
        return read.fail(at, "Set at least one of position, rotation or scale");
      }
      return done({ type: "transform.set", payload });
    }
    case "material.layer.add": {
      const id = read.id(p.id, `${at}.id`);
      const layer = read.layer(p.layer, `${at}.layer`);
      const index = p.index === void 0 ? void 0 : Number.isInteger(p.index) && typeof p.index === "number" && p.index >= 0 ? p.index : read.fail(`${at}.index`, "Must be a whole number from 0");
      if (id === void 0 || layer === void 0) return void 0;
      return done({ type: "material.layer.add", payload: index === void 0 ? { id, layer } : { id, layer, index } });
    }
    case "material.layer.set": {
      const id = read.id(p.id, `${at}.id`);
      const layerId = read.id(p.layerId, `${at}.layerId`);
      const payload = { id: id ?? "", layerId: layerId ?? "" };
      if (p.color !== void 0) {
        const c = read.vec3(p.color, `${at}.color`, [0, 1], "Colour");
        if (c) payload.color = c;
      }
      if (p.roughness !== void 0) {
        const r = read.number(p.roughness, `${at}.roughness`, [0, 1], "Roughness");
        if (r !== void 0) payload.roughness = r;
      }
      if (p.metalness !== void 0) {
        const m = read.number(p.metalness, `${at}.metalness`, [0, 1], "Metalness");
        if (m !== void 0) payload.metalness = m;
      }
      if (p.color === void 0 && p.roughness === void 0 && p.metalness === void 0) {
        return read.fail(at, "Set at least one of color, roughness or metalness");
      }
      return done({ type: "material.layer.set", payload });
    }
    case "material.layer.remove": {
      const id = read.id(p.id, `${at}.id`);
      const layerId = read.id(p.layerId, `${at}.layerId`);
      return id === void 0 || layerId === void 0 ? void 0 : { type: "material.layer.remove", payload: { id, layerId } };
    }
    case "state.add": {
      const s = read.record(p.state, `${at}.state`);
      if (!s) return void 0;
      const id = read.id(s.id, `${at}.state.id`);
      const name = read.name(s.name, `${at}.state.name`);
      return id === void 0 || name === void 0 ? void 0 : { type: "state.add", payload: { state: { id, name } } };
    }
    case "state.remove": {
      const id = read.id(p.id, `${at}.id`);
      return id === void 0 ? void 0 : { type: "state.remove", payload: { id } };
    }
    case "state.override.set": {
      const stateId = read.id(p.stateId, `${at}.stateId`);
      const nodeId = read.id(p.nodeId, `${at}.nodeId`);
      const field = read.choice(OVERRIDE_FIELDS, p.field, `${at}.field`);
      const value2 = p.value === null ? null : field ? read.overrideValue(field, p.value, `${at}.value`) : void 0;
      if (stateId === void 0 || nodeId === void 0 || field === void 0 || value2 === void 0) return void 0;
      return { type: "state.override.set", payload: { stateId, nodeId, field, value: value2 } };
    }
    case "transition.set": {
      const from = read.id(p.from, `${at}.from`);
      const to = read.id(p.to, `${at}.to`);
      const trigger = read.choice(TRIGGERS, p.trigger, `${at}.trigger`);
      const durationMs = p.durationMs === null ? null : Number.isInteger(p.durationMs) && typeof p.durationMs === "number" && p.durationMs >= 0 && p.durationMs <= DURATION_MAX_MS ? p.durationMs : read.fail(`${at}.durationMs`, rangeMessage("Duration", [0, DURATION_MAX_MS]));
      if (from === void 0 || to === void 0 || trigger === void 0 || durationMs === void 0) return void 0;
      return { type: "transition.set", payload: { from, to, trigger, durationMs } };
    }
    case "camera.view.set": {
      const name = read.name(p.name, `${at}.name`);
      const position = p.position === null ? null : read.vec3(p.position, `${at}.position`, TRANSFORM_RANGES.position, "Position");
      const target = read.vec3(p.target, `${at}.target`, TRANSFORM_RANGES.position, "Target");
      const fov = read.number(p.fov, `${at}.fov`, FOV_RANGE, "Field of view");
      if (name === void 0 || position === void 0 || target === void 0 || fov === void 0) return void 0;
      return { type: "camera.view.set", payload: { name, position, target, fov } };
    }
  }
}
function parseBatch(body) {
  const errors = {};
  if (!isRecord(body) || !Array.isArray(body.ops)) return { errors: { ops: "Send a list of operations" } };
  if (body.ops.length < 1 || body.ops.length > MAX_BATCH) return { errors: { ops: `Send 1 to ${MAX_BATCH} operations` } };
  const ops = body.ops.map((raw, i) => parseOperation(raw, `ops[${i}]`, errors));
  if (Object.keys(errors).length > 0) return { errors };
  return { ops: ops.filter((op) => op !== void 0) };
}
var clone = (value) => structuredClone(value);
var findNode = (graph, id) => graph.nodes.find((n) => n.id === id);
var findState = (graph, id) => graph.states.find((s) => s.id === id);
function isDescendant(graph, candidate, ancestor) {
  let current = findNode(graph, candidate);
  while (current) {
    if (current.id === ancestor) return true;
    current = current.parentId === null ? void 0 : findNode(graph, current.parentId);
  }
  return false;
}
function namedNode(op) {
  switch (op.type) {
    case "node.remove":
    case "node.rename":
    case "node.reparent":
    case "transform.set":
    case "material.layer.add":
    case "material.layer.set":
    case "material.layer.remove":
      return op.payload.id;
    case "node.add":
      return op.payload.node.id;
    case "state.override.set":
      return op.payload.nodeId;
    case "state.add":
    case "state.remove":
    case "transition.set":
    case "camera.view.set":
      return null;
  }
}
function lockTargets(graph, ops) {
  const targets = [];
  for (const op of ops) {
    if (op.type === "node.add") continue;
    const id = namedNode(op);
    if (id !== null && findNode(graph, id) && !targets.includes(id)) targets.push(id);
  }
  return targets;
}
function applyOperation(graph, op, path = "payload") {
  const fail = (field, message2, nodeId = null, stateId = null) => ({ ok: false, path: field ? `${path}.${field}` : path, message: message2, nodeId, stateId });
  switch (op.type) {
    case "node.add": {
      const { node, overrides = [] } = op.payload;
      if (findNode(graph, node.id)) return fail("node.id", "ID is already used");
      if (node.parentId === null || !findNode(graph, node.parentId)) return fail("node.parentId", "Parent does not exist", node.parentId);
      for (const [i, o] of overrides.entries()) {
        if (o.stateId === REST_STATE || !findState(graph, o.stateId)) return fail(`overrides[${i}].stateId`, "State does not exist", null, o.stateId);
      }
      graph.nodes.push(clone(node));
      for (const o of overrides) findState(graph, o.stateId)?.overrides.push({ nodeId: node.id, field: o.field, value: clone(o.value) });
      return { ok: true, inverse: { type: "node.remove", payload: { id: node.id } } };
    }
    case "node.remove": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      if (node.parentId === null) return fail("id", "The root cannot be removed");
      if (graph.nodes.some((n) => n.parentId === node.id)) return fail("id", "Remove its children first");
      const overrides = [];
      for (const state of graph.states) {
        for (const o of state.overrides) if (o.nodeId === node.id) overrides.push({ stateId: state.id, field: o.field, value: clone(o.value) });
        state.overrides = state.overrides.filter((o) => o.nodeId !== node.id);
      }
      graph.nodes = graph.nodes.filter((n) => n.id !== node.id);
      return { ok: true, inverse: { type: "node.add", payload: { node: clone(node), overrides } } };
    }
    case "node.rename": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      const name = node.name;
      node.name = op.payload.name;
      return { ok: true, inverse: { type: "node.rename", payload: { id: node.id, name } } };
    }
    case "node.reparent": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      if (node.parentId === null) return fail("id", "The root cannot be moved");
      if (!findNode(graph, op.payload.parentId)) return fail("parentId", "Parent does not exist", op.payload.parentId);
      if (isDescendant(graph, op.payload.parentId, node.id)) return fail("parentId", "A node cannot move under itself");
      const parentId = node.parentId;
      node.parentId = op.payload.parentId;
      return { ok: true, inverse: { type: "node.reparent", payload: { id: node.id, parentId } } };
    }
    case "transform.set": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      const inverse = { id: node.id };
      for (const field of ["position", "rotation", "scale"]) {
        const next = op.payload[field];
        if (!next) continue;
        inverse[field] = [...node[field]];
        node[field] = [...next];
      }
      return { ok: true, inverse: { type: "transform.set", payload: inverse } };
    }
    case "material.layer.add": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      if (node.materialLayers.length >= MAX_LAYERS) return fail("layer", `A node has at most ${MAX_LAYERS} layers`);
      if (node.materialLayers.some((l) => l.id === op.payload.layer.id)) return fail("layer.id", "Layer ID is already used");
      const index = op.payload.index ?? node.materialLayers.length;
      if (index > node.materialLayers.length) return fail("index", "Index is past the end of the layer list");
      node.materialLayers.splice(index, 0, clone(op.payload.layer));
      return { ok: true, inverse: { type: "material.layer.remove", payload: { id: node.id, layerId: op.payload.layer.id } } };
    }
    case "material.layer.set": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      const layer = node.materialLayers.find((l) => l.id === op.payload.layerId);
      if (!layer) return fail("layerId", "Layer does not exist", node.id);
      const inverse = { id: node.id, layerId: layer.id };
      if (op.payload.color) {
        inverse.color = [...layer.color];
        layer.color = [...op.payload.color];
      }
      if (op.payload.roughness !== void 0) {
        inverse.roughness = layer.roughness;
        layer.roughness = op.payload.roughness;
      }
      if (op.payload.metalness !== void 0) {
        inverse.metalness = layer.metalness;
        layer.metalness = op.payload.metalness;
      }
      return { ok: true, inverse: { type: "material.layer.set", payload: inverse } };
    }
    case "material.layer.remove": {
      const node = findNode(graph, op.payload.id);
      if (!node) return fail("id", "Node does not exist", op.payload.id);
      const index = node.materialLayers.findIndex((l) => l.id === op.payload.layerId);
      if (index < 0) return fail("layerId", "Layer does not exist", node.id);
      const [layer] = node.materialLayers.splice(index, 1);
      return { ok: true, inverse: { type: "material.layer.add", payload: { id: node.id, layer, index } } };
    }
    case "state.add": {
      const { id, name } = op.payload.state;
      if (id === REST_STATE || findState(graph, id)) return fail("state.id", "State ID is already used", null, id);
      graph.states.push({ id, name, overrides: [] });
      return { ok: true, inverse: { type: "state.remove", payload: { id } } };
    }
    case "state.remove": {
      const { id } = op.payload;
      const state = findState(graph, id);
      if (!state || id === REST_STATE) return fail("id", "State does not exist or is Rest", null, id);
      if (state.overrides.length > 0 || graph.transitions.some((t) => t.from === id || t.to === id)) {
        return fail("id", "A state override or transition still names this state", null, id);
      }
      graph.states = graph.states.filter((s) => s.id !== id);
      return { ok: true, inverse: { type: "state.add", payload: { state: { id, name: state.name } } } };
    }
    case "state.override.set": {
      const { stateId, nodeId, field, value } = op.payload;
      const state = findState(graph, stateId);
      if (!state || stateId === REST_STATE) return fail("stateId", "State does not exist or is Rest", null, stateId);
      if (!findNode(graph, nodeId)) return fail("nodeId", "Node does not exist", nodeId);
      const existing = state.overrides.find((o) => o.nodeId === nodeId && o.field === field);
      const previous = existing ? clone(existing.value) : null;
      state.overrides = state.overrides.filter((o) => o !== existing);
      if (value !== null) state.overrides.push({ nodeId, field, value: clone(value) });
      return { ok: true, inverse: { type: "state.override.set", payload: { stateId, nodeId, field, value: previous } } };
    }
    case "transition.set": {
      const { from, to, trigger, durationMs } = op.payload;
      if (!findState(graph, from)) return fail("from", "State does not exist", null, from);
      if (!findState(graph, to)) return fail("to", "State does not exist", null, to);
      if (from === to) return fail("to", "A transition joins two different states");
      const existing = graph.transitions.find((t) => t.from === from && t.trigger === trigger);
      graph.transitions = graph.transitions.filter((t) => t !== existing);
      if (durationMs !== null) graph.transitions.push({ from, to, trigger, durationMs });
      const inverse = existing ? { from, to: existing.to, trigger, durationMs: existing.durationMs } : { from, to, trigger, durationMs: null };
      return { ok: true, inverse: { type: "transition.set", payload: inverse } };
    }
    case "camera.view.set": {
      const { name, position, target, fov } = op.payload;
      const existing = graph.cameraViews.find((v) => v.name === name);
      graph.cameraViews = graph.cameraViews.filter((v) => v !== existing);
      if (position !== null) graph.cameraViews.push({ name, position: [...position], target: [...target], fov });
      const inverse = existing ? clone(existing) : { name, position: null, target: [target[0], target[1], target[2]], fov };
      return { ok: true, inverse: { type: "camera.view.set", payload: inverse } };
    }
  }
}
function compareCodePoints(a, b) {
  const x = [...a].map((c) => c.codePointAt(0) ?? 0);
  const y = [...b].map((c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
function canonicalNumber(value) {
  const rounded = Number(value.toFixed(4));
  return String(rounded === 0 ? 0 : rounded);
}
function canonical(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort(compareCodePoints).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return "null";
}
function graphHash(graph) {
  const by = (key) => (a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const c = compareCodePoints(ka[i], kb[i]);
      if (c !== 0) return c;
    }
    return 0;
  };
  const sorted = {
    nodes: [...graph.nodes].sort(by((n) => [n.id])),
    states: graph.states.map((s) => ({ ...s, overrides: [...s.overrides].sort(by((o) => [o.nodeId, o.field])) })).sort(by((s) => [s.id])),
    transitions: [...graph.transitions].sort(by((t) => [t.from, t.trigger])),
    cameraViews: [...graph.cameraViews].sort(by((c) => [c.name]))
  };
  return sha256Hex(canonical(sorted));
}
function starterGraph() {
  const unit = [1, 1, 1];
  const base = { primitive: null, assetId: null, scale: unit, materialLayers: [], visible: true };
  return {
    nodes: [
      { ...base, id: "n_root", name: "Scene", kind: "group", parentId: null, position: [0, 0, 0], rotation: [0, 0, 0] },
      { ...base, id: "n_cam", name: "Main camera", kind: "camera", parentId: "n_root", position: [0, 1.2, 4], rotation: [-15, 0, 0] },
      { ...base, id: "n_key", name: "Key light", kind: "light", parentId: "n_root", position: [2, 3, 2], rotation: [0, 0, 0] }
    ],
    states: [{ id: REST_STATE, name: "Rest", overrides: [] }],
    transitions: [],
    cameraViews: []
  };
}

// server/services/pocketbase.ts
var COLLECTIONS = [
  {
    name: "presence",
    schema: [
      { name: "workspace", type: "text", required: true },
      { name: "scene", type: "text", required: true },
      { name: "authorKind", type: "text", required: true },
      { name: "authorId", type: "text", required: true },
      { name: "authorName", type: "text" },
      { name: "selection", type: "text" },
      { name: "cursor", type: "json" },
      { name: "seenAt", type: "date" }
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_presence_author` ON `presence` (`scene`, `authorKind`, `authorId`)"]
  },
  {
    name: "object_locks",
    schema: [
      { name: "workspace", type: "text", required: true },
      { name: "scene", type: "text", required: true },
      { name: "node", type: "text", required: true },
      { name: "holderKind", type: "text", required: true },
      { name: "holderId", type: "text", required: true },
      { name: "holderName", type: "text" },
      { name: "expiresAt", type: "date" }
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_object_locks_node` ON `object_locks` (`scene`, `node`)"]
  },
  {
    name: "comments",
    schema: [
      { name: "workspace", type: "text", required: true },
      { name: "scene", type: "text", required: true },
      { name: "commentId", type: "text", required: true },
      { name: "node", type: "text", required: true },
      { name: "body", type: "text", required: true },
      { name: "authorId", type: "text" },
      { name: "authorName", type: "text" },
      { name: "mentions", type: "json" },
      { name: "resolved", type: "bool" }
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_comments_id` ON `comments` (`commentId`)"]
  }
];
var token = null;
var ready = null;
async function authenticate() {
  const response = await fetch(`${config.pocketbase.url}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(1e4),
    body: JSON.stringify({ identity: config.pocketbase.email, password: config.pocketbase.password })
  });
  const body = await response.json();
  if (!response.ok || !isRecord(body) || typeof body.token !== "string") throw new Error(`PocketBase sign-in failed (${response.status})`);
  return body.token;
}
async function call(method, path, body) {
  token ??= await authenticate();
  const attempt2 = () => fetch(`${config.pocketbase.url}${path}`, {
    method,
    signal: AbortSignal.timeout(1e4),
    headers: { authorization: token ?? "", ...body === void 0 ? {} : { "content-type": "application/json" } },
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  let response = await attempt2();
  if (response.status === 401) {
    token = await authenticate();
    response = await attempt2();
  }
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function createCollections() {
  for (const collection of COLLECTIONS) {
    const existing = await call("GET", `/api/collections/${collection.name}`);
    if (existing.status === 200) continue;
    const schema = collection.schema.map((f) => f.type === "json" ? { ...f, options: { maxSize: 2e5 } } : f);
    const created = await call("POST", "/api/collections", { name: collection.name, type: "base", schema, indexes: collection.indexes });
    if (created.status !== 200 && (await call("GET", `/api/collections/${collection.name}`)).status !== 200) {
      throw new Error(`PocketBase collection ${collection.name} could not be created`);
    }
  }
}
function ensureCollections() {
  ready ??= createCollections().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}
var quote = (value) => `"${value.replace(/["\\]/g, "")}"`;
function asRecord(value) {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.created !== "string") throw new Error("PocketBase returned a malformed record");
  const record = { ...value, id: value.id, created: value.created };
  return record;
}
async function list(collection, filter) {
  await ensureCollections();
  const found = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ perPage: "500", page: String(page), filter, sort: "created" });
    const response = await call("GET", `/api/collections/${collection}/records?${query}`);
    if (response.status !== 200 || !isRecord(response.body) || !Array.isArray(response.body.items)) throw new Error(`PocketBase list ${collection} failed`);
    found.push(...response.body.items.map(asRecord));
    if (response.body.items.length < 500) return found;
  }
}
async function create(collection, data) {
  await ensureCollections();
  const response = await call("POST", `/api/collections/${collection}/records`, data);
  if (response.status === 200) return asRecord(response.body);
  if (response.status === 400 && JSON.stringify(response.body).includes("validation_not_unique")) return null;
  throw new Error(`PocketBase create ${collection} failed (${response.status})`);
}
async function insert(collection, data) {
  const record = await create(collection, data);
  if (!record) throw new Error(`PocketBase refused a new ${collection} record`);
  return record;
}
async function update(collection, id, data) {
  await ensureCollections();
  const response = await call("PATCH", `/api/collections/${collection}/records/${id}`, data);
  if (response.status === 404) return null;
  if (response.status !== 200) throw new Error(`PocketBase update ${collection} failed (${response.status})`);
  return asRecord(response.body);
}
async function remove(collection, id) {
  await ensureCollections();
  const response = await call("DELETE", `/api/collections/${collection}/records/${id}`);
  if (response.status === 404) return false;
  if (response.status !== 204) throw new Error(`PocketBase delete ${collection} failed (${response.status})`);
  return true;
}
function pbDate(value) {
  return new Date(typeof value === "string" ? value.replace(" ", "T") : 0);
}

// server/errors.ts
var HttpError = class extends Error {
  constructor(status2, body) {
    super(`${status2} ${JSON.stringify(body)}`);
    this.status = status2;
    this.body = body;
  }
  status;
  body;
};
var unauthenticated = () => new HttpError(401, { error: "unauthenticated" });
var invalidCredentials = () => new HttpError(401, { error: "invalid_credentials" });
var invalidSignature = () => new HttpError(401, { error: "invalid_signature" });
var forbidden = () => new HttpError(403, { error: "forbidden" });
var crossOrigin = () => new HttpError(403, { error: "cross_origin" });
var notFound = () => new HttpError(404, { error: "not_found" });
var readOnlyRoute = () => new HttpError(405, { error: "read_only" });
var workspaceReadOnly = () => new HttpError(402, { error: "workspace_read_only" });
var cardDeclined = () => new HttpError(402, { error: "card_declined" });
var gone = () => new HttpError(410, { error: "gone" });
var linkExpired = () => new HttpError(410, { error: "link_expired" });
var conflict = (code, extra = {}) => new HttpError(409, { error: code, ...extra });
var invalidTransition = (from, to) => conflict("invalid_transition", { from, to });
var locked = (nodeId, holder) => conflict("locked", { nodeId, holder });
var payloadTooLarge = (limitBytes) => new HttpError(413, { error: "payload_too_large", limitBytes });
var fileTooLarge = (limitBytes) => new HttpError(413, { error: "file_too_large", limitBytes });
var unsupportedType = () => new HttpError(415, { error: "unsupported_type" });
var invalid = (errors) => new HttpError(422, { errors });
var unavailable = (service) => new HttpError(503, { error: "service_unavailable", service });
var internalError = () => new HttpError(500, { error: "internal_error" });

// server/domain/locks.ts
var LAPSE_MS = 3e4;
var sameAuthor = (a, b) => a.kind === b.kind && a.id === b.id;
function authorFrom(record, prefix) {
  const kind = record[`${prefix}Kind`];
  return { kind: kind === "agent" ? "agent" : "member", id: String(record[`${prefix}Id`] ?? ""), name: String(record[`${prefix}Name`] ?? "") };
}
var toLock = (r) => ({ id: r.id, nodeId: String(r.node), holder: authorFrom(r, "holder"), expiresAt: pbDate(r.expiresAt) });
var lapsed = (lock, now = /* @__PURE__ */ new Date()) => lock.expiresAt <= now;
var expiry = () => new Date(Date.now() + LAPSE_MS).toISOString();
var holderFields = (author) => ({ holderKind: author.kind, holderId: author.id, holderName: author.name, expiresAt: expiry() });
function lockOut(lock) {
  return { nodeId: lock.nodeId, holder: lock.holder, expiresAt: isoSecond(lock.expiresAt) };
}
async function listLocks(scene) {
  const now = /* @__PURE__ */ new Date();
  return (await list("object_locks", `scene=${quote(scene)}`)).map(toLock).filter((l) => !lapsed(l, now)).map(lockOut);
}
async function lockRecord(scene, node) {
  const [record] = await list("object_locks", `scene=${quote(scene)} && node=${quote(node)}`);
  return record ? toLock(record) : null;
}
async function claim(workspace, scene, node, author) {
  for (; ; ) {
    const created = await create("object_locks", { workspace, scene, node, ...holderFields(author) });
    if (created) return { created: true };
    const existing = await lockRecord(scene, node);
    if (!existing) continue;
    if (sameAuthor(existing.holder, author)) {
      await update("object_locks", existing.id, { expiresAt: expiry() });
      return { created: false };
    }
    if (!lapsed(existing)) return { holder: existing.holder };
    await remove("object_locks", existing.id);
  }
}
async function claimAll(workspace, scene, nodes, author) {
  const taken = [];
  for (const node of nodes) {
    const result = await claim(workspace, scene, node, author);
    if ("holder" in result) {
      await releaseAll(scene, taken, author);
      throw locked(node, result.holder);
    }
    if (result.created) taken.push(node);
  }
  return taken;
}
async function claimOne(workspace, scene, node, author) {
  await claimAll(workspace, scene, [node], author);
  return { nodeId: node, holder: author, expiresAt: isoSecond(new Date(Date.now() + LAPSE_MS)) };
}
async function releaseAll(scene, nodes, author) {
  for (const node of nodes) await release(scene, node, author);
}
async function release(scene, node, author) {
  const existing = await lockRecord(scene, node);
  if (!existing || lapsed(existing) || !sameAuthor(existing.holder, author)) return false;
  await remove("object_locks", existing.id);
  return true;
}
async function takeover(workspace, scene, node, author) {
  for (; ; ) {
    const existing = await lockRecord(scene, node);
    if (existing) {
      const previousHolder = !lapsed(existing) && !sameAuthor(existing.holder, author) ? existing.holder : null;
      const moved = await update("object_locks", existing.id, holderFields(author));
      if (moved) return { lock: lockOut(toLock(moved)), previousHolder };
      continue;
    }
    const created = await create("object_locks", { workspace, scene, node, ...holderFields(author) });
    if (created) return { lock: lockOut(toLock(created)), previousHolder: null };
  }
}
async function refreshLocks(scene, author) {
  const mine = await list("object_locks", `scene=${quote(scene)} && holderKind=${quote(author.kind)} && holderId=${quote(author.id)}`);
  await Promise.all(mine.map((r) => update("object_locks", r.id, { expiresAt: expiry() })));
}
async function clearAuthor(author) {
  const scenes = /* @__PURE__ */ new Set();
  const filterLocks = `holderKind=${quote(author.kind)} && holderId=${quote(author.id)}`;
  const filterPresence = `authorKind=${quote(author.kind)} && authorId=${quote(author.id)}`;
  for (const r of await list("object_locks", filterLocks)) {
    scenes.add(String(r.scene));
    await remove("object_locks", r.id);
  }
  for (const r of await list("presence", filterPresence)) {
    scenes.add(String(r.scene));
    await remove("presence", r.id);
  }
  return [...scenes];
}
async function heartbeat(workspace, scene, author, selection, cursor) {
  const fields = { authorName: author.name, selection: selection ?? "", cursor, seenAt: (/* @__PURE__ */ new Date()).toISOString() };
  const filter = `scene=${quote(scene)} && authorKind=${quote(author.kind)} && authorId=${quote(author.id)}`;
  for (; ; ) {
    const [existing] = await list("presence", filter);
    if (existing) {
      if (await update("presence", existing.id, fields)) return;
      continue;
    }
    if (await create("presence", { workspace, scene, authorKind: author.kind, authorId: author.id, ...fields })) return;
  }
}
async function listPresence(scene) {
  const cutoff = Date.now() - LAPSE_MS;
  return (await list("presence", `scene=${quote(scene)}`)).filter((r) => pbDate(r.seenAt).getTime() > cutoff).map((r) => ({ author: authorFrom(r, "author"), selection: r.selection ? String(r.selection) : null }));
}

// server/domain/history.ts
import { randomUUID } from "node:crypto";

// shared/undo.ts
function undoStacks(batches) {
  const undo2 = [];
  let redo2 = [];
  for (const batch of batches) {
    if (batch.undoOf) {
      undo2.pop();
      redo2.push(batch.undoOf);
    } else if (batch.redoOf) {
      redo2.pop();
      undo2.push(batch.batchId);
    } else {
      undo2.push(batch.batchId);
      redo2 = [];
    }
  }
  return { undo: undo2, redo: redo2 };
}

// server/domain/history.ts
async function loadScene(db, workspaceId, sceneId) {
  const scene = await one(db, "SELECT * FROM scenes WHERE id = $1 AND workspace_id = $2", [sceneId, workspaceId]);
  if (!scene) throw notFound();
  return scene;
}
function opRowToOp(row) {
  return {
    seq: row.seq,
    batchId: row.batch_id,
    type: row.type,
    payload: row.payload,
    inverse: row.inverse,
    author: { kind: row.author_kind, id: row.author_id, name: row.author_name },
    createdAt: isoSecond(row.created_at),
    undoOf: row.undo_of,
    redoOf: row.redo_of,
    restoreTo: row.restore_to
  };
}
function stored(value) {
  const op = parseOperation(value, "stored", {});
  if (!op) throw new Error("The operation log holds an operation that no longer parses");
  return op;
}
async function graphAt(scene, seq) {
  const graph = structuredClone(scene.base_graph);
  const log = await rows(pool, "SELECT type, payload FROM ops WHERE scene_id = $1 AND seq <= $2 ORDER BY seq", [scene.id, seq]);
  for (const row of log) applyOperation(graph, stored({ type: row.type, payload: row.payload }));
  return graph;
}
async function commit(scene, author, ops, marks, refuse) {
  const taken = await claimAll(scene.workspace_id, scene.id, lockTargets(scene.graph, ops), author);
  const batchId = `b_${randomUUID().replace(/-/g, "")}`;
  let result;
  try {
    result = await transaction(async (client) => {
      const [current] = await rows(client, "SELECT graph, latest_seq FROM scenes WHERE id = $1 FOR UPDATE", [scene.id]);
      const graph = current.graph;
      const now = /* @__PURE__ */ new Date();
      for (const [i, op] of ops.entries()) {
        const applied = applyOperation(graph, op, `ops[${i}].payload`);
        if (!applied.ok) throw refuse(applied);
        await client.query(
          `INSERT INTO ops (scene_id, seq, batch_id, type, payload, inverse, author_kind, author_id, author_name, created_at, undo_of, redo_of, restore_to)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            scene.id,
            current.latest_seq + i + 1,
            batchId,
            op.type,
            JSON.stringify(op.payload),
            JSON.stringify(applied.inverse),
            author.kind,
            author.id,
            author.name,
            now,
            marks.undoOf ?? null,
            marks.redoOf ?? null,
            marks.restoreTo ?? null
          ]
        );
      }
      const latestSeq = current.latest_seq + ops.length;
      await client.query("UPDATE scenes SET graph = $2, latest_seq = $3, updated_at = $4 WHERE id = $1", [scene.id, JSON.stringify(graph), latestSeq, now]);
      return { batchId, firstSeq: current.latest_seq + 1, lastSeq: latestSeq, latestSeq, hash: graphHash(graph) };
    });
  } catch (error) {
    await releaseAll(scene.id, taken, author);
    throw error;
  }
  const added = ops.flatMap((op) => op.type === "node.add" ? [op.payload.node.id] : []);
  if (added.length > 0) await claimAll(scene.workspace_id, scene.id, added, author);
  await refreshLocks(scene.id, author);
  await announce(scene.id, "op", { batchId });
  return result;
}
function applyBatch(scene, author, ops) {
  return commit(scene, author, ops, {}, (f) => invalid({ [f.path]: f.message }));
}
var undoConflict = (f) => conflict("undo_conflict", { nodeId: f.nodeId });
async function stacks(scene, author) {
  const batches = await rows(
    pool,
    `SELECT batch_id AS "batchId", min(undo_of) AS "undoOf", min(redo_of) AS "redoOf" FROM ops
     WHERE scene_id = $1 AND author_kind = $2 AND author_id = $3 GROUP BY batch_id ORDER BY min(seq)`,
    [scene.id, author.kind, author.id]
  );
  return undoStacks(batches);
}
async function batchOps(scene, batchId) {
  return rows(pool, "SELECT * FROM ops WHERE scene_id = $1 AND batch_id = $2 ORDER BY seq", [scene.id, batchId]);
}
async function undo(scene, author) {
  const target = (await stacks(scene, author)).undo.at(-1);
  if (!target) throw conflict("nothing_to_undo");
  const inverses = (await batchOps(scene, target)).reverse().map((row) => stored(row.inverse));
  return commit(scene, author, inverses, { undoOf: target }, undoConflict);
}
async function redo(scene, author) {
  const target = (await stacks(scene, author)).redo.at(-1);
  if (!target) throw conflict("nothing_to_redo");
  const forward = (await batchOps(scene, target)).map((row) => stored({ type: row.type, payload: row.payload }));
  return commit(scene, author, forward, { redoOf: target }, undoConflict);
}
async function restore(scene, author, toSeq) {
  const later = await rows(pool, "SELECT * FROM ops WHERE scene_id = $1 AND seq > $2 ORDER BY seq DESC", [scene.id, toSeq]);
  return commit(scene, author, later.map((row) => stored(row.inverse)), { restoreTo: toSeq }, undoConflict);
}

// server/events.ts
var CHANNEL = "orrery_scene_events";
var watchers = /* @__PURE__ */ new Map();
var lastSent = /* @__PURE__ */ new Map();
function write(scene, event, data) {
  const frame = `event: ${event}
data: ${JSON.stringify(data)}

`;
  for (const res of watchers.get(scene) ?? []) res.write(frame);
}
async function announce(scene, kind, extra = {}) {
  await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify({ scene, kind, ...extra })]);
}
async function refresh(scene, force = false) {
  if (!watchers.has(scene)) return;
  const [locks, presence] = await Promise.all([listLocks(scene), listPresence(scene)]);
  const previous = lastSent.get(scene) ?? { locks: "", presence: "" };
  const lockKey = JSON.stringify(locks.map((l) => [l.nodeId, l.holder.kind, l.holder.id]).sort());
  const presenceKey = JSON.stringify(presence);
  if (force || lockKey !== previous.locks) {
    const byNode = new Map(locks.map((l) => [l.nodeId, l]));
    const before = previous.locks ? JSON.parse(previous.locks) : [];
    for (const [nodeId] of before) if (!byNode.has(nodeId)) write(scene, "lock", { nodeId, holder: null });
    for (const lock of locks) write(scene, "lock", { nodeId: lock.nodeId, holder: lock.holder });
  }
  if (force || presenceKey !== previous.presence) write(scene, "presence", { authors: presence });
  lastSent.set(scene, { locks: lockKey, presence: presenceKey });
}
async function onNotice(notice) {
  if (!watchers.has(notice.scene)) return;
  if (notice.kind === "op" && notice.batchId) {
    const ops = (await rows(pool, "SELECT * FROM ops WHERE scene_id = $1 AND batch_id = $2 ORDER BY seq", [notice.scene, notice.batchId])).map(opRowToOp);
    write(notice.scene, "op", { batchId: notice.batchId, ops });
  } else if (notice.kind === "lock" || notice.kind === "presence") {
    await refresh(notice.scene);
  } else {
    write(notice.scene, notice.kind, notice.data);
  }
}
async function listen() {
  const connectListener = async () => {
    const client = new esm_default.Client({ connectionString: config.databaseUrl });
    client.on("notification", (message2) => {
      if (!message2.payload) return;
      const notice = JSON.parse(message2.payload);
      onNotice(notice).catch((error) => console.error("scene event relay failed:", error));
    });
    client.on("error", () => {
      client.end().catch(() => void 0);
      setTimeout(() => {
        connectListener().catch(() => void 0);
      }, 1e3);
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  };
  await connectListener();
  setInterval(() => {
    for (const scene of watchers.keys()) refresh(scene).catch(() => void 0);
  }, 1e3).unref();
}
function watch(scene, res) {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(": stream open\n\n");
  const set = watchers.get(scene) ?? /* @__PURE__ */ new Set();
  set.add(res);
  watchers.set(scene, set);
  const heartbeat2 = setInterval(() => res.write(": keep-alive\n\n"), 15e3);
  res.on("close", () => {
    clearInterval(heartbeat2);
    set.delete(res);
    if (set.size === 0) {
      watchers.delete(scene);
      lastSent.delete(scene);
    }
  });
  refresh(scene, true).catch(() => void 0);
}

// server/auth.ts
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
var scrypt = (password, salt, keylen) => new Promise((resolve, reject) => scryptCallback(password, salt, keylen, (error, key) => error ? reject(error) : resolve(key)));
var SESSION_COOKIE = "orrery_session";
var SCHEDULER = { kind: "system", id: "system", name: "Orrery scheduler" };
function authorOf(caller) {
  return { kind: caller.kind, id: caller.id, name: caller.name };
}
function secretHash(secret) {
  return createHash("sha256").update(secret).digest("hex");
}
function randomToken(bytes2 = 32) {
  return randomBytes(bytes2).toString("base64url");
}
var ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function agentSecret() {
  const random = randomBytes(48);
  return `orr_${Array.from(random, (b) => ALPHANUMERIC[b % ALPHANUMERIC.length]).join("")}`;
}
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
async function verifyPassword(password, stored2) {
  const [scheme, salt, key] = stored2.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}
function sessionCookie(token2) {
  return `${SESSION_COOKIE}=${token2}; HttpOnly; SameSite=Lax; Path=/`;
}
async function startSession(db, memberId) {
  const token2 = randomToken();
  await db.query("INSERT INTO sessions (token_hash, member_id, created_at) VALUES ($1, $2, now())", [secretHash(token2), memberId]);
  return token2;
}
function cookieValue(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}
async function authenticate2(headers, db = pool) {
  const authorization = headers.authorization;
  if (authorization !== void 0) {
    const bearer = /^Bearer (\S+)$/.exec(authorization);
    if (!bearer) return null;
    const token2 = await one(
      db,
      "SELECT id, name, scope, workspace_id FROM agent_tokens WHERE secret_hash = $1 AND revoked_at IS NULL AND expires_at > $2",
      [secretHash(bearer[1]), /* @__PURE__ */ new Date()]
    );
    return token2 ? { kind: "agent", id: token2.id, name: token2.name, scope: token2.scope, workspaceId: token2.workspace_id } : null;
  }
  const session = cookieValue(headers.cookie, SESSION_COOKIE);
  if (!session) return null;
  const sessionHash = secretHash(session);
  const member = await one(
    db,
    `SELECT m.id, m.name, m.email, m.role, m.workspace_id FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = $1 AND s.ended_at IS NULL AND m.removed_at IS NULL`,
    [sessionHash]
  );
  return member ? { kind: "member", id: member.id, name: member.name, email: member.email, role: member.role, workspaceId: member.workspace_id, sessionHash } : null;
}

// server/http.ts
var BODY_LIMIT = 1e6;
var json = (status2, body, headers = {}) => ({ status: status2, json: body, headers });
var noContent = (headers = {}) => ({ status: 204, headers });
var bytes = (body, contentType2, headers = {}) => ({ status: 200, body, contentType: contentType2, headers });
var routes = [];
function route(method, pattern, handler, options = {}) {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), options, open: false, handler });
}
function publicRoute(method, pattern, handler, options = {}) {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), options, open: true, handler });
}
function match(method, path) {
  const parts2 = path.split("/").filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.segments.length !== parts2.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts2.length && ok; i++) {
      const seg = candidate.segments[i];
      if (seg.startsWith(":")) {
        try {
          params[seg.slice(1)] = decodeURIComponent(parts2[i]);
        } catch {
          ok = false;
        }
      } else ok = seg === parts2[i];
    }
    if (ok) return { route: candidate, params };
  }
  return null;
}
function limitFor(method, path) {
  return match(method, path)?.route.options.limit ?? BODY_LIMIT;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    let tooLarge = declared > limit;
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
var STATE_CHANGING = (method) => !["GET", "HEAD", "OPTIONS"].includes(method);
var publicOrigin = new URL(config.publicUrl).origin;
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === void 0) return true;
  const scheme = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return origin === `${scheme}://${req.headers.host ?? ""}` || origin === publicOrigin;
}
function send(res, reply, head = false) {
  const headers = { "X-Content-Type-Options": "nosniff", ...reply.headers };
  let payload = reply.body;
  if (reply.json !== void 0) {
    payload = JSON.stringify(reply.json);
    headers["Content-Type"] = "application/json; charset=utf-8";
    headers["Cache-Control"] ??= "no-store";
  } else if (reply.contentType) headers["Content-Type"] = reply.contentType;
  if (payload !== void 0) headers["Content-Length"] = String(Buffer.byteLength(payload));
  res.writeHead(reply.status, headers);
  res.end(head ? void 0 : payload);
}
var sendError = (res, error) => send(res, { status: error.status, json: error.body });
async function handle(req, res, fallback2) {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://local");
  const path = url.pathname;
  try {
    const raw = await readBody(req, limitFor(method, path));
    if (raw === null) throw payloadTooLarge(limitFor(method, path));
    const isReviewPath = path.startsWith("/review/") || path.startsWith("/api/review/");
    if (isReviewPath && method !== "GET" && method !== "HEAD") throw readOnlyRoute();
    const found = match(method === "HEAD" ? "GET" : method, path);
    if (STATE_CHANGING(method) && !found?.route.options.anyOrigin && !sameOrigin(req)) throw crossOrigin();
    const ctx = {
      method,
      path,
      query: url.searchParams,
      params: found?.params ?? {},
      headers: req.headers,
      raw,
      res,
      body() {
        if (raw.length === 0) return void 0;
        try {
          return JSON.parse(raw.toString("utf8"));
        } catch {
          throw invalid({ body: "Send a JSON body" });
        }
      }
    };
    if (!found) {
      const reply2 = await fallback2(ctx);
      if (!reply2) throw notFound();
      send(res, reply2, method === "HEAD");
      return;
    }
    let reply;
    if (found.route.open) reply = await found.route.handler(ctx);
    else {
      const caller = await authenticate2(req.headers);
      if (!caller) throw unauthenticated();
      reply = await found.route.handler({ ...ctx, caller });
    }
    if (reply) send(res, reply, method === "HEAD");
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof HttpError) {
      sendError(res, error);
      return;
    }
    console.error(`${method} ${path} failed:`, error);
    sendError(res, internalError());
  }
}

// server/pages.ts
import { readdirSync, readFileSync as readFileSync2, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// server/services/storage.ts
import { createHash as createHash2, createHmac } from "node:crypto";
var { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;
var keys = {
  snapshot: (ws, scene, version) => `ws/${ws}/scenes/${scene}/versions/${version}/snapshot.json`,
  thumbnail: (ws, scene, version) => `ws/${ws}/scenes/${scene}/versions/${version}/thumbnail.png`,
  asset: (ws, asset) => `ws/${ws}/assets/${asset}`,
  published: (ws, embedId) => `ws/${ws}/published/${embedId}/scene.json`,
  exportBundle: (ws, exportId) => `ws/${ws}/exports/${exportId}.zip`,
  invoice: (ws, invoiceId) => `ws/${ws}/invoices/${invoiceId}.pdf`
};
var sha256 = (data) => createHash2("sha256").update(data).digest("hex");
var hmac = (key, data) => createHmac("sha256", key).update(data).digest();
function objectUrl(key) {
  const base = new URL(endpoint);
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (forcePathStyle) return new URL(`${base.origin}/${bucket}${key ? `/${path}` : ""}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${path}`);
}
async function send2(method, key, body, contentType2, timeoutMs = 15e3) {
  const url = objectUrl(key);
  const now = /* @__PURE__ */ new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signed = Object.keys(headers).sort();
  const canonical2 = [method, url.pathname, "", signed.map((h) => `${h}:${headers[h]}
`).join(""), signed.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical2)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const sent = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`
  };
  if (contentType2) sent["content-type"] = contentType2;
  let response;
  try {
    response = await fetch(url, { method, headers: sent, body: body ? new Uint8Array(body) : void 0, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw unavailable("file_storage");
  }
  if (response.status >= 500 || response.status === 403) throw unavailable("file_storage");
  return response;
}
async function putObject(key, body, contentType2) {
  const response = await send2("PUT", key, body, contentType2);
  if (!response.ok) throw unavailable("file_storage");
}
async function getObject(key, timeoutMs) {
  const response = await send2("GET", key, void 0, void 0, timeoutMs);
  if (response.status === 404) return null;
  if (!response.ok) throw unavailable("file_storage");
  return Buffer.from(await response.arrayBuffer());
}
async function deleteObject(key) {
  await send2("DELETE", key);
}
async function assertStorageReachable() {
  const response = await send2("HEAD", "");
  if (!response.ok) throw unavailable("file_storage");
}

// server/routes/versions.ts
import { readFileSync } from "node:fs";

// server/audit.ts
async function audit(db, workspaceId, actor, action, target) {
  await db.query(
    `INSERT INTO audit_entries (workspace_id, at, actor_kind, actor_id, actor_name, action, target_type, target_id)
     VALUES ($1, clock_timestamp(), $2, $3, $4, $5, $6, $7)`,
    [workspaceId, actor.kind, actor.id, actor.name, action, target.type, target.id]
  );
}

// shared/permissions.ts
var ALL_ROLES = ["owner", "admin", "billing_manager", "editor", "viewer"];
var TABLE = {
  "scene.read": { roles: ALL_ROLES, scopes: ["read", "edit"] },
  "workspace.read": { roles: ALL_ROLES, scopes: [] },
  "scene.create": { roles: ["owner", "editor"], scopes: [] },
  "asset.upload": { roles: ["owner", "editor"], scopes: [] },
  "scene.edit": { roles: ["owner", "editor"], scopes: ["edit"] },
  // Presence heartbeats also come from members who only read a scene; they count for presence only.
  "presence": { roles: ALL_ROLES, scopes: ["edit"] },
  "comment": { roles: ALL_ROLES, scopes: [] },
  "version.manage": { roles: ["owner", "editor"], scopes: [] },
  "version.approve": { roles: ALL_ROLES, scopes: [] },
  "member.invite": { roles: ["owner", "admin", "billing_manager"], scopes: [] },
  "member.manage": { roles: ["owner", "admin"], scopes: [] },
  "workspace.settings": { roles: ["owner"], scopes: [] },
  "subscription.cancel": { roles: ["owner"], scopes: [] },
  "gateway.read": { roles: ["owner"], scopes: [] },
  "billing": { roles: ["owner", "billing_manager"], scopes: [] }
};
function can(principal, action) {
  const grant = TABLE[action];
  return principal.kind === "member" ? grant.roles.includes(principal.role) : grant.scopes.includes(principal.scope);
}
function canInviteRole(principal, role) {
  return can(principal, "member.invite") && !(principal.kind === "member" && principal.role === "billing_manager" && role === "admin");
}

// server/domain/permissions.ts
function authorize(caller, action) {
  if (!can(caller, action)) throw forbidden();
}
function authorizeInvite(caller, role) {
  if (!canInviteRole(caller, role)) throw forbidden();
}
function authorizeApproval(caller, creatorId) {
  authorize(caller, "version.approve");
  if (caller.id === creatorId) throw forbidden();
}

// shared/plans.ts
var PLAN_CATALOG = {
  team: { name: "Team", includedSeats: 8, tokenLimit: 5, prices: { monthly: { base: 9600, seat: 1200 }, annual: { base: 96e3, seat: 12e3 } } },
  business: { name: "Business", includedSeats: 20, tokenLimit: 25, prices: { monthly: { base: 38e3, seat: 1600 }, annual: { base: 38e4, seat: 16e3 } } }
};
var TRIAL_SEATS = 8;

// server/services/mail.ts
import { connect } from "node:net";
import { randomUUID as randomUUID2 } from "node:crypto";
var sender = (() => {
  const match2 = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(config.mailFrom);
  return match2 ? { name: match2[1].replace(/^"|"$/g, ""), address: match2[2] } : { name: "", address: config.mailFrom.trim() };
})();
async function enqueueMail(db, mail) {
  const to = [...new Set(mail.to.map((a) => a.toLowerCase()))];
  await db.query(
    "INSERT INTO mail_outbox (recipients, from_name, subject, body, created_at) VALUES ($1, $2, $3, $4, now())",
    [JSON.stringify(to), mail.fromName ?? sender.name, mail.subject, mail.body]
  );
}
var CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/g;
var clean = (text) => text.replace(CONTROL, "");
var ascii = (text) => /^[\x20-\x7e]*$/.test(text);
function encodedWords(text) {
  const words = [];
  let chunk = "";
  for (const char of text) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}
function displayName(name) {
  const safe = clean(name);
  if (!ascii(safe)) return encodedWords(safe);
  return `"${safe.replace(/(["\\])/g, "\\$1")}"`;
}
function headerText(text) {
  const safe = clean(text);
  return ascii(safe) ? safe : encodedWords(safe);
}
function message(to, fromName, subject, body) {
  const encoded = Buffer.from(body.replace(/\r?\n/g, "\r\n")).toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${displayName(fromName)} <${sender.address}>`,
    `To: ${to.join(", ")}`,
    `Subject: ${headerText(subject)}`,
    `Date: ${(/* @__PURE__ */ new Date()).toUTCString()}`,
    `Message-ID: <${randomUUID2()}@${sender.address.split("@")[1] ?? "localhost"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded
  ].join("\r\n");
}
function smtpSend(to, data) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(15e3, () => socket.destroy(new Error("SMTP timeout")));
    const steps = [
      `EHLO orrery-studio`,
      `MAIL FROM:<${sender.address}>`,
      ...to.map((a) => `RCPT TO:<${a}>`),
      "DATA",
      `${data}\r
.`,
      "QUIT"
    ];
    let buffer = "";
    let step = -1;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) {
          socket.destroy(new Error(`SMTP ${line}`));
          return;
        }
        step += 1;
        if (step < steps.length) socket.write(`${steps[step]}\r
`);
        else {
          socket.end();
          resolve();
        }
      }
    });
    socket.on("error", reject);
    socket.on("close", () => step >= steps.length - 1 ? resolve() : reject(new Error("SMTP connection closed early")));
  });
}
async function deliverQueuedMail() {
  await transaction(async (client) => {
    const queued = await rows(
      client,
      "SELECT id, recipients, from_name, subject, body FROM mail_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED"
    );
    for (const mail of queued) {
      try {
        await smtpSend(mail.recipients, message(mail.recipients, mail.from_name, mail.subject, mail.body));
      } catch (error) {
        console.error("mail delivery deferred:", error instanceof Error ? error.message : error);
        return;
      }
      await client.query("UPDATE mail_outbox SET sent_at = now() WHERE id = $1", [mail.id]);
    }
  });
}

// server/workspace.ts
async function loadWorkspace(db, id) {
  const row = await one(db, "SELECT * FROM workspaces WHERE id = $1", [id]);
  if (!row) throw new Error(`workspace ${id} is missing`);
  return row;
}
var workspaceOut = (w) => ({ id: w.id, name: w.name, timeZone: w.time_zone, reviewLinksEnabled: w.review_links_enabled });
var workspaceSummary = (w) => ({ id: w.id, name: w.name, timeZone: w.time_zone });
async function billingContacts(db, workspaceId) {
  return (await rows(
    db,
    "SELECT email FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND role IN ('owner', 'billing_manager') ORDER BY joined_at",
    [workspaceId]
  )).map((r) => r.email);
}
async function ownerEmail(db, workspaceId) {
  const row = await one(db, "SELECT email FROM members WHERE workspace_id = $1 AND role = 'owner' AND removed_at IS NULL", [workspaceId]);
  return row?.email ?? "";
}
var isTimeZone = (zone) => {
  if (typeof zone !== "string" || zone === "") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone.includes("/") || zone === "UTC";
  } catch {
    return false;
  }
};

// server/domain/clock.ts
async function endTrials(now, workspaceId) {
  await transaction(async (client) => {
    const ended = await rows(
      client,
      `UPDATE subscriptions s SET state = 'suspended', suspended_by = 'trial' FROM workspaces w
       WHERE w.id = s.workspace_id AND s.state = 'trial' AND s.trial_ends_at <= $1 AND ($2::text IS NULL OR s.workspace_id = $2)
       RETURNING s.workspace_id, w.name, w.time_zone`,
      [now, workspaceId]
    );
    for (const ws of ended) await audit(client, ws.workspace_id, SCHEDULER, "subscription.trial_ended", { type: "subscription", id: ws.workspace_id });
  });
}
async function dunning(now, workspaceId) {
  await transaction(async (client) => {
    const reminders = await rows(
      client,
      `UPDATE subscriptions s SET dunning_day3_sent = true FROM workspaces w
       WHERE w.id = s.workspace_id AND s.state = 'past_due' AND NOT s.dunning_day3_sent AND s.dunning_day3_at <= $1
         AND ($2::text IS NULL OR s.workspace_id = $2)
       RETURNING s.workspace_id, w.name, w.time_zone`,
      [now, workspaceId]
    );
    for (const ws of reminders) {
      await enqueueMail(client, {
        to: await billingContacts(client, ws.workspace_id),
        subject: `Reminder: payment still due for ${ws.name}`,
        body: `A payment for ${ws.name} is still due. Pay the overdue invoice before the grace period ends to keep publishing.

Orrery Studio`
      });
    }
    const suspended = await rows(
      client,
      `UPDATE subscriptions s SET state = 'suspended', suspended_by = 'dunning' FROM workspaces w
       WHERE w.id = s.workspace_id AND s.state = 'past_due' AND s.grace_ends_at <= $1 AND ($2::text IS NULL OR s.workspace_id = $2)
       RETURNING s.workspace_id, w.name, w.time_zone, s.grace_ends_at`,
      [now, workspaceId]
    );
    for (const ws of suspended) {
      await audit(client, ws.workspace_id, SCHEDULER, "subscription.suspended", { type: "subscription", id: ws.workspace_id });
      await enqueueMail(client, {
        to: await billingContacts(client, ws.workspace_id),
        subject: `Publishing suspended for ${ws.name}`,
        body: `The grace period for ${ws.name} ended ${localTime(isoSecond(ws.grace_ends_at), ws.time_zone)}. The workspace is read-only until the overdue invoice is paid.

Orrery Studio`
      });
    }
  });
}
async function settleClock(now, workspaceId = null) {
  await endTrials(now, workspaceId);
  await dunning(now, workspaceId);
}

// server/domain/subscription.ts
var PERIODS = ["monthly", "annual"];
var PLAN_IDS = ["team", "business"];
var killbillPlan = (plan, period) => `${plan}-${period}`;
var killbillSeatPlan = (plan, period) => `seat-${plan}-${period}`;
async function loadSubscription(db, workspaceId, lock = false) {
  const row = await one(db, `SELECT * FROM subscriptions WHERE workspace_id = $1${lock ? " FOR UPDATE" : ""}`, [workspaceId]);
  if (!row) throw new Error(`workspace ${workspaceId} has no subscription`);
  return row;
}
function effectiveState(row, now) {
  if (row.state === "trial" && row.trial_ends_at && now >= row.trial_ends_at) return "suspended";
  if (row.state === "past_due" && row.grace_ends_at && now >= row.grace_ends_at) return "suspended";
  return row.state;
}
function suspensionCause(row, now) {
  if (effectiveState(row, now) !== "suspended") return null;
  return row.state === "trial" || row.suspended_by === "trial" ? "trial" : "dunning";
}
function onTrialTerms(row) {
  return row.state === "trial" || row.suspended_by === "trial" || row.state === "cancelled" && row.kb_account_id === null;
}
function seatsPurchased(row) {
  return onTrialTerms(row) ? TRIAL_SEATS : PLAN_CATALOG[row.plan].includedSeats + row.extra_seats;
}
function tokenLimit(row) {
  return onTrialTerms(row) ? PLAN_CATALOG.team.tokenLimit : PLAN_CATALOG[row.plan].tokenLimit;
}
function toSubscription(row, now) {
  return {
    state: effectiveState(row, now),
    plan: row.plan,
    period: row.period,
    seatsPurchased: seatsPurchased(row),
    extraSeats: row.extra_seats,
    trialEndsAt: row.trial_ends_at ? isoSecond(row.trial_ends_at) : null,
    graceEndsAt: row.grace_ends_at ? isoSecond(row.grace_ends_at) : null,
    pendingChange: row.pending_change
  };
}
function isReadOnly(row, now) {
  const state = effectiveState(row, now);
  return state === "suspended" || state === "cancelled";
}
async function currentSubscription(workspaceId) {
  const now = /* @__PURE__ */ new Date();
  const row = await loadSubscription(pool, workspaceId);
  const due = row.state === "trial" && row.trial_ends_at !== null && now >= row.trial_ends_at || row.state === "past_due" && (row.grace_ends_at !== null && now >= row.grace_ends_at || !row.dunning_day3_sent && row.dunning_day3_at !== null && now >= row.dunning_day3_at);
  if (!due) return row;
  await settleClock(now, workspaceId);
  return loadSubscription(pool, workspaceId);
}
async function assertWritable(workspaceId) {
  if (isReadOnly(await currentSubscription(workspaceId), /* @__PURE__ */ new Date())) throw workspaceReadOnly();
}
function assertCheckoutAllowed(row, now) {
  const state = effectiveState(row, now);
  if (state === "trial" || suspensionCause(row, now) === "trial") return;
  throw invalidTransition(state, "active");
}
function assertCancelAllowed(row) {
  if (row.state === "cancelled") throw invalidTransition("cancelled", "cancelled");
}
function assertActive(row, now) {
  if (effectiveState(row, now) !== "active") throw conflict("subscription_not_active");
}
function changeTiming(from, to) {
  if (from.plan === "team" && to.plan === "business") return "immediate";
  if (from.plan === to.plan && from.period === "monthly" && to.period === "annual") return "immediate";
  return "end_of_term";
}
function assertSeatsFit(seatsUsed2, seatsAfter) {
  if (seatsAfter < seatsUsed2) throw conflict("seats_in_use", { seatsUsed: seatsUsed2, seatsAfter });
}

// server/domain/versions.ts
var MOVES = {
  submit: { from: "draft", to: "in_review" },
  schedule: { from: "in_review", to: "scheduled" },
  unschedule: { from: "scheduled", to: "in_review" },
  publish: { from: "scheduled", to: "published" },
  withdraw: { from: "published", to: "withdrawn" }
};
function nextState(current, move2) {
  const { from, to } = MOVES[move2];
  if (current !== from) throw invalidTransition(current, to);
  return to;
}
var REVIEWABLE = ["draft", "in_review", "scheduled"];

// server/publish.ts
import { randomBytes as randomBytes2 } from "node:crypto";
async function versionsOut(db, versions) {
  if (versions.length === 0) return [];
  const approvals = await rows(db, "SELECT * FROM approvals WHERE version_id = ANY($1) ORDER BY at", [versions.map((v) => v.id)]);
  const embeds = await rows(db, "SELECT id, embed_id FROM scenes WHERE id = ANY($1)", [[...new Set(versions.map((v) => v.scene_id))]]);
  const embedOf = new Map(embeds.map((s) => [s.id, s.embed_id]));
  return versions.map((v) => ({
    id: v.id,
    sceneId: v.scene_id,
    number: v.number,
    label: v.label,
    state: v.state,
    seq: v.seq,
    createdBy: { kind: v.created_by_kind, id: v.created_by_id, name: v.created_by_name },
    approvals: approvals.filter((a) => a.version_id === v.id).map((a) => ({ member: { kind: "member", id: a.member_id, name: a.member_name }, at: isoSecond(a.at) })),
    publishAt: v.publish_at ? isoSecond(v.publish_at) : null,
    publishedAt: v.published_at ? isoSecond(v.published_at) : null,
    embedId: v.state === "published" || v.state === "withdrawn" ? embedOf.get(v.scene_id) ?? null : null
  }));
}
async function announceVersions(db, versions) {
  for (const version of await versionsOut(db, versions)) await announce(version.sceneId, "version", { data: version });
}
async function readSnapshot(version) {
  const raw = await getObject(keys.snapshot(version.workspace_id, version.scene_id, version.id));
  if (!raw) return null;
  const snapshot = JSON.parse(raw.toString("utf8"));
  return snapshot.graph;
}
function publishedPayload(sceneName, version, publishedAt, graph) {
  return { scene: { name: sceneName }, version: { number: version.number, label: version.label, publishedAt: isoSecond(publishedAt) }, graph };
}
var embedCache = /* @__PURE__ */ new Map();
function cachedEmbed(embedId, versionId) {
  const hit = embedCache.get(embedId);
  return hit && hit.versionId === versionId ? hit.payload : null;
}
function rememberEmbed(embedId, versionId, payload) {
  embedCache.set(embedId, { versionId, payload });
}
async function goLive(version) {
  if (isReadOnly(await currentSubscription(version.workspace_id), /* @__PURE__ */ new Date())) return;
  const snapshot = await readSnapshot(version);
  if (!snapshot) return;
  const changed = await transaction(async (client) => {
    const [claimed] = await rows(
      client,
      "SELECT * FROM versions WHERE id = $1 AND state = 'scheduled' FOR UPDATE SKIP LOCKED",
      [version.id]
    );
    if (!claimed) return [];
    const [scene] = await rows(client, "SELECT name, embed_id FROM scenes WHERE id = $1 FOR UPDATE", [version.scene_id]);
    const embedId = scene.embed_id ?? `emb_${randomBytes2(12).toString("hex")}`;
    const publishedAt = /* @__PURE__ */ new Date();
    const payload = publishedPayload(scene.name, claimed, publishedAt, snapshot);
    await putObject(keys.published(version.workspace_id, embedId), Buffer.from(JSON.stringify(payload)), "application/json");
    await client.query("UPDATE scenes SET embed_id = $2 WHERE id = $1", [version.scene_id, embedId]);
    const withdrawn = await rows(
      client,
      "UPDATE versions SET state = 'withdrawn' WHERE scene_id = $1 AND state = 'published' RETURNING *",
      [version.scene_id]
    );
    const [published] = await rows(
      client,
      "UPDATE versions SET state = $2, published_at = $3 WHERE id = $1 RETURNING *",
      [version.id, nextState(claimed.state, "publish"), publishedAt]
    );
    await audit(client, version.workspace_id, SCHEDULER, "version.published", { type: "version", id: version.id });
    const recipients = await rows(
      client,
      "SELECT DISTINCT email FROM members WHERE id = ANY($1)",
      [[claimed.scheduled_by, claimed.created_by_kind === "member" ? claimed.created_by_id : null].filter((id) => id !== null)]
    );
    await enqueueMail(client, {
      to: recipients.map((r) => r.email),
      subject: `Published: ${scene.name} v${claimed.number}`,
      body: `${scene.name} v${claimed.number} \xB7 ${claimed.label} is live.

Published at ${isoSecond(publishedAt)}.

Embed: ${config.publicUrl}/embed/${embedId}
`
    });
    rememberEmbed(embedId, version.id, payload);
    return [...withdrawn, published];
  });
  await announceVersions(pool, changed);
}
async function publishDueVersions() {
  const due = await rows(pool, "SELECT * FROM versions WHERE state = 'scheduled' AND publish_at <= $1 ORDER BY publish_at", [/* @__PURE__ */ new Date()]);
  for (const version of due) {
    try {
      await goLive(version);
    } catch (error) {
      console.error(`go-live of ${version.id} deferred:`, error instanceof Error ? error.message : error);
    }
  }
}

// server/zip.ts
var CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
  return c >>> 0;
});
function crc32(data) {
  let crc = 4294967295;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(67324752, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(2048, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(33639248, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(2048, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, entry.data);
    centrals.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(101010256, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// server/routes/account.ts
import { randomBytes as randomBytes3 } from "node:crypto";

// server/domain/seats.ts
async function seatsUsed(db, workspaceId, now) {
  const [row] = await rows(
    db,
    `SELECT (SELECT count(*) FROM members WHERE workspace_id = $1 AND removed_at IS NULL)::int
          + (SELECT count(*) FROM invites WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2)::int AS used`,
    [workspaceId, now]
  );
  return row.used;
}
async function lockSeats(db, workspaceId) {
  await db.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [workspaceId]);
}

// server/routes/account.ts
var EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;
function newId(prefix) {
  return `${prefix}_${randomBytes3(10).toString("hex")}`;
}
function bodyOf(ctx) {
  const body = ctx.body();
  if (!isRecord(body)) throw invalid({ body: "Send a JSON object" });
  return body;
}
var memberOut = (m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, joinedAt: isoSecond(m.joined_at) });
async function emailTaken(db, email) {
  return await one(db, "SELECT 1 FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL", [email]) !== void 0;
}
publicRoute("GET", "/api/health", async () => json(200, { status: "ok" }));
publicRoute("POST", "/api/signup", async (ctx) => {
  const body = bodyOf(ctx);
  const errors = {};
  if (!isName(body.workspaceName)) errors.workspaceName = "Use 1 to 80 characters";
  if (!isName(body.name)) errors.name = "Use 1 to 80 characters";
  if (typeof body.email !== "string" || !EMAIL.test(body.email)) errors.email = "Enter an email address";
  if (typeof body.password !== "string" || body.password.length < 10) errors.password = "Use at least 10 characters";
  if (!isTimeZone(body.timeZone)) errors.timeZone = "Choose a time zone";
  if (typeof body.email === "string" && EMAIL.test(body.email) && await emailTaken(pool, body.email)) throw conflict("email_taken");
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const workspaceId = newId("ws");
  const memberId = newId("mem");
  const passwordHash = await hashPassword(String(body.password));
  const now = /* @__PURE__ */ new Date();
  const { member, token: token2 } = await transaction(async (client) => {
    if (await emailTaken(client, String(body.email))) throw conflict("email_taken");
    await client.query(
      "INSERT INTO workspaces (id, name, time_zone, signing_secret, created_at) VALUES ($1, $2, $3, $4, $5)",
      [workspaceId, body.workspaceName, body.timeZone, `whsec_${randomBytes3(12).toString("hex")}`, now]
    );
    const [created] = await rows(
      client,
      "INSERT INTO members (id, workspace_id, name, email, password_hash, role, joined_at) VALUES ($1, $2, $3, $4, $5, 'owner', $6) RETURNING *",
      [memberId, workspaceId, body.name, body.email, passwordHash, now]
    );
    await client.query(
      "INSERT INTO subscriptions (workspace_id, state, plan, period, trial_ends_at) VALUES ($1, 'trial', 'team', 'monthly', $2)",
      [workspaceId, new Date(now.getTime() + config.trialLengthSeconds * 1e3)]
    );
    await audit(client, workspaceId, { kind: "member", id: memberId, name: created.name }, "workspace.created", { type: "workspace", id: workspaceId });
    return { member: created, token: await startSession(client, memberId) };
  });
  const ws = await loadWorkspace(pool, workspaceId);
  return json(201, {
    workspace: workspaceSummary(ws),
    member: memberOut(member),
    subscription: toSubscription(await currentSubscription(workspaceId), /* @__PURE__ */ new Date())
  }, { "Set-Cookie": sessionCookie(token2) });
});
publicRoute("POST", "/api/auth/login", async (ctx) => {
  const body = bodyOf(ctx);
  if (typeof body.email !== "string" || typeof body.password !== "string") throw invalidCredentials();
  const member = await one(pool, "SELECT * FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL", [body.email]);
  if (!member || !await verifyPassword(body.password, member.password_hash)) throw invalidCredentials();
  const token2 = await startSession(pool, member.id);
  return json(
    200,
    { member: memberOut(member), workspace: workspaceSummary(await loadWorkspace(pool, member.workspace_id)) },
    { "Set-Cookie": sessionCookie(token2) }
  );
});
route("POST", "/api/auth/logout", async (ctx) => {
  if (ctx.caller.kind === "member") await pool.query("UPDATE sessions SET ended_at = now() WHERE token_hash = $1", [ctx.caller.sessionHash]);
  return noContent({ "Set-Cookie": "orrery_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
});
route("GET", "/api/me", async ({ caller }) => {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  if (caller.kind === "agent") return json(200, { agent: { id: caller.id, name: caller.name, scope: caller.scope }, workspace: workspaceSummary(ws) });
  const [member] = await rows(pool, "SELECT * FROM members WHERE id = $1", [caller.id]);
  const subscription = toSubscription(await currentSubscription(ws.id), /* @__PURE__ */ new Date());
  const overdue = subscription.state === "past_due" ? await one(
    pool,
    "SELECT invoice_number FROM payments WHERE workspace_id = $1 AND charged_back ORDER BY created_at DESC LIMIT 1",
    [ws.id]
  ) : void 0;
  return json(200, {
    member: memberOut(member),
    workspace: workspaceSummary(ws),
    subscription,
    overdueInvoice: overdue?.invoice_number ?? null
  });
});
route("GET", "/api/workspace", async ({ caller }) => {
  authorize(caller, "workspace.read");
  return json(200, workspaceOut(await loadWorkspace(pool, caller.workspaceId)));
});
route("PATCH", "/api/workspace", async (ctx) => {
  authorize(ctx.caller, "workspace.settings");
  const body = bodyOf(ctx);
  const errors = {};
  if (body.name !== void 0 && !isName(body.name)) errors.name = "Use 1 to 80 characters";
  if (body.timeZone !== void 0 && !isTimeZone(body.timeZone)) errors.timeZone = "Choose a time zone";
  if (body.reviewLinksEnabled !== void 0 && typeof body.reviewLinksEnabled !== "boolean") errors.reviewLinksEnabled = "Must be true or false";
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const ws = await loadWorkspace(pool, ctx.caller.workspaceId);
  await transaction(async (client) => {
    await client.query(
      "UPDATE workspaces SET name = $2, time_zone = $3, review_links_enabled = $4 WHERE id = $1",
      [ws.id, body.name ?? ws.name, body.timeZone ?? ws.time_zone, body.reviewLinksEnabled ?? ws.review_links_enabled]
    );
    await audit(client, ws.id, authorOf(ctx.caller), "workspace.updated", { type: "workspace", id: ws.id });
  });
  return json(200, workspaceOut(await loadWorkspace(pool, ws.id)));
});
async function dashboardFor(caller) {
  const now = /* @__PURE__ */ new Date();
  const sub = await currentSubscription(caller.workspaceId);
  const counts = await one(
    pool,
    `SELECT (SELECT count(*) FROM scenes WHERE workspace_id = $1)::int AS scenes,
            (SELECT count(DISTINCT scene_id) FROM versions WHERE workspace_id = $1 AND state = 'published')::int AS published,
            (SELECT count(*) FROM versions WHERE workspace_id = $1 AND state = 'scheduled')::int AS scheduled,
            (SELECT count(*) FROM agent_tokens WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > $2)::int AS tokens`,
    [caller.workspaceId, now]
  );
  return {
    seatsUsed: await seatsUsed(pool, caller.workspaceId, now),
    seatsPurchased: seatsPurchased(sub),
    scenes: counts?.scenes ?? 0,
    publishedScenes: counts?.published ?? 0,
    scheduledVersions: counts?.scheduled ?? 0,
    activeAgentTokens: counts?.tokens ?? 0,
    subscription: toSubscription(sub, now)
  };
}
route("GET", "/api/dashboard", async ({ caller }) => {
  authorize(caller, "workspace.read");
  return json(200, await dashboardFor(caller));
});
route("GET", "/api/audit", async ({ caller, query }) => {
  authorize(caller, "member.manage");
  const raw = query.get("limit");
  const limit = raw === null ? 100 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw invalid({ limit: "Use a whole number from 1 to 500" });
  const entries = await rows(
    pool,
    "SELECT * FROM audit_entries WHERE workspace_id = $1 ORDER BY at DESC, id DESC LIMIT $2",
    [caller.workspaceId, limit]
  );
  return json(200, {
    entries: entries.map((e) => ({
      id: String(e.id),
      at: isoSecond(e.at),
      actor: { kind: e.actor_kind, id: e.actor_id, name: e.actor_name },
      action: e.action,
      target: { type: e.target_type, id: e.target_id }
    }))
  });
});
route("GET", "/api/search", async ({ caller, query }) => {
  authorize(caller, "scene.read");
  const q = query.get("q") ?? "";
  if ([...q].length < 2) throw invalid({ q: "Type at least 2 characters" });
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const [scenes, assets2] = await Promise.all([
    rows(pool, "SELECT id, name FROM scenes WHERE workspace_id = $1 AND name ILIKE $2 ORDER BY name, id", [caller.workspaceId, pattern]),
    rows(pool, "SELECT id, name FROM assets WHERE workspace_id = $1 AND name ILIKE $2 ORDER BY name, id", [caller.workspaceId, pattern])
  ]);
  return json(200, { scenes, assets: assets2 });
});

// server/routes/versions.ts
var DAY_MS = 864e5;
var VIEWER_HTML = readFileSync(new URL("./viewer.html", import.meta.url));
async function loadVersion(caller, versionId) {
  const version = await one(pool, "SELECT * FROM versions WHERE id = $1 AND workspace_id = $2", [versionId, caller.workspaceId]);
  if (!version) throw notFound();
  return version;
}
function instantWithin(value, field, minMs, maxMs, message2) {
  const at = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  const lead = at.getTime() - Date.now();
  if (Number.isNaN(lead) || lead < minMs || lead > maxMs) throw invalid({ [field]: message2 });
  return new Date(Math.floor(at.getTime() / 1e3) * 1e3);
}
route("GET", "/api/scenes/:sceneId/versions", async ({ caller, params }) => {
  const scene = await loadScene(pool, caller.workspaceId, params.sceneId);
  authorize(caller, "scene.read");
  const versions = await rows(pool, "SELECT * FROM versions WHERE scene_id = $1 ORDER BY number", [scene.id]);
  return json(200, { versions: await versionsOut(pool, versions) });
});
route("POST", "/api/scenes/:sceneId/versions", async (ctx) => {
  const { caller } = ctx;
  const scene = await loadScene(pool, caller.workspaceId, ctx.params.sceneId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  const label = bodyOf(ctx).label;
  if (!isName(label, 60)) throw invalid({ label: "Use 1 to 60 characters" });
  const id = newId("ver");
  const seq = scene.latest_seq;
  const snapshot = { seq, graph: scene.graph, hash: graphHash(scene.graph) };
  await putObject(keys.snapshot(caller.workspaceId, scene.id, id), Buffer.from(JSON.stringify(snapshot)), "application/json");
  const author = authorOf(caller);
  const version = await transaction(async (client) => {
    await client.query("SELECT id FROM scenes WHERE id = $1 FOR UPDATE", [scene.id]);
    const [row] = await rows(
      client,
      `INSERT INTO versions (id, scene_id, workspace_id, number, label, state, seq, created_by_kind, created_by_id, created_by_name, created_at)
       VALUES ($1, $2, $3, (SELECT coalesce(max(number), 0) + 1 FROM versions WHERE scene_id = $2), $4, 'draft', $5, $6, $7, $8, now()) RETURNING *`,
      [id, scene.id, caller.workspaceId, label, seq, author.kind, author.id, author.name]
    );
    await audit(client, caller.workspaceId, author, "version.saved", { type: "version", id });
    return row;
  });
  await announceVersions(pool, [version]);
  const [out] = await versionsOut(pool, [version]);
  return json(201, out);
});
async function move(caller, version, step, action, extra = {}) {
  const state = nextState(version.state, step);
  const updated = await transaction(async (client) => {
    const [row] = await rows(
      client,
      `UPDATE versions SET state = $2, publish_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE publish_at END,
       scheduled_by = CASE WHEN $3::boolean THEN $5 ELSE scheduled_by END WHERE id = $1 AND state = $6 RETURNING *`,
      [version.id, state, "publishAt" in extra, extra.publishAt ?? null, extra.publishAt ? caller.id : null, version.state]
    );
    if (!row) throw invalidTransition(version.state, state);
    await audit(client, caller.workspaceId, authorOf(caller), action, { type: "version", id: version.id });
    return row;
  });
  await announceVersions(pool, [updated]);
  return updated;
}
var versionReply = async (row) => json(200, (await versionsOut(pool, [row]))[0]);
route("POST", "/api/versions/:versionId/submit", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  return versionReply(await move(caller, version, "submit", "version.submitted"));
});
route("POST", "/api/versions/:versionId/approve", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorizeApproval(caller, version.created_by_id);
  await assertWritable(caller.workspaceId);
  if (version.state !== "in_review") throw conflict("not_in_review");
  const inserted = await transaction(async (client) => {
    const added = await client.query(
      "INSERT INTO approvals (version_id, member_id, member_name, at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING",
      [version.id, caller.id, caller.name]
    );
    if (added.rowCount) await audit(client, caller.workspaceId, authorOf(caller), "version.approved", { type: "version", id: version.id });
    return (added.rowCount ?? 0) > 0;
  });
  if (inserted) await announceVersions(pool, [version]);
  return versionReply(version);
});
route("POST", "/api/versions/:versionId/schedule", async (ctx) => {
  const { caller } = ctx;
  const version = await loadVersion(caller, ctx.params.versionId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  nextState(version.state, "schedule");
  const approved = await one(pool, "SELECT 1 FROM approvals WHERE version_id = $1 AND member_id <> $2", [version.id, version.created_by_id]);
  if (!approved) throw conflict("approval_required");
  const other = await one(pool, "SELECT 1 FROM versions WHERE scene_id = $1 AND state = 'scheduled' AND id <> $2", [version.scene_id, version.id]);
  if (other) throw conflict("another_version_scheduled");
  const publishAt = instantWithin(bodyOf(ctx).publishAt, "publishAt", 5e3, 365 * DAY_MS, "Pick a time between 5 seconds and 365 days from now");
  if (!await readSnapshot(version)) throw unavailable("file_storage");
  const updated = await move(caller, version, "schedule", "version.scheduled", { publishAt });
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const scene = await loadScene(pool, caller.workspaceId, version.scene_id);
  if (caller.kind === "member") {
    const when = localTime(isoSecond(publishAt), ws.time_zone);
    await enqueueMail(pool, {
      to: [caller.email],
      subject: `Scheduled: ${scene.name} v${version.number} goes live ${when}`,
      body: `${scene.name} v${version.number} \xB7 ${version.label} is scheduled to go live ${when}.

Orrery Studio`
    });
  }
  return versionReply(updated);
});
route("POST", "/api/versions/:versionId/unschedule", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorize(caller, "version.manage");
  return versionReply(await move(caller, version, "unschedule", "version.unscheduled", { publishAt: null }));
});
route("POST", "/api/versions/:versionId/withdraw", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorize(caller, "version.manage");
  return versionReply(await move(caller, version, "withdraw", "version.withdrawn"));
});
var ASSET_EXTENSIONS = { "model/gltf-binary": "glb", "image/png": "png", "image/jpeg": "jpg" };
route("POST", "/api/versions/:versionId/exports", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  if (version.state !== "published" || !version.published_at) throw conflict("not_published");
  const scene = await loadScene(pool, caller.workspaceId, version.scene_id);
  const graph = await graphAt(scene, version.seq);
  const payload = publishedPayload(scene.name, version, version.published_at, graph);
  const assetIds = [...new Set(graph.nodes.flatMap((n) => n.assetId ? [n.assetId] : []))];
  const assets2 = await rows(pool, "SELECT id, content_type FROM assets WHERE workspace_id = $1 AND id = ANY($2)", [caller.workspaceId, assetIds]);
  const entries = [{ name: "scene.json", data: Buffer.from(JSON.stringify(payload, null, 2)) }, { name: "viewer.html", data: VIEWER_HTML }];
  for (const asset of assets2) {
    const file = await getObject(keys.asset(caller.workspaceId, asset.id));
    if (file) entries.push({ name: `assets/${asset.id}.${ASSET_EXTENSIONS[asset.content_type] ?? "bin"}`, data: file });
  }
  const archive = zip(entries);
  const id = newId("exp");
  await putObject(keys.exportBundle(caller.workspaceId, id), archive, "application/zip");
  await transaction(async (client) => {
    await client.query("INSERT INTO exports (id, workspace_id, version_id, bytes, created_at) VALUES ($1, $2, $3, $4, now())", [id, caller.workspaceId, version.id, archive.length]);
    await audit(client, caller.workspaceId, authorOf(caller), "export.created", { type: "export", id });
  });
  return json(201, { id, versionId: version.id, bytes: archive.length });
});
route("GET", "/api/exports/:exportId", async ({ caller, params }) => {
  const exported = await one(pool, "SELECT id, version_id FROM exports WHERE id = $1 AND workspace_id = $2", [params.exportId, caller.workspaceId]);
  if (!exported) throw notFound();
  authorize(caller, "scene.read");
  const archive = await getObject(keys.exportBundle(caller.workspaceId, exported.id));
  if (!archive) throw notFound();
  return bytes(archive, "application/zip", { "Content-Disposition": `attachment; filename="orrery-export-${exported.id}.zip"` });
});
var linkStatus = (l, now) => l.revoked_at ? "revoked" : l.expires_at <= now ? "expired" : "active";
route("GET", "/api/versions/:versionId/review-links", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorize(caller, "scene.read");
  const now = /* @__PURE__ */ new Date();
  const links = await rows(pool, "SELECT * FROM review_links WHERE version_id = $1 ORDER BY created_at", [version.id]);
  return json(200, {
    links: links.map((l) => ({
      id: l.id,
      expiresAt: isoSecond(l.expires_at),
      status: linkStatus(l, now),
      createdBy: { kind: l.created_by_kind, id: l.created_by_id, name: l.created_by_name }
    }))
  });
});
var linkReply = (link, token2, status2 = 200) => json(status2, { id: link.id, token: token2, url: `/review/${token2}`, expiresAt: isoSecond(link.expires_at) });
route("POST", "/api/versions/:versionId/review-links", async (ctx) => {
  const { caller } = ctx;
  const version = await loadVersion(caller, ctx.params.versionId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  if (!(await loadWorkspace(pool, caller.workspaceId)).review_links_enabled) throw conflict("review_links_disabled");
  if (!REVIEWABLE.includes(version.state)) throw conflict("version_not_reviewable");
  const expiresAt = instantWithin(bodyOf(ctx).expiresAt, "expiresAt", 1e4, 30 * DAY_MS, "Pick a time between 10 seconds and 30 days from now");
  const token2 = randomToken(32);
  const author = authorOf(caller);
  const link = await transaction(async (client) => {
    const [row] = await rows(
      client,
      `INSERT INTO review_links (id, workspace_id, version_id, token_hash, expires_at, created_by_kind, created_by_id, created_by_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING *`,
      [newId("rl"), caller.workspaceId, version.id, secretHash(token2), expiresAt, author.kind, author.id, author.name]
    );
    await audit(client, caller.workspaceId, author, "review_link.created", { type: "review_link", id: row.id });
    return row;
  });
  return linkReply(link, token2, 201);
});
async function loadLink(caller, linkId) {
  const link = await one(pool, "SELECT * FROM review_links WHERE id = $1 AND workspace_id = $2", [linkId, caller.workspaceId]);
  if (!link) throw notFound();
  return link;
}
route("POST", "/api/review-links/:linkId/regenerate", async ({ caller, params }) => {
  const link = await loadLink(caller, params.linkId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  if (link.revoked_at) throw conflict("invalid_transition", { from: "revoked", to: "active" });
  const token2 = randomToken(32);
  await transaction(async (client) => {
    await client.query("UPDATE review_links SET token_hash = $2 WHERE id = $1", [link.id, secretHash(token2)]);
    await audit(client, caller.workspaceId, authorOf(caller), "review_link.regenerated", { type: "review_link", id: link.id });
  });
  return linkReply(link, token2);
});
route("DELETE", "/api/review-links/:linkId", async ({ caller, params }) => {
  const link = await loadLink(caller, params.linkId);
  authorize(caller, "version.manage");
  await transaction(async (client) => {
    await client.query("UPDATE review_links SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1", [link.id]);
    await audit(client, caller.workspaceId, authorOf(caller), "review_link.revoked", { type: "review_link", id: link.id });
  });
  return noContent();
});
async function reviewTarget(token2) {
  const link = await one(pool, "SELECT * FROM review_links WHERE token_hash = $1", [secretHash(token2)]);
  if (!link || link.revoked_at) throw notFound();
  const ws = await loadWorkspace(pool, link.workspace_id);
  const version = await one(pool, "SELECT * FROM versions WHERE id = $1", [link.version_id]);
  if (!ws.review_links_enabled || !version || !REVIEWABLE.includes(version.state)) throw notFound();
  if (link.expires_at <= /* @__PURE__ */ new Date()) throw linkExpired();
  const scene = await loadScene(pool, link.workspace_id, version.scene_id);
  return { version, sceneName: scene.name, graph: await graphAt(scene, version.seq) };
}
publicRoute("GET", "/api/review/:token", async ({ params }) => {
  const { version, sceneName, graph } = await reviewTarget(params.token);
  return json(200, { scene: { name: sceneName }, version: { number: version.number, label: version.label, state: version.state }, graph });
});
async function embedTarget(embedId) {
  const scene = await one(pool, "SELECT id, workspace_id, name FROM scenes WHERE embed_id = $1", [embedId]);
  if (!scene) throw notFound();
  const sub = await currentSubscription(scene.workspace_id);
  if (effectiveState(sub, /* @__PURE__ */ new Date()) === "cancelled") throw gone();
  const version = await one(pool, "SELECT * FROM versions WHERE scene_id = $1 AND state = 'published' ORDER BY number DESC LIMIT 1", [scene.id]);
  if (!version || !version.published_at) throw gone();
  let payload = cachedEmbed(embedId, version.id);
  if (!payload) {
    const stored2 = await getObject(keys.published(scene.workspace_id, embedId));
    if (!stored2) throw gone();
    const parsed = JSON.parse(stored2.toString("utf8"));
    rememberEmbed(embedId, version.id, parsed);
    payload = parsed;
  }
  return { scene, version, payload };
}
publicRoute("GET", "/api/embed/:embedId", async ({ params }) => json(200, (await embedTarget(params.embedId)).payload));
publicRoute("GET", "/api/embed/:embedId/assets/:assetId", async ({ params }) => {
  const { scene, payload } = await embedTarget(params.embedId);
  if (!payload.graph.nodes.some((n) => n.assetId === params.assetId)) throw notFound();
  const asset = await one(pool, "SELECT content_type FROM assets WHERE id = $1 AND workspace_id = $2", [params.assetId, scene.workspace_id]);
  const file = asset ? await getObject(keys.asset(scene.workspace_id, params.assetId)) : null;
  if (!asset || !file) throw notFound();
  return bytes(file, asset.content_type, { "Cache-Control": "public, max-age=3600" });
});

// server/pages.ts
var PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
var TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
var assets = new Map(walk(join(PUBLIC_DIR, "assets")).map((file) => {
  const url = `/assets/${relative(join(PUBLIC_DIR, "assets"), file).split(sep).join("/")}`;
  const extension = file.slice(file.lastIndexOf("."));
  return [url, { body: readFileSync2(file), type: TYPES[extension] ?? "application/octet-stream" }];
}));
var PAGES = [
  { pattern: /^\/$/, title: "Orrery Studio \xB7 3D scenes your whole team can trace" },
  { pattern: /^\/pricing$/, title: "Pricing \xB7 Orrery Studio" },
  { pattern: /^\/signup$/, title: "Start your trial \xB7 Orrery Studio" },
  { pattern: /^\/login$/, title: "Sign in \xB7 Orrery Studio" },
  { pattern: /^\/invite\/[^/]+$/, title: "Join workspace \xB7 Orrery Studio" },
  { pattern: /^\/app(\/(scenes|members|agents|audit|billing|settings))?\/?$/, title: "Orrery Studio" },
  { pattern: /^\/app\/scenes\/[^/]+$/, title: "Editor \xB7 Orrery Studio" },
  { pattern: /^\/review\/[^/]+$/, title: "Review copy \xB7 Orrery Studio" },
  { pattern: /^\/embed\/[^/]+$/, title: "Orrery Studio embed" }
];
var escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
async function stillFor(ctx) {
  const [, area, kind, id] = ctx.path.split("/");
  let key = null;
  if (area === "embed" && kind) {
    const { scene, version } = await embedTarget(kind);
    if (version.has_thumbnail) key = keys.thumbnail(scene.workspace_id, scene.id, version.id);
  } else if (area === "review" && kind) {
    const { version } = await reviewTarget(kind);
    if (version.has_thumbnail) key = keys.thumbnail(version.workspace_id, version.scene_id, version.id);
  } else if (area === "app" && kind === "scenes" && id) {
    const caller = await authenticate2(ctx.headers);
    const version = caller ? await one(
      pool,
      `SELECT v.id, v.scene_id, v.workspace_id FROM versions v WHERE v.scene_id = $1 AND v.workspace_id = $2 AND v.has_thumbnail
       ORDER BY v.number DESC LIMIT 1`,
      [decodeURIComponent(id), caller.workspaceId]
    ) : void 0;
    if (version) key = keys.thumbnail(version.workspace_id, version.scene_id, version.id);
  }
  const image = key ? await getObject(key, 1500) : null;
  return image ? `data:image/png;base64,${image.toString("base64")}` : null;
}
var FONTS = [
  "space-grotesk-latin-500-normal",
  "space-grotesk-latin-700-normal",
  "ibm-plex-sans-latin-400-normal",
  "ibm-plex-sans-latin-500-normal",
  "ibm-plex-sans-latin-600-normal",
  "ibm-plex-mono-latin-400-normal",
  "ibm-plex-mono-latin-500-normal"
];
function shell(title, still) {
  const boot = still ? `<script id="orrery-still" type="application/json">${JSON.stringify({ src: still })}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${FONTS.map((f) => `<link rel="preload" href="/assets/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join("\n")}
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body>
<div id="root"></div>
${boot}
</body>
</html>`;
}
async function fallback(ctx) {
  if (ctx.method !== "GET" && ctx.method !== "HEAD") return null;
  const asset = assets.get(ctx.path);
  if (asset) return bytes(asset.body, asset.type, { "Cache-Control": "public, max-age=3600" });
  const page = PAGES.find((p) => p.pattern.test(ctx.path));
  if (!page) return null;
  const still = await stillFor(ctx).catch(() => null);
  return bytes(shell(page.title, still), "text/html; charset=utf-8", { "Cache-Control": "no-store" });
}

// server/services/killbill.ts
var BASE = `${config.killbill.url}/1.0/kb`;
var AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
var AUTO_INVOICING_OFF = "00000000-0000-0000-0000-000000000002";
async function call2(method, path, options = {}) {
  const url = `${BASE}${path}${options.query ? `?${new URLSearchParams(options.query)}` : ""}`;
  const headers = {
    authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`,
    "x-killbill-apikey": config.killbill.apiKey,
    "x-killbill-apisecret": config.killbill.apiSecret,
    "x-killbill-createdby": "orrery-studio",
    accept: "application/json"
  };
  let body;
  if (options.json !== void 0) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  if (options.xml !== void 0) {
    headers["content-type"] = "text/xml";
    body = options.xml;
  }
  let response;
  try {
    response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(3e4) });
  } catch {
    throw unavailable("billing");
  }
  if (response.status >= 500 || response.status === 401) throw unavailable("billing");
  return response;
}
async function expectOk(response, what) {
  if (response.ok) return response;
  console.error(`Kill Bill ${what} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  throw unavailable("billing");
}
function malformed(what) {
  console.error(`Kill Bill returned a malformed ${what}`);
  throw unavailable("billing");
}
async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
var createdId = (response) => (response.headers.get("location") ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
var str = (value) => typeof value === "string" ? value : "";
var num = (value) => typeof value === "number" ? value : Number(value ?? 0);
var toCents = (amount) => Math.round(num(amount) * 100);
var decimal = (cents) => `${Math.trunc(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
var toDollars = (cents) => Number(decimal(cents));
function catalogXml() {
  const plan = (name, product, period, price) => `
    <plan name="${name}"><product>${product}</product>
      <finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration>
        <recurring><billingPeriod>${period === "monthly" ? "MONTHLY" : "ANNUAL"}</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>${price}</value></price></recurringPrice></recurring>
      </finalPhase></plan>`;
  const names = [];
  const plans = PLAN_IDS.flatMap((p) => PERIODS.flatMap((period) => {
    names.push(killbillPlan(p, period), killbillSeatPlan(p, period));
    const prices = PLAN_CATALOG[p].prices[period];
    return [
      plan(killbillPlan(p, period), PLAN_CATALOG[p].name, period, decimal(prices.base)),
      plan(killbillSeatPlan(p, period), "Seat", period, decimal(prices.seat))
    ];
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>OrreryStudio</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products>
    <product name="Team"><category>BASE</category><available><addonProduct>Seat</addonProduct></available></product>
    <product name="Business"><category>BASE</category><available><addonProduct>Seat</addonProduct></available></product>
    <product name="Seat"><category>ADD_ON</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>${plans.join("")}
  </plans>
  <priceLists><defaultPriceList name="DEFAULT"><plans>${names.map((n) => `<plan>${n}</plan>`).join("")}</plans></defaultPriceList></priceLists>
</catalog>`;
}
async function catalogHasPlans() {
  const body = await readJson(await expectOk(await call2("GET", "/catalog"), "catalog read"));
  return JSON.stringify(body).includes(`"${killbillSeatPlan("business", "annual")}"`);
}
var catalogReady = null;
function ensureCatalog() {
  catalogReady ??= transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('orrery.killbill.catalog'))");
    if (await catalogHasPlans()) return;
    await expectOk(await call2("POST", "/catalog/xml", { xml: catalogXml() }), "catalog upload");
  }).catch((error) => {
    catalogReady = null;
    throw error;
  });
  return catalogReady;
}
function account(body) {
  if (!isRecord(body)) malformed("account");
  return { accountId: str(body.accountId), paymentMethodId: str(body.paymentMethodId), referenceTime: str(body.referenceTime) };
}
async function findAccount(workspaceId) {
  const response = await call2("GET", "/accounts", { query: { externalKey: workspaceId } });
  if (response.status === 404) return null;
  return account(await readJson(await expectOk(response, "account lookup")));
}
async function openAccount(workspaceId, name, email) {
  const existing = await findAccount(workspaceId);
  if (existing?.paymentMethodId) return existing;
  const id = existing?.accountId ?? createdId(await expectOk(
    await call2("POST", "/accounts", { json: { name, email, externalKey: workspaceId, currency: "USD" } }),
    "account create"
  ));
  await expectOk(await call2("POST", `/accounts/${id}/tags`, { json: [AUTO_PAY_OFF] }), "AUTO_PAY_OFF tag");
  await expectOk(await call2("POST", `/accounts/${id}/paymentMethods`, {
    query: { isDefault: "true" },
    json: { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: {} }
  }), "payment method");
  return account(await readJson(await expectOk(await call2("GET", `/accounts/${id}`), "account read")));
}
function invoiceOf(body) {
  if (!isRecord(body)) malformed("invoice");
  const items = Array.isArray(body.items) ? body.items.filter(isRecord) : [];
  return {
    invoiceId: str(body.invoiceId),
    accountId: str(body.accountId),
    invoiceNumber: String(body.invoiceNumber ?? ""),
    invoiceDate: str(body.invoiceDate),
    amountCents: toCents(body.amount),
    balanceCents: toCents(body.balance),
    items: items.map((i) => ({ description: str(i.prettyPlanName) || str(i.planName) || str(i.itemType), amountCents: toCents(i.amount) }))
  };
}
async function accountInvoices(accountId) {
  const body = await readJson(await expectOk(await call2("GET", `/accounts/${accountId}/invoices`, { query: { includeInvoiceComponents: "true" } }), "invoice list"));
  return Array.isArray(body) ? body.map(invoiceOf) : [];
}
async function invoice(invoiceId) {
  const response = await call2("GET", `/invoices/${invoiceId}`);
  if (response.status === 404) return null;
  return invoiceOf(await readJson(await expectOk(response, "invoice read")));
}
async function newInvoice(accountId, known) {
  const deadline = Date.now() + 3e4;
  while (Date.now() < deadline) {
    const fresh = (await accountInvoices(accountId)).find((i) => !known.has(i.invoiceId));
    if (fresh) return fresh;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw unavailable("billing");
}
async function activeSubscriptions(accountId) {
  const body = await readJson(await expectOk(await call2("GET", `/accounts/${accountId}/bundles`), "bundle list"));
  const subs = [];
  for (const bundle of Array.isArray(body) ? body.filter(isRecord) : []) {
    for (const s of Array.isArray(bundle.subscriptions) ? bundle.subscriptions.filter(isRecord) : []) {
      if (s.state !== "ACTIVE") continue;
      subs.push({
        subscriptionId: str(s.subscriptionId),
        bundleId: str(s.bundleId),
        planName: str(s.planName),
        category: str(s.productCategory),
        quantity: typeof s.quantity === "number" ? s.quantity : 1,
        chargedThroughDate: str(s.chargedThroughDate)
      });
    }
  }
  return subs;
}
async function startSubscription(accountId, plan, period, extraSeats) {
  const entries = [{ accountId, planName: killbillPlan(plan, period) }];
  if (extraSeats > 0) entries.push({ accountId, planName: killbillSeatPlan(plan, period), quantity: extraSeats });
  await expectOk(await call2("POST", "/subscriptions/createSubscriptionWithAddOns", { json: entries }), "subscription create");
}
async function previewChange(accountId, sub, planName) {
  const body = await readJson(await expectOk(await call2("POST", "/invoices/dryRun", {
    query: { accountId },
    json: { dryRunType: "SUBSCRIPTION_ACTION", dryRunAction: "CHANGE", planName, subscriptionId: sub.subscriptionId, bundleId: sub.bundleId, billingPolicy: "IMMEDIATE" }
  }), "dry run"));
  if (!isRecord(body) || typeof body.amount !== "number") malformed("dry-run invoice");
  return toCents(body.amount);
}
async function changePlan(sub, planName, policy) {
  await expectOk(await call2("PUT", `/subscriptions/${sub.subscriptionId}`, { query: { billingPolicy: policy }, json: { planName } }), "plan change");
}
async function asOneInvoice(accountId, work) {
  await expectOk(await call2("POST", `/accounts/${accountId}/tags`, { json: [AUTO_INVOICING_OFF] }), "AUTO_INVOICING_OFF tag");
  try {
    await work();
  } finally {
    await expectOk(await call2("DELETE", `/accounts/${accountId}/tags`, { query: { tagDef: AUTO_INVOICING_OFF } }), "AUTO_INVOICING_OFF removal");
  }
}
async function addSeats(accountId, bundleId, planName, quantity, startDate) {
  await expectOk(await call2("POST", "/subscriptions", {
    query: startDate ? { entitlementDate: startDate, billingDate: startDate } : {},
    json: { accountId, bundleId, planName, quantity }
  }), "seat add-on");
}
async function cancel(sub, policy) {
  await expectOk(await call2("DELETE", `/subscriptions/${sub.subscriptionId}`, { query: { entitlementPolicy: policy, billingPolicy: policy } }), "cancel");
}
function endOfTerm(acct, sub) {
  const time = acct.referenceTime.slice(11, 19) || "00:00:00";
  return /* @__PURE__ */ new Date(`${sub.chargedThroughDate}T${time}Z`);
}
async function purchase(acct, invoiceId, amountCents, externalKey) {
  const response = await call2("POST", `/accounts/${acct.accountId}/payments`, {
    query: { paymentMethodId: acct.paymentMethodId, controlPluginName: "__INVOICE_PAYMENT_CONTROL_PLUGIN__", pluginProperty: `IPCD_INVOICE_ID=${invoiceId}` },
    json: { transactionType: "PURCHASE", amount: toDollars(amountCents), currency: "USD", transactionExternalKey: externalKey, paymentExternalKey: externalKey }
  });
  if (response.status === 422) throw unavailable("billing");
  return createdId(await expectOk(response, "purchase"));
}
async function chargeback(paymentId, amountCents) {
  await expectOk(await call2("POST", `/invoicePayments/${paymentId}/chargebacks`, {
    json: { transactionType: "CHARGEBACK", amount: toDollars(amountCents), currency: "USD" }
  }), "chargeback");
}
async function refund(paymentId, amountCents, externalKey) {
  await expectOk(await call2("POST", `/payments/${paymentId}/refunds`, {
    json: { transactionType: "REFUND", amount: toDollars(amountCents), currency: "USD", transactionExternalKey: externalKey }
  }), "refund");
}

// server/seed.ts
import { randomBytes as randomBytes4 } from "node:crypto";
var PASSWORD = "orrery-demo-2026";
var TRIAL_MS = 14 * 864e5;
var TOKEN_EXPIRY = /* @__PURE__ */ new Date("2027-12-31T00:00:00Z");
var mesh = (id, name, primitive, fields = {}) => ({
  id,
  name,
  kind: "mesh",
  parentId: "n_root",
  primitive,
  assetId: null,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  materialLayers: [],
  visible: true,
  ...fields
});
var jun = { kind: "member", id: "mem_jun", name: "Jun Okafor" };
var sol = { kind: "member", id: "mem_sol", name: "Sol Navarro" };
var poser = { kind: "agent", id: "tok_kestrel_poser", name: "Catalogue poser" };
var lena = { kind: "member", id: "mem_lena", name: "Lena Moss" };
var cup = [0.45, 0.45, 0.2];
var WORKSPACES = [
  {
    id: "ws_kestrel",
    name: "Kestrel Audio",
    timeZone: "Europe/Berlin",
    signingSecret: "whsec_kestrel_4c1e9a7b20d35f86",
    members: [
      { id: "mem_mara", name: "Mara Lindqvist", email: "mara@kestrel.test", role: "owner" },
      { id: "mem_theo", name: "Theo Brandt", email: "theo@kestrel.test", role: "admin" },
      { id: "mem_priya", name: "Priya Raman", email: "priya@kestrel.test", role: "billing_manager" },
      { id: "mem_jun", name: "Jun Okafor", email: "jun@kestrel.test", role: "editor" },
      { id: "mem_sol", name: "Sol Navarro", email: "sol@kestrel.test", role: "editor" },
      { id: "mem_ines", name: "Ines Duarte", email: "ines@kestrel.test", role: "viewer" }
    ],
    tokens: [
      { id: "tok_kestrel_poser", name: "Catalogue poser", scope: "edit", secret: "orr_kestrelposer3f9a1c7e5b2d4a6081c9e7f2ab", issuedBy: { id: "mem_theo", name: "Theo Brandt" } },
      { id: "tok_kestrel_qa", name: "Framing QA", scope: "read", secret: "orr_kestrelframingqa8b2e4d6f1a3c5e7092b4cd", issuedBy: { id: "mem_theo", name: "Theo Brandt" } }
    ],
    scenes: [
      {
        id: "sc_arc_one",
        name: "Arc One headphones",
        ops: [
          { author: jun, op: { type: "node.add", payload: { node: mesh("n_headband", "Headband", "cylinder", { position: [0, 0.8, 0], rotation: [0, 0, 90], scale: [0.1, 1.2, 0.1] }) } } },
          { author: jun, op: { type: "node.add", payload: { node: mesh("n_cup_l", "Left cup", "sphere", { scale: cup }) } } },
          { author: jun, op: { type: "node.add", payload: { node: mesh("n_cup_r", "Right cup", "sphere", { scale: cup }) } } },
          { author: poser, op: { type: "transform.set", payload: { id: "n_cup_l", position: [-0.6, 0, 0] } } },
          { author: poser, op: { type: "transform.set", payload: { id: "n_cup_r", position: [0.6, 0, 0] } } },
          { author: sol, op: { type: "material.layer.add", payload: { id: "n_headband", layer: { id: "l_band_base", type: "base", color: [0.12, 0.12, 0.11], roughness: 0.6, metalness: 0.1 } } } },
          { author: sol, op: { type: "state.add", payload: { state: { id: "st_hover", name: "Hover" } } } },
          { author: sol, op: { type: "state.override.set", payload: { stateId: "st_hover", nodeId: "n_cup_l", field: "rotation", value: [0, 15, 0] } } },
          { author: sol, op: { type: "transition.set", payload: { from: "rest", to: "st_hover", trigger: "hover", durationMs: 420 } } }
        ]
      },
      { id: "sc_arc_case", name: "Arc One case", ops: [] }
    ]
  },
  {
    id: "ws_fernhall",
    name: "Fernhall Furniture",
    timeZone: "America/Chicago",
    signingSecret: "whsec_fernhall_9b2d6e1f73a04c58",
    members: [
      { id: "mem_ezra", name: "Ezra Cole", email: "ezra@fernhall.test", role: "owner" },
      { id: "mem_lena", name: "Lena Moss", email: "lena@fernhall.test", role: "editor" },
      { id: "mem_ravi", name: "Ravi Shah", email: "ravi@fernhall.test", role: "viewer" }
    ],
    tokens: [{ id: "tok_fernhall_poser", name: "Fernhall poser", scope: "edit", secret: "orr_fernhallposer6d1f3b5a7c9e2b4d608a1fde", issuedBy: { id: "mem_ezra", name: "Ezra Cole" } }],
    scenes: [
      { id: "sc_lowback", name: "Lowback lounge chair", ops: [{ author: lena, op: { type: "node.add", payload: { node: mesh("n_seat", "Seat", "box", { scale: [1, 0.3, 1] }) } } }] }
    ]
  }
];
var SEED_COMMENTS = [
  { workspace: "ws_kestrel", scene: "sc_arc_one", commentId: "cmt_kestrel_band", node: "n_headband", body: "Can the band read more matte in Hover?", authorId: "mem_ines", authorName: "Ines Duarte" },
  { workspace: "ws_fernhall", scene: "sc_lowback", commentId: "cmt_fernhall_seat", node: "n_seat", body: "Seat cushion looks too tall.", authorId: "mem_ravi", authorName: "Ravi Shah" }
];
async function seedWorkspace(client, ws, now, passwordHash) {
  await client.query(
    "INSERT INTO workspaces (id, name, time_zone, signing_secret, created_at) VALUES ($1, $2, $3, $4, $5)",
    [ws.id, ws.name, ws.timeZone, ws.signingSecret, now]
  );
  await client.query(
    "INSERT INTO subscriptions (workspace_id, state, plan, period, trial_ends_at) VALUES ($1, 'trial', 'team', 'monthly', $2)",
    [ws.id, new Date(now.getTime() + TRIAL_MS)]
  );
  for (const m of ws.members) {
    await client.query(
      "INSERT INTO members (id, workspace_id, name, email, password_hash, role, joined_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [m.id, ws.id, m.name, m.email, passwordHash, m.role, now]
    );
  }
  for (const t of ws.tokens) {
    await client.query(
      `INSERT INTO agent_tokens (id, workspace_id, name, scope, secret_hash, expires_at, issued_by_id, issued_by_name, created_at, warn_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        t.id,
        ws.id,
        t.name,
        t.scope,
        secretHash(t.secret),
        TOKEN_EXPIRY,
        t.issuedBy.id,
        t.issuedBy.name,
        now,
        new Date(TOKEN_EXPIRY.getTime() - config.tokenWarningLeadSeconds * 1e3)
      ]
    );
  }
  for (const scene of ws.scenes) {
    const base = starterGraph();
    const graph = structuredClone(base);
    const rowsToInsert = scene.ops.map(({ author, op }, i) => {
      const applied = applyOperation(graph, op);
      if (!applied.ok) throw new Error(`seed operation ${i + 1} of ${scene.id} does not apply: ${applied.message}`);
      return [scene.id, i + 1, `b_seed_${scene.id}_${i + 1}`, op.type, JSON.stringify(op.payload), JSON.stringify(applied.inverse), author.kind, author.id, author.name, now];
    });
    await client.query(
      "INSERT INTO scenes (id, workspace_id, name, base_graph, graph, latest_seq, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
      [scene.id, ws.id, scene.name, JSON.stringify(base), JSON.stringify(graph), scene.ops.length, now]
    );
    for (const values of rowsToInsert) {
      await client.query(
        "INSERT INTO ops (scene_id, seq, batch_id, type, payload, inverse, author_kind, author_id, author_name, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        values
      );
    }
  }
}
async function seed() {
  await withAdvisoryLock("orrery:seed", async () => {
    if (await one(pool, "SELECT 1 FROM workspaces WHERE id = 'ws_kestrel'")) return;
    const passwordHash = await hashPassword(PASSWORD);
    const now = new Date(Math.floor(Date.now() / 1e3) * 1e3);
    await transaction(async (client) => {
      for (const ws of WORKSPACES) await seedWorkspace(client, ws, now, passwordHash);
      await client.query(
        `INSERT INTO invites (id, workspace_id, email, role, token_hash, invited_by_kind, invited_by_id, invited_by_name, created_at, expires_at)
         VALUES ('inv_kestrel_ada', 'ws_kestrel', 'ada.kim@kestrel.test', 'viewer', $1, 'member', 'mem_theo', 'Theo Brandt', $2, $3)`,
        [secretHash(randomBytes4(32).toString("base64url")), now, new Date(now.getTime() + 7 * 864e5)]
      );
    });
  });
}
async function seedComments() {
  for (const comment of SEED_COMMENTS) {
    const existing = await list("comments", `commentId=${quote(comment.commentId)}`);
    if (existing.length === 0) await create("comments", { ...comment, mentions: [], resolved: false });
  }
}

// server/scheduler.ts
async function pendingChanges(now) {
  await pool.query(
    `UPDATE subscriptions SET plan = pending_change->>'plan', period = pending_change->>'period',
       extra_seats = (pending_change->>'extraSeats')::int, pending_change = NULL
     WHERE pending_change IS NOT NULL AND (pending_change->>'effectiveAt')::timestamptz <= $1`,
    [now]
  );
}
async function tokenWarnings(now) {
  await transaction(async (client) => {
    const due = await rows(
      client,
      `UPDATE agent_tokens t SET warned_at = $1 FROM workspaces w
       WHERE w.id = t.workspace_id AND t.warned_at IS NULL AND t.revoked_at IS NULL AND t.warn_at <= $1 AND t.expires_at > $1
       RETURNING t.name, t.expires_at, t.issued_by_id, t.workspace_id, w.time_zone`,
      [now]
    );
    for (const token2 of due) {
      const [recipient] = await rows(
        client,
        `SELECT email FROM members WHERE workspace_id = $2 AND removed_at IS NULL AND (id = $1 OR role = 'owner')
         ORDER BY (id = $1) DESC LIMIT 1`,
        [token2.issued_by_id, token2.workspace_id]
      );
      await enqueueMail(client, {
        to: [recipient.email],
        subject: `Agent token ${token2.name} expires soon`,
        body: `The agent token ${token2.name} expires ${localTime(isoSecond(token2.expires_at), token2.time_zone)}. Issue a new token before then to keep the agent working.

Orrery Studio`
      });
    }
  });
}
var collaborationReady = false;
var billingReady = false;
var attempt = (work, what) => work().then(() => true, (error) => {
  console.error(`${what} deferred:`, error instanceof Error ? error.message : error);
  return false;
});
async function providerSetup() {
  if (!collaborationReady) collaborationReady = await attempt(() => ensureCollections().then(seedComments), "PocketBase setup");
  if (!billingReady) billingReady = await attempt(ensureCatalog, "Kill Bill catalog");
}
async function pass() {
  const now = /* @__PURE__ */ new Date();
  for (const step of [() => settleClock(now), () => pendingChanges(now), () => tokenWarnings(now), publishDueVersions, deliverQueuedMail, providerSetup]) {
    try {
      await step();
    } catch (error) {
      console.error("scheduler step deferred:", error instanceof Error ? error.message : error);
    }
  }
}
function startScheduler() {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    pass().finally(() => {
      running = false;
    });
  }, 500);
}

// server/routes/members.ts
var INVITABLE = ["admin", "billing_manager", "editor", "viewer"];
var INVITE_DAYS = 7;
var openInvite = "accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2";
route("GET", "/api/members", async ({ caller }) => {
  authorize(caller, "workspace.read");
  const members = await rows(pool, "SELECT * FROM members WHERE workspace_id = $1 AND removed_at IS NULL ORDER BY joined_at, id", [caller.workspaceId]);
  const invites = await rows(pool, `SELECT * FROM invites WHERE workspace_id = $1 AND ${openInvite} ORDER BY created_at`, [caller.workspaceId, /* @__PURE__ */ new Date()]);
  return json(200, {
    members: members.map(memberOut),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: isoSecond(i.expires_at),
      invitedBy: { kind: i.invited_by_kind, id: i.invited_by_id, name: i.invited_by_name }
    }))
  });
});
route("POST", "/api/members/invites", async (ctx) => {
  const body = bodyOf(ctx);
  authorizeInvite(ctx.caller, String(body.role));
  const { caller } = ctx;
  await assertWritable(caller.workspaceId);
  const errors = {};
  if (typeof body.email !== "string" || !EMAIL.test(body.email)) errors.email = "Enter an email address";
  if (!INVITABLE.some((r) => r === body.role)) errors.role = "Choose admin, billing manager, editor or viewer";
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const email = String(body.email);
  const role = String(body.role);
  const token2 = randomToken();
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const invite = await transaction(async (client) => {
    await lockSeats(client, ws.id);
    const now = /* @__PURE__ */ new Date();
    const duplicate = await one(
      client,
      `SELECT 1 FROM members WHERE workspace_id = $1 AND lower(email) = lower($3) AND removed_at IS NULL
       UNION ALL SELECT 1 FROM invites WHERE workspace_id = $1 AND lower(email) = lower($3) AND ${openInvite}`,
      [ws.id, now, email]
    );
    if (duplicate) throw conflict("already_member");
    const used = await seatsUsed(client, ws.id, now);
    const purchased = seatsPurchased(await loadSubscription(client, ws.id));
    if (used >= purchased) throw conflict("no_seats_left", { seatsUsed: used, seatsPurchased: purchased });
    const [row] = await rows(
      client,
      `INSERT INTO invites (id, workspace_id, email, role, token_hash, invited_by_kind, invited_by_id, invited_by_name, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'member', $6, $7, $8, $9) RETURNING *`,
      [newId("inv"), ws.id, email, role, secretHash(token2), caller.id, caller.name, now, new Date(now.getTime() + INVITE_DAYS * 864e5)]
    );
    await audit(client, ws.id, authorOf(caller), "member.invited", { type: "invite", id: row.id });
    await enqueueMail(client, {
      to: [email],
      fromName: `${caller.name} via Orrery Studio`,
      subject: `Join ${ws.name} on Orrery Studio`,
      body: `${caller.name} invited you to join ${ws.name} on Orrery Studio as ${role.replace("_", " ")}.

Choose a password and join here:
${config.publicUrl}/invite/${token2}

The invitation expires in ${INVITE_DAYS} days.`
    });
    return row;
  });
  return json(201, { id: invite.id, email: invite.email, role: invite.role, expiresAt: isoSecond(invite.expires_at) });
});
route("DELETE", "/api/members/invites/:inviteId", async ({ caller, params }) => {
  const invite = await one(pool, "SELECT * FROM invites WHERE id = $1 AND workspace_id = $2", [params.inviteId, caller.workspaceId]);
  if (!invite) throw notFound();
  authorize(caller, "member.invite");
  await transaction(async (client) => {
    await client.query("UPDATE invites SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1", [invite.id]);
    await audit(client, caller.workspaceId, authorOf(caller), "invite.revoked", { type: "invite", id: invite.id });
  });
  return noContent();
});
async function openInviteByToken(token2) {
  const invite = await one(pool, `SELECT * FROM invites WHERE token_hash = $1 AND ${openInvite}`, [secretHash(token2), /* @__PURE__ */ new Date()]);
  if (!invite) throw notFound();
  return invite;
}
publicRoute("GET", "/api/invites/:token", async ({ params }) => {
  const invite = await openInviteByToken(params.token);
  const ws = await loadWorkspace(pool, invite.workspace_id);
  return json(200, { workspace: { name: ws.name }, email: invite.email, role: invite.role });
});
publicRoute("POST", "/api/invites/:token/accept", async (ctx) => {
  const invite = await openInviteByToken(ctx.params.token);
  await assertWritable(invite.workspace_id);
  const body = bodyOf(ctx);
  if (await emailTaken(pool, invite.email)) throw conflict("email_taken");
  const errors = {};
  if (!isName(body.name)) errors.name = "Use 1 to 80 characters";
  if (typeof body.password !== "string" || body.password.length < 10) errors.password = "Use at least 10 characters";
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const passwordHash = await hashPassword(String(body.password));
  const { member, token: token2 } = await transaction(async (client) => {
    if (await emailTaken(client, invite.email)) throw conflict("email_taken");
    const claimed = await client.query("UPDATE invites SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL", [invite.id]);
    if (claimed.rowCount === 0) throw notFound();
    const [created] = await rows(
      client,
      "INSERT INTO members (id, workspace_id, name, email, password_hash, role, joined_at) VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING *",
      [newId("mem"), invite.workspace_id, body.name, invite.email, passwordHash, invite.role]
    );
    await audit(client, invite.workspace_id, { kind: "member", id: created.id, name: created.name }, "member.joined", { type: "member", id: created.id });
    return { member: created, token: await startSession(client, created.id) };
  });
  return json(
    201,
    { member: memberOut(member), workspace: workspaceSummary(await loadWorkspace(pool, invite.workspace_id)) },
    { "Set-Cookie": sessionCookie(token2) }
  );
});
route("DELETE", "/api/members/:memberId", async ({ caller, params }) => {
  const member = await one(pool, "SELECT * FROM members WHERE id = $1 AND workspace_id = $2 AND removed_at IS NULL", [params.memberId, caller.workspaceId]);
  if (!member) throw notFound();
  authorize(caller, "member.manage");
  if (member.role === "owner") throw conflict("owner_cannot_be_removed");
  await transaction(async (client) => {
    await client.query("UPDATE members SET removed_at = now() WHERE id = $1", [member.id]);
    await client.query("UPDATE sessions SET ended_at = now() WHERE member_id = $1 AND ended_at IS NULL", [member.id]);
    await audit(client, caller.workspaceId, authorOf(caller), "member.removed", { type: "member", id: member.id });
  });
  const scenes = await clearAuthor({ kind: "member", id: member.id, name: member.name });
  await Promise.all(scenes.flatMap((scene) => [announce(scene, "lock"), announce(scene, "presence")]));
  return noContent();
});

// server/routes/tokens.ts
var DAY_MS2 = 864e5;
var status = (t, now) => t.revoked_at ? "revoked" : t.expires_at <= now ? "expired" : "active";
var tokenOut = (t, now) => ({
  id: t.id,
  name: t.name,
  scope: t.scope,
  expiresAt: isoSecond(t.expires_at),
  status: status(t, now),
  issuedBy: { kind: "member", id: t.issued_by_id, name: t.issued_by_name }
});
route("GET", "/api/agent-tokens", async ({ caller }) => {
  authorize(caller, "member.manage");
  const now = /* @__PURE__ */ new Date();
  const tokens = await rows(pool, "SELECT * FROM agent_tokens WHERE workspace_id = $1 ORDER BY created_at, id", [caller.workspaceId]);
  return json(200, { tokens: tokens.map((t) => tokenOut(t, now)) });
});
route("POST", "/api/agent-tokens", async (ctx) => {
  const { caller } = ctx;
  authorize(caller, "member.manage");
  await assertWritable(caller.workspaceId);
  const body = bodyOf(ctx);
  const now = /* @__PURE__ */ new Date();
  const errors = {};
  if (!isName(body.name, 60)) errors.name = "Use 1 to 60 characters";
  if (body.scope !== "read" && body.scope !== "edit") errors.scope = "Choose read or edit";
  const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : new Date(Number.NaN);
  const lead = expiresAt.getTime() - now.getTime();
  if (Number.isNaN(lead) || lead < 1e4 || lead > 365 * DAY_MS2) errors.expiresAt = "Pick a time between 10 seconds and 365 days from now";
  const active = await one(pool, "SELECT count(*)::int AS n FROM agent_tokens WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > $2", [caller.workspaceId, now]);
  if ((active?.n ?? 0) >= tokenLimit(await currentSubscription(caller.workspaceId))) throw conflict("token_limit_reached");
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const secret = agentSecret();
  const expiry2 = new Date(Math.floor(expiresAt.getTime() / 1e3) * 1e3);
  const warnAt = new Date(Math.max(now.getTime(), expiry2.getTime() - config.tokenWarningLeadSeconds * 1e3));
  const token2 = await transaction(async (client) => {
    const [row] = await rows(
      client,
      `INSERT INTO agent_tokens (id, workspace_id, name, scope, secret_hash, expires_at, issued_by_id, issued_by_name, created_at, warn_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [newId("tok"), caller.workspaceId, body.name, body.scope, secretHash(secret), expiry2, caller.id, caller.name, now, warnAt]
    );
    await audit(client, caller.workspaceId, authorOf(caller), "token.issued", { type: "agent_token", id: row.id });
    return row;
  });
  return json(201, { ...tokenOut(token2, now), token: secret });
});
route("DELETE", "/api/agent-tokens/:tokenId", async ({ caller, params }) => {
  const token2 = await one(pool, "SELECT * FROM agent_tokens WHERE id = $1 AND workspace_id = $2", [params.tokenId, caller.workspaceId]);
  if (!token2) throw notFound();
  authorize(caller, "member.manage");
  const current = status(token2, /* @__PURE__ */ new Date());
  if (current !== "active") throw invalidTransition(current, "revoked");
  await transaction(async (client) => {
    await client.query("UPDATE agent_tokens SET revoked_at = now() WHERE id = $1", [token2.id]);
    await audit(client, caller.workspaceId, authorOf(caller), "token.revoked", { type: "agent_token", id: token2.id });
  });
  const scenes = await clearAuthor({ kind: "agent", id: token2.id, name: token2.name });
  await Promise.all(scenes.flatMap((scene) => [announce(scene, "lock"), announce(scene, "presence")]));
  return noContent();
});

// server/domain/uploads.ts
var LIMITS = { model: 2e7, texture: 8e6 };
var MAX_TEXTURE_PX = 4096;
var PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function nameAllowed(name) {
  const length = [...name].length;
  return length >= 1 && length <= 120 && !/[/\\]/.test(name) && !name.includes("..") && !/[\u0000-\u001f\u007f]/.test(name);
}
function contentType(kind, name, bytes2) {
  const lower = name.toLowerCase();
  if (kind === "model") {
    const isGlb = bytes2.length >= 12 && bytes2.toString("latin1", 0, 4) === "glTF" && bytes2.readUInt32LE(4) === 2 && bytes2.readUInt32LE(8) === bytes2.length;
    return isGlb && lower.endsWith(".glb") ? "model/gltf-binary" : null;
  }
  if (bytes2.subarray(0, 8).equals(PNG_SIGNATURE) && lower.endsWith(".png")) return "image/png";
  if (bytes2.length >= 3 && bytes2[0] === 255 && bytes2[1] === 216 && bytes2[2] === 255 && (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))) return "image/jpeg";
  return null;
}
function pngSize(bytes2) {
  return bytes2.length >= 24 && bytes2.toString("latin1", 12, 16) === "IHDR" ? [bytes2.readUInt32BE(16), bytes2.readUInt32BE(20)] : null;
}
function jpegSize(bytes2) {
  let i = 2;
  while (i + 9 < bytes2.length) {
    if (bytes2[i] !== 255) {
      i += 1;
      continue;
    }
    const marker = bytes2[i + 1];
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      return [bytes2.readUInt16BE(i + 7), bytes2.readUInt16BE(i + 5)];
    }
    if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) {
      i += 2;
      continue;
    }
    i += 2 + bytes2.readUInt16BE(i + 2);
  }
  return null;
}
function checkUpload(kind, name, bytes2) {
  if (kind !== "model" && kind !== "texture") throw invalid({ kind: "Use model or texture" });
  if (!nameAllowed(name)) throw invalid({ file: "File name is not allowed" });
  if (bytes2.length > LIMITS[kind]) throw fileTooLarge(LIMITS[kind]);
  const type = contentType(kind, name, bytes2);
  if (!type) throw unsupportedType();
  if (kind === "texture") {
    const size = type === "image/png" ? pngSize(bytes2) : jpegSize(bytes2);
    if (!size) throw unsupportedType();
    if (size[0] > MAX_TEXTURE_PX || size[1] > MAX_TEXTURE_PX) throw invalid({ file: "Texture is larger than 4096 by 4096 pixels" });
  }
  return { kind, name, contentType: type };
}
function parseMultipart(contentTypeHeader, body) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader ?? "");
  if (!boundary) throw invalid({ file: "Send the upload as multipart/form-data" });
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const fields = {};
  let file = null;
  let start = body.indexOf(delimiter);
  while (start >= 0) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0) {
      const head = part.subarray(0, split).toString("utf8");
      const content = part.subarray(split + 4);
      const fieldName = /name="([^"]*)"/i.exec(head)?.[1];
      const fileName = /filename\*?=(?:UTF-8'')?"?([^"\r\n]*)"?/i.exec(head)?.[1];
      if (fieldName === "file" && fileName !== void 0) file = { name: decodeURIComponentSafe(fileName), bytes: content };
      else if (fieldName) fields[fieldName] = content.toString("utf8");
    }
    start = next;
  }
  return { fields, file };
}
function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// server/routes/scenes.ts
var nodeExists = (graph, id) => typeof id === "string" && graph.nodes.some((n) => n.id === id);
route("GET", "/api/scenes", async ({ caller }) => {
  authorize(caller, "scene.read");
  const scenes = await rows(
    pool,
    `SELECT s.id, s.name, s.latest_seq, s.updated_at,
       (SELECT max(v.number) FROM versions v WHERE v.scene_id = s.id AND v.state = 'published') AS published
     FROM scenes s WHERE s.workspace_id = $1 ORDER BY s.updated_at DESC, s.id`,
    [caller.workspaceId]
  );
  return json(200, {
    scenes: scenes.map((s) => ({ id: s.id, name: s.name, latestSeq: s.latest_seq, updatedAt: isoSecond(s.updated_at), publishedVersion: s.published }))
  });
});
route("POST", "/api/scenes", async (ctx) => {
  const { caller } = ctx;
  authorize(caller, "scene.create");
  await assertWritable(caller.workspaceId);
  const body = bodyOf(ctx);
  if (!isName(body.name)) throw invalid({ name: "Use 1 to 80 characters" });
  const id = newId("sc");
  const graph = JSON.stringify(starterGraph());
  await transaction(async (client) => {
    await client.query(
      "INSERT INTO scenes (id, workspace_id, name, base_graph, graph, created_at, updated_at) VALUES ($1, $2, $3, $4, $4, now(), now())",
      [id, caller.workspaceId, body.name, graph]
    );
    await audit(client, caller.workspaceId, authorOf(caller), "scene.created", { type: "scene", id });
  });
  return json(201, { id, name: body.name, latestSeq: 0 });
});
async function readableScene(caller, sceneId) {
  const scene = await loadScene(pool, caller.workspaceId, sceneId);
  authorize(caller, "scene.read");
  return scene;
}
async function editableScene(caller, sceneId) {
  const scene = await loadScene(pool, caller.workspaceId, sceneId);
  authorize(caller, "scene.edit");
  await assertWritable(caller.workspaceId);
  return scene;
}
route("GET", "/api/scenes/:sceneId", async ({ caller, params }) => {
  const scene = await readableScene(caller, params.sceneId);
  return json(200, { id: scene.id, name: scene.name, latestSeq: scene.latest_seq, graph: scene.graph, hash: graphHash(scene.graph) });
});
route("GET", "/api/scenes/:sceneId/graph", async ({ caller, params, query }) => {
  const scene = await readableScene(caller, params.sceneId);
  const at = Number(query.get("at") ?? scene.latest_seq);
  if (!Number.isInteger(at) || at < 0 || at > scene.latest_seq) throw invalid({ at: `Use an operation number from 0 to ${scene.latest_seq}` });
  const graph = await graphAt(scene, at);
  return json(200, { seq: at, graph, hash: graphHash(graph) });
});
route("GET", "/api/scenes/:sceneId/ops", async ({ caller, params, query }) => {
  const scene = await readableScene(caller, params.sceneId);
  const after = Number(query.get("after") ?? "0");
  const limit = Number(query.get("limit") ?? "500");
  const errors = {};
  if (!Number.isInteger(after) || after < 0) errors.after = "Use a whole number from 0";
  if (!Number.isInteger(limit) || limit < 1 || limit > 1e3) errors.limit = "Use a whole number from 1 to 1000";
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const log = await rows(pool, "SELECT * FROM ops WHERE scene_id = $1 AND seq > $2 ORDER BY seq LIMIT $3", [scene.id, after, limit]);
  return json(200, { ops: log.map(opRowToOp), latestSeq: scene.latest_seq });
});
async function checkAssetReferences(caller, body) {
  const kinds = /* @__PURE__ */ new Map();
  if (!isRecord(body) || !Array.isArray(body.ops)) return kinds;
  for (const raw of body.ops) {
    const assetId = isRecord(raw) && raw.type === "node.add" && isRecord(raw.payload) && isRecord(raw.payload.node) ? raw.payload.node.assetId : null;
    if (typeof assetId !== "string") continue;
    const asset = await one(pool, "SELECT kind FROM assets WHERE id = $1 AND workspace_id = $2", [assetId, caller.workspaceId]);
    if (!asset) throw notFound();
    kinds.set(assetId, asset.kind);
  }
  return kinds;
}
function rawNamedNodes(graph, body) {
  if (!isRecord(body) || !Array.isArray(body.ops)) return [];
  return body.ops.flatMap((raw) => {
    if (!isRecord(raw) || raw.type === "node.add" || !isRecord(raw.payload)) return [];
    const id = raw.payload.id ?? raw.payload.nodeId;
    return nodeExists(graph, id) ? [id] : [];
  });
}
async function refuseIfHeld(scene, nodes, author) {
  const held = await listLocks(scene.id);
  for (const node of nodes) {
    const lock = held.find((l) => l.nodeId === node);
    if (lock && !(lock.holder.kind === author.kind && lock.holder.id === author.id)) throw locked(node, lock.holder);
  }
}
route("POST", "/api/scenes/:sceneId/ops", async (ctx) => {
  const scene = await loadScene(pool, ctx.caller.workspaceId, ctx.params.sceneId);
  const body = ctx.body();
  const assetKinds = await checkAssetReferences(ctx.caller, body);
  authorize(ctx.caller, "scene.edit");
  await assertWritable(ctx.caller.workspaceId);
  const author = authorOf(ctx.caller);
  const parsed = parseBatch(body);
  if ("errors" in parsed) {
    await refuseIfHeld(scene, rawNamedNodes(scene.graph, body), author);
    throw invalid(parsed.errors);
  }
  for (const [i, op] of parsed.ops.entries()) {
    if (op.type === "node.add" && op.payload.node.assetId && assetKinds.get(op.payload.node.assetId) !== "model") {
      throw invalid({ [`ops[${i}].payload.node.assetId`]: "Use a model asset" });
    }
  }
  return json(201, await applyBatch(scene, author, parsed.ops));
});
route("POST", "/api/scenes/:sceneId/undo", async ({ caller, params }) => {
  const scene = await editableScene(caller, params.sceneId);
  return json(201, await undo(scene, authorOf(caller)));
});
route("POST", "/api/scenes/:sceneId/redo", async ({ caller, params }) => {
  const scene = await editableScene(caller, params.sceneId);
  return json(201, await redo(scene, authorOf(caller)));
});
route("POST", "/api/scenes/:sceneId/restore", async (ctx) => {
  const { caller } = ctx;
  const scene = await editableScene(caller, ctx.params.sceneId);
  const toSeq = bodyOf(ctx).toSeq;
  if (typeof toSeq !== "number" || !Number.isInteger(toSeq) || toSeq < 0 || toSeq >= scene.latest_seq) {
    throw invalid({ toSeq: `Use an operation number from 0 to ${scene.latest_seq - 1}` });
  }
  const result = await restore(scene, authorOf(caller), toSeq);
  await audit(pool, caller.workspaceId, authorOf(caller), "scene.restored", { type: "scene", id: scene.id });
  return json(201, { ...result, restoredTo: toSeq });
});
route("GET", "/api/scenes/:sceneId/events", async ({ caller, params, res }) => {
  const scene = await readableScene(caller, params.sceneId);
  watch(scene.id, res);
  return null;
});
route("POST", "/api/scenes/:sceneId/presence", async (ctx) => {
  const { caller } = ctx;
  const scene = await loadScene(pool, caller.workspaceId, ctx.params.sceneId);
  const body = bodyOf(ctx);
  if (body.selection !== null && body.selection !== void 0 && !nodeExists(scene.graph, body.selection)) throw notFound();
  authorize(caller, "presence");
  const cursor = body.cursor;
  if (!Array.isArray(cursor) || cursor.length !== 2 || !cursor.every((c) => typeof c === "number" && c >= 0 && c <= 1)) {
    throw invalid({ cursor: "Use two numbers from 0 to 1" });
  }
  const author = authorOf(caller);
  await heartbeat(caller.workspaceId, scene.id, author, typeof body.selection === "string" ? body.selection : null, [Number(cursor[0]), Number(cursor[1])]);
  if (can(caller, "scene.edit")) await refreshLocks(scene.id, author);
  await announce(scene.id, "presence");
  return noContent();
});
route("GET", "/api/scenes/:sceneId/locks", async ({ caller, params }) => {
  const scene = await readableScene(caller, params.sceneId);
  return json(200, { locks: await listLocks(scene.id) });
});
route("POST", "/api/scenes/:sceneId/locks", async (ctx) => {
  const { caller } = ctx;
  const scene = await loadScene(pool, caller.workspaceId, ctx.params.sceneId);
  const nodeId = bodyOf(ctx).nodeId;
  if (!nodeExists(scene.graph, nodeId)) throw notFound();
  authorize(caller, "scene.edit");
  await assertWritable(caller.workspaceId);
  const lock = await claimOne(caller.workspaceId, scene.id, nodeId, authorOf(caller));
  await refreshLocks(scene.id, authorOf(caller));
  await announce(scene.id, "lock");
  return json(200, { lock });
});
route("DELETE", "/api/scenes/:sceneId/locks/:nodeId", async ({ caller, params }) => {
  const scene = await loadScene(pool, caller.workspaceId, params.sceneId);
  if (!nodeExists(scene.graph, params.nodeId)) throw notFound();
  authorize(caller, "scene.edit");
  if (!await release(scene.id, params.nodeId, authorOf(caller))) throw conflict("not_lock_holder");
  await announce(scene.id, "lock");
  return noContent();
});
route("POST", "/api/scenes/:sceneId/locks/:nodeId/takeover", async ({ caller, params }) => {
  const scene = await loadScene(pool, caller.workspaceId, params.sceneId);
  if (!nodeExists(scene.graph, params.nodeId)) throw notFound();
  authorize(caller, "scene.edit");
  await assertWritable(caller.workspaceId);
  const result = await takeover(caller.workspaceId, scene.id, params.nodeId, authorOf(caller));
  await announce(scene.id, "lock");
  return json(200, result);
});
var assetOut = (a) => ({
  id: a.id,
  kind: a.kind,
  name: a.name,
  bytes: a.bytes,
  contentType: a.content_type,
  uploadedBy: { kind: a.uploaded_by_kind, id: a.uploaded_by_id, name: a.uploaded_by_name }
});
route("POST", "/api/assets", async (ctx) => {
  const { caller } = ctx;
  authorize(caller, "asset.upload");
  await assertWritable(caller.workspaceId);
  const { fields, file } = parseMultipart(ctx.headers["content-type"], ctx.raw);
  if (!file) throw invalid({ file: "Choose a file" });
  const checked = checkUpload(fields.kind, file.name, file.bytes);
  const id = newId("asset");
  await putObject(keys.asset(caller.workspaceId, id), file.bytes, checked.contentType);
  const author = authorOf(caller);
  const asset = await transaction(async (client) => {
    const [row] = await rows(
      client,
      `INSERT INTO assets (id, workspace_id, kind, name, bytes, content_type, uploaded_by_kind, uploaded_by_id, uploaded_by_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now()) RETURNING *`,
      [id, caller.workspaceId, checked.kind, checked.name, file.bytes.length, checked.contentType, author.kind, author.id, author.name]
    );
    await audit(client, caller.workspaceId, author, "asset.uploaded", { type: "asset", id });
    return row;
  });
  const { uploadedBy: _, ...shown } = assetOut(asset);
  return json(201, shown);
}, { limit: 201e5 });
route("GET", "/api/assets", async ({ caller }) => {
  authorize(caller, "scene.read");
  const assets2 = await rows(pool, "SELECT * FROM assets WHERE workspace_id = $1 ORDER BY created_at DESC, id", [caller.workspaceId]);
  return json(200, { assets: assets2.map(assetOut) });
});
route("GET", "/api/assets/:assetId/file", async ({ caller, params }) => {
  const asset = await one(pool, "SELECT * FROM assets WHERE id = $1 AND workspace_id = $2", [params.assetId, caller.workspaceId]);
  if (!asset) throw notFound();
  authorize(caller, "scene.read");
  const file = await getObject(keys.asset(caller.workspaceId, asset.id));
  if (!file) throw notFound();
  return bytes(file, asset.content_type, { "Cache-Control": "private, max-age=3600" });
});
route("PUT", "/api/versions/:versionId/thumbnail", async (ctx) => {
  const { caller } = ctx;
  const version = await one(pool, "SELECT id, scene_id FROM versions WHERE id = $1 AND workspace_id = $2", [ctx.params.versionId, caller.workspaceId]);
  if (!version) throw notFound();
  authorize(caller, "asset.upload");
  await assertWritable(caller.workspaceId);
  if (!ctx.raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw unsupportedType();
  await putObject(keys.thumbnail(caller.workspaceId, version.scene_id, version.id), ctx.raw, "image/png");
  await pool.query("UPDATE versions SET has_thumbnail = true WHERE id = $1", [version.id]);
  return noContent();
});
async function memberNames(workspaceId, ids) {
  if (ids.length === 0) return /* @__PURE__ */ new Map();
  const found = await rows(pool, "SELECT id, name FROM members WHERE workspace_id = $1 AND id = ANY($2)", [workspaceId, ids]);
  return new Map(found.map((m) => [m.id, m.name]));
}
async function commentOut(record, workspaceId) {
  const mentionIds = Array.isArray(record.mentions) ? record.mentions.filter((m) => typeof m === "string") : [];
  const names = await memberNames(workspaceId, mentionIds);
  return {
    id: String(record.commentId),
    nodeId: String(record.node),
    body: String(record.body),
    author: { kind: "member", id: String(record.authorId), name: String(record.authorName) },
    mentions: mentionIds.map((id) => ({ id, name: names.get(id) ?? "" })),
    resolved: record.resolved === true,
    createdAt: isoSecond(pbDate(record.created))
  };
}
route("GET", "/api/scenes/:sceneId/comments", async ({ caller, params }) => {
  const scene = await readableScene(caller, params.sceneId);
  const records = await list("comments", `scene=${quote(scene.id)}`);
  return json(200, { comments: await Promise.all(records.map((r) => commentOut(r, caller.workspaceId))) });
});
route("POST", "/api/scenes/:sceneId/comments", async (ctx) => {
  const { caller } = ctx;
  const scene = await loadScene(pool, caller.workspaceId, ctx.params.sceneId);
  const body = bodyOf(ctx);
  if (!nodeExists(scene.graph, body.nodeId)) throw notFound();
  const mentions = Array.isArray(body.mentions) ? body.mentions : [];
  if (!mentions.every((m) => typeof m === "string")) throw notFound();
  const active = await rows(pool, "SELECT id FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND id = ANY($2)", [caller.workspaceId, mentions]);
  if (active.length !== new Set(mentions).size) throw notFound();
  authorize(caller, "comment");
  await assertWritable(caller.workspaceId);
  if (typeof body.body !== "string" || body.body.trim() === "" || [...body.body].length > 2e3) throw invalid({ body: "Use 1 to 2000 characters" });
  if (!Array.isArray(body.mentions)) throw invalid({ mentions: "Send a list of member IDs" });
  const commentId = newId("cmt");
  const record = await insert("comments", {
    workspace: caller.workspaceId,
    scene: scene.id,
    commentId,
    node: body.nodeId,
    body: body.body,
    authorId: caller.id,
    authorName: caller.name,
    mentions: [...new Set(mentions)],
    resolved: false
  });
  await audit(pool, caller.workspaceId, authorOf(caller), "comment.posted", { type: "comment", id: commentId });
  const comment = await commentOut(record, caller.workspaceId);
  await announce(scene.id, "comment", { data: comment });
  return json(201, comment);
});
route("PATCH", "/api/comments/:commentId", async (ctx) => {
  const { caller } = ctx;
  const [record] = await list("comments", `commentId=${quote(ctx.params.commentId)} && workspace=${quote(caller.workspaceId)}`);
  if (!record) throw notFound();
  authorize(caller, "comment");
  await assertWritable(caller.workspaceId);
  const resolved = bodyOf(ctx).resolved;
  if (typeof resolved !== "boolean") throw invalid({ resolved: "Must be true or false" });
  const updated = await update("comments", record.id, { resolved });
  if (!updated) throw notFound();
  await audit(pool, caller.workspaceId, authorOf(caller), resolved ? "comment.resolved" : "comment.reopened", { type: "comment", id: String(record.commentId) });
  const comment = await commentOut(updated, caller.workspaceId);
  await announce(String(record.scene), "comment", { data: comment });
  return json(200, comment);
});
route("GET", "/api/scenes/:sceneId/mentionable", async ({ caller, params, query }) => {
  const scene = await loadScene(pool, caller.workspaceId, params.sceneId);
  authorize(caller, "workspace.read");
  const q = query.get("q") ?? "";
  const members = await rows(
    pool,
    `SELECT id, name, role FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND name ILIKE $2 ORDER BY name, id LIMIT 20`,
    [scene.workspace_id, `%${q.replace(/[\\%_]/g, "\\$&")}%`]
  );
  return json(200, { members });
});

// server/idempotency.ts
import { createHash as createHash3 } from "node:crypto";
var KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;
var KEPT_MS = 24 * 60 * 60 * 1e3;
async function idempotent(ctx, work) {
  const key = ctx.headers["idempotency-key"];
  if (typeof key !== "string" || key === "") throw invalid({ "Idempotency-Key": "Required" });
  if (!KEY_PATTERN.test(key)) throw invalid({ "Idempotency-Key": "Use 1 to 200 visible ASCII characters" });
  const workspace = ctx.caller.workspaceId;
  const fingerprint = createHash3("sha256").update(`${ctx.method}
${ctx.path}
`).update(ctx.raw).digest("hex");
  const now = /* @__PURE__ */ new Date();
  await pool.query("DELETE FROM idempotency_keys WHERE workspace_id = $1 AND key = $2 AND created_at < $3", [workspace, key, new Date(now.getTime() - KEPT_MS)]);
  const inserted = await pool.query(
    "INSERT INTO idempotency_keys (workspace_id, key, fingerprint, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    [workspace, key, fingerprint, now]
  );
  if (inserted.rowCount === 0) {
    const stored2 = await one(
      pool,
      "SELECT fingerprint, status, body FROM idempotency_keys WHERE workspace_id = $1 AND key = $2",
      [workspace, key]
    );
    if (!stored2 || stored2.fingerprint !== fingerprint) throw conflict("idempotency_key_reused");
    if (stored2.status === null || stored2.body === null) throw conflict("request_in_progress");
    return { status: stored2.status, body: stored2.body, contentType: "application/json; charset=utf-8", headers: { "Idempotent-Replayed": "true" } };
  }
  const keep = (status2, body) => pool.query("UPDATE idempotency_keys SET status = $3, body = $4 WHERE workspace_id = $1 AND key = $2", [workspace, key, status2, JSON.stringify(body)]);
  try {
    const reply = await work();
    await keep(reply.status, reply.json);
    return reply;
  } catch (error) {
    if (error instanceof HttpError && error.status !== 503) await keep(error.status, error.body);
    else await pool.query("DELETE FROM idempotency_keys WHERE workspace_id = $1 AND key = $2", [workspace, key]);
    throw error;
  }
}

// server/billing.ts
import { createHash as createHash4, createHmac as createHmac2, timingSafeEqual as timingSafeEqual2 } from "node:crypto";

// server/pdf.ts
var escape = (text) => text.replace(/[^\x20-\x7e]/g, "?").replace(/([()\\])/g, "\\$1");
function invoicePdf(doc) {
  const lines = [
    [72, 760, "Orrery Studio", 20],
    [72, 728, `Invoice ${doc.invoiceNumber}`, 14],
    [72, 708, `Workspace: ${doc.workspaceName}`, 11],
    [72, 692, `Date: ${doc.date}`, 11],
    [72, 660, "Line items", 12]
  ];
  let y = 640;
  for (const item of doc.items) {
    lines.push([72, y, item.description, 11], [440, y, dollars(item.amountCents), 11]);
    y -= 18;
  }
  lines.push([72, y - 12, "Total", 12], [440, y - 12, dollars(doc.totalCents), 12]);
  lines.push([72, y - 32, "Amount paid", 12], [440, y - 32, dollars(doc.paidCents), 12]);
  const content = lines.map(([x, ly, text, size]) => `BT /F1 ${size} Tf ${x} ${ly} Td (${escape(text)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>
stream
${content}
endstream`
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj
${body}
endobj
`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref
0 ${objects.length + 1}
0000000000 65535 f 
${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n 
`).join("")}`;
  out += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF
`;
  return Buffer.from(out, "latin1");
}

// server/billing.ts
var serially = (workspaceId, work) => withAdvisoryLock(`billing:${workspaceId}`, work);
var DECLINED_CARD = "4000000000000002";
function luhn(number) {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let digit = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
function parseCard(value, now) {
  if (!isRecord(value)) throw invalid({ card: "Enter a card" });
  const errors = {};
  const { number, expMonth, expYear, cvc } = value;
  if (typeof number !== "string" || !/^\d{13,19}$/.test(number) || !luhn(number)) errors["card.number"] = "Enter a valid card number";
  if (typeof expMonth !== "number" || !Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) errors["card.expMonth"] = "Use a month from 1 to 12";
  if (typeof expYear !== "number" || !Number.isInteger(expYear) || expYear < 1e3 || expYear > 9999) errors["card.expYear"] = "Use a four-digit year";
  if (typeof cvc !== "string" || !/^\d{3,4}$/.test(cvc)) errors["card.cvc"] = "Use 3 or 4 digits";
  if (!errors["card.expMonth"] && !errors["card.expYear"] && typeof expMonth === "number" && typeof expYear === "number") {
    if (expYear * 12 + expMonth < now.getUTCFullYear() * 12 + now.getUTCMonth() + 1) errors["card.expMonth"] = "The card has expired";
  }
  if (Object.keys(errors).length > 0) throw invalid(errors);
  return { number: String(number), expMonth: Number(expMonth), expYear: Number(expYear), cvc: String(cvc) };
}
function charge(card) {
  if (card.number === DECLINED_CARD) throw cardDeclined();
}
var invoiceOut = (inv, pdfAvailable) => ({
  id: inv.invoiceId,
  number: inv.invoiceNumber,
  date: inv.invoiceDate,
  amountCents: inv.amountCents,
  balanceCents: inv.balanceCents,
  status: inv.balanceCents > 0 ? "unpaid" : "paid",
  pdfAvailable
});
var paymentOut = (p) => ({
  id: p.id,
  invoiceId: p.invoice_id,
  amountCents: p.amount_cents,
  refundedCents: p.refunded_cents,
  createdAt: isoSecond(p.created_at)
});
async function settle(ws, acct, inv, externalKey, bookkeeping) {
  const key = keys.invoice(ws.id, inv.invoiceId);
  const hadDocument = await one(pool, "SELECT 1 FROM invoice_documents WHERE invoice_id = $1", [inv.invoiceId]) !== void 0;
  const amount = inv.balanceCents;
  await putObject(key, invoicePdf({
    workspaceName: ws.name,
    invoiceNumber: inv.invoiceNumber,
    date: inv.invoiceDate,
    items: inv.items,
    totalCents: inv.amountCents,
    paidCents: amount
  }), "application/pdf");
  let paymentId;
  try {
    paymentId = await purchase(acct, inv.invoiceId, amount, externalKey);
  } catch (error) {
    if (!hadDocument) await deleteObject(key).catch(() => void 0);
    throw error;
  }
  const payment = await transaction(async (client) => {
    const [row] = await rows(
      client,
      `INSERT INTO payments (id, workspace_id, invoice_id, invoice_number, amount_cents, created_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING *`,
      [paymentId, ws.id, inv.invoiceId, inv.invoiceNumber, amount]
    );
    await client.query("INSERT INTO invoice_documents (invoice_id, workspace_id, created_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING", [inv.invoiceId, ws.id]);
    await bookkeeping(client);
    await enqueueMail(client, {
      to: await billingContacts(client, ws.id),
      subject: `Receipt for invoice ${inv.invoiceNumber}: ${dollars(amount)}`,
      body: `Thank you. We received ${dollars(amount)} for invoice ${inv.invoiceNumber} of ${ws.name}.

Invoice date: ${inv.invoiceDate}
Total: ${dollars(inv.amountCents)}
Paid: ${dollars(amount)}

Orrery Studio`
    });
    return row;
  });
  return { invoice: invoiceOut({ ...inv, balanceCents: 0 }, true), payment: paymentOut(payment) };
}
async function accountFor(ws) {
  await ensureCatalog();
  return openAccount(ws.id, ws.name, await ownerEmail(pool, ws.id));
}
var knownInvoices = async (acct) => new Set((await accountInvoices(acct.accountId)).map((i) => i.invoiceId));
var isPlan = (value) => PLAN_IDS.some((p) => p === value);
var isPeriod = (value) => PERIODS.some((p) => p === value);
function readPlanChoice(body) {
  const { plan, period } = body;
  if (isPlan(plan) && isPeriod(period)) return { plan, period };
  const errors = {};
  if (!isPlan(plan)) errors.plan = "Choose Team or Business";
  if (!isPeriod(period)) errors.period = "Choose monthly or annual";
  throw invalid(errors);
}
function readExtraSeats(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 500) throw invalid({ extraSeats: "Use a whole number from 0 to 500" });
  return value;
}
var subscriptionNow = async (db, workspaceId) => toSubscription(await loadSubscription(db, workspaceId), /* @__PURE__ */ new Date());
async function checkout(caller, body, key) {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const now = /* @__PURE__ */ new Date();
  const sub = await currentSubscription(ws.id);
  assertCheckoutAllowed(sub, now);
  const fields = isRecord(body) ? body : {};
  const { plan, period } = readPlanChoice(fields);
  const extraSeats = readExtraSeats(fields.extraSeats);
  assertSeatsFit(await seatsUsed(pool, ws.id, now), PLAN_CATALOG[plan].includedSeats + extraSeats);
  const card = parseCard(fields.card, now);
  charge(card);
  await assertStorageReachable();
  const acct = await accountFor(ws);
  const known = await knownInvoices(acct);
  await startSubscription(acct.accountId, plan, period, extraSeats);
  const inv = await newInvoice(acct.accountId, known);
  const paid = await settle(ws, acct, inv, `${ws.id}:${key}`, async (client) => {
    await client.query(
      `UPDATE subscriptions SET state = 'active', plan = $2, period = $3, extra_seats = $4, suspended_by = NULL,
       kb_account_id = $5, card_last4 = $6, pending_change = NULL WHERE workspace_id = $1`,
      [ws.id, plan, period, extraSeats, acct.accountId, card.number.slice(-4)]
    );
    await audit(client, ws.id, caller, "subscription.started", { type: "subscription", id: ws.id });
  });
  return json(201, { subscription: await subscriptionNow(pool, ws.id), ...paid });
}
function samePlan(sub, choice) {
  if (sub.plan === choice.plan && sub.period === choice.period) throw invalid({ plan: "Already on this plan" });
}
async function currentSubscriptions(acct) {
  const subs = await activeSubscriptions(acct.accountId);
  const base = subs.find((s) => s.category === "BASE");
  if (!base) throw conflict("subscription_not_active");
  return { base, seats: subs.filter((s) => s.category === "ADD_ON") };
}
async function previewPlan(caller, query) {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const sub = await currentSubscription(ws.id);
  assertActive(sub, /* @__PURE__ */ new Date());
  const choice = readPlanChoice({ plan: query.get("plan"), period: query.get("period") });
  samePlan(sub, choice);
  const acct = await accountFor(ws);
  const { base, seats } = await currentSubscriptions(acct);
  if (changeTiming(sub, choice) === "end_of_term") {
    return json(200, { change: "end_of_term", amountCents: 0, effectiveAt: isoSecond(endOfTerm(acct, base)) });
  }
  let amountCents = await previewChange(acct.accountId, base, killbillPlan(choice.plan, choice.period));
  for (const seat of seats) amountCents += await previewChange(acct.accountId, seat, killbillSeatPlan(choice.plan, choice.period));
  return json(200, { change: "immediate", amountCents, effectiveAt: isoSecond(/* @__PURE__ */ new Date()) });
}
async function changePlan2(caller, body, key) {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const now = /* @__PURE__ */ new Date();
  const sub = await currentSubscription(ws.id);
  assertActive(sub, now);
  const choice = readPlanChoice(isRecord(body) ? body : {});
  assertSeatsFit(await seatsUsed(pool, ws.id, now), PLAN_CATALOG[choice.plan].includedSeats + sub.extra_seats);
  samePlan(sub, choice);
  const timing = changeTiming(sub, choice);
  if (timing === "immediate") await assertStorageReachable();
  const acct = await accountFor(ws);
  const { base, seats } = await currentSubscriptions(acct);
  const record = (client) => audit(client, ws.id, caller, "subscription.plan_changed", { type: "subscription", id: ws.id });
  if (timing === "end_of_term") {
    await changePlan(base, killbillPlan(choice.plan, choice.period), "END_OF_TERM");
    for (const seat of seats) await changePlan(seat, killbillSeatPlan(choice.plan, choice.period), "END_OF_TERM");
    const effectiveAt = isoSecond(endOfTerm(acct, base));
    await transaction(async (client) => {
      await client.query(
        "UPDATE subscriptions SET pending_change = $2 WHERE workspace_id = $1",
        [ws.id, JSON.stringify({ plan: choice.plan, period: choice.period, extraSeats: sub.extra_seats, effectiveAt })]
      );
      await record(client);
    });
    return json(200, { change: "end_of_term", subscription: await subscriptionNow(pool, ws.id), effectiveAt });
  }
  const known = await knownInvoices(acct);
  await asOneInvoice(acct.accountId, async () => {
    await changePlan(base, killbillPlan(choice.plan, choice.period), "IMMEDIATE");
    for (const seat of seats) await changePlan(seat, killbillSeatPlan(choice.plan, choice.period), "IMMEDIATE");
  });
  const inv = await newInvoice(acct.accountId, known);
  const apply = async (client) => {
    await client.query("UPDATE subscriptions SET plan = $2, period = $3, pending_change = NULL WHERE workspace_id = $1", [ws.id, choice.plan, choice.period]);
    await record(client);
  };
  if (inv.balanceCents <= 0) {
    await transaction(apply);
    return json(200, { change: "immediate", subscription: await subscriptionNow(pool, ws.id), invoice: invoiceOut(inv, false), payment: null });
  }
  const paid = await settle(ws, acct, inv, `${ws.id}:${key}`, apply);
  return json(200, { change: "immediate", subscription: await subscriptionNow(pool, ws.id), ...paid });
}
async function changeSeats(caller, body, key) {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const now = /* @__PURE__ */ new Date();
  const sub = await currentSubscription(ws.id);
  assertActive(sub, now);
  const extraSeats = readExtraSeats(isRecord(body) ? body.extraSeats : void 0);
  assertSeatsFit(await seatsUsed(pool, ws.id, now), PLAN_CATALOG[sub.plan].includedSeats + extraSeats);
  if (extraSeats === sub.extra_seats) throw invalid({ extraSeats: "No change" });
  const seatPlan = killbillSeatPlan(sub.plan, sub.period);
  const record = (client) => audit(client, ws.id, caller, "subscription.seats_changed", { type: "subscription", id: ws.id });
  if (extraSeats > sub.extra_seats) await assertStorageReachable();
  const acct = await accountFor(ws);
  const { base, seats } = await currentSubscriptions(acct);
  if (extraSeats < sub.extra_seats) {
    for (const seat of seats) await cancel(seat, "END_OF_TERM");
    if (extraSeats > 0) await addSeats(acct.accountId, base.bundleId, seatPlan, extraSeats, base.chargedThroughDate);
    const effectiveAt = isoSecond(endOfTerm(acct, base));
    await transaction(async (client) => {
      await client.query(
        "UPDATE subscriptions SET pending_change = $2 WHERE workspace_id = $1",
        [ws.id, JSON.stringify({ plan: sub.plan, period: sub.period, extraSeats, effectiveAt })]
      );
      await record(client);
    });
    return json(200, { change: "end_of_term", subscription: await subscriptionNow(pool, ws.id), effectiveAt });
  }
  const known = await knownInvoices(acct);
  await addSeats(acct.accountId, base.bundleId, seatPlan, extraSeats - sub.extra_seats);
  const inv = await newInvoice(acct.accountId, known);
  const paid = await settle(ws, acct, inv, `${ws.id}:${key}`, async (client) => {
    await client.query("UPDATE subscriptions SET extra_seats = $2, pending_change = NULL WHERE workspace_id = $1", [ws.id, extraSeats]);
    await record(client);
  });
  return json(200, { change: "immediate", subscription: await subscriptionNow(pool, ws.id), ...paid });
}
async function recordInvoicePaid(client, ws, invoiceId, unpaidElsewhere, payer) {
  await audit(client, ws.id, payer, "invoice.paid", { type: "invoice", id: invoiceId });
  const sub = await loadSubscription(client, ws.id, true);
  const now = /* @__PURE__ */ new Date();
  const recovering = effectiveState(sub, now) === "past_due" || suspensionCause(sub, now) === "dunning";
  if (!recovering || unpaidElsewhere) return;
  await client.query(
    `UPDATE subscriptions SET state = 'active', suspended_by = NULL, failed_at = NULL, dunning_day3_at = NULL,
     dunning_day3_sent = false, grace_ends_at = NULL WHERE workspace_id = $1`,
    [ws.id]
  );
  await audit(client, ws.id, SCHEDULER, "subscription.reactivated", { type: "subscription", id: ws.id });
}
async function ownInvoice(ws, invoiceId) {
  const acct = await findAccount(ws.id);
  const inv = acct ? await invoice(invoiceId) : null;
  if (!acct || !inv || inv.accountId !== acct.accountId) throw notFound();
  return { acct, inv };
}
async function unpaidBesides(acct, invoiceId) {
  return (await accountInvoices(acct.accountId)).some((i) => i.invoiceId !== invoiceId && i.balanceCents > 0);
}
async function payInvoice(caller, invoiceId, body, key) {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const { acct, inv } = await ownInvoice(ws, invoiceId);
  if (inv.balanceCents <= 0) throw conflict("invoice_already_paid");
  charge(parseCard(isRecord(body) ? body.card : void 0, /* @__PURE__ */ new Date()));
  await assertStorageReachable();
  const unpaid = await unpaidBesides(acct, inv.invoiceId);
  const paid = await settle(ws, acct, inv, `${ws.id}:${key}`, (client) => recordInvoicePaid(client, ws, inv.invoiceId, unpaid, caller));
  return json(200, { ...paid, subscription: await subscriptionNow(pool, ws.id) });
}
async function refund2(caller, paymentId, body, key) {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const payment = await one(pool, "SELECT * FROM payments WHERE id = $1 AND workspace_id = $2", [paymentId, ws.id]);
  if (!payment) throw notFound();
  const refundable = payment.amount_cents - payment.refunded_cents;
  const requested = isRecord(body) && body.amountCents !== void 0 ? body.amountCents : refundable;
  if (typeof requested !== "number" || !Number.isInteger(requested) || requested < 1) throw invalid({ amountCents: "Use a whole number of cents from 1" });
  if (requested > refundable) throw invalid({ amountCents: "More than the refundable balance" });
  await refund(payment.id, requested, `${ws.id}:${key}`);
  const updated = await transaction(async (client) => {
    const [row] = await rows(client, "UPDATE payments SET refunded_cents = refunded_cents + $2 WHERE id = $1 RETURNING *", [payment.id, requested]);
    await audit(client, ws.id, caller, "payment.refunded", { type: "payment", id: payment.id });
    await enqueueMail(client, {
      to: await billingContacts(client, ws.id),
      subject: `Refund for invoice ${payment.invoice_number}: ${dollars(requested)}`,
      body: `We refunded ${dollars(requested)} of your payment for invoice ${payment.invoice_number} of ${ws.name}.

Orrery Studio`
    });
    return row;
  });
  return json(200, { payment: paymentOut(updated) });
}
async function cancelSubscription(caller) {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  assertCancelAllowed(await currentSubscription(ws.id));
  const acct = await findAccount(ws.id);
  if (acct) {
    const base = (await activeSubscriptions(acct.accountId)).find((s) => s.category === "BASE");
    if (base) await cancel(base, "IMMEDIATE");
  }
  await transaction(async (client) => {
    await client.query("UPDATE subscriptions SET state = 'cancelled', pending_change = NULL WHERE workspace_id = $1", [ws.id]);
    await audit(client, ws.id, caller, "subscription.cancelled", { type: "subscription", id: ws.id });
  });
  return json(200, { subscription: await subscriptionNow(pool, ws.id) });
}
async function listInvoices(caller) {
  const acct = await findAccount(caller.workspaceId);
  if (!acct) return json(200, { invoices: [], payments: [] });
  const documents = new Set((await rows(pool, "SELECT invoice_id FROM invoice_documents WHERE workspace_id = $1", [caller.workspaceId])).map((r) => r.invoice_id));
  const invoices = (await accountInvoices(acct.accountId)).filter((i) => i.amountCents !== 0).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || Number(b.invoiceNumber) - Number(a.invoiceNumber)).map((i) => invoiceOut(i, documents.has(i.invoiceId)));
  const payments = (await rows(pool, "SELECT * FROM payments WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC", [caller.workspaceId])).map(paymentOut);
  return json(200, { invoices, payments });
}
function verifySignature(secret, raw, header) {
  const expected = `sha256=${createHmac2("sha256", secret).update(raw).digest("hex")}`;
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual2(given, Buffer.from(expected));
}
async function recordEvent(client, workspaceId, eventId, bodyHash) {
  await client.query("INSERT INTO webhook_events (workspace_id, event_id, body_hash, created_at) VALUES ($1, $2, $3, now())", [workspaceId, eventId, bodyHash]);
}
async function webhook(raw, signature) {
  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    throw invalidSignature();
  }
  if (!isRecord(event) || typeof event.workspaceId !== "string") throw invalidSignature();
  const ws = await one(pool, "SELECT * FROM workspaces WHERE id = $1", [event.workspaceId]);
  if (!ws || !verifySignature(ws.signing_secret, raw, signature)) throw invalidSignature();
  if (typeof event.id !== "string" || event.id === "") throw invalid({ id: "Required" });
  const eventId = event.id;
  const bodyHash = createHash4("sha256").update(raw).digest("hex");
  return serially(ws.id, async () => {
    const seen = await one(pool, "SELECT body_hash FROM webhook_events WHERE workspace_id = $1 AND event_id = $2", [ws.id, eventId]);
    if (seen) {
      if (seen.body_hash !== bodyHash) throw conflict("idempotency_key_reused");
      return json(200, { received: true, duplicate: true });
    }
    if (event.type === "payment.succeeded") await paymentSucceeded(ws, eventId, bodyHash, event);
    else if (event.type === "payment.failed") await paymentFailed(ws, eventId, bodyHash, event);
    else throw invalid({ type: "Unknown event type" });
    return json(200, { received: true, duplicate: false });
  });
}
async function paymentSucceeded(ws, eventId, bodyHash, event) {
  if (typeof event.invoiceId !== "string") throw invalid({ invoiceId: "Required" });
  const { acct, inv } = await ownInvoice(ws, event.invoiceId);
  if (inv.balanceCents <= 0) {
    await recordEvent(pool, ws.id, eventId, bodyHash);
    return;
  }
  if (event.amountCents !== inv.balanceCents) throw invalid({ amountCents: "Must equal the invoice balance" });
  await assertStorageReachable();
  const unpaid = await unpaidBesides(acct, inv.invoiceId);
  await settle(ws, acct, inv, `${ws.id}:${eventId}`, async (client) => {
    await recordInvoicePaid(client, ws, inv.invoiceId, unpaid, SCHEDULER);
    await recordEvent(client, ws.id, eventId, bodyHash);
  });
}
async function paymentFailed(ws, eventId, bodyHash, event) {
  if (typeof event.paymentId !== "string") throw invalid({ paymentId: "Required" });
  const payment = await one(pool, "SELECT * FROM payments WHERE id = $1 AND workspace_id = $2", [event.paymentId, ws.id]);
  if (!payment) throw notFound();
  if (payment.charged_back) {
    await recordEvent(pool, ws.id, eventId, bodyHash);
    return;
  }
  await chargeback(payment.id, payment.amount_cents);
  const day = config.dunningDaySeconds * 1e3;
  await transaction(async (client) => {
    await client.query("UPDATE payments SET charged_back = true WHERE id = $1", [payment.id]);
    await recordEvent(client, ws.id, eventId, bodyHash);
    const sub = await loadSubscription(client, ws.id, true);
    const now = /* @__PURE__ */ new Date();
    if (effectiveState(sub, now) !== "active") return;
    const graceEndsAt = new Date(now.getTime() + 7 * day);
    await client.query(
      `UPDATE subscriptions SET state = 'past_due', failed_at = $2, dunning_day3_at = $3, dunning_day3_sent = false, grace_ends_at = $4
       WHERE workspace_id = $1`,
      [ws.id, now, new Date(now.getTime() + 3 * day), graceEndsAt]
    );
    await audit(client, ws.id, SCHEDULER, "subscription.past_due", { type: "subscription", id: ws.id });
    await enqueueMail(client, {
      to: await billingContacts(client, ws.id),
      subject: `Payment failed for ${ws.name}`,
      body: `A payment for invoice ${payment.invoice_number} of ${ws.name} did not go through.

Pay invoice ${payment.invoice_number} by ${localTime(isoSecond(graceEndsAt), ws.time_zone)} to keep publishing.

Orrery Studio`
    });
  });
}

// server/routes/billing.ts
function billingPost(path, action, work) {
  route("POST", path, async (ctx) => {
    authorize(ctx.caller, action);
    return idempotent(ctx, () => serially(ctx.caller.workspaceId, () => work(ctx, String(ctx.headers["idempotency-key"]))));
  });
}
route("GET", "/api/billing", async ({ caller }) => {
  authorize(caller, "billing");
  const sub = await currentSubscription(caller.workspaceId);
  return json(200, { subscription: toSubscription(sub, /* @__PURE__ */ new Date()), card: sub.card_last4 ? { last4: sub.card_last4 } : null });
});
billingPost("/api/billing/checkout", "billing", (ctx, key) => checkout(ctx.caller, ctx.body(), key));
billingPost("/api/billing/plan", "billing", (ctx, key) => changePlan2(ctx.caller, ctx.body(), key));
billingPost("/api/billing/seats", "billing", (ctx, key) => changeSeats(ctx.caller, ctx.body(), key));
billingPost("/api/billing/cancel", "subscription.cancel", (ctx) => cancelSubscription(ctx.caller));
route("POST", "/api/billing/invoices/:invoiceId/pay", async (ctx) => {
  await ownInvoice(await loadWorkspace(pool, ctx.caller.workspaceId), ctx.params.invoiceId);
  authorize(ctx.caller, "billing");
  return idempotent(ctx, () => serially(
    ctx.caller.workspaceId,
    () => payInvoice(ctx.caller, ctx.params.invoiceId, ctx.body(), String(ctx.headers["idempotency-key"]))
  ));
});
route("POST", "/api/billing/payments/:paymentId/refund", async (ctx) => {
  const payment = await one(pool, "SELECT 1 FROM payments WHERE id = $1 AND workspace_id = $2", [ctx.params.paymentId, ctx.caller.workspaceId]);
  if (!payment) throw notFound();
  authorize(ctx.caller, "billing");
  return idempotent(ctx, () => serially(
    ctx.caller.workspaceId,
    () => refund2(ctx.caller, ctx.params.paymentId, ctx.body(), String(ctx.headers["idempotency-key"]))
  ));
});
route("GET", "/api/billing/plan/preview", async ({ caller, query }) => {
  authorize(caller, "billing");
  return previewPlan(caller, query);
});
route("GET", "/api/billing/invoices", async ({ caller }) => {
  authorize(caller, "billing");
  return listInvoices(caller);
});
route("GET", "/api/billing/invoices/:invoiceId/pdf", async ({ caller, params }) => {
  const document = await one(pool, "SELECT 1 FROM invoice_documents WHERE invoice_id = $1 AND workspace_id = $2", [params.invoiceId, caller.workspaceId]);
  if (!document) throw notFound();
  authorize(caller, "billing");
  const pdf = await getObject(keys.invoice(caller.workspaceId, params.invoiceId));
  if (!pdf) throw notFound();
  return bytes(pdf, "application/pdf", { "Content-Disposition": `attachment; filename="invoice-${params.invoiceId}.pdf"` });
});
route("GET", "/api/billing/gateway", async ({ caller }) => {
  authorize(caller, "gateway.read");
  return json(200, { signingSecret: (await loadWorkspace(pool, caller.workspaceId)).signing_secret });
});
publicRoute("POST", "/api/billing/webhook", async ({ raw, headers }) => {
  const signature = headers["orrery-signature"];
  return webhook(raw, typeof signature === "string" ? signature : void 0);
}, { anyOrigin: true });

// server/main.ts
async function prepareDatabase() {
  for (; ; ) {
    try {
      await applySchema();
      await seed();
      return;
    } catch (error) {
      console.error("waiting for PostgreSQL:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
  }
}
await prepareDatabase();
await listen();
startScheduler();
var server = createServer((req, res) => {
  void handle(req, res, fallback);
});
server.listen(config.port, "0.0.0.0", () => console.log(`Orrery Studio listening on 0.0.0.0:${config.port}`));
