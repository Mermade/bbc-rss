var http = require('http');
var https = require('https');
var express = require('express');
var app = express();

var pg = require('pg');

var j2x = require('jgexml/json2xml.js');

const bbc = 'www.bbc.co.uk';
var connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/main';
connectionString = connectionString + '?ssl=true';


/**
 * getJSON:  REST get request returning JSON object(s)
 * @param options: http options object
 * @param callback: callback to pass the results JSON object(s) back
 */
getJSON = function(options, onResult) {
    //console.log("rest::getJSON");

    var prot = options.port == 443 ? https : http;
	console.log(options.path);
	options.headers.Connection = 'keep-alive';
    var req = prot.request(options, function(res) {
        var output = '';
        console.log(options.host + ':' + res.statusCode);
        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            output += chunk;
        });

        res.on('end', function() {
			var obj = {};
			if (res.statusCode == 200) {
				obj = {}
				try {
					obj = JSON.parse(output);
				}
				catch (err) {
				}
			}
            onResult(res.statusCode, obj);
        });
    });

    req.on('error', function(err) {
        //res.send('error: ' + err.message);
    });

    req.end();
};

function updateHitCounter() {
	var client = new pg.Client(connectionString);
	client.connect();
	var query = client.query("UPDATE hitcounter SET hit = hit+1 WHERE app = 'bbc-rss'");
	query.on('end', function() { client.end(); });
}

function getHitCounter(callback) {
	var hit = {};
	var client = new pg.Client(connectionString);
	client.connect();
	var query = client.query("SELECT hit FROM hitcounter WHERE app = 'bbc-rss'");
	query.on('row', function(row) {
		callback(row);
	});
	query.on('end', function() {	
		client.end();
	});
}

function clear(pid,payload) {
	var undone = false;
	for (var i=0;i<payload.source.length;i++) {
		if (payload.source[i].pid == pid) {
			payload.source[i].done = true;
		}
		if (payload.source[i].done == false) {
			undone = true;
		}
	}
	if (!undone) {
		finish(payload);
	}	
}

function list(payload,parent) {
	//. path = '/programmes/'+obj.pid+'/episodes/player.json'
	var options = {
		host: bbc,
		port: 80,
		path: '/programmes/'+parent.pid+'/episodes/player.json',
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		}
	};
	getJSON(options,function(stateCode,obj) {
		if (stateCode == 200) {
			//console.log(JSON.stringify(obj,null,2));
			for (var i in obj.episodes) {
				process.stdout.write('.');
				var p = obj.episodes[i].programme;
				if ((p.type == 'episode') || (p.type == 'clip')) {
					p.parent = parent;
					payload.results.push(p);
				}
				else {
					console.log('Recursing to '+p.pid);
					var job = {};
					job.pid = p.pid;
					job.done = false;
					payload.source.push(job);
					list(payload,p);
				}
			}
		}
		else {
			console.log('Inner '+parent.pid+' '+stateCode);
		}
		clear(parent.pid,payload);
	});
}

function children(obj,payload) {
	payload.source = [];
	payload.results = [];
	if ((obj.category_slice) && (obj.category_slice.programmes)) {
		for (var i=0;i<obj.category_slice.programmes.length;i++) {
			p = obj.category_slice.programmes[i];
			
			if ((p.type == 'episode') || (p.type == 'clip')) {
				payload.results.push(p);
			}
			else if ((p.type == 'brand') || (p.type == 'series')) {
				var job = {};
				job.done = false;
				job.pid = p.pid;
				payload.source.push(job);
				list(payload,p);
			}
		}
	}
	return payload.results;
}

function ss_child(payload,parent) {
	//. http://www.bbc.co.uk/programmes/b0557671.json
	var options = {
		host: bbc,
		port: 80,
		path: '/programmes/'+parent.pid+'.json',
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		}
	};
	getJSON(options,function(stateCode,obj) {
		if (stateCode == 200) {
			var p = obj.programme;
			if ((p.type == 'episode') || (p.type == 'clip')) {
				p.parent = parent;
				payload.results.push(p);
			}
			else {
				console.log('Recursing to '+p.pid);
				var job = {};
				job.pid = p.pid;
				job.done = false;
				payload.source.push(job);
				list(payload,p);
			}
		}
		else {
			console.log('Inner '+parent.pid+' '+stateCode);
		}
		clear(parent.pid,payload);
	});
}

