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
  accessories: function(callback) {
    var foundAccessories = [];

    this.getDevice();

    callback(foundAccessories);
  },

  getDevice: function() {
    var formData = {
      login: this.username,
      pass: this.password,
      'send-login': 'submit',
    };
    var baseURL = 'http://' + this.gogogateIP + '/index.php';
    var infoURL =
      'http://' + this.gogogateIP + '/index.php?op=config&opc=doors';

    var that = this;

    request.post({url: baseURL, formData: formData}, function optionalCallback(
      loginerr,
      loginResponse,
      loginbody
    ) {
      if (loginerr) {
        return that.log('login failed:', loginerr);
      } else {
        console.log('HOME NAME : ' + $('.door-name', '', loginbody).html());

        request(infoURL, function optionalCallback(
          statuserror,
          statusresponse,
          statusbody
        ) {
          console.log(
            'DOOR NAME : ' +
              $('input[name="dname1"]', '#config-door1', statusbody).val()
          );
          console.log(
            'DOOR NAME : ' +
              $('input[name="dname2"]', '#config-door2', statusbody).val()
          );
          console.log(
            'DOOR NAME : ' +
              $('input[name="dname3"]', '#config-door3', statusbody).val()
          );
        });
      }
    });
  },

  bindCharacteristicEvents: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {},

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
