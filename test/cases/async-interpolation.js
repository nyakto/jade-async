var vow = require('vow');

module.exports = {
    host: vow.delay("example.com", 5),
    a: vow.delay(1, 1),
    b: vow.delay(2, 2),
    c: vow.delay(3, 3)
};