function ss_children(obj,payload) {
	payload.source = [];
	payload.results = [];
	
	var any = false;
	
	var input = obj[1];
	
	for (var i=0;i<input.length;i++) {
		o = input[i];
		for (var j=0;j<o.tleo.length;j++) {
			p = o.tleo[j];
			if (p.pid && p.type) {
				any = true;
				console.log('Children: '+p.type+' '+p.pid);
				var job = {};
				job.done = false;
				job.pid = p.pid;
				payload.source.push(job);
				if ((p.type == 'episode') || (p.type == 'clip')) {
					ss_child(payload,p);
				}
				else if ((p.type == 'brand') || (p.type == 'series')) {
					list(payload,p);
				}
			}
		}
	}
	if (!any) {
		finish(payload);
	}
	return payload.results;
}

/*
    "type": "episode",
    "pid": "b007jmt2",
    "position": 5,
    "title": "Episode 5",
    "short_synopsis": "The stalled rocket ship stops Captain Jet and his crew from returning to Earth.",
    "media_type": "audio",
    "duration": 1800,
    "image": {
      "pid": "p01lcb4k"
    },
    "display_titles": {
      "title": "Operation Luna",
      "subtitle": "Episode 5"
    },
    "first_broadcast_date": "2008-08-09T18:00:00+01:00",
    "has_medium_or_long_synopsis": true,
    "has_related_links": false,
    "has_clips": false,
    "has_segment_events": false,
    "ownership": {
      "service": {
        "type": "radio",
        "id": "bbc_radio_four_extra",
        "key": "radio4extra",
        "title": "BBC Radio 4 Extra"
      }
	}
*/

function finish(payload) {

	console.log('final '+payload.results.length);
	
	var feed = {};
	var rss = {};
	rss['@version'] = "2.0";
	rss.channel = {};
	rss.channel.title = 'BBC RSS programmes feed - '+payload.feed;
	rss.channel.link = 'http://bbc-rss.herokuapp.com/rss/'+(payload.domain ? payload.domain+'/' : '')+encodeURIComponent(payload.feed)+'.rss';
	rss.channel.description = 'Unofficial BBC iPlayer feeds';
	rss.channel.webMaster = 'mike.ralphson@gmail.com (Mike Ralphson)';
	rss.channel.pubDate = new Date().toUTCString();
	rss.channel.generator = 'bbcparse by Mermade Software';
	rss.channel.item = [];
	
	for (var j=0;j<payload.results.length;j++) {
		var p = payload.results[j];
		
		if ((payload.domain != 'tv') || (p.media_type != 'audio')) {
			var d = new Date(p.first_broadcast_date);
			var title = (p.display_titles ? p.display_titles.title + 
				(p.display_titles.subtitle ? ' / ' + p.display_titles.subtitle : '') : p.title);
			if (p.parent) {
				title = p.parent.title + ' / ' + title;
			}
			
			var i = {};
			i.title = title;
			i.link = 'http://bbc.co.uk/programmes/'+p.pid;
			i.description = p.long_synopsis ? p.long_synopsis : (p.medium_synopsis ? p.medium_synopsis : p.short_synopsis);
			i.category = p.media_type ? p.media_type : (payload.domain == 'radio' ? 'audio' : 'audio_video');
			i.guid = {};
			i.guid["@isPermaLink"] = 'false';
			i.guid[""] = 'PID:' + p.pid;
			i.pubDate = d.toUTCString();
			if (i.pubDate == 'Invalid Date') {
				i.pubDate = p.first_broadcast_date; // raw
			}
			
			if (!i.description) {
				i.description = i.title;
			}
			
			rss.channel.item.push(i);
		}
	}
	
	feed.rss = rss;
	s = j2x.getXml(feed,'@','',2);
	
	payload.res.set('Content-Type', 'text/xml');
	payload.res.send(s);
}

app.get('/dynamic/hitCounter.js', function(req,res) {
	getHitCounter(function(hits) {
		res.send('var hits = '+JSON.stringify(hits)+';');
	});
});

app.get('/', function(req, res) {
	res.sendFile(__dirname+'/pub/index.html');
});

app.get('/favicon.ico', function(req, res) {
	res.sendFile(__dirname+'/favicon.ico');
});
app.get('/browserconfig.xml', function(req,res) {
	res.send('<?xml version="1.0" encoding="utf-8"?><browserconfig><msapplication></msapplication></browserconfig>');
});

app.use("/images",  express.static(__dirname + '/pub/images'));
app.use("/css",  express.static(__dirname + '/pub/css'));
app.use("/scripts",  express.static(__dirname + '/pub/scripts'));

app.get('/*.html', function (req, res) {
	res.sendFile(__dirname+'/pub+'+req.path);
});

