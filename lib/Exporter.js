// Exports data as any supported format 
// take in a format, file key, geojson, and callback
var fs = require('node-fs'),
  crypto = require('crypto'),
  mv = require('mv'),
  async = require('async');

module.exports = {
  ogrFormats: {
      kml: 'KML',
      zip: 'ESRI Shapefile',
      csv: 'CSV',
      json: 'GeoJSON',
      geojson: 'GeoJSON',
      gpkg: 'GPKG'
  },

  // exports large data via multi part file strategy
  exportLarge: function( format, id, key, type, options, done ){
    var self = this;
    
    options.limit = 10000;

    var pages,
      fileCount = 0; 
    
    var dir = id +'_'+ (options.layer || 0),
      dbkey = type +':'+ id,
      table = dbkey +':'+ (options.layer || 0);

    var _update = function( info, cb ){
      Cache.updateInfo(table, info, function(err, success){
        cb();
      });
    };

    // call ogr in a separate process
    var callOGR = function( format, outFile, cmd, callback ){
      if ( format == 'csv' && options.geomType && options.geomType == 'esriGeometryPoint' ) {
        cmd.push('-lco');
        cmd.push('GEOMETRY=AS_XY');
      } else if (format == 'zip' || format == 'shp'){
        cmd.push('-lco');
        cmd.push('ENCODING=UTF-8');
        if ( options.geomType && options.geomType == 'esriGeometryPoint' ){
          cmd.push('-where');
          cmd.push("OGR_GEOMETRY = 'POINT'");
        } else if (options.geomType && options.geomType == 'esriGeometryPolygon') {
          cmd.push('-lco');
          cmd.push("SHPT=POLYGON");
        }
        cmd.push('-fieldmap');
        cmd.push('identity');
      }

      config.worker.aspawn(cmd,function (err, stdout, stderr) {
        if ( format == 'zip' || format == 'shp'){
          // mkdir for base path (dir + key) to store shp
          fs.mkdir( base, '0777', true, function(){
            var shp = outFile.replace('zip','shp');
            var dbf = outFile.replace('zip','dbf');
            var shx = outFile.replace('zip','shx');
            var prj = outFile.replace('zip','prj');
            if ( options.name ){
                // cp each file into dir with new name 
                var shpdir = base + tmpName + '.shp';
                mv(shpdir+'/OGRGeoJSON.shp', base+'/' + options.name + '.shp', function(err) {
                  mv(shpdir+'/OGRGeoJSON.dbf', base+'/' + options.name + '.dbf', function(err) {
                    mv(shpdir+'/OGRGeoJSON.shx', base+'/' + options.name + '.shx', function(err) {
                      mv(shpdir+'/OGRGeoJSON.prj', base+'/' + options.name + '.prj', function(err) {
                        mv(shpdir+'/OGRGeoJSON.cpg', base+'/' + options.name + '.cpg', function(err) {
                          // zip all and return the new zip
                          var newZipTmp = base + '/' + options.name + tmpName + '.zip';
                          var newZip = base + '/' + options.name + '.zip';
                          //fs.writeFileSync(base + '/' + options.name + '.cpg', 'UTF-8');
                          config.worker.aspawn(['zip', '-rj', newZipTmp, base+'/', '-x', base + '/*.json'], function(err, stdout, stderr){
                            mv(newZipTmp, newZip, function(err) {
                              console.log('ogr2ogr done');
                              callback(null, newZip);
                            });
                          });     
                        });
                      });
                    });
                  });
                });  
            } else {
              config.worker.aspawn(['zip', '-j', outFile, shp, dbf, shx, prj], function(err, stdout, stderr){
                mv(outFile, newFile, function(err) {
                  console.log('ogr2ogr done');
                  callback(null, outFile);
                });    
              });
            }
          });
        } else {
          mv(outFile, newFile, function(err) {
            console.log('ogr2ogr done');
            callback(err, newFile);
          });
        }
      });
    };

    var vrt = '<OGRVRTDataSource>';

    var collect = function(file, json, callback){
      fileCount++;

      delete json.info;
      var exists = fs.existsSync( file );
      if ( exists ){
        fs.unlinkSync( file );
      }
      fs.writeFile(file, JSON.stringify(json), function(){
        vrt += '<OGRVRTLayer name="OGRGeoJSON"><SrcDataSource>'+file+'</SrcDataSource></OGRVRTLayer>';
        if (fileCount == pages){
          
          vrt += '</OGRVRTDataSource>';
          fs.writeFile(vrtFile, vrt, function(){
            // CALL OGR
            console.log('calling ogr2ogr');
                cmd = ['ogr2ogr', '-f', self.ogrFormats[format], '-update', '-append', ( format == 'zip' ) ? newFileTmp.replace('zip','shp') : newFileTmp, vrtFile];
                callOGR(format, newFileTmp, cmd, function(err, formatFile){
                  Cache.getInfo(table, function(err, info){
                    delete info.status;
                    _update( info, function(err, res){
                    });
                  });
                });
          });
        }
        callback();
      });
    };

    var q = async.queue(function (task, cb) {
      var opts = {
        layer: options.layer,
        limit: options.limit,
        where: options.where,
        offset: task.offset,
        bypassProcessing: true
      };
      Cache.db.select(dbkey, opts, function(err, data){
        collect(task.file, data[0], cb);
      });
    }, 1);

    var current_date = (new Date()).valueOf().toString();
    var random = Math.random().toString();
    var tmpName = crypto.createHash('sha1').update(current_date + random).digest('hex');

    // make a dir for the files
    var path = [config.data_dir + 'files', dir].join('/');
    var base = path + '/' + key,
      vrtFile = base + '.vrt',
      jsonFile = base + '.json',
      newFileTmp = base + tmpName + '.' + format,
      newFile = base + '.' + format;

    if (fs.existsSync(vrtFile) && !options.ignore_cache) {
      // if we already have the vrtfile and we want a diff format 
      Cache.getInfo(table, function(err, info){
        info.status = 'processing';
        _update( info, function(err, res){ 
          done(null, info);

          console.log('calling ogr');
          cmd = ['ogr2ogr', '-f', self.ogrFormats[format], '-update', '-append', ( format == 'zip' ) ? newFileTmp.replace('zip','shp') : newFileTmp, vrtFile];
          callOGR(format, newFileTmp, cmd, function(err, formatFile){
             delete info.status;
             _update( info, function(e, res){});
          });
        });
      });
    } else {
      // we have nothing; generate new data
      Cache.getInfo(table, function(err, info){
        info.status = 'processing';
        _update( info, function(err, res){
          done(null, info);
          fs.mkdir( base, '0777', true, function(){ 
            Cache.getCount(table, function(err, count){
                  pages = Math.ceil(count / options.limit);
                  var noop = function(){};
                  for (var i = 0; i < pages; i++){
                    var offset = i * (options.limit);
                    q.push({ file: base+'/part.' + i + '.json', offset: offset }, noop);
                  }
            });
          });
        });
      });
        
    }

  },
 
  exportToFormat: function( format, dir, key, geojson, options, callback ){
    var self = this;

    var current_date = (new Date()).valueOf().toString();
    var random = Math.random().toString();
    var tmpName = crypto.createHash('sha1').update(current_date + random).digest('hex');

    // create the files for out output
    // we always create a json file, then use it to convert to a file
    var path = [config.data_dir + 'files', dir].join('/');
    var base = path + '/' + key,
      jsonFile = base + '.json',
      newFileTmp = base + tmpName + '.' + format,
      newFile = base + '.' + format;

    // executes OGR
    var _callOgr = function(inFile, outFile, callback){
      if (format == 'json' || format == 'geojson'){
        callback(null, outFile.replace('geojson', 'json'));
      } else if (self.ogrFormats[format]) {
        
        var cmd = [
          'ogr2ogr', 
          '--config',
          'SHAPE_ENCODING',
          'UTF-8', 
          '-f', 
          self.ogrFormats[format], 
          ( format == 'zip' ) ? outFile.replace('zip','shp') : outFile, 
          inFile
        ];

        if (format == 'csv') {
          if ( !geojson.features[0].geometry || geojson.features[0].geometry.type == 'Point'){
            cmd.push('-lco');
            cmd.push('GEOMETRY=AS_XY');
          }
        } else if (format == 'zip' || format == 'shp'){
          if ( !geojson.features[0].geometry || geojson.features[0].geometry.type == 'Point'){
            cmd.push('-where');
            cmd.push("OGR_GEOMETRY = 'POINT'");
          }
        }
        // encode everything as utf8
        cmd.push('-lco');
        cmd.push('ENCODING=UTF-8');
        if ( fs.existsSync( outFile ) ) {
          callback(null, outFile);
        } else {
          console.log('calling ogr2ogr');
          config.worker.aspawn(cmd,
            function (err, stdout, stderr) {
              console.log('ogr2ogr', err, stdout, stderr);
              if (err) {
                callback(err.message, null);
              } else {
                if ( format == 'zip' ){
                  // mkdir for base path (dir + key) to store shp
                  fs.mkdir( base, '0777', true, function(){
                    var shp = outFile.replace('zip','shp');
                    var dbf = outFile.replace('zip','dbf');
                    var shx = outFile.replace('zip','shx');
                    var prj = outFile.replace('zip','prj');
                    var cpg = outFile.replace('zip','cpg');
                    if ( options.name ){
                      // cp each file into dir with new name 
                      mv(shp, base+'/' + options.name + '.shp', function(err){
                        mv(dbf, base+'/' + options.name + '.dbf', function(err){
                          mv(shx, base+'/' + options.name + '.shx', function(err){
                            mv(prj, base+'/' + options.name + '.prj', function(err){
                              mv(cpg, base+'/' + options.name + '.cpg', function(err){

                                var newZipTmp = base + '/' + options.name + tmpName + '.zip';
                                var newZip = base + '/' + options.name + '.zip';
                                config.worker.aspawn(['zip', '-rj', newZipTmp, base+'/'], function(err, stdout, stderr){
                                  mv(newZipTmp, newZip, function(err) {
                                    callback(null, newZip);
                                  });
                                });
                              });
                            });
                          });
                        });
                      });
                    } else {
                      config.worker.aspawn(['zip', '-j', outFile, shp, dbf, shx, prj], function(err, stdout, stderr){
                        callback(null, outFile);
                      });
                    }
                  });
                } else {
                  mv(outFile, newFile, function(err) {
                    callback(null, newFile);
                  });
                }
              }
          });
        }
      } else {
        callback('Unknown format', null);
      }
    };

    // handles the response to callback
    var _send = function(err, file){
      if (err){
        callback( err, null );
      } else {
        /*if (peechee && peechee.type ){ 
          fs.readFile(file, function (err, data) {
            if ( format == 'zip' || format == 'gpkg' ){
              data = new Buffer(data, 'binary').toString('base64');
            }
            peechee.write(data, dir, key+'.'+format, function(err,res){
              if ( err ){
                callback('Problem saving file to s3: ' + err , null );
              } else {
                callback( null, file );
              }
            });
          });
        } else {*/
          callback(null, file);
        //}
      }
    };

    fs.mkdir( path, '0777', true, function(){
      if ( !fs.existsSync( jsonFile ) ) {
        delete geojson.info;
        fs.writeFile( jsonFile, JSON.stringify( geojson ), function(err){
          _callOgr( jsonFile, newFile, _send); 
        });
      } else {
        if (format == 'json' || format == 'geojson'){
          callback(null, jsonFile);
        } else {
          _callOgr( jsonFile, newFileTmp, _send) ;
        }
      }
    });
  }
};
