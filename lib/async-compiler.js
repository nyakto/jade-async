var runtime = require('./runtime');
var filters = require('./filters');
var doctypes = require('./doctypes');
var selfClosing = require('./self-closing');
var parseJSExpression = require('character-parser').parseMax;
var constantinople = require('constantinople');
var uglify = require('uglify-js');

function isConstant(src) {
    return constantinople(src, {
        jade: runtime
    });
}

function toConstant(src) {
    return constantinople.toConstant(
        src,
        {
            jade: runtime
        }
    );
}

function addWith(obj, src, exclude) {
    exclude = exclude || [];
    exclude.push(
        obj,
        'Infinity',
        'NaN',
        'undefined',
        'eval',
        'isFinite',
        'isNaN',
        'parseFloat',
        'parseInt',
        'decodeURI',
        'decodeURIComponent',
        'encodeURI',
        'encodeURIComponent',
        'Object',
        'Function',
        'Boolean',
        'Error',
        'EvalError',
        'InternalError',
        'RangeError',
        'ReferenceError',
        'SyntaxError',
        'TypeError',
        'URIError',
        'Number',
        'Math',
        'Date',
        'String',
        'RegExp',
        'Array',
        'JSON'
    );

    function wrap(src, vars) {
        var inputVars = vars.map(function (name) {
            return obj + "." + name;
        });

        return 'return (function(' + vars.join(',') + '){' + src + '}(' + inputVars.join(',') + '));';
    }

    var vars = findGlobals(src).filter(function (name) {
        return exclude.indexOf(name) === -1;
    });

    if (vars.length === 0) {
        return src;
    }

    return wrap(src, vars);
}

function findGlobals(src) {
    var ast = uglify.parse('(function () {' + src + '}())');
    ast.figure_out_scope();
    var result = [];
    ast.globals.each(function (node, name) {
        result.push(name);
    });
    return result;
}

function findLocals(src) {
    var ast = uglify.parse('function $ast() {' + src + '}');
    ast.figure_out_scope();
    var fn = ast.body[0];
    var result = [];
    fn.variables.each(function (node) {
        if (!node.global) {
            result.push(node.name);
        }
    });
    return result;
}

function DefaultPromiseProvider(name) {
    this.name = name;
}

DefaultPromiseProvider.prototype.isPromise = function (value) {
    var prefix = value.substr(0, this.name.length + 1);
    if (prefix === this.name + '.') {
        return /^[^.]+\.(promiseArray|promiseObject|promiseAny|resolve|promise)\(.*\)$/.test(value);
    }
    return false;
};

DefaultPromiseProvider.prototype.promise = function (value) {
    if (this.isPromise(value)) {
        return value;
    }
    return this.name + '.promise(' + value + ')';
};

DefaultPromiseProvider.prototype.promiseArray = function (value) {
    return this.name + '.promiseArray(' + value + ')';
};

DefaultPromiseProvider.prototype.promiseObject = function (value) {
    return this.name + '.promiseObject(' + value + ')';
};

DefaultPromiseProvider.prototype.promiseAny = function (value) {
    return this.name + '.promiseAny(' + value + ')';
};

function Block(compiler, name, params, parent, dynamicIndent) {
    this.compiler = compiler;
    this.name = name;
    this.params = params;
    this.indentSize = 0;
    this.isNested = false;
    this.resolved = [];
    this.custom = false;
    this.dynamicIndent = Boolean(dynamicIndent);
    if (parent) {
        this.isNested = true;
        if (!this.dynamicIndent) {
            this.indentSize = parent.indentSize;
        }
        parent.nested.push(this);
    }
    this.clear();
}

Block.prototype.clear = function () {
    this.simple = true;
    this.header = false;
    this.buff = '';
    this.data = [];
    this.nested = [];
    this.body = '';
};

