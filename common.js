var http = require('http');
var https = require('https');
var url = require('url');
var pg = require('pg');

var j2x = require('jgexml/json2xml.js');

var connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/main';
if ((connectionString !== 'none') && (connectionString.indexOf('localhost') <0)) {
	connectionString = connectionString + '?ssl=true';
}

const MONTH = (1000 * 60 * 60 * 24 * 28);
const WEEK  = (1000 * 60 * 60 * 24 * 7);

function hasHeader(header, headers) {
	// snaffled from request module
	headers = Object.keys(headers || this.headers);
	var lheaders = headers.map(function (h) {return h.toLowerCase();});
	header = header.toLowerCase();
	for (var i=0;i<lheaders.length;i++) {
		if (lheaders[i] === header) return headers[i];
	}
	return false;
}

function getJSON(options, onResult) {

	var prot = options.port == 443 ? https : http;
	if (!options.headers) options.headers = {};
	options.headers.Connection = 'keep-alive';
	var req = prot.request(options, function(res) {
		var output = '';
		//console.log(options.host + ':' + res.statusCode);
		res.setEncoding('utf8');

		res.on('data', function (chunk) {
			output += chunk;
		});

		res.on('end', function() {
			var obj = {};
			if (res.statusCode >= 300 && res.statusCode < 400 && hasHeader('location', res.headers)) {
				// handle redirects, as per request module
				var location = res.headers[hasHeader('location', res.headers)];
				var locUrl = url.parse(location);
				options.path = locUrl.pathname;
				options.host = locUrl.host;
				console.log('Redirecting to '+options.path);
				getJSON(options, onResult);
			}
			else {
				if (res.statusCode == 200) {
					obj = {};
					try {
						obj = JSON.parse(output);
					}
					catch (err) {
						console.log('Invalid json received: '+output);
					}
				}
				onResult(res.statusCode, obj);
			}
		});
	});

	req.on('error', function(err) {
		//res.send('error: ' + err.message);
	});

	req.end();
}

function getHTML(options, onResult) {

	var prot = options.port == 443 ? https : http;
	options.headers.Connection = 'keep-alive';
	var req = prot.request(options, function(res) {
		var output = '';
		res.setEncoding('utf8');

		res.on('data', function (chunk) {
			output += chunk;
		});

		res.on('end', function() {
			if (res.statusCode >= 300 && res.statusCode < 400 && hasHeader('location', res.headers)) {
				// handle redirects, as per request module
				var location = res.headers[hasHeader('location', res.headers)];
				var locUrl = url.parse(location);
				options.path = locUrl.pathname;
				options.host = locUrl.host;
				console.log('Redirecting to '+options.path);
				getJSON(options, onResult);
			}
			else {
				onResult(res.statusCode, output);
			}
		});
	});

	req.on('error', function(err) {
		onResult(500,'error: ' + err.message + ' ' + output);
	});

	req.end();
}


