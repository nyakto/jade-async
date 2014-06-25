var runtime = require('./runtime');
var filters = require('./filters');
var doctypes = require('./doctypes');
var selfClosing = require('./self-closing');
var addWith = require('with');
var parseJSExpression = require('character-parser').parseMax;
var constantinople = require('constantinople');

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

function DefaultPromiseProvider(name) {
    this.name = name;
}

DefaultPromiseProvider.prototype.fulfill = function (value) {
    return this.name + '.fulfill(' + value + ')';
};

DefaultPromiseProvider.prototype.promise = function (value) {
    return this.name + '.promise(' + value + ')';
};

DefaultPromiseProvider.prototype.all = function (value) {
    return this.name + '.all(' + value + ')';
};

function Block(compiler, name, params, parent) {
    this.compiler = compiler;
    this.name = name;
    this.params = params;
    this.indentSize = parent ? parent.indentSize : 0;
    this.clear();
}

Block.prototype.clear = function () {
    this.simple = true;
    this.header = false;
    this.buff = '';
    this.data = [];
    this.body = '';
};

Block.prototype.raw = function (str, interpolate) {
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
    if (this.buff.length > 0) {
        this.data.push(
            this.compiler.promiseProvider.fulfill(
                JSON.stringify(this.buff)
            )
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
    this.indentSize += size;
    if (write) {
        if (newLine) {
            this.raw('\n');
        }
        this.raw(new Array(this.indentSize + 1).join("  "));
    }
};

Block.prototype.finish = function () {
    this.flush(true);
    if (!this.simple) {
        this.body += 'return buff;';
    }
};

Block.prototype.expression = function (expr, escape, process) {
    this.flush(false);
    var task;
    if (Array.isArray(expr)) {
        task = this.compiler.promiseProvider.all('[' + expr.join(', ') + ']');
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
    this.promiseProvider = new DefaultPromiseProvider('vow');
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
}

AsyncCompiler.prototype.getEscapedWriter = function () {
    return '$escape';
};

AsyncCompiler.prototype.getIteratorFunction = function () {
    return '$each';
};

AsyncCompiler.prototype.getDataSourceName = function () {
    return 'data';
};

AsyncCompiler.prototype.getOutputStreamName = function () {
    return 'stream';
};

AsyncCompiler.prototype.getIterator = function (itemFn, alternativeFn) {
    return this.getIteratorFunction() + '(' + itemFn + (alternativeFn ? ', ' + alternativeFn : '') + ')';
};

AsyncCompiler.prototype.createBlock = function (parent, params) {
    var block = new Block(this, '$b' + this.blocks.length, params || [], parent);
    this.blocks.push(block);
    return block;
};

AsyncCompiler.prototype.compile = function () {
    this.visit(this.node, this.mainBlock);

    var globals = [
        this.promiseProvider.name,
        '$escape',
        this.getIteratorFunction(),
        '$attrs',
        '$attr',
        'jade'
    ];

    var fn = '';
    fn += 'var buff = [];';
    fn += 'var write = ' + this.getOutputStreamName() + ' ? writeAll : writeBuff;';
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

    fn += 'function writeBuff(data) { buff.push(String(data)); }';
    fn += 'function writeAll(data) { data = String(data); buff.push(data); stream.write(data); }';
    fn += 'function isArray(value) { return Object.prototype.toString.call(value) === "[object Array]"; }';
    fn += 'function $escape(value) { return jade.escape(value); }';

    fn += 'function $each(itemFn, altFn) {';
    fn += '    return function (items) {';
    fn += '        var i, len, result = [], count = 0;';
    fn += '        if (isArray(items)) {';
    fn += '            for (i = 0, len = items.length; i < len; ++i) {';
    fn += '                result.push(itemFn(items[i], i));';
    fn += '                count++;';
    fn += '            }';
    fn += '        } else {';
    fn += '            for (i in items) {';
    fn += '                if (Object.prototype.hasOwnProperty.call(items, i)) {';
    fn += '                    result.push(itemFn(items[i], i));';
    fn += '                    count++;';
    fn += '                }';
    fn += '            }';
    fn += '        }';
    fn += '        if (count === 0) {';
    fn += '            result.push(altFn());';
    fn += '        }';
    fn += '        return result;';
    fn += '    };';
    fn += '}';

    fn += 'function $attrs(attrs) {';
    fn += '    return jade.attrs(jade.merge(attrs), ' + JSON.stringify(this.terse) + ');';
    fn += '}';

    fn += 'function $attr(attr) {';
    fn += '    return jade.attr(attr[0], attr[1], attr[2], ' + JSON.stringify(this.terse) + ');';
    fn += '}';

    fn += 'function output(items, i) {';
    fn += '    if (i < items.length) {';
    fn += '        var item = items[i];';
    fn += '        if (isArray(item)) {';
    fn += '            return output(item, 0).then(function () {';
    fn += '                return output(items, i + 1);';
    fn += '            });';
    fn += '        } else if(vow.isPromise(item)) {';
    fn += '            return item.then(function (resolved) {';
    fn += '                items[i] = resolved;';
    fn += '                return output(items, i);';
    fn += '            });';
    fn += '        } else {';
    fn += '            if (item != null) {';
    fn += '                write(item);';
    fn += '            }';
    fn += '            return output(items, i + 1);';
    fn += '        }';
    fn += '    }';
    fn += '    return vow.fulfill(buff.join(""));';
    fn += '}';

    function addLocals(locals) {
        var result = [];
        globals.forEach(function (name) {
            result.push(name);
        });
        locals.forEach(function (name) {
            result.push(name);
        });
        return result;
    }

    this.blocks.forEach(function (block) {
        globals.push(block.name);
    });
    this.blocks.forEach(function (block) {
        block.finish();
        fn += 'function ' + block.name + '(' + block.params.join(', ') + ') {';
        fn += addWith(this.getDataSourceName(), block.body, addLocals(block.params));
        fn += ' }';
    }, this);

    fn += 'return output(' + this.mainBlock.name + '(), 0).then(function () {';
    fn += '    if (stream) {';
    fn += '        stream.end();';
    fn += '    }';
    fn += '    return buff.join("");';
    fn += '});';

    return {
        params: [
            'jade',
            this.promiseProvider.name,
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
    // TODO: indent +1
    block.code('if (block) {');
    block.expression('block()', false);
    block.code('}');
    // TODO: indent -1
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
    var mixin;
    if (dynamic) {
        this.dynamicMixins = true;
        name = name.substr(2, name.length - 3);
    } else if (Object.prototype.hasOwnProperty.call(this.mixins, name)) {
        mixin = this.mixins[name];
    } else {
        var params = ['block', 'attributes'];
        mixin = this.mixins[name] = {
            block: this.createBlock(null, params),
            used: false
        };
        mixin.name = mixin.block.name;
    }

    if (node.call) {
        var innerBlock = 'null';
        var attrs = 'null';
        var args = node.args || '';
        if (node.block) {
            innerBlock = this.createBlock(null);
            this.visit(node.block, innerBlock);
            innerBlock = innerBlock.name;
        }
        if (node.attributeBlocks) {
            if (node.attrs.length) {
                node.attributeBlocks.unshift(this.attrs(node.attrs));
            }
            attrs = this.promiseProvider.all('[' + node.attributeBlocks.join(', ') + ']') + '.then(jade.merge)';
        } else if (node.attrs.length) {
            attrs = this.attrs(node.attrs);
        }

        if (dynamic) {
            if (args.length || innerBlock !== 'null' || attrs !== 'null') {
                args = name + ', ' + innerBlock + ', ' + attrs + (args.length ? ', ' + args : '');
                block.expression(
                    this.promiseProvider.all('[' + args + ']'),
                    false,
                    'function (args) { var name = args.shift(); return $mixins[name].apply(null, args); }'
                );
            } else {
                block.expression(name, false, 'function (name) { $mixins[name](); }');
            }
        } else {
            mixin.used = true;
            if (args.length || innerBlock !== 'null' || attrs !== 'null') {
                args = innerBlock + ', ' + attrs + (args.length ? ', ' + args : '');
                block.expression(
                    this.promiseProvider.all('[' + args + ']'),
                    false,
                    'function (args) { return ' + mixin.name + '.apply(null, args); }'
                );
            } else {
                block.expression(mixin.name + '()', false);
            }
        }
    } else {
        mixin.block.params.splice(2, mixin.block.params.length - 2);
        if (node.args) {
            node.args.split(/\s*,\s*/).forEach(function (arg) {
                mixin.block.params.push(arg);
            });
        }
        mixin.block.clear();
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
        // TODO: error if block non-empty
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
        // TODO: не вычислять повторно, кешировать результат
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
        block.raw('<!--' + node.val + '-->');
    }
};

AsyncCompiler.prototype.visitBlockComment = function (node, block) {
    if (node.buffer) {
        block.raw('<!--' + node.val);
        this.visit(node.block, block);
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
                block.expression([JSON.stringify(key), attr.val, JSON.stringify(escaped)], false, ['$attr']);
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
                classes,
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
            classes = this.promiseProvider.all(classes) + '.then(function (classes) {';
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
    return this.promiseProvider.all('{' + buf.join(',') + '}');
};

module.exports = AsyncCompiler;
