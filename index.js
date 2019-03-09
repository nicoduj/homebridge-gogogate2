var Service, Characteristic;

var GogogateAPI = require('./gogogateAPI.js').GogogateAPI;
const GogogateConst = require('./gogogateConst');
const GogogateTools = require('./gogogateTools.js');

String.prototype.isEmpty = function() {
  return this.length === 0 || !this.trim();
};

function Gogogate2Platform(log, config, api) {
  this.log = log;
  this.gogogateIP = config['gogogateIP'];
  this.name = config['name'];
  this.devMode = config['DEVMODE'];
  this.username = config['username'];
  this.password = config['password'];
  this.refreshTimer = GogogateTools.checkTimer(config['refreshTimer']);
  this.refreshTimerDuringOperation = GogogateTools.checkParemeter(
    config['refreshTimerDuringOperation'],
    2,
    15,
    10
  );
  this.maxWaitTimeForOperation = GogogateTools.checkParemeter(
    config['maxWaitTimeForOperation'],
    30,
    90,
    30
  );
  this.foundAccessories = [];

  this.doors = [];

  this.gogogateAPI = new GogogateAPI(log, this);

  if (api) {
    // Save the API object as plugin needs to register new accessory via this object
    this.api = api;

    // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
    // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
    // Or start discover new accessories.
    this.api.on(
      'shutdown',
      function() {
        this.end();
      }.bind(this)
    );
  }
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
  end() {
    this.log('INFO - shutdown');
    if (this.timerID) {
      clearInterval(this.timerID);
      this.timerID = undefined;
    }

    this.gogogateAPI.logout(() => {});
  },

  refreshBackground() {
    //timer for background refresh
    if (this.refreshTimer !== undefined && this.refreshTimer > 0) {
      this.log.debug(
        'INFO - Setting Timer for background refresh every  : ' +
          this.refreshTimer +
          's'
      );
      this.timerID = setInterval(
        () => this.refreshAllDoors(),
        this.refreshTimer * 1000
      );
    }
  },

  accessories: function(callback) {
    this.gogogateAPI.login(success => {
      if (success) {
        this.gogogateAPI.getDoors(successDoors => {
          if (successDoors) {
            this.handleDoorsDiscovery();
            //timer for background refresh
            this.refreshBackground();

            callback(this.foundAccessories);
          } else {
            //prevent homebridge from starting since we don't want to loose our doors.
            callback(undefined);
          }
        });
      } else {
        //prevent homebridge from starting since we don't want to loose our doors.
        callback(undefined);
      }
    });
  },

  handleDoorsDiscovery() {
    for (let i = 0, len = this.doors.length; i < len; i++) {
      let services = [];
      let doorName = this.doors[i];

      if (doorName && !doorName.isEmpty()) {
        if (this.devMode) {
          doorName = 'DEV' + doorName;
        }
        this.log('INFO - Discovered door : ' + doorName);

        let chars = [];
        chars.push(Characteristic.CurrentDoorState);
        chars.push(Characteristic.TargetDoorState);
        chars.push(Characteristic.ObstructionDetected);

        let service = {
          controlService: new Service.GarageDoorOpener(doorName),
          characteristics: chars,
        };
        service.controlService.subtype = doorName;
        service.controlService.id = i + 1;
        service.id = doorName;
        services.push(service);

        if (this.sensors[i] && !this.sensors[i].isEmpty()) {
          this.log('INFO - Discovered sensor : ' + this.sensors[i]);
          let batteryService = {
            controlService: new Service.BatteryService(),
            characteristics: [
              Characteristic.BatteryLevel,
              Characteristic.ChargingState,
              Characteristic.StatusLowBattery,
            ],
          };
          batteryService.controlService.subtype = doorName;
          batteryService.controlService.id = i + 1;
          batteryService.id = 'Battery' + this.sensors[i];
          services.push(batteryService);

          let tempService = {
            controlService: new Service.TemperatureSensor(),
            characteristics: [Characteristic.CurrentTemperature],
          };
          tempService.controlService.subtype = doorName;
          tempService.controlService.id = i + 1;
          tempService.id = 'Temp' + this.sensors[i];
          services.push(tempService);
        }

        let myGogogateDoorAccessory = new GogogateTools.Gogogate2Accessory(
          services
        );
        myGogogateDoorAccessory.getServices = function() {
          return this.platform.getServices(myGogogateDoorAccessory);
        };
        myGogogateDoorAccessory.platform = this;
        myGogogateDoorAccessory.name = doorName;
        myGogogateDoorAccessory.model = 'Gogogate2';
        myGogogateDoorAccessory.manufacturer = 'Gogogate';
        myGogogateDoorAccessory.serialNumber = doorName + '-' + this.gogogateIP;

        this.foundAccessories.push(myGogogateDoorAccessory);
      }
    }
  },

  refreshAllDoors: function() {
    this.log.debug('INFO - Refreshing status ');

    for (let a = 0; a < this.foundAccessories.length; a++) {
      let myGogogateAccessory = this.foundAccessories[a];

      for (let s = 0; s < myGogogateAccessory.services.length; s++) {
        let service = myGogogateAccessory.services[s];

        if (service.controlService instanceof Service.GarageDoorOpener) {
          this.log.debug(
            'INFO - refreshAllDoors - Door : ' + service.controlService.subtype
          );
          this.gogogateAPI.refreshDoor(myGogogateAccessory, service);
        } else if (
          service.controlService instanceof Service.TemperatureSensor
        ) {
          this.log.debug(
            'INFO - refreshAllDoors - Temp : ' + service.controlService.subtype
          );
          this.gogogateAPI.refreshSensor(
            service,
            null,
            GogogateConst.TEMP_SENSOR
          );
        } else if (service.controlService instanceof Service.BatteryService) {
          this.log.debug(
            'INFO - refreshAllDoors - Battery : ' +
              service.controlService.subtype
          );
          this.gogogateAPI.refreshSensor(
            service,
            null,
            GogogateConst.BATTERY_SENSOR
          );
        }
      }
    }
  },

  getNewValue: function(
    myGogogateAccessory,
    service,
    currentDoorState,
    oldValue
  ) {
    let newValue = undefined;

    if (
      service.TargetDoorState !== undefined &&
      service.TargetDoorState == currentDoorState
    ) {
      this.endDoorOperation(myGogogateAccessory, service);
      let newValue = currentDoorState;
      this.log.debug(
        'WARNING - refreshDoor - ' +
          service.controlService.subtype +
          ' - OPENING operation was in progress and is achieved: ' +
          this.gogogateAPI.getStateString(newValue)
      );
    } else if (service.TargetDoorState == undefined) {
      //no operation in progress, we retrieve the real state
      newValue = currentDoorState;
      this.log.debug(
        'INFO - refreshDoor  - ' +
          service.controlService.subtype +
          ' - no operation in progress, we retrieve the real state: ' +
          this.gogogateAPI.getStateString(newValue)
      );
    }

    if (newValue == undefined) {
      this.log.debug(
        'INFO - refreshDoor - ' +
          service.controlService.subtype +
          ' No new value'
      );
      newValue = oldValue;
    }

    return newValue;
  },

  handleRefreshDoor(statusbody, myGogogateAccessory, service, callback) {
    this.log.debug(
      'INFO - refreshDoor - Got Status for : ' +
        service.controlService.subtype +
        ' - ' +
        statusbody +
        '. ServiceTargetState is ' +
        this.gogogateAPI.getStateString(service.TargetDoorState)
    );

    //timeout
    let elapsedTime = Date.now() - service.TargetDoorStateOperationStart;

    if (
      service.TargetDoorState !== undefined &&
      elapsedTime > this.maxWaitTimeForOperation * 1000
    ) {
      //operation has timedout
      this.endDoorOperation(myGogogateAccessory, service);
      this.log.debug(
        'WARNING - refreshDoor - ' +
          service.controlService.subtype +
          ' - operation was in progress and  has timedout'
      );
    }

    let oldValue = service.controlService.getCharacteristic(
      Characteristic.CurrentDoorState
    ).value;

    this.log.debug(
      'INFO - refreshDoor - Current Door State ' +
        this.gogogateAPI.getStateString(oldValue)
    );

    let newValue = this.getNewValue(
      myGogogateAccessory,
      service,
      statusbody == 'OK'
        ? Characteristic.CurrentDoorState.OPEN
        : Characteristic.CurrentDoorState.CLOSED,
      oldValue
    );

    if (callback) {
      this.log.debug(
        'INFO - refreshDoor - ' +
          service.controlService.subtype +
          ' calling callback with value : ' +
          this.gogogateAPI.getStateString(newValue)
      );
      callback(undefined, newValue);
    } else if (newValue != oldValue) {
      this.log.debug(
        'INFO - refreshDoor - ' +
          service.controlService.subtype +
          ' updating characteristics to : ' +
          this.gogogateAPI.getStateString(newValue)
      );

      service.controlService
        .getCharacteristic(Characteristic.CurrentDoorState)
        .updateValue(newValue);

      if (
        newValue == Characteristic.CurrentDoorState.OPEN ||
        newValue == Characteristic.CurrentDoorState.CLOSED
      ) {
        service.controlService
          .getCharacteristic(Characteristic.TargetDoorState)
          .updateValue(newValue);
      }
    }
  },

  handleRefreshSensor(service, statusbody, callback, type) {
    this.log.debug('INFO - refreshSensor with body  : ' + statusbody);

    let res = JSON.parse(statusbody);

    let newVal;
    let charToUpdate = undefined;
    if (type == BATTERY_SENSOR) {
      newVal = GogogateTools.normalizeBattery(res[1]);
      charToUpdate = Characteristic.BatteryLevel;
      this.log.debug('INFO - refreshBattery with value  : ' + newVal);
    } else {
      newVal = res[0] / 1000;
      charToUpdate = Characteristic.CurrentTemperature;
      this.log.debug('INFO - refreshTemp with value  : ' + newVal);
    }

    if (callback) {
      callback(undefined, newVal);
    } else {
      service.controlService
        .getCharacteristic(charToUpdate)
        .updateValue(newVal);
    }
  },

  getCurrentDoorStateCharacteristic: function(
    homebridgeAccessory,
    service,
    callback
  ) {
    if (
      service.TargetDoorState &&
      service.TargetDoorState == Characteristic.TargetDoorState.OPEN
    ) {
      this.log.debug(
        'INFO - GET Characteristic.CurrentDoorState - ' +
          service.controlService.subtype +
          ' - OPENING'
      );
      callback(undefined, Characteristic.CurrentDoorState.OPENING);
    } else if (
      service.TargetDoorState &&
      service.TargetDoorState == Characteristic.TargetDoorState.CLOSED
    ) {
      this.log.debug(
        'INFO - GET Characteristic.CurrentDoorState - ' +
          service.controlService.subtype +
          ' - CLOSING'
      );
      callback(undefined, Characteristic.CurrentDoorState.CLOSING);
    } else {
      this.log.debug(
        'INFO - GET Characteristic.CurrentDoorState - ' +
          service.controlService.subtype +
          ' - Real state through REFRESHDOOR'
      );

      homebridgeAccessory.platform.gogogateAPI.refreshDoor(
        homebridgeAccessory,
        service,
        callback
      );
    }
  },

  getTargetDoorStateCharacteristic: function(
    homebridgeAccessory,
    service,
    callback
  ) {
    if (service.TargetDoorState) {
      this.log.debug(
        'INFO - GET Characteristic.TargetDoorState - ' +
          service.controlService.subtype +
          ' - callback with state : ' +
          this.gogogateAPI.getStateString(service.TargetDoorState)
      );

      callback(undefined, service.TargetDoorState);
    } else {
      this.log.debug(
        'INFO - GET Characteristic.TargetDoorState - ' +
          service.controlService.subtype +
          ' - Real state through REFRESHDOOR'
      );

      homebridgeAccessory.platform.gogogateAPI.refreshDoor(
        homebridgeAccessory,
        service,
        callback
      );
    }
  },

  setTargetDoorStateCharacteristic: function(
    homebridgeAccessory,
    service,
    characteristic,
    value,
    callback
  ) {
    var currentValue = characteristic.value;
    var currentState = service.controlService.getCharacteristic(
      Characteristic.CurrentDoorState
    ).value;
    var that = this;

    if (
      currentState != value &&
      (currentState == Characteristic.CurrentDoorState.OPEN ||
        currentState == Characteristic.CurrentDoorState.CLOSED)
    ) {
      this.log.debug(
        'INFO - SET Characteristic.TargetDoorState - ' +
          service.controlService.subtype +
          ' - CurrentDoorState is ' +
          this.gogogateAPI.getStateString(currentState)
      );

      homebridgeAccessory.platform.gogogateAPI.activateDoor(
        service.controlService,
        function(error) {
          if (error) {
            that.endDoorOperation(homebridgeAccessory, service);
            setTimeout(function() {
              characteristic.updateValue(currentValue);
            }, 200);
            that.log.debug(
              'ERROR - SET Characteristic.TargetDoorState - ' +
                service.controlService.subtype +
                ' error activating '
            );
          } else {
            that.beginDoorOperation(service, value);

            service.controlService
              .getCharacteristic(Characteristic.CurrentDoorState)
              .updateValue(
                currentState == Characteristic.CurrentDoorState.OPEN
                  ? Characteristic.CurrentDoorState.CLOSING
                  : Characteristic.CurrentDoorState.OPENING
              );

            that.log.debug(
              'INFO - SET Characteristic.TargetDoorState - ' +
                service.controlService.subtype +
                ' success activating '
            );
          }
        }
      );
    }
    callback();
  },

  bindCurrentDoorStateCharacteristic: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    characteristic.on(
      'get',
      function(callback) {
        homebridgeAccessory.platform.getCurrentDoorStateCharacteristic(
          homebridgeAccessory,
          service,
          callback
        );
      }.bind(this)
    );
  },

  bindTargetDoorStateCharacteristic: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    characteristic.on(
      'get',
      function(callback) {
        homebridgeAccessory.platform.getTargetDoorStateCharacteristic(
          homebridgeAccessory,
          service,
          callback
        );
      }.bind(this)
    );

    characteristic.on(
      'set',
      function(value, callback) {
        homebridgeAccessory.platform.setTargetDoorStateCharacteristic(
          homebridgeAccessory,
          service,
          characteristic,
          value,
          callback
        );
      }.bind(this)
    );
  },

  bindObstructionDetectedCharacteristic: function(characteristic) {
    characteristic.on(
      'get',
      function(callback) {
        callback(undefined, false);
      }.bind(this)
    );
  },

  bindSensorCharacteristic: function(
    characteristic,
    service,
    homebridgeAccessory,
    type
  ) {
    characteristic.on(
      'get',
      function(callback) {
        homebridgeAccessory.platform.gogogateAPI.refreshSensor(
          service,
          callback,
          type
        );
      }.bind(this)
    );
  },

  bindChargingStateCharacteristic: function(characteristic) {
    characteristic.on(
      'get',
      function(callback) {
        callback(undefined, false);
      }.bind(this)
    );
  },

  bindStatusLowBatteryCharacteristic: function(characteristic, service) {
    characteristic.on(
      'get',
      function(callback) {
        callback(
          undefined,
          service.controlService.getCharacteristic(
            Characteristic.BatteryLevel
          ) == 0
        );
      }.bind(this)
    );
  },

  bindCharacteristicEvents: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    switch (true) {
      case characteristic instanceof Characteristic.CurrentDoorState:
        this.bindCurrentDoorStateCharacteristic(
          characteristic,
          service,
          homebridgeAccessory
        );
        break;
      case characteristic instanceof Characteristic.TargetDoorState:
        this.bindTargetDoorStateCharacteristic(
          characteristic,
          service,
          homebridgeAccessory
        );
        break;
      case characteristic instanceof Characteristic.ObstructionDetected:
        this.bindObstructionDetectedCharacteristic(characteristic);
        break;
      case characteristic instanceof Characteristic.CurrentTemperature:
        this.bindSensorCharacteristic(
          characteristic,
          service,
          homebridgeAccessory,
          GogogateConst.TEMP_SENSOR
        );
        break;
      case characteristic instanceof Characteristic.BatteryLevel:
        this.bindSensorCharacteristic(
          characteristic,
          service,
          homebridgeAccessory,
          GogogateConst.BATTERY_SENSOR
        );
        break;
      case characteristic instanceof Characteristic.ChargingState:
        this.bindChargingStateCharacteristic(characteristic);
        break;
      case characteristic instanceof Characteristic.StatusLowBattery:
        this.bindStatusLowBatteryCharacteristic(characteristic, service);
        break;
    }
  },

  beginDoorOperation(service, state) {
    //stop timer if one exists.

    if (this.timerID) {
      clearInterval(this.timerID);
      this.timerID = undefined;
    }

    service.TargetDoorState = state;
    service.TargetDoorStateOperationStart = Date.now();

    //start operating timer
    this.log.debug(
      'INFO - beginDoorOperation - ' +
        service.controlService.subtype +
        ' - Setting Timer for operation'
    );

    this.timerID = setInterval(() => {
      this.refreshAllDoors();
    }, this.refreshTimerDuringOperation * 1000);
  },

  endDoorOperation(myGogogateAccessory, service) {
    //stop timer for this operation
    this.log.debug(
      'INFO - endDoorOperation - ' +
        service.controlService.subtype +
        ' - Stopping operation Timer'
    );

    service.TargetDoorState = undefined;
    service.TargetDoorStateOperationStart = undefined;

    this.checkEndOperation(myGogogateAccessory);
  },

  checkEndOperation(myGogogateAccessory) {
    //clear timer and set background again if no other operation in progress
    if (this.timerID) {
      let operationInProgress = false;
      for (let s = 0; s < myGogogateAccessory.services.length; s++) {
        let service = myGogogateAccessory.services[s];
        if (service.TargetDoorStateOperationStart) {
          operationInProgress = true;
          break;
        }
      }

      if (!operationInProgress) {
        clearInterval(this.timerID);
        this.timerID = undefined;
        this.refreshBackground();
      }
    }
  },

  getInformationService: function(homebridgeAccessory) {
    let informationService = new Service.AccessoryInformation();
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
    let services = [];
    let informationService = homebridgeAccessory.platform.getInformationService(
      homebridgeAccessory
    );
    services.push(informationService);
    for (let s = 0; s < homebridgeAccessory.services.length; s++) {
      let service = homebridgeAccessory.services[s];
      for (let i = 0; i < service.characteristics.length; i++) {
        let characteristic = service.controlService.getCharacteristic(
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
