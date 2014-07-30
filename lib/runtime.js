'use strict';

var Promise = require('promise');

function isPromise(value) {
    return value && typeof value.then === 'function';
}

exports.promise = {
    promise: function (value) {
        return isPromise(value) ? value : Promise.resolve(value);
    },
    promiseArray: Promise.all,
    promiseObject: function (data) {
        var keys = [];
        var values = [];
        Object.keys(data).forEach(function (key) {
            keys.push(key);
            values.push(data[key]);
        });
        return Promise.all(values).then(function (values) {
            var result = {};
            for (var i = 0; i < keys.length; ++i) {
                result[keys[i]] = values[i];
            }
            return result;
        });
    },
    promiseAny: function (value) {
        if (Array.isArray(value)) {
            return exports.promise.promiseArray(value);
        }
        return exports.promise.promise(value);
    },
    resolve: Promise.resolve
};

/**
 * Merge two attribute objects giving precedence
 * to values in object `b`. Classes are special-cased
 * allowing for arrays and merging/joining appropriately
 * resulting in a string.
 *
 * @param {Object} a
 * @param {Object} b
 * @return {Object} a
 * @api private
 */

exports.merge = function merge(a, b) {
  if (arguments.length === 1) {
    var attrs = a[0];
    for (var i = 1; i < a.length; i++) {
      attrs = merge(attrs, a[i]);
    }
    return attrs;
  }
  var ac = a['class'];
  var bc = b['class'];

  if (ac || bc) {
    ac = ac || [];
    bc = bc || [];
    if (!Array.isArray(ac)) ac = [ac];
    if (!Array.isArray(bc)) bc = [bc];
    a['class'] = ac.concat(bc).filter(nulls);
  }

  for (var key in b) {
    if (key != 'class') {
      a[key] = b[key];
    }
  }

  return a;
};

/**
 * Filter null `val`s.
 *
 * @param {*} val
 * @return {Boolean}
 * @api private
 */

function nulls(val) {
  return val != null && val !== '';
}

/**
 * join array as classes.
 *
 * @param {*} val
 * @return {String}
 */
exports.joinClasses = joinClasses;
function joinClasses(val) {
  return Array.isArray(val) ? val.map(joinClasses).filter(nulls).join(' ') : val;
}

/**
 * Render the given classes.
 *
 * @param {Array} classes
 * @param {Array.<Boolean>} escaped
 * @return {String}
 */
exports.cls = function cls(classes, escaped) {
  var buf = [];
  for (var i = 0; i < classes.length; i++) {
    if (escaped && escaped[i]) {
      buf.push(exports.escape(joinClasses([classes[i]])));
    } else {
      buf.push(joinClasses(classes[i]));
    }
  }
  var text = joinClasses(buf);
  if (text.length) {
    return ' class="' + text + '"';
  } else {
    return '';
  }
};

/**
 * Render the given attribute.
 *
 * @param {String} key
 * @param {String} val
 * @param {Boolean} escaped
 * @param {Boolean} terse
 * @return {String}
 */
