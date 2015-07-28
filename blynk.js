/*
 * Helpers
 */

function isEspruino() {
  if (typeof process === 'undefined') return false;
  if (typeof process.env.BOARD === 'undefined') return false;
  return true;
}

function isNode() {
  return (typeof module !== "undefined" && ('exports' in module));
}

function isBrowser() {
  return (typeof window !== 'undefined');
}

function needsEmitter() {
  return (!isEspruino() && isNode());
}

//function require(module) { return undefined; }

function blynkHeader(msg_type, msg_id, msg_len) {
  return String.fromCharCode(
    msg_type,
    msg_id  >> 8, msg_id  & 0xFF,
    msg_len >> 8, msg_len & 0xFF
  );
}

var MsgType = {
  RSP           :  0,
  LOGIN         :  2,
  PING          :  6,
  TWEET         :  12,
  EMAIL         :  13,
  NOTIFY        :  14,
  BRIDGE        :  15,
  HW            :  20,
};

var MsgStatus = {
  OK            :  200
};

var BlynkState = {
  CONNECTING    :  1,
  CONNECTED     :  2,
  DISCONNECTED  :  3,
};

if (isNode()) {
  var bl_node = require('./blynk-node.js');
  var events = require('events');
  var util = require('util');
}

/*
 * Serial
 */
if (isEspruino()) {
  var BlynkSerial = function(options) {
    var self = this;
    
    var options = options || {};
    self.ser  = options.serial || USB;
    self.conser = options.conser || Serial1;
    self.baud = options.baud || 9600;

    this.write = function(data) {
      self.ser.write(data);
    };

    this.connect = function(done) {
      self.ser.setup(self.baud);
      self.ser.removeAllListeners('data');
      self.ser.on('data', function(data) {
        self.emit('data', data);
      });
      if (self.conser) {
        self.conser.setConsole();
      }
      done();
    };

    this.disconnect = function() {
      //self.ser.setConsole();
    };
  };
}

/*
 * Boards
 */

var BoardDummy = function() {
  this.process = function(values) {
    if (values[0] === 'info') {
      return true;
    }
  };
};

var BoardOnOff = function() {
  var Gpio = require('onoff').Gpio;
  this.process = function(values) {
    switch(values[0]) {
      case 'info':
        break;
      case 'dw':
        var pin = new Gpio(values[1], 'out');
        var val = parseInt(values[2], 10);
        pin.write(val);
        break;
      case 'aw':
        var pin = Pin(values[1]);
        var val = parseInt(values[2], 10);

        break;
      case 'dr':
        var pin = new Gpio(values[1], 'in');
        var val = parseInt(values[2], 10);
        pin.read(function(err, value) {
          if (!err) {
            //blynk.virtualWrite(values[1], value)
          }
        });

        break;
      case 'ar':
        var pin = Pin(values[1]);

        break;
      default:
        return false;
    }
    return true;
  };
};

if (isEspruino()) {
  var BoardEspruino = function(values) {
    this.process = function(values) {
      switch(values[0]) {
        case 'info':
          break;
        case 'dw':
          var pin = Pin(values[1]);
          var val = parseInt(values[2], 10);
          pinMode(pin, 'output');
          digitalWrite(pin, val);
          break;
        case 'aw':
          var pin = Pin(values[1]);
          var val = parseInt(values[2], 10);
          pinMode(pin, 'output');
          analogWrite(pin, val);
          break;
        case 'dr':
          var pin = Pin(values[1]);
          
          break;
        case 'ar':
          var pin = Pin(values[1]);

          break;
        default:
          return null;
      }
      return true;
    };
  };
}

/*
 * Blynk
 */

var Blynk = function(auth, options) {
  if (needsEmitter()) {
    events.EventEmitter.call(this);
  }

  this.auth = auth;
  var options = options || {};
  this.heartbeat = options.heartbeat || (10*1000);
  
  // Auto-detect board
  if (options.board) {
    this.board = options.board;
  } else if (isEspruino()) {
    this.board = new BoardEspruino();
  } else {
    this.board = new BoardDummy();
  }

  // Auto-detect connector
  if (options.connector) {
    this.conn = options.connector;
  } else if (isEspruino()) {
    this.conn = new BlynkSerial(options);
  } else if (isBrowser()) {
    this.conn = new BlynkWebSocketClient(options);
  } else {
    this.conn = new bl_node.BlynkSslClient(options);
  }

  this.buff_in = '';
  this.msg_id = 1;
  this.vpins = [];
  
  if (!options.skip_connect) {
    this.connect();
  }
  
  var blynk = this;
  this.VirtualPin = function(pin) {
    if (needsEmitter()) {
      events.EventEmitter.call(this);
    }
    this.blynk = blynk;
    this.pin = pin;
    blynk.vpins[pin] = this;
    
    this.write = function(value) {
      blynk.virtualWrite(this.pin, value);
    }
  };

  if (needsEmitter()) {
    util.inherits(this.VirtualPin, events.EventEmitter);
  } else if (isBrowser()) {
    MicroEvent.mixin(this.VirtualPin);
  }
};

