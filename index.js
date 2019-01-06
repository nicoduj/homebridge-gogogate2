var Service, Characteristic, HomebridgeAPI;
var request = require('request');
const url = require('url');


function Gogogate2Platform(log, config) {
	this.log = log;
	this.gogogateIP = config['gogogateIP'];
	this.name = config['name'];
	this.devMode = config['DEVMODE'];
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
		callback(foundAccessories);
	},

	bindCharacteristicEvents: function(
		characteristic,
		service,
		homebridgeAccessory
	  ) {
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
