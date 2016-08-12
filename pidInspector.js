var common = require('./common');
var nitro = require('bbcparse/nitroSdk.js');
var api = require('bbcparse/nitroApi/api.js');

function getSegments(req,res,pid) {

	var s = '/programmes/'+pid+'/segments.json';

	console.log(s);

	var options = {
		host: 'www.bbc.co.uk',
		port: 80,
		path: s,
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		}
	};

	common.getJSON(options,function(stateCode,obj) {
		res.setHeader('Access-Control-Allow-Origin','*');
		if (stateCode == 200) {
			var html = '<html><head><title></title></head><body>';
			html += '<h1>Programme Segment information</h1>';
			html += '<table border="1" cellpadding="5"><thead><tr><td>Artist</td><td>Performer</td><td>Track</td></tr></thead>';
			for (var se in obj.segment_events) {
				var segment = obj.segment_events[se].segment;
				if (segment.artist && segment.track_title) {
					var gid = segment.primary_contributor ? segment.primary_contributor.musicbrainz_gid : '';
					if (gid) {
						segment.artist = '<a href="http://musicbrainz.org/artist/'+gid+'">'+segment.artist+'</a>';
					}
					var performer = segment.artist;
					if (segment.contributions) {
						performer = '<ul>';
						for (var c in segment.contributions) {
							var cont = segment.contributions[c];
							if (cont.role == 'Performer') {
								performer += '<li><a href="http://musicbrainz.org/artist/'+cont.musicbrainz_gid+'">'+cont.name+'</a></li>';
							}
						}
						performer += '</ul>';
					}
					if (segment.snippet_url) {
						segment.track_title = '<a href="'+segment.snippet_url+'">'+segment.track_title+'</a>';
					}
					html += '<tr><td>'+segment.artist+'</td><td>'+performer+'</td><td>'+segment.track_title+'</td></tr>';
				}
			}
			html += '</table></body></html>';
			res.send(html);
		}
		else if (stateCode == 404) {
			res.sendFile(__dirname+'/pub/pidNoData.html');
		}
		else {
			res.send('Request failed with statusCode; '+stateCode);
		}
	});
}

function getVersions(req,res,pid) {
	var query = nitro.newQuery();
	query.add(api.fProgrammesPageSize,1,true)
		.add(api.mProgrammesAncestorTitles)
		.add(api.mProgrammesAvailableVersions)
		.add(api.fProgrammesPid,pid)
		.add(api.fProgrammesAvailabilityAvailable)
		.add(api.mProgrammesAvailability); // has a dependency on 'availability'

	var api_key = process.env.nitrokey || 'key';

	nitro.make_request('programmes.api.bbc.com',api.nitroProgrammes,api_key,query,{},function(obj){
		var s = '<html><head><title>PID Inspector</title></head><body><pre>';

		if (obj.nitro.results.items && obj.nitro.results.items.length == 1) {
			var item = obj.nitro.results.items[0];
			var title = '';
			for (var t in item.ancestor_titles) {
				title += item.ancestor_titles[t].title + ' / ';
			}
			title += item.title;
			s += '<h1>'+title+'</h1>';
			s += '<table border="2" cellpadding="5"><thead><tr><td>Version</td><td>MediaSet Name</td><td>Information</td></tr></thead>';

			if (item.available_versions.version) {
				for (var v in item.available_versions.version) {
					var version = item.available_versions.version[v];
					var vpid = version.pid;
					var vtext = version.types.type[0];

					//console.log(vpid+' '+vtext);

					if (version.availabilities) {
						for (var a in version.availabilities.availability) {
							var avail = version.availabilities.availability[a];

							if (avail.media_sets) {
								for (var m in avail.media_sets.media_set) {
									var mediaset = avail.media_sets.media_set[m];

									var mstext = mediaset.name;
									//var link = 'http://open.live.bbc.co.uk/mediaselector/5/select/version/2.0/vpid/{vpid}/format/json/mediaset/{mediaSet}/proto/http';
									var link = '/msProxy/vpid/{vpid}/format/json/mediaset/{mediaSet}/proto/http';
									link = link.replace('{vpid}',vpid);
									link = link.replace('{mediaSet}',mstext);
									link = '<a href="'+link+'">MediaSelector</a>'

									if (avail.status != 'available') {
										link = avail.status;
									}

									s += '<tr><td>'+vpid+' '+vtext+'</td>';
									s += '<td>'+mstext+'</td>';
									s += '<td>'+link+'</td></tr>';
								}
							}

						}
					}

				}
			}

			s+= '</table>';
		}
		else {
			s += (JSON.stringify(obj.nitro.results,null,2));
		}
		s += '</pre></body></html>';
		res.send(s);
		//console.log(JSON.stringify(obj,null,2));
	});
}

module.exports = {

	processPid :  function(req,res) {
		result = false;
		var pid = req.query.txtPid;
		if (pid) {
			var pids = pid.split('/');
			for (var p in pids) {
				if (pids[p].match('^([0-9,a-d,f-h,j-n,p-t,v-z]){8,}$')) {
					pid = pids[p];
					result = true;
				}
			}
			if (result) {
				console.log('Looking for pid '+pid);
				if (typeof req.query.btnSegments !== 'undefined') {
					getSegments(req,res,pid);
				}
				else if (typeof req.query.btnVersions !== 'undefined') {
					getVersions(req,res,pid);
				}
				else {
					result = false;
				}
			}
		}
		return result;
	}

};