if (needsEmitter()) {
  util.inherits(Blynk, events.EventEmitter);
} else if (isBrowser()) {
  MicroEvent.mixin(Blynk);
}

Blynk.prototype.onReceive = function(data) {
  var self = this;
  //if (isEspruino()) {
  //  self.buff_in += data;
  //} else {
    self.buff_in += data.toString('binary');
  //}
  while (self.buff_in.length >= 5) {
    var msg_type = self.buff_in.charCodeAt(0);
    var msg_id   = self.buff_in.charCodeAt(1) << 8 | self.buff_in.charCodeAt(2);
    var msg_len  = self.buff_in.charCodeAt(3) << 8 | self.buff_in.charCodeAt(4);

    //console.log('d> ', data.toString('hex'));
    //console.log('i> ', new Buffer(self.buff_in, 'binary').toString('hex'));
    //console.log('> ', msg_type, msg_id, msg_len);

    if (msg_id === 0)  { return self.disconnect(); }
    var consumed = 5;

    if (msg_type === MsgType.RSP) {
      if (self.timerConn && msg_id === 1 && msg_len === MsgStatus.OK) {
        clearInterval(self.timerConn);
        self.timerConn = null;
        self.timerHb = setInterval(function() {
          console.log('Heartbeat');
          self.sendMsg(MsgType.PING, null);
        }, self.heartbeat);
        self.emit('connected');
      }
    } else if (msg_type === MsgType.PING) {
      self.conn.write(blynkHeader(MsgType.RSP, msg_id, MsgStatus.OK));
    } else if (msg_type === MsgType.HW ||
                msg_type === MsgType.BRIDGE)
    {
      if (msg_len > 1024)  { return self.disconnect(); }
      if (self.buff_in.length < msg_len+5) {
        return;
      }
      var values = self.buff_in.substr(5, msg_len).split('\0');
      consumed += msg_len;

      //console.log('> ', values);

      if (values[0] === 'vw') {        
        var pin = parseInt(values[1], 10);
        if (this.vpins[pin]) {
          this.vpins[pin].emit('write', values.slice(2));
        }
      } else if (values[0] === 'vr') {
        var pin = parseInt(values[1], 10);
        if (this.vpins[pin]) {
          this.vpins[pin].emit('read');
        }
      } else if (self.board.process(values)) {

      } else {
        console.log('Invalid cmd: ', values[0]);
      }
    } else {
      console.log('Invalid msg type: ', msg_type);
    }
    self.buff_in = self.buff_in.substr(consumed);
  } // end while
};

Blynk.prototype.sendMsg = function(msg_type, msg_id, values) {
  var self = this;
  values = values || [''];
  msg_id = msg_id || (self.msg_id++);
  var data = values.join('\0');
  var msg_len = data.length;
  self.conn.write(blynkHeader(msg_type, msg_id, msg_len) + data);
  //console.log('< ', msg_type, msg_id, msg_len, ' : ', values);

  // TODO: track also recieving time
  if (self.timerHb) {
    clearInterval(self.timerHb);
    self.timerHb = setInterval(function(){
      console.log('Heartbeat');
      self.sendMsg(MsgType.PING, null);
    }, self.heartbeat);
  }
};

/*
  * API
  */

Blynk.prototype.connect = function() {
  var self = this;
  self.disconnect();
  self.timerConn = setInterval(function() {
    self.conn.connect(function() {
      self.conn.on('data', function(data) { self.onReceive(data); });
      self.conn.on('end',  function()     { self.disconnect();    });
      self.sendMsg(MsgType.LOGIN, 1, [self.auth]);
    });
  }, 5000);
};

Blynk.prototype.disconnect = function() {
  this.conn.disconnect();
  clearInterval(this.timerHb);
  this.emit('disconnected');
};

Blynk.prototype.virtualWrite = function(pin, value) {
  this.sendMsg(MsgType.HW, null, ['vw', pin, value]);
};

Blynk.prototype.email = function(to, topic, message) {
  this.sendMsg(MsgType.EMAIL, null, [to, topic, message]);
};

Blynk.prototype.notify = function(message) {
  this.sendMsg(MsgType.NOTIFY, null, [message]);
};

Blynk.prototype.tweet = function(message) {
  this.sendMsg(MsgType.TWEET, null, [message]);
};

if (typeof module !== "undefined" && ('exports' in module)) {
  exports.Blynk = Blynk;
  if (isNode()) {
    exports.TcpClient = bl_node.BlynkTcpClient;
    exports.SslClient = bl_node.BlynkSslClient;
  }
  if (isEspruino()) {
    exports.EspruinoSerial = BlynkSerial;
  }
}