function finish(payload) {
	//console.log('final '+payload.results.length);

	var feed = {};
	var rss = {};
	rss['@version'] = '2.0';
	rss["@xmlns:atom"] = 'http://www.w3.org/2005/Atom';
	rss.channel = {};
	rss.channel.title = 'BBC iPlayer RSS programmes feed - '+payload.prefix + '/' + 
		(payload.mode ? payload.mode + '/' : '') + (payload.feed ? payload.feed : 'all');
	rss.channel.link = 'http://bbc-rss.herokuapp.com/'
		+ (payload.params.service ? payload.params.service : 'rss')
		+ '/' + (payload.domain ? payload.domain+'/' : '')
		+ (payload.prefix ? encodeURIComponent(payload.prefix) + '/' : '') 
		+ (payload.options.mode ? payload.options.mode + '/' : '')
		+ encodeURIComponent(payload.feed ? payload.feed : 'all')+'.rss';
	rss.channel["atom:link"] = {};
	rss.channel["atom:link"]["@rel"] = 'self';
	rss.channel["atom:link"]["@href"] = rss.channel.link;
	rss.channel["atom:link"]["@type"] = 'application/rss+xml';
	rss.channel.description = 'Unofficial BBC iPlayer RSS feeds';
	rss.channel.webMaster = 'mike.ralphson@gmail.com (Mike Ralphson)';
	rss.channel.pubDate = new Date().toUTCString();
	rss.channel.generator = 'bbcparse by Mermade Software http://github.com/mermade/bbc-rss';
	rss.channel.item = [];

	for (var j=0;j<payload.results.length;j++) {
		var p = payload.results[j];

		var domain = payload.orgDomain ? payload.orgDomain : payload.domain;

        // programmes returned directly by category search may not have a media_type defined!

		if ((domain != 'tv') || (p.media_type != 'audio')) {
			var d = new Date(p.actual_start);
			var title = (p.display_titles ? p.display_titles.title +
				(p.display_titles.subtitle ? ' / ' + p.display_titles.subtitle : '') : p.title);
			var orgTitle = title;
			if (p.ancestor && p.ancestor.title && (p.ancestor.title != orgTitle)) {
				title = p.ancestor.title + ' / ' + title;
			}
			if ((p.ancestor && p.ancestor.ancestor && p.ancestor.ancestor.title) && (p.ancestor.ancestor.title != orgTitle)) {
				title = p.ancestor.ancestor.title + ' / ' + title;
			}

			var i = {};
			i.title = title;
			i.link = 'http://bbc.co.uk/programmes/'+p.pid;
			i.description = p.long_synopsis ? p.long_synopsis : (p.medium_synopsis ? p.medium_synopsis : p.short_synopsis);
			i.category = p.media_type ? p.media_type : (domain == 'radio' ? 'audio' : 'audio_video');
			i.guid = {};
			i.guid["@isPermaLink"] = 'false';
			i.guid[""] = (payload.pidprefix ? payload.pidprefix : 'PID:') + p.pid;
			i.pubDate = d.toUTCString();
			if (i.pubDate == 'Invalid Date') {
				i.pubDate = p.first_broadcast_date; // raw
			}
			if ((typeof i.pubDate == 'undefined') || (!i.pubDate)) {
				i.pubDate = new Date().toUTCString();
			}

			if (!i.description) {
				i.description = i.title;
			}

			if (p.image && p.image.pid) {
				i.enclosure = {};
				i.enclosure["@url"] = 'http://ichef.bbci.co.uk/images/ic/320x180/'+p.image.pid+'.jpg';
				i.enclosure["@length"] = 15026;
				i.enclosure["@type"] = 'image/jpeg';
			}

			rss.channel.item.push(i);
		}
	}

	feed.rss = rss;
	s = j2x.getXml(feed,'@','',2);

	if (!payload.xmlOffset) {
		payload.res.set('Content-Type', 'text/xml');
	}
	payload.res.write(s.substr(payload.xmlOffset ? payload.xmlOffset : 0));
	payload.res.end();
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

module.exports = {
	/**
	 * getJSON:  REST get request returning JSON object(s)
	 * @param options: http options object
	 * @param callback: callback to pass the results JSON object(s) back
	 */
	getJSON : getJSON,

	getHTML : getHTML,

	updateHitCounter : function() {
		try {
			if (connectionString === 'none') throw new Error();
			var client = new pg.Client(connectionString);
			client.connect();
			var query = client.query("UPDATE hitcounter SET hit = hit+1 WHERE app = 'bbc-rss'");
			query.on('end', function() { client.end(); });
		}
		catch (e) {
		}
	},

	getHitCounter : function(callback) {
		try {
			if (connectionString === 'none') throw new Error();
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
		catch (e) {
			var hit = {};
			hit.hit = 0;
			callback(hit);
		}
	},

	finish : finish,

	clear : clear,

	WEEK : WEEK,

	MONTH : MONTH

};
