var vow = require('vow');

module.exports = {
    getGreeting: function(username) {
        return vow.delay('Hello, ' + username + '!', 50);
    },
    getItems: function () {
        return [
            vow.delay('item1', 50),
            vow.delay('item2', 75),
            vow.delay('item3', 100)
        ];
    }
};
