var terraformer = require('terraformer'),
  terraformerParser = require('terraformer-arcgis-parser'),
  fs = require('fs');

module.exports = {

  attributes: {
  },

  fieldTypes: {
    'string': 'esriFieldTypeString',
    'integer': 'esriFieldTypeInteger',
    'date': 'esriFieldTypeDate',
    'datetime': 'esriFieldTypeDate',
    'float': 'esriFieldTypeDouble'
  },

  fieldType: function( value ){
    //if ( parseInt(value) ){
    //  return this.fieldTypes[ 'integer' ];
    //} else { 
      var type = typeof( value );
      if ( type == 'number'){
        type = ( this.isInt( value ) ) ? 'integer' : 'float';
      }
      return this.fieldTypes[ type ];
    //}
  },

  // is the value an integer?
  isInt: function( v ){
    return Math.round( v ) == v;
  },

  fields: function( props, idField ){
    var self = this;
    var fields = [];
    Object.keys( props ).forEach(function( key ){
      var type = (( idField && key == idField ) ? 'esriFieldTypeOID' : self.fieldType( props[ key ] ));
      if (type){
        var fld = {
          name: key,
          type: type,
          alias: key
        };

        if (type == 'esriFieldTypeString'){
          fld.length = 128;
        }

        fields.push( fld );
      }
    });

    if ( !idField ){
      fields.push({
        name: 'id',
        type: 'esriFieldTypeOID',
        alias: 'id'
      });
    }
    return fields;
  },

  // load a template json file and attach fields
  process: function( tmpl, data, params ){
    var template = JSON.parse(fs.readFileSync(__dirname + tmpl).toString());
    if ( !data.length && data.features && data.features.length ){
      template.fields = this.fields( data.features[0].properties, params.idField );
    } else if (data[0] && data[0].features[0] && data[0].features[0].length ) {
      template.fields = this.fields( data[0].features[0].properties, params.idField );
    } else {
      template.fields = [];
    }
    return template;
  },

  extent: function( features ){
    return Extent.bounds( features );
  },

  setGeomType: function( json, feature ){
     var tmpl_dir = '/../templates/';
     if ( feature.geometry && ( feature.geometry.type.toLowerCase() == 'polygon' || feature.geometry.type.toLowerCase() == 'multipolygon')) {
        json.geometryType = 'esriGeometryPolygon';
        json.drawingInfo.renderer = require(__dirname + tmpl_dir + 'renderers/polygon.json');
      } else if ( feature.geometry && (feature.geometry.type.toLowerCase() == 'linestring' || feature.geometry.type.toLowerCase() == 'multilinestring' )){
        json.geometryType = 'esriGeometryPolyline';
        json.drawingInfo.renderer = require(__dirname + tmpl_dir + 'renderers/line.json');
      } else {
        json.geometryType = 'esriGeometryPoint';
        json.drawingInfo.renderer = require(__dirname + tmpl_dir + 'renderers/point.json');
      }
    return json;
  }, 

  // returns the feature service metadata (/FeatureServere and /FeatureServer/0)
  info: function( data, layer, params, callback ){
    var lyr, json, self = this;
    if ( layer !== undefined ) {
      // send the layer json
      data = (data && data[ layer ]) ? data[ layer ] : data;
      json = this.process('/../templates/featureLayer.json', data, params );
      json.name = data.name || 'Layer '+ layer;
      // set the geometry based on the first feature 
      // TODO: could clean this up or use a flag in the url to pull out feature of specific type like nixta
      json = this.setGeomType( json, data.features[0] );
      json.fullExtent = json.initialExtent = json.extent = this.extent( (!data.length) ? data.features : data[0].features );
      if ( this.isTable(json, data) ) {
        json.type = 'Table';
      }
    } else {
      // no layer, send the service json
      json = this.process('/../templates/featureService.json', (data && data[ 0 ]) ? data[ 0 ] : data, params);
      json.fullExtent = json.initialExtent = json.extent = this.extent( (!data.length) ? data.features : data[0].features );
      if ( data.length ){
        data.forEach(function( d, i){
          lyr = {
            id: i,
            name: d.name || 'layer '+i,
            parentLayerId: -1,
            defaultVisibility: true,
            subLayerIds: null,
            minScale: 99999.99,
            maxScale: 0
          };
          if ( self.isTable( json, data ) ){
            json.tables[i] = lyr;
          } else {
            json.layers[i] = lyr;
          }
        });
      } else {
        lyr = {
          id: 0,
          name: data.name || "layer 1",
          parentLayerId: -1,
          defaultVisibility: true,
          subLayerIds: null,
          minScale: 99999.99,
          maxScale: 0
        };
        if ( this.isTable( json, data ) ){
          json.tables[0] = lyr;
        } else {
          json.layers[0] = lyr;
        }
      }
    }
    this.send( json, params, callback );
  },

  // if we have no extent, but we do have features; then it should be Table
  isTable: function( json, data ){
    return (!json.fullExtent.xmin && !json.fullExtent.ymin && (data.features || data[0].features));
  },

  // todo support many layers 
  layers: function( data, params, callback ){
    var layerJson, json,
      self = this;

    if ( !data.length ){
      layerJson = this.process('/../templates/featureLayer.json', data, params );
      layerJson.extent = layerJson.fullExtent = layerJson.initialExtent = this.extent( data.features );
      json = { layers: [ layerJson ], tables: [] };
      this.send( json, params, callback );
    } else {
      json = { layers: [], tables: [] };
      data.forEach(function( layer, i ){
        layerJson = self.process('/../templates/featureLayer.json', layer, params );
        layerJson.id = i;
        layerJson.extent = layerJson.fullExtent = layerJson.initialExtent = self.extent( layer.features );
        json.layers.push( layerJson );
      });
      this.send( json, params, callback );
    }
  },

  // processes params based on query params 
  query: function( data, params, callback ){
    var self = this;
      tmpl_dir = '/../templates/';    

    if ( params.objectIds ) {
      this.queryIds( data, params, function( json ){ 
        self.send( json, params, callback );
      });
    } else {
      var json = this.process( tmpl_dir + 'featureSet.json', data, params );
      // geojson to esri json
      if ( !data.type ) data.type = 'FeatureCollection';
      json.features = terraformerParser.convert( data ,{idAttribute: 'id'});
      if ( json.features && json.features.length && ( json.features[0].geometry && json.features[0].geometry.rings )) { 
        json.geometryType = 'esriGeometryPolygon';
        //json.drawingInfo.renderer = require(__dirname + tmpl_dir + 'renderers/polygon.json');
      } else if ( json.features && json.features.length && (json.features[0].geometry && json.features[0].geometry.paths )){
        json.geometryType = 'esriGeometryPolyline';
        //json.drawingInfo.renderer = require(__dirname + tmpl_dir + 'renderers/line.json');
      } else {
        json.geometryType = 'esriGeometryPoint';
        //json.drawingInfo.renderer = require(__dirname + tmpl_dir + 'renderers/point.json');
      }

      // create an id field if not existing 
      if ( !params.idField ) {
        json.features.forEach(function( f, i ){
          if ( !f.attributes.id ){
            f.attributes.id = i+1;
          }
        });
      }
      // send back to controller 
      this.send( json, params, callback );
    }
  },

  queryIds: function( data, params, callback ){
    var json = this.process('/../templates/featureSet.json', data, params );
    var allFeatures = terraformerParser.convert( data ),
      features = [];
    allFeatures.forEach(function( f, i ){
      var id;
      if ( !params.idField ){
        // Assign a new id, create an 'id'
        id = i+1;
        if ( !f.attributes.id ){
          f.attributes.id = id;
        }
      } else {
        id = f.attributes[ params.idField ];
      }
      if ( params.objectIds.indexOf( id ) > -1 ){
        features.push( f );
      }
    });
    json.features = features;
    if ( callback ) callback( json );
  },

  // filter the data based on any given query params 
  send: function(json, params, callback){
    Query.filter( json, params, callback );
  }

};
