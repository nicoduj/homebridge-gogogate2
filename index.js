var Service, Characteristic, Accessory, UUIDGen;

var GogogateAPI = require('./gogogateAPI.js').GogogateAPI;
const GogogateConst = require('./gogogateConst');
const GogogateTools = require('./gogogateTools.js');

String.prototype.isEmpty = function () {
  return this.length === 0 || !this.trim();
};

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.platformAccessory;
  UUIDGen = homebridge.hap.uuid;
  HomebridgeAPI = homebridge;
  homebridge.registerPlatform('homebridge-gogogate2', 'GogoGate2', Gogogate2Platform, true);
};

function Gogogate2Platform(log, config, api) {
  if (!config) {
    log('No configuration found for homebridge-gogogate2');
    return;
  }

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
    45
  );
  this.cleanCache = config['cleanCache'];

  this.foundAccessories = [];
  this.gogogateAPI = new GogogateAPI(log, this);

  if (api) {
    // Save the API object as plugin needs to register new accessory via this object
    this.api = api;

    // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
    // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
    // Or start discover new accessories.
    this.api
      .on(
        'shutdown',
        function () {
          this.end();
        }.bind(this)
      )
      .on(
        'didFinishLaunching',
        function () {
          this.log('DidFinishLaunching');

          if (this.cleanCache) {
            this.log('WARNING - Removing Accessories');
            this.api.unregisterPlatformAccessories(
              'homebridge-gogogate2',
              'GogoGate2',
              this.foundAccessories
            );
            this.foundAccessories = [];
          }
          this.discoverDoors();
        }.bind(this)
      );
  }
}

