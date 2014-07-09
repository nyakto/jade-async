
/**
 * Module dependencies.
 */

var fs = require('fs');
var assert = require('assert');
var jade = require('../');

jade.filters['custom-filter'] = function (str, options) {
  assert(str === 'foo bar');
  assert(options.foo === 'bar');
  return 'bar baz';
};

// test cases

var cases = fs.readdirSync('test/cases').filter(function(file){
  return ~file.indexOf('.jade');
}).map(function(file){
  return file.replace('.jade', '');
});
try {
  fs.mkdirSync(__dirname + '/output');
} catch (ex) {
  if (ex.code !== 'EEXIST') {
    throw ex;
  }
}

cases.forEach(function(test){
  var name = test.replace(/[-.]/g, ' ');
  it(name, function(done) {
    var path = 'test/cases/' + test + '.jade';
    var html = fs.readFileSync('test/cases/' + test + '.html', 'utf8').trim().replace(/\r/g, '');
    var dataSource = null;
    if (fs.existsSync('test/cases/' + test + '.js')) {
        dataSource = './cases/' + test + '.js';
    } else if (fs.existsSync('test/cases/' + test + '.json')) {
        dataSource = './cases/' + test + '.json';
    }
    var data = {
        title: 'Jade'
    };
    if (dataSource) {
        data = require(dataSource);
    }
    var fn = jade.compileFile(path, { filename: path, pretty: true, basedir: 'test/cases' });

    fn(data).done(function (actual) {
        if (/filter/.test(test)) {
            actual = actual.replace(/\n| /g, '');
            html = html.replace(/\n| /g, '');
        }
        JSON.stringify(actual.trim()).should.equal(JSON.stringify(html));
        fs.writeFileSync(__dirname + '/output/' + test + '.html', actual);
        done();
    });
  });
});

// test cases

var anti = fs.readdirSync('test/anti-cases').filter(function(file){
  return ~file.indexOf('.jade');
}).map(function(file){
  return file.replace('.jade', '');
});

// TODO
xdescribe('certain syntax is not allowed and will throw a compile time error', function () {
  anti.forEach(function(test){
    var name = test.replace(/[-.]/g, ' ');
    it(name, function(){
      var path = 'test/anti-cases/' + test + '.jade';
      var str = fs.readFileSync(path, 'utf8');
      try {
        jade.compile(str, { filename: path, pretty: true, basedir: 'test/anti-cases' });
      } catch (ex) {
        ex.should.be.an.instanceof(Error);
        ex.message.replace(/\\/g, '/').should.startWith(path);
        ex.message.replace(/\\/g, '/').should.match(/:\d+$/m);
        return;
      }
      throw new Error(test + ' should have thrown an error');
    })
  });
});