app.get('/suggest', function(req, res) {
	var key = process.env.searchsuggestkey || 'key';
	var s = req.path+'?api_key='+key;
	for (var q in req.query) {
		if (Array.isArray(req.query[q])) {
			for (var a=0;a<req.query[q].length;a++) {
				s += '&' + q + '=' + encodeURIComponent(req.query[q][a]);
			}
		}
		else {
			if (q != 'api_key') {
				s += '&' + q + '=' + encodeURIComponent(req.query[q]);
			}
		}
	}

	var options = {
		host: 'search-suggest.api.bbci.co.uk',
		port: 80,
		path: s,
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		}
	};
	
	console.log(options.path);
	
	getJSON(options,function(stateCode,obj) {
		if (stateCode == 200) {
			res.send(JSON.stringify(obj,null,2));
		}
		else {
			res.send('Request failed with statusCode; '+stateCode);
		}
	});
});

app.get('/nitro/*', function(req, res) {
	var key = process.env.nitrokey || 'key';
	var s = req.path+'?api_key='+key;
	for (var q in req.query) {
		//console.log(req.query[q]);
		if (Array.isArray(req.query[q])) {
			for (var a=0;a<req.query[q].length;a++) {
				s += '&' + q + '=' + encodeURIComponent(req.query[q][a]);
			}
		}
		else {
			if (q != 'api_key') {
				s += '&' + q + '=' + encodeURIComponent(req.query[q]);
			}
		}
	}

	var options = {
		host: 'programmes.api.bbc.com',
		port: 80,
		path: s,
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		}
	};
	
	console.log(options.path);
	
	getJSON(options,function(stateCode,obj) {
		if (stateCode == 200) {
			res.send(JSON.stringify(obj,null,2));
		}
		else {
			res.send('Request failed with statusCode; '+stateCode);
		}
	});
});

app.get('/rss/custom/:search.rss', function (req, res) {
	var options = {
		host: 'search-suggest.api.bbci.co.uk',
		port: 80,
		path: '/search-suggest/suggest',
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		}
	};
	
	options.path += '?apikey='+process.env.searchsuggestkey || 'key';
	options.path += '&q='+encodeURIComponent(req.params.search);
	options.path += '&scope=all';
	options.path += '&format=bigscreen-2';
	//options.path += '&mediatype=audio';
	options.path += '&mediaset=pc';
	
	getJSON(options,function(stateCode,obj) {
		if (stateCode == 200) {
			feed = 'custom/' + req.params.search;
			var payload = {};
			payload.res = res;
			payload.finish = finish;
			payload.domain = req.params.domain; //original not modified
			payload.feed = feed;
			ss_children(obj,payload);
		}
		else {
			res.send('<html><head><title>BBC RSS</title></head><body><h2>Feed not found</h2></body></html>\n');
		}
	});

});

app.get('/rss/:domain/:feed.rss', function (req, res) {
	res.send('Please use /rss/domain/formats/category.rss');
});

app.get('/rss/:domain/:top/:feed.rss', function (req, res) {
	//. http://expressjs.com/en/api.html#req
	//. http://expressjs.com/en/api.html#res
	
	// req.path (string)
	// req.query (object)

	var domain = req.params.domain;
	var top = req.params.top; 
	var feed = req.params.feed;
	
	if (domain == 'tv') {
		domain = '';
	}
	else {
		domain = '/radio';
	}
	mode = '/genres';
	if (top == 'formats') {
		mode = '/formats';
		top = '';
	}
	
	if (feed == 'all') {
		feed = top;
		feed = '';
	}

	var options = {
		host: bbc,
		port: 80,
		path: domain+'/programmes'+mode+(top ? '/'+top : '')+(feed ? '/'+feed : '')+'/player.json',
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		}
	};
	
	getJSON(options,function(stateCode,obj) {
		if (stateCode == 200) {
			feed = (top ? top : 'formats') + (feed ? '/' + feed : '');
			var payload = {};
			payload.res = res;
			payload.finish = finish;
			payload.domain = req.params.domain; //original not modified
			payload.feed = feed;
			children(obj,payload);
		}
		else {
			res.send('<html><head><title>BBC RSS</title></head><body><h2>Feed not found</h2></body></html>\n');
		}
	});
	
	updateHitCounter();

});

var myport = process.env.PORT || 3000;
if (process.argv.length>2) myport = process.argv[2];

var server = app.listen(myport, function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log('RSS / Nitro proxy app listening at http://%s:%s', host, port);
});