Gogogate2Platform.prototype = {
  configureAccessory: function (accessory) {
    this.log.debug(
      accessory.displayName,
      'Got cached Accessory ' + accessory.UUID + ' for ' + this.name
    );
    this.foundAccessories.push(accessory);
  },

  end() {
    this.log('INFO - shutdown');
    if (this.timerID) {
      clearInterval(this.timerID);
      this.timerID = undefined;
    }

    this.gogogateAPI.logout(() => {});
  },

  discoverDoors: function () {
    this.gogogateAPI.on('doorsRetrieveError', () => {
      if (this.timerID == undefined) {
        this.log('ERROR - discoverDoors - will retry in 1 minute');
        setTimeout(() => {
          this.gogogateAPI.getDoors();
        }, 60000);
      }
    });

    this.gogogateAPI.on('doorsRetrieved', () => {
      this.log.debug('INFO - doorsRetrieved event');
      this.loadDoors();
    });

    this.gogogateAPI.on('doorRefreshError', (gateId) => {
      this.log.debug('INFO - doorRefreshError event -' + gateId);
      if (this.timerID == undefined) {
        this.log('ERROR - doorRefreshError - will retry in 1 minute');
        setTimeout(() => {
          this.gogogateAPI.refreshDoor(gateId);
        }, 60000);
      }
    });

    this.gogogateAPI.on('doorRefreshed', (gateId, result) => {
      this.log.debug('INFO - doorRefreshed event -' + gateId + '-' + result);
      this.handleRefreshDoor(result, gateId);
    });

    this.gogogateAPI.on('sensorRefreshError', (gateId) => {
      this.log.debug('INFO - sensorRefreshError event -' + gateId);
      if (this.timerID == undefined) {
        this.log('ERROR - sensorRefreshError - will retry in 1 minute');
        setTimeout(() => {
          this.gogogateAPI.refreshSensor(gateId);
        }, 60000);
      }
    });

    this.gogogateAPI.on('sensorRefreshed', (gateId, result) => {
      this.log.debug('INFO - sensorRefreshed event -' + gateId + '-' + result);
      this.handleRefreshSensor(result, gateId);
    });

    this.gogogateAPI.getDoors();
  },

  loadDoors() {
    let doors = this.gogogateAPI.discoverdDoors;
    let sensors = this.gogogateAPI.discoverdSensors;

    if (doors && doors instanceof Array && doors.length > 0) {
      for (let i = 0, len = doors.length; i < len; i++) {
        let doorName = doors[i];

        if (doorName && !doorName.isEmpty()) {
          if (this.devMode) {
            doorName = 'DEV' + doorName;
          }
          this.log('INFO - Discovered door : ' + doorName);

          let uuid = UUIDGen.generate(doorName);
          let myGogogateDoorAccessory = this.foundAccessories.find((x) => x.UUID == uuid);

          if (!myGogogateDoorAccessory) {
            myGogogateDoorAccessory = new Accessory(doorName, uuid);
            myGogogateDoorAccessory.name = doorName;
            myGogogateDoorAccessory.model = 'Gogogate2';
            myGogogateDoorAccessory.manufacturer = 'Gogogate';
            myGogogateDoorAccessory.serialNumber = doorName + '-' + this.gogogateIP;

            myGogogateDoorAccessory
              .getService(Service.AccessoryInformation)
              .setCharacteristic(Characteristic.Manufacturer, myGogogateDoorAccessory.manufacturer)
              .setCharacteristic(Characteristic.Model, myGogogateDoorAccessory.model)
              .setCharacteristic(Characteristic.SerialNumber, myGogogateDoorAccessory.serialNumber);
            this.api.registerPlatformAccessories('homebridge-gogogate2', 'GogoGate2', [
              myGogogateDoorAccessory,
            ]);
            this.foundAccessories.push(myGogogateDoorAccessory);
          }

          myGogogateDoorAccessory.gateId = i + 1;
          myGogogateDoorAccessory.name = doorName;

          let HKService = myGogogateDoorAccessory.getServiceByUUIDAndSubType(
            doorName,
            'GarageDoorOpener' + doorName
          );

          if (!HKService) {
            this.log('INFO - Creating Main Service ' + doorName);
            HKService = new Service.GarageDoorOpener(doorName, 'GarageDoorOpener' + doorName);
            HKService.subtype = 'GarageDoorOpener' + doorName;
            myGogogateDoorAccessory.addService(HKService);
          }

          HKService.gateId = i + 1;

          this.bindCurrentDoorStateCharacteristic(HKService, myGogogateDoorAccessory);
          this.bindTargetDoorStateCharacteristic(HKService, myGogogateDoorAccessory);
          this.bindObstructionDetectedCharacteristic(HKService, myGogogateDoorAccessory);

          if (sensors[i] && !sensors[i].isEmpty()) {
            this.log('INFO - Discovered sensor : ' + sensors[i]);

            let HKService1 = myGogogateDoorAccessory.getServiceByUUIDAndSubType(
              doorName,
              'BatteryService' + sensors[i]
            );

            if (!HKService1) {
              this.log(
                'INFO - Creating  Service ' + doorName + '/' + 'BatteryService' + sensors[i]
              );
              HKService1 = new Service.BatteryService(doorName, 'BatteryService' + sensors[i]);
              HKService1.subtype = 'BatteryService' + sensors[i];
              myGogogateDoorAccessory.addService(HKService1);
            }
            HKService1.gateId = i + 1;

            this.bindBatteryLevelCharacteristic(HKService1, myGogogateDoorAccessory);
            this.bindChargingStateCharacteristic(HKService1);
            this.bindStatusLowBatteryCharacteristic(HKService1);

            let HKService2 = myGogogateDoorAccessory.getServiceByUUIDAndSubType(
              doorName,
              'Temp' + sensors[i]
            );

            if (!HKService2) {
              this.log('INFO - Creating  Service ' + doorName + '/' + 'Temp' + sensors[i]);
              HKService2 = new Service.TemperatureSensor(doorName, 'Temp' + sensors[i]);
              HKService2.subtype = 'Temp' + sensors[i];
              myGogogateDoorAccessory.addService(HKService2);
            }

            HKService2.gateId = i + 1;

            this.bindCurrentTemperatureLevelCharacteristic(HKService2, myGogogateDoorAccessory);
          }
        }
      }
      this.refreshAllDoors();
      //timer for background refresh
      this.refreshBackground();
    } else {
      this.log('ERROR - discoverDoors - no door found, will retry in 1 minute - ' + doors);

      setTimeout(() => {
        this.gogogateAPI.getDoors();
      }, 60000);
    }
  },

  endOperation(service, statusbody) {
    if (statusbody != 'OK' && statusbody != 'FAIL') return true;

    //timeout
    if (
      service.TargetDoorState !== undefined &&
      service.TargetDoorStateOperationStart !== undefined
    ) {
      let elapsedTime = Date.now() - service.TargetDoorStateOperationStart;
      this.log.debug(
        'INFO - CheckTimeout / statusbody : ' + statusbody + ' - elapsedTime : ' + elapsedTime
      );
      if (elapsedTime > this.maxWaitTimeForOperation * 1000) {
        return true;
      }
    }

    return false;
  },

  handleRefreshDoor(statusbody, gateId) {
    //retrieve service
    var service;
    let myGogogateDoorAccessory = this.foundAccessories.find((x) => x.gateId == gateId);

    if (myGogogateDoorAccessory) {
      service = myGogogateDoorAccessory.getServiceByUUIDAndSubType(
        myGogogateDoorAccessory.name,
        'GarageDoorOpener' + myGogogateDoorAccessory.name
      );
    }

    if (!service) {
      this.log('Error - handleRefreshDoor - ' + gateId + ' - no service found');
      return;
    }

    let currentDoorState =
      statusbody == 'OK'
        ? Characteristic.CurrentDoorState.OPEN
        : Characteristic.CurrentDoorState.CLOSED;
    let operationInProgress = service.TargetDoorStateOperationStart !== undefined;
    let operationInProgressIsFinished =
      operationInProgress && service.TargetDoorState == currentDoorState;
    let oldDoorState = service.getCharacteristic(Characteristic.CurrentDoorState).value;
    let oldTargetState = service.getCharacteristic(Characteristic.TargetDoorState).value;

    this.log.debug(
      'INFO - refreshDoor - Got Status for : ' +
        service.subtype +
        ' - (currentDoorState/operationInProgress/operationInProgressIsFinished/oldDoorState) : (' +
        currentDoorState +
        '/' +
        operationInProgress +
        '/' +
        operationInProgressIsFinished +
        '/' +
        oldDoorState +
        ')'
    );

    var newDoorState = oldDoorState;
    var newTargetState = oldTargetState;

    //operation has finished or timed out

    if (operationInProgressIsFinished || this.endOperation(service, statusbody)) {
      this.endDoorOperation(service);
      if (!operationInProgressIsFinished) {
        this.log(
          'WARNING - refreshDoor - ' +
            service.subtype +
            ' - operation was in progress and has timedout or no status retrieval'
        );
      }
      newDoorState = currentDoorState;
      newTargetState = currentDoorState;
    } else if (!operationInProgress && currentDoorState != oldDoorState) {
      newDoorState = currentDoorState;
      newTargetState = currentDoorState;
    }

    if (newTargetState != oldTargetState) {
      this.log.debug(
        'INFO - refreshDoor - ' +
          service.subtype +
          ' updating TargetDoorState to : ' +
          this.gogogateAPI.getStateString(newTargetState)
      );
      //TargetDoorState before CurrentDoorState
      setImmediate(() => {
        service.getCharacteristic(Characteristic.TargetDoorState).updateValue(newTargetState);
      });
    }

    if (newDoorState != oldDoorState) {
      this.log.debug(
        'INFO - refreshDoor - ' +
          service.subtype +
          ' updating CurrentDoorState to : ' +
          this.gogogateAPI.getStateString(newDoorState)
      );
      setImmediate(() => {
        service.getCharacteristic(Characteristic.CurrentDoorState).updateValue(newDoorState);
      });
    }
  },

  handleRefreshSensor(statusbody, gateId) {
    this.log.debug('INFO - refreshSensor with body  : ' + statusbody);
    let res = JSON.parse(statusbody);
    var newVal;

    //retrieve service
    var batteryService;
    var tempService;
    let myGogogateDoorAccessory = this.foundAccessories.find((x) => x.gateId == gateId);

    if (myGogogateDoorAccessory) {
      for (let s = 0; s < myGogogateDoorAccessory.services.length; s++) {
        let service = myGogogateDoorAccessory.services[s];
        if (service.UUID == Service.TemperatureSensor.UUID) {
          tempService = service;
        } else if (service.UUID == Service.BatteryService.UUID) {
          batteryService = service;
        }
      }
    }

    if (!batteryService) {
      this.log('Error - handleRefreshSensor - ' + batteryService.subtype + ' - service not found');
    } else {
      newVal = GogogateTools.normalizeBattery(res[1]);
      this.log.debug('INFO - refreshBattery with value  : ' + newVal);
      batteryService.getCharacteristic(Characteristic.BatteryLevel).updateValue(newVal);
    }

    if (!tempService) {
      this.log('Error - handleRefreshSensor - ' + batteryService.subtype + ' - service not found');
    } else {
      newVal = res[0] / 1000;
      this.log.debug('INFO - refreshTemp with value  : ' + newVal);
      tempService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(newVal);
    }
  },

  getCurrentDoorStateCharacteristic: function (homebridgeAccessory, service, callback) {
    callback(undefined, service.getCharacteristic(Characteristic.CurrentDoorState).value);

    //no operationInProgress, refresh current state
    if (service.TargetDoorStateOperationStart == undefined) {
      this.gogogateAPI.refreshDoor(service.gateId);
    }
  },

  getTargetDoorStateCharacteristic: function (homebridgeAccessory, service, callback) {
    callback(undefined, service.TargetDoorState);

    //no operationInProgress, refresh current state
    if (service.TargetDoorStateOperationStart == undefined) {
      this.gogogateAPI.refreshDoor(service.gateId);
    }
  },

  setTargetDoorStateCharacteristic: function (homebridgeAccessory, service, value, callback) {
    var currentValue = service.getCharacteristic(Characteristic.TargetDoorState).value;

    var currentState = service.getCharacteristic(Characteristic.CurrentDoorState).value;
    var that = this;

    if (
      currentState != value &&
      (currentState == Characteristic.CurrentDoorState.OPEN ||
        currentState == Characteristic.CurrentDoorState.CLOSED)
    ) {
      this.log.debug(
        'INFO - SET Characteristic.TargetDoorState - ' +
          service.subtype +
          ' - CurrentDoorState is ' +
          this.gogogateAPI.getStateString(currentState)
      );

      this.gogogateAPI.activateDoor(service, function (error) {
        if (error) {
          that.endDoorOperation(service);
          setImmediate(() => {
            service.getCharacteristic(Characteristic.TargetDoorState).updateValue(currentValue);
            service.getCharacteristic(Characteristic.CurrentDoorState).updateValue(currentState);
          });
          that.log.debug(
            'ERROR - SET Characteristic.TargetDoorState - ' + service.subtype + ' error activating '
          );
        } else {
          that.beginDoorOperation(service, value);

          that.log.debug(
            'INFO - SET Characteristic.TargetDoorState - ' +
              service.subtype +
              ' success activating '
          );
        }
      });
    }
    callback();
  },

  bindCurrentDoorStateCharacteristic: function (service, homebridgeAccessory) {
    service.getCharacteristic(Characteristic.CurrentDoorState).on(
      'get',
      function (callback) {
        this.getCurrentDoorStateCharacteristic(homebridgeAccessory, service, callback);
      }.bind(this)
    );
  },

  bindTargetDoorStateCharacteristic: function (service, homebridgeAccessory) {
    service
      .getCharacteristic(Characteristic.TargetDoorState)
      .on(
        'get',
        function (callback) {
          this.getTargetDoorStateCharacteristic(homebridgeAccessory, service, callback);
        }.bind(this)
      )
      .on(
        'set',
        function (value, callback) {
          this.setTargetDoorStateCharacteristic(homebridgeAccessory, service, value, callback);
        }.bind(this)
      );
  },

  bindObstructionDetectedCharacteristic: function (service) {
    service.getCharacteristic(Characteristic.ObstructionDetected).on(
      'get',
      function (callback) {
        callback(undefined, false);
      }.bind(this)
    );
  },

  bindBatteryLevelCharacteristic: function (service, homebridgeAccessory) {
    service.getCharacteristic(Characteristic.BatteryLevel).on(
      'get',
      function (callback) {
        var percent = service.getCharacteristic(Characteristic.BatteryLevel).value;
        callback(undefined, percent);
        this.gogogateAPI.refreshSensor(service.gateId);
      }.bind(this)
    );
  },

  bindCurrentTemperatureLevelCharacteristic: function (service, homebridgeAccessory) {
    service.getCharacteristic(Characteristic.CurrentTemperature).on(
      'get',
      function (callback) {
        var temp = service.getCharacteristic(Characteristic.CurrentTemperature).value;
        callback(undefined, temp);
        this.gogogateAPI.refreshSensor(service.gateId);
      }.bind(this)
    );
  },

  bindChargingStateCharacteristic: function (service) {
    service.getCharacteristic(Characteristic.ChargingState).on(
      'get',
      function (callback) {
        callback(undefined, false);
      }.bind(this)
    );
  },

  bindStatusLowBatteryCharacteristic: function (service) {
    service.getCharacteristic(Characteristic.StatusLowBattery).on(
      'get',
      function (callback) {
        callback(undefined, service.getCharacteristic(Characteristic.BatteryLevel) == 0);
      }.bind(this)
    );
  },

  beginDoorOperation(service, state) {
    //stop timer if one exists.

    if (this.timerID !== undefined) {
      clearInterval(this.timerID);
      this.timerID = undefined;
    }

    service.TargetDoorState = state;
    service.TargetDoorStateOperationStart = Date.now();

    //start operating timer
    this.log.debug(
      'INFO - beginDoorOperation - ' + service.subtype + ' - Setting Timer for operation'
    );

    this.timerID = setInterval(() => {
      this.refreshAllDoors();
    }, this.refreshTimerDuringOperation * 1000);
  },

  endDoorOperation(service) {
    //stop timer for this operation
    this.log.debug('INFO - endDoorOperation - ' + service.subtype + ' - Stopping operation');

    service.TargetDoorState = undefined;
    service.TargetDoorStateOperationStart = undefined;

    this.checkEndOperation();
  },

  checkEndOperation() {
    //clear timer and set background again if no other operation in progress

    if (this.timerID !== undefined) {
      let operationInProgress = false;
      for (let a = 0; a < this.foundAccessories.length; a++) {
        let myGogogateAccessory = this.foundAccessories[a];
        for (let s = 0; s < myGogogateAccessory.services.length; s++) {
          let service = myGogogateAccessory.services[s];
          if (service.TargetDoorStateOperationStart !== undefined) {
            operationInProgress = true;
            break;
          }
        }
        if (operationInProgress) break;
      }

      if (!operationInProgress) {
        this.log.debug('Stopping Operation Timer ');
        clearInterval(this.timerID);
        this.timerID = undefined;
        this.refreshBackground();
      }
    }
  },

  refreshBackground() {
    //timer for background refresh
    if (this.refreshTimer !== undefined && this.refreshTimer > 0) {
      this.log.debug(
        'INFO - Setting Timer for background refresh every  : ' + this.refreshTimer + 's'
      );
      this.timerID = setInterval(() => this.refreshAllDoors(), this.refreshTimer * 1000);
    }
  },

  refreshAllDoors: function () {
    for (let a = 0; a < this.foundAccessories.length; a++) {
      this.log.debug('INFO - refreshing - ' + this.foundAccessories[a].name);
      let myGogogateAccessory = this.foundAccessories[a];

      for (let s = 0; s < myGogogateAccessory.services.length; s++) {
        let service = myGogogateAccessory.services[s];
        if (service.UUID == Service.GarageDoorOpener.UUID) {
          this.log.debug('INFO - refreshAllDoors - Door : ' + service.subtype);
          this.gogogateAPI.refreshDoor(service.gateId);
        } else if (service.UUID == Service.TemperatureSensor.UUID) {
          this.log.debug('INFO - refreshAllDoors - Temp / Battery : ' + service.subtype);
          this.gogogateAPI.refreshSensor(service.gateId);
          //battery will be done with temp
        }
      }
    }
  },
};
