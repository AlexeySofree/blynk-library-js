var Blynk = require('http://tiny.cc/blynk-js');

function onInit() {
  var blynk = new Blynk('715f8caae9bf4a91bae319d0376caa8d');

  var v1 = new blynk.VirtualPin(1);
  var v9 = new blynk.VirtualPin(9);

  v1.on('write', function(param) {
    console.log('V1:', param);
  });

  v9.on('read', function() {
    v9.write(new Date().getSeconds());
  });

  blynk.on('connected', function() { console.log("Blynk ready."); });
  blynk.on('disconnected', function() { console.log("DISCONNECT"); });
}

onInit();
