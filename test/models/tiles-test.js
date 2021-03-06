var should = require('should');

before(function (done) {
  data = require('../fixtures/5.5.12.geojson');
  global.config = {};
  Tiles = require('../../lib/Tiles.js');
  done();
});

describe('Tiles Model', function(){

    describe('errors when params are wrong', function(){
      it('when missing a z', function(done){
        Tiles.get( {x: 1, y: 1, format: 'png', key: 'fake-key'}, {}, function( err, res ){
          should.exist(err);
          should.not.exist(res);
          done();
        });
      });
    });

});