Block.prototype.raw = function (str, interpolate) {
    if (this.custom) {
        return;
    }

    if (interpolate) {
        var match = /(\\)?([#!]){((?:.|\n)*)$/.exec(str);
        if (match) {
            this.raw(str.substr(0, match.index), false);
            if (match[1]) {
                this.raw(match[2] + '{', false);
                this.raw(match[3], true);
            } else {
                var rest = match[3];
                var range = parseJSExpression(rest);
                this.expression(range.src, '!' !== match[2]);
                this.raw(rest.substr(range.end + 1), true);
            }
            return;
        }
    }

    this.buff += str;
};

Block.prototype.flush = function (renderData) {
    if (this.custom) {
        return;
    }
    if (this.buff.length > 0) {
        this.data.push(
            JSON.stringify(this.buff)
        );
        this.buff = '';
    }
    if (renderData) {
        if (this.simple) {
            this.body = 'return [' + this.data.join(', ') + '];';
        } else {
            if (this.header) {
                if (this.data.length > 0) {
                    this.body += 'buff.push(' + this.data.join(', ') + ');';
                }
            } else {
                this.header = true;
                this.body = 'var buff = [' + this.data.join(', ') + '];';
            }
        }
        this.data = [];
    }
};

Block.prototype.indent = function (size, write, newLine) {
    if (this.custom) {
        return;
    }
    this.indentSize += size;
    if (write) {
        if (newLine) {
            this.raw('\n');
        }
        if (this.dynamicIndent) {
            this.expression('$indent');
        }
        this.raw(new Array(this.indentSize + 1).join("  "));
    }
};

Block.prototype.getIndentation = function () {
    var result = [
        this.dynamicIndent ? '$indent' : '',
        JSON.stringify(new Array(this.indentSize + 1).join('  '))
    ].filter(function (item) {
        return item.length > 0;
    });
    return result.length > 0 ? result.join(' + ') : JSON.stringify('');
};

Block.prototype.finish = function () {
    this.flush(true);
    if (!this.simple && !this.custom) {
        this.body += 'return buff;';
    }
};

Block.prototype.compile = function (globals) {
    var code = '';
    var locals = [];
    this.finish();

    globals.forEach(function (name) {
        locals.push(name);
    });
    this.params.forEach(function (name) {
        locals.push(name);
    });
    this.nested.forEach(function (nestedBlock) {
        locals.push(nestedBlock.name);
    });
    findLocals(this.body).forEach(function (name) {
        locals.push(name);
    });

    code += 'function ' + this.name + '(' + this.params.join(', ') + ') {';
    code += this.nested.map(function (nestedBlock) {
        return nestedBlock.compile(locals);
    }).join('');
    if (this.compiler.useSelf) {
        code += this.body;
    } else {
        code += addWith(this.compiler.getDataSourceName(), this.body, locals);
    }
    code += ' }';
    return code;
};

Block.prototype.expression = function (expr, escape, process) {
    if (this.custom) {
        return;
    }
    if (!Array.isArray(expr) && !process) {
        if (isConstant(expr)) {
            var str = toConstant(expr);
            if (str == null) {
                return;
            }
            if (escape) {
                str = runtime.escape(str);
            }
            return this.raw(str);
        } else if (this.resolved.indexOf(expr) >= 0) {
            this.flush(false);
            if (escape) {
                this.data.push(this.compiler.getEscapedWriter() + '(' + expr + ')');
            } else {
                this.data.push(expr);
            }
            return;
        }
    }
    this.flush(false);
    var task;
    if (!process && !escape) {
        if (Array.isArray(expr)) {
            this.data.push('[' + expr.join(', ') + ']');
        } else {
            this.data.push(expr);
        }
        return;
    }
    if (Array.isArray(expr)) {
        task = this.compiler.promiseProvider.promiseArray('[' + expr.join(', ') + ']');
    } else {
        task = this.compiler.promiseProvider.promise(expr);
    }
    if (process) {
        if (!Array.isArray(process)) {
            process = [process];
        }
        process.forEach(function (mapper) {
            task += '.then(' + mapper + ')';
        });
    }
    if (escape) {
        task += '.then(' + this.compiler.getEscapedWriter() + ')';
    }
    this.data.push(task);
};

Block.prototype.code = function (expr) {
    this.simple = false;
    this.flush(true);
    this.body += expr;
};

function AsyncCompiler(node, options) {
    this.options = options = options || {};
    this.prettyPrint = Boolean(options.pretty);
    this.node = node;
    this.promiseProvider = new DefaultPromiseProvider('$promise');
    this.blocks = [];
    this.mixins = {};
    this.mainBlock = this.createBlock();
    this.hasWrittenDoctype = false;
    this.hasVisitedTag = false;
    this.terse = false;
    this.xml = false;
    this.doctype = null;
    this.escape = false;
    this.dynamicMixins = false;
    this.useSelf = Boolean(options.self);
    this.useAttr = false;
    this.useAttrs = false;
    this.streamOnly = Boolean(options.streamOnly);
}

AsyncCompiler.prototype.getEscapedWriter = function () {
    return 'jade.escape';
};

AsyncCompiler.prototype.getDataSourceName = function () {
    return 'data';
};

AsyncCompiler.prototype.getOutputStreamName = function () {
    return 'stream';
};

AsyncCompiler.prototype.getIterator = function (itemFn, alternativeFn) {
    return 'jade.$each(' + itemFn + (alternativeFn ? ', ' + alternativeFn : '') + ')';
};

AsyncCompiler.prototype.createBlock = function (parent, params, dynamicIndent) {
    params = params || [];
    var block = new Block(this, '$b' + this.blocks.length, params, parent, dynamicIndent);
    this.blocks.push(block);
    return block;
};

AsyncCompiler.prototype.compile = function () {
    this.visit(this.node, this.mainBlock);

    var globals = [
        '$mixins',
        '$promise',
        'jade'
    ];
    if (this.useAttr) {
        globals.push('$attr');
    }
    if (this.useAttrs) {
        globals.push('$attrs');
    }

    var fn = '';
    var streamingBufferSize = this.options.streamingBufferSize;
    if (this.useSelf) {
        fn += 'var self = data || {};';
    }
    if (this.streamOnly) {
        fn += 'var writer = jade.createStreamingWriter(' + this.getOutputStreamName() +
            ', ' + streamingBufferSize + ');';
    } else {
        fn += 'var writer = ' + this.getOutputStreamName() +
            '? jade.createCombinedWriter(' + this.getOutputStreamName() + ', ' + streamingBufferSize + ')' +
            ': jade.createBufferedWriter();';
    }
    fn += 'var $promise = jade.promise;';
    fn += this.getDataSourceName() + ' = ' + this.getDataSourceName() + ' || {};';

    if (this.dynamicMixins) {
        fn += 'var $mixins = {';
        Object.keys(this.mixins).forEach(function (name, i) {
            if (i > 0) {
                fn += ', ';
            }
            fn += JSON.stringify(name) + ': ' + this.mixins[name].name;
        }, this);
        fn += '};';
    }

    if (this.useAttrs) {
        fn += 'function $attrs(attrs) {';
        fn += '    return jade.attrs(jade.merge(attrs), ' + JSON.stringify(this.terse) + ');';
        fn += '}';
    }

    if (this.useAttr) {
        fn += 'function $attr(attr) {';
        fn += '    return jade.attr(attr[0], attr[1], attr[2], ' + JSON.stringify(this.terse) + ');';
        fn += '}';
    }

    var globalBlocks = this.blocks.filter(function (block) {
        return !block.isNested;
    });

    globalBlocks.forEach(function (block) {
        globals.push(block.name);
    });
    fn += globalBlocks.map(function (block) {
        return block.compile(globals);
    }, this).join('');

    if (this.options.ignoreErrors) {
        fn += 'writer.ignoreErrors();';
    }

    fn += 'return writer.process(' + this.mainBlock.name + '());';

    return {
        params: [
            'jade',
            this.getDataSourceName(),
            this.getOutputStreamName()
        ],
        body: fn
    };
};

AsyncCompiler.prototype.setDoctype = function (name) {
    this.doctype = doctypes[name.toLowerCase()] || '<!DOCTYPE ' + name + '>';
    this.terse = this.doctype.toLowerCase() === '<!doctype html>';
    this.xml = 0 === this.doctype.indexOf('<?xml');
};

AsyncCompiler.prototype.visit = function (node, block) {
    this['visit' + node.type](node, block);
};

AsyncCompiler.prototype.visitBlock = function (node, block) {
    var len = node.nodes.length;
    var prettyPrint = this.prettyPrint && !this.escape;
    if (prettyPrint && len > 1 && node.nodes[0].isText && node.nodes[1].isText) {
        block.indent(0, true, true);
    }
    node.nodes.forEach(function (childNode, i) {
        if (prettyPrint && i > 0 && childNode.isText && node.nodes[i - 1].isText) {
            block.indent(0, true, false);
        }
        this.visit(childNode, block);
        if (i + 1 < len && childNode.isText && node.nodes[i + 1].isText) {
            block.raw('\n');
        }
    }, this);
};

AsyncCompiler.prototype.visitCase = function (node, block) {
    var body = this.createBlock(block, ['$caseValue']);
    block.expression(node.expr, false, body.name);
    body.code('switch ($caseValue) {');
    this.visit(node.block, body);
    body.code('}');
};

AsyncCompiler.prototype.visitWhen = function (node, block) {
    if ('default' === node.expr) {
        block.code('default:');
    } else {
        block.code('case ' + node.expr + ':');
    }
    if (node.block) {
        this.visit(node.block, block);
        block.code('break;');
    }
};

AsyncCompiler.prototype.visitLiteral = function (node, block) {
    block.raw(node.str);
};

AsyncCompiler.prototype.visitMixinBlock = function (node, block) {
    block.code('if (block) {');
    block.expression('block(' + block.getIndentation() + ')', false);
    block.code('}');
};

AsyncCompiler.prototype.visitDoctype = function (node, block) {
    if (node && (node.val || !this.doctype)) {
        this.setDoctype(node.val || 'default');
    }
    if (this.doctype) {
        block.raw(this.doctype);
    }
    this.hasWrittenDoctype = true;
};

AsyncCompiler.prototype.visitMixin = function (node, block) {
    var name = node.name;
    var dynamic = name.charAt(0) === '#';
    var mixin, override = false;
    if (dynamic) {
        this.dynamicMixins = true;
        name = name.substr(2, name.length - 3);
    } else if (Object.prototype.hasOwnProperty.call(this.mixins, name)) {
        mixin = this.mixins[name];
        if (mixin.declared) {
            override = true;
        }
    } else {
        var params = ['$indent', 'block', 'attributes'];
        mixin = this.mixins[name] = {
            block: this.createBlock(null, params, true),
            declared: false,
            used: false
        };
        mixin.name = mixin.block.name;
        mixin.block.resolved.push(
            '$indent',
            'block',
            'attributes'
        );
    }

    if (node.call) {
        var indentation = block.getIndentation();
        var innerBlock = 'null';
        var attrs = '{}';
        var args = node.args || '';
        if (node.block) {
            if (block.isMixin) {
                innerBlock = this.createBlock(block, ['$indent', 'block'], true);
            } else {
                innerBlock = this.createBlock(block, ['$indent'], true);
            }
            innerBlock.resolved.push('$indent');
            this.visit(node.block, innerBlock);
            innerBlock = innerBlock.name;
            if (block.isMixin) {
                innerBlock = 'function ($indent) { return ' + innerBlock + '($indent, block); }';
            }
        }
        if (node.attributeBlocks.length) {
            if (node.attrs.length) {
                node.attributeBlocks.unshift(this.attrs(node.attrs));
            }
            attrs = this.promiseProvider.promiseArray('[' + node.attributeBlocks.join(', ') + ']') + '.then(jade.merge)';
        } else if (node.attrs.length) {
            attrs = this.attrs(node.attrs);
        }

        if (dynamic) {
            args = name + ', ' + indentation + ',' + innerBlock + ', ' + attrs + (args.length ? ', ' + args : '');
            block.expression(
                this.promiseProvider.promiseArray('[' + args + ']'),
                false,
                'function (args) { var name = args.shift(); return $mixins[name].apply(null, args); }'
            );
        } else {
            mixin.used = true;
            if (isConstant('[' + args + ']') && isConstant(attrs)) {
                args = indentation + ',' + innerBlock + ', ' + attrs + (args.length ? ', ' + args : '');
                block.expression(mixin.name + '(' + args + ')');
            } else {
                args = indentation + ',' + innerBlock + ', ' + attrs + (args.length ? ', ' + args : '');
                block.expression(
                    this.promiseProvider.promiseArray('[' + args + ']'),
                    false,
                        'function (args) { return ' + mixin.name + '.apply(null, args); }'
                );
            }
        }
    } else {
        if (override) {
            mixin.block = this.createBlock(null, ['$indent', 'block', 'attributes'], true);
            mixin.name = mixin.block.name;
            mixin.block.resolved.push(
                '$indent',
                'block',
                'attributes'
            );
        }
        mixin.block.isMixin = true;
        mixin.declared = true;
        if (node.args) {
            node.args.split(/\s*,\s*/).forEach(function (arg) {
                mixin.block.params.push(arg);
            });
        }
        this.visit(node.block, mixin.block);
    }
};

AsyncCompiler.prototype.visitTag = function (node, block) {
    var name = node.name;
    if (!this.hasVisitedTag) {
        if (!this.hasWrittenDoctype && 'html' === name) {
            this.visitDoctype();
        }
        this.hasVisitedTag = true;
    }

    function tagName() {
        if (node.buffer) {
            block.expression(name, false);
        } else {
            block.raw(name);
        }
    }

    function hasBlock(node) {
        return node.block && !(node.block.type === 'Block' &&
            node.block.nodes.length === 0) &&
            node.block.nodes.some(function (node) {
                return node.type !== 'Text' || !/^\s*$/.test(node.val);
            });
    }

    var oldEscape = this.escape;
    if (name === 'pre') {
        this.escape = true;
    }

    if (this.prettyPrint && !node.isInline()) {
        block.indent(0, true, true);
    }

    var isSelfClosing = node.selfClosing || (!this.xml && selfClosing.indexOf(name) !== -1);
    if (isSelfClosing) {
        block.raw('<');
        tagName();
        this.visitAttributes(node.attrs, node.attributeBlocks, block);
        block.raw(this.terse ? '>' : '/>');
        if (hasBlock(node)) {
            throw new Error();
        }
    } else {
        block.raw('<');
        tagName();
        this.visitAttributes(node.attrs, node.attributeBlocks, block);
        block.raw('>');
        if (node.code) {
            this.visit(node.code, block);
        }
        block.indent(1, false);
        this.visit(node.block, block);
        block.indent(-1, false);
        if (this.prettyPrint && !node.isInline() && 'pre' !== name && !node.canInline()) {
            block.indent(0, true, true);
        }
        block.raw('</');
        // TODO: cache result, do not compute twice
        tagName();
        block.raw('>');
    }

    if (name === 'pre') {
        this.escape = oldEscape;
    }
};

AsyncCompiler.prototype.visitFilter = function (node, block) {
    var text = node.block.nodes.map(function (childNode) {
        return childNode.val;
    }).join('\n');
    node.attrs.filename = this.options.filename;
    block.raw(filters(node.name, text, node.attrs), true);
};

AsyncCompiler.prototype.visitText = function (node, block) {
    block.raw(node.val, true);
};

AsyncCompiler.prototype.visitComment = function (node, block) {
    if (node.buffer) {
        if (this.prettyPrint) {
            block.indent(0, true, true);
        }
        block.raw('<!--' + node.val + '-->');
    }
};

AsyncCompiler.prototype.visitBlockComment = function (node, block) {
    if (node.buffer) {
        if (this.prettyPrint) {
            block.indent(0, true, true);
        }
        block.raw('<!--' + node.val);
        this.visit(node.block, block);
        if (this.prettyPrint) {
            block.indent(0, true, true);
        }
        block.raw('-->');
    }
};

AsyncCompiler.prototype.visitCode = function (node, block) {
    if (node.buffer) {
        block.expression(node.val.trimLeft(), node.escape);
    } else {
        block.code(node.val);
        if (node.block) {
            if (!node.buffer) {
                block.code('{');
            }
            this.visit(node.block, block);
            if (!node.buffer) {
                block.code('}');
            }
        } else {
            block.code(';');
        }
    }
};

AsyncCompiler.prototype.visitEach = function (node, block) {
    var itemBlock = this.createBlock(block, [node.val, node.key]);
    itemBlock.resolved.push(node.key);
    this.visit(node.block, itemBlock);
    var alternativeBlock = null;
    if (node.alternative) {
        alternativeBlock = this.createBlock(block);
        this.visit(node.alternative, alternativeBlock);
    }
    block.expression(node.obj, false, this.getIterator(
        itemBlock.name,
        alternativeBlock ? alternativeBlock.name : null
    ));
};

AsyncCompiler.prototype.visitAttributes = function (attrs, attributeBlocks, block) {
    if (attributeBlocks.length) {
        if (attrs.length) {
            var val = this.attrs(attrs);
            attributeBlocks.unshift(val);
        }
        block.expression(attributeBlocks, false, ['$attrs']);
        this.useAttrs = true;
    } else if (attrs.length) {
        this.attrs(attrs, block);
    }
};

AsyncCompiler.prototype.attrs = function (attrs, block) {
    var buf = [];
    var classes = [];
    var classEscaping = [];

    attrs.forEach(function (attr) {
        var key = attr.name;
        var escaped = attr.escaped;
        var val;

        if (key === 'class') {
            classes.push(attr.val);
            classEscaping.push(attr.escaped);
        } else if (isConstant(attr.val)) {
            if (block) {
                block.raw(runtime.attr(key, toConstant(attr.val), escaped, this.terse));
            } else {
                val = toConstant(attr.val);
                if (escaped && !(key.indexOf('data') === 0 && typeof val !== 'string')) {
                    val = runtime.escape(val);
                }
                buf.push(JSON.stringify(key) + ': ' + JSON.stringify(val));
            }
        } else {
            if (block) {
                this.useAttr = true;
                var globals = findGlobals(attr.val);
                var fn = this.createBlock(block, globals);
                fn.custom = true;
                fn.code('return ' + attr.val + ';');
                fn.finish();
                var value = this.promiseProvider.promiseArray(
                        '[' +
                        globals.join(',') +
                        ']'
                ) + '.then(function (args) { return ' + fn.name + '.apply(null, args); })';
                block.expression([JSON.stringify(key), value, JSON.stringify(escaped)], false, ['$attr']);
            } else {
                val = attr.val;
                if (escaped) {
                    val = this.promiseProvider.promise(val) + '.then(jade.escape)';
                }
                buf.push(JSON.stringify(key) + ': ' + val);
            }
        }
    }, this);
    if (block) {
        if (classes.every(isConstant)) {
            block.raw(runtime.cls(classes.map(toConstant), classEscaping));
        } else {
            block.expression(
                classes.map(function (classExpr) {
                    if (isConstant(classExpr)) {
                        return classExpr;
                    }
                    return this.promiseProvider.promiseAny(classExpr);
                }, this),
                false,
                'function (classes) { return jade.cls(classes, ' + JSON.stringify(classEscaping) + '); }'
            );
        }
    } else if (classes.length) {
        if (classes.every(isConstant)) {
            classes = JSON.stringify(runtime.joinClasses(classes.map(toConstant).map(runtime.joinClasses).map(function (cls, i) {
                return classEscaping[i] ? runtime.escape(cls) : cls;
            })));
        } else {
            classes = this.promiseProvider.promiseArray('[' + classes + ']') + '.then(function (classes) {';
            classes += '    var escaping = ' + JSON.stringify(classEscaping) + ';';
            classes += '    return jade.joinClasses(';
            classes += '        classes.map(jade.joinClasses).map(function (cls, i) {';
            classes += '            return escaping[i] ? jade.escape(cls) : cls;';
            classes += '        })';
            classes += '    );';
            classes += '})';
        }
        if (classes.length) {
            buf.push('"class": ' + classes);
        }
    }
    return this.promiseProvider.promiseObject('{' + buf.join(',') + '}');
};

module.exports = AsyncCompiler;
