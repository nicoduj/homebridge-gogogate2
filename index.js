var Service, Characteristic, HomebridgeAPI;
var request = require('request');
const url = require('url');
const $ = require('cheerio');

function Gogogate2Platform(log, config) {
  this.log = log;
  this.gogogateIP = config['gogogateIP'];
  this.name = config['name'];
  this.devMode = config['DEVMODE'];
  this.username = config['username'];
  this.password = config['password'];
  this.refreshTimer = config['refreshTimer'];
  this.doors = [];
  request = request.defaults({jar: true});
  this.log('init');
}

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HomebridgeAPI = homebridge;
  homebridge.registerPlatform(
    'homebridge-gogogate2',
    'GogoGate2',
    Gogogate2Platform
  );
};

Gogogate2Platform.prototype = {

  setTimer: function(on) {
    if (this.refreshTimer && this.refreshTimer > 0) {
      if (on && !this.timerID) {
        this.log.debug(
          'Setting Timer for background refresh every  : ' +
            this.refreshTimer +
            's'
        );
        this.timerID = setInterval(
          () => this.refreshDoorsState(accessory),
          this.refreshTimer * 1000
        );
      } else if (!on && this.timerID) {
        this.log.debug('Clearing Timer');
        clearInterval(this.timerID);
      }
    }
  },

  accessories: function(callback) {
    var foundAccessories = [];

    var that = this;
    this.login( (success)  => {
      if (success)
      {
        this.getDoors (() => {
            for (var i = 0, len = this.doors.length; i < len; i++) {
                var doorName = this.doors[i];
                if (this.devMode) {
                  doorName = 'DEV' + doorName;
                }
                this.log('Discovered door : ' + doorName);
                var service = {
                  controlService: new Service.GarageDoorOpener (doorName),
                  characteristics: [Characteristic.CurrentDoorState,Characteristic.TargetDoorState,Characteristic.ObstructionDetected],
                };
                service.controlService.subtype = doorName;
                service.controlService.id = i+1;
                services.push(service);
            }


              accessory = new Gogogate2Accessory(services);
              accessory.getServices = function() {
                return that.getServices(accessory);
              };
              accessory.platform = that;
              accessory.name = that.name;
              accessory.model = 'Gogogate2';
              accessory.manufacturer = 'Gogogate';
              accessory.serialNumber = that.gogogateIP;
              foundAccessories.push(accessory);

              //timer for background refresh
              that.setTimer(true);

              callback(foundAccessories);
        })
      }
      else
      {
        callback(foundAccessories);
      }
    });

  },

  refreshDoorsState: function(callback) {
  },

  login: function(callback) {
    var formData = {
          login: this.username,
          pass: this.password,
          'send-login': 'submit',
        };
    var baseURL = 'http://' + this.gogogateIP + '/index.php';

    var that = this;

    request.post({url: baseURL, formData: formData}, function optionalCallback(
      loginerr,
      loginResponse,
      loginbody
    ) {
      if (loginerr) {
        that.log('login failed:', loginerr);
        callback(false);
      } else {
        callback(true);
      }
    });

  },

  getDoors: function(callback) {

    var infoURL =
      'http://' + this.gogogateIP + '/index.php?op=config&opc=doors';

    var that = this;

    request(infoURL, function optionalCallback(
      statuserror,
      statusresponse,
      statusbody
    ) {
      that.doors = [ $('input[name="dname1"]', '#config-door1', statusbody).val(), $('input[name="dname2"]', '#config-door2', statusbody).val(),$('input[name="dname3"]', '#config-door3', statusbody).val() ]
      that.log.debug('DOORS NAMES found : ' + that.doors );
      callback();
    });

  },

  bindCharacteristicEvents: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {


// Characteristic.CurrentDoorState.OPEN = 0;
// Characteristic.CurrentDoorState.CLOSED = 1;
// Characteristic.CurrentDoorState.OPENING = 2;
// Characteristic.CurrentDoorState.CLOSING = 3;
// Characteristic.CurrentDoorState.STOPPED = 4;

 characteristic.CurrentDoorState(
      'get',
      function(callback) {
      });

// Characteristic.TargetDoorState.OPEN = 0;
// Characteristic.TargetDoorState.CLOSED = 1

characteristic.TargetDoorState(
      'get',
      function(callback) {
      });
characteristic.TargetDoorState(
      'set',
      function(value, callback, context) {
      });      

 characteristic.ObstructionDetected(
      'get',
      function(callback) {
      });


 
  },

  getInformationService: function(homebridgeAccessory) {
    var informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Name, homebridgeAccessory.name)
      .setCharacteristic(
        Characteristic.Manufacturer,
        homebridgeAccessory.manufacturer
      )
      .setCharacteristic(Characteristic.Model, homebridgeAccessory.model)
      .setCharacteristic(
        Characteristic.SerialNumber,
        homebridgeAccessory.serialNumber
      );
    return informationService;
  },

  getServices: function(homebridgeAccessory) {
    var services = [];
    var informationService = homebridgeAccessory.platform.getInformationService(
      homebridgeAccessory
    );
    services.push(informationService);
    for (var s = 0; s < homebridgeAccessory.services.length; s++) {
      var service = homebridgeAccessory.services[s];
      for (var i = 0; i < service.characteristics.length; i++) {
        var characteristic = service.controlService.getCharacteristic(
          service.characteristics[i]
        );
        if (characteristic == undefined)
          characteristic = service.controlService.addCharacteristic(
            service.characteristics[i]
          );
        homebridgeAccessory.platform.bindCharacteristicEvents(
          characteristic,
          service,
          homebridgeAccessory
        );
      }
      services.push(service.controlService);
    }
    return services;
  },
};

function Gogogate2Accessory(services) {
  this.services = services;
}
