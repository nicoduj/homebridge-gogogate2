var Service, Characteristic, Accessory, UUIDGen;

var GogogateAPI = require('./gogogateAPI.js').GogogateAPI;
const GogogateConst = require('./gogogateConst');
const GogogateTools = require('./gogogateTools.js');

String.prototype.isEmpty = function() {
  return this.length === 0 || !this.trim();
};

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.platformAccessory;
  UUIDGen = homebridge.hap.uuid;
  HomebridgeAPI = homebridge;
  homebridge.registerPlatform(
    'homebridge-gogogate2',
    'GogoGate2',
    Gogogate2Platform,
    true
  );
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

  this.doors = [];

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
        function() {
          this.end();
        }.bind(this)
      )
      .on(
        'didFinishLaunching',
        function() {
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
          this.configureAccessories();
        }.bind(this)
      );
  }
}

Gogogate2Platform.prototype = {
  configureAccessory: function(accessory) {
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

  configureAccessories: function() {
    this.gogogateAPI.login(success => {
      if (success) {
        this.gogogateAPI.getDoors(successDoors => {
          if (successDoors) {
            this.handleDoorsDiscovery();

            this.refreshAllDoors();
            //timer for background refresh
            this.refreshBackground();
          }
        });
      }
    });
  },

  handleDoorsDiscovery() {
    for (let i = 0, len = this.doors.length; i < len; i++) {
      let doorName = this.doors[i];

      if (doorName && !doorName.isEmpty()) {
        if (this.devMode) {
          doorName = 'DEV' + doorName;
        }
        this.log('INFO - Discovered door : ' + doorName);

        let uuid = UUIDGen.generate(doorName);
        let myGogogateDoorAccessory = this.foundAccessories.find(
          x => x.UUID == uuid
        );

        if (!myGogogateDoorAccessory) {
          myGogogateDoorAccessory = new Accessory(doorName, uuid);
          myGogogateDoorAccessory.name = doorName;
          myGogogateDoorAccessory.model = 'Gogogate2';
          myGogogateDoorAccessory.manufacturer = 'Gogogate';
          myGogogateDoorAccessory.serialNumber =
            doorName + '-' + this.gogogateIP;

          myGogogateDoorAccessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(
              Characteristic.Manufacturer,
              myGogogateDoorAccessory.manufacturer
            )
            .setCharacteristic(
              Characteristic.Model,
              myGogogateDoorAccessory.model
            )
            .setCharacteristic(
              Characteristic.SerialNumber,
              myGogogateDoorAccessory.serialNumber
            );
          this.api.registerPlatformAccessories(
            'homebridge-gogogate2',
            'GogoGate2',
            [myGogogateDoorAccessory]
          );
          this.foundAccessories.push(myGogogateDoorAccessory);
        }

        myGogogateDoorAccessory.platform = this;

        let HKService = myGogogateDoorAccessory.getServiceByUUIDAndSubType(
          doorName,
          'GarageDoorOpener' + doorName
        );

        if (!HKService) {
          this.log('INFO - Creating  Service ' + doorName + '/' + doorName);
          HKService = new Service.GarageDoorOpener(
            doorName,
            'GarageDoorOpener' + doorName
          );
          HKService.subtype = 'GarageDoorOpener' + doorName;
          myGogogateDoorAccessory.addService(HKService);
        }

        HKService.gateId = i + 1;

        this.bindCurrentDoorStateCharacteristic(
          HKService,
          myGogogateDoorAccessory
        );
        this.bindTargetDoorStateCharacteristic(
          HKService,
          myGogogateDoorAccessory
        );
        this.bindObstructionDetectedCharacteristic(
          HKService,
          myGogogateDoorAccessory
        );

        if (this.sensors[i] && !this.sensors[i].isEmpty()) {
          this.log('INFO - Discovered sensor : ' + this.sensors[i]);

          let HKService1 = myGogogateDoorAccessory.getServiceByUUIDAndSubType(
            doorName,
            'BatteryService' + this.sensors[i]
          );

          if (!HKService1) {
            this.log(
              'INFO - Creating  Service ' +
                doorName +
                '/' +
                'BatteryService' +
                this.sensors[i]
            );
            HKService1 = new Service.BatteryService(
              doorName,
              'BatteryService' + this.sensors[i]
            );
            HKService1.subtype = 'BatteryService' + this.sensors[i];
            myGogogateDoorAccessory.addService(HKService1);
          }
          HKService1.gateId = i + 1;

          this.bindBatteryLevelCharacteristic(
            HKService1,
            myGogogateDoorAccessory
          );
          this.bindChargingStateCharacteristic(HKService1);
          this.bindStatusLowBatteryCharacteristic(HKService1);

          let HKService2 = myGogogateDoorAccessory.getServiceByUUIDAndSubType(
            doorName,
            'Temp' + this.sensors[i]
          );

          if (!HKService2) {
            this.log(
              'INFO - Creating  Service ' +
                doorName +
                '/' +
                'Temp' +
                this.sensors[i]
            );
            HKService2 = new Service.TemperatureSensor(
              doorName,
              'Temp' + this.sensors[i]
            );
            HKService2.subtype = 'Temp' + this.sensors[i];
            myGogogateDoorAccessory.addService(HKService2);
          }

          HKService2.gateId = i + 1;

          this.bindCurrentTemperatureLevelCharacteristic(
            HKService2,
            myGogogateDoorAccessory
          );
        }
      }
    }
  },

  refreshAllDoors: function() {
    this.log.debug('INFO - Refreshing status ');

    for (let a = 0; a < this.foundAccessories.length; a++) {
      let myGogogateAccessory = this.foundAccessories[a];

      for (let s = 0; s < myGogogateAccessory.services.length; s++) {
        let service = myGogogateAccessory.services[s];
        if (service.UUID == Service.GarageDoorOpener.UUID) {
          this.log.debug('INFO - refreshAllDoors - Door : ' + service.subtype);
          this.gogogateAPI.refreshDoor(myGogogateAccessory, service);
        } else if (service.UUID == Service.TemperatureSensor.UUID) {
          this.log.debug('INFO - refreshAllDoors - Temp : ' + service.subtype);
          this.gogogateAPI.refreshSensor(
            service,
            null,
            GogogateConst.TEMP_SENSOR
          );
        } else if (service.UUID == Service.BatteryService.UUID) {
          this.log.debug(
            'INFO - refreshAllDoors - Battery : ' + service.subtype
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

  endOperation(service, statusbody) {
    if (statusbody != 'OK' && statusbody != 'FAIL') return true;

    //timeout
    if (
      service.TargetDoorState !== undefined &&
      service.TargetDoorStateOperationStart !== undefined
    ) {
      let elapsedTime = Date.now() - service.TargetDoorStateOperationStart;
      this.log.debug(
        'INFO - CheckTimeout / statusbody : ' +
          statusbody +
          ' - elapsedTime : ' +
          elapsedTime
      );
      if (elapsedTime > this.maxWaitTimeForOperation * 1000) {
        return true;
      }
    }

    return false;
  },

  handleRefreshDoor(
    statusbody,
    myGogogateAccessory,
    service,
    callback,
    characteristic
  ) {
    let currentDoorState =
      statusbody == 'OK'
        ? Characteristic.CurrentDoorState.OPEN
        : Characteristic.CurrentDoorState.CLOSED;
    let operationInProgress =
      service.TargetDoorStateOperationStart !== undefined;
    let operationInProgressIsFinished =
      operationInProgress && service.TargetDoorState == currentDoorState;
    let oldDoorState = service.getCharacteristic(
      Characteristic.CurrentDoorState
    ).value;
    let oldTargetState = service.getCharacteristic(
      Characteristic.TargetDoorState
    ).value;

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

    if (
      operationInProgressIsFinished ||
      this.endOperation(service, statusbody)
    ) {
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

    if (callback) {
      if (characteristic == Characteristic.CurrentDoorState) {
        this.log.debug(
          'INFO - refreshDoor - ' +
            service.subtype +
            ' calling callback on CurrentDoorState with value : ' +
            this.gogogateAPI.getStateString(newDoorState)
        );
        callback(undefined, newDoorState);
      } else if (characteristic == Characteristic.TargetDoorState) {
        this.log.debug(
          'INFO - refreshDoor - ' +
            service.subtype +
            ' calling callback on TargetDoorState with value : ' +
            this.gogogateAPI.getStateString(newTargetState)
        );
        callback(undefined, newTargetState);
      }
    } else {
      if (newTargetState != oldTargetState) {
        this.log.debug(
          'INFO - refreshDoor - ' +
            service.subtype +
            ' updating TargetDoorState to : ' +
            this.gogogateAPI.getStateString(newTargetState)
        );
        //TargetDoorState before CurrentDoorState
        setImmediate(() => {
          service
            .getCharacteristic(Characteristic.TargetDoorState)
            .updateValue(newTargetState);
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
          service
            .getCharacteristic(Characteristic.CurrentDoorState)
            .updateValue(newDoorState);
        });
      }
    }
  },

  handleRefreshSensor(service, statusbody, callback, type) {
    this.log.debug('INFO - refreshSensor with body  : ' + statusbody);

    let res = JSON.parse(statusbody);

    var newVal;
    var charToUpdate = undefined;
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
      setImmediate(() => {
        service.getCharacteristic(charToUpdate).updateValue(newVal);
      });
    }
  },

  getCurrentDoorStateCharacteristic: function(
    homebridgeAccessory,
    service,
    callback
  ) {
    //operationInProgress, returns current state
    if (service.TargetDoorStateOperationStart !== undefined) {
      callback(
        undefined,
        service.getCharacteristic(Characteristic.CurrentDoorState).value
      );
    } else {
      this.log.debug(
        'INFO - GET Characteristic.CurrentDoorState - ' +
          service.subtype +
          ' - Real state through REFRESHDOOR'
      );

      homebridgeAccessory.platform.gogogateAPI.refreshDoor(
        homebridgeAccessory,
        service,
        callback,
        Characteristic.CurrentDoorState
      );
    }
  },

  getTargetDoorStateCharacteristic: function(
    homebridgeAccessory,
    service,
    callback
  ) {
    if (service.TargetDoorState !== undefined) {
      this.log.debug(
        'INFO - GET Characteristic.TargetDoorState - ' +
          service.subtype +
          ' - callback with state : ' +
          this.gogogateAPI.getStateString(service.TargetDoorState)
      );

      callback(undefined, service.TargetDoorState);
    } else {
      this.log.debug(
        'INFO - GET Characteristic.TargetDoorState - ' +
          service.subtype +
          ' - Real state through REFRESHDOOR'
      );

      homebridgeAccessory.platform.gogogateAPI.refreshDoor(
        homebridgeAccessory,
        service,
        callback,
        Characteristic.TargetDoorState
      );
    }
  },

  setTargetDoorStateCharacteristic: function(
    homebridgeAccessory,
    service,
    value,
    callback
  ) {
    var currentValue = service.getCharacteristic(Characteristic.TargetDoorState)
      .value;

    var currentState = service.getCharacteristic(
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
          service.subtype +
          ' - CurrentDoorState is ' +
          this.gogogateAPI.getStateString(currentState)
      );

      homebridgeAccessory.platform.gogogateAPI.activateDoor(service, function(
        error
      ) {
        if (error) {
          that.endDoorOperation(service);
          setImmediate(() => {
            service
              .getCharacteristic(Characteristic.TargetDoorState)
              .updateValue(currentValue);
            service
              .getCharacteristic(Characteristic.CurrentDoorState)
              .updateValue(currentState);
          });
          that.log.debug(
            'ERROR - SET Characteristic.TargetDoorState - ' +
              service.subtype +
              ' error activating '
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

  bindCurrentDoorStateCharacteristic: function(service, homebridgeAccessory) {
    service.getCharacteristic(Characteristic.CurrentDoorState).on(
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

  bindTargetDoorStateCharacteristic: function(service, homebridgeAccessory) {
    service
      .getCharacteristic(Characteristic.TargetDoorState)
      .on(
        'get',
        function(callback) {
          homebridgeAccessory.platform.getTargetDoorStateCharacteristic(
            homebridgeAccessory,
            service,
            callback
          );
        }.bind(this)
      )
      .on(
        'set',
        function(value, callback) {
          homebridgeAccessory.platform.setTargetDoorStateCharacteristic(
            homebridgeAccessory,
            service,
            value,
            callback
          );
        }.bind(this)
      );
  },

  bindObstructionDetectedCharacteristic: function(service) {
    service.getCharacteristic(Characteristic.ObstructionDetected).on(
      'get',
      function(callback) {
        callback(undefined, false);
      }.bind(this)
    );
  },

  bindBatteryLevelCharacteristic: function(service, homebridgeAccessory) {
    let type = GogogateConst.BATTERY_SENSOR;
    service.getCharacteristic(Characteristic.BatteryLevel).on(
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

  bindCurrentTemperatureLevelCharacteristic: function(
    service,
    homebridgeAccessory
  ) {
    let type = GogogateConst.TEMP_SENSOR;
    service.getCharacteristic(Characteristic.CurrentTemperature).on(
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

  bindChargingStateCharacteristic: function(service) {
    service.getCharacteristic(Characteristic.ChargingState).on(
      'get',
      function(callback) {
        callback(undefined, false);
      }.bind(this)
    );
  },

  bindStatusLowBatteryCharacteristic: function(service) {
    service.getCharacteristic(Characteristic.StatusLowBattery).on(
      'get',
      function(callback) {
        callback(
          undefined,
          service.getCharacteristic(Characteristic.BatteryLevel) == 0
        );
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
      'INFO - beginDoorOperation - ' +
        service.subtype +
        ' - Setting Timer for operation'
    );

    this.timerID = setInterval(() => {
      this.refreshAllDoors();
    }, this.refreshTimerDuringOperation * 1000);
  },

  endDoorOperation(service) {
    //stop timer for this operation
    this.log.debug(
      'INFO - endDoorOperation - ' + service.subtype + ' - Stopping operation'
    );

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
};
