'use strict';

/**
 * Module dependencies.
 */

var Parser = require('./parser');
var Lexer = require('./lexer');
var AsyncCompiler = require('./async-compiler');
var runtime = require('./runtime');
var Promise = require('promise');
var fs = require('fs');
var readFile = Promise.denodeify(fs.readFile, 2);

/**
 * Expose self closing tags.
 */

exports.selfClosing = require('./self-closing');

/**
 * Default supported doctypes.
 */

exports.doctypes = require('./doctypes');

/**
 * Text filters.
 */

exports.filters = require('./filters');

/**
 * Utilities.
 */

exports.utils = require('./utils');

/**
 * Expose `Compiler`.
 */

exports.Compiler = AsyncCompiler;

/**
 * Expose `Parser`.
 */

exports.Parser = Parser;

/**
 * Expose `Lexer`.
 */

exports.Lexer = Lexer;

/**
 * Nodes.
 */

exports.nodes = require('./nodes');

/**
 * Jade runtime helpers.
 */

exports.runtime = runtime;

/**
 * Template function cache.
 */

exports.cache = {};

function parse(str, options) {
    var parser = new (options.parser || Parser)(str, options.filename, options);
    var tokens;
    try {
        tokens = parser.parse();
    } catch (err) {
        parser = parser.context();
        runtime.rethrow(err, parser.filename, parser.lexer.lineno, parser.input);
    }

    var compiler = new (options.compiler || AsyncCompiler)(tokens, options);
    var js = compiler.compile();

    if (options.debug) {
        console.error('\nCompiled Function:\n\n\u001b[90m%s\u001b[0m', js.body.replace(/^/gm, '  '));
    }

    return js;
}

exports.compile = function (str, options) {
    options = options || {};
    var code = parse(String(str), options);
    return new Function(code.params.join(','), code.body).bind(null, runtime);
};

exports.compileFile = function (fileName, options) {
    options = options || {};
    var src = fs.readFileSync(fileName, 'utf-8');
    options.filename = fileName;
    return exports.compile(src, options);
};

exports.render = function (src, data, stream, options) {
    options = options || {};

    if (options.cache) {
        if (!options.filename) {
            return Promise.reject(Error('the "filename" option is required for caching'));
        }
        var path = options.filename;
        if (!exports.cache.hasOwnProperty(path)) {
            exports.cache[path] = exports.compile(src, options);
        }
        return exports.cache[path](data, stream);
    }
    return exports.compile(src, options)(data, stream);
};

exports.renderFile = function (fileName, data, stream, options) {
    options = options || {};
    options.filename = fileName;

    if (!exports.cache.hasOwnProperty(fileName)) {
        return readFile(fileName).then(function (src) {
            var tpl = exports.compile(String(src), options);
            exports.cache[fileName] = tpl;
            return tpl(data, stream);
        });
    }
    return exports.cache[fileName](data, stream);
};