exports.attr = function attr(key, val, escaped, terse) {
  if ('boolean' == typeof val || null == val) {
    if (val) {
      return ' ' + (terse ? key : key + '="' + key + '"');
    } else {
      return '';
    }
  } else if (0 == key.indexOf('data') && 'string' != typeof val) {
    return ' ' + key + "='" + JSON.stringify(val).replace(/'/g, '&apos;') + "'";
  } else if (escaped) {
    return ' ' + key + '="' + exports.escape(val) + '"';
  } else {
    return ' ' + key + '="' + val + '"';
  }
};

/**
 * Render the given attributes object.
 *
 * @param {Object} obj
 * @param {Object} escaped
 * @return {String}
 */
exports.attrs = function attrs(obj, terse){
  var buf = [];

  var keys = Object.keys(obj);

  if (keys.length) {
    for (var i = 0; i < keys.length; ++i) {
      var key = keys[i]
        , val = obj[key];

      if ('class' == key) {
        if (val = joinClasses(val)) {
          buf.push(' ' + key + '="' + val + '"');
        }
      } else {
        buf.push(exports.attr(key, val, false, terse));
      }
    }
  }

  return buf.join('');
};

function isArray(value) {
    return Object.prototype.toString.call(value) === "[object Array]";
}

exports.$each = function (itemFn, altFn) {
    return function (items) {
        var i, len, result = [], count = 0;
        if (isArray(items)) {
            for (i = 0, len = items.length; i < len; ++i) {
                result.push(itemFn(items[i], i));
                count++;
            }
        } else {
            for (i in items) {
                if (Object.prototype.hasOwnProperty.call(items, i)) {
                    result.push(itemFn(items[i], i));
                    count++;
                }
            }
        }
        if (count === 0 && typeof altFn === 'function') {
            result.push(altFn());
        }
        return result;
    };
};

function AbstractWriter() {
    var _this = this;
    var ignoreErrors = false;

    function output(items, i) {
        if (i < items.length) {
            var item = items[i];
            if (isArray(item)) {
                return output(item, 0).then(function () {
                    return output(items, i + 1);
                });
            } else if(isPromise(item)) {
                return item.then(function (resolved) {
                    items[i] = resolved;
                    return output(items, i);
                });
            } else {
                /* jshint -W116 */
                if (item != null) {
                    _this.write(String(item));
                }
                return output(items, i + 1);
            }
        }
        return Promise.resolve(_this.finish());
    }

    function outputWithoutErrors(items, i) {
        if (i < items.length) {
            var item = items[i];
            if (isArray(item)) {
                return output(item, 0).then(function () {
                    return output(items, i + 1);
                }, function () {
                    return output(items, i + 1);
                });
            } else if(isPromise(item)) {
                return item.then(function (resolved) {
                    items[i] = resolved;
                    return output(items, i);
                }, function () {
                    return output(items, i + 1);
                });
            } else {
                /* jshint -W116 */
                if (item != null) {
                    _this.write(String(item));
                }
                return output(items, i + 1);
            }
        }
        return Promise.resolve(_this.finish());
    }

    this.ignoreErrors = function (value) {
        ignoreErrors = typeof value === 'undefined' ? true : Boolean(value);
    };

    this.process = function (items) {
        if (ignoreErrors) {
            return outputWithoutErrors(items, 0);
        }
        return output(items, 0);
    };

    this.write = function (data) {
    };

    this.finish = function () {
    };
}

function StreamingWriter(stream, bufferSize) {
    AbstractWriter.call(this);
    var buffer = '';
    bufferSize = bufferSize || 2048;

    this.write = function (data) {
        buffer += data;
        if (buffer.length > bufferSize) {
            stream.write(buffer);
            buffer = '';
        }
    };

    this.finish = function () {
        if (buffer.length > 0) {
            stream.write(buffer);
            buffer = '';
        }
    };
}

function BufferedWriter() {
    AbstractWriter.call(this);
    var buffer = [];

    this.write = function (data) {
        buffer.push(data);
    };

    this.finish = function () {
        return buffer.join("");
    };
}

function CombinedWriter(stream, bufferSize) {
    AbstractWriter.call(this);
    var streamingWriter = new StreamingWriter(stream, bufferSize);
    var bufferedWriter = new BufferedWriter();

    this.write = function (data) {
        streamingWriter.write(data);
        bufferedWriter.write(data);
    };

    this.finish = function () {
        streamingWriter.finish();
        return bufferedWriter.finish();
    };
}

exports.createStreamingWriter = function (stream, bufferSize) {
    return new StreamingWriter(stream, bufferSize);
};

exports.createBufferedWriter = function () {
    return new BufferedWriter();
};

exports.createCombinedWriter = function(stream, bufferSize) {
    return new CombinedWriter(stream, bufferSize);
};

/**
 * Escape the given string of `html`.
 *
 * @param {String} html
 * @return {String}
 * @api private
 */

exports.escape = function escape(html){
  var result = String(html)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  if (result === '' + html) return html;
  else return result;
};

/**
 * Re-throw the given `err` in context to the
 * the jade in `filename` at the given `lineno`.
 *
 * @param {Error} err
 * @param {String} filename
 * @param {String} lineno
 * @api private
 */

exports.rethrow = function rethrow(err, filename, lineno, str){
  if (!(err instanceof Error)) throw err;
  if ((typeof window != 'undefined' || !filename) && !str) {
    err.message += ' on line ' + lineno;
    throw err;
  }
  try {
    str = str || require('fs').readFileSync(filename, 'utf8')
  } catch (ex) {
    rethrow(err, null, lineno)
  }
  var context = 3
    , lines = str.split('\n')
    , start = Math.max(lineno - context, 0)
    , end = Math.min(lines.length, lineno + context);

  // Error context
  var context = lines.slice(start, end).map(function(line, i){
    var curr = i + start + 1;
    return (curr == lineno ? '  > ' : '    ')
      + curr
      + '| '
      + line;
  }).join('\n');

  // Alter exception message
  err.path = filename;
  err.message = (filename || 'Jade') + ':' + lineno
    + '\n' + context + '\n\n' + err.message;
  throw err;
};
