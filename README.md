jade-async
==========

This is work in progress. Even so, it passes much of original jade tests.

### Usage

template.jade
```jade
doctype html
html
	head
		title jade-async
	body
		h1= getGreeting('world')
		ul
			each item in getItems()
				li= item
```

test.js
```js
var jade = require('jade-async');
var vow = require('vow');

var tpl = jade.compileFile('template.jade');
var data = {
	getGreeting: function(username) {
		return vow.delay('Hello, ' + username + '!', 500);
	},
	getItems: function () {
		return [
			vow.delay('item1', 500),
			vow.delay('item2', 750),
			vow.delay('item3', 1000)
		];
	}
};
// promises
tpl(data).done(function (html) {
	console.log(html);
});
// streaming
tpl(data, process.stdout);
```
