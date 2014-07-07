/*jshint multistr: true */

var uubench = require('uubench');
var jade = require('../');

var suite = new uubench.Suite({
    type: "fixed",
    iterations: 10000,
    result: function (name, stats) {
        var persec = 1000 / stats.elapsed;
        var ops = stats.iterations * persec;
        console.log('%s: %d', name, Math.floor(ops));
    }
});

function setup(self) {
    var suffix = self ? ' (self)' : '';
    var options = {
        self: self
    };

    var str = 'html\n  body\n    h1 Title';
    var fn1 = jade.compile(str, options);

    suite.bench('tiny' + suffix, function (next) {
        fn1().done(next);
    });

    str = '\
html\n\
  body\n\
    h1 Title\n\
    ul#menu\n\
      li: a(href="#") Home\n\
      li: a(href="#") About Us\n\
      li: a(href="#") Store\n\
      li: a(href="#") FAQ\n\
      li: a(href="#") Contact\n';

    var fn2 = jade.compile(str, options);

    suite.bench('small' + suffix, function (next) {
        fn2().done(next);
    });

    str = '\
html\n\
  body\n\
    h1 #{title}\n\
    ul#menu\n\
      - each link in links\r\n\
        li: a(href="#")= link\r\n';

    if (self) {
        str = '\
html\n\
  body\n\
    h1 #{self.title}\n\
    ul#menu\n\
      - each link in self.links\r\n\
        li: a(href="#")= link\r\n';
    }

    var fn3 = jade.compile(str, options);

    suite.bench('small locals' + suffix, function (next) {
        fn3({
            title: 'Title',
            links: [
                'Home',
                'About Us',
                'Store',
                'FAQ',
                'Contact'
            ]
        }).done(next);
    });

    str = '\
html\n\
  body\n\
    h1 Title\n\
    ul#menu\n\
      li: a(href="#") Home\n\
      li: a(href="#") About Us\n\
      li: a(href="#") Store\n\
      li: a(href="#") FAQ\n\
      li: a(href="#") Contact\n';

    str = new Array(30).join(str);
    var fn4 = jade.compile(str, options);

    suite.bench('medium' + suffix, function (next) {
        fn4().done(next);
    });

    str = '\
html\n\
  body\n\
    h1 Title\n\
    ul#menu\n\
      li: a(href="#") Home\n\
      li: a(href="#") About Us\n\
      li: a(href="#") Store\n\
      li: a(href="#") FAQ\n\
      li: a(href="#") Contact\n';

    str = new Array(100).join(str);
    var fn5 = jade.compile(str, options);

    suite.bench('large' + suffix, function (next) {
        fn5().done(next);
    });
}

setup();
setup(true);

suite.run();
