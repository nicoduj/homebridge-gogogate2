DELAY_TO_UPDATE_STATUS = 800;

var Service, Characteristic, HomebridgeAPI;
var request = require('request');
const url = require('url');
const $ = require('cheerio');


String.prototype.isEmpty = function() {
  return this.length === 0 || !this.trim();
};

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


  setTimer: function(homebridgeAccessory,on) {
    if (this.refreshTimer && this.refreshTimer > 0) {
      if (on && !this.timerID) {
        this.log.debug(
          'Setting Timer for background refresh every  : ' +
            this.refreshTimer +
            's'
        );
        this.timerID = setInterval(
          () => this.refreshAllDoors(homebridgeAccessory),
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
    this.login(success => {
      if (success) {
        this.getDoors(() => {
          var services = [];

          for (var i = 0, len = this.doors.length; i < len; i++) {
            var doorName = this.doors[i];

            if (doorName && !doorName.isEmpty()) {
              if (this.devMode) {
                doorName = 'DEV' + doorName;
              }
              this.log('Discovered door : ' + doorName);

              var service = {
                controlService: new Service.GarageDoorOpener(doorName),
                characteristics: [
                  Characteristic.CurrentDoorState,
                  Characteristic.TargetDoorState,
                  Characteristic.ObstructionDetected,
                ],
              };
              service.controlService.subtype = doorName;
              service.controlService.id = i + 1;
              services.push(service);
            }
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
          that.setTimer(accessory,true);

          callback(foundAccessories);
        });
      } else {
        callback(foundAccessories);
      }
    });
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
      that.doors = [
        $('input[name="dname1"]', '#config-door1', statusbody).val(),
        $('input[name="dname2"]', '#config-door2', statusbody).val(),
        $('input[name="dname3"]', '#config-door3', statusbody).val(),
      ];
      that.log.debug('DOORS NAMES found : ' + that.doors);
      callback();
    });
  },

  refreshAllDoors: function(homebridgeAccessory) {
    for (var s = 0; s < homebridgeAccessory.services.length; s++) {
      var service = homebridgeAccessory.services[s];
      this.log.debug('Refreshing : ' + service.controlService.subtype);
      this.refreshDoor(service.controlService);
    }
  },

  refreshDoor: function(service, callback) {
    var infoURL =
      'http://' + this.gogogateIP + '/isg/statusDoor.php?numdoor=' + service.id;

    var that = this;

    request(infoURL, function optionalCallback(
      statuserror,
      statusresponse,
      statusbody
    ) {
      if (statuserror) {
        that.log(
          'getting status for ' + service.subtype + ' Door failed:',
          statuserror
        );
        if (callback) callback(null, null);
      } else {
        that.log.debug(
          'Got Status for : ' + service.subtype + ' - ' + statusbody
        );

        var newValue =  service.getCharacteristic(Characteristic.CurrentDoorState).value;

        if (statusbody == 'OK') {

          if (service.TargetDoorState && service.TargetDoorState == Characteristic.CurrentDoorState.OPEN)
          {
            //operation was in progress and is achieved
            service.TargetDoorState = null;
            newValue = Characteristic.CurrentDoorState.OPEN;
          }
          else if (!service.TargetDoorState)
          {
            //no operation in progress, we retrieve the real state
            newValue = Characteristic.CurrentDoorState.OPEN;
          }

        } else {

          if (service.TargetDoorState && service.TargetDoorState == Characteristic.CurrentDoorState.CLOSED)
          {
            //operation was in progress and is achieved
            service.TargetDoorState = null;
            newValue = Characteristic.CurrentDoorState.CLOSED;
          }
          else if (!service.TargetDoorState)
          {
            //no operation in progress, we retrieve the real state
            newValue = Characteristic.CurrentDoorState.CLOSED;
          }
        }

        if (callback) callback(null, newValue);
        else
          service
            .getCharacteristic(Characteristic.CurrentDoorState)
            .updateValue(newValue);

      }
    });
  },

  activateDoor: function(service,callback){
   var commandURL =
      'http://' + this.gogogateIP + '/isg/opendoor.php?numdoor=' + service.id;

    var that = this;

    var request = require('request'); request = request.defaults({jar: true});

    request(commandURL, function optionalCallback(
      statuserror,
      statusresponse,
      statusbody
    ) {
      if (statuserror) {
        callback(false);
      }
      else
      {
        callback(true);
      }
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
    // Characteristic.TargetDoorState.OPEN = 0;
    // Characteristic.TargetDoorState.CLOSED = 1

    if (characteristic instanceof Characteristic.CurrentDoorState) {

        characteristic.on('get', function(callback) {

          if (service.TargetDoorState && service.TargetDoorState == Characteristic.TargetDoorState.OPEN)
          {
            callback(null,Characteristic.CurrentDoorState.OPENING);
          }
          else if (service.TargetDoorState && service.TargetDoorState == Characteristic.TargetDoorState.CLOSED)
          {
            callback(null,Characteristic.CurrentDoorState.CLOSING);
          }
          else
          {
            homebridgeAccessory.platform.refreshDoor(
              service.controlService,
              callback
            );
          }
        }.bind(this));

    }
    else if (characteristic instanceof Characteristic.TargetDoorState) {

      characteristic.on('get', function(callback) {

        if (service.TargetDoorState)
        {
          callback(null, service.TargetDoorState);
        }
        else
        {
          var currentState = service.controlService.getCharacteristic(
            Characteristic.CurrentDoorState
          ).value;
          callback(null, currentState);
        }
      }.bind(this));

      characteristic.on('set', function(value, callback, context) {
        var currentValue = characteristic.value;
        var currentState = service.controlService.getCharacteristic(
          Characteristic.CurrentDoorState
        ).value;

        if (currentState != value && (currentState == Characteristic.CurrentDoorState.OPEN || currentState == Characteristic.CurrentDoorState.CLOSED ))
        {
          homebridgeAccessory.platform.activateDoor(
            service.controlService,
            function(error) {
              if (!error)
              {
                service.TargetDoorState = value;
              }
              else
              {
                characteristic.updateValue(currentValue);
              }
            }
          );
        }
        else // do nothing and revert change since operation is in progress or we target the current state
        {
          setTimeout(function() {
            characteristic.updateValue(currentValue);
          }, DELAY_TO_UPDATE_STATUS);

        }
        callback();

      }.bind(this));

    } else if (characteristic instanceof Characteristic.ObstructionDetected) {

      characteristic.on('get', function(callback) {
        callback(null, false);
      }.bind(this));

    }